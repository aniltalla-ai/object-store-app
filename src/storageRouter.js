const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { Writable } = require('stream');
const { v4: uuidv4 } = require('uuid');
const StorageAdapter = require('./storageAdapter');
const xsuaaAuth = require('./security');

const router = express.Router();

const TEMP_DIR = path.join(os.tmpdir(), 'object_store_temp');
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

const activeUploads = {};

const normalizeRelativePath = (value) => {
  if (typeof value !== 'string') return '';
  return value.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/');
};

const getParam = (req, key) => {
  let val = req.query?.[key] ?? req.body?.[key] ?? req.params?.[key] ?? req.headers?.[key];
  if (!val) {
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
  if (req.body && typeof req.body === 'object') {
    const fileValue = req.body.file || req.body.data || req.body.content;
    if (Buffer.isBuffer(fileValue)) return fileValue;
    if (typeof fileValue === 'string') return Buffer.from(fileValue);
  }
  return Buffer.alloc(0);
};

const ensureBinaryPayload = (req, res, next) => {
  if (Buffer.isBuffer(req.body) || (req.body && Object.keys(req.body).length > 0)) {
    return next();
  }
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    if (chunks.length > 0) {
      req.body = Buffer.concat(chunks);
    }
    next();
  });
  req.on('error', (err) => next(err));
};

const applyChunking = (payload, query) => {
  const chunkType = (query?.chunkType || 'Binary').toLowerCase();
  const chunkSize = Number(query?.chunkSize || 0);
  const chunkPart = Number(query?.chunkPart || 0);
  const startLine = Number(query?.startLine || 0);

  if (chunkType === 'line') {
    const lines = payload.toString('utf8').split(/\r?\n/);
    const startIndex = Math.max(0, startLine);
    const endIndex = chunkSize > 0 ? startIndex + chunkSize : lines.length;
    return Buffer.from(lines.slice(startIndex, endIndex).join('\n'));
  } else if (chunkSize > 0 && chunkPart > 0) {
    const startIndex = (chunkPart - 1) * chunkSize;
    return payload.subarray(startIndex, startIndex + chunkSize);
  } else if (chunkSize > 0) {
    return payload.subarray(0, chunkSize);
  }
  return payload;
};

const createUploadSession = (fileName, initialBuffer = Buffer.alloc(0)) => {
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
    updateDate: now
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

const finalizeSessionUpload = async (session, targetPath, provider) => {
  if (!fs.existsSync(session.path)) throw new Error('Upload session file missing.');
  
  const stat = fs.statSync(session.path);
  const fileSize = stat.size;

  const readStream = fs.createReadStream(session.path);
  readStream.on('error', () => {});
  
  await provider.uploadStream(targetPath, readStream, session.path);

  if (fs.existsSync(session.path)) fs.unlinkSync(session.path);
  delete activeUploads[session.uploadId];
  delete activeUploads[session.fileName];

  return fileSize;
};

const cleanupSession = (session) => {
  if (session && fs.existsSync(session.path)) fs.unlinkSync(session.path);
  if (session) {
    delete activeUploads[session.uploadId];
    delete activeUploads[session.fileName];
  }
};

router.use(xsuaaAuth);

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

    res.json({ bucket: req.instanceId, items });
  } catch (err) {
    res.json({ bucket: req.instanceId || '', items: [] });
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

// router.get('/getChunk', async (req, res) => {
//   try {
//     const provider = req.provider;
//     const targetValue = getParam(req, 'location');
//     if (!targetValue) return res.status(400).json({ error: "Missing required 'location' parameter." });

//     const targetPath = normalizeRelativePath(targetValue);
//     const chunks = [];
//     const writableStream = new Writable({
//       write(chunk, encoding, callback) {
//         chunks.push(chunk);
//         callback();
//       }
//     });

//     await new Promise((resolve, reject) => {
//       writableStream.on('finish', resolve);
//       writableStream.on('error', reject);
//       Promise.resolve(provider.download(targetPath, writableStream)).catch(reject);
//     });

//     const payload = Buffer.concat(chunks);
//     if (!payload || payload.length === 0) {
//       return res.status(404).json({ error: 'File not found at specified location.' });
//     }

//     const output = applyChunking(payload, req.query);
//     res.type('application/octet-stream').send(output);
//   } catch (err) {
//     res.status(404).json({ error: 'File not found at specified location.' });
//   }
// });

router.get('/getChunk', async (req, res) => {
  try {
    const provider = req.provider;
    const targetValue = getParam(req, 'location');
    if (!targetValue) return res.status(400).json({ error: "Missing required 'location' parameter." });

    const targetPath = normalizeRelativePath(targetValue);
    
    // Parse query options for range mapping
    const chunkSize = Number(getParam(req, 'chunkSize') || 0);
    const chunkPart = Number(getParam(req, 'chunkPart') || 0);
    const chunkType = (getParam(req, 'chunkType') || 'Binary').toLowerCase();

    let options = {};
    if (chunkType === 'binary' && chunkSize > 0 && chunkPart > 0) {
      const start = (chunkPart - 1) * chunkSize;
      const end = start + chunkSize - 1;
      options = { start, end }; // e.g., bytes=0-1023
    } else if (chunkType === 'binary' && chunkSize > 0) {
      options = { start: 0, end: chunkSize - 1 };
    }

    res.type('application/octet-stream');
    // Pass options directly to cloud provider range downloader
    await provider.download(targetPath, res, options);
  } catch (err) {
    res.status(404).json({ error: 'File not found or range invalid.' });
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

router.post('/post', ensureBinaryPayload, async (req, res) => {
  try {
    const targetLocation = getParam(req, 'location');
    if (!targetLocation) return res.status(400).json({ error: "Missing required 'location' parameter." });

    const filePayload = toBinaryPayload(req);
    if (!filePayload || filePayload.length === 0) return res.status(400).json({ error: 'Empty file payload.' });

    const targetPath = normalizeRelativePath(targetLocation);
    const session = createUploadSession(targetLocation, filePayload);
    
    const fileSize = await finalizeSessionUpload(session, targetPath, req.provider);

    res.status(200).json({
      name: session.fileName,
      sizeInBytes: fileSize,
      location: targetPath,
      isDirectory: false,
      storageType: req.provider.constructor.name || 'Local',
      lineCount: null,
      creationDate: session.creationDate
    });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Upload failed.' });
  }
});

router.post('/postasync', ensureBinaryPayload, async (req, res) => {
  try {
    const targetLocation = getParam(req, 'location');
    if (!targetLocation) return res.status(400).json({ error: "Missing required 'location' parameter." });

    const filePayload = toBinaryPayload(req);
    if (!filePayload || filePayload.length === 0) return res.status(400).json({ error: 'Empty file payload.' });

    const targetPath = normalizeRelativePath(targetLocation);
    const session = createUploadSession(targetLocation, filePayload);
    session.destination = targetPath;

    res.status(202).json({
      id: session.uploadId,
      fileName: session.fileName,
      status: 'InProgress',
      message: 'Async upload started.'
    });

    setImmediate(async () => {
      try {
        await finalizeSessionUpload(session, targetPath, req.provider);
        session.status = 'Completed';
        session.updateDate = new Date().toISOString();
      } catch (bgErr) {
        session.status = 'Failed';
        session.statusMessage = bgErr.message;
        session.updateDate = new Date().toISOString();
        cleanupSession(session);
      }
    });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Async upload failed.' });
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
    const output = applyChunking(payload, req.query);

    res.type('application/octet-stream').send(output);
  } catch (err) {
    res.status(404).json({ error: 'File not found or writable.' });
  }
});

router.post('/writeStart/:fileName', ensureBinaryPayload, (req, res) => {
  try {
    const dataBuffer = toBinaryPayload(req);
    const session = createUploadSession(req.params.fileName, dataBuffer);

    res.status(200).json({
      name: session.fileName,
      sizeInBytes: dataBuffer.length,
      lineCount: null,
      creationDate: session.creationDate,
      updateDate: session.updateDate
    });
  } catch (err) {
    res.status(400).json({ error: `Upload start failed: ${err.message}` });
  }
});

router.post('/writeChunk/:fileName', ensureBinaryPayload, (req, res) => {
  const session = getUploadSession(req.params.fileName);
  if (!session) return res.status(404).json({ error: 'Missing session context mapping.' });

  try {
    const dataBuffer = toBinaryPayload(req);
    const size = appendToSession(session, dataBuffer);

    res.json({
      name: session.fileName,
      sizeInBytes: size,
      lineCount: null,
      creationDate: session.creationDate,
      updateDate: session.updateDate
    });
  } catch (err) {
    res.status(400).json({ error: `Upload append failed: ${err.message}` });
  }
});

router.post('/writeComplete/:fileName', async (req, res) => {
  try {
    const session = getUploadSession(req.params.fileName);
    if (!session) return res.status(404).json({ error: 'Upload session context expired or missing.' });

    const rawDest = getParam(req, 'destination') || '';
    const rawStoragePath = getParam(req, 'storagePath') || '';
    let instanceKey = req.user?.attr?.object_store_instance?.[0];
    let folderPath = '';

    if (rawDest) {
      const parts = normalizeRelativePath(rawDest).split('/');
      instanceKey = parts[0] || instanceKey;
      if (parts.length > 1) folderPath = parts.slice(1).join('/');
    }

    if (rawStoragePath) {
      const normalizedStorage = normalizeRelativePath(rawStoragePath);
      if (instanceKey && normalizedStorage.startsWith(`${instanceKey}/`)) {
        folderPath = normalizedStorage.substring(instanceKey.length + 1);
      } else {
        folderPath = folderPath ? `${folderPath}/${normalizedStorage}` : normalizedStorage;
      }
    }

    if (!instanceKey) return res.status(400).json({ error: "Missing required destination/storagePath parameter." });

    const relativeTarget = folderPath ? `${folderPath}/${session.fileName}` : session.fileName;
    const targetPath = `${instanceKey}/${normalizeRelativePath(relativeTarget)}`;

    const fileSize = await finalizeSessionUpload(session, targetPath, req.provider);

    res.json({
      name: session.fileName,
      sizeInBytes: fileSize,
      location: targetPath,
      isDirectory: false,
      storageType: req.provider.constructor.name || 'Local',
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
  
  cleanupSession(session);

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
    status: session.status || 'InProgress',
    statusMessage: session.statusMessage || 'Upload session active',
    statusDate: now,
    insertDate: session.creationDate || now,
    deleted: false
  });
});

router.use((req, res) => {
  res.status(404).json({ error: `Invalid Object Store service endpoint: ${req.method} ${req.originalUrl}` });
});

router.use((err, req, res, next) => {
  const status = err.statusCode || err.status || 500;
  res.status(status).json({ error: err.message || 'An unexpected server error occurred.' });
});

module.exports = router;