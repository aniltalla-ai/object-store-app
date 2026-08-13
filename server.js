require('dotenv').config();

const path = require('path');
const express = require('express');
const passport = require('passport');
const storageRouter = require('./src/storageRouter');

const app = express();

app.use(passport.initialize());
app.use(express.json({ limit: '100mb' }));
app.use(express.raw({ type: 'application/octet-stream', limit: '100mb' }));
app.use(express.text({ type: 'text/plain', limit: '100mb' }));

// Swagger UI Route
app.get('/swagger', (req, res, next) => {
  if (!req.originalUrl.endsWith('/')) {
    return res.redirect(req.originalUrl + '/');
  }
  next();
});
app.use('/swagger', express.static(path.join(__dirname, 'swagger')));

// Serve raw README.md file
app.get('/README.md', (req, res) => {
  res.sendFile(path.join(__dirname, 'README.md'));
});

// Root Route Documentation View
app.get('/', (req, res) => {
  if (req.accepts('html')) {
    return res.sendFile(path.join(__dirname, 'swagger/docs.html'));
  }
  res.sendFile(path.join(__dirname, 'README.md'));
});

app.use('/Storage', storageRouter);

const PORT = process.env.PORT || 4004;
app.listen(PORT, () => {
  console.log('=================================================');
  console.log(`🚀 Standalone Object Store App is live at http://localhost:${PORT}`);
  console.log(`📖 README Docs available at http://localhost:${PORT}/`);
  console.log(`📖 Swagger UI available at http://localhost:${PORT}/swagger/`);
  console.log(`🔒 Security Layer: Bearer OAuth / XSUAA Auth Guard`);
  console.log('=================================================');
});
