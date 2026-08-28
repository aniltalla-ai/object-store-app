const fs = require('fs');
const { S3Client, PutObjectCommand, CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, paginateListObjectsV2 } = require('@aws-sdk/client-s3');

class AwsProvider {
  constructor(creds) {
    this.bucket = creds.bucket;
    this.client = new S3Client({
      region: creds.region,
      credentials: {
        accessKeyId: creds.access_key_id,
        secretAccessKey: creds.secret_access_key
      }
    });
  }

  async createPath(defaultFolders) {
    for (const folder of defaultFolders) {
      const markerPath = `${folder}/.init`;
      await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: markerPath, Body: '' }));
    }
  }

  async list(prefixFilter) {
    const files = [];
    const params = { Bucket: this.bucket };
    if (prefixFilter) params.Prefix = prefixFilter;

    const paginator = paginateListObjectsV2({ client: this.client }, params);
    for await (const page of paginator) {
      if (page.Contents && page.Contents.length > 0) {
        for (const f of page.Contents) {
          const isFolder = f.Key.endsWith('/') || f.Key.endsWith('.init');
          files.push({ name: f.Key, size: f.Size, modified: f.LastModified, isFolder });
        }
      }
    }

    return files;
  }

  async copy(source, target) {
    await this.client.send(new CopyObjectCommand({ Bucket: this.bucket, CopySource: `${this.bucket}/${source}`, Key: target }));
  }

  async move(source, target) {
    await this.copy(source, target);
    await this.delete(source);
  }

  async download(targetPath, res = null, options = {}) {
    const params = { Bucket: this.bucket, Key: targetPath };
    if (options.start !== undefined && options.end !== undefined) {
      params.Range = `bytes=${options.start}-${options.end}`;
    }
    const data = await this.client.send(new GetObjectCommand(params));
    if (res && typeof res.pipe === 'function') {
      if (typeof data.Body?.on === 'function') {
        data.Body.on('error', (err) => {
          if (typeof res.destroy === 'function') res.destroy(err);
        });
      }
      data.Body.pipe(res);
      return;
    }
    if (data.Body && typeof data.Body.transformToByteArray === 'function') {
      const byteArray = await data.Body.transformToByteArray();
      return Buffer.from(byteArray);
    }
    return data.Body;
  }

  async delete(targetPath) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: targetPath }));
  }

  async uploadStream(targetPath, fsReadStream, localFilePath, metadata = null) {
    const bodyStream = fsReadStream || (localFilePath ? fs.createReadStream(localFilePath) : null);
    const params = { Bucket: this.bucket, Key: targetPath, Body: bodyStream };
    if (metadata && typeof metadata === 'object') {
      params.Metadata = metadata;
    }
    await this.client.send(new PutObjectCommand(params));
  }

  async getMetadata(targetPath) {
    try {
      const data = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: targetPath }));
      return data.Metadata || {};
    } catch (e) {
      return {};
    }
  }
}

module.exports = AwsProvider;
