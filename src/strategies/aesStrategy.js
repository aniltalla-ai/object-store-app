const crypto = require('crypto');
const BaseStrategy = require('./baseStrategy');

const HEADER_SIGNATURE = Buffer.from('VOS-AES1:');
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const AES_SALT = 'vos-aes-salt';

const AES_ARMOR_HEADER = '-----BEGIN AES ENCRYPTED MESSAGE-----';
const AES_ARMOR_FOOTER = '-----END AES ENCRYPTED MESSAGE-----';
const BASE64_PATTERN = /^[A-Za-z0-9+/=]+$/;

const derivedKeyCache = new Map();
const MAX_CACHE_SIZE = 100;

class AesStrategy extends BaseStrategy {
  constructor() {
    super('aes');
  }

  /**
   * Derive or parse 256-bit AES key from privateKey (base64 or string) or passphrase
   */
  resolveKey(config) {
    if (!config) return null;

    const rawKey = config.privateKey;
    if (rawKey) {
      let key;
      if (Buffer.isBuffer(rawKey)) {
        key = rawKey;
      } else if (typeof rawKey === 'string') {
        const trimmed = rawKey.trim();
        const isB64 = trimmed.length % 4 === 0 && BASE64_PATTERN.test(trimmed);
        key = Buffer.from(trimmed, isB64 ? 'base64' : 'utf8');
      }

      if (key && key.length !== KEY_LENGTH) {
        key = crypto.createHash('sha256').update(key).digest();
      }
      return key;
    }

    if (config.passphrase) {
      const cacheKey = config.passphrase;
      if (derivedKeyCache.has(cacheKey)) {
        return derivedKeyCache.get(cacheKey);
      }

      const derivedKey = crypto.scryptSync(config.passphrase, AES_SALT, KEY_LENGTH);

      if (derivedKeyCache.size >= MAX_CACHE_SIZE) {
        const oldestKey = derivedKeyCache.keys().next().value;
        derivedKeyCache.delete(oldestKey);
      }
      derivedKeyCache.set(cacheKey, derivedKey);
      return derivedKey;
    }

    return null;
  }

  isEnabled(config) {
    return Boolean(this.resolveKey(config));
  }

  hasValidSignature(buffer) {
    if (!buffer || buffer.length === 0) return false;
    if (buffer.length >= HEADER_SIGNATURE.length + IV_LENGTH + AUTH_TAG_LENGTH && buffer.subarray(0, HEADER_SIGNATURE.length).equals(HEADER_SIGNATURE)) {
      return true;
    }
    const sample = buffer.subarray(0, 256).toString('utf8');
    return sample.includes(AES_ARMOR_HEADER);
  }

  async encrypt(buffer, config) {
    const key = this.resolveKey(config);
    if (!key) throw new Error('AES encryption failed: Key (ENCRYPTION_PRIVATE_KEY) or ENCRYPTION_PASSPHRASE missing.');

    try {
      const iv = crypto.randomBytes(IV_LENGTH);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
      const authTag = cipher.getAuthTag();
      const binaryPayload = Buffer.concat([HEADER_SIGNATURE, iv, authTag, encrypted]);

      if (config?.format === 'armored') {
        const b64 = binaryPayload.toString('base64');
        return Buffer.from(`${AES_ARMOR_HEADER}\n${b64}\n${AES_ARMOR_FOOTER}\n`, 'utf8');
      }

      return binaryPayload;
    } catch (err) {
      throw new Error(`AES encryption failed: ${err.message}`);
    }
  }

  async decrypt(buffer, config) {
    if (!buffer || buffer.length === 0) return buffer;

    let targetBuffer = buffer;
    const sample = buffer.subarray(0, 256).toString('utf8');
    if (sample.includes(AES_ARMOR_HEADER)) {
      try {
        const cleanB64 = buffer.toString('utf8')
          .replace(AES_ARMOR_HEADER, '')
          .replace(AES_ARMOR_FOOTER, '')
          .replace(/\s+/g, '');
        targetBuffer = Buffer.from(cleanB64, 'base64');
      } catch (e) {
        return buffer;
      }
    }

    if (!this.hasValidSignature(targetBuffer)) {
      return buffer;
    }

    const key = this.resolveKey(config);
    if (!key) {
      console.warn('[CRYPTO:aes] AES ciphertext detected but ENCRYPTION_PRIVATE_KEY missing. Serving ciphertext as-is.');
      return buffer;
    }

    try {
      const iv = targetBuffer.subarray(HEADER_SIGNATURE.length, HEADER_SIGNATURE.length + IV_LENGTH);
      const authTag = targetBuffer.subarray(HEADER_SIGNATURE.length + IV_LENGTH, HEADER_SIGNATURE.length + IV_LENGTH + AUTH_TAG_LENGTH);
      const ciphertext = targetBuffer.subarray(HEADER_SIGNATURE.length + IV_LENGTH + AUTH_TAG_LENGTH);

      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(authTag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    } catch (err) {
      throw new Error(`AES decryption failed: ${err.message}`);
    }
  }
}

module.exports = AesStrategy;
