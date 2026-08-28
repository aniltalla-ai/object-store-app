const { Storage } = require('@google-cloud/storage');

class GcpProvider {
  constructor(creds) {
    this.bucket = creds.bucket;

    let authOpts = {};

    if (creds.base64EncodedPrivateKeyData) {
      const decodedJsonString = Buffer.from(creds.base64EncodedPrivateKeyData, 'base64').toString('utf8');
      const serviceAccount = JSON.parse(decodedJsonString);

      authOpts = {
        credentials: {
          client_email: serviceAccount.client_email,
          private_key: serviceAccount.private_key,
        },
        projectId: creds.projectId || serviceAccount.project_id,
      };
    } else {
      const authOptsFallback = creds.private_key
        ? { credentials: { client_email: creds.client_email, private_key: creds.private_key }, projectId: creds.project_id }
        : { credentials: typeof creds.gcpKey === 'string' ? JSON.parse(creds.gcpKey) : creds.gcpKey };
      authOpts = authOptsFallback;
    }

    this.client = new Storage(authOpts);
  }

  getBucket() {
    return this.client.bucket(this.bucket);
  }

  async createPath(defaultFolders) {
    for (const folder of defaultFolders) {
      const markerPath = `${folder}/.init`;
      await this.getBucket().file(markerPath).save('');
    }
  }

  async list(prefixFilter) {
    const options = { autoPaginate: true };
    if (prefixFilter) options.prefix = prefixFilter;

    const [gcpFiles] = await this.getBucket().getFiles(options);
    return gcpFiles.map((f) => {
      const isFolder = f.name.endsWith('/') || f.name.endsWith('.init');
      return { name: f.name, size: parseInt(f.metadata.size || 0), modified: f.metadata.updated, isFolder };
    });
  }

  async copy(source, target) {
    await this.getBucket().file(source).copy(this.getBucket().file(target));
  }

  async move(source, target) {
    await this.getBucket().file(source).move(target);
  }

  async download(targetPath, res = null, options = {}) {
    const streamOptions = {};
    if (options.start !== undefined) streamOptions.start = options.start;
    if (options.end !== undefined) streamOptions.end = options.end;
    const file = this.getBucket().file(targetPath);

    if (res && typeof res.pipe === 'function') {
      const readStream = file.createReadStream(streamOptions);
      readStream.on('error', (err) => {
        if (typeof res.destroy === 'function') res.destroy(err);
      });
      readStream.pipe(res);
      return;
    }

    const [buffer] = await file.download(streamOptions);
    return buffer;
  }

  async delete(targetPath) {
    await this.getBucket().file(targetPath).delete();
  }

  async uploadStream(targetPath, fsReadStream, localFilePath, metadata = null) {
    const stream = fsReadStream || (localFilePath ? require('fs').createReadStream(localFilePath) : null);
    const blob = this.getBucket().file(targetPath);
    const writeStreamOptions = metadata && typeof metadata === 'object' ? { metadata: { metadata } } : {};
    await new Promise((res, rej) => {
      stream.pipe(blob.createWriteStream(writeStreamOptions)).on('finish', res).on('error', rej);
    });
  }

  async getMetadata(targetPath) {
    try {
      const [meta] = await this.getBucket().file(targetPath).getMetadata();
      return meta.metadata || {};
    } catch (e) {
      return {};
    }
  }
}

module.exports = GcpProvider;