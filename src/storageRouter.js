const express = require('express');
const path = require('path');
const fs = require('fs');
const StorageAdapter = require('./storageAdapter');
const xsuaaAuth = require('./security');
const requestUtils = require('./utils/requestUtils');
const sessionUtils = require('./utils/sessionUtils');
const pipelineUtils = require('./utils/pipelineUtils');
const { formatErrorResponse } = require('./utils/errorNormalizer');

const router = express.Router();

router.use(xsuaaAuth);

router.use(async (req, res, next) => {
  try {
    req.provider = await StorageAdapter.getClient(req.credentials);
    next();
  } catch (err) {
    const statusCode = err.statusCode || 400;
    console.error(`[STORAGE ADAPTER INIT ERROR ${statusCode}]`, err.message);
    return res.status(statusCode).json(formatErrorResponse(err, req, 'STORAGE_INIT_ERROR'));
  }
});

// GET /list -> 200 OK (or 404 Not Found if directory path doesn't exist)
router.get('/list', async (req, res) => {
  try {
    const provider = req.provider;
    const startWith = requestUtils.getParam(req, 'startIn') || '';
    const normalizedSub = requestUtils.normalizeRelativePath(startWith);
    const recursiveVal = requestUtils.getParam(req, 'recursive').toLowerCase();
    const isRecursive = ['true'].includes(recursiveVal);
    const foldersOnlyVal = requestUtils.getParam(req, 'foldersOnly').toLowerCase();
    const isFoldersOnly = ['true'].includes(foldersOnlyVal);

    let files = [];
    try {
      files = await provider.list(normalizedSub);
    } catch (listErr) {
      const errMsg = listErr.message || '';
      if (
        errMsg.includes('Not Found') ||
        errMsg.includes('no such file') ||
        errMsg.includes('NoSuchKey') ||
        errMsg.includes('ENOENT') ||
        listErr.code === 'ENOENT'
      ) {
        return res.status(404).json({ error: "Directory or path not found." });
      }
      files = [];
    }

    const itemsMap = new Map();
    const folderLocations = new Set();
    (files || []).forEach((file) => {
      let rawPath = file.name?.replace(/\\/g, '/') || '';
      if (!rawPath) return;
      let isDir = !!file.isFolder || rawPath.endsWith('/') || rawPath.endsWith('.init');

      if (rawPath.endsWith('/.init')) {
        rawPath = rawPath.slice(0, -6);
      } else if (rawPath.endsWith('/')) {
        rawPath = rawPath.slice(0, -1);
      } else if (rawPath === '.init') {
        return;
      }

      if (!rawPath) return;

      const pathParts = rawPath.split('/');
      pathParts.pop();
      let currentParent = '';
      for (const part of pathParts) {
        if (!part) continue;
        currentParent = currentParent ? `${currentParent}/${part}` : part;
        folderLocations.add(currentParent);
      }

      if (isDir) {
        folderLocations.add(rawPath);
      } else {
        const fileName = rawPath.split('/').pop() || '';
        if (fileName && fileName !== '.init') {
          itemsMap.set(rawPath, {
            name: fileName,
            sizeInBytes: file.size ?? 0,
            location: rawPath,
            isDirectory: false,
            storageType: provider.constructor.name || 'Local',
            lineCount: null,
            creationDate: file.modified ? new Date(file.modified).toISOString() : new Date().toISOString()
          });
        }
      }
    });

    folderLocations.forEach((folderPath) => {
      if (!folderPath) return;
      const fileName = folderPath.split('/').pop() || '';
      if (!fileName) return;
      itemsMap.set(folderPath, {
        name: fileName,
        sizeInBytes: 0,
        location: folderPath,
        isDirectory: true,
        storageType: provider.constructor.name || 'Local',
        lineCount: null,
        createDate: new Date().toISOString()
      });
    });

    let items = Array.from(itemsMap.values());

    if (isFoldersOnly) {
      items = items.filter(item => item.isDirectory);
    }

    const prefix = normalizedSub || '';
    items = items.filter((item) => {
      if (prefix && item.location === prefix) {
        return !item.isDirectory;
      }

      if (!normalizedSub) {
        return !item.location.includes('/');
      }
      if (!item.location.startsWith(prefix)) return false;
      if (isRecursive) return true;

      const prefixClean = prefix.endsWith('/') ? prefix : prefix + '/';
      const relative = item.location.substring(prefixClean.length);
      return !relative.includes('/');
    });

    return res.status(200).json({ bucket: req.instanceId, items });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'List operation failed.' });
  }
});

// POST /createPath -> 201 Created
router.post('/createPath', async (req, res) => {
  try {
    const provider = req.provider;
    const customPath = requestUtils.getParam(req, 'path');
    if (!customPath) return res.status(400).json({ error: "Missing required 'path' parameter." });

    const normalizedPath = requestUtils.normalizeRelativePath(customPath);
    await provider.createPath([normalizedPath]);

    return res.status(201).json({
      name: path.basename(normalizedPath),
      sizeInBytes: 0,
      location: normalizedPath,
      isDirectory: true,
      storageType: provider.constructor.name || 'Local',
      lineCount: null,
      creationDate: new Date().toISOString()
    });
  } catch (err) {
    return res.status(400).json({ error: err.message || 'Failed to create path.' });
  }
});

// GET /getChunk -> 206 Partial Content (or 200 OK for 'None', 416 Range Not Satisfiable)
router.get('/getChunk', async (req, res) => {
  try {
    const provider = req.provider;
    const targetValue = requestUtils.getParam(req, 'location');
    if (!targetValue) return res.status(400).json({ error: "Missing required 'location' parameter." });

    const targetPath = requestUtils.normalizeRelativePath(targetValue);
    const chunkType = (requestUtils.getParam(req, 'chunkType') || 'Binary').toLowerCase();
    const chunkSize = Number(requestUtils.getParam(req, 'chunkSize') || 0);
    const chunkPart = Number(requestUtils.getParam(req, 'chunkPart') || 0);
    const startLine = Number(requestUtils.getParam(req, 'startLine') || 0);

    let payload;
    try {
      payload = await pipelineUtils.fetchAndDecryptPayload(provider, targetPath, req.cryptoDestination);
    } catch (dlErr) {
      return res.status(404).json({ error: 'File not found at specified location.' });
    }

    if (!payload || payload.length === 0) {
      return res.status(404).json({ error: 'File not found at specified location.' });
    }

    if (chunkType === 'none') {
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Length', payload.length);
      return res.status(200).send(payload);
    }

    if (chunkType === 'line') {
      const lines = payload.toString('utf8').split(/\r?\n/);
      const totalLines = lines.length;
      const startIndex = Math.max(0, startLine);

      if (startIndex >= totalLines) {
        return res.status(416).json({ error: 'Range Not Satisfiable: startLine exceeds total file lines.' });
      }

      const endIndex = chunkSize > 0 ? Math.min(startIndex + chunkSize, totalLines) : totalLines;
      const output = Buffer.from(lines.slice(startIndex, endIndex).join('\n'));

      return res.status(206).type('application/octet-stream').send(output);
    }

    if (chunkType === 'binary') {
      if (chunkSize <= 0) {
        return res.status(416).json({ error: 'Range Not Satisfiable: Binary chunk type requires a valid chunkSize.' });
      }

      let start = 0;
      if (chunkPart > 0) {
        start = (chunkPart - 1) * chunkSize;
      }
      const end = start + chunkSize;

      if (start >= payload.length) {
        return res.status(416).json({ error: 'Range Not Satisfiable: Requested chunk start exceeds file size.' });
      }

      const sliced = payload.subarray(start, Math.min(end, payload.length));
      return res.status(206).type('application/octet-stream').send(sliced);
    }

    return res.status(400).json({ error: "Invalid 'chunkType' specified. Must be Line, Binary, or None." });

  } catch (err) {
    const msg = err.message || '';
    if (msg.includes('Range') || msg.includes('416') || msg.includes('InvalidRange') || msg.includes('range')) {
      return res.status(416).json({ error: 'Requested Range Not Satisfiable.' });
    }
    return res.status(404).json({ error: 'File not found or range invalid at specified location.' });
  }
});

// POST /copy -> 200 OK
router.post('/copy', async (req, res) => {
  try {
    const sourceFile = requestUtils.getParam(req, 'sourcePath');
    const destinationFile = requestUtils.getParam(req, 'destinationPath');
    const provider = req.provider;

    if (!sourceFile || !destinationFile) {
      return res.status(400).json({ error: "Missing 'sourcePath' or 'destinationPath' parameters." });
    }

    const normSource = requestUtils.normalizeRelativePath(sourceFile);
    const normDest = requestUtils.normalizeRelativePath(destinationFile);

    await provider.copy(normSource, normDest);
    return res.status(200).json({
      name: path.basename(destinationFile),
      sizeInBytes: 0,
      location: normDest,
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
    return res.status(400).json({ error: err.message || 'Copy operation failed.' });
  }
});

// POST /move -> 200 OK
router.post('/move', async (req, res) => {
  try {
    const provider = req.provider;
    const sourceFile = requestUtils.getParam(req, 'sourcePath');
    const destinationFile = requestUtils.getParam(req, 'destinationPath');

    if (!sourceFile || !destinationFile) {
      return res.status(400).json({ error: "Missing 'sourcePath' or 'destinationPath' parameters." });
    }

    const normSource = requestUtils.normalizeRelativePath(sourceFile);
    const normDest = requestUtils.normalizeRelativePath(destinationFile);

    await provider.move(normSource, normDest);
    return res.status(200).json({
      name: path.basename(destinationFile),
      sizeInBytes: 0,
      location: normDest,
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
    return res.status(400).json({ error: err.message || 'Move operation failed.' });
  }
});

// GET /get -> 200 OK
router.get('/get', async (req, res) => {
  try {
    const provider = req.provider;
    const targetPath = requestUtils.getParam(req, 'location');
    if (!targetPath) return res.status(400).json({ error: "Missing required 'location' parameter." });

    const normTarget = requestUtils.normalizeRelativePath(targetPath);
    const decrypted = await pipelineUtils.fetchAndDecryptPayload(provider, normTarget, req.cryptoDestination);

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', decrypted.length);
    res.send(decrypted);
  } catch (err) {
    const msg = err.message || '';
    if (msg.includes('Not Found') || msg.includes('no such file') || msg.includes('404') || err.code === 'ENOENT') {
      return res.status(404).json({ error: "File not found at specified location." });
    }
    return res.status(500).json({ error: err.message || 'Download operation failed.' });
  }
});

// POST /post -> 201 Created
router.post('/post', requestUtils.ensureBinaryPayload, async (req, res) => {
  try {
    const targetLocation = requestUtils.getParam(req, 'location');
    if (!targetLocation) return res.status(400).json({ error: "Missing required 'location' parameter." });

    const filePayload = requestUtils.toBinaryPayload(req);
    if (!filePayload || filePayload.length === 0) return res.status(400).json({ error: 'Empty file payload.' });

    const targetPath = requestUtils.normalizeRelativePath(targetLocation);
    const session = sessionUtils.createUploadSession(targetLocation, filePayload);

    const fileSize = await pipelineUtils.finalizeSessionUpload(session, targetPath, req.provider, req.cryptoDestination);

    return res.status(201).json({
      name: session.fileName,
      sizeInBytes: fileSize,
      location: targetPath,
      isDirectory: false,
      storageType: req.provider.constructor.name || 'Local',
      lineCount: null,
      creationDate: session.creationDate
    });
  } catch (err) {
    return res.status(400).json({ error: err.message || 'Upload failed.' });
  }
});

// POST /postasync -> 202 Accepted
router.post('/postasync', requestUtils.ensureBinaryPayload, async (req, res) => {
  try {
    const targetLocation = requestUtils.getParam(req, 'location');
    if (!targetLocation) return res.status(400).json({ error: "Missing required 'location' parameter." });

    const filePayload = requestUtils.toBinaryPayload(req);
    if (!filePayload || filePayload.length === 0) return res.status(400).json({ error: 'Empty file payload.' });

    const targetPath = requestUtils.normalizeRelativePath(targetLocation);
    const session = sessionUtils.createUploadSession(targetLocation, filePayload);
    session.destination = targetPath;

    res.status(202).json({
      id: session.uploadId,
      fileName: session.fileName,
      status: 'InProgress',
      message: 'Async upload started.'
    });

    setImmediate(async () => {
      try {
        await pipelineUtils.finalizeSessionUpload(session, targetPath, req.provider, req.cryptoDestination);
        session.status = 'Completed';
        session.updateDate = new Date().toISOString();
      } catch (bgErr) {
        session.status = 'Failed';
        session.statusMessage = bgErr.message;
        session.updateDate = new Date().toISOString();
        sessionUtils.cleanupSession(session);
      }
    });
  } catch (err) {
    return res.status(400).json({ error: err.message || 'Async upload failed.' });
  }
});

// DELETE /delete -> 204 No Content on success, 400/404/500 on failure
router.delete('/delete', async (req, res) => {
  try {
    const provider = req.provider;
    const targetPath = requestUtils.getParam(req, 'location');
    if (!targetPath) {
      return res.status(400).json({ error: "Missing required 'location' parameter." });
    }

    const fullPath = requestUtils.normalizeRelativePath(targetPath);
    await provider.delete(fullPath);

    return res.status(204).send();
  } catch (err) {
    const msg = err.message || '';
    if (msg.includes('Not Found') || msg.includes('no such file') || err.code === 'ENOENT') {
      return res.status(404).json({ error: "File not found at specified location." });
    }
    return res.status(500).json({ error: err.message || 'Delete operation failed.' });
  }
});

// GET /listWritable -> 200 OK
router.get('/listWritable', async (req, res) => {
  try {
    const pending = Object.values(sessionUtils.activeUploads).map((session) => {
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

    return res.status(200).json(pending);
  } catch (err) {
    return res.status(200).json([]);
  }
});

// GET /getWritable/:fileName -> 200 OK
router.get('/getWritable/:fileName', (req, res) => {
  try {
    const session = sessionUtils.getUploadSession(req.params.fileName);
    if (!session || !fs.existsSync(session.path)) {
      return res.status(404).json({ error: 'File not found or not writable.' });
    }

    const payload = fs.readFileSync(session.path);
    const chunkType = (requestUtils.getParam(req, 'chunkType') || 'Binary').toLowerCase();
    const chunkSize = Number(requestUtils.getParam(req, 'chunkSize') || 0);
    const startLine = Number(requestUtils.getParam(req, 'startLine') || 0);

    let output = payload;
    if (chunkType === 'line') {
      const lines = payload.toString('utf8').split(/\r?\n/);
      const startIndex = Math.max(0, startLine);
      if (startIndex >= lines.length) {
        return res.status(416).json({ error: 'Range Not Satisfiable: startLine exceeds session file lines.' });
      }
      const endIndex = chunkSize > 0 ? startIndex + chunkSize : lines.length;
      output = Buffer.from(lines.slice(startIndex, endIndex).join('\n'));
      return res.status(206).type('application/octet-stream').send(output);
    }

    return res.status(200).type('application/octet-stream').send(output);
  } catch (err) {
    return res.status(404).json({ error: 'File not found or writable.' });
  }
});

// POST /writeStart/:fileName -> 201 Created
router.post('/writeStart/:fileName', requestUtils.ensureBinaryPayload, (req, res) => {
  try {
    const dataBuffer = requestUtils.toBinaryPayload(req);
    const session = sessionUtils.createUploadSession(req.params.fileName, dataBuffer);

    return res.status(201).json({
      name: session.fileName,
      sizeInBytes: dataBuffer.length,
      lineCount: null,
      creationDate: session.creationDate,
      updateDate: session.updateDate
    });
  } catch (err) {
    return res.status(400).json({ error: `Upload start failed: ${err.message}` });
  }
});

// POST /writeChunk/:fileName -> 200 OK
router.post('/writeChunk/:fileName', requestUtils.ensureBinaryPayload, (req, res) => {
  const session = sessionUtils.getUploadSession(req.params.fileName);
  if (!session) return res.status(404).json({ error: 'Missing session context mapping.' });

  try {
    const dataBuffer = requestUtils.toBinaryPayload(req);
    const size = sessionUtils.appendToSession(session, dataBuffer);

    return res.status(200).json({
      name: session.fileName,
      sizeInBytes: size,
      lineCount: null,
      creationDate: session.creationDate,
      updateDate: session.updateDate
    });
  } catch (err) {
    return res.status(400).json({ error: `Upload append failed: ${err.message}` });
  }
});

// POST /writeComplete/:fileName -> 200 OK
router.post('/writeComplete/:fileName', async (req, res) => {
  try {
    const session = sessionUtils.getUploadSession(req.params.fileName);
    if (!session) return res.status(404).json({ error: 'Upload session context expired or missing.' });

    const rawDest = requestUtils.getParam(req, 'destination') || '';
    const rawStoragePath = requestUtils.getParam(req, 'storagePath') || '';
    let instanceKey = req.user?.attr?.object_store_instance?.[0];
    let folderPath = '';

    if (rawDest) {
      const parts = requestUtils.normalizeRelativePath(rawDest).split('/');
      instanceKey = parts[0] || instanceKey;
      if (parts.length > 1) folderPath = parts.slice(1).join('/');
    }

    if (rawStoragePath) {
      const normalizedStorage = requestUtils.normalizeRelativePath(rawStoragePath);
      if (instanceKey && normalizedStorage.startsWith(`${instanceKey}/`)) {
        folderPath = normalizedStorage.substring(instanceKey.length + 1);
      } else {
        folderPath = folderPath ? `${folderPath}/${normalizedStorage}` : normalizedStorage;
      }
    }

    if (!instanceKey) return res.status(400).json({ error: "Missing required destination/storagePath parameter." });

    const relativeTarget = folderPath ? `${folderPath}/${session.fileName}` : session.fileName;
    const targetPath = `${instanceKey}/${requestUtils.normalizeRelativePath(relativeTarget)}`;

    const fileSize = await pipelineUtils.finalizeSessionUpload(session, targetPath, req.provider, req.cryptoDestination);

    return res.status(200).json({
      name: session.fileName,
      sizeInBytes: fileSize,
      location: targetPath,
      isDirectory: false,
      storageType: req.provider.constructor.name || 'Local',
      lineCount: null,
      creationDate: new Date().toISOString()
    });
  } catch (err) {
    return res.status(400).json({ error: err.message || 'Complete operation failed.' });
  }
});

// POST /writeCancel/:fileName -> 200 OK
router.post('/writeCancel/:fileName', (req, res) => {
  const session = sessionUtils.getUploadSession(req.params.fileName);
  const now = new Date().toISOString();
  const name = session ? session.fileName : req.params.fileName;

  sessionUtils.cleanupSession(session);

  return res.status(200).json({
    name,
    sizeInBytes: 0,
    lineCount: null,
    creationDate: session ? session.creationDate : now,
    updateDate: now
  });
});

// GET /uploadStatus/:uploadId -> 200 OK
router.get('/uploadStatus/:uploadId', (req, res) => {
  const session = sessionUtils.getUploadSession(req.params.uploadId);
  if (!session) return res.status(404).json({ error: 'Not Found or Session Completed' });

  const now = new Date().toISOString();
  return res.status(200).json({
    id: session.uploadId || req.params.uploadId,
    fileName: session.fileName,
    location: session.path,
    destLocation: session.destination || '',
    tenant: req.user?.id || 'DEFAULT',
    status: session.status || 'InProgress',
    statusMessage: session.statusMessage || 'Upload session active',
    statusDate: now,
    insertDate: session.creationDate || now,
    deleted: false
  });
});

router.use((req, res) => {
  return res.status(404).json({ error: `Invalid Object Store service endpoint: ${req.method} ${req.originalUrl}` });
});

router.use((err, req, res, next) => {
  const status = err.statusCode || err.status || 500;
  return res.status(status).json({ error: err.message || 'An unexpected server error occurred.' });
});

module.exports = router;