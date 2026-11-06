import test from 'node:test';
import assert from 'node:assert/strict';
import { Vault } from '../../src/js/store/vault.js';
import { memoryBackend } from '../../src/js/store/idb.js';
import { SyncEngine, withRetry, withTimeout, DEBOUNCE_MS, KEEP_SAVES } from '../../src/js/store/sync.js';
import { packSave, parseSaveName, readEnvelope, saveFileName } from '../../src/js/store/savefile.js';
import { gunzip, decodeText, createKeyring, gzip, encodeText } from '../../src/js/crypto/vaultcrypto.js';
import { canonicalJson } from '../../src/js/core/canonical.js';
import { isTombstone } from '../../src/js/core/merge.js';
import { FakeDir } from './_folder.mjs';
import { item } from './_helpers.mjs';

const PW = 'test-only-master-pass';
const ITER = 1000;
const fastRetry = { tries: 2, baseMs: 1, timeoutMs: 2000 };
// Manual timers, so the debounce can be stepped without real waiting.
function fakeTimers() { const q = new Map(); let n = 0; return { q, set: (f, ms) => { q.set(++n, { f, ms }); return n; }, clear: (t) => q.delete(t), fire() { const c = [...q.values()]; q.clear(); c.forEach((x) => x.f()); }, delays: () => [...q.values()].map((x) => x.ms) }; }

async function devicePair(dir) {
  const a = new Vault(memoryBackend());
  await a.create(PW, ITER);
  const b = new Vault(memoryBackend());
  await b.adopt(a.keyring, PW);
  const mk = (vault, device) => new SyncEngine({ vault, device, session: `s${device}s`.padEnd(6, '0'), timers: fakeTimers(), retry: fastRetry });
  return { a, b, sa: mk(a, 'deviceaa'), sb: mk(b, 'devicebb'), dir };
}
const items = (v) => v.items().map((i) => i.title).sort();

test('file name format parses back; a foreign name does not', () => {
  const n = saveFileName('Ab+c/d1234', 'deviceaa', 'sess01', Date.UTC(2026, 10, 5, 1, 2, 3, 4));
  assert.deepEqual(parseSaveName(n), { vault: 'abcd1234', device: 'deviceaa', stamp: '20261105010203004', session: 'sess01' });
  for (const bad of ['x.json.gz', 'vaulment-save-../-1-2.json.gz', 'vaulment-save-a-1-b.json.gz']) assert.equal(parseSaveName(bad), null);
});
test('save file is gzip JSON, and records inside are ciphertext only', async () => {
  const { a, sa } = await devicePair();
  const dir = new FakeDir();
  await a.putItem(item({ title: 'Canary-Title-77', t: 'login', c: 'online', f: { pass: 'Canary-Pass-88' } }));
  await sa.connect(dir);
  const [bytes] = [...dir.store.values()].map((f) => f.bytes);
  assert.deepEqual([bytes[0], bytes[1]], [0x1f, 0x8b]); // gzip magic number
  const text = decodeText(await gunzip(bytes)); const env = JSON.parse(text);
  assert.equal(env.app, 'vaulment');
  for (const canary of ['Canary-Title', 'Canary-Pass']) assert.ok(!text.includes(canary));
});
test('two simulated devices add at the same moment: both end with both', async () => {
  const dir = new FakeDir();
  const { a, b, sa, sb } = await devicePair();
  await sa.connect(dir); await sb.connect(dir);
  await Promise.all([a.putItem(item({ title: 'Added on A' })), b.putItem(item({ title: 'Added on B' }))]);
  await Promise.all([sa.write(), sb.write()]);
  await sa.pull(); await sb.pull();
  assert.deepEqual(items(a), ['Added on A', 'Added on B']);
  assert.deepEqual(items(b), ['Added on A', 'Added on B']);
});
test('deletion on one device reaches the other as a tombstone', async () => {
  const dir = new FakeDir();
  const { a, b, sa, sb } = await devicePair();
  await sa.connect(dir); await sb.connect(dir);
  const it = await a.putItem(item({ title: 'To delete' }));
  await sa.write(); await sb.pull(); assert.ok(b.get(it.id));
  await a.purge(it.id); await sa.write(); await sb.pull();
  assert.equal(b.get(it.id), undefined); assert.ok(isTombstone(b.recs.get(it.id)));
  await sb.write(); await sa.pull(); assert.equal(a.get(it.id), undefined);
});
test('deletion beats an older edit but a later edit beats the deletion', async () => {
  const dir = new FakeDir();
  const { a, b, sa, sb } = await devicePair();
  await sa.connect(dir); await sb.connect(dir);
  const it = await a.putItem(item({ title: 'Shared' }));
  await sa.write(); await sb.pull();
  await a.purge(it.id); await sa.write();
  await new Promise((r) => setTimeout(r, 2));
  await b.putItem({ ...b.get(it.id), title: 'Edited after the delete' }); // later stamp than the tombstone
  await sb.write(); await sa.pull(); await sb.pull();
  assert.equal(a.get(it.id).title, 'Edited after the delete');
  await b.purge(it.id); await sb.write(); await sa.pull();
  assert.equal(a.get(it.id), undefined);
});
test('same record edited on both: newer u wins on both devices', async () => {
  let ta = 1000; let tb = 2000;
  const dir = new FakeDir();
  const a = new Vault(memoryBackend(), { now: () => ta }); await a.create(PW, ITER);
  const b = new Vault(memoryBackend(), { now: () => tb }); await b.adopt(a.keyring, PW);
  const sa = new SyncEngine({ vault: a, device: 'deviceaa', session: 'sessaa', timers: fakeTimers(), retry: fastRetry });
  const sb = new SyncEngine({ vault: b, device: 'devicebb', session: 'sessbb', timers: fakeTimers(), retry: fastRetry });
  await sa.connect(dir); await sb.connect(dir);
  const it = await a.putItem(item({ title: 'First' }));
  await sa.write(); await sb.pull();
  ta = 3000; await a.putItem({ ...a.get(it.id), title: 'From A' });
  tb = 4000; await b.putItem({ ...b.get(it.id), title: 'From B' });
  await sa.write(); await sb.write(); await sa.pull(); await sb.pull();
  assert.equal(a.get(it.id).title, 'From B'); assert.equal(b.get(it.id).title, 'From B');
});
test('three devices converge after merging in any order', async () => {
  const dir = new FakeDir();
  const a = new Vault(memoryBackend()); await a.create(PW, ITER);
  const vs = [a, new Vault(memoryBackend()), new Vault(memoryBackend())];
  await vs[1].adopt(a.keyring, PW); await vs[2].adopt(a.keyring, PW);
  const ss = vs.map((vault, i) => new SyncEngine({ vault, device: `device0${i}`, session: `sess0${i}`, timers: fakeTimers(), retry: fastRetry }));
  for (const s of ss) await s.connect(dir);
  for (const [i, v] of vs.entries()) await v.putItem(item({ title: `Item ${i}` }));
  for (let round = 0; round < 3; round++) for (const s of ss) { await s.write(); await s.pull(); }
  const canon = vs.map((v) => canonicalJson(v.snapshot()));
  assert.equal(canon[0], canon[1]); assert.equal(canon[1], canon[2]); assert.equal(vs[0].items().length, 3);
});
test('each session writes one file and a device keeps its newest 3', async () => {
  const dir = new FakeDir();
  const { a } = await devicePair();
  let t = Date.UTC(2026, 0, 1);
  for (let s = 0; s < 6; s++) {
    t += 60000;
    const engine = new SyncEngine({ vault: a, device: 'deviceaa', session: `sess${s}0`, now: () => t, timers: fakeTimers(), retry: fastRetry });
    await engine.connect(dir); await engine.write(); await engine.write();
  }
  const files = [...dir.store.keys()];
  assert.equal(files.length, KEEP_SAVES);
  for (const n of ['sess30', 'sess40', 'sess50']) assert.ok(files.some((f) => f.includes(n)), n);
});
test('a device reusing a folder for a new vault never prunes the old vault\'s saves', async () => {
  const dir = new FakeDir();
  const old = new Vault(memoryBackend()); await old.create('old-vault-password', ITER);
  let t = Date.UTC(2026, 0, 1);
  await new SyncEngine({ vault: old, device: 'deviceaa', session: 'sessold', now: () => t, timers: fakeTimers(), retry: fastRetry }).connect(dir);
  const fresh = new Vault(memoryBackend()); await fresh.create('new-vault-password', ITER);
  for (let s = 0; s < 6; s++) { t += 60000; await new SyncEngine({ vault: fresh, device: 'deviceaa', session: `sess${s}0`, now: () => t, timers: fakeTimers(), retry: fastRetry }).connect(dir); }
  assert.equal([...dir.store.keys()].filter((f) => f.includes('sessold')).length, 1);
});
test('a long session keeps its own save even when newer sessions of this device exist', async () => {
  const dir = new FakeDir();
  const { a } = await devicePair();
  let t = Date.UTC(2026, 0, 1);
  const long = new SyncEngine({ vault: a, device: 'deviceaa', session: 'sesslong', now: () => t, timers: fakeTimers(), retry: fastRetry });
  await long.connect(dir);
  for (let s = 0; s < 4; s++) { t += 60000; await new SyncEngine({ vault: a, device: 'deviceaa', session: `sess${s}0`, now: () => t, timers: fakeTimers(), retry: fastRetry }).connect(dir); }
  await long.write();
  assert.ok(dir.store.has(long.fileName)); assert.equal(dir.store.size, KEEP_SAVES);
});
test("pruning never touches another device's saves", async () => {
  const dir = new FakeDir();
  const { a, b } = await devicePair();
  let t = Date.UTC(2026, 0, 1);
  await new SyncEngine({ vault: b, device: 'devicebb', session: 'sessbb', now: () => t, timers: fakeTimers(), retry: fastRetry }).connect(dir);
  for (let s = 0; s < 5; s++) { t += 60000; await new SyncEngine({ vault: a, device: 'deviceaa', session: `sess${s}0`, now: () => t, timers: fakeTimers(), retry: fastRetry }).connect(dir); }
  assert.equal([...dir.store.keys()].filter((f) => f.includes('devicebb')).length, 1);
});
test('half-delivered save is skipped, does not stop sync, and is retried', async () => {
  const dir = new FakeDir();
  const { a, b, sa, sb } = await devicePair();
  await sb.connect(dir); await sa.connect(dir);
  const good = await a.putItem(item({ title: 'Later arrival' }));
  await sa.write();
  const name = [...dir.store.keys()].find((n) => n.includes('deviceaa'));
  const whole = dir.store.get(name);
  dir.store.set(name, { bytes: whole.bytes.slice(0, 40), m: 900 });
  dir.store.set('vaulment-save-aaaaaaaa-devicecc-20260101000000000-sess99.json.gz', { bytes: new Uint8Array([1, 2, 3]), m: 901 });
  await sb.pull();
  assert.equal(b.get(good.id), undefined); assert.equal(sb.skipped.size, 2); assert.notEqual(sb.state, 'problem');
  dir.store.set(name, { bytes: whole.bytes, m: 902 });
  await sb.pull();
  assert.equal(b.get(good.id).title, 'Later arrival'); assert.equal(sb.skipped.size, 1);
});
test('a file that vanishes mid-pull is skipped', async () => {
  const dir = new FakeDir();
  const { sa, sb } = await devicePair();
  await sa.connect(dir);
  dir.hook = async (op, name) => { if (op === 'read' && name.includes('deviceaa')) dir.store.delete(name); };
  await sb.connect(dir); dir.hook = null;
  assert.notEqual(sb.state, 'problem');
});
test('pull waits for a write that is still running', async () => {
  const dir = new FakeDir();
  const { a, sa } = await devicePair();
  await sa.connect(dir);
  await a.putItem(item());
  const order = []; let release; const gate = new Promise((r) => { release = r; });
  dir.hook = async (op) => { if (op === 'write') { order.push('write-start'); await gate; order.push('write-end'); } };
  const w = sa.write();
  const origPull = sa.pullOnce.bind(sa);
  sa.pullOnce = async () => { order.push('pull'); return origPull(); };
  const p = sa.pull();
  await new Promise((r) => setTimeout(r, 30));
  release(); await Promise.all([w, p]); dir.hook = null;
  assert.deepEqual(order, ['write-start', 'write-end', 'pull']);
});
test('write happens about 3 seconds after a change, and a burst is one write', async () => {
  const dir = new FakeDir();
  const { a } = await devicePair();
  const timers = fakeTimers();
  const s = new SyncEngine({ vault: a, device: 'deviceaa', session: 'sessaa', timers, retry: fastRetry });
  await s.connect(dir);
  timers.q.clear();
  s.markDirty(); s.markDirty(); s.markDirty();
  assert.deepEqual(timers.delays(), [DEBOUNCE_MS]); assert.equal(DEBOUNCE_MS, 3000); assert.equal(s.state, 'waiting');
  timers.fire(); await s.chain; assert.equal(s.state, 'saved'); assert.equal(s.dirty, false);
});
test('flush on page hide writes at once and cancels the timer', async () => {
  const dir = new FakeDir();
  const { a } = await devicePair();
  const timers = fakeTimers();
  const s = new SyncEngine({ vault: a, device: 'deviceaa', session: 'sessaa', timers, retry: fastRetry });
  await s.connect(dir); timers.q.clear();
  await a.putItem(item({ title: 'Hidden flush' })); s.markDirty();
  await s.flush();
  assert.equal(timers.q.size, 0); assert.equal(s.dirty, false); assert.equal(s.state, 'saved');
});
test('states: no folder → access; no permission → access; write failure → problem, retried, recovers', async () => {
  const { a } = await devicePair();
  const seen = []; const timers = fakeTimers();
  const s = new SyncEngine({ vault: a, device: 'deviceaa', session: 'sessaa', timers, retry: fastRetry, onState: (x) => seen.push(x) });
  s.markDirty(); assert.equal(s.state, 'access');
  const dir = new FakeDir(); dir.permission = 'prompt';
  assert.equal(await s.connect(dir), false); assert.equal(s.state, 'access');
  dir.permission = 'granted'; await s.connect(dir); assert.equal(s.state, 'saved');
  dir.hook = async (op) => { if (op === 'write') throw new Error('disk full'); };
  await s.write();
  assert.equal(s.state, 'problem'); assert.match(s.message, /disk full/); assert.match(s.message, /safe on this device/); assert.equal(s.dirty, true);
  dir.hook = null; timers.fire(); await s.chain; assert.equal(s.state, 'saved');
  for (const st of ['saving', 'saved', 'problem', 'access']) assert.ok(seen.includes(st), st);
});
test('a save from a different vault is left alone and reported', async () => {
  const dir = new FakeDir();
  const { a, sa } = await devicePair();
  const other = new Vault(memoryBackend()); await other.create('another-password', ITER);
  await other.putItem(item({ title: 'Stranger' }));
  const so = new SyncEngine({ vault: other, device: 'deviceoo', session: 'sessoo', timers: fakeTimers(), retry: fastRetry });
  await so.connect(dir);
  await sa.connect(dir);
  // Connecting writes a save too, and that must not clear the warning.
  assert.equal(a.items().length, 0); assert.equal(sa.state, 'problem'); assert.match(sa.message, /different vault/);
  await sa.pull(); assert.equal(sa.state, 'problem');
  await dir.removeEntry([...dir.store.keys()].find((n) => n.includes('deviceoo')));
  await sa.pull(); assert.equal(sa.state, 'saved');
});
test('tampered save fails authentication and merges nothing', async () => {
  const dir = new FakeDir();
  const { a, b, sa, sb } = await devicePair();
  await a.putItem(item({ title: 'Original' })); await sa.connect(dir);
  const name = [...dir.store.keys()][0];
  const env = JSON.parse(decodeText(await gunzip(dir.store.get(name).bytes)));
  env.ct = env.ct.replace(/^.{8}/, 'AAAAAAAA');
  dir.store.set(name, { bytes: await gzip(encodeText(JSON.stringify(env))), m: 999 });
  await sb.connect(dir);
  assert.equal(b.items().length, 0); assert.equal(sb.skipped.size, 1);
});
test('attachments travel through the blobs folder, encrypted; file bytes match', async () => {
  const dir = new FakeDir();
  const { a, b, sa, sb } = await devicePair();
  await sa.connect(dir); await sb.connect(dir);
  const it = await a.putItem(item());
  const payload = encodeText('sample-scan-canary');
  const att = await a.addAttachment(it.id, 'scan.png', 'image/png', payload);
  await sa.write(); await sb.pull();
  const blobFile = dir.dirs.get('blobs').store.get(`${att.id}.bin`);
  assert.ok(!Buffer.from(blobFile.bytes).toString('latin1').includes('canary'));
  assert.deepEqual(await b.readAttachment(att.id), payload);
  assert.ok(sa.vault.get(att.id).size === payload.length);
  await a.removeAttachment(att.id); await sa.write();
  assert.equal(dir.dirs.get('blobs').store.size, 0);
  await sb.pull(); assert.equal(await b.readAttachment(att.id), null);
});
test('late attachment: record arrives first, the file follows on a later pull', async () => {
  const dir = new FakeDir();
  const { a, b, sa, sb } = await devicePair();
  await sa.connect(dir); await sb.connect(dir);
  const it = await a.putItem(item());
  const att = await a.addAttachment(it.id, 'scan.png', 'image/png', encodeText('x'));
  await sa.write();
  const blobs = dir.dirs.get('blobs'); const held = blobs.store.get(`${att.id}.bin`); blobs.store.delete(`${att.id}.bin`);
  await sb.pull(); assert.equal(sb.pendingBlobs, 1); assert.equal(await b.hasBlob(att.id), false);
  blobs.store.set(`${att.id}.bin`, held);
  await sa.write(); await sb.pull(); assert.equal(sb.pendingBlobs, 0); assert.equal(await b.hasBlob(att.id), true);
});
test('password change reaches the other device through the authenticated copy', async () => {
  const dir = new FakeDir();
  const { a, b, sa, sb } = await devicePair();
  await sa.connect(dir); await sb.connect(dir);
  await a.changePassword(PW, 'brand-new-password');
  await sa.write(); await sb.pull();
  assert.equal(await b.checkPassword('brand-new-password'), true);
});
test('keyring slots merge separately: password on A and recovery key on B both survive', async () => {
  const dir = new FakeDir();
  const { a, b, sa, sb } = await devicePair();
  await sa.connect(dir); await sb.connect(dir);
  await a.changePassword(PW, 'password-from-device-a');
  await new Promise((r) => setTimeout(r, 2));
  const code = await b.replaceRecovery(PW);
  await sa.write(); await sb.write(); await sa.pull(); await sb.pull();
  for (const v of [a, b]) {
    assert.equal(await v.checkPassword('password-from-device-a'), true);
    assert.equal(canonicalJson(v.keyring.rc), canonicalJson(b.keyring.rc));
  }
  const c = new Vault(memoryBackend()); await c.db.put('kv', 'keyring', a.keyring);
  await c.unlockRecovery(code, 'after-recovery-password');
});
test('a new device stores the keyring from inside the ciphertext, not the tampered outer copy', async () => {
  const { a, sa } = await devicePair();
  await a.putItem(item({ title: 'Kept' }));
  const honest = canonicalJson(a.keyring.rc);
  const env = await readEnvelope(await sa.exportBundle());
  env.keyring = { ...env.keyring, u: 9e12, rc: { ...env.keyring.rc, ct: 'AAAA', u: 9e12 } };
  const c = new Vault(memoryBackend()); await c.adoptEnvelope(env, PW);
  assert.equal(canonicalJson(c.keyring.rc), honest); assert.ok(c.unlocked);
});
test('a keyring with an absurd iteration count is refused before any key stretching', async () => {
  const { sa } = await devicePair();
  const env = await readEnvelope(await sa.exportBundle());
  env.keyring = { ...env.keyring, pw: { ...env.keyring.pw, iter: 2 ** 40 } };
  await assert.rejects(new Vault(memoryBackend()).adoptEnvelope(env, PW), /damaged/);
});
test('laptop lost and password forgotten: a save file plus the recovery key is enough', async () => {
  const a = new Vault(memoryBackend()); const code = await a.create(PW, ITER);
  await a.putItem(item({ title: 'Survives the laptop' }));
  const s = new SyncEngine({ vault: a, device: 'deviceaa', session: 'sessaa', timers: fakeTimers(), retry: fastRetry });
  const env = await readEnvelope(await s.exportBundle());
  const c = new Vault(memoryBackend());
  await assert.rejects(c.adoptEnvelopeRecovery(env, 'AAAAA-AAAAA-AAAAA-AAAAA-AAAAA-AAAAA', 'new-password-here'), /recovery key is not right/);
  await c.adoptEnvelopeRecovery(env, code, 'new-password-here');
  const sc = new SyncEngine({ vault: c, device: 'devicecc', session: 'sesscc', timers: fakeTimers(), retry: fastRetry });
  await sc.importBundle(await s.exportBundle());
  assert.deepEqual(items(c), ['Survives the laptop']); c.lock();
  await c.unlock('new-password-here');
});
test('locked device accepts a password changed elsewhere, proven by the newest save', async () => {
  const dir = new FakeDir();
  const { a, b, sa } = await devicePair();
  const dbB = b.db; b.lock();
  await sa.connect(dir);
  await a.changePassword(PW, 'changed-on-device-a'); await sa.write();
  const v = new Vault(dbB);
  await assert.rejects(v.unlock('changed-on-device-a'));
  const found = await SyncEngine.newestEnvelope(dir);
  assert.ok(found);
  assert.equal(await v.unlockFromEnvelope(found.env, 'wrong-password-x'), false);
  assert.equal(await v.unlockFromEnvelope(found.env, 'changed-on-device-a'), true);
  v.lock(); await new Vault(dbB).unlock('changed-on-device-a');
});
test('nothing marks the vault unlocked until its records are loaded', async () => {
  const { a } = await devicePair();
  await a.putItem(item());
  const v = new Vault(a.db);
  const seen = [];
  const entries = a.db.entries; v.db = { ...a.db, entries: async (s) => { seen.push(v.unlocked); return entries(s); } };
  await v.unlock(PW);
  assert.deepEqual(seen, [false]); assert.equal(v.unlocked, true); assert.equal(v.items().length, 1);
});
test('a merge finishing after lock leaves nothing in memory, and writes are skipped', async () => {
  const { a, sa } = await devicePair();
  await sa.connect(new FakeDir());
  a.lock();
  assert.deepEqual(await a.mergeRemote({ r_lateitem001: item({ id: 'r_lateitem001' }) }), { changed: [], rejected: 0 });
  assert.equal(a.recs.size, 0);
  await sa.write(); assert.notEqual(sa.state, 'problem');
});
test('a truncated attachment is not stored, and the full one is picked up later', async () => {
  const dir = new FakeDir();
  const { a, b, sa, sb } = await devicePair();
  await sa.connect(dir); await sb.connect(dir);
  const it = await a.putItem(item());
  const att = await a.addAttachment(it.id, 'scan.png', 'image/png', encodeText('whole file'));
  await sa.write();
  const blobs = dir.dirs.get('blobs'); const whole = blobs.store.get(`${att.id}.bin`);
  blobs.store.set(`${att.id}.bin`, { bytes: whole.bytes.slice(0, 20), m: 500 });
  await sb.pull(); assert.equal(sb.pendingBlobs, 1); assert.equal(await b.hasBlob(att.id), false);
  blobs.store.set(`${att.id}.bin`, whole);
  await sb.pullBlobs(); assert.equal(decodeText(await b.readAttachment(att.id)), 'whole file');
});
test('backup reports files it could not include', async () => {
  const { a, sa } = await devicePair();
  const it = await a.putItem(item());
  const att = await a.addAttachment(it.id, 'x.pdf', 'application/pdf', encodeText('x'));
  await a.db.del('blobs', att.id);
  await sa.exportBundle(); assert.equal(sa.bundleMissing, 1);
});
test('bring back old items: a deleted item and an old version return as copies; current data untouched', async () => {
  const { a, sa } = await devicePair();
  const gone = await a.putItem(item({ title: 'Deleted later' }));
  await a.addAttachment(gone.id, 'keep.pdf', 'application/pdf', encodeText('old file'));
  const edited = await a.putItem(item({ title: 'Original text' }));
  await a.putItem(item({ title: 'Never changed' }));
  const backup = await sa.exportBundle();
  await a.purge(gone.id);
  await a.putItem({ ...edited, title: 'New text' });
  const r = await sa.restoreCopies(backup);
  assert.deepEqual(r, { items: 2, files: 1 });
  assert.deepEqual(items(a), ['Deleted later (restored)', 'Never changed', 'New text', 'Original text (restored)']);
  const copy = a.items().find((i) => i.title === 'Deleted later (restored)');
  assert.equal(decodeText(await a.readAttachment(a.attachmentsOf(copy.id)[0].id)), 'old file');
  assert.equal(a.get(gone.id), undefined);
  assert.deepEqual(await sa.restoreCopies(backup), { items: 2, files: 1 }, 'a second run adds copies rather than failing');
});
test('manual bundle: full round trip into a new device, files included, counts match', async () => {
  const { a, sa } = await devicePair();
  const it = await a.putItem(item({ title: 'In bundle', amt: 12345 }));
  await a.addAttachment(it.id, 'n.pdf', 'application/pdf', encodeText('pdf-bytes'));
  const bytes = await sa.exportBundle();
  const env = await readEnvelope(bytes);
  const c = new Vault(memoryBackend()); await c.adopt(env.keyring, PW);
  const sc = new SyncEngine({ vault: c, device: 'devicecc', session: 'sesscc', timers: fakeTimers(), retry: fastRetry });
  const r = await sc.importBundle(bytes);
  assert.equal(r.files, 1); assert.equal(c.items().length, 1); assert.equal(c.attachments().length, 1); assert.equal(c.items()[0].amt, 12345);
  assert.equal(decodeText(await c.readAttachment(c.attachments()[0].id)), 'pdf-bytes');
});
test('bundle from another vault is refused', async () => {
  const { sa } = await devicePair();
  const k = await createKeyring('x-other-password', 1, ITER);
  const v = new Vault(memoryBackend()); await v.adopt(k.keyring, 'x-other-password');
  const bytes = await packSave({ dek: v.dek, keyring: v.keyring, recs: {}, device: 'x', session: 'y', nowMs: 1 });
  await assert.rejects(sa.importBundle(bytes), /different vault/);
});
test('garbage files are refused with a message', async () => {
  await assert.rejects(readEnvelope(await gzip(encodeText('{"app":"other"}'))), /Not a Vaulment/);
  await assert.rejects(readEnvelope(await gzip(encodeText('{"app":"vaulment","format":99,"iv":"","ct":"","vaultId":"x","keyring":{}}'))), /newer version/);
});
test('retry: backoff doubles and it stops after the limit', async () => {
  const waits = []; let calls = 0;
  await assert.rejects(withRetry(async () => { calls++; throw new Error('x'); }, { tries: 3, baseMs: 500, sleep: async (ms) => waits.push(ms) }));
  assert.equal(calls, 3); assert.deepEqual(waits, [500, 1000]);
});
test('retry: second attempt succeeding returns its value', async () => { let n = 0; assert.equal(await withRetry(async () => { if (++n < 2) throw new Error('x'); return 'ok'; }, { baseMs: 0 }), 'ok'); });
test('timeout: a hung operation rejects', async () => assert.rejects(withTimeout(() => new Promise(() => {}), 10), /timed out/));
