const passport = require('passport');
const xsenv = require('@sap/xsenv');
const { XssecPassportStrategy, XsuaaService, SECURITY_CONTEXT } = require('@sap/xssec');
/*
const strategyNames = [];

try {
  // const xsuaaServices = xsenv.readServices().xsuaa || [];
  const xsuaaServices = xsenv.filterServices({ tag: 'xsuaa' });

  if (xsuaaServices.length === 0) {
    console.error("No XSUAA services found bound to this application!");
  }
  else {
    xsuaaServices.forEach((uaaService, index) => {
      console.log(`Setting up XSUAA Passport Strategy for service: ${index}`);
      const strategyName = `JWT_${index}`;
      strategyNames.push(strategyName);
      passport.use(strategyName, new JWTStrategy(uaaService));
    });
  }
} catch (err) {
  console.log(`XSUAA Setup Warning: ${err.message}`);
}

// const passportJwtAuth = passport.authenticate('JWT', { session: false });

// 2. Create middleware that loops through all registered strategies
const multiStrategyAuth = (req, res, next) => {
    console.log(`Authentication Process Start`);
    if (strategyNames.length === 0) {
        return res.status(500).json({ error: "No XSUAA strategies configured." });
    }

    let currentIndex = 0;

    const tryNext = () => {
        if (currentIndex >= strategyNames.length) {
            // Checked all XSUAA instances and none matched the token
            return res.status(401).json({ error: "Unauthorized: Invalid XSUAA JWT token across all instances." });
        }

        const currentStrategy = strategyNames[currentIndex];
        currentIndex++;
        console.log(`Strategy: ${currentStrategy}`)
        passport.authenticate(currentStrategy, { session: false }, (err, user, info) => {
            if (err || !user) {
                // This instance failed, try the next one
                return tryNext();
            }
            // Success! Attach the validated user/authInfo and move to your route handler
            req.authInfo = user;
            next();
        })(req, res, next);
    };

    tryNext();
};
*/

// 1. Load all bound XSUAA services and wrap them in XsuaaService instances
const rawXsuaaServices = xsenv.filterServices({ tag: 'xsuaa' });
const xsuaaServices = rawXsuaaServices.map(service => new XsuaaService(service));

if (xsuaaServices.length === 0) {
    console.error("No XSUAA services found bound to this application!");
}

// 2. Create a clean validation middleware
const dynamicAuthMiddleware = async (req, res, next) => {
    if (xsuaaServices.length === 0) {
        return res.status(500).json({ error: "Server misconfigured: No XSUAA bindings found." });
    }

    try {
        // Pass the ENTIRE array of XSUAA services. 
        // xssec will automatically try validating the request against all of them.
        const securityContext = await createSecurityContext(xsuaaServices, { req });
        
        // Attach the validated security context to the request object
        req.securityContext = securityContext;
        next();
    } catch (error) {
        console.error("[AUTH FAILED] Token validation error:", error.message);
        return res.status(401).json({ error: "Unauthorized: Invalid token signature or issuer." });
    }
};

const xsuaaAuth = (req, res, next) => {
  return dynamicAuthMiddleware(req, res, (err) => {
    if (err || !req.user) {
      return res.status(401).json({ error: 'Unauthorized: Invalid XSUAA JWT token.' });
    }

    const authInfo = req.authInfo;
    const tokenPayload = authInfo?.getTokenInfo?.()?.getPayload?.() || {};
    const userAttributes = tokenPayload['xs.user_attributes'] || tokenPayload.user_attributes;
    const objectStoreName = userAttributes?.object_store_instance?.[0] || null;

    if (!objectStoreName) {
      return res.status(400).json({ error: 'No Object Store Instance is bound to the user.' });
    }

    req.instanceId = objectStoreName;
    next();
  });
};

module.exports = xsuaaAuth;
