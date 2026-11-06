import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { boot, watch, newVault, skipQuickStart, unlock, addItem, goto, shareFolder, MASTER } from './_harness.mjs';

let b; before(async () => { b = await boot(4204); }); after(() => b.close());

async function laptop(dir) {
  const ctx = await b.browser.newContext();
  await shareFolder(ctx, dir);
  const page = await ctx.newPage();
  return { ctx, page, problems: watch(page) };
}
const chip = (p) => p.locator('#sync-chip');
const chooseFolder = async (p) => { await goto(p, '#/sync'); await p.getByRole('button', { name: 'Choose folder' }).click(); await p.getByText('Sync folder connected.').first().waitFor(); };
const syncNow = async (p) => { await goto(p, '#/sync'); await p.locator('#sync-now').click(); await p.getByText('Sync finished.').first().waitFor(); };

test('two laptops, one folder: add at the same time, both see both; delete on one reaches the other', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'vaulment-sync-'));
  const A = await laptop(dir); const B = await laptop(dir);
  await newVault(A.page, b.url); await skipQuickStart(A.page);
  await chip(A.page).filter({ hasText: 'Folder access needed' }).waitFor();
  await chooseFolder(A.page);
  await chip(A.page).filter({ hasText: 'Saved' }).waitFor();

  await B.page.goto(b.url);
  await B.page.getByRole('button', { name: 'Bring my vault to this device' }).click();
  await B.page.getByRole('button', { name: 'Choose sync folder' }).click();
  await B.page.locator('#restore-pw').fill(MASTER);
  await B.page.getByRole('button', { name: 'Open my vault' }).click();
  await chip(B.page).filter({ hasText: 'Saved' }).waitFor();

  await Promise.all([addItem(A.page, 'note', 'Note from laptop A'), addItem(B.page, 'note', 'Note from laptop B')]);
  await syncNow(A.page); await syncNow(B.page); await syncNow(A.page);
  for (const L of [A, B]) { await goto(L.page, '#/vault'); await L.page.getByText('2 items').waitFor(); }

  await goto(A.page, '#/vault?q=laptop%20B');
  await A.page.getByRole('link', { name: 'Note from laptop B' }).click();
  await A.page.getByRole('button', { name: 'Move to trash' }).click();
  await A.page.locator('dialog').getByRole('button', { name: 'Move to trash' }).click();
  await A.page.waitForFunction(() => location.hash === '#/vault');
  await goto(A.page, '#/vault?view=trash');
  await A.page.getByRole('button', { name: 'Delete forever' }).click();
  await A.page.locator('dialog').getByRole('button', { name: 'Delete forever' }).click();
  await A.page.getByText('The trash is empty').waitFor();
  await syncNow(A.page); await syncNow(B.page);
  await goto(B.page, '#/vault'); await B.page.getByText('1 item', { exact: true }).waitFor();
  assert.equal(await B.page.getByText('Note from laptop B').count(), 0);

  const names = await readdir(dir);
  assert.ok(names.every((n) => /^vaulment-save-.*\.json\.gz$/.test(n) || n === 'blobs'), names.join());
  for (const n of names.filter((x) => x !== 'blobs')) {
    const text = gunzipSync(await readFile(join(dir, n))).toString();
    assert.ok(!text.includes('Note from laptop'), 'save file must hold no plain text');
    assert.equal(JSON.parse(text).app, 'vaulment');
  }
  assert.deepEqual([...A.problems, ...B.problems], []);
  await A.ctx.close(); await B.ctx.close();
});

test('password changed on laptop A: locked laptop B opens with the new one, read from the folder', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'vaulment-sync-'));
  const A = await laptop(dir); const B = await laptop(dir);
  await newVault(A.page, b.url); await skipQuickStart(A.page);
  await chooseFolder(A.page);
  await chip(A.page).filter({ hasText: 'Saved' }).waitFor();
  await B.page.goto(b.url);
  await B.page.getByRole('button', { name: 'Bring my vault to this device' }).click();
  await B.page.getByRole('button', { name: 'Choose sync folder' }).click();
  await B.page.locator('#restore-pw').fill(MASTER);
  await B.page.getByRole('button', { name: 'Open my vault' }).click();
  await chip(B.page).filter({ hasText: 'Saved' }).waitFor();
  await B.page.getByRole('button', { name: 'Lock vault' }).click();
  await B.page.getByRole('heading', { name: 'Unlock your vault' }).waitFor();
  await goto(A.page, '#/settings');
  await A.page.locator('#cp-old').fill(MASTER); await A.page.locator('#cp-new').fill('changed on laptop A 5'); await A.page.locator('#cp-new2').fill('changed on laptop A 5');
  await A.page.getByRole('button', { name: 'Change password' }).click();
  await A.page.getByText('Master password changed').waitFor();
  await syncNow(A.page);
  await unlock(B.page, 'changed on laptop A 5');
  assert.deepEqual([...A.problems, ...B.problems], []);
  await A.ctx.close(); await B.ctx.close();
});

test('new device: a stale newer-named save does not block the real one', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'vaulment-sync-'));
  const A = await laptop(dir);
  await newVault(A.page, b.url); await skipQuickStart(A.page);
  await addItem(A.page, 'note', 'Reachable note');
  await chooseFolder(A.page);
  await chip(A.page).filter({ hasText: 'Saved' }).waitFor();
  const [real] = (await readdir(dir)).filter((n) => n.endsWith('.gz'));
  await writeFile(join(dir, real.replace(/-\d{17}-/, '-20991231235959000-')), await readFile(join(dir, real)));
  const stale = await laptop(dir);
  await newVault(stale.page, b.url, 'a different made-up vault 8'); await skipQuickStart(stale.page);
  await goto(stale.page, '#/sync'); await stale.page.getByRole('button', { name: 'Choose folder' }).click();
  await chip(stale.page).filter({ hasText: 'Sync problem' }).waitFor();
  const n = (await readdir(dir)).filter((x) => x.endsWith('.gz') && !x.startsWith(real.slice(0, 22)))[0];
  await writeFile(join(dir, n.replace(/-\d{17}-/, '-21001231235959000-')), await readFile(join(dir, n)));
  const C = await laptop(dir);
  await C.page.goto(b.url);
  await C.page.getByRole('button', { name: 'Bring my vault to this device' }).click();
  await C.page.getByRole('button', { name: 'Choose sync folder' }).click();
  await C.page.locator('#restore-pw').fill(MASTER);
  await C.page.getByRole('button', { name: 'Open my vault' }).click();
  await C.page.locator('#sync-chip').waitFor();
  await goto(C.page, '#/vault'); await C.page.getByRole('link', { name: 'Reachable note' }).waitFor();
  await A.ctx.close(); await stale.ctx.close(); await C.ctx.close();
});

test('phone with no folder: a password changed elsewhere is accepted from a backup at the unlock screen', async () => {
  const ctx = await b.browser.newContext({ acceptDownloads: true });
  await ctx.addInitScript(() => { delete window.showDirectoryPicker; delete Window.prototype.showDirectoryPicker; });
  const page = await ctx.newPage(); const problems = watch(page);
  await newVault(page, b.url); await skipQuickStart(page);
  await addItem(page, 'note', 'Phone copy');
  await goto(page, '#/transfer');
  let dl = page.waitForEvent('download'); await page.locator('#backup-go').click();
  const first = await (await dl).path();
  // Laptop stand-in: same vault in a second context, password changed, new backup made.
  const ctx2 = await b.browser.newContext({ acceptDownloads: true }); const lap = await ctx2.newPage();
  await lap.goto(b.url);
  await lap.getByRole('button', { name: 'Bring my vault to this device' }).click();
  let c = lap.waitForEvent('filechooser'); await lap.getByRole('button', { name: 'Open a backup' }).click(); await (await c).setFiles(first);
  await lap.locator('#restore-pw').fill(MASTER); await lap.getByRole('button', { name: 'Open my vault' }).click();
  await lap.locator('#sync-chip').waitFor();
  await goto(lap, '#/settings');
  await lap.locator('#cp-old').fill(MASTER); await lap.locator('#cp-new').fill('changed on the laptop 6'); await lap.locator('#cp-new2').fill('changed on the laptop 6');
  await lap.getByRole('button', { name: 'Change password' }).click();
  await lap.getByText('Master password changed').waitFor();
  await goto(lap, '#/transfer');
  dl = lap.waitForEvent('download'); await lap.locator('#backup-go').click();
  const second = await (await dl).path();
  await page.getByRole('button', { name: 'Lock vault' }).click();
  await page.locator('input[type=password]').fill('changed on the laptop 6');
  c = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Password changed on another device/ }).click();
  await (await c).setFiles(second);
  await page.locator('#sync-chip').waitFor();
  assert.deepEqual(problems, []);
  await ctx.close(); await ctx2.close();
});

test('sync state chip: Changes waiting, then Saved about 3 seconds after an edit', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'vaulment-sync-'));
  const A = await laptop(dir);
  await newVault(A.page, b.url); await skipQuickStart(A.page);
  await chooseFolder(A.page);
  await chip(A.page).filter({ hasText: 'Saved' }).waitFor();
  const t0 = Date.now();
  await addItem(A.page, 'note', 'Timed note');
  await chip(A.page).filter({ hasText: 'Changes waiting' }).waitFor();
  await chip(A.page).filter({ hasText: 'Saved' }).waitFor({ timeout: 6000 });
  const ms = Date.now() - t0;
  assert.ok(ms >= 2500 && ms < 6000, `took ${ms} ms`);
  await A.ctx.close();
});

test('page hidden: a pending change is written at once', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'vaulment-sync-'));
  const A = await laptop(dir);
  await newVault(A.page, b.url); await skipQuickStart(A.page);
  await chooseFolder(A.page);
  await addItem(A.page, 'note', 'Hide flush');
  await A.page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); delete document.visibilityState; });
  await chip(A.page).filter({ hasText: 'Saved' }).waitFor({ timeout: 1500 });
  await A.ctx.close();
});

test('a half-delivered save file is skipped and shown as waiting, not as a failure', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'vaulment-sync-'));
  const A = await laptop(dir);
  await newVault(A.page, b.url); await skipQuickStart(A.page);
  await chooseFolder(A.page);
  await writeFile(join(dir, 'vaulment-save-aaaaaaaa-laptopzz-20260101000000000-sess00.json.gz'), 'partial');
  await syncNow(A.page);
  await goto(A.page, '#/settings'); await goto(A.page, '#/sync');
  await A.page.getByText('cannot be read yet').waitFor();
  await chip(A.page).filter({ hasText: 'Saved' }).waitFor();
  await A.ctx.close();
});

test('folder access needed: permission lost, Allow access restores it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'vaulment-sync-'));
  const A = await laptop(dir);
  await newVault(A.page, b.url); await skipQuickStart(A.page);
  await chooseFolder(A.page);
  await A.page.evaluate(() => { window.__folderPermission = 'prompt'; });
  await addItem(A.page, 'note', 'Blocked note');
  await chip(A.page).filter({ hasText: 'Folder access needed' }).waitFor({ timeout: 6000 });
  await A.page.evaluate(() => { window.__folderPermission = 'granted'; });
  await goto(A.page, '#/sync');
  await A.page.getByRole('button', { name: 'Allow access' }).click();
  await chip(A.page).filter({ hasText: 'Saved' }).waitFor();
  await A.ctx.close();
});

test('sync problem state shows when the folder cannot be written, then recovers', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'vaulment-sync-'));
  const A = await laptop(dir);
  await newVault(A.page, b.url); await skipQuickStart(A.page);
  await chooseFolder(A.page);
  await A.page.evaluate(() => { window.__fsOrig = window.__fs; window.__fs = async (op, ...r) => { if (op === 'write') throw new Error('made-up disk error'); return window.__fsOrig(op, ...r); }; });
  await addItem(A.page, 'note', 'Unwritten note');
  await chip(A.page).filter({ hasText: 'Sync problem' }).waitFor({ timeout: 12000 });
  await goto(A.page, '#/sync');
  await A.page.getByText('safe on this device').waitFor();
  await A.page.evaluate(() => { window.__fs = window.__fsOrig; });
  await A.page.locator('#sync-now').click();
  await chip(A.page).filter({ hasText: 'Saved' }).waitFor({ timeout: 10000 });
  await A.ctx.close();
});

test('real browser folder handle (private file system): writes a save, survives reload, keeps saving', async () => {
  // A normal profile, because Chromium crashes when an off-the-record profile reads such a
  // handle back from IndexedDB (reproduced outside this app; see docs/KNOWN-LIMITS.md).
  const ctx = await chromium.launchPersistentContext(await mkdtemp(join(tmpdir(), 'vaulment-profile-')));
  await ctx.addInitScript(() => { window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('made-up-sync', { create: true }); });
  const page = await ctx.newPage(); const problems = watch(page);
  await newVault(page, b.url); await skipQuickStart(page);
  await chooseFolder(page);
  await addItem(page, 'note', 'Native handle note');
  await goto(page, '#/sync'); await page.locator('#sync-now').click(); await page.getByText('Sync finished.').first().waitFor();
  const list = () => page.evaluate(async () => { const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('made-up-sync'); const n = []; for await (const k of d.keys()) n.push(k); return n; });
  assert.equal((await list()).filter((n) => n.endsWith('.json.gz')).length, 1);
  await page.reload(); await unlock(page);
  await chip(page).filter({ hasText: 'Saved' }).waitFor();
  assert.equal((await list()).filter((n) => n.endsWith('.json.gz')).length, 2, 'each session writes one file');
  assert.deepEqual(problems, []);
  await ctx.close();
});

test('Android fallback: no folder picker means clear guidance, and save files move between devices', async () => {
  const ctx = await b.browser.newContext({ acceptDownloads: true });
  await ctx.addInitScript(() => { delete window.showDirectoryPicker; delete Window.prototype.showDirectoryPicker; });
  const page = await ctx.newPage(); const problems = watch(page);
  await newVault(page, b.url); await skipQuickStart(page);
  await addItem(page, 'note', 'Phone note');
  await goto(page, '#/sync');
  await page.getByText('cannot open a folder directly').waitFor();
  const dl = page.waitForEvent('download');
  await page.locator('#send-save').click();
  const d = await dl;
  await page.getByText('Backup downloaded.').waitFor();
  await addItem(page, 'note', 'Second phone note');
  await goto(page, '#/sync');
  const c = page.waitForEvent('filechooser');
  await page.locator('#open-save').click();
  await (await c).setFiles(await d.path());
  await page.getByText(/Merged 0 change/).waitFor();
  assert.deepEqual(problems, []);
  await ctx.close();
});
