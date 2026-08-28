const { getMessage } = require('./i18n');

/**
 * Normalizes raw SDK errors (AWS S3, Azure Blob, GCP Storage, OpenPGP, RSA/AES) into standard error codes.
 * @param {Error|Object|string} err 
 * @returns {string} Standard Error Code
 */
function getErrorCode(err) {
  if (!err) return 'GENERIC_ERROR';
  const msg = (typeof err === 'string' ? err : err.message || err.code || '').toLowerCase();
  const statusCode = err.statusCode || err.status || 0;

  if (msg.includes('nosuchkey') || msg.includes('blobnotfound') || msg.includes('not found') || statusCode === 404) {
    return 'OBJECT_NOT_FOUND';
  }
  if (msg.includes('accessdenied') || msg.includes('authorizationpermissionmismatch') || msg.includes('forbidden') || statusCode === 403) {
    return 'ACCESS_DENIED';
  }
  if (msg.includes('decryption failed') || msg.includes('openpgp') || msg.includes('rsa') || msg.includes('aes key missing')) {
    return 'DECRYPTION_FAILED';
  }
  if (msg.includes('sourcepath') || msg.includes('destinationpath')) {
    return 'MISSING_SOURCE_DEST_PATHS';
  }

  return 'GENERIC_ERROR';
}

/**
 * Resolve request language from headers or query params
 * @param {Object} req 
 * @returns {string}
 */
function getRequestLanguage(req) {
  if (!req) return 'en';
  return req.query?.lang || req.headers?.['accept-language'] || req.headers?.['sap-language'] || req.headers?.['x-sap-language'] || 'en';
}

/**
 * Creates a structured localized error response payload
 * @param {Error|Object|string} err 
 * @param {Object} req 
 * @param {string} [fallbackCode] 
 * @returns {Object} Structured Error Payload
 */
function formatErrorResponse(err, req, fallbackCode = null) {
  const code = fallbackCode || getErrorCode(err);
  const lang = getRequestLanguage(req);
  const localizedMessage = getMessage(code, lang);

  return {
    code,
    error: localizedMessage,
    details: typeof err === 'object' && err?.message ? err.message : String(err)
  };
}

module.exports = {
  getErrorCode,
  getRequestLanguage,
  formatErrorResponse
};
