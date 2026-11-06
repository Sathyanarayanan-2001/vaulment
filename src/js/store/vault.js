import * as c from '../crypto/vaultcrypto.js';
import { makeTombstone, mergeInto, nextStamp, isTombstone, pickWinner } from '../core/merge.js';
import { CONFIG_ID, MAX_FILE_BYTES, validateAny, validateItem, secretKeysOf } from '../core/schema.js';
import { haystackOf } from '../core/search.js';
import { canonicalJson } from '../core/canonical.js';
import { openEnvelope } from './savefile.js';

export class VaultError extends Error {}

/** Password and recovery slots merge separately: a password change on one device and a new
 *  recovery key on another must both survive. Time O(1). */
export function mergeKeyrings(a, b) {
  return { ...a, pw: pickWinner(a.pw, b.pw), rc: pickWinner(a.rc, b.rc), u: Math.max(a.u, b.u) };
}

const DECRYPT_BATCH = 200;
const WRONG_FILE_PASSWORD = 'That password does not open this file. Use the master password from your other device.';
const WRONG_RECOVERY = 'That recovery key is not right. Check each group of characters and try again.';

/**
 * The encrypted store. IndexedDB (or the test backend) only ever receives ciphertext.
 * While unlocked, records sit decrypted in one Map, so a lookup by id is O(1) and a
 * list view never touches the disk. lock() drops the Map and the key.
 */
export class Vault {
  constructor(backend, { now = () => Date.now(), decryptBatch = DECRYPT_BATCH } = {}) {
    this.db = backend;
    this.now = now;
    this.decryptBatch = decryptBatch;
    this.dek = null;
    this.keyring = null;
    this.recs = new Map();
    this.hay = new Map();
    this.attIndex = null;
    this.lockCount = 0;
    this.unreadable = 0;
    this.listeners = new Set();
  }

  get unlocked() { return this.dek !== null; }

  async hasVault() { return Boolean(await this.db.get('kv', 'keyring')); }

  async create(password, iterations) {
    const { keyring, recoveryCode } = await c.createKeyring(password, this.now(), iterations);
    await this.db.put('kv', 'keyring', keyring);
    this.keyring = keyring;
    this.dek = await c.unlockWithPassword(keyring, password);
    return recoveryCode;
  }

  /** Adopt a trusted keyring on this device, then unlock with it. */
  async adopt(keyring, password) {
    const dek = await c.unlockWithPassword(keyring, password).catch(() => { throw new VaultError(WRONG_FILE_PASSWORD); });
    await this.install(keyring, dek);
  }

  async install(keyring, dek) {
    await this.db.put('kv', 'keyring', keyring);
    this.keyring = keyring;
    await this.loadAll(dek);
  }

  /**
   * Start this device from a save file. The file's outer keyring is unauthenticated, so it
   * is used only to reach the data key; the keyring that gets stored is the copy from
   * inside the ciphertext, which nobody can alter without the key.
   */
  async adoptEnvelope(env, password) {
    if (!c.isKeyringShape(env.keyring)) throw new VaultError('This file is damaged. Try a different save file.');
    const dek = await c.unlockWithPassword(env.keyring, password).catch(() => { throw new VaultError(WRONG_FILE_PASSWORD); });
    const payload = await openEnvelope(env, dek);
    await this.install(payload.keyring, dek);
  }

  /** The same, for someone who has lost the password: the only copy may be a file in OneDrive. */
  async adoptEnvelopeRecovery(env, code, newPassword) {
    if (!c.isKeyringShape(env.keyring)) throw new VaultError('This file is damaged. Try a different save file.');
    const dek = await c.unlockWithRecovery(env.keyring, code, true).catch(() => { throw new VaultError(WRONG_RECOVERY); });
    const payload = await openEnvelope(env, dek);
    const next = await c.rewrapPassword(payload.keyring, dek, newPassword, nextStamp(payload.keyring.u, this.now()));
    await this.db.put('kv', 'keyring', next);
    await this.unlockAfterRewrap(next, newPassword);
  }

  /**
   * A password changed on another device reaches this one only through a pull, which needs
   * an unlocked vault. So a refused password is tried against the newest save as well.
   */
  async unlockFromEnvelope(env, password) {
    const local = await this.db.get('kv', 'keyring');
    if (env.vaultId !== local?.vaultId || !c.isKeyringShape(env.keyring)) return false;
    const dek = await c.unlockWithPassword(env.keyring, password).catch(() => null);
    if (!dek) return false;
    const payload = await openEnvelope(env, dek).catch(() => null);
    if (!payload || !c.isKeyringShape(payload.keyring)) return false;
    // An old save must not bring back an old password: its slot has to be newer than ours,
    // and be the very slot that just opened it.
    if (payload.keyring.pw.u <= local.pw.u || canonicalJson(payload.keyring.pw) !== canonicalJson(env.keyring.pw)) return false;
    // A forged file can be wrapped with any password, so the key must open what is stored here.
    // An empty device has nothing to check against, and nothing to lose.
    const [first] = await this.db.entries('recs');
    if (first && !(await c.decryptJson(dek, first[1].iv, first[1].ct, `rec:${first[0]}`).then(() => true, () => false))) return false;
    await this.install(mergeKeyrings(local, payload.keyring), dek);
    return true;
  }

  async unlock(password) {
    const keyring = await this.db.get('kv', 'keyring');
    if (!keyring) throw new VaultError('No vault exists on this device yet.');
    const dek = await c.unlockWithPassword(keyring, password).catch(() => { throw new VaultError('That master password is not right. Check caps lock and try again.'); });
    this.keyring = keyring;
    await this.loadAll(dek);
  }

  async unlockRecovery(code, newPassword) {
    const keyring = await this.db.get('kv', 'keyring');
    if (!keyring) throw new VaultError('No vault exists on this device yet.');
    const dek = await c.unlockWithRecovery(keyring, code, true).catch(() => { throw new VaultError(WRONG_RECOVERY); });
    const next = await c.rewrapPassword(keyring, dek, newPassword, nextStamp(keyring.u, this.now()));
    await this.db.put('kv', 'keyring', next);
    await this.unlockAfterRewrap(next, newPassword);
  }

  async unlockAfterRewrap(keyring, password) {
    this.keyring = keyring;
    // Reopen as non-extractable, so the raw key cannot be read back out of memory by script.
    await this.loadAll(await c.unlockWithPassword(keyring, password));
  }

  async changePassword(oldPassword, newPassword) {
    const dek = await c.unlockWithPassword(this.keyring, oldPassword, true).catch(() => { throw new VaultError('The current password is not right, so nothing was changed.'); });
    this.keyring = await c.rewrapPassword(this.keyring, dek, newPassword, nextStamp(this.keyring.u, this.now()));
    await this.db.put('kv', 'keyring', this.keyring);
    this.emit([]);
  }

  /** Make a new recovery key without applying it. The old key must keep working until the
   *  owner confirms the new one is safe, or a closed tab could leave them with neither. */
  async prepareRecovery(password) {
    const dek = await c.unlockWithPassword(this.keyring, password, true).catch(() => { throw new VaultError('That password is not right, so the recovery key was not changed.'); });
    return c.rewrapRecovery(this.keyring, dek, nextStamp(this.keyring.u, this.now()));
  }

  /** Merged, because a pull may have brought a newer password while the key was on screen. */
  async applyKeyring(keyring) {
    this.keyring = mergeKeyrings(this.keyring, keyring);
    await this.db.put('kv', 'keyring', this.keyring);
    this.emit([]);
  }

  async replaceRecovery(password) {
    const { keyring, recoveryCode } = await this.prepareRecovery(password);
    await this.applyKeyring(keyring);
    return recoveryCode;
  }

  async checkPassword(password) {
    return c.unlockWithPassword(this.keyring, password).then(() => true, () => false);
  }

  /** Decrypt in fixed batches. WebCrypto works off the main thread, so a batch in parallel
   *  beats awaiting one record at a time, by about 10% at 5,000 items (docs/PERFORMANCE.md). */
  async loadAll(dek = this.dek) {
    const started = this.lockCount;
    const rows = await this.db.entries('recs');
    const recs = new Map();
    let unreadable = 0;
    for (let i = 0; i < rows.length; i += this.decryptBatch) {
      const batch = rows.slice(i, i + this.decryptBatch);
      const plain = await Promise.all(batch.map(([id, row]) => c.decryptJson(dek, row.iv, row.ct, `rec:${id}`).catch(() => null)));
      plain.forEach((rec, j) => {
        if (rec === null) unreadable += 1;
        else recs.set(batch[j][0], rec);
      });
    }
    // A lock while this ran wins. Finishing anyway would hand the key back.
    if (this.lockCount !== started) return;
    this.unreadable = unreadable;
    this.recs = recs;
    this.attIndex = null;
    this.rebuildHay();
    // Last, so that "unlocked" can only be true once the records are in memory. A pull or
    // write seeing the key early would work from an empty store.
    this.dek = dek;
  }

  /** Reread what another tab saved. Does not emit, so two tabs cannot ping-pong. */
  async reload() {
    if (!this.unlocked) return;
    this.keyring = (await this.db.get('kv', 'keyring')) ?? this.keyring;
    await this.loadAll();
  }

  lock() {
    this.lockCount += 1;
    this.dek = null;
    this.recs = new Map();
    this.hay = new Map();
    this.attIndex = null;
  }

  // ----- reads -----

  items() { return [...this.recs.values()].filter((r) => r.k === 'item'); }
  attachments() { return [...this.recs.values()].filter((r) => r.k === 'att'); }

  /** Files of one item, O(1) per lookup after an O(n) rebuild following a change. */
  attachmentsOf(itemId) {
    if (this.attIndex === null) {
      this.attIndex = new Map();
      for (const a of this.attachments()) {
        if (!this.attIndex.has(a.item)) this.attIndex.set(a.item, []);
        this.attIndex.get(a.item).push(a);
      }
    }
    return this.attIndex.get(itemId) ?? [];
  }

  get(id) { const r = this.recs.get(id); return r && !isTombstone(r) ? r : undefined; }
  customCategories() { return this.get(CONFIG_ID)?.cats ?? []; }

  rebuildHay() {
    const custom = this.customCategories();
    this.hay = new Map(this.items().map((i) => [i.id, haystackOf(i, custom)]));
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(ids) {
    this.attIndex = null;
    for (const fn of this.listeners) fn(ids);
  }

  // ----- writes -----

  async persist(entries) {
    const { dek } = this;
    if (!dek) throw new VaultError('The vault is locked.');
    const rows = await Promise.all(entries.map(async ([id, rec]) => {
      const { iv, ct } = await c.encryptJson(dek, rec, `rec:${id}`);
      return [id, { iv, ct }];
    }));
    await this.db.putMany('recs', rows);
  }

  /** Save an item. Throws VaultError with plain-word problems when invalid. */
  async putItem(draft) {
    const prev = this.get(draft.id);
    const now = this.now();
    const rec = { ...draft, cr: prev?.cr ?? draft.cr ?? now, u: nextStamp(this.recs.get(draft.id)?.u, now) };
    const passwordChanged = secretKeysOf(rec.t).includes('pass') && (prev?.f?.pass ?? '') !== (rec.f.pass ?? '');
    if (passwordChanged) rec.pwu = now;
    const problems = validateItem(rec, new Set(this.customCategories().map((x) => x.id)));
    if (problems.length > 0) throw new VaultError(problems.join(' '));
    await this.persist([[rec.id, rec]]);
    this.recs.set(rec.id, rec);
    this.hay.set(rec.id, haystackOf(rec, this.customCategories()));
    this.emit([rec.id]);
    return rec;
  }

  /** Bulk add for import: one IndexedDB transaction, so it saves all rows or none. */
  async addMany(records) {
    await this.persist(records.map((r) => [r.id, r]));
    const custom = this.customCategories();
    for (const r of records) { this.recs.set(r.id, r); this.hay.set(r.id, haystackOf(r, custom)); }
    this.emit(records.map((r) => r.id));
  }

  setTrash(id, inTrash) {
    const { trash, ...rest } = this.get(id);
    return this.putItem(inTrash ? { ...rest, trash: this.now() } : rest);
  }

  async purge(id) {
    const ids = [id, ...this.attachmentsOf(id).map((a) => a.id)];
    const now = this.now();
    const entries = ids.map((x) => [x, makeTombstone(nextStamp(this.recs.get(x)?.u, now))]);
    await this.persist(entries);
    for (const [x, t] of entries) { this.recs.set(x, t); this.hay.delete(x); }
    await this.db.delMany('blobs', ids);
    this.emit(ids);
  }

  async setCustomCategories(cats) {
    const rec = { id: CONFIG_ID, k: 'cfg', cats, u: nextStamp(this.recs.get(CONFIG_ID)?.u, this.now()) };
    await this.persist([[CONFIG_ID, rec]]);
    this.recs.set(CONFIG_ID, rec);
    this.rebuildHay();
    this.emit([CONFIG_ID]);
  }

  /** Add a file. The bytes are encrypted before they touch disk; metadata is a normal record. */
  async addAttachment(itemId, name, mime, bytes) {
    if (bytes.length > MAX_FILE_BYTES) throw new VaultError(`${name} is larger than 25 MB. Compress it or split it, then add it again.`);
    const id = c.newId('a');
    const now = this.now();
    const { iv, ct } = await c.encryptBytes(this.dek, bytes, `blob:${id}`);
    await this.db.put('blobs', id, { iv, ct });
    const rec = { id, k: 'att', item: itemId, name: name.slice(-255), mime: (mime || 'application/octet-stream').slice(0, 100), size: bytes.length, cr: now, u: now };
    await this.persist([[id, rec]]);
    this.recs.set(id, rec);
    this.emit([id]);
    return rec;
  }

  async readAttachment(id) {
    const row = await this.db.get('blobs', id);
    if (!row) return null;
    return c.decryptBytes(this.dek, row.iv, row.ct, `blob:${id}`);
  }

  hasBlob(id) { return this.db.get('blobs', id).then(Boolean); }

  async removeAttachment(id) {
    const entry = [id, makeTombstone(nextStamp(this.recs.get(id)?.u, this.now()))];
    await this.persist([entry]);
    this.recs.set(id, entry[1]);
    await this.db.del('blobs', id);
    this.emit([id]);
  }

  // ----- sync -----

  /**
   * Merge records from a save file. Invalid ones are dropped and counted, because a file
   * in a shared folder is untrusted. Time O(m) for m incoming records.
   * @returns {{changed:string[], rejected:number}}
   */
  async mergeRemote(object) {
    // A merge that finishes after a lock must not put decrypted records back in memory.
    if (!this.unlocked) return { changed: [], rejected: 0 };
    const incoming = new Map();
    let rejected = 0;
    for (const [id, rec] of Object.entries(object)) {
      if (validateAny(id, rec).length === 0) incoming.set(id, rec);
      else rejected += 1;
    }
    const changed = mergeInto(this.recs, incoming);
    if (changed.length > 0) {
      await this.persist(changed.map((id) => [id, this.recs.get(id)]));
      if (!this.unlocked) return { changed: [], rejected };
      const gone = changed.filter((id) => isTombstone(this.recs.get(id)));
      if (gone.length > 0) await this.db.delMany('blobs', gone);
      this.rebuildHay();
      this.emit(changed);
    }
    return { changed, rejected };
  }

  async mergeKeyring(remote) {
    if (!this.unlocked || !c.isKeyringShape(remote) || remote.vaultId !== this.keyring.vaultId) return false;
    const winner = mergeKeyrings(this.keyring, remote);
    if (canonicalJson(winner) === canonicalJson(this.keyring)) return false;
    this.keyring = winner;
    await this.db.put('kv', 'keyring', winner);
    return true;
  }

  snapshot() { return Object.fromEntries(this.recs); }
}
