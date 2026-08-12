require('dotenv').config();

const path = require('path');
const express = require('express');
const storageRouter = require('./src/storageRouter');

const app = express();

app.use(express.json({ limit: '100mb' }));
app.use(express.raw({ type: 'application/octet-stream', limit: '100mb' }));
app.use(express.text({ type: 'text/plain', limit: '100mb' }));

app.use(express.static(path.join(__dirname, 'app')));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'app', 'index.html'));
});

app.use('/Storage', storageRouter);

const PORT = process.env.PORT || 4004;
app.listen(PORT, () => {
  console.log('=================================================');
  console.log(`🚀 Standalone Object Store App is live at http://localhost:${PORT}`);
  console.log(`🔧 Running in Profile: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔒 Security Layer: ${process.env.MOCK_LOCAL_STORAGE === 'true' ? 'Local mock auth' : 'Production auth guard'}`);
  console.log('=================================================');
});
