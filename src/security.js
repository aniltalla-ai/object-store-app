const passport = require('passport');

const authMiddleware = (req, res, next) => {
  if (process.env.MOCK_LOCAL_STORAGE === 'true' || process.env.NODE_ENV !== 'production') {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized: Missing local Bearer token format.' });
    }

    const tokenValue = authHeader.split(' ')[1];

    try {
      const mockUser = JSON.parse(Buffer.from(tokenValue, 'base64').toString());
      req.user = {
        id: mockUser.user || 'MOCK_USER',
        attr: {
          abap_instance: mockUser.abap_instance ? [mockUser.abap_instance] : []
        }
      };
      return next();
    } catch (e) {
      return res.status(401).json({ error: 'Unauthorized: Invalid base64 mock OAuth token payload structure.' });
    }
  }

  return res.status(401).json({ error: 'Unauthorized: production auth is not configured in this standalone app.' });
};

module.exports = authMiddleware;
