const fs = require('fs');
const { Writable } = require('stream');
const cryptoService = require('../cryptoAdapter');
const { cleanupSession } = require('./sessionUtils');

/**
 * Central Upload Pipeline:
 * Encrypts payload before uploading to storage provider if crypto is active.
 */
const finalizeSessionUpload = async (session, targetPath, provider, cryptoDestination = null) => {
  if (!fs.existsSync(session.path)) throw new Error('Upload session file missing.');

  if (cryptoDestination && await cryptoService.isActive(cryptoDestination)) {
    const rawBuffer = fs.readFileSync(session.path);
    const encryptedBuffer = await cryptoService.encrypt(rawBuffer, cryptoDestination);
    fs.writeFileSync(session.path, encryptedBuffer);
  }

  const stat = fs.statSync(session.path);
  const fileSize = stat.size;

  const readStream = fs.createReadStream(session.path);
  readStream.on('error', () => {});

  await provider.uploadStream(targetPath, readStream, session.path);

  cleanupSession(session);
  return fileSize;
};

/**
 * Central Download Pipeline:
 * Downloads payload from storage provider and decrypts buffer if crypto is active.
 */
const fetchAndDecryptPayload = async (provider, targetPath, cryptoDestination = null) => {
  const chunks = [];
  const writableStream = new Writable({
    write(chunk, encoding, callback) {
      chunks.push(chunk);
      callback();
    }
  });

  await new Promise((resolve, reject) => {
    writableStream.on('finish', resolve);
    writableStream.on('error', reject);
    Promise.resolve(provider.download(targetPath, writableStream)).catch(reject);
  });

  const rawPayload = Buffer.concat(chunks);
  return cryptoService.decrypt(rawPayload, cryptoDestination);
};

module.exports = {
  finalizeSessionUpload,
  fetchAndDecryptPayload,
};
