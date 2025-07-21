require('dotenv').config(); // top of file

const express = require('express');
const fs = require('fs');
const path = require('path');
const bodyParser = require('body-parser');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());
app.use(express.static('public'));
app.set('view engine', 'html');
app.engine('html', require('ejs').renderFile);

app.post('/submit-clipboard', (req, res) => {
  const { clipboardData } = req.body;
  const savePath = path.join(__dirname, 'data', 'clipboard.html');
  fs.writeFile(savePath, clipboardData, err => {
    if (err) return res.status(500).send('Failed to save clipboard data.');
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
