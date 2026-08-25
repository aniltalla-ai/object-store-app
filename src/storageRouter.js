const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { v4: uuidv4 } = require('uuid');
const StorageAdapter = require('./storageAdapter');
const xsuaaAuth = require('./security');

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

const getParam = (req, key) => {
  let val = req.query?.[key] ?? req.body?.[key] ?? req.params?.[key] ?? req.headers?.[key];
  if(!val){
    key = key.toLowerCase();
    val = req.query?.[key] ?? req.body?.[key] ?? req.params?.[key] ?? req.headers?.[key];
  }
  return typeof val === 'string' ? val.trim() : '';
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

router.use(xsuaaAuth);

// Attach Storage Provider in ONE single place for all routes
router.use(async (req, res, next) => {
  try {
    const credentials = req.credentials || null;
    const destinationName = req.params.destinationName || null;
    const isUseDestionation = req.isUseDestionation || false;
    req.provider = await StorageAdapter.getClient(credentials, destinationName, isUseDestionation);
    next();
  } catch (err) {
    console.error('[STORAGE ADAPTER INIT ERROR]', err.message);
    return res.status(500).json({ error: `Storage provider initialization failed: ${err.message}` });
  }
});

router.get('/list', async (req, res) => {
  try {
    const provider = req.provider;
    const startWith = getParam(req, 'startIn') || '';
    const normalizedSub = normalizeRelativePath(startWith);
    const recursiveVal = getParam(req, 'recursive').toLowerCase();
    const isRecursive = ['true'].includes(recursiveVal);
    const foldersOnlyVal = getParam(req, 'foldersOnly').toLowerCase();
    const isFoldersOnly = ['true'].includes(foldersOnlyVal);

    let files = [];
    try {
      files = await provider.list(normalizedSub);
    } catch (listErr) {
      files = [];
    }

    const itemsMap = new Map();
    const folderLocations = new Set();
    (files || []).forEach((file) => {
      let rawPath = file.name?.replace(/\\/g, '/') || '';
      if(!rawPath) return;
      let isDir = !!file.isFolder || rawPath.endsWith('/') || rawPath.endsWith('.init');

      if (rawPath.endsWith('/.init')) {
        rawPath = rawPath.slice(0, -6);
      } else if (rawPath.endsWith('/')) {
        rawPath = rawPath.slice(0, -1);
      } else if (rawPath === '.init') {
        return;
      }

      if(!rawPath) return;

      const pathParts = rawPath.split('/');
      pathParts.pop();
      let currentParent = '';
      for(const part of pathParts){
        if(!part) continue;
        currentParent = currentParent ? `${currentParent}/${part}` : part;
        folderLocations.add(currentParent);
      }

      if (isDir) {
        folderLocations.add(rawPath);
      }
      else {  
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
      if(!folderPath) return;
      const fileName = folderPath.split('/').pop() || '';
      if(!fileName) return;
      itemsMap.set(folderPath, {
        name: fileName,
        sizeInBytes: 0,
        location: folderPath,
        isDirectory: true,
        storageType: provider.constructor.name || 'Local',
        lineCount: null,
        createDate: new Date().toISOString()
      })
    });

    let items = Array.from(itemsMap.values());
    
    if(isFoldersOnly){
      items = items.filter(item => item.isDirectory);
    }

      const prefix = normalizedSub || '';
      items = items.filter((item) => {
        if (!normalizedSub) {
          return !item.location.includes('/');
        }
        if (!item.location.startsWith(prefix)) return false;
        if(isRecursive){
          return true;
        }
        const relative = item.location.substring(prefix.length + (prefix.endsWith('/') ? 0 : 1));
        return relative.length > 0 && !relative.includes('/');
      });
    

    res.json({
      bucket: req.instanceId,
      items: items
    });
  } catch (err) {
    res.json({
      bucket: req.instanceId || '',
      items: []
    });
  }
});

router.post('/createPath', async (req, res) => {
  try {
    const provider = req.provider;
    const customPath = getParam(req, 'path');
    if (!customPath) return res.status(400).json({ error: "Missing required 'path' parameter." });

    const normalizedPath = normalizeRelativePath(customPath);
    await provider.createPath([normalizedPath]);

    res.status(200).json({
      name: path.basename(normalizedPath),
      sizeInBytes: 0,
      location: normalizedPath,
      isDirectory: true,
      storageType: provider.constructor.name || 'Local',
      lineCount: null,
      creationDate: new Date().toISOString()
    });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Failed to create path.' });
  }
});

router.get('/getChunk', async (req, res) => {
  try {
    const targetValue = getParam(req, 'location');
    if (!targetValue) return res.status(400).json({ error: "Missing required 'location' parameter." });

    const targetPath = normalizeRelativePath(targetValue);
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

router.post('/copy', async (req, res) => {
  try {
    const sourceFile = getParam(req, 'sourcePath');
    const destinationFile = getParam(req, 'destinationPath');
    const provider = req.provider; 

    if (!sourceFile || !destinationFile) {
      return res.status(400).json({ error: "Missing 'sourcePath' or 'destinationPath' parameters." });
    }

    const normSource = normalizeRelativePath(sourceFile);
    const normDest = normalizeRelativePath(destinationFile);
    
    await provider.copy(normSource, normDest);
    res.json({
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
    res.status(400).json({ error: err.message || 'Copy operation failed.' });
  }
});

router.post('/move', async (req, res) => {
  try {
    const provider = req.provider;
    const sourceFile = getParam(req, 'sourcePath');
    const destinationFile = getParam(req, 'destinationPath');

    if (!sourceFile || !destinationFile) {
      return res.status(400).json({ error: "Missing 'sourcePath' or 'destinationPath' parameters." });
    }

    const normSource = normalizeRelativePath(sourceFile);
    const normDest = normalizeRelativePath(destinationFile);
    
    await provider.move(normSource, normDest);
    res.json({
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
    res.status(400).json({ error: err.message || 'Move operation failed.' });
  }
});

router.get('/get', async (req, res) => {
  try {
    const provider = req.provider;
    const targetPath = getParam(req, 'location');
    if (!targetPath) return res.status(400).json({ error: "Missing required 'location' parameter." });

    const normTarget = normalizeRelativePath(targetPath);
    await provider.download(normTarget, res);
  } catch (err) {
    const msg = err.message || '';
    if (msg.includes('Not Found') || msg.includes('no such file') || msg.includes('404') || err.code === 'ENOENT') {
      return res.status(404).json({ error: "File not found at specified location." });
    }
    res.status(500).json({ error: err.message || 'Download operation failed.' });
  }
});

router.post('/post', async (req, res) => {
  try {
    const provider = req.provider;
    const targetLocation = getParam(req, 'location');
    if (!targetLocation) return res.status(400).json({ error: "Missing required 'location' query parameter." });

    const filePayload = toBinaryPayload(req);
    if (!filePayload || filePayload.length === 0) return res.status(400).json({ error: 'Empty file payload.' });

    const targetPath = normalizeRelativePath(targetLocation);
    fs.mkdirSync(TEMP_DIR, { recursive: true });
    const tempFile = path.join(TEMP_DIR, `${uuidv4()}-${path.basename(targetLocation)}`);
    fs.writeFileSync(tempFile, filePayload);
    const readStream = fs.createReadStream(tempFile);
    readStream.on('error', () => { });
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

router.post('/postasync', async (req, res) => {
  try {
    const provider = req.provider;
    const targetLocation = getParam(req, 'location');
    if (!targetLocation) return res.status(400).json({ error: "Missing required 'location' query parameter." });

    const filePayload = toBinaryPayload(req);
    if (!filePayload || filePayload.length === 0) return res.status(400).json({ error: 'Empty file payload.' });

    const targetPath = normalizeRelativePath(targetLocation);
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

router.delete('/delete', async (req, res) => {
  try {
    const provider = req.provider;
    const targetPath = getParam(req, 'location');
    if (!targetPath) return res.status(400).json({ error: "Missing required 'location' parameter." });

    const fullPath = normalizeRelativePath(targetPath);
    try {
      await provider.delete(fullPath);
    } catch (delErr) {
      // Idempotent delete - swallow if file non-existent
    }
    res.status(200).send();
  } catch (err) {
    res.status(200).send();
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

    const rawDest = getParam(req, 'destination') || '';
    const rawStoragePath = getParam(req, 'storagePath') || '';

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

    const provider = req.provider || (await StorageAdapter.getClient(req.credentials || instanceKey));

    const stat = fs.statSync(session.path);
    const fileSize = stat.size;

    const readStream = fs.createReadStream(session.path);
    readStream.on('error', () => { });
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
