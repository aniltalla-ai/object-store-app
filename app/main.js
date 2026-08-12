const pathInput = document.getElementById('path');
const statusArea = document.getElementById('statusArea');
const results = document.getElementById('results');
const selectedFileLabel = document.getElementById('selectedFile');
const tokenValue = document.getElementById('tokenValue');
const configuredInstanceDisplay = document.getElementById('configuredInstanceDisplay');

const configureBtn = document.getElementById('configureBtn');
const configModal = document.getElementById('configModal');
const closeConfigModal = document.getElementById('closeConfigModal');
const configRootFolder = document.getElementById('configRootFolder');
const configInstanceName = document.getElementById('configInstanceName');
const configConfirmBtn = document.getElementById('configConfirmBtn');
const configCancelBtn = document.getElementById('configCancelBtn');

const listBtn = document.getElementById('listBtn');
const uploadBtn = document.getElementById('uploadBtn');
const downloadBtn = document.getElementById('downloadBtn');
const deleteBtn = document.getElementById('deleteBtn');
const generateAuthBtn = document.getElementById('generateAuthBtn');
const instanceSelect = document.getElementById('instanceSelect');

const uploadModal = document.getElementById('uploadModal');
const closeModal = document.getElementById('closeModal');
const modalFileInput = document.getElementById('modalFileInput');
const modalUploadLocation = document.getElementById('modalUploadLocation');
const modalUploadConfirm = document.getElementById('modalUploadConfirm');
const modalUploadCancel = document.getElementById('modalUploadCancel');

const toastContainer = document.getElementById('toastContainer');

const apiBase = '/Storage';
let mockAuthToken = '';
let lastAuthInstance = '';
let configuredInstance = '';
let configuredInstances = [];
let selectedFilePath = '';
let currentPath = '';

const normalizePath = (path) => path.replace(/^\/+|\/+$/g, '');

const getAuthHeaders = () => {
  if (!configuredInstance) throw new Error('Storage instance is not configured.');
  if (!mockAuthToken || configuredInstance !== lastAuthInstance) {
    generateMockAuth();
  }

  return {
    Authorization: `Bearer ${mockAuthToken}`,
    'x-storage-location': configuredInstance
  };
};

const getCurrentPath = () => normalizePath(pathInput.value.trim());

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const classifyEntryType = (name, size) => {
  const lower = name.toLowerCase();
  if (size == null) return 'Folder';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'JPG';
  if (lower.endsWith('.png')) return 'PNG';
  if (lower.endsWith('.pdf')) return 'PDF';
  if (lower.endsWith('.txt')) return 'TXT';
  if (lower.endsWith('.doc') || lower.endsWith('.docx')) return 'DOC';
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) return 'XLSX';
  if (name.includes('.')) return name.split('.').pop().toUpperCase();
  return 'File';
};

const formatSize = (size) => {
  if (size == null) return '-';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(2)} MB`;
};

const setStatus = (text, isError = false) => {
  showToast(text, isError);
  statusArea.textContent = text;
  statusArea.style.color = isError ? '#b00020' : '#0f4c81';
};

const showToast = (message, isError = false) => {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `<div>${message}</div><button aria-label="Close toast">×</button>`;
  if (isError) toast.style.background = '#a61d24';
  toast.querySelector('button').addEventListener('click', () => toast.remove());
  toastContainer.appendChild(toast);
  setTimeout(() => toast.remove(), 2000);
};

const generateMockAuth = () => {
  if (!configuredInstance) return setStatus('Configure a storage instance first.', true);

  const payload = {
    user: 'MOCK_USER',
    abap_instance: configuredInstance
  };
  mockAuthToken = btoa(JSON.stringify(payload));
  lastAuthInstance = configuredInstance;
  tokenValue.textContent = mockAuthToken || 'None';
  setStatus('Mock auth token generated.');
};

const updateSelectedFile = (path) => {
  selectedFilePath = path || '';
  selectedFileLabel.textContent = selectedFilePath || 'None';
  downloadBtn.disabled = !selectedFilePath;
  deleteBtn.disabled = !selectedFilePath;
};

const saveConfiguredInstances = () => {
  localStorage.setItem('storageInstances', JSON.stringify(configuredInstances));
};

const updateInstanceOptions = () => {
  instanceSelect.innerHTML = '<option value="">Select instance</option>';
  configuredInstances.forEach((instance) => {
    const option = document.createElement('option');
    option.value = instance;
    option.textContent = instance;
    instanceSelect.appendChild(option);
  });
  instanceSelect.value = configuredInstance || '';
};

const setConfiguredInstance = (instanceName) => {
  configuredInstance = instanceName;
  if (instanceName && !configuredInstances.includes(instanceName)) {
    configuredInstances.push(instanceName);
    saveConfiguredInstances();
  }
  configuredInstanceDisplay.textContent = configuredInstance || 'None';
  updateInstanceOptions();
};

const loadConfiguredInstances = async () => {
  const stored = JSON.parse(localStorage.getItem('storageInstances') || '[]');
  if (Array.isArray(stored)) {
    configuredInstances = stored;
  }
  updateInstanceOptions();
  if (configuredInstances.length === 1) {
    setConfiguredInstance(configuredInstances[0]);
    await listFiles();
  }
};

const buildListEntries = (files) => {
  const prefix = getCurrentPath();
  const folderMap = {};
  const fileRows = [];

  files.forEach((file) => {
    const rawName = file.name?.replace(/\\/g, '/') || '';
    const relative = prefix ? rawName.replace(new RegExp(`^${escapeRegExp(prefix)}\\/`), '') : rawName;
    if (!relative || relative.startsWith('..')) return;

    const isFolder = file.isFolder || relative.includes('/');
    if (isFolder) {
      const folderName = relative.split('/')[0];
      const folderPath = prefix ? `${prefix}/${folderName}` : folderName;
      folderMap[folderName] = {
        name: folderName,
        type: 'Folder',
        size: '-',
        modified: '-',
        path: folderPath,
        isFolder: true
      };
    } else {
      fileRows.push({
        name: relative,
        type: classifyEntryType(relative, file.size),
        size: formatSize(file.size),
        modified: file.modified ? new Date(file.modified).toLocaleString() : '-',
        path: prefix ? `${prefix}/${relative}` : relative,
        isFolder: false
      });
    }
  });

  return [...Object.values(folderMap).sort((a, b) => a.name.localeCompare(b.name)), ...fileRows.sort((a, b) => a.name.localeCompare(b.name))];
};

const showUploadModal = () => {
  if (!configuredInstance) {
    setStatus('Configure a storage instance before uploading.', true);
    return;
  }

  modalFileInput.value = '';
  modalUploadLocation.value = currentPath || '';
  uploadModal.classList.add('visible');
};

const hideUploadModal = () => {
  uploadModal.classList.remove('visible');
};

const showConfigModal = () => {
  configInstanceName.value = configuredInstance || '';
  configRootFolder.value = '';
  configModal.classList.add('visible');
};

const handleInstanceSelect = async () => {
  const selected = instanceSelect.value;
  configuredInstance = selected;
  configuredInstanceDisplay.textContent = configuredInstance || 'None';
  if (configuredInstance) {
    pathInput.value = '';
    currentPath = '';
    setCurrentPathDisplay();
    await listFiles();
  }
};

const hideConfigModal = () => {
  configModal.classList.remove('visible');
};

const createRootFolder = async () => {
  const instanceValue = normalizePath(configInstanceName.value.trim()) || instanceSelect.value || configuredInstance;
  if (!instanceValue) return setStatus('Enter a valid storage instance name.', true);

  const root = normalizePath(configRootFolder.value.trim());

  setConfiguredInstance(instanceValue);
  setAppState();
  getAuthHeaders();

  try {
    const subfolders = ['Inbox', 'Outbox', 'Processed', 'Queue'];
    for (const folder of subfolders) {
      const pathHeader = root ? `${root}/${folder}` : folder;
      await fetch(`${apiBase}/${encodeURIComponent(instanceValue)}/createPath`, {
        method: 'POST',
        headers: buildHeaders({ path: pathHeader })
      });
    }
    hideConfigModal();
    pathInput.value = root || '';
    currentPath = root || '';
    setCurrentPathDisplay();
    await listFiles();
    setStatus(`Configured instance ${instanceValue} and created default subfolders${root ? ' under ' + root : ''}.`);
  } catch (err) {
    setStatus(err.message, true);
  }
};

const buildHeaders = (extra = {}) => ({
  ...getAuthHeaders(),
  ...extra
});

const setAppState = () => {
  const hide = !configuredInstance;
  document.body.classList.toggle('hide-table', hide);
  document.getElementById('emptyState').style.display = hide ? 'block' : 'none';
};

const setCurrentPathDisplay = () => {
  const instanceLabel = configuredInstance ? `Instance: ${configuredInstance}` : 'Instance: None';
  const pathLabel = currentPath ? ` / ${currentPath}` : '';
  document.getElementById('selectedPathDisplay').textContent = `${instanceLabel}${pathLabel}`;
};

const listFiles = async () => {
  if (!configuredInstance) return setStatus('Configure a storage instance first.', true);

  currentPath = getCurrentPath();
  setCurrentPathDisplay();
  setStatus('Listing files...');

  try {
    const resp = await fetch(`${apiBase}/${encodeURIComponent(configuredInstance)}/list`, {
      method: 'GET',
      headers: buildHeaders({ path: currentPath })
    });

    const payload = await resp.json();
    if (!resp.ok) throw new Error(payload.error || 'Failed to list files');

    if (!payload.files || !payload.files.length) {
      updateSelectedFile('');
      results.innerHTML = '<div class="preformatted">No files or folders found.</div>';
      setStatus(`No files or folders found in /${currentPath || ''}.`, true);
      return;
    }

    updateSelectedFile('');
    displayList(payload.files || []);
    setStatus(`Listing /${currentPath || ''} completed.`);
  } catch (err) {
    setStatus(err.message, true);
    results.innerHTML = '';
  }
};

const displayList = (files) => {
  const entries = buildListEntries(files);

  if (!entries.length) {
    results.innerHTML = '<div class="preformatted">No files or folders found.</div>';
    return;
  }

  const rows = entries.map((entry) => `
    <tr class="selectable" data-path="${encodeURIComponent(entry.path)}" data-isfolder="${entry.isFolder}" data-isinstance="${entry.isInstance ? 'true' : 'false'}">
      <td>${entry.isFolder ? '📁 ' : '📄 '}${entry.name}</td>
      <td>${entry.type}</td>
      <td>${entry.size}</td>
      <td>${entry.modified}</td>
    </tr>
  `).join('');

  results.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Type</th>
          <th>Size</th>
          <th>Date and Time</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;

  results.querySelectorAll('tr.selectable').forEach((row) => {
    row.addEventListener('click', () => {
      const path = decodeURIComponent(row.dataset.path);
      const isFolder = row.dataset.isfolder === 'true';
      const isInstance = row.dataset.isinstance === 'true';
      results.querySelectorAll('tr.selected').forEach((r) => r.classList.remove('selected'));
      row.classList.add('selected');
      updateSelectedFile('');

      if (isFolder) {
        if (!isInstance) {
          pathInput.value = path;
        }
        listFiles();
        return;
      }
      updateSelectedFile(path);
    });
  });
};

const downloadFile = async (filePath) => {
  if (!configuredInstance) return setStatus('Configure a storage instance first.', true);
  if (!filePath) return setStatus('Select a file before downloading.', true);

  setStatus(`Downloading ${filePath}...`);
  try {
    const resp = await fetch(`${apiBase}/${encodeURIComponent(configuredInstance)}/get`, {
      method: 'GET',
      headers: buildHeaders({ path: filePath })
    });
    if (!resp.ok) {
      const payload = await resp.json();
      throw new Error(payload.error || 'Download failed');
    }
    const blob = await resp.blob();
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = filePath.split('/').pop();
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setStatus(`Downloaded ${filePath}.`);
  } catch (err) {
    setStatus(err.message, true);
  }
};

const deleteFile = async (filePath) => {
  if (!configuredInstance) return setStatus('Configure a storage instance first.', true);
  if (!filePath) return setStatus('Select a file before deleting.', true);

  setStatus(`Deleting ${filePath}...`);
  try {
    const resp = await fetch(`${apiBase}/${encodeURIComponent(configuredInstance)}/delete`, {
      method: 'DELETE',
      headers: buildHeaders({ path: filePath })
    });
    const payload = await resp.json();
    if (!resp.ok) throw new Error(payload.error || 'Delete failed');
    setStatus(`Deleted ${filePath}.`);
    await listFiles();
  } catch (err) {
    setStatus(err.message, true);
  }
};

const uploadFile = async () => {
  if (!configuredInstance) {
    return setStatus('Configure a storage instance before uploading.', true);
  }
  showUploadModal();
};

const performUpload = async () => {
  const file = modalFileInput.files[0];
  const location = normalizePath(modalUploadLocation.value.trim());
  if (!configuredInstance) return setStatus('Configure a storage instance first.', true);
  if (!file) return setStatus('Choose a file to upload.', true);
  if (!location) return setStatus('Enter an upload subfolder location.', true);

  setStatus(`Uploading ${file.name}...`);
  try {
    const startResp = await fetch(`${apiBase}/writeStart/${encodeURIComponent(file.name)}`, {
      method: 'POST',
      headers: buildHeaders({ 'Content-Type': 'application/octet-stream' }),
      body: await file.arrayBuffer()
    });
    const startPayload = await startResp.json();
    if (!startResp.ok) throw new Error(startPayload.error || 'Upload start failed');

    const completeResp = await fetch(`${apiBase}/writeComplete/${encodeURIComponent(startPayload.uploadId)}`, {
      method: 'POST',
      headers: buildHeaders({ location })
    });
    const completePayload = await completeResp.json();
    if (!completeResp.ok) throw new Error(completePayload.error || 'Upload complete failed');

    setStatus(`Uploaded file to ${completePayload.remotePath}.`);
    hideUploadModal();
    await listFiles();
  } catch (err) {
    setStatus(err.message, true);
  }
};

const init = () => {
  listBtn.addEventListener('click', listFiles);
  uploadBtn.addEventListener('click', uploadFile);
  downloadBtn.addEventListener('click', () => downloadFile(selectedFilePath));
  deleteBtn.addEventListener('click', () => deleteFile(selectedFilePath));
  generateAuthBtn.addEventListener('click', generateMockAuth);
  configureBtn.addEventListener('click', showConfigModal);

  closeModal.addEventListener('click', hideUploadModal);
  modalUploadCancel.addEventListener('click', hideUploadModal);
  modalUploadConfirm.addEventListener('click', performUpload);

  closeConfigModal.addEventListener('click', hideConfigModal);
  configCancelBtn.addEventListener('click', hideConfigModal);
  configConfirmBtn.addEventListener('click', createRootFolder);
  instanceSelect.addEventListener('change', handleInstanceSelect);

  loadConfiguredInstances();
  setAppState();
};

init();
