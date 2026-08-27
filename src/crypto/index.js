const { getDestination } = require('@sap-cloud-sdk/connectivity');

const registry = {
  pgp: require('./pgpStrategy'),
  aes256gcm: require('./aesStrategy'),
  rsa: require('./rsaStrategy'),
};

const readDestinationProperty = (dest, propertyName) => {
  if (!dest) return null;
  const additional = dest.additionalProperties || dest.originalProperties || {};
  return String(additional[propertyName] || dest[propertyName] || '').trim() || null;
};

const getDestinationConfig = async (destination) => {
  try {
    const dest = await getDestination({ destination });
    return {
      publicKey: readDestinationProperty(dest, 'ENCRYPTION_PUBLIC_KEY'),
      privateKey: readDestinationProperty(dest, 'ENCRYPTION_PRIVATE_KEY'),
      passphrase: readDestinationProperty(dest, 'ENCRYPTION_PASSPHRASE'),
      algorithm: readDestinationProperty(dest, 'ENCRYPTION_ALGORITHM') || 'pgp',
      format: readDestinationProperty(dest, 'ENCRYPTION_FORMAT') || 'binary',
    };
  } catch (err) {
    console.warn(`[CRYPTO:pgp] Failed to resolve destination '${destination}': ${err.message}`);
    return null;
  }
}

const getActiveStrategy = (algorithm) => {
  const strategy = registry[algorithm];
  if (!strategy) {
    throw new Error(`Unknown ENCRYPTION_ALGORITHM '${config.algorithm}'. Available: ${Object.keys(registry).join(', ')}`);
  }
  return strategy;
};

const cache = new Map();

const getConfig = async (destination = null) => {
  if (!destination) {
    throw new Error("Destination is required.");
  }
  const cached = cache.get(destination);
  const ttl = cached.cacheTtlMs || 10 * 60 * 1000;
  if (cached && Date.now() - cached.fetchedAt < ttl) return cached.config;
  const config = await getDestinationConfig(destination);
  if (!config) return null;
  const strategy = getActiveStrategy(config.algorithm);
  config.enabled = config.publicKey && config.privateKey && config.format && config.algorithm && config.passphrase && strategy;
  cache.set(destination, { fetchedAt: Date.now(), cacheTtlMs: strategy.cacheTtlMs, config });
  return config;
};

const encryptBuffer = async (buffer, destination = null) => {
  const config = await getConfig(destination);
  if (!config.enabled) return buffer;
  const strategy = getActiveStrategy(config.algorithm);
  return strategy.encryptBuffer(buffer, config);
};

const decryptBuffer = async (buffer, destination = null) => {
  const config = await getConfig(destination);
  if (!config.enabled) return buffer;
  const strategy = getActiveStrategy(config.algorithm);
  return strategy.decryptBuffer(buffer, config);
};

const isActive = async (destination = null) => {
  const config = await getConfig(destination);
  return Boolean(config.enabled);
};

const getStatus = async (destination = null) => {
  const config = await getConfig(destination);
  const strategy = getActiveStrategy(config.algorithm);
  return {
    ...strategy.getStatus(config, config),
    availableAlgorithms: Object.keys(registry),
  };
};

module.exports = {
  encryptBuffer,
  decryptBuffer,
  getStatus,
  isActive,
};
