const passport = require('passport');
const xsenv = require('@sap/xsenv');
const { JWTStrategy } = require('@sap/xssec');

try {
  const xsuaaServices = xsenv.getServices({ uaa: { tag: 'xsuaa' } });
  passport.use(new JWTStrategy(xsuaaServices.uaa));
} catch (err) {
  console.log(`XSUAA Setup Warning: ${err.message}`);
}

const passportJwtAuth = passport.authenticate('JWT', { session: false });

const xsuaaAuth = (req, res, next) => {
  return passportJwtAuth(req, res, (err) => {
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
