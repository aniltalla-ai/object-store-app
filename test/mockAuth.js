const mockAuthMiddleware = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing test Bearer token format.' });
  }

  const tokenValue = authHeader.split(' ')[1];

  try {
    let mockUser;
    if (tokenValue.includes('.')) {
      const parts = tokenValue.split('.');
      mockUser = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
    } else {
      mockUser = JSON.parse(Buffer.from(tokenValue, 'base64').toString('utf8'));
    }

    const inst = mockUser.object_store_instance || mockUser.instance;

    req.user = {
      id: mockUser.user || mockUser.sub || 'TEST_MOCK_USER',
      attr: {
        object_store_instance: inst ? [inst] : []
      }
    };
    return next();
  } catch (e) {
    return res.status(401).json({ error: 'Unauthorized: Invalid test OAuth token payload.' });
  }
};

module.exports = mockAuthMiddleware;
