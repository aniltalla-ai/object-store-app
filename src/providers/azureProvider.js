const { BlobServiceClient } = require('@azure/storage-blob');

class AzureProvider {
  constructor(creds) {
    this.container = creds.container || 'root';
    this.client = BlobServiceClient.fromConnectionString(creds.connection_string || creds.sas_url || creds.connectionString);
  }

  getContainer() {
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

  async download(targetPath, res, options = {}) {
    const downloadOptions = {};
    if (options.start !== undefined && options.end !== undefined) {
      const offset = options.start;
      const count = (options.end - options.start) + 1;
      const response = await this.getContainer().getBlockBlobClient(targetPath).download(offset, count, downloadOptions);
      response.readableStreamBody.pipe(res);
    } else {
      const response = await this.getContainer().getBlockBlobClient(targetPath).download(0);
      response.readableStreamBody.pipe(res);
    }
  }

  async delete(targetPath) {
    await this.getContainer().getBlockBlobClient(targetPath).delete();
  }

  async uploadStream(targetPath, fsReadStream) {
    await this.getContainer().getBlockBlobClient(targetPath).uploadStream(fsReadStream);
  }
}

module.exports = AzureProvider;
