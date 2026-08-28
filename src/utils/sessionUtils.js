const fs = require('fs');
const path = require('path');
const os = require('os');
const { v4: uuidv4 } = require('uuid');

const TEMP_DIR = path.join(os.tmpdir(), 'object_store_temp');
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

const activeUploads = {};
const SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour

// Lazy timer-less purge for orphaned temporary upload files (0 background timer overhead)
const purgeStaleSessionsIfNeeded = () => {
  const keys = Object.keys(activeUploads);
  if (keys.length === 0) return;

  const now = Date.now();
  for (const key of keys) {
    const session = activeUploads[key];
    if (session && session.createdAtMs && (now - session.createdAtMs > SESSION_TTL_MS)) {
      if (session.path && fs.existsSync(session.path)) {
        try { fs.unlinkSync(session.path); } catch (e) {}
      }
      delete activeUploads[key];
    }
  }
};

const getUploadSession = (idOrName) => {
  if (!idOrName) return null;
  purgeStaleSessionsIfNeeded();
  const direct = activeUploads[idOrName];
  if (direct) return direct;

  return Object.values(activeUploads).find((session) => session.fileName === idOrName || session.uploadId === idOrName) || null;
};

const createUploadSession = (fileName, initialBuffer = Buffer.alloc(0)) => {
  purgeStaleSessionsIfNeeded();
  fs.mkdirSync(TEMP_DIR, { recursive: true });
  const uploadId = uuidv4();
  const filePath = path.join(TEMP_DIR, uploadId);

  fs.writeFileSync(filePath, initialBuffer);
  const now = new Date().toISOString();

  const session = {
    uploadId,
    fileName: path.basename(fileName),
    path: filePath,
    status: 'InProgress',
    creationDate: now,
    updateDate: now,
    createdAtMs: Date.now(),
  };

  activeUploads[uploadId] = session;
  activeUploads[session.fileName] = session;
  return session;
};

const appendToSession = (session, dataBuffer) => {
  if (!fs.existsSync(session.path)) throw new Error('Upload session file missing.');
  fs.appendFileSync(session.path, dataBuffer);
  session.updateDate = new Date().toISOString();
  return fs.statSync(session.path).size;
};

const cleanupSession = (session) => {
  if (session && fs.existsSync(session.path)) {
    try { fs.unlinkSync(session.path); } catch (e) {}
  }
  if (session) {
    delete activeUploads[session.uploadId];
    delete activeUploads[session.fileName];
  }
};

module.exports = {
  TEMP_DIR,
  activeUploads,
  getUploadSession,
  createUploadSession,
  appendToSession,
  cleanupSession,
};
