const crypto = require('crypto');

const KEY_CACHE_TTL_MS = Number(process.env.ENCRYPTION_KEY_CACHE_TTL_MS || 10 * 60 * 1000);

const MAGIC = Buffer.from('VOS-AES1:');
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;

const getKeyDestinationName = (overrides = {}) =>
  overrides.ENCRYPTION_SECRET_KEY_DESTINATION || process.env.ENCRYPTION_SECRET_KEY_DESTINATION || 'ENCRYPTION_SECRET_KEY';

const readDestinationProperty = (dest, propertyName) => {
  if (!dest) return '';
  const additional = dest.additionalProperties || dest.originalProperties || {};
  return String(additional[propertyName] || dest[propertyName] || '').trim();
};

const resolveDestinationValue = async (destinationName, propertyName) => {
  try {
    const { getDestination } = require('@sap-cloud-sdk/connectivity');
    const dest = await getDestination({ destinationName });
    const value = readDestinationProperty(dest, propertyName);
    if (value) return value;
    return null;
  } catch (err) {
    console.warn(`[CRYPTO:aes] Failed to resolve destination '${destinationName}': ${err.message}`);
    return null;
  }
};

const loadConfig = async (overrides = {}) => {
  let keyBase64 = process.env.ENCRYPTION_SECRET_KEY || '';
  let passphrase = process.env.ENCRYPTION_PASSPHRASE || '';

  const keyDestinationName = getKeyDestinationName(overrides);

  const destKeyBase64 = await resolveDestinationValue(keyDestinationName, 'keyBase64');
  if (destKeyBase64) keyBase64 = destKeyBase64;

  const destPassphrase = await resolveDestinationValue(keyDestinationName, 'passphrase');
  if (destPassphrase) passphrase = destPassphrase;

  let key = null;
  if (keyBase64) {
    key = Buffer.from(keyBase64, 'base64');
    if (key.length !== KEY_LENGTH) {
      console.warn(`[CRYPTO:aes] Configured key is ${key.length} bytes, expected ${KEY_LENGTH}. Ignoring.`);
      key = null;
    }
  }
  if (!key && passphrase) {
    key = crypto.scryptSync(passphrase, 'vos-aes-salt', KEY_LENGTH);
  }

  return {
    enabled: Boolean(key),
    key: key || null,
    derivedFromPassphrase: Boolean(!keyBase64 && passphrase),
  };
};

module.exports = {
  name: 'aes256gcm',
  cacheTtlMs: KEY_CACHE_TTL_MS,

  loadConfig,

  looksLikeOurs: (buffer) => {
    if (!buffer || buffer.length < MAGIC.length + IV_LENGTH + AUTH_TAG_LENGTH) return false;
    return buffer.subarray(0, MAGIC.length).equals(MAGIC);
  },

  encryptBuffer: async (buffer, config) => {
    try {
      const iv = crypto.randomBytes(IV_LENGTH);
      const cipher = crypto.createCipheriv('aes-256-gcm', config.key, iv);
      const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
      const authTag = cipher.getAuthTag();
      return Buffer.concat([MAGIC, iv, authTag, encrypted]);
    } catch (err) {
      throw new Error(`AES encryption failed: ${err.message}`);
    }
  },

  decryptBuffer: async (buffer, config) => {
    if (!buffer || buffer.length === 0) return buffer;

    if (!module.exports.looksLikeOurs(buffer)) {
      return buffer;
    }

    if (!config.key) {
      console.warn('[CRYPTO:aes] File is AES-encrypted but no key is configured. Serving ciphertext as-is.');
      return buffer;
    }

    try {
      const iv = buffer.subarray(MAGIC.length, MAGIC.length + IV_LENGTH);
      const authTag = buffer.subarray(MAGIC.length + IV_LENGTH, MAGIC.length + IV_LENGTH + AUTH_TAG_LENGTH);
      const ciphertext = buffer.subarray(MAGIC.length + IV_LENGTH + AUTH_TAG_LENGTH);
      const decipher = crypto.createDecipheriv('aes-256-gcm', config.key, iv);
      decipher.setAuthTag(authTag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    } catch (err) {
      throw new Error(`AES decryption failed: ${err.message}`);
    }
  },

  getStatus: (config, overrides = {}) => ({
    algorithm: 'aes256gcm',
    enabled: config.enabled,
    keyDestination: getKeyDestinationName(overrides),
    keyConfigured: Boolean(config.key),
    derivedFromPassphrase: config.derivedFromPassphrase,
  }),
};
