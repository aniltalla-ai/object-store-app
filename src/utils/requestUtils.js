/**
 * Request Utility Functions
 */

const normalizeRelativePath = (value) => {
  if (typeof value !== 'string') return '';
  return value.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/');
};

const getParam = (req, key) => {
  let val = req.query?.[key] ?? req.body?.[key] ?? req.params?.[key] ?? req.headers?.[key];
  if (!val) {
    key = key.toLowerCase();
    val = req.query?.[key] ?? req.body?.[key] ?? req.params?.[key] ?? req.headers?.[key];
  }
  return typeof val === 'string' ? val.trim() : '';
};

const toBinaryPayload = (req) => {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return Buffer.from(req.body);
  if (req.body && typeof req.body === 'object') {
    const fileValue = req.body.file || req.body.data || req.body.content;
    if (Buffer.isBuffer(fileValue)) return fileValue;
    if (typeof fileValue === 'string') return Buffer.from(fileValue);
  }
  return Buffer.alloc(0);
};

const ensureBinaryPayload = (req, res, next) => {
  if (Buffer.isBuffer(req.body) || (req.body && Object.keys(req.body).length > 0)) {
    return next();
  }
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    if (chunks.length > 0) {
      req.body = Buffer.concat(chunks);
    }
    next();
  });
  req.on('error', (err) => next(err));
};

module.exports = {
  normalizeRelativePath,
  getParam,
  toBinaryPayload,
  ensureBinaryPayload,
};
