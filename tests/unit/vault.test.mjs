import test from 'node:test';
import assert from 'node:assert/strict';
import { Vault, VaultError } from '../../src/js/store/vault.js';
import { memoryBackend } from '../../src/js/store/idb.js';
import * as c from '../../src/js/crypto/vaultcrypto.js';
import { item } from './_helpers.mjs';

// A low iteration count keeps tests quick; one test below checks the real default is used.
const ITER = 1000;
const fresh = async (pw = 'correct horse battery') => { const db = memoryBackend(); const v = new Vault(db); const code = await v.create(pw, ITER); return { v, db, code }; };

test('default iteration count is OWASP 600,000', () => assert.equal(c.PBKDF2_ITERATIONS, 600000));
test('encrypt then decrypt returns the same text, UTF-8 included', async () => {
  const { v } = await fresh();
  const { iv, ct } = await c.encryptJson(v.dek, { a: 'தமிழ் ₹' }, 'x');
  assert.deepEqual(await c.decryptJson(v.dek, iv, ct, 'x'), { a: 'தமிழ் ₹' });
});
test('swapping ciphertext between records fails authentication', async () => {
  const { v } = await fresh();
  const { iv, ct } = await c.encryptJson(v.dek, { a: 1 }, 'rec:one');
  await assert.rejects(c.decryptJson(v.dek, iv, ct, 'rec:two'));
});
test('a flipped ciphertext bit fails authentication', async () => {
  const { v } = await fresh();
  const { iv, ct } = await c.encryptJson(v.dek, { a: 1 }, 'x');
  ct[0] ^= 1; await assert.rejects(c.decryptJson(v.dek, iv, ct, 'x'));
});
test('the data key cannot be exported once unlocked', async () => { const { v } = await fresh(); await assert.rejects(globalThis.crypto.subtle.exportKey('raw', v.dek)); });
test('IVs never repeat over 2,000 encryptions', async () => {
  const { v } = await fresh(); const seen = new Set();
  for (let i = 0; i < 2000; i++) seen.add(c.toBase64((await c.encryptJson(v.dek, 1, 'x')).iv));
  assert.equal(seen.size, 2000);
});
test('base64 round trip on 300 KB (past the call-stack limit)', () => { const b = c.randomBytes(65536); const big = new Uint8Array(300000); for (let i = 0; i < 300000; i += 65536) big.set(b.subarray(0, Math.min(65536, 300000 - i)), i); assert.deepEqual(c.fromBase64(c.toBase64(big)), big); });
test('gzip round trip', async () => { const b = c.encodeText('a'.repeat(10000)); const z = await c.gzip(b); assert.ok(z.length < 200); assert.deepEqual(await c.gunzip(z), b); });
test('recovery code: 6 groups of 5, none of I L O U; 1,000 unique', () => {
  const s = new Set(); for (let i = 0; i < 1000; i++) { const r = c.newRecoveryCode(); assert.match(r, /^([0-9A-HJKMNP-TV-Z]{5}-){5}[0-9A-HJKMNP-TV-Z]{5}$/); s.add(r); }
  assert.equal(s.size, 1000);
});
test('id format matches the schema and is unique', () => { const s = new Set(); for (let i = 0; i < 1000; i++) { const x = c.newId('r'); assert.match(x, /^r_[a-z0-9]{20}$/); s.add(x); } assert.equal(s.size, 1000); });

test('nothing readable reaches the database: title, password and number are absent', async () => {
  const { v, db } = await fresh();
  await v.putItem(item({ title: 'Sample secret title', t: 'login', c: 'online', f: { pass: 'Plaintext-Canary-42', user: 'canary-user' } }));
  const blob = Buffer.concat([...db.data.recs.values()].map((r) => Buffer.from(r.ct))).toString('latin1');
  for (const canary of ['Sample secret', 'Plaintext-Canary', 'canary-user']) assert.ok(!blob.includes(canary));
  assert.ok(!JSON.stringify([...db.data.kv.values()]).includes('Plaintext-Canary'));
});
test('wrong password refused with a plain message; right one reopens the data', async () => {
  const { v, db } = await fresh();
  const rec = await v.putItem(item({ title: 'Kept' }));
  v.lock(); assert.equal(v.unlocked, false); assert.equal(v.recs.size, 0);
  const v2 = new Vault(db);
  await assert.rejects(v2.unlock('nope'), (e) => e instanceof VaultError && /not right/.test(e.message));
  assert.equal(v2.unlocked, false);
  await v2.unlock('correct horse battery'); assert.equal(v2.get(rec.id).title, 'Kept');
});
test('password change keeps data; old password stops working', async () => {
  const { v, db } = await fresh();
  const rec = await v.putItem(item({ title: 'Kept' }));
  await assert.rejects(v.changePassword('bad', 'new one here'));
  await v.changePassword('correct horse battery', 'new one here');
  const v2 = new Vault(db);
  await assert.rejects(v2.unlock('correct horse battery'));
  await v2.unlock('new one here'); assert.equal(v2.get(rec.id).title, 'Kept');
});
test('NFKC: same password in composed and decomposed form opens the vault', async () => {
  const { v, db } = await fresh('café-long-password'); v.lock();
  await new Vault(db).unlock('café-long-password');
});
test('recovery key sets a new password and keeps data', async () => {
  const { v, db, code } = await fresh();
  const rec = await v.putItem(item({ title: 'Kept' })); v.lock();
  const v2 = new Vault(db);
  await assert.rejects(v2.unlockRecovery('AAAAA-AAAAA-AAAAA-AAAAA-AAAAA-AAAAA', 'x-new-password'));
  await v2.unlockRecovery(code.toLowerCase().replace(/-/g, ' '), 'x-new-password');
  assert.equal(v2.get(rec.id).title, 'Kept'); v2.lock();
  await new Vault(db).unlock('x-new-password');
});
test('replacing the recovery key voids the old one', async () => {
  const { v, db, code } = await fresh();
  const next = await v.replaceRecovery('correct horse battery'); assert.notEqual(next, code);
  await assert.rejects(new Vault(db).unlockRecovery(code, 'whatever-pass'));
  await new Vault(db).unlockRecovery(next, 'whatever-pass');
});
test('putItem refuses invalid data and stores nothing', async () => {
  const { v, db } = await fresh();
  await assert.rejects(v.putItem(item({ title: '' })), /Add a title/);
  assert.equal(db.data.recs.size, 0);
});
test('password date changes only when the password does', async () => {
  let t = 1000; const v = new Vault(memoryBackend(), { now: () => t }); await v.create('pw-for-this-test', ITER);
  const r = await v.putItem(item({ t: 'login', c: 'online', f: { pass: 'one' } })); assert.equal(r.pwu, 1000);
  t = 2000; const r2 = await v.putItem({ ...r, title: 'renamed' }); assert.equal(r2.pwu, 1000);
  t = 3000; const r3 = await v.putItem({ ...r2, f: { pass: 'two' } }); assert.equal(r3.pwu, 3000);
});
test('editing with a slow clock still beats the last stamp', async () => {
  let t = 9000; const v = new Vault(memoryBackend(), { now: () => t }); await v.create('pw-for-this-test', ITER);
  const r = await v.putItem(item()); t = 100;
  assert.equal((await v.putItem(r)).u, 9001);
});
test('attachments: bytes stored encrypted, read back exact, oversize refused', async () => {
  const { v, db } = await fresh();
  const it = await v.putItem(item());
  const bytes = c.encodeText('%PDF-sample-canary-text');
  const att = await v.addAttachment(it.id, 'sample.pdf', 'application/pdf', bytes);
  assert.ok(!Buffer.from(db.data.blobs.get(att.id).ct).toString('latin1').includes('canary'));
  assert.deepEqual(await v.readAttachment(att.id), bytes);
  await assert.rejects(v.addAttachment(it.id, 'big.bin', '', { length: 26 * 1024 * 1024 }), /25 MB/);
});
test('trash keeps the item and restore brings it back; purge leaves only a tombstone', async () => {
  const { v, db } = await fresh();
  const it = await v.putItem(item());
  const att = await v.addAttachment(it.id, 'a.pdf', 'application/pdf', new Uint8Array(3));
  await v.setTrash(it.id, true); assert.ok(v.get(it.id).trash);
  await v.setTrash(it.id, false); assert.equal(v.get(it.id).trash, undefined);
  await v.purge(it.id);
  assert.equal(v.get(it.id), undefined); assert.equal(v.get(att.id), undefined);
  assert.deepEqual(Object.keys(v.recs.get(it.id)).sort(), ['d', 'u']);
  assert.equal(db.data.blobs.size, 0);
});
test('mergeRemote drops malformed records and counts them', async () => {
  const { v } = await fresh();
  const good = item({ title: 'Good' });
  const r = await v.mergeRemote({ [good.id]: good, 'r_badbadbad1': { id: 'r_badbadbad1', k: 'item', title: '<x>' }, '../evil': { d: 1, u: 1 } });
  assert.equal(r.rejected, 2); assert.equal(r.changed.length, 1);
  assert.equal(v.get(good.id).title, 'Good');
});
test('custom categories persist and a custom-category item validates', async () => {
  const { v, db } = await fresh();
  await v.setCustomCategories([{ id: 'u_mycategory1', label: 'Pets' }]);
  const r = await v.putItem(item({ c: 'u_mycategory1' }));
  v.lock(); const v2 = new Vault(db); await v2.unlock('correct horse battery');
  assert.equal(v2.customCategories()[0].label, 'Pets'); assert.equal(v2.get(r.id).c, 'u_mycategory1');
});
