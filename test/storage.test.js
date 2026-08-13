const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const StorageAdapter = require('../src/storageAdapter');
const MockProvider = require('./mockProvider');
const createTestApp = require('./testServer');

const TMP_TEST_DIR = path.join(__dirname, 'tmp_test_store');

test.beforeEach(() => {
  if (fs.existsSync(TMP_TEST_DIR)) {
    fs.rmSync(TMP_TEST_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(TMP_TEST_DIR, { recursive: true });
});

test.afterEach(() => {
  if (fs.existsSync(TMP_TEST_DIR)) {
    fs.rmSync(TMP_TEST_DIR, { recursive: true, force: true });
  }
});

test('MockProvider - core filesystem operations', async () => {
  const provider = new MockProvider(TMP_TEST_DIR);
  const instanceId = 'TEST_INST_01';

  // 1. Create path
  await provider.createPath(instanceId, ['docs', 'images']);
  assert.strictEqual(fs.existsSync(path.join(TMP_TEST_DIR, instanceId, 'docs')), true);
  assert.strictEqual(fs.existsSync(path.join(TMP_TEST_DIR, instanceId, 'images')), true);

  // 2. List
  const listBefore = await provider.list('', instanceId, '');
  assert.strictEqual(listBefore.length, 2);

  // 3. Upload stream / write file
  const sampleFile = path.join(TMP_TEST_DIR, 'sample.txt');
  fs.writeFileSync(sampleFile, 'Hello World!');
  await provider.uploadStream(`${instanceId}/docs/sample.txt`, null, sampleFile);
  assert.strictEqual(fs.existsSync(path.join(TMP_TEST_DIR, instanceId, 'docs/sample.txt')), true);

  // 4. Copy
  await provider.copy(`${instanceId}/docs/sample.txt`, `${instanceId}/docs/sample_copy.txt`);
  assert.strictEqual(fs.existsSync(path.join(TMP_TEST_DIR, instanceId, 'docs/sample_copy.txt')), true);

  // 5. Move
  await provider.move(`${instanceId}/docs/sample_copy.txt`, `${instanceId}/docs/sample_moved.txt`);
  assert.strictEqual(fs.existsSync(path.join(TMP_TEST_DIR, instanceId, 'docs/sample_copy.txt')), false);
  assert.strictEqual(fs.existsSync(path.join(TMP_TEST_DIR, instanceId, 'docs/sample_moved.txt')), true);

  // 6. Delete
  await provider.delete(`${instanceId}/docs/sample_moved.txt`);
  assert.strictEqual(fs.existsSync(path.join(TMP_TEST_DIR, instanceId, 'docs/sample_moved.txt')), false);
});

test('HTTP API - authentication and endpoints with MockProvider', async (t) => {
  const mockProvider = new MockProvider(TMP_TEST_DIR);
  StorageAdapter.getClient = async () => mockProvider;

  const app = createTestApp();
  const server = http.createServer(app);

  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;

  const mockToken = Buffer.from(JSON.stringify({ user: 'testuser', object_store_instance: 'INST_01' })).toString('base64');
  const validHeaders = {
    'Authorization': `Bearer ${mockToken}`,
    'Content-Type': 'application/json'
  };

  t.after(() => {
    server.close();
  });

  // Test 1: Missing auth header -> 401
  const unauthRes = await fetch(`${baseUrl}/Storage/INST_01/list`);
  assert.strictEqual(unauthRes.status, 401);

  // Test 2: Create path (via query) -> StorageItemResponseModel
  const createPathRes = await fetch(`${baseUrl}/Storage/INST_01/createPath?path=folder1`, {
    method: 'POST',
    headers: validHeaders
  });
  assert.strictEqual(createPathRes.status, 200);
  const createPathData = await createPathRes.json();
  assert.strictEqual(createPathData.name, 'folder1');
  assert.strictEqual(createPathData.isDirectory, true);

  // Test 2b: Create path (via header)
  const createPathHeaderRes = await fetch(`${baseUrl}/Storage/INST_01/createPath`, {
    method: 'POST',
    headers: { ...validHeaders, 'path': 'Inbox' }
  });
  assert.strictEqual(createPathHeaderRes.status, 200);

  // Test 3: List files -> StorageListResponseModel
  const listRes = await fetch(`${baseUrl}/Storage/INST_01/list`, {
    headers: validHeaders
  });
  assert.strictEqual(listRes.status, 200);
  const listData = await listRes.json();
  assert.strictEqual(Array.isArray(listData.items), true);
  assert.strictEqual(listData.bucket, 'INST_01');

  // Test 4: File upload via POST -> StorageItemResponseModel
  const uploadRes = await fetch(`${baseUrl}/Storage/INST_01/post?location=folder1/test.txt`, {
    method: 'POST',
    headers: { ...validHeaders, 'Content-Type': 'text/plain' },
    body: 'Test File Content'
  });
  assert.strictEqual(uploadRes.status, 200);
  const uploadData = await uploadRes.json();
  assert.strictEqual(uploadData.name, 'test.txt');

  // Test 5: Download uploaded file
  const getRes = await fetch(`${baseUrl}/Storage/INST_01/get?location=folder1/test.txt`, {
    headers: validHeaders
  });
  assert.strictEqual(getRes.status, 200);
  const textContent = await getRes.text();
  assert.strictEqual(textContent, 'Test File Content');

  // Test 6: Chunked upload flow (writeStart, writeChunk, writeComplete)
  const startRes = await fetch(`${baseUrl}/Storage/writeStart/chunked.txt`, {
    method: 'POST',
    headers: { ...validHeaders, 'Content-Type': 'text/plain' },
    body: 'Part1 '
  });
  assert.strictEqual(startRes.status, 200);
  const startData = await startRes.json();
  assert.strictEqual(startData.name, 'chunked.txt');

  const chunkRes = await fetch(`${baseUrl}/Storage/writeChunk/chunked.txt`, {
    method: 'POST',
    headers: { ...validHeaders, 'Content-Type': 'text/plain' },
    body: 'Part2'
  });
  assert.strictEqual(chunkRes.status, 200);
  const chunkData = await chunkRes.json();
  assert.strictEqual(chunkData.name, 'chunked.txt');

  const statusRes = await fetch(`${baseUrl}/Storage/uploadStatus/chunked.txt`, {
    headers: validHeaders
  });
  assert.strictEqual(statusRes.status, 200);
  const statusData = await statusRes.json();
  assert.strictEqual(statusData.fileName, 'chunked.txt');

  const completeRes = await fetch(`${baseUrl}/Storage/writeComplete/chunked.txt?destination=INST_01/folder1`, {
    method: 'POST',
    headers: validHeaders
  });
  assert.strictEqual(completeRes.status, 200);
  const completeData = await completeRes.json();
  assert.strictEqual(completeData.name, 'chunked.txt');
});
