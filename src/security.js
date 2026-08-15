const xsenv = require('@sap/xsenv');
const { XsuaaService, createSecurityContext } = require('@sap/xssec');

xsenv.loadEnv();

// Load raw service definitions for xsuaa
const rawXsuaaServices = xsenv.filterServices({ tag: 'xsuaa' });

// Create XsuaaService instances correctly using the inner credentials block
const xsuaaServices = rawXsuaaServices.map(service => {
    // xsenv bindings typically have the properties nested under service.credentials
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

    // Iterate through services to validate the incoming token
    for (const service of xsuaaServices) {
        try {
            securityContext = await createSecurityContext(service, { req });
            break; // Successfully matched audience and signature!
        } catch (err) {
            // This instance didn't match the token's audience, try the next one
        }
    }

    if (!securityContext) {
        console.error("[AUTH FAILED] Token did not match any bound XSUAA service audiences.");
        return res.status(401).json({ error: "Unauthorized: Invalid token signature or issuer." });
    }

    try {
        
        const tokenPayload = securityContext.token?.payload || {};
        const clientId = tokenPayload.client_id || '';
        const objectStoreName = process.env[clientId] || null;

        if (!objectStoreName) {
            return res.status(400).json({ 
                error: 'No Object Store Instance attribute found. Ensure you are using a user token (not client credentials) and that the role template assigns this attribute.' 
            });
        }

        req.securityContext = securityContext;
        req.instanceId = objectStoreName;
        next();
    } catch (error) {
        console.error("[AUTH FAILED] Error parsing token payload:", error.message);
        return res.status(401).json({ error: "Unauthorized: Failed to parse token payload." });
    }
};

module.exports = xsuaaAuth;