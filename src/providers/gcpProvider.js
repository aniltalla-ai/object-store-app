const { Storage } = require('@google-cloud/storage');

class GcpProvider {
  constructor(creds) {
    this.bucket = creds.bucket;
    const authOpts = creds.private_key
      ? { credentials: { client_email: creds.client_email, private_key: creds.private_key }, projectId: creds.project_id }
      : { credentials: JSON.parse(creds.gcpKey) };
    this.client = new Storage(authOpts);
  }

  getBucket() {
    return this.client.bucket(this.bucket);
  }

  async createPath(rootFolder, defaultFolders) {
    for (const folder of defaultFolders) {
      const markerPath = `${rootFolder}/${folder}/.init`;
      await this.getBucket().file(markerPath).save('');
    }
  }

  async list(prefixFilter) {
    const [gcpFiles] = await this.getBucket().getFiles({ prefix: prefixFilter });
    return gcpFiles.map((f) => ({ name: f.name, size: parseInt(f.metadata.size), modified: f.metadata.updated }));
  }

  async copy(source, target) {
    await this.getBucket().file(source).copy(this.getBucket().file(target));
  }

  async move(source, target) {
    await this.getBucket().file(source).move(target);
  }

  async download(targetPath, res) {
    this.getBucket().file(targetPath).createReadStream().pipe(res);
  }

  async delete(targetPath) {
    await this.getBucket().file(targetPath).delete();
  }

  async uploadStream(targetPath, fsReadStream) {
    const blob = this.getBucket().file(targetPath);
    await new Promise((res, rej) => {
      fsReadStream.pipe(blob.createWriteStream()).on('finish', res).on('error', rej);
    });
  }
}

module.exports = GcpProvider;
