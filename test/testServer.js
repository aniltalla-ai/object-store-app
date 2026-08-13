const path = require('path');
const express = require('express');
const StorageAdapter = require('../src/storageAdapter');
const MockProvider = require('./mockProvider');
const storageRouter = require('../src/storageRouter');

// Inject MockProvider into StorageAdapter for local test server
const mockProviderInstance = new MockProvider();
StorageAdapter.getClient = async () => mockProviderInstance;

const createTestApp = () => {
  const app = express();

  app.use(express.json({ limit: '100mb' }));
  app.use(express.raw({ type: 'application/octet-stream', limit: '100mb' }));
  app.use(express.text({ type: 'text/plain', limit: '100mb' }));

  app.get('/swagger', (req, res, next) => {
    if (!req.originalUrl.endsWith('/')) {
      return res.redirect(req.originalUrl + '/');
    }
    next();
  });
  app.use('/swagger', express.static(path.join(__dirname, '../swagger')));

  app.get('/README.md', (req, res) => {
    res.sendFile(path.join(__dirname, '../README.md'));
  });

  app.get('/', (req, res) => {
    if (req.accepts('html')) {
      return res.sendFile(path.join(__dirname, '../swagger/docs.html'));
    }
    res.sendFile(path.join(__dirname, '../README.md'));
  });

  app.use('/Storage', storageRouter);

  return app;
};

if (require.main === module) {
  const app = createTestApp();
  const PORT = process.env.PORT || 4004;
  app.listen(PORT, () => {
    console.log('=================================================');
    console.log(`🧪 Local Test Server is live at http://localhost:${PORT}`);
    console.log(`📖 README Docs available at http://localhost:${PORT}/`);
    console.log(`📖 Swagger UI available at http://localhost:${PORT}/swagger/`);
    console.log(`🔧 Mode: Local Mock Test Harness`);
    console.log('=================================================');
  });
}

module.exports = createTestApp;
