require('dotenv').config();

const path = require('path');
const fs = require('fs');
const cors = require('cors');
const { getMessage } = require('./utils/i18n');
const passport = require('passport');
const storageRouter = require('./storageRouter');

const app = express();

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept', 'Authorization', 'Accept-Language', 'sap-language', 'x-sap-language', 'x-crypto-destination', 'destination'],
  exposedHeaders: ['Content-Disposition', 'Content-Type', 'Content-Length'],
}));
app.options('*', cors());

app.use(passport.initialize());
app.use(express.json({ limit: '100mb' }));
app.use(express.raw({ type: 'application/octet-stream', limit: '100mb' }));
app.use(express.text({ type: 'text/plain', limit: '100mb' }));

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
      const defaultEnvPath = path.join(__dirname, '../default-env.json');
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

// Serve static openapi.json file with dynamic AUTH_TOKEN_URL replacement and localization
app.get(['/swagger/openapi.json', '/openapi.json'], (req, res) => {
  const lang = (req.query.lang || req.headers['accept-language'] || req.headers['sap-language'] || 'en').toString();

  const specPath = path.join(__dirname, '../public', 'openapi.json');
  let specContent = fs.readFileSync(specPath, 'utf8');
  const tokenUrl = getAuthTokenUrl();
  specContent = specContent.replace(/AUTH_TOKEN_URL/g, tokenUrl);

  try {
    const doc = JSON.parse(specContent);
    if (doc.info) {
      if (doc.info.title) doc.info.title = getMessage('SWAGGER_INFO_TITLE', lang) || doc.info.title;
      if (doc.info.description) doc.info.description = getMessage('SWAGGER_INFO_DESC', lang) || doc.info.description;
    }

    if (doc.paths) {
      for (const [pathKey, pathObj] of Object.entries(doc.paths)) {
        for (const [method, operation] of Object.entries(pathObj)) {
          if (typeof operation !== 'object' || !operation) continue;
          const opId = (method.toUpperCase() + '_' + pathKey.replace(/[^a-zA-Z0-9]/g, '_')).toUpperCase();
          const summaryKey = `SWAGGER_${opId}_SUMMARY`;
          const translatedSummary = getMessage(summaryKey, lang);
          if (translatedSummary && translatedSummary !== summaryKey) {
            operation.summary = translatedSummary;
          }
        }
      }
    }

    res.setHeader('Content-Type', 'application/json');
    return res.json(doc);
  } catch (err) {
    res.setHeader('Content-Type', 'application/json');
    return res.send(specContent);
  }
});

// Static assets & Vendor mappings
app.use('/swagger', express.static(path.join(__dirname, '../public')));
app.use(express.static(path.join(__dirname, '../public')));

// Root Route Documentation View
app.get('/', (req, res) => {
  return res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.use('/Storage', storageRouter);

const PORT = process.env.PORT || 4004;
app.listen(PORT, () => {
  console.log('=================================================');
  console.log(`🚀 Object Store App is live at http://localhost:${PORT}`);
  console.log('=================================================');
});