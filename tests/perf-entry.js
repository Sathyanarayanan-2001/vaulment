// Bench bundle: runs in a real browser page against real IndexedDB and WebCrypto.
import { Vault } from '../src/js/store/vault.js';
import { openIdbBackend } from '../src/js/store/idb.js';
import { packSave, readEnvelope, openEnvelope } from '../src/js/store/savefile.js';
import { queryItems, sortItems } from '../src/js/core/search.js';
import { computeStats } from '../src/js/core/stats.js';
import { canonicalJson } from '../src/js/core/canonical.js';
import { h } from '../src/js/ui/dom.js';

const time = async (fn) => { const t = performance.now(); await fn(); return performance.now() - t; };
const median = (list) => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];
const med3 = async (fn) => { const r = []; for (let i = 0; i < 3; i++) r.push(await time(fn)); return Math.round(median(r) * 10) / 10; };

window.bench = async (n) => {
  const out = {};
  const db = await openIdbBackend();
  const v = new Vault(db);
  await v.create('made-up bench passphrase 1');
  const now = Date.now();
  const recs = [];
  for (let i = 0; i < n; i++) recs.push({ id: `r_bench${String(i).padStart(8, '0')}`, k: 'item', c: ['banking', 'online', 'office', 'warranty'][i % 4], t: 'login', title: `Sample account ${i}`, f: { url: 'https://example.test', user: `user${i}@example.test`, pass: `Made-up-${i}!x` }, doc: '2026-04-01', exp: '', amt: i, tags: ['sample'], notes: 'Made-up note text for sizing.', fav: 0, cr: now, u: now });
  const atts = [];
  for (let i = 0; i < 500; i++) atts.push({ id: `a_bench${String(i).padStart(8, '0')}`, k: 'att', item: recs[i].id, name: `f${i}.pdf`, mime: 'application/pdf', size: 10, cr: now, u: now });
  await v.addMany([...recs, ...atts]);
  await db.putMany('blobs', atts.map((a) => [a.id, { iv: new Uint8Array(12), ct: new Uint8Array(32) }]));

  const load = (batch) => { const x = new Vault(db, { decryptBatch: batch }); x.dek = v.dek; x.keyring = v.keyring; return x.loadAll(); };
  out.unlockDecryptBefore = await med3(() => load(1));
  out.unlockDecryptAfter = await med3(() => load(200));

  const lock = new Vault(db);
  out.unlockFull = await med3(async () => { await lock.unlock('made-up bench passphrase 1'); lock.lock(); });

  const row = (it) => h('tr', null, h('td', null, it.title), h('td', null, it.c), h('td', null, it.doc), h('td', null, it.exp), h('td', null, 'Copy'));
  const draw = (count) => { const host = h('table', null, h('tbody', null, recs.slice(0, count).map(row))); document.body.replaceChildren(host); return host.getBoundingClientRect().height; };
  out.listDrawBefore = await med3(() => draw(n));
  out.listDrawAfter = await med3(() => draw(100));
  document.body.replaceChildren();

  out.blobCheckBefore = await med3(async () => { for (const a of atts) await db.get('blobs', a.id); });
  out.blobCheckAfter = await med3(async () => { const s = new Set(await db.keys('blobs')); for (const a of atts) s.has(a.id); });

  const items = v.items();
  out.fileLookupBefore = await med3(() => { for (const it of items.slice(0, 2000)) v.attachments().filter((a) => a.item === it.id); });
  out.fileLookupAfter = await med3(() => { for (const it of items.slice(0, 2000)) v.attachmentsOf(it.id); });

  out.searchKeystroke = await med3(() => queryItems(items, v.hay, { q: 'sample 4999' }));
  out.sortAll = await med3(() => sortItems(items, 'title'));
  out.dashboard = await med3(() => computeStats(items, atts, [], now));
  let bytes;
  out.writeSave = await med3(async () => { bytes = await packSave({ dek: v.dek, keyring: v.keyring, recs: v.snapshot(), device: 'benchaa', session: 'sessaa', nowMs: now }); });
  out.saveFileKB = Math.round(bytes.length / 1024);
  out.readSave = await med3(async () => { await openEnvelope(await readEnvelope(bytes), v.dek); });
  const remote = Object.fromEntries(recs.map((r) => [r.id, { ...r, u: now + 1, title: `${r.title} edited` }]));
  out.mergeAllChanged = await med3(async () => { for (const r of Object.values(remote)) r.u += 1; await v.mergeRemote(remote); });
  out.canonicalOne = await med3(() => { for (let i = 0; i < n; i++) canonicalJson(recs[i]); });
  db.close();
  return out;
};
