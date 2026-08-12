const express = require('express');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const StorageAdapter = require('./storageAdapter');
const authMiddleware = require('./security');

const router = express.Router();

const TMP_DIR = path.join(__dirname, '../tmp_storage_chunks');
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

const activeUploads = {};

const normalizeRelativePath = (value) => {
  if (typeof value !== 'string') return '';
  return value.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/');
};

const resolvePathValue = (req, fallbackKeys = []) => {
  const keys = Array.isArray(fallbackKeys) ? fallbackKeys : [fallbackKeys];
  const candidates = [
    ...keys.flatMap((key) => [req.query?.[key], req.params?.[key]]),
    req.query?.path,
    req.query?.location,
    req.query?.StartIn,
    req.query?.sourcePath,
    req.query?.destinationPath,
    req.query?.storagePath,
    req.query?.storage,
    req.query?.destination
  ];

  return candidates.find((value) => typeof value === 'string' && value.trim().length > 0)?.trim();
};

const getUploadSession = (idOrName) => {
  if (!idOrName) return null;
  const direct = activeUploads[idOrName];
  if (direct) return direct;

  return Object.values(activeUploads).find((session) => session.fileName === idOrName) || null;
};

const toBinaryPayload = (req) => {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return Buffer.from(req.body);
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
  const tokenInstance = req.user?.attr?.abap_instance?.[0];
  const routeInstance = req.params.destinationName || req.query?.destinationName || req.query?.instance;
  const isMockMode = process.env.MOCK_LOCAL_STORAGE === 'true' || process.env.NODE_ENV === 'development';

  if (routeInstance && tokenInstance && tokenInstance !== routeInstance && !isMockMode) {
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

    const response = {
      status: 'Success',
      provisionedPath: targetedFolderStructure,
      name: normalizedPath,
      location: targetedFolderStructure,
      isDirectory: true,
      sizeInBytes: 0,
      storageType: 'Local'
    };

    res.status(201).json(response);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:destinationName/list', validateAndSetInstance, async (req, res) => {
  try {
    const provider = await StorageAdapter.getClient(req.instanceId);
    const subfolder = resolvePathValue(req, ['StartIn']) || '';
    const prefixFilter = `${req.instanceId}/${normalizeRelativePath(subfolder)}`.replace(/\/+/g, '/').replace(/\/$/, '');

    const files = (provider.constructor.name === 'LocalMockProvider')
      ? await provider.list(prefixFilter, req.instanceId, subfolder)
      : await provider.list(prefixFilter);

    const normalizedItems = (files || []).map((file) => ({
      name: file.name,
      sizeInBytes: file.size ?? 0,
      location: file.name,
      isDirectory: !!file.isFolder,
      storageType: provider.constructor.name,
      creationDate: file.modified || new Date().toISOString()
    }));

    res.json({
      bucket: req.instanceId,
      items: normalizedItems,
      files,
      recursive: req.query?.Recursive === 'true'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:destinationName/getChunk', validateAndSetInstance, async (req, res) => {
  try {
    const targetValue = resolvePathValue(req, ['location']);
    if (!targetValue) return res.status(400).json({ error: "Missing required 'location' parameter." });

    const targetPath = `${req.instanceId}/${normalizeRelativePath(targetValue)}`;
    const localFilePath = path.join(TMP_DIR, targetPath);
    if (!fs.existsSync(localFilePath)) return res.status(404).json({ error: 'File Not Found Locally' });

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
    res.status(500).json({ error: err.message });
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
      status: 'Copied',
      from: fullSource,
      to: fullDest,
      name: destinationFile,
      location: fullDest,
      isDirectory: false,
      sizeInBytes: 0
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
      status: 'Moved',
      from: fullSource,
      to: fullDest,
      name: destinationFile,
      location: fullDest,
      isDirectory: false,
      sizeInBytes: 0
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:destinationName/get', validateAndSetInstance, async (req, res) => {
  try {
    const provider = await StorageAdapter.getClient(req.instanceId);
    const targetPath = resolvePathValue(req, ['location']);
    if (!targetPath) return res.status(400).json({ error: "Missing required 'location' parameter." });

    await provider.download(`${req.instanceId}/${normalizeRelativePath(targetPath)}`, res);
  } catch (err) {
    res.status(500).json({ error: err.message });
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
    const tempFile = path.join(TMP_DIR, `${uuidv4()}-${path.basename(targetLocation)}`);
    fs.writeFileSync(tempFile, filePayload);
    await provider.uploadStream(targetPath, fs.createReadStream(tempFile), tempFile);
    fs.existsSync(tempFile) && fs.unlinkSync(tempFile);

    res.status(200).json({ status: 'Success', location: targetPath, sizeInBytes: filePayload.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
    const tempFile = path.join(TMP_DIR, `${uuidv4()}-${path.basename(targetLocation)}`);
    fs.writeFileSync(tempFile, filePayload);
    await provider.uploadStream(targetPath, fs.createReadStream(tempFile), tempFile);
    fs.existsSync(tempFile) && fs.unlinkSync(tempFile);

    res.status(202).json({ status: 'Accepted', location: targetPath, sizeInBytes: filePayload.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:destinationName/delete', validateAndSetInstance, async (req, res) => {
  try {
    const provider = await StorageAdapter.getClient(req.instanceId);
    const targetPath = resolvePathValue(req, ['location']);
    if (!targetPath) return res.status(400).json({ error: "Missing required 'location' parameter." });

    await provider.delete(`${req.instanceId}/${normalizeRelativePath(targetPath)}`);
    res.json({ status: 'Deleted', location: `${req.instanceId}/${normalizeRelativePath(targetPath)}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:destinationName/setStorage', validateAndSetInstance, async (req, res) => {
  try {
    const targetLocation = resolvePathValue(req, ['location']);
    const storageType = req.query?.storage || 'Archive';
    if (!targetLocation) return res.status(400).json({ error: "Missing required 'location' parameter." });

    res.json({
      status: 'Success',
      location: `${req.instanceId}/${normalizeRelativePath(targetLocation)}`,
      storageType
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/listWritable', async (req, res) => {
  try {
    const pending = Object.values(activeUploads).map((session) => ({
      fileName: session.fileName,
      path: session.path,
      status: 'Started'
    }));

    res.json(pending);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/getWritable/:fileName', (req, res) => {
  try {
    const session = getUploadSession(req.params.fileName);
    if (!session || !fs.existsSync(session.path)) {
      return res.status(404).json({ error: 'File Not Found or not writable.' });
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
    res.status(500).json({ error: err.message });
  }
});

router.post('/writeStart/:fileName', (req, res) => {
  try {
    fs.mkdirSync(TMP_DIR, { recursive: true });

    const uploadId = uuidv4();
    const filePath = path.join(TMP_DIR, uploadId);
    const dataBuffer = toBinaryPayload(req);

    fs.writeFileSync(filePath, dataBuffer);
    const session = { fileName: req.params.fileName, path: filePath, status: 'Started' };
    activeUploads[uploadId] = session;
    activeUploads[req.params.fileName] = session;

    res.status(201).json({ uploadId, status: 'Started' });
  } catch (err) {
    res.status(500).json({ error: `Upload start failed: ${err.message}` });
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
    res.json({ status: 'Appended' });
  } catch (err) {
    res.status(500).json({ error: `Upload append failed: ${err.message}` });
  }
};

router.post('/writeChunk/:fileName', handleChunkWrite);

router.post('/writeComplete/:fileName', async (req, res) => {
  try {
    const session = getUploadSession(req.params.fileName);
    if (!session) return res.status(404).json({ error: 'Context Expired' });
    if (!fs.existsSync(session.path)) {
      delete activeUploads[req.params.fileName];
      activeUploads[session.fileName] && delete activeUploads[session.fileName];
      return res.status(404).json({ error: 'Upload chunk file is missing. Please restart the upload.' });
    }

    const instanceKey = req.query?.destination || req.query?.storagePath || req.params?.destinationName || req.user?.attr?.abap_instance?.[0];
    if (!instanceKey) return res.status(400).json({ error: "Missing required 'destination' or 'storagePath' query parameter." });

    const locationDir = req.query?.destination || req.query?.storagePath || '';
    const targetFileName = session.fileName || path.basename(locationDir) || 'uploaded-file';
    const provider = await StorageAdapter.getClient(instanceKey);
    const dynamicTarget = `${normalizeRelativePath(locationDir || '')}/${targetFileName}`;
    const targetPath = `${instanceKey}/${normalizeRelativePath(dynamicTarget)}`;

    await provider.uploadStream(targetPath, fs.createReadStream(session.path), session.path);

    if (fs.existsSync(session.path)) fs.unlinkSync(session.path);
    delete activeUploads[req.params.fileName];
    activeUploads[session.fileName] && delete activeUploads[session.fileName];
    res.json({ status: 'Success', remotePath: targetPath });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/writeCancel/:fileName', (req, res) => {
  const session = getUploadSession(req.params.fileName);
  if (session && fs.existsSync(session.path)) fs.unlinkSync(session.path);
  if (session) {
    delete activeUploads[req.params.fileName];
    activeUploads[session.fileName] && delete activeUploads[session.fileName];
  }
  res.json({ status: 'Cancelled' });
});

router.get('/uploadStatus/:uploadId', (req, res) => {
  const session = getUploadSession(req.params.uploadId);
  if (!session) return res.json({ status: 'Not Found or Session Completed' });
  res.json({ status: session.status || 'Started', fileName: session.fileName, path: session.path });
});

module.exports = router;
