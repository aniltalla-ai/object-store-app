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

const fs = require('fs');

const getAuthTokenUrl = () => {
  let baseUrl = process.env.AUTH_TOKEN_URL;

  if (!baseUrl && process.env.VCAP_SERVICES) {
    try {
      const vcap = typeof process.env.VCAP_SERVICES === 'string' ? JSON.parse(process.env.VCAP_SERVICES) : process.env.VCAP_SERVICES;
      if (vcap.xsuaa && vcap.xsuaa[0] && vcap.xsuaa[0].credentials && vcap.xsuaa[0].credentials.url) {
        baseUrl = vcap.xsuaa[0].credentials.url;
      }
    } catch (e) {}
  }

  if (!baseUrl) {
    try {
      const defaultEnvPath = path.join(__dirname, 'default-env.json');
      if (fs.existsSync(defaultEnvPath)) {
        const defEnv = JSON.parse(fs.readFileSync(defaultEnvPath, 'utf8'));
        const xsuaa = defEnv.VCAP_SERVICES?.xsuaa?.[0] || defEnv.xsuaa?.[0];
        if (xsuaa?.credentials?.url) {
          baseUrl = xsuaa.credentials.url;
        }
      }
    } catch (e) {}
  }

  baseUrl = baseUrl || 'https://gtms.authentication.eu10.hana.ondemand.com';
  baseUrl = baseUrl.replace(/\/+$/, '');
  if (!baseUrl.endsWith('/oauth/token')) {
    baseUrl += '/oauth/token';
  }
  return baseUrl;
};

// Dynamic route to serve openapi.json with process.env.AUTH_TOKEN_URL replacement
app.get(['/swagger/openapi.json', '/openapi.json'], (req, res) => {
  const specPath = path.join(__dirname, 'swagger', 'openapi.json');
  let specContent = fs.readFileSync(specPath, 'utf8');
  const tokenUrl = getAuthTokenUrl();
  specContent = specContent.replace(/AUTH_TOKEN_URL/g, tokenUrl);

  res.setHeader('Content-Type', 'application/json');
  res.send(specContent);
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
