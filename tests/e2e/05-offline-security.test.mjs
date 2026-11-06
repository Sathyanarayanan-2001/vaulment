import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { boot, watch, newVault, skipQuickStart, unlock, addItem, goto } from './_harness.mjs';

let b; before(async () => { b = await boot(4205); }); after(() => b.close());

test('reload, then airplane mode: the page opens and the data is there', async () => {
  const ctx = await b.browser.newContext(); const page = await ctx.newPage(); const problems = watch(page);
  await newVault(page, b.url); await skipQuickStart(page);
  await addItem(page, 'note', 'Offline made-up note');
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => 1));
  await page.reload(); await unlock(page);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  const names = await page.evaluate(() => caches.keys());
  assert.ok(names.length === 1 && names[0].startsWith('vaulment-'), names.join());
  await ctx.setOffline(true);
  await page.reload();
  await unlock(page);
  await goto(page, '#/vault');
  await page.getByRole('link', { name: 'Offline made-up note' }).waitFor();
  await addItem(page, 'note', 'Written while offline');
  await page.reload(); await unlock(page);
  await goto(page, '#/vault'); await page.getByText('2 items').waitFor();
  await ctx.setOffline(false);
  assert.deepEqual(problems.filter((p) => !/ERR_INTERNET_DISCONNECTED/.test(p)), []);
  await ctx.close();
});

test('server down, not just offline: the cached page still opens', async () => {
  const ctx = await b.browser.newContext(); const page = await ctx.newPage();
  await newVault(page, b.url); await skipQuickStart(page);
  await page.waitForFunction(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload(); await unlock(page);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  b.state.offline = true;
  await page.reload({ timeout: 15000 });
  await page.getByRole('heading', { name: 'Unlock your vault' }).waitFor();
  b.state.offline = false;
  await ctx.close();
});

test('a page tampered with in the cache is refused offline, instead of running', async () => {
  const ctx = await b.browser.newContext(); const page = await ctx.newPage();
  await newVault(page, b.url); await skipQuickStart(page);
  await page.waitForFunction(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload(); await unlock(page);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await page.evaluate(async () => {
    const [name] = await caches.keys();
    await (await caches.open(name)).put('./', new Response('<title>evil</title><h1>Poisoned</h1>', { headers: { 'Content-Type': 'text/html' } }));
  });
  await ctx.setOffline(true);
  await page.reload();
  const text = await page.locator('body').innerText();
  assert.ok(!text.includes('Poisoned'), 'tampered page must not run'); assert.match(text, /offline/i);
  await ctx.setOffline(false);
  await page.reload();
  await page.getByRole('heading', { name: 'Unlock your vault' }).waitFor();
  await ctx.close();
});

test('a new version replaces only its own cache and leaves other projects alone', async () => {
  const ctx = await b.browser.newContext(); const page = await ctx.newPage();
  await page.goto(b.url);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; await caches.open('expense-ledger-v1'); await caches.open('vaulment-old'); });
  const reg = await page.evaluate(async () => { const r = await navigator.serviceWorker.ready; await r.active.postMessage('noop'); return r.scope; });
  assert.match(reg, /\/vaulment\/$/);
  await ctx.close();
});

test('the page makes no network request once loaded, even while using every feature', async () => {
  const ctx = await b.browser.newContext(); const page = await ctx.newPage();
  await newVault(page, b.url); await skipQuickStart(page);
  const seen = [];
  page.on('request', (r) => { if (!r.url().startsWith('blob:') && !r.url().startsWith('data:')) seen.push(r.url()); });
  await addItem(page, 'login', 'Network canary', { Password: 'Made-up-Canary-1!' });
  for (const hash of ['#/vault?q=canary', '#/dashboard', '#/reminders', '#/health', '#/sync', '#/transfer', '#/settings', '#/guide']) { await goto(page, hash); await page.waitForTimeout(40); }
  assert.deepEqual(seen, []);
  await ctx.close();
});

test('CSP blocks page code from any network call, inline script and foreign images', async () => {
  const ctx = await b.browser.newContext(); const page = await ctx.newPage();
  await page.goto(b.url);
  const result = await page.evaluate(async () => {
    const out = {};
    out.fetch = await fetch('/vaulment/sw.js').then(() => 'allowed', () => 'blocked');
    out.xhr = await new Promise((res) => { const x = new XMLHttpRequest(); x.onload = () => res('allowed'); x.onerror = () => res('blocked'); x.open('GET', '/vaulment/sw.js'); x.send(); }).catch(() => 'blocked');
    navigator.sendBeacon('/vaulment/beacon-probe', 'y');
    const s = document.createElement('script'); try { s.textContent = 'window.__inline=1'; document.body.append(s); } catch { /* Trusted Types */ }
    out.inline = window.__inline === 1 ? 'ran' : 'blocked';
    out.img = await new Promise((res) => { const i = new Image(); i.onload = () => res('loaded'); i.onerror = () => res('blocked'); i.src = 'https://example.com/x.png'; });
    try { document.body.innerHTML = '<b>x</b>'; out.innerHTML = 'allowed'; } catch { out.innerHTML = 'blocked'; }
    return out;
  });
  assert.deepEqual(result, { fetch: 'blocked', xhr: 'blocked', inline: 'blocked', img: 'blocked', innerHTML: 'blocked' });
  await page.waitForTimeout(300);
  assert.equal(b.state.hits.filter((u) => u.includes('beacon-probe')).length, 0, 'sendBeacon reports queued, so the server log is the real check');
  await ctx.close();
});

test('nothing readable is stored: IndexedDB and localStorage hold no title or secret', async () => {
  const ctx = await b.browser.newContext(); const page = await ctx.newPage();
  await newVault(page, b.url); await skipQuickStart(page);
  await addItem(page, 'login', 'Storage-Canary-Title', { 'User name or email': 'storage-canary-user', Password: 'Storage-Canary-Pass-1!' });
  const dump = await page.evaluate(async () => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open('vaulment-db'); r.onsuccess = () => res(r.result); r.onerror = rej; });
    const all = (s) => new Promise((res) => { const r = db.transaction(s).objectStore(s).getAll(); r.onsuccess = () => res(r.result); });
    const toStr = (v) => (v instanceof Uint8Array ? String.fromCharCode(...v) : v && typeof v === 'object' ? Object.values(v).map(toStr).join('|') : String(v));
    const parts = [];
    for (const s of ['kv', 'recs', 'blobs']) for (const row of await all(s)) parts.push(toStr(row));
    return { idb: parts.join('\n'), ls: JSON.stringify(localStorage), keys: Object.keys(localStorage), dbs: (await indexedDB.databases()).map((d) => d.name) };
  });
  for (const c of ['Storage-Canary', 'storage-canary']) { assert.ok(!dump.idb.includes(c), c); assert.ok(!dump.ls.includes(c), c); }
  assert.ok(dump.keys.every((k) => k.startsWith('vaulment.')), dump.keys.join());
  assert.deepEqual(dump.dbs, ['vaulment-db']);
  await ctx.close();
});

test('another app on the same origin keeps its own keys: nothing outside the prefix is touched', async () => {
  const ctx = await b.browser.newContext(); const page = await ctx.newPage();
  await page.goto(b.url);
  await page.evaluate(() => { localStorage.setItem('expense-ledger.data', 'keep me'); });
  await newVault(page, b.url); await skipQuickStart(page);
  await page.getByRole('button', { name: 'Lock vault' }).click();
  assert.equal(await page.evaluate(() => localStorage.getItem('expense-ledger.data')), 'keep me');
  await ctx.close();
});

test('built page: one file, CSP is the first thing after charset, no external URLs', async () => {
  const html = await readFile(new URL('../../dist/index.html', import.meta.url), 'utf8');
  assert.match(html, /<meta charset="utf-8">\s*<meta http-equiv="Content-Security-Policy"/);
  const stripped = html.replace(/data:font\/woff2;base64,[A-Za-z0-9+/=]+/g, '');
  assert.equal(/<script[^>]+src=/.test(stripped), false);
  assert.equal(/<link[^>]+stylesheet/.test(stripped), false);
  const urls = [...stripped.matchAll(/https?:\/\/[^\s"'`)]+/g)].map((m) => m[0]).filter((u) => !u.startsWith('http://www.w3.org/') && !u.includes('${'));
  assert.deepEqual(urls.filter((u) => !/example\.(com|test)|^https?:\/?\/?$/.test(u)), []);
});
