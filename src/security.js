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

const xsuaaAuth = async (req, res, next) => {
  if (xsuaaServices.length === 0) {
    return res.status(500).json({ error: "Server misconfigured: No XSUAA bindings found." });
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
    return res.status(401).json({ error: "Unauthorized: Invalid token signature or issuer." });
  }

  try {
    const tokenPayload = securityContext.token?.payload || {};
    const clientId = tokenPayload.client_id || '';
    const appName = clientId.replace('sb-', '') + '.';
    const objectStoreName = tokenPayload.authorities
      .find(a => a.startsWith(appName))
      ?.replace(appName, '');

    if (!objectStoreName) {
      return res.status(400).json({
        error: 'No Object Store Instance attribute found. Ensure you are using a user token (not client credentials) and that the role template assigns this attribute.'
      });
    }

    req.securityContext = securityContext;
    req.instanceId = objectStoreName;
    const serviceInfo = xsenv.getServices({
      objectStore: { name: objectStoreName }
    });

    // Access the credentials object
    const credentials = serviceInfo.objectStore;
    req.credentials = credentials;

    next();
  } catch (error) {
    console.error("[AUTH FAILED] Error parsing token payload:", error.message);
    return res.status(401).json({ error: "Unauthorized: Failed to parse token payload." });
  }
};

module.exports = xsuaaAuth;