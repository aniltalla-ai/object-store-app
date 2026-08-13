const passport = require('passport');
const xsenv = require('@sap/xsenv');
const { JWTStrategy } = require('@sap/xssec');

let xsuaaServices;
try {
  xsuaaServices = xsenv.getServices({ xsuaa: { tag: 'xsuaa' } });
} catch (e) {
  try {
    xsuaaServices = xsenv.getServices({ xsuaa: { name: 'object-store-uaa' } });
  } catch (err) {
    xsuaaServices = { xsuaa: {} };
  }
}

if (xsuaaServices && xsuaaServices.xsuaa && Object.keys(xsuaaServices.xsuaa).length > 0) {
  passport.use(new JWTStrategy(xsuaaServices.xsuaa));
}

const passportJwtAuth = passport.authenticate('JWT', { session: false });

const xsuaaAuth = (req, res, next) => {
  if (xsuaaServices && xsuaaServices.xsuaa && Object.keys(xsuaaServices.xsuaa).length > 0) {
    return passportJwtAuth(req, res, (err) => {
      if (err || !req.user) {
        return res.status(401).json({ error: 'Unauthorized: Invalid XSUAA JWT token.' });
      }

      const authInfo = req.authInfo;
      const rawInst = authInfo?.getAttribute?.('object_store_instance') || req.user?.attr?.object_store_instance;
      const storeInstance = Array.isArray(rawInst) ? rawInst[0] : rawInst;

      req.user = {
        id: authInfo?.getLogonName?.() || req.user?.id || req.user?.user_name || 'AUTHENTICATED_USER',
        attr: {
          object_store_instance: storeInstance ? [storeInstance] : []
        }
      };
      next();
    });
  }

  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing Authorization header or invalid Bearer token.' });
  }

  const tokenValue = authHeader.split(' ')[1];
  try {
    let payload;
    if (tokenValue.includes('.')) {
      const parts = tokenValue.split('.');
      payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
    } else {
      payload = JSON.parse(Buffer.from(tokenValue, 'base64').toString('utf8'));
    }

    const storeInstance = payload.object_store_instance || payload.instance || (payload.attr && payload.attr.object_store_instance?.[0]);

    req.user = {
      id: payload.user || payload.sub || payload.user_name || 'AUTHENTICATED_USER',
      attr: {
        object_store_instance: storeInstance ? [storeInstance] : []
      }
    };
    return next();
  } catch (e) {
    return res.status(401).json({ error: 'Unauthorized: Invalid authentication token structure.' });
  }
};

module.exports = xsuaaAuth;
