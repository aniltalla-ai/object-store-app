const openpgp = require('openpgp');
const BaseStrategy = require('./baseStrategy');

const PGP_ARMOR_HEADER = '-----BEGIN PGP MESSAGE-----';
const PGP_KEY_CACHE = new Map();
const MAX_KEY_CACHE_SIZE = 50;

class PgpStrategy extends BaseStrategy {
  constructor() {
    super('pgp');
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
      } catch (e) {}
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
    const sample = buffer.subarray(0, 512).toString('utf8');
    if (sample.includes(PGP_ARMOR_HEADER)) return true;
    const firstByte = buffer[0];
    return Boolean(firstByte && (firstByte & 0x80) !== 0);
  }

  async getParsedPublicKey(armoredKey) {
    if (PGP_KEY_CACHE.has(armoredKey)) {
      return PGP_KEY_CACHE.get(armoredKey);
    }

    const key = await openpgp.readKey({ armoredKey });
    if (PGP_KEY_CACHE.size >= MAX_KEY_CACHE_SIZE) {
      const oldestKey = PGP_KEY_CACHE.keys().next().value;
      PGP_KEY_CACHE.delete(oldestKey);
    }
    PGP_KEY_CACHE.set(armoredKey, key);
    return key;
  }

  async getParsedPrivateKey(armoredKey, passphrase = null) {
    const cacheKey = `${armoredKey}:${passphrase || ''}`;
    if (PGP_KEY_CACHE.has(cacheKey)) {
      return PGP_KEY_CACHE.get(cacheKey);
    }

    let privateKey = await openpgp.readPrivateKey({ armoredKey });
    if (passphrase) {
      privateKey = await openpgp.decryptKey({ privateKey, passphrase });
    }

    if (PGP_KEY_CACHE.size >= MAX_KEY_CACHE_SIZE) {
      const oldestKey = PGP_KEY_CACHE.keys().next().value;
      PGP_KEY_CACHE.delete(oldestKey);
    }
    PGP_KEY_CACHE.set(cacheKey, privateKey);
    return privateKey;
  }

  async encrypt(buffer, config) {
    const armoredPublicKey = this.normalizeKey(config?.publicKey);
    if (!armoredPublicKey) throw new Error('PGP encryption failed: OpenPGP public key missing or invalid.');

    try {
      const encryptionKeys = await this.getParsedPublicKey(armoredPublicKey);
      const message = await openpgp.createMessage({ binary: new Uint8Array(buffer) });
      const format = config?.format === 'armored' ? 'armored' : 'binary';
      const encrypted = await openpgp.encrypt({
        message,
        encryptionKeys,
        format,
      });

      return Buffer.from(encrypted);
    } catch (err) {
      throw new Error(`PGP encryption failed: ${err.message}`);
    }
  }

  async decrypt(buffer, config) {
    if (!buffer || buffer.length === 0) return buffer;

    const armoredPrivateKey = this.normalizeKey(config?.privateKey);
    if (!armoredPrivateKey) {
      if (this.hasValidSignature(buffer)) {
        console.warn('[CRYPTO:pgp] OpenPGP ciphertext detected but private key missing. Serving payload as-is.');
      }
      return buffer;
    }

    try {
      const decryptionKeys = await this.getParsedPrivateKey(armoredPrivateKey, config?.passphrase || null);

      const isArmored = buffer.subarray(0, 512).toString('utf8').includes(PGP_ARMOR_HEADER);
      const message = isArmored
        ? await openpgp.readMessage({ armoredMessage: buffer.toString('utf8') })
        : await openpgp.readMessage({ binaryMessage: new Uint8Array(buffer) });

      const decrypted = await openpgp.decrypt({
        message,
        decryptionKeys,
        format: 'binary',
      });

      return Buffer.from(decrypted.data);
    } catch (err) {
      if (!this.hasValidSignature(buffer)) {
        console.warn('[CRYPTO:pgp] Payload does not match OpenPGP format. Serving payload as-is.');
        return buffer;
      }
      throw new Error(`PGP decryption failed: ${err.message}`);
    }
  }
}

module.exports = PgpStrategy;
