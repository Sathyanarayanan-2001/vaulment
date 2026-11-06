import { packSave, parseSaveName, readEnvelope, openEnvelope, saveFileName, vaultTag } from './savefile.js';
import { decryptBytes, fromBase64, newId, toBase64 } from '../crypto/vaultcrypto.js';
import { canonicalJson } from '../core/canonical.js';
import { CATEGORY_IDS, LIMITS, TEMPLATE_BY_ID } from '../core/schema.js';
import { MS_PER_MINUTE, MS_PER_SECOND } from '../core/units.js';
import { isTombstone } from '../core/merge.js';

export const KEEP_SAVES = 3;
export const DEBOUNCE_MS = 3 * MS_PER_SECOND;
const FILE_TIMEOUT_MS = 30 * MS_PER_SECOND;
const RETRIES = 3;
const BACKOFF_MS = 500;
const RETRY_FAILED_MS = MS_PER_MINUTE;
const BLOB_DIR = 'blobs';

export const STATES = {
  saved: 'Saved',
  saving: 'Saving',
  waiting: 'Changes waiting',
  access: 'Folder access needed',
  problem: 'Sync problem',
};

/** Reject if `op` takes too long, so one hung file call cannot freeze the queue for good. */
export function withTimeout(op, ms, setTimer = setTimeout, clearTimer = clearTimeout) {
  let timer;
  const limit = new Promise((_, reject) => { timer = setTimer(() => reject(new Error('The operation timed out.')), ms); });
  return Promise.race([op(), limit]).finally(() => clearTimer(timer));
}

/** Retry with exponential backoff: 500 ms, 1,000 ms, 2,000 ms. */
export async function withRetry(op, { tries = RETRIES, baseMs = BACKOFF_MS, timeoutMs = FILE_TIMEOUT_MS, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  let last;
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      return await withTimeout(op, timeoutMs);
    } catch (err) {
      last = err;
      if (attempt < tries - 1) await sleep(baseMs * 2 ** attempt);
    }
  }
  throw last;
}

async function readFileBytes(dir, name) {
  const handle = await dir.getFileHandle(name);
  const file = await handle.getFile();
  return { bytes: new Uint8Array(await file.arrayBuffer()), modified: file.lastModified, size: file.size };
}

async function writeFileBytes(dir, name, bytes) {
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(bytes);
  await writable.close();
}

/**
 * Keeps this device's records and a shared folder in step.
 *
 * Every folder operation runs through one promise chain, because a pull that overlapped
 * a running write could read half of it, and two writes could race on retention.
 * Worst cases per sync, for n records and f save files: write O(n), pull O(f·n).
 */
export class SyncEngine {
  constructor({ vault, device, session, now = () => Date.now(), onState = () => {}, timers = { set: (f, ms) => setTimeout(f, ms), clear: (t) => clearTimeout(t) }, retry = {} }) {
    Object.assign(this, { vault, device, session, now, onState, timers, retry });
    this.dir = null;
    this.state = 'access';
    this.message = '';
    this.dirty = false;
    this.chain = Promise.resolve();
    this.timer = null;
    this.seen = new Map();
    this.skipped = new Map();
    this.fileName = null;
    this.lastSave = null;
    this.lastPull = null;
    this.rejected = 0;
    this.pendingBlobs = 0;
    this.foreign = 0;
  }

  /** The resting state. A wrong-vault folder stays visible until it is dealt with. */
  settle() {
    if (this.foreign > 0) this.setState('problem', `${this.foreign} save file(s) in this folder belong to a different vault and were left alone. Pick the folder used by this vault.`);
    else this.setState(this.dirty ? 'waiting' : 'saved');
  }

  setState(state, message = '') {
    this.state = state;
    this.message = message;
    this.onState(state, message);
  }

  enqueue(op) {
    const run = this.chain.then(op, op);
    // The chain must survive a failure, or one bad write would stop sync for the session.
    this.chain = run.catch(() => {});
    return run;
  }

  /** Attach a folder. Nothing is read until permission is confirmed. */
  async connect(dir) {
    this.dir = dir;
    this.seen.clear();
    this.skipped.clear();
    this.foreign = 0;
    const ok = await this.hasPermission();
    if (!ok) { this.setState('access', 'Vaulment needs permission to use your sync folder again.'); return false; }
    await this.pull();
    await this.write();
    return true;
  }

  disconnect() {
    this.cancelTimer();
    this.dir = null;
    this.setState('access', 'No sync folder is connected. Your data is saved on this device only.');
  }

  async hasPermission() {
    if (!this.dir?.queryPermission) return Boolean(this.dir);
    return (await this.dir.queryPermission({ mode: 'readwrite' })) === 'granted';
  }

  cancelTimer() {
    if (this.timer !== null) this.timers.clear(this.timer);
    this.timer = null;
  }

  /** Called after any change. Writes about 3 seconds later, so a burst of edits is one write. */
  markDirty() {
    this.dirty = true;
    if (!this.dir) { this.setState('access', 'Your change is saved on this device. Connect a sync folder to reach your other devices.'); return; }
    this.setState('waiting');
    this.cancelTimer();
    this.timer = this.timers.set(() => { this.timer = null; this.write().catch(() => {}); }, DEBOUNCE_MS);
  }

  /** Called when the page is hidden. Tab close cannot be relied on, so this fires early. */
  flush() {
    if (!this.dirty || !this.dir) return Promise.resolve();
    this.cancelTimer();
    return this.write().catch(() => {});
  }

  write() {
    return this.enqueue(async () => {
      if (!this.dir) return;
      if (!(await this.hasPermission())) { this.setState('access', 'Vaulment needs permission to use your sync folder again.'); return; }
      if (!this.vault.unlocked) return;
      this.dirty = false;
      this.setState('saving');
      try {
        await withRetry(() => this.writeOnce(), this.retry);
        this.settle();
      } catch (err) {
        this.dirty = true;
        this.setState('problem', `Could not write to the sync folder (${err.message}). Your data is safe on this device; Vaulment will try again.`);
        this.cancelTimer();
        this.timer = this.timers.set(() => { this.timer = null; this.write().catch(() => {}); }, RETRY_FAILED_MS);
      }
    });
  }

  async writeOnce() {
    const nowMs = this.now();
    // One file per session: created once, then rewritten, so a session leaves one save behind.
    // Taken together and first: a lock during the file copies below empties the live store,
    // and a save made from that would tell every device the vault is empty.
    const { dek, keyring } = this.vault;
    if (!dek) return;
    const recs = this.vault.snapshot();
    this.fileName ??= saveFileName(keyring.vaultId, this.device, this.session, nowMs);
    await this.pushBlobs();
    const bytes = await packSave({ dek, keyring, recs, device: this.device, session: this.session, nowMs });
    await writeFileBytes(this.dir, this.fileName, bytes);
    this.seen.set(this.fileName, 'own');
    await this.prune();
    this.lastSave = nowMs;
  }

  /** Keep this device's newest 3 of this vault. Other devices' files are never deleted here:
   *  pruning them could remove a save that device has written but this one has not merged.
   *  This session's own file always stays, however old its name, since it is the live one. */
  async prune() {
    const tag = vaultTag(this.vault.keyring.vaultId);
    const mine = [];
    for await (const name of this.dir.keys()) {
      const p = parseSaveName(name);
      if (p?.device === this.device && p.vault === tag && name !== this.fileName) mine.push({ name, stamp: p.stamp });
    }
    mine.sort((a, b) => (a.stamp === b.stamp ? (a.name < b.name ? 1 : -1) : a.stamp < b.stamp ? 1 : -1));
    for (const { name } of mine.slice(KEEP_SAVES - 1)) {
      await this.dir.removeEntry(name).catch(() => {});
    }
  }

  /** Files travel separately so that the save file stays small however many scans exist. */
  async pushBlobs() {
    const blobDir = await this.dir.getDirectoryHandle(BLOB_DIR, { create: true });
    const present = new Set();
    for await (const name of blobDir.keys()) present.add(name);
    const wanted = new Set();
    for (const rec of this.vault.attachments()) {
      const name = `${rec.id}.bin`;
      wanted.add(name);
      if (present.has(name)) continue;
      const row = await this.vault.db.get('blobs', rec.id);
      if (!row) continue;
      const joined = new Uint8Array(row.iv.length + row.ct.length);
      joined.set(row.iv);
      joined.set(row.ct, row.iv.length);
      await writeFileBytes(blobDir, name, joined);
    }
    // A tombstone means the file is gone everywhere, so its encrypted copy can go too.
    for (const [id, rec] of this.vault.recs) {
      if (isTombstone(rec) && present.has(`${id}.bin`)) await blobDir.removeEntry(`${id}.bin`).catch(() => {});
    }
  }

  async pullBlobs() {
    const blobDir = await this.dir.getDirectoryHandle(BLOB_DIR, { create: true });
    // One key listing instead of one database read per file; this runs on every pull.
    const held = new Set(await this.vault.db.keys('blobs'));
    let missing = 0;
    for (const rec of this.vault.attachments()) {
      if (held.has(rec.id)) continue;
      try {
        const { bytes } = await readFileBytes(blobDir, `${rec.id}.bin`);
        const row = { iv: bytes.slice(0, 12), ct: bytes.slice(12) };
        await this.checkBlob(rec.id, row);
        await this.vault.db.put('blobs', rec.id, row);
      } catch {
        missing += 1; // Not delivered yet, or cut short. It stays on the list for the next pull.
      }
    }
    this.pendingBlobs = missing;
  }

  /** Authenticate before storing. A half-synced file kept here would never be fetched again. */
  checkBlob(id, row) {
    return decryptBytes(this.vault.dek, row.iv, row.ct, `blob:${id}`);
  }

  pull() {
    return this.enqueue(async () => {
      if (!this.dir || !this.vault.unlocked) return;
      if (!(await this.hasPermission())) { this.setState('access', 'Vaulment needs permission to use your sync folder again.'); return; }
      try {
        await withRetry(() => this.pullOnce(), this.retry);
        if (this.foreign > 0 || this.state === 'problem' || this.state === 'access') this.settle();
      } catch (err) {
        this.setState('problem', `Could not read the sync folder (${err.message}). Your data is safe on this device; Vaulment will try again.`);
      }
    });
  }

  async pullOnce() {
    const names = [];
    for await (const [name, handle] of this.dir.entries()) {
      if (handle.kind === 'file' && parseSaveName(name) && name !== this.fileName) names.push(name);
    }
    let changed = 0;
    const foreign = new Set();
    for (const name of names) {
      try {
        const { bytes, modified, size } = await readFileBytes(this.dir, name);
        const tag = `${modified}:${size}`;
        if (this.seen.get(name) === tag) continue;
        const env = await readEnvelope(bytes);
        if (env.vaultId !== this.vault.keyring.vaultId) { foreign.add(name); continue; }
        const payload = await openEnvelope(env, this.vault.dek);
        const result = await this.vault.mergeRemote(payload.recs ?? {});
        await this.vault.mergeKeyring(payload.keyring);
        changed += result.changed.length;
        this.rejected += result.rejected;
        this.seen.set(name, tag);
        this.skipped.delete(name);
      } catch (err) {
        // Sync apps deliver files late, so a half-arrived file is normal. It is not marked
        // as seen, which means the next pull tries it again.
        this.skipped.set(name, err.message);
      }
    }
    await this.pullBlobs();
    this.lastPull = this.now();
    this.foreign = foreign.size;
    if (changed > 0) {
      this.dirty = true; // The merged result goes back out, so a third device gets it from here too.
      this.cancelTimer();
      this.timer = this.timers.set(() => { this.timer = null; this.write().catch(() => {}); }, DEBOUNCE_MS);
    }
  }

  /** Portable save for devices with no folder access. Carries every file inside it. */
  async exportBundle() {
    const blobs = {};
    this.bundleMissing = 0;
    for (const rec of this.vault.attachments()) {
      const row = await this.vault.db.get('blobs', rec.id);
      if (row) blobs[rec.id] = { iv: toBase64(row.iv), ct: toBase64(row.ct) };
      else this.bundleMissing += 1;
    }
    const nowMs = this.now();
    return packSave({ dek: this.vault.dek, keyring: this.vault.keyring, recs: this.vault.snapshot(), device: this.device, session: this.session, nowMs, blobs });
  }

  /** Merge a save file or backup picked by hand. Same rules as folder sync. */
  async importBundle(bytes) {
    const env = await readEnvelope(bytes);
    if (env.vaultId !== this.vault.keyring.vaultId) throw new Error('This file belongs to a different vault, so nothing was merged. To combine two vaults, export a CSV from one and import it into the other.');
    const payload = await openEnvelope(env, this.vault.dek);
    const result = await this.vault.mergeRemote(payload.recs ?? {});
    await this.vault.mergeKeyring(payload.keyring);
    let files = 0;
    let damaged = 0;
    for (const [id, row] of Object.entries(env.blobs ?? {})) {
      if (!this.vault.get(id) || (await this.vault.hasBlob(id))) continue;
      try {
        const stored = { iv: fromBase64(row.iv), ct: fromBase64(row.ct) };
        await this.checkBlob(id, stored);
        await this.vault.db.put('blobs', id, stored);
        files += 1;
      } catch {
        damaged += 1; // One bad file must not cost the rest of the backup.
      }
    }
    if (result.changed.length > 0 || files > 0) this.markDirty();
    return { changed: result.changed.length, rejected: result.rejected, files, damaged };
  }

  /**
   * Bring back what a merge cannot: an item deleted since the backup, or a version that a
   * later edit replaced. Merging keeps the newest version, so those come back as new copies
   * beside whatever is there now, and nothing current is touched.
   * Time O(n + a), using a map of files by parent item.
   * @returns {{items:number, files:number, failed:number}}
   */
  async restoreCopies(bytes) {
    const env = await readEnvelope(bytes);
    if (env.vaultId !== this.vault.keyring.vaultId) throw new Error('This file belongs to a different vault. Open it on a clean device with Bring my vault to this device.');
    const { recs = {} } = await openEnvelope(env, this.vault.dek);
    const filesOf = new Map();
    for (const att of Object.values(recs)) {
      if (att.k !== 'att') continue;
      if (!filesOf.has(att.item)) filesOf.set(att.item, []);
      filesOf.get(att.item).push(att);
    }
    const customIds = new Set(this.vault.customCategories().map((c) => c.id));
    const addFile = async (att, itemId) => {
      const row = env.blobs?.[att.id];
      if (!row) return 0;
      const plain = await decryptBytes(this.vault.dek, fromBase64(row.iv), fromBase64(row.ct), `blob:${att.id}`);
      await this.vault.addAttachment(itemId, att.name, att.mime, plain);
      return 1;
    };
    let items = 0;
    let files = 0;
    let failed = 0;
    const now = this.now();
    for (const old of Object.values(recs)) {
      if (old.k !== 'item') continue;
      const current = this.vault.get(old.id);
      try {
        if (current && canonicalJson({ ...current, u: 0, pwu: 0 }) === canonicalJson({ ...old, u: 0, pwu: 0 })) {
          // The item stands, but a file removed since the backup goes back on it.
          for (const att of filesOf.get(old.id) ?? []) if (!this.vault.get(att.id)) files += await addFile(att, old.id);
          continue;
        }
        if (old.trash !== undefined && current) continue;
        const { trash, ...rest } = old;
        // A custom category deleted since the backup falls back to the type's own category.
        const c = CATEGORY_IDS.has(rest.c) || customIds.has(rest.c) ? rest.c : TEMPLATE_BY_ID[rest.t]?.cat ?? 'other';
        const id = newId('r');
        await this.vault.putItem({ ...rest, id, c, title: `${old.title.slice(0, LIMITS.title - 11)} (restored)`, cr: now });
        items += 1;
        for (const att of filesOf.get(old.id) ?? []) files += await addFile(att, id);
      } catch {
        failed += 1;
      }
    }
    return { items, files, failed };
  }

  /** Every readable save in `dir`, by name, newest first; undelivered ones are passed over.
   *  Names carry the session's start time, so the newest name need not hold the newest data. */
  static async* envelopes(dir) {
    const names = [];
    for await (const name of dir.keys()) { const p = parseSaveName(name); if (p) names.push({ name, stamp: p.stamp }); }
    names.sort((a, b) => (a.stamp < b.stamp ? 1 : -1));
    for (const { name } of names) {
      try {
        const { bytes } = await readFileBytes(dir, name);
        yield { env: await readEnvelope(bytes), bytes };
      } catch { /* Not delivered yet; an older one may be readable. */ }
    }
  }

  static async newestEnvelope(dir) {
    for await (const found of SyncEngine.envelopes(dir)) return found;
    return null;
  }
}
