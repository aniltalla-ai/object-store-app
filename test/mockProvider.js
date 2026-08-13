const fs = require('fs');
const path = require('path');
const os = require('os');

class MockProvider {
  constructor(rootDir) {
    this.mockRoot = rootDir || path.join(os.tmpdir(), 'mock_object_store');
    if (!fs.existsSync(this.mockRoot)) {
      fs.mkdirSync(this.mockRoot, { recursive: true });
    }
  }

  async createPath(instanceId, defaultFolders) {
    defaultFolders.forEach((folder) => {
      fs.mkdirSync(path.join(this.mockRoot, instanceId, folder), { recursive: true });
    });
  }

  async list(prefixFilter, instanceId, subfolder) {
    const targetDir = path.join(this.mockRoot, instanceId || '', subfolder || '');
    if (!fs.existsSync(targetDir)) return [];

    return fs.readdirSync(targetDir).map((name) => {
      const fullPath = path.join(targetDir, name);
      const stat = fs.statSync(fullPath);
      const relName = subfolder ? `${subfolder}/${name}` : name;
      return {
        name: relName.replace(/\\/g, '/'),
        size: stat.isDirectory() ? null : stat.size,
        modified: stat.mtime,
        isFolder: stat.isDirectory()
      };
    });
  }

  async copy(source, target) {
    const srcP = path.join(this.mockRoot, source);
    const dstP = path.join(this.mockRoot, target);
    fs.mkdirSync(path.dirname(dstP), { recursive: true });
    fs.copyFileSync(srcP, dstP);
  }

  async move(source, target) {
    const srcP = path.join(this.mockRoot, source);
    const dstP = path.join(this.mockRoot, target);
    fs.mkdirSync(path.dirname(dstP), { recursive: true });
    fs.renameSync(srcP, dstP);
  }

  async download(targetPath, res) {
    const p = path.join(this.mockRoot, targetPath);
    if (!fs.existsSync(p)) throw new Error('File Not Found Locally');
    fs.createReadStream(p).pipe(res);
  }

  async delete(targetPath) {
    const p = path.join(this.mockRoot, targetPath);
    if (!fs.existsSync(p)) return;
    const stat = fs.statSync(p);
    if (stat.isDirectory()) {
      try {
        fs.rmSync(p, { recursive: true, force: true });
      } catch (e) {
        fs.rmdirSync(p, { recursive: true });
      }
    } else {
      fs.unlinkSync(p);
    }
  }

  async uploadStream(targetPath, fsReadStream, localFilePath) {
    const dstP = path.join(this.mockRoot, targetPath);
    fs.mkdirSync(path.dirname(dstP), { recursive: true });
    if (localFilePath && fs.existsSync(localFilePath)) {
      fs.copyFileSync(localFilePath, dstP);
    } else if (fsReadStream) {
      const ws = fs.createWriteStream(dstP);
      fsReadStream.pipe(ws);
      await new Promise((resolve, reject) => {
        ws.on('finish', resolve);
        ws.on('error', reject);
      });
    } else {
      fs.writeFileSync(dstP, Buffer.alloc(0));
    }
  }
}

module.exports = MockProvider;
