const crypto = require('crypto');
const BaseStrategy = require('./baseStrategy');

const HEADER_SIGNATURE = Buffer.from('VOS-RSA1:');
const LENGTH_PREFIX_BYTES = 2;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const SESSION_KEY_LENGTH = 32;
const OAEP_HASH = 'sha256';
const RSA_ARMOR_HEADER = '-----BEGIN RSA ENCRYPTED MESSAGE-----';
const RSA_ARMOR_FOOTER = '-----END RSA ENCRYPTED MESSAGE-----';

class RsaStrategy extends BaseStrategy {
  constructor() {
    super('rsa');
  }

  normalizeKey(keyInput) {
    if (!keyInput) return null;
    let keyStr = String(keyInput).trim();
    if (!keyStr.includes('-----BEGIN') && keyStr.length % 4 === 0 && /^[A-Za-z0-9+/=\s]+$/.test(keyStr)) {
      try {
        const decoded = Buffer.from(keyStr, 'base64').toString('utf8').trim();
        if (decoded.includes('-----BEGIN')) {
          keyStr = decoded;
        }
      } catch (e) { }
    }
    return keyStr.includes('-----BEGIN') ? keyStr : null;
  }

  isEnabled(config) {
    const pubKey = this.normalizeKey(config?.publicKey);
    const privKey = this.normalizeKey(config?.privateKey);
    return Boolean(pubKey || privKey);
  }

  hasValidSignature(buffer) {
    if (!buffer || buffer.length === 0) return false;
    if (buffer.length >= HEADER_SIGNATURE.length + LENGTH_PREFIX_BYTES && buffer.subarray(0, HEADER_SIGNATURE.length).equals(HEADER_SIGNATURE)) {
      return true;
    }
    const sample = buffer.subarray(0, 256).toString('utf8');
    return sample.includes(RSA_ARMOR_HEADER);
  }

  async encrypt(buffer, config) {
    const publicKeyPem = this.normalizeKey(config?.publicKey);
    if (!publicKeyPem) throw new Error('RSA encryption failed: Public key missing or invalid.');

    try {
      const sessionKey = crypto.randomBytes(SESSION_KEY_LENGTH);
      const iv = crypto.randomBytes(IV_LENGTH);

      const cipher = crypto.createCipheriv('aes-256-gcm', sessionKey, iv);
      const ciphertext = Buffer.concat([cipher.update(buffer), cipher.final()]);
      const authTag = cipher.getAuthTag();

      const encryptedSessionKey = crypto.publicEncrypt(
        {
          key: publicKeyPem,
          padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
          oaepHash: OAEP_HASH,
        },
        sessionKey,
      );

      const lengthPrefix = Buffer.alloc(LENGTH_PREFIX_BYTES);
      lengthPrefix.writeUInt16BE(encryptedSessionKey.length, 0);

      const binaryPayload = Buffer.concat([HEADER_SIGNATURE, lengthPrefix, encryptedSessionKey, iv, authTag, ciphertext]);

      if (config?.format === 'armored') {
        const b64 = binaryPayload.toString('base64');
        return Buffer.from(`${RSA_ARMOR_HEADER}\n${b64}\n${RSA_ARMOR_FOOTER}\n`, 'utf8');
      }

      return binaryPayload;
    } catch (err) {
      throw new Error(`RSA encryption failed: ${err.message}`);
    }
  }

  async decrypt(buffer, config) {
    if (!buffer || buffer.length === 0) return buffer;

    let targetBuffer = buffer;
    const sample = buffer.subarray(0, 256).toString('utf8');
    if (sample.includes(RSA_ARMOR_HEADER)) {
      try {
        const cleanB64 = buffer.toString('utf8')
          .replace(RSA_ARMOR_HEADER, '')
          .replace(RSA_ARMOR_FOOTER, '')
          .replace(/\s+/g, '');
        targetBuffer = Buffer.from(cleanB64, 'base64');
      } catch (e) {
        return buffer;
      }
    }

    if (!this.hasValidSignature(targetBuffer)) {
      return buffer;
    }

    const privateKeyPem = this.normalizeKey(config?.privateKey || config?.privateKeyPem);
    if (!privateKeyPem) {
      console.warn('[CRYPTO:rsa] RSA ciphertext detected but private key missing. Serving payload as-is.');
      return buffer;
    }

    try {
      let offset = HEADER_SIGNATURE.length;
      const encKeyLength = targetBuffer.readUInt16BE(offset);
      offset += LENGTH_PREFIX_BYTES;

      const encryptedSessionKey = targetBuffer.subarray(offset, offset + encKeyLength);
      offset += encKeyLength;

      const iv = targetBuffer.subarray(offset, offset + IV_LENGTH);
      offset += IV_LENGTH;

      const authTag = targetBuffer.subarray(offset, offset + AUTH_TAG_LENGTH);
      offset += AUTH_TAG_LENGTH;

      const ciphertext = targetBuffer.subarray(offset);

      const decryptionOptions = {
        key: privateKeyPem,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: OAEP_HASH,
      };
      if (config?.passphrase) decryptionOptions.passphrase = config.passphrase;

      const sessionKey = crypto.privateDecrypt(decryptionOptions, encryptedSessionKey);

      const decipher = crypto.createDecipheriv('aes-256-gcm', sessionKey, iv);
      decipher.setAuthTag(authTag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    } catch (err) {
      throw new Error(`RSA decryption failed: ${err.message}`);
    }
  }
}

module.exports = RsaStrategy;
