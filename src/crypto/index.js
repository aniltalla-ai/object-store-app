const registry = {
  pgp: require('./pgpStrategy'),
  aes256gcm: require('./aesStrategy'),
  rsa: require('./rsaStrategy'),
};

const getActiveStrategy = (overrides = {}) => {
  const requested =
    overrides.ENCRYPTION_ALGORITHM ||
    process.env.ENCRYPTION_ALGORITHM ||
    'pgp';

  const strategy = registry[requested];
  if (!strategy) {
    throw new Error(`Unknown ENCRYPTION_ALGORITHM '${requested}'. Available: ${Object.keys(registry).join(', ')}`);
  }
  return strategy;
};

const cache = new Map();

const buildCacheKey = (overrides) => JSON.stringify(overrides, Object.keys(overrides).sort());

const getConfig = async (strategy, overrides) => {
  const key = `${strategy.name}:${buildCacheKey(overrides)}`;
  const cached = cache.get(key);
  const ttl = strategy.cacheTtlMs || 10 * 60 * 1000;
  if (cached && Date.now() - cached.fetchedAt < ttl) return cached.config;

  const config = await strategy.loadConfig(overrides);
  cache.set(key, { fetchedAt: Date.now(), config });
  return config;
};

const encryptBuffer = async (buffer, overrides = {}) => {
  const strategy = getActiveStrategy(overrides);
  const config = await getConfig(strategy, overrides);
  if (!config.enabled) return buffer;
  return strategy.encryptBuffer(buffer, config, overrides);
};

const decryptBuffer = async (buffer, overrides = {}) => {
  const strategy = getActiveStrategy(overrides);
  const config = await getConfig(strategy, overrides);
  return strategy.decryptBuffer(buffer, config, overrides);
};

const isEncryptionEnabled = async (overrides = {}) => {
  const strategy = getActiveStrategy(overrides);
  const config = await getConfig(strategy, overrides);
  return Boolean(config.enabled);
};

const isActive = async (overrides = {}) => {
  const strategy = getActiveStrategy(overrides);
  const config = await getConfig(strategy, overrides);
  return Boolean(config.enabled || config.privateKeyArmored || config.privateKeyPem || config.key);
};

const getStatus = async (overrides = {}) => {
  const strategy = getActiveStrategy(overrides);
  const config = await getConfig(strategy, overrides);
  return {
    ...strategy.getStatus(config, overrides),
    availableAlgorithms: Object.keys(registry),
  };
};

module.exports = {
  encryptBuffer,
  decryptBuffer,
  getStatus,
  isEncryptionEnabled,
  isActive,
};
