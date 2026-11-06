import { chromium } from 'playwright';
import { serve } from '../../scripts/serve.mjs';

export const MASTER = 'made-up test passphrase 42';

export async function boot(port) {
  const { server, state, url } = await serve(port);
  const browser = await chromium.launch();
  return { server, state, url, browser, close: async () => { await browser.close(); server.close(); server.closeAllConnections(); } };
}

/** Fail a test on any console error or CSP violation: those are real defects here. */
export function watch(page) {
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
  return problems;
}

export async function newVault(page, url, password = MASTER) {
  await page.goto(url);
  await page.getByRole('heading', { name: 'Create your vault' }).waitFor();
  await page.locator('input[type=password]').first().fill(password);
  await page.getByRole('textbox', { name: 'Type it again' }).fill(password);
  await page.getByRole('button', { name: 'Create my vault' }).click();
  await page.getByRole('heading', { name: 'Save your recovery key' }).waitFor();
  const code = await page.locator('#recovery-code').textContent();
  await page.getByLabel('I have saved my recovery key').check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('heading', { name: 'Your vault' }).waitFor();
  return code;
}

export async function skipQuickStart(page) {
  await page.getByRole('button', { name: 'Skip' }).click();
}

export async function unlock(page, password = MASTER) {
  await page.locator('input[type=password]').first().fill(password);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await page.locator('#sync-chip').waitFor();
}

/** Add an item through the real form. `fields` maps visible labels to values. */
export async function addItem(page, template, title, fields = {}) {
  await page.evaluate((t) => { location.hash = `#/new/${t}`; }, template);
  await page.getByLabel('Title').waitFor();
  await page.getByLabel('Title').fill(title);
  for (const [label, value] of Object.entries(fields)) {
    const el = page.getByLabel(label, { exact: true });
    if (await el.evaluate((n) => n.tagName === 'SELECT')) await el.selectOption(value);
    else await el.fill(value);
  }
  await page.getByRole('button', { name: 'Save item' }).click();
  await page.getByRole('heading', { name: title, exact: true }).waitFor();
}

/** Stand-in for the OneDrive folder picker, backed by a real temp directory in Node, so two
 *  browser contexts share one folder exactly as two laptops would. */
export async function shareFolder(context, dir) {
  const { mkdir, readFile, readdir, rm, stat, writeFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  await context.exposeFunction('__fs', async (op, rel, a) => {
    const p = join(dir, rel);
    if (op === 'mkdir') { await mkdir(p, { recursive: true }); return true; }
    if (op === 'list') return (await readdir(p, { withFileTypes: true })).map((e) => [e.name, e.isDirectory() ? 'directory' : 'file']);
    if (op === 'exists') return stat(p).then(() => true, () => false);
    if (op === 'read') { const s = await stat(p); return { b64: (await readFile(p)).toString('base64'), m: s.mtimeMs, size: s.size }; }
    if (op === 'write') { await writeFile(p, Buffer.from(a, 'base64')); return true; }
    if (op === 'rm') { await rm(p, { force: true }); return true; }
    throw new Error(op);
  });
  await context.addInitScript(() => {
    const b64 = (u8) => btoa(Array.from(u8, (c) => String.fromCharCode(c)).join(''));
    class Dir {
      constructor(path) { this.path = path; this.kind = 'directory'; this.name = path.split('/').pop() || 'Test folder'; }
      async queryPermission() { return window.__folderPermission ?? 'granted'; }
      async requestPermission() { return 'granted'; }
      async getDirectoryHandle(n, o = {}) {
        const p = `${this.path}/${n}`;
        if (o.create) await window.__fs('mkdir', p); else if (!(await window.__fs('exists', p))) throw new DOMException('x', 'NotFoundError');
        return new Dir(p);
      }
      async getFileHandle(n, o = {}) {
        const p = `${this.path}/${n}`;
        if (!o.create && !(await window.__fs('exists', p))) throw new DOMException('x', 'NotFoundError');
        return {
          kind: 'file', name: n,
          async getFile() { const r = await window.__fs('read', p); const bytes = Uint8Array.from(atob(r.b64), (c) => c.charCodeAt(0)); return { lastModified: r.m, size: r.size, arrayBuffer: async () => bytes.buffer }; },
          async createWritable() { let d; return { async write(b) { d = b; }, async close() { await window.__fs('write', p, b64(d)); } }; },
        };
      }
      async removeEntry(n) { await window.__fs('rm', `${this.path}/${n}`); }
      async *keys() { for (const [n] of await window.__fs('list', this.path)) yield n; }
      async *entries() { for (const [n, kind] of await window.__fs('list', this.path)) yield [n, { kind, name: n }]; }
    }
    window.showDirectoryPicker = async () => new Dir('.');
  });
}

export const goto = (page, hash) => page.evaluate((h) => { location.hash = h; }, hash);
