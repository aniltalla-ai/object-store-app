const { S3Client, PutObjectCommand, ListObjectsV2Command, CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, paginateListObjectsV2 } = require('@aws-sdk/client-s3');

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

  async download(targetPath, res) {
    const data = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: targetPath }));
    data.Body.pipe(res);
  }

  async delete(targetPath) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: targetPath }));
  }

  async uploadStream(targetPath, fsReadStream, localFilePath) {
    const fs = require('fs');
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: targetPath, Body: fs.readFileSync(localFilePath) }));
  }
}

module.exports = AwsProvider;
