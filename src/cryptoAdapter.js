const destinationAdapter = require('./destinationAdapter');
const PgpStrategy = require('./strategies/pgpStrategy');
const RsaStrategy = require('./strategies/rsaStrategy');
const AesStrategy = require('./strategies/aesStrategy');

const DEFAULT_CACHE_DURATION_MS = 10 * 60 * 1000; // 10 minutes
const MAX_CONFIG_CACHE_SIZE = 200;

class CryptoAdapter {
  constructor() {
    this.strategies = Object.freeze({
      pgp: new PgpStrategy(),
      rsa: new RsaStrategy(),
      aes: new AesStrategy(),
    });
    this.cache = new Map();
    this.cacheDurationMs = DEFAULT_CACHE_DURATION_MS;
  }

  async getDestinationConfig(destinationName) {
    if (!destinationName) return null;
    try {
      const props = await destinationAdapter.getProperties(destinationName, true);
      if (!props || Object.keys(props).length === 0) return null;

      const algorithm = props.ENCRYPTION_ALGORITHM ? String(props.ENCRYPTION_ALGORITHM).trim().toLowerCase() : null;

      const rawFormat = String(props.ENCRYPTION_FORMAT || 'binary').trim().toLowerCase();
      const format = ['armored', 'ascii', 'base64'].includes(rawFormat) ? 'armored' : 'binary';

      const config = {
        destinationName,
        algorithm,
        publicKey: props.ENCRYPTION_PUBLIC_KEY,
        privateKey: props.ENCRYPTION_PRIVATE_KEY,
        passphrase: props.ENCRYPTION_PASSPHRASE,
        format,
      };

      config.enabled = await this.isEnabled(config);

      return config;
    } catch (err) {
      console.warn(`[CRYPTO] Failed to resolve destination '${destinationName}': ${err.message}`);
      return null;
    }
  }

  async isEnabled(config) {
    if (!config || !config.algorithm) return false;
    const strategy = this.strategies[config.algorithm];
    if (!strategy) return false;

    if (typeof strategy.isEnabled === 'function' && !strategy.isEnabled(config)) {
      return false;
    }

    try {
      const testBuffer = Buffer.from('vos-key-validation-test');
      const encrypted = await strategy.encrypt(testBuffer, config);
      const decrypted = await strategy.decrypt(encrypted, config);
      return Boolean(decrypted && decrypted.equals(testBuffer));
    } catch (err) {
      console.warn(`[CRYPTO:${config.algorithm}] Key validation failed for destination '${config.destinationName}': ${err.message}`);
      return false;
    }
  }

  detectEncryption(metadata = null) {
    const isEncrypted = Boolean(metadata?.isencrypted === 'true' || metadata?.isEncrypted === 'true');
    const algorithm = isEncrypted ? (metadata?.encryptionalgorithm || metadata?.encryptionAlgorithm || null) : null;

    return {
      isEncrypted,
      algorithm,
    };
  }

  async getConfig(destinationName) {
    if (!destinationName) return null;
    const cached = this.cache.get(destinationName);
    if (cached && Date.now() - cached.fetchedAt < this.cacheDurationMs) {
      return cached.config;
    }

    const config = await this.getDestinationConfig(destinationName);
    if (config) {
      if (this.cache.size >= MAX_CONFIG_CACHE_SIZE) {
        const oldestKey = this.cache.keys().next().value;
        this.cache.delete(oldestKey);
      }
      this.cache.set(destinationName, { fetchedAt: Date.now(), config });
    }
    return config;
  }

  async isActive(destinationName) {
    if (!destinationName) return false;
    const config = await this.getConfig(destinationName);
    return Boolean(config && config.enabled);
  }

  async encrypt(buffer, destinationName) {
    if (!buffer || buffer.length === 0) return buffer;
    if (!destinationName) return buffer;

    const config = await this.getConfig(destinationName);
    if (!config || !config.enabled) return buffer;

    const strategy = this.strategies[config.algorithm];
    if (!strategy) {
      throw new Error(`Unsupported ENCRYPTION_ALGORITHM '${config.algorithm}' for encryption. Available: pgp, rsa, aes`);
    }

    return strategy.encrypt(buffer, config);
  }

  async decrypt(buffer, destinationName) {
    if (!buffer || buffer.length === 0) return buffer;
    if (!destinationName) return buffer;

    const config = await this.getConfig(destinationName);
    if (!config || !config.enabled) return buffer;

    const strategy = this.strategies[config.algorithm];
    if (!strategy) {
      return buffer;
    }

    return strategy.decrypt(buffer, config);
  }
}

const instance = new CryptoAdapter();

module.exports = {
  CryptoAdapter,
  encrypt: (buffer, dest) => instance.encrypt(buffer, dest),
  decrypt: (buffer, dest) => instance.decrypt(buffer, dest),
  isActive: (dest) => instance.isActive(dest),
  getConfig: (dest) => instance.getConfig(dest),
  detectEncryption: (buffer, metadata) => instance.detectEncryption(buffer, metadata),
  instance,
};

