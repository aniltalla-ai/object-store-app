const openpgp = require('openpgp');

const KEY_CACHE_TTL_MS = Number(process.env.ENCRYPTION_KEY_CACHE_TTL_MS || 10 * 60 * 1000);

const PGP_ARMOR_HEADER = '-----BEGIN PGP MESSAGE-----';

const getDestinationNames = (overrides = {}) => ({
  publicKey: overrides.ENCRYPTION_PUBLIC_KEY_DESTINATION || process.env.ENCRYPTION_PUBLIC_KEY_DESTINATION || 'ENCRYPTION_PUBLIC_KEY',
  privateKey: overrides.ENCRYPTION_PRIVATE_KEY_DESTINATION || process.env.ENCRYPTION_PRIVATE_KEY_DESTINATION || 'ENCRYPTION_PRIVATE_KEY',
});

const resolveFormat = (overrides = {}) => {
  const raw = overrides.PGP_FORMAT || process.env.PGP_FORMAT || 'binary';
  return raw.toLowerCase() === 'armored' ? 'armored' : 'binary';
};

const readDestinationProperty = (dest, propertyName) => {
  if (!dest) return null;
  const additional = dest.additionalProperties || dest.originalProperties || {};
  return String(additional[propertyName] || dest[propertyName] || '').trim() || null;
};

const resolveDestinationValue = async (destinationName, propertyName) => {
  try {
    const { getDestination } = require('@sap-cloud-sdk/connectivity');
    const dest = await getDestination({ destinationName });
    return {
      publicKey: readDestinationProperty(dest, 'ENCRYPTION_PUBLIC_KEY'),
      privateKey: readDestinationProperty(dest, 'ENCRYPTION_PRIVATE_KEY'),
      passphrase: readDestinationProperty(dest, 'ENCRYPTION_PASSPHRASE'),
    };
    // const value = readDestinationProperty(dest, propertyName);
    // if (value) return value;
    // console.warn(`[CRYPTO:pgp] Destination '${destinationName}' found but property '${propertyName}' is empty.`);
    // return null;
  } catch (err) {
    console.warn(`[CRYPTO:pgp] Failed to resolve destination '${destinationName}': ${err.message}`);
    return null;
  }
};

const loadConfig = async (overrides = {}) => {
  const keysInfo = await resolveDestinationValue(overrides['DEST']);

  // let publicKey = process.env.ENCRYPTION_PUBLIC_KEY || '';
  // let privateKeyArmored = process.env.ENCRYPTION_PRIVATE_KEY || '';
  // let passphrase = process.env.ENCRYPTION_PASSPHRASE || '';

  // const destPublicKey = await resolveDestinationValue(destinationNames.publicKey, 'publicKey');
  // if (destPublicKey) publicKey = destPublicKey;

  // const destPrivateKey = await resolveDestinationValue(destinationNames.privateKey, 'privateKey');
  // if (destPrivateKey) privateKeyArmored = destPrivateKey;

  // const destPassphrase = await resolveDestinationValue(destinationNames.privateKey, 'passphrase');
  // if (destPassphrase) passphrase = destPassphrase;

  return {
    enabled: Boolean(keysInfo?.publicKey),
    ...keysInfo
  };
};

const looksLikeOurs = (buffer) => {
  if (!buffer || buffer.length === 0) return false;
  return buffer.subarray(0, 512).toString('utf8').includes(PGP_ARMOR_HEADER);
};

module.exports = {
  name: 'pgp',
  cacheTtlMs: KEY_CACHE_TTL_MS,
  loadConfig,
  looksLikeOurs,

  encryptBuffer: async (buffer, config, overrides = {}) => {
    try {
      const armoredKey = Buffer.from(config.publicKey, 'base64').toString('utf8');
      const encryptionKeys = await openpgp.readKey({ armoredKey: armoredKey });
      const message = await openpgp.createMessage({ binary: new Uint8Array(buffer) });
      const encrypted = await openpgp.encrypt({
        message,
        encryptionKeys,
        format: resolveFormat(overrides),
      });
      return Buffer.from(encrypted);
    } catch (err) {
      throw new Error(`PGP encryption failed: ${err.message}`);
    }
  },

  decryptBuffer: async (buffer, config) => {
    if (!config.privateKey) {
      if (looksLikeOurs(buffer)) {
        console.warn('[CRYPTO:pgp] File is PGP-encrypted but no private key is configured. Serving ciphertext as-is.');
      }
      return buffer;
    }

    try {
      const armoredKey = Buffer.from(config.privateKey, 'base64').toString('utf8');
      let decryptionKeys = await openpgp.readPrivateKey({ armoredKey: armoredKey });
      if (config.passphrase) {
        decryptionKeys = await openpgp.decryptKey({
          privateKey: decryptionKeys,
          passphrase: config.passphrase,
        });
      }

      const message = looksLikeOurs(buffer)
        ? await openpgp.readMessage({ armoredMessage: buffer.toString('utf8') })
        : await openpgp.readMessage({ binaryMessage: new Uint8Array(buffer) });

      const decrypted = await openpgp.decrypt({
        message,
        decryptionKeys,
        format: 'binary',
      });

      return Buffer.from(decrypted.data);
    } catch (err) {
      if (!looksLikeOurs(buffer)) {
        console.warn('[CRYPTO:pgp] File is not an OpenPGP message. Serving unmodified content.');
        return buffer;
      }
      throw new Error(`PGP decryption failed: ${err.message}`);
    }
  },

  getStatus: (config, overrides = {}) => {
    const destinationNames = getDestinationNames(overrides);
    return {
      algorithm: 'pgp',
      enabled: config.enabled,
      publicKeyDestination: destinationNames.publicKey,
      privateKeyDestination: destinationNames.privateKey,
      publicKeyConfigured: Boolean(config.publicKey),
      privateKeyConfigured: Boolean(config.privateKey),
      format: resolveFormat(overrides),
    };
  },
};
