// A fake OneDrive folder implementing the part of FileSystemDirectoryHandle that sync uses.
export class FakeDir {
  constructor(store = new Map(), dirs = new Map()) { this.store = store; this.dirs = dirs; this.kind = 'directory'; this.clock = 1; this.hook = null; this.permission = 'granted'; }
  async queryPermission() { return this.permission; }
  async getDirectoryHandle(name, { create } = {}) {
    if (!this.dirs.has(name)) { if (!create) throw new DOMException('no dir', 'NotFoundError'); this.dirs.set(name, new FakeDir()); }
    return this.dirs.get(name);
  }
  async getFileHandle(name, { create } = {}) {
    if (!this.store.has(name) && !create) throw new DOMException('no file', 'NotFoundError');
    const self = this;
    return {
      kind: 'file', name,
      async getFile() {
        if (self.hook) await self.hook('read', name);
        const f = self.store.get(name);
        if (!f) throw new DOMException('gone', 'NotFoundError');
        return { lastModified: f.m, size: f.bytes.length, arrayBuffer: async () => f.bytes.buffer.slice(f.bytes.byteOffset, f.bytes.byteOffset + f.bytes.length) };
      },
      async createWritable() {
        let data;
        return { async write(b) { data = b; }, async close() { if (self.hook) await self.hook('write', name); self.store.set(name, { bytes: new Uint8Array(data), m: self.clock++ }); } };
      },
    };
  }
  async removeEntry(name) { this.store.delete(name); }
  async *keys() { yield* [...this.store.keys()]; }
  async *entries() { for (const n of this.store.keys()) yield [n, { kind: 'file', name: n }]; for (const n of this.dirs.keys()) yield [n, { kind: 'directory', name: n }]; }
}
