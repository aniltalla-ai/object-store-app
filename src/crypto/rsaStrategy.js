const crypto = require('crypto');

const KEY_CACHE_TTL_MS = Number(process.env.ENCRYPTION_KEY_CACHE_TTL_MS || 10 * 60 * 1000);

const MAGIC = Buffer.from('VOS-RSA1:');
const LENGTH_PREFIX_BYTES = 2;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const SESSION_KEY_LENGTH = 32;
const OAEP_HASH = 'sha256';

const getDestinationNames = (overrides = {}) => ({
  publicKey: overrides.ENCRYPTION_PUBLIC_KEY_DESTINATION || process.env.ENCRYPTION_PUBLIC_KEY_DESTINATION || 'ENCRYPTION_PUBLIC_KEY',
  privateKey: overrides.ENCRYPTION_PRIVATE_KEY_DESTINATION || process.env.ENCRYPTION_PRIVATE_KEY_DESTINATION || 'ENCRYPTION_PRIVATE_KEY',
});

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
    console.warn(`[CRYPTO:rsa] Destination '${destinationName}' found but property '${propertyName}' is empty.`);
    return null;
  } catch (err) {
    console.warn(`[CRYPTO:rsa] Failed to resolve destination '${destinationName}': ${err.message}`);
    return null;
  }
};

const loadConfig = async (overrides = {}) => {
  const destinationNames = getDestinationNames(overrides);

  let publicKey = process.env.ENCRYPTION_PUBLIC_KEY || '';
  let privateKeyPem = process.env.ENCRYPTION_PRIVATE_KEY || '';
  let passphrase = process.env.ENCRYPTION_PASSPHRASE || '';

  const destPublicKey = await resolveDestinationValue(destinationNames.publicKey, 'publicKey');
  if (destPublicKey) publicKey = destPublicKey;

  const destPrivateKey = await resolveDestinationValue(destinationNames.privateKey, 'privateKey');
  if (destPrivateKey) privateKeyPem = destPrivateKey;

  const destPassphrase = await resolveDestinationValue(destinationNames.privateKey, 'passphrase');
  if (destPassphrase) passphrase = destPassphrase;

  return {
    enabled: Boolean(publicKey),
    publicKey: publicKey || null,
    privateKeyPem: privateKeyPem || null,
    passphrase: passphrase || null,
  };
};

module.exports = {
  name: 'rsa',
  cacheTtlMs: KEY_CACHE_TTL_MS,

  loadConfig,

  looksLikeOurs: (buffer) => {
    if (!buffer || buffer.length < MAGIC.length + LENGTH_PREFIX_BYTES) return false;
    return buffer.subarray(0, MAGIC.length).equals(MAGIC);
  },

  encryptBuffer: async (buffer, config) => {
    try {
      const sessionKey = crypto.randomBytes(SESSION_KEY_LENGTH);
      const iv = crypto.randomBytes(IV_LENGTH);

      const cipher = crypto.createCipheriv('aes-256-gcm', sessionKey, iv);
      const ciphertext = Buffer.concat([cipher.update(buffer), cipher.final()]);
      const authTag = cipher.getAuthTag();

      const encryptedSessionKey = crypto.publicEncrypt(
        {
          key: config.publicKey,
          padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
          oaepHash: OAEP_HASH,
        },
        sessionKey,
      );

      const lengthPrefix = Buffer.alloc(LENGTH_PREFIX_BYTES);
      lengthPrefix.writeUInt16BE(encryptedSessionKey.length, 0);

      return Buffer.concat([MAGIC, lengthPrefix, encryptedSessionKey, iv, authTag, ciphertext]);
    } catch (err) {
      throw new Error(`RSA encryption failed: ${err.message}`);
    }
  },

  decryptBuffer: async (buffer, config) => {
    if (!buffer || buffer.length === 0) return buffer;

    if (!module.exports.looksLikeOurs(buffer)) {
      return buffer;
    }

    if (!config.privateKeyPem) {
      console.warn('[CRYPTO:rsa] File is RSA-encrypted but no private key is configured. Serving ciphertext as-is.');
      return buffer;
    }

    try {
      let offset = MAGIC.length;
      const encKeyLength = buffer.readUInt16BE(offset);
      offset += LENGTH_PREFIX_BYTES;

      const encryptedSessionKey = buffer.subarray(offset, offset + encKeyLength);
      offset += encKeyLength;

      const iv = buffer.subarray(offset, offset + IV_LENGTH);
      offset += IV_LENGTH;

      const authTag = buffer.subarray(offset, offset + AUTH_TAG_LENGTH);
      offset += AUTH_TAG_LENGTH;

      const ciphertext = buffer.subarray(offset);

      const decryptionOptions = {
        key: config.privateKeyPem,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: OAEP_HASH,
      };
      if (config.passphrase) decryptionOptions.passphrase = config.passphrase;

      const sessionKey = crypto.privateDecrypt(decryptionOptions, encryptedSessionKey);

      const decipher = crypto.createDecipheriv('aes-256-gcm', sessionKey, iv);
      decipher.setAuthTag(authTag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    } catch (err) {
      throw new Error(`RSA decryption failed: ${err.message}`);
    }
  },

  getStatus: (config, overrides = {}) => {
    const destinationNames = getDestinationNames(overrides);
    return {
      algorithm: 'rsa',
      enabled: config.enabled,
      publicKeyDestination: destinationNames.publicKey,
      privateKeyDestination: destinationNames.privateKey,
      publicKeyConfigured: Boolean(config.publicKey),
      privateKeyConfigured: Boolean(config.privateKeyPem),
      mode: 'hybrid (RSA-OAEP-SHA256 wrapped AES-256-GCM session key)',
    };
  },
};
