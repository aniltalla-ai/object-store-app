const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { v4: uuidv4 } = require('uuid');
const StorageAdapter = require('./storageAdapter');
const authMiddleware = require('./security');

const router = express.Router();

const TEMP_DIR = path.join(os.tmpdir(), 'object_store_temp');
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

const activeUploads = {};

// Fallback raw body capturing middleware for requests where express body parsers did not run
router.use((req, res, next) => {
  if (req.body && (Buffer.isBuffer(req.body) || typeof req.body === 'string' || Object.keys(req.body).length > 0)) {
    return next();
  }
  if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      if (chunks.length > 0) {
        req.rawBody = Buffer.concat(chunks);
      }
      next();
    });
    req.on('error', (err) => next(err));
  } else {
    next();
  }
});

const normalizeRelativePath = (value) => {
  if (typeof value !== 'string') return '';
  return value.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/');
};

const resolvePathValue = (req, fallbackKeys = []) => {
  const keys = Array.isArray(fallbackKeys) ? fallbackKeys : [fallbackKeys];
  const allKeys = [
    ...keys,
    'path',
    'location',
    'StartIn',
    'sourcePath',
    'destinationPath',
    'storagePath',
    'storage',
    'destination'
  ];

  const candidates = [];

  for (const k of allKeys) {
    if (!k) continue;
    const lowerK = k.toLowerCase();

    if (typeof req.query?.[k] === 'string') candidates.push(req.query[k]);
    if (typeof req.query?.[lowerK] === 'string') candidates.push(req.query[lowerK]);

    if (typeof req.params?.[k] === 'string') candidates.push(req.params[k]);
    if (typeof req.params?.[lowerK] === 'string') candidates.push(req.params[lowerK]);

    if (typeof req.headers?.[k] === 'string') candidates.push(req.headers[k]);
    if (typeof req.headers?.[lowerK] === 'string') candidates.push(req.headers[lowerK]);

    if (req.body && typeof req.body === 'object') {
      if (typeof req.body[k] === 'string') candidates.push(req.body[k]);
      if (typeof req.body[lowerK] === 'string') candidates.push(req.body[lowerK]);
    }
  }

  return candidates.find((value) => typeof value === 'string' && value.trim().length > 0)?.trim();
};

const getUploadSession = (idOrName) => {
  if (!idOrName) return null;
  const direct = activeUploads[idOrName];
  if (direct) return direct;

  return Object.values(activeUploads).find((session) => session.fileName === idOrName || session.uploadId === idOrName) || null;
};

const toBinaryPayload = (req) => {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return Buffer.from(req.body);
  if (Buffer.isBuffer(req.rawBody)) return req.rawBody;
  if (req.body && typeof req.body === 'object') {
    const fileValue = req.body.file || req.body.data || req.body.content;
    if (Buffer.isBuffer(fileValue)) return fileValue;
    if (typeof fileValue === 'string') return Buffer.from(fileValue);
  }
  if (req.files && req.files.file) {
    const maybeFile = req.files.file.data || req.files.file.buffer || req.files.file;
    if (Buffer.isBuffer(maybeFile)) return maybeFile;
  }
  return Buffer.alloc(0);
};

const validateAndSetInstance = (req, res, next) => {
  const tokenInstance = req.user?.attr?.object_store_instance?.[0];
  const routeInstance = req.params.destinationName || req.query?.destinationName || req.query?.instance;

  if (routeInstance && tokenInstance && tokenInstance !== routeInstance) {
    return res.status(403).json({
      error: `Security Alert Mismatch: Authenticated token represents system [${tokenInstance}], but request path attempted to manipulate destination [${routeInstance}].`
    });
  }

  req.instanceId = routeInstance || tokenInstance;
  if (!req.instanceId) {
    return res.status(400).json({ error: "Missing required 'destinationName' path parameter." });
  }

  next();
};

router.use(authMiddleware);

router.post('/:destinationName/createPath', validateAndSetInstance, async (req, res) => {
  try {
    const provider = await StorageAdapter.getClient(req.instanceId);
    const customPath = resolvePathValue(req, ['path']);
    if (!customPath) return res.status(400).json({ error: "Missing required 'path' parameter." });

    const normalizedPath = normalizeRelativePath(customPath);
    const targetedFolderStructure = `${req.instanceId}/${normalizedPath}`;
    await provider.createPath(req.instanceId, [normalizedPath]);

    res.status(200).json({
      name: normalizedPath,
      sizeInBytes: 0,
      location: targetedFolderStructure,
      isDirectory: true,
      storageType: provider.constructor.name || 'Local',
      lineCount: null,
      creationDate: new Date().toISOString()
    });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Failed to create path.' });
  }
});

router.get('/:destinationName/list', validateAndSetInstance, async (req, res) => {
  try {
    const provider = await StorageAdapter.getClient(req.instanceId);
    const subfolder = resolvePathValue(req, ['StartIn']) || '';
    const prefixFilter = `${req.instanceId}/${normalizeRelativePath(subfolder)}`.replace(/\/+/g, '/').replace(/\/$/, '');

    let files = [];
    try {
      files = await provider.list(prefixFilter, req.instanceId, subfolder);
    } catch (listErr) {
      files = [];
    }

    const normalizedItems = (files || [])
      .map((file) => {
        let rawPath = file.name?.replace(/\\/g, '/').replace(/\/+$/, '') || '';
        let relativePath = rawPath;
        if (relativePath.startsWith(`${req.instanceId}/`)) {
          relativePath = relativePath.substring(req.instanceId.length + 1);
        }

        const fullLocation = relativePath ? `${req.instanceId}/${relativePath}` : req.instanceId;
        const justName = relativePath.split('/').pop() || rawPath.split('/').pop() || '';

        return {
          name: justName,
          sizeInBytes: file.size ?? 0,
          location: fullLocation,
          isDirectory: !!file.isFolder,
          storageType: provider.constructor.name || 'Local',
          lineCount: null,
          creationDate: file.modified ? new Date(file.modified).toISOString() : new Date().toISOString()
        };
      })
      .filter((item) => {
        return item.name !== '.init' && item.name !== '';
      });

    res.json({
      bucket: req.instanceId,
      items: normalizedItems
    });
  } catch (err) {
    res.json({
      bucket: req.instanceId || '',
      items: []
    });
  }
});

router.get('/:destinationName/getChunk', validateAndSetInstance, async (req, res) => {
  try {
    const targetValue = resolvePathValue(req, ['location']);
    if (!targetValue) return res.status(400).json({ error: "Missing required 'location' parameter." });

    const targetPath = `${req.instanceId}/${normalizeRelativePath(targetValue)}`;
    const localFilePath = path.join(TEMP_DIR, targetPath);
    if (!fs.existsSync(localFilePath)) return res.status(404).json({ error: 'File not found at specified location.' });

    let payload = fs.readFileSync(localFilePath);
    const chunkType = (req.query?.chunkType || 'Binary').toLowerCase();
    const chunkSize = Number(req.query?.chunkSize || 0);
    const chunkPart = Number(req.query?.chunkPart || 0);
    const startLine = Number(req.query?.startLine || 0);

    if (chunkType === 'line') {
      const lines = payload.toString('utf8').split(/\r?\n/);
      const startIndex = Math.max(0, startLine);
      const endIndex = chunkSize > 0 ? startIndex + chunkSize : lines.length;
      payload = Buffer.from(lines.slice(startIndex, endIndex).join('\n'));
    } else if (chunkSize > 0 && chunkPart > 0) {
      const startIndex = (chunkPart - 1) * chunkSize;
      payload = payload.subarray(startIndex, startIndex + chunkSize);
    } else if (chunkSize > 0) {
      payload = payload.subarray(0, chunkSize);
    }

    res.type('application/octet-stream').send(payload);
  } catch (err) {
    res.status(404).json({ error: 'File not found at specified location.' });
  }
});

router.post('/:destinationName/copy', validateAndSetInstance, async (req, res) => {
  try {
    const provider = await StorageAdapter.getClient(req.instanceId);
    const sourceFile = resolvePathValue(req, ['sourcePath']);
    const destinationFile = resolvePathValue(req, ['destinationPath']);

    if (!sourceFile || !destinationFile) {
      return res.status(400).json({ error: "Missing 'sourcePath' or 'destinationPath' parameters." });
    }

    const fullSource = `${req.instanceId}/${normalizeRelativePath(sourceFile)}`;
    const fullDest = `${req.instanceId}/${normalizeRelativePath(destinationFile)}`;

    await provider.copy(fullSource, fullDest);
    res.json({
      name: path.basename(destinationFile),
      sizeInBytes: 0,
      location: fullDest,
      isDirectory: false,
      storageType: provider.constructor.name || 'Local',
      lineCount: null,
      creationDate: new Date().toISOString()
    });
  } catch (err) {
    const msg = err.message || '';
    if (msg.includes('ENOENT') || msg.includes('not found') || msg.includes('404')) {
      return res.status(404).json({ error: "Source file not found." });
    }
    res.status(400).json({ error: err.message || 'Copy operation failed.' });
  }
});

router.post('/:destinationName/move', validateAndSetInstance, async (req, res) => {
  try {
    const provider = await StorageAdapter.getClient(req.instanceId);
    const sourceFile = resolvePathValue(req, ['sourcePath']);
    const destinationFile = resolvePathValue(req, ['destinationPath']);

    if (!sourceFile || !destinationFile) {
      return res.status(400).json({ error: "Missing 'sourcePath' or 'destinationPath' parameters." });
    }

    const fullSource = `${req.instanceId}/${normalizeRelativePath(sourceFile)}`;
    const fullDest = `${req.instanceId}/${normalizeRelativePath(destinationFile)}`;

    await provider.move(fullSource, fullDest);
    res.json({
      name: path.basename(destinationFile),
      sizeInBytes: 0,
      location: fullDest,
      isDirectory: false,
      storageType: provider.constructor.name || 'Local',
      lineCount: null,
      creationDate: new Date().toISOString()
    });
  } catch (err) {
    const msg = err.message || '';
    if (msg.includes('ENOENT') || msg.includes('not found') || msg.includes('404')) {
      return res.status(404).json({ error: "Source file not found." });
    }
    res.status(400).json({ error: err.message || 'Move operation failed.' });
  }
});

router.get('/:destinationName/get', validateAndSetInstance, async (req, res) => {
  try {
    const provider = await StorageAdapter.getClient(req.instanceId);
    const targetPath = resolvePathValue(req, ['location']);
    if (!targetPath) return res.status(400).json({ error: "Missing required 'location' parameter." });

    await provider.download(`${req.instanceId}/${normalizeRelativePath(targetPath)}`, res);
  } catch (err) {
    const msg = err.message || '';
    if (msg.includes('Not Found') || msg.includes('no such file') || msg.includes('404') || err.code === 'ENOENT') {
      return res.status(404).json({ error: "File not found at specified location." });
    }
    res.status(500).json({ error: err.message || 'Download operation failed.' });
  }
});

router.post('/:destinationName/post', validateAndSetInstance, async (req, res) => {
  try {
    const provider = await StorageAdapter.getClient(req.instanceId);
    const targetLocation = resolvePathValue(req, ['location']);
    if (!targetLocation) return res.status(400).json({ error: "Missing required 'location' query parameter." });

    const filePayload = toBinaryPayload(req);
    if (!filePayload || filePayload.length === 0) return res.status(400).json({ error: 'Empty file payload.' });

    const targetPath = `${req.instanceId}/${normalizeRelativePath(targetLocation)}`;
    fs.mkdirSync(TEMP_DIR, { recursive: true });
    const tempFile = path.join(TEMP_DIR, `${uuidv4()}-${path.basename(targetLocation)}`);
    fs.writeFileSync(tempFile, filePayload);
    const readStream = fs.createReadStream(tempFile);
    readStream.on('error', () => {});
    await provider.uploadStream(targetPath, readStream, tempFile);
    fs.existsSync(tempFile) && fs.unlinkSync(tempFile);

    res.status(200).json({
      name: path.basename(targetLocation),
      sizeInBytes: filePayload.length,
      location: targetPath,
      isDirectory: false,
      storageType: provider.constructor.name || 'Local',
      lineCount: null,
      creationDate: new Date().toISOString()
    });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Upload operation failed.' });
  }
});

router.post('/:destinationName/postasync', validateAndSetInstance, async (req, res) => {
  try {
    const provider = await StorageAdapter.getClient(req.instanceId);
    const targetLocation = resolvePathValue(req, ['location']);
    if (!targetLocation) return res.status(400).json({ error: "Missing required 'location' query parameter." });

    const filePayload = toBinaryPayload(req);
    if (!filePayload || filePayload.length === 0) return res.status(400).json({ error: 'Empty file payload.' });

    const targetPath = `${req.instanceId}/${normalizeRelativePath(targetLocation)}`;
    fs.mkdirSync(TEMP_DIR, { recursive: true });
    const tempFile = path.join(TEMP_DIR, `${uuidv4()}-${path.basename(targetLocation)}`);
    fs.writeFileSync(tempFile, filePayload);
    await provider.uploadStream(targetPath, fs.createReadStream(tempFile), tempFile);
    fs.existsSync(tempFile) && fs.unlinkSync(tempFile);

    res.status(202).send();
  } catch (err) {
    res.status(400).json({ error: err.message || 'Async upload operation failed.' });
  }
});

router.delete('/:destinationName/delete', validateAndSetInstance, async (req, res) => {
  try {
    const provider = await StorageAdapter.getClient(req.instanceId);
    const targetPath = resolvePathValue(req, ['location']);
    if (!targetPath) return res.status(400).json({ error: "Missing required 'location' parameter." });

    try {
      await provider.delete(`${req.instanceId}/${normalizeRelativePath(targetPath)}`);
    } catch (delErr) {
      // Idempotent delete - swallow if file non-existent
    }
    res.status(200).send();
  } catch (err) {
    res.status(200).send();
  }
});

router.post('/:destinationName/setStorage', validateAndSetInstance, async (req, res) => {
  try {
    const targetLocation = resolvePathValue(req, ['location']);
    const storageType = req.query?.storage || 'Archive';
    if (!targetLocation) return res.status(400).json({ error: "Missing required 'location' parameter." });

    res.json({
      name: path.basename(targetLocation),
      sizeInBytes: 0,
      location: `${req.instanceId}/${normalizeRelativePath(targetLocation)}`,
      isDirectory: false,
      storageType,
      lineCount: null,
      creationDate: new Date().toISOString()
    });
  } catch (err) {
    res.status(400).json({ error: err.message || 'setStorage operation failed.' });
  }
});

router.get('/listWritable', async (req, res) => {
  try {
    const pending = Object.values(activeUploads).map((session) => {
      let size = 0;
      if (session.path && fs.existsSync(session.path)) {
        size = fs.statSync(session.path).size;
      }
      return {
        name: session.fileName,
        sizeInBytes: size,
        lineCount: null,
        creationDate: session.creationDate || new Date().toISOString(),
        updateDate: session.updateDate || new Date().toISOString()
      };
    });

    res.json(pending);
  } catch (err) {
    res.json([]);
  }
});

router.get('/getWritable/:fileName', (req, res) => {
  try {
    const session = getUploadSession(req.params.fileName);
    if (!session || !fs.existsSync(session.path)) {
      return res.status(404).json({ error: 'File not found or not writable.' });
    }

    const payload = fs.readFileSync(session.path);
    const chunkType = (req.query?.chunkType || 'Binary').toLowerCase();
    const chunkSize = Number(req.query?.chunkSize || 0);
    const chunkPart = Number(req.query?.chunkPart || 0);
    const startLine = Number(req.query?.startLine || 0);

    let output = payload;
    if (chunkType === 'line') {
      const lines = payload.toString('utf8').split(/\r?\n/);
      const start = Math.max(0, startLine);
      const end = chunkSize > 0 ? start + chunkSize : lines.length;
      output = Buffer.from(lines.slice(start, end).join('\n'));
    } else if (chunkSize > 0 && chunkPart > 0) {
      const start = (chunkPart - 1) * chunkSize;
      output = payload.subarray(start, start + chunkSize);
    } else if (chunkSize > 0) {
      output = payload.subarray(0, chunkSize);
    }

    res.type('application/octet-stream').send(output);
  } catch (err) {
    res.status(404).json({ error: 'File not found or writable.' });
  }
});

router.post('/writeStart/:fileName', (req, res) => {
  try {
    fs.mkdirSync(TEMP_DIR, { recursive: true });

    const uploadId = uuidv4();
    const filePath = path.join(TEMP_DIR, uploadId);
    const dataBuffer = toBinaryPayload(req);

    fs.writeFileSync(filePath, dataBuffer);
    const now = new Date().toISOString();
    const session = {
      uploadId,
      fileName: req.params.fileName,
      path: filePath,
      status: 'InProgress',
      creationDate: now,
      updateDate: now
    };
    activeUploads[uploadId] = session;
    activeUploads[req.params.fileName] = session;

    res.status(200).json({
      name: req.params.fileName,
      sizeInBytes: dataBuffer.length,
      lineCount: null,
      creationDate: now,
      updateDate: now
    });
  } catch (err) {
    res.status(400).json({ error: `Upload start failed: ${err.message}` });
  }
});

const handleChunkWrite = (req, res) => {
  const session = getUploadSession(req.params.fileName);
  if (!session) return res.status(404).json({ error: 'Missing session context mapping.' });
  if (!fs.existsSync(session.path)) {
    delete activeUploads[req.params.fileName];
    activeUploads[session.fileName] && delete activeUploads[session.fileName];
    return res.status(404).json({ error: 'Upload chunk file is missing. Please restart the upload.' });
  }

  try {
    const dataBuffer = toBinaryPayload(req);
    fs.appendFileSync(session.path, dataBuffer);
    const stat = fs.statSync(session.path);
    session.updateDate = new Date().toISOString();

    res.json({
      name: session.fileName,
      sizeInBytes: stat.size,
      lineCount: null,
      creationDate: session.creationDate,
      updateDate: session.updateDate
    });
  } catch (err) {
    res.status(400).json({ error: `Upload append failed: ${err.message}` });
  }
};

router.post('/writeChunk/:fileName', handleChunkWrite);

router.post('/writeComplete/:fileName', async (req, res) => {
  try {
    const session = getUploadSession(req.params.fileName);
    if (!session) return res.status(404).json({ error: 'Upload session context expired or missing.' });
    if (!fs.existsSync(session.path)) {
      delete activeUploads[req.params.fileName];
      activeUploads[session.fileName] && delete activeUploads[session.fileName];
      return res.status(404).json({ error: 'Upload chunk file is missing. Please restart the upload.' });
    }

    const rawDest = resolvePathValue(req, ['destination']) || '';
    const rawStoragePath = resolvePathValue(req, ['storagePath']) || '';

    let instanceKey = req.user?.attr?.object_store_instance?.[0];
    let folderPath = '';

    if (rawDest) {
      const parts = normalizeRelativePath(rawDest).split('/');
      instanceKey = parts[0] || instanceKey;
      if (parts.length > 1) {
        folderPath = parts.slice(1).join('/');
      }
    }

    if (rawStoragePath) {
      const normalizedStorage = normalizeRelativePath(rawStoragePath);
      if (instanceKey && normalizedStorage.startsWith(`${instanceKey}/`)) {
        folderPath = normalizedStorage.substring(instanceKey.length + 1);
      } else if (folderPath) {
        folderPath = `${folderPath}/${normalizedStorage}`;
      } else {
        folderPath = normalizedStorage;
      }
    }

    if (!instanceKey) {
      return res.status(400).json({ error: "Missing required 'destination' or 'storagePath' parameter." });
    }

    const targetFileName = session.fileName || 'uploaded-file';
    const relativeTarget = folderPath ? `${folderPath}/${targetFileName}` : targetFileName;
    const targetPath = `${instanceKey}/${normalizeRelativePath(relativeTarget)}`;

    const provider = await StorageAdapter.getClient(instanceKey);

    const stat = fs.statSync(session.path);
    const fileSize = stat.size;

    const readStream = fs.createReadStream(session.path);
    readStream.on('error', () => {});
    await provider.uploadStream(targetPath, readStream, session.path);

    if (fs.existsSync(session.path)) fs.unlinkSync(session.path);
    delete activeUploads[req.params.fileName];
    activeUploads[session.fileName] && delete activeUploads[session.fileName];

    res.json({
      name: targetFileName,
      sizeInBytes: fileSize,
      location: targetPath,
      isDirectory: false,
      storageType: provider.constructor.name || 'Local',
      lineCount: null,
      creationDate: new Date().toISOString()
    });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Complete operation failed.' });
  }
});

router.post('/writeCancel/:fileName', (req, res) => {
  const session = getUploadSession(req.params.fileName);
  const now = new Date().toISOString();
  const name = session ? session.fileName : req.params.fileName;
  if (session && fs.existsSync(session.path)) fs.unlinkSync(session.path);
  if (session) {
    delete activeUploads[req.params.fileName];
    activeUploads[session.fileName] && delete activeUploads[session.fileName];
  }

  res.json({
    name,
    sizeInBytes: 0,
    lineCount: null,
    creationDate: session ? session.creationDate : now,
    updateDate: now
  });
});

router.get('/uploadStatus/:uploadId', (req, res) => {
  const session = getUploadSession(req.params.uploadId);
  if (!session) return res.status(404).json({ error: 'Not Found or Session Completed' });

  const now = new Date().toISOString();
  res.json({
    id: session.uploadId || req.params.uploadId,
    fileName: session.fileName,
    location: session.path,
    destLocation: session.destination || '',
    tenant: req.user?.id || 'DEFAULT',
    destinationId: '00000000-0000-0000-0000-000000000000',
    status: session.status || 'InProgress',
    statusMessage: 'Upload session active',
    statusDate: now,
    insertDate: session.creationDate || now,
    deleted: false
  });
});

// Fallback for non-existent routes within /Storage
router.use((req, res) => {
  res.status(404).json({ error: `Invalid Object Store service endpoint: ${req.method} ${req.originalUrl}` });
});

// Router-level error handling middleware to prevent HTML stack dumps
router.use((err, req, res, next) => {
  const status = err.statusCode || err.status || 500;
  res.status(status).json({ error: err.message || 'An unexpected server error occurred.' });
});

module.exports = router;
