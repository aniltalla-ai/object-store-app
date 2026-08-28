const fs = require('fs');
const { Writable } = require('stream');
const { pipeline } = require('stream/promises');
const cryptoService = require('../cryptoAdapter');
const { cleanupSession } = require('./sessionUtils');

/**
 * Central Upload Pipeline:
 * Encrypts payload before uploading to storage provider if crypto is active and attaches encryption metadata.
 */
const finalizeSessionUpload = async (session, targetPath, provider, cryptoDestination = null) => {
  if (!fs.existsSync(session.path)) throw new Error('Upload session file missing.');

  let metadata = null;
  if (cryptoDestination && await cryptoService.isActive(cryptoDestination)) {
    const rawBuffer = fs.readFileSync(session.path);
    const encryptedBuffer = await cryptoService.encrypt(rawBuffer, cryptoDestination);
    fs.writeFileSync(session.path, encryptedBuffer);

    const config = await cryptoService.getConfig(cryptoDestination);
    metadata = {
      isencrypted: 'true',
      encryptionalgorithm: config?.algorithm || 'unknown',
      cryptodestination: cryptoDestination,
    };
  }

  const stat = fs.statSync(session.path);
  const fileSize = stat.size;

  const readStream = fs.createReadStream(session.path);
  readStream.on('error', () => { });

  await provider.uploadStream(targetPath, readStream, session.path, metadata);

  cleanupSession(session);
  return fileSize;
};

/**
 * Central Download Pipeline:
 * Downloads payload from storage provider and conditionally decrypts buffer if object metadata indicates it is encrypted.
 */
const fetchAndDecryptPayload = async (provider, targetPath, cryptoDestination = null) => {
  let fileMetadata = {};
  if (provider && typeof provider.getMetadata === 'function') {
    try {
      fileMetadata = await provider.getMetadata(targetPath);
    } catch (e) { }
  }

  let rawPayload;
  const result = await provider.download(targetPath);
  if (Buffer.isBuffer(result)) {
    rawPayload = result;
  } else if (result && typeof result.pipe === 'function') {
    const chunks = [];
    const writableStream = new Writable({
      write(chunk, encoding, callback) {
        chunks.push(chunk);
        callback();
      }
    });
    await pipeline(result, writableStream);
    rawPayload = Buffer.concat(chunks);
  } else {
    rawPayload = Buffer.alloc(0);
  }

  // Normalize metadata key access (handling lowercased or camelCased keys)
  const isEncrypted = fileMetadata?.isencrypted === 'true' || fileMetadata?.isEncrypted === 'true';
  const targetDestination = cryptoDestination || fileMetadata?.cryptodestination || fileMetadata?.cryptoDestination || null;

  // Decrypt if metadata explicitly marks object as encrypted
  if (isEncrypted && targetDestination) {
    return cryptoService.decrypt(rawPayload, targetDestination);
  }

  return rawPayload;
};

module.exports = {
  finalizeSessionUpload,
  fetchAndDecryptPayload,
};
