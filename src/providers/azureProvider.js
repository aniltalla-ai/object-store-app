const { BlobServiceClient } = require('@azure/storage-blob');

class AzureProvider {
  constructor(creds) {
    this.container = creds.container_name || creds.container || 'root';

    const rawSas = creds.sas_token;
    const sasToken = rawSas ? (rawSas.startsWith('?') ? rawSas : `?${rawSas}`) : '';

    let clientUrl, isConnectionString = false;

    if (creds.container_uri && sasToken) {
      const cleanUri = creds.container_uri.split('?')[0];
      clientUrl = `${cleanUri}${sasToken}`;
    } else if (creds.account_name && sasToken) {
      clientUrl = `https://${creds.account_name}.blob.core.windows.net/${this.container}${sasToken}`;
    } else {
      isConnectionString = true;
      clientUrl = creds.connection_string || creds.sas_url || creds.connectionString;
    }

    // 3. Initialize the client once at the end
    if (isConnectionString) {
      this.client = BlobServiceClient.fromConnectionString(clientUrl);
    } else {
      this.client = new BlobServiceClient(clientUrl);
    }
  }

  getContainer() {
    if (this.client.url.includes(`/${this.container}`)) {
      return this.client.getContainerClient('');
    }
    return this.client.getContainerClient(this.container);
  }

  async createPath(defaultFolders) {
    const containerClient = this.getContainer();
    for (const folder of defaultFolders) {
      const markerPath = `${folder}/.init`;
      await containerClient.getBlockBlobClient(markerPath).upload('', 0);
    }
  }

  async list(prefixFilter) {
    const files = [];
    for await (const blob of this.getContainer().listBlobsFlat({ prefix: prefixFilter })) {
      const isFolder = blob.name.endsWith('/') || blob.name.endsWith('.init');
      files.push({ name: blob.name, size: blob.properties.contentLength, modified: blob.properties.lastModified, isFolder });
    }
    return files;
  }

  async copy(source, target) {
    const containerClient = this.getContainer();
    await containerClient.getBlockBlobClient(target).beginCopyFromURL(containerClient.getBlockBlobClient(source).url);
  }

  async move(source, target) {
    await this.copy(source, target);
    await this.delete(source);
  }

  async download(targetPath, res = null, options = {}) {
    const downloadOptions = {};
    let offset = 0;
    let count;
    if (options.start !== undefined && options.end !== undefined) {
      offset = options.start;
      count = (options.end - options.start) + 1;
    }
    const blockBlobClient = this.getContainer().getBlockBlobClient(targetPath);
    if (res && typeof res.pipe === 'function') {
      const response = await blockBlobClient.download(offset, count, downloadOptions);
      if (typeof response.readableStreamBody?.on === 'function') {
        response.readableStreamBody.on('error', (err) => {
          if (typeof res.destroy === 'function') res.destroy(err);
        });
      }
      response.readableStreamBody.pipe(res);
      return;
    }
    return await blockBlobClient.downloadToBuffer(offset, count, undefined, downloadOptions);
  }

  async delete(targetPath) {
    await this.getContainer().getBlockBlobClient(targetPath).delete();
  }

  async uploadStream(targetPath, fsReadStream, localFilePath, metadata = null) {
    const stream = fsReadStream || (localFilePath ? require('fs').createReadStream(localFilePath) : null);
    const options = metadata && typeof metadata === 'object' ? { metadata } : undefined;
    await this.getContainer().getBlockBlobClient(targetPath).uploadStream(stream, undefined, undefined, options);
  }

  async getMetadata(targetPath) {
    try {
      const properties = await this.getContainer().getBlockBlobClient(targetPath).getProperties();
      return properties.metadata || {};
    } catch (e) {
      return {};
    }
  }
}

module.exports = AzureProvider;