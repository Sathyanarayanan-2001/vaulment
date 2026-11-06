// Written and passing before the attachment-index and blob-set refactors, to pin what the
// code did, so the refactors could be shown to change speed and nothing else.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Vault } from '../../src/js/store/vault.js';
import { memoryBackend } from '../../src/js/store/idb.js';
import { SyncEngine } from '../../src/js/store/sync.js';
import { encodeText } from '../../src/js/crypto/vaultcrypto.js';
import { FakeDir } from './_folder.mjs';
import { item } from './_helpers.mjs';

const timers = { set: () => 0, clear: () => {} };
const open = async () => { const v = new Vault(memoryBackend()); await v.create('characterisation-pass', 1000); return v; };

test('attachmentsOf: per parent, excludes others, order of insertion, reflects add, remove and purge', async () => {
  const v = await open();
  const a = await v.putItem(item({ title: 'A' })); const b = await v.putItem(item({ title: 'B' }));
  const a1 = await v.addAttachment(a.id, 'one.pdf', 'application/pdf', encodeText('1'));
  const a2 = await v.addAttachment(a.id, 'two.pdf', 'application/pdf', encodeText('2'));
  const b1 = await v.addAttachment(b.id, 'three.pdf', 'application/pdf', encodeText('3'));
  assert.deepEqual(v.attachmentsOf(a.id).map((x) => x.name), ['one.pdf', 'two.pdf']);
  assert.deepEqual(v.attachmentsOf(b.id).map((x) => x.id), [b1.id]);
  assert.deepEqual(v.attachmentsOf('r_nothinghere1'), []);
  await v.removeAttachment(a1.id);
  assert.deepEqual(v.attachmentsOf(a.id).map((x) => x.id), [a2.id]);
  await v.purge(a.id);
  assert.deepEqual(v.attachmentsOf(a.id), []);
  assert.equal(v.attachments().length, 1);
});
test('attachmentsOf: sees files that arrive by merge, and drops those deleted by merge', async () => {
  const v = await open();
  const it = await v.putItem(item());
  const incoming = { id: 'a_mergedfile01', k: 'att', item: it.id, name: 'm.pdf', mime: 'application/pdf', size: 1, cr: 1, u: 1 };
  await v.mergeRemote({ a_mergedfile01: incoming });
  assert.equal(v.attachmentsOf(it.id).length, 1);
  await v.mergeRemote({ a_mergedfile01: { d: 1, u: 2 } });
  assert.equal(v.attachmentsOf(it.id).length, 0);
});
test('attachmentsOf: cleared by lock, rebuilt by unlock', async () => {
  const db = memoryBackend(); const v = new Vault(db); await v.create('characterisation-pass', 1000);
  const it = await v.putItem(item()); await v.addAttachment(it.id, 'x.pdf', 'application/pdf', encodeText('x'));
  v.lock(); assert.deepEqual(v.attachmentsOf(it.id), []);
  await v.unlock('characterisation-pass'); assert.equal(v.attachmentsOf(it.id).length, 1);
});
test('pullBlobs: fetches only what is missing, counts what has not arrived, keeps existing bytes', async () => {
  const v = await open();
  const it = await v.putItem(item());
  const have = await v.addAttachment(it.id, 'have.pdf', 'application/pdf', encodeText('have'));
  await v.mergeRemote({ a_missingfile1: { id: 'a_missingfile1', k: 'att', item: it.id, name: 'x.pdf', mime: 'application/pdf', size: 1, cr: 1, u: 1 } });
  const dir = new FakeDir();
  const s = new SyncEngine({ vault: v, device: 'deviceaa', session: 'sessaa', timers });
  s.dir = dir;
  await s.pullBlobs();
  assert.equal(s.pendingBlobs, 1);
  assert.equal(new TextDecoder().decode(await v.readAttachment(have.id)), 'have');
});
