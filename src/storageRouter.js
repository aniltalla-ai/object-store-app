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

router.use(authMiddleware);

const checkInstanceSafety = (req, res, next) => {
  const tokenInstance = req.user?.attr?.abap_instance?.[0];
  const routeInstance = req.headers['x-storage-location'] || req.params.destinationName;

  if (!routeInstance) {
    return res.status(400).json({ error: "Missing required 'x-storage-location' header." });
  }

  if (tokenInstance !== routeInstance) {
    return res.status(403).json({
      error: `Security Alert Mismatch: Authenticated token represents system [${tokenInstance}], but request header attempted to manipulate location context [${routeInstance}].`
    });
  }

  req.instanceId = routeInstance;
  next();
};

router.post('/:destinationName/createPath', checkInstanceSafety, async (req, res) => {
  try {
    const provider = await StorageAdapter.getClient(req.instanceId);
    const customPath = req.headers['path'];
    if (!customPath) return res.status(400).json({ error: "Missing required 'path' header." });

    const targetedFolderStructure = `${req.instanceId}/${customPath.replace(/^\/+|\/+$/g, '')}`;
    await provider.createPath(req.instanceId, [customPath]);

    res.status(201).json({ status: 'Success', provisionedPath: targetedFolderStructure });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:destinationName/list', checkInstanceSafety, async (req, res) => {
  try {
    const provider = await StorageAdapter.getClient(req.instanceId);
    const subfolder = req.headers['path'] || '';
    const prefixFilter = `${req.instanceId}/${subfolder}`;

    const files = (provider.constructor.name === 'LocalMockProvider')
      ? await provider.list(prefixFilter, req.instanceId, subfolder)
      : await provider.list(prefixFilter);

    res.json({ files });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:destinationName/copy', checkInstanceSafety, async (req, res) => {
  try {
    const provider = await StorageAdapter.getClient(req.instanceId);
    const sourceFile = req.headers['sourcefile'];
    const destinationFile = req.headers['destinationfile'];

    if (!sourceFile || !destinationFile) {
      return res.status(400).json({ error: "Missing 'sourceFile' or 'destinationFile' headers." });
    }

    const fullSource = `${req.instanceId}/${sourceFile.replace(/^\//, '')}`;
    const fullDest = `${req.instanceId}/${destinationFile.replace(/^\//, '')}`;

    await provider.copy(fullSource, fullDest);
    res.json({ status: 'Copied', from: fullSource, to: fullDest });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:destinationName/move', checkInstanceSafety, async (req, res) => {
  try {
    const provider = await StorageAdapter.getClient(req.instanceId);
    const sourceFile = req.headers['sourcefile'];
    const destinationFile = req.headers['destinationfile'];

    if (!sourceFile || !destinationFile) {
      return res.status(400).json({ error: "Missing 'sourceFile' or 'destinationFile' headers." });
    }

    const fullSource = `${req.instanceId}/${sourceFile.replace(/^\//, '')}`;
    const fullDest = `${req.instanceId}/${destinationFile.replace(/^\//, '')}`;

    await provider.move(fullSource, fullDest);
    res.json({ status: 'Moved', from: fullSource, to: fullDest });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:destinationName/get', checkInstanceSafety, async (req, res) => {
  try {
    const provider = await StorageAdapter.getClient(req.instanceId);
    const targetPath = req.headers['path'];
    if (!targetPath) return res.status(400).json({ error: "Missing required 'path' header." });

    await provider.download(`${req.instanceId}/${targetPath.replace(/^\//, '')}`, res);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:destinationName/delete', checkInstanceSafety, async (req, res) => {
  try {
    const provider = await StorageAdapter.getClient(req.instanceId);
    const targetPath = req.headers['path'];
    if (!targetPath) return res.status(400).json({ error: "Missing required 'path' header." });

    await provider.delete(`${req.instanceId}/${targetPath.replace(/^\//, '')}`);
    res.json({ status: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/writeStart/:fileName', (req, res) => {
  const uploadId = uuidv4();
  const filePath = path.join(TMP_DIR, uploadId);
  const dataBuffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');

  fs.writeFileSync(filePath, dataBuffer);
  activeUploads[uploadId] = { fileName: req.params.fileName, path: filePath };
  res.status(201).json({ uploadId, status: 'Started' });
});

router.post('/writeChunk/:uploadId', (req, res) => {
  const session = activeUploads[req.params.uploadId];
  if (!session) return res.status(404).json({ error: 'Missing session context mapping.' });
  const dataBuffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');
  fs.appendFileSync(session.path, dataBuffer);
  res.json({ status: 'Appended' });
});

router.post('/writeComplete/:uploadId', checkInstanceSafety, async (req, res) => {
  try {
    const session = activeUploads[req.params.uploadId];
    if (!session) return res.status(404).json({ error: 'Context Expired' });

    const locationDir = req.headers['location'];
    if (!locationDir) return res.status(400).json({ error: "Missing required target 'location' directory header attribute." });

    const provider = await StorageAdapter.getClient(req.instanceId);
    const dynamicTarget = `${locationDir.replace(/^\/+|\/+$/g, '')}/${session.fileName}`;
    const targetPath = `${req.instanceId}/${dynamicTarget}`;

    await provider.uploadStream(targetPath, fs.createReadStream(session.path), session.path);

    if (fs.existsSync(session.path)) fs.unlinkSync(session.path);
    delete activeUploads[req.params.uploadId];
    res.json({ status: 'Success', remotePath: targetPath });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/writeCancel/:uploadId', (req, res) => {
  const session = activeUploads[req.params.uploadId];
  if (session && fs.existsSync(session.path)) fs.unlinkSync(session.path);
  delete activeUploads[req.params.uploadId];
  res.json({ status: 'Cancelled' });
});

router.get('/uploadStatus/:uploadId', (req, res) => {
  res.json(activeUploads[req.params.uploadId] || { status: 'Not Found or Session Completed' });
});

module.exports = router;
