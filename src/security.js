const xsenv = require('@sap/xsenv');
const { XsuaaService, createSecurityContext } = require('@sap/xssec');

xsenv.loadEnv();

const rawXsuaaServices = xsenv.filterServices({ tag: 'xsuaa' });

const xsuaaServices = rawXsuaaServices.map(service => {
  const serviceCreds = service.credentials || service;
  return new XsuaaService(serviceCreds);
});

if (xsuaaServices.length === 0) {
  console.error("No XSUAA services found bound to this application!");
}

const { formatErrorResponse } = require('./utils/errorNormalizer');

const xsuaaAuth = async (req, res, next) => {
  if (xsuaaServices.length === 0) {
    return res.status(500).json(formatErrorResponse('Server misconfigured: No XSUAA bindings found.', req, 'UNAUTHORIZED_NO_XSUAA'));
  }

  let securityContext = null;

  for (const service of xsuaaServices) {
    try {
      securityContext = await createSecurityContext(service, { req });
      break;
    } catch (err) {
    }
  }

  if (!securityContext) {
    console.error("[AUTH FAILED] Token did not match any bound XSUAA service audiences.");
    return res.status(401).json(formatErrorResponse('Unauthorized: Invalid token signature or issuer.', req, 'UNAUTHORIZED_INVALID_TOKEN'));
  }

  try {
    const tokenPayload = securityContext.token?.payload || {};
    const clientId = tokenPayload.client_id || '';
    const appName = clientId.replace('sb-', '') + '.';
    const config = {};
    tokenPayload.authorities.forEach(authority => {
      if (authority.startsWith(appName)) {
        const [key, value] = authority.replace(appName, '').split(':');
        config[key] = value;
      }
    });
    const objectStoreName = config['OS'];

    if (!objectStoreName) {
      return res.status(400).json(formatErrorResponse(
        'No Object Store Instance attribute found.',
        req,
        'MISSING_OBJECT_STORE'
      ));
    }

    req.securityContext = securityContext;
    req.instanceId = objectStoreName;
    const serviceInfo = xsenv.getServices({
      objectStore: { name: objectStoreName }
    });

    const credentials = serviceInfo.objectStore;
    req.credentials = credentials;
    req.cryptoDestination = config['DEST'] || req.query?.cryptoDestination || req.query?.destination || req.headers?.['x-crypto-destination'] || req.headers?.['destination'] || null;
    next();
  } catch (error) {
    console.error("[AUTH FAILED] Error parsing token payload:", error.message);
    return res.status(401).json(formatErrorResponse(error, req, 'TOKEN_PARSE_ERROR'));
  }
};

module.exports = xsuaaAuth;