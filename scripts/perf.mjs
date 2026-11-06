// Measures the slow actions in a real browser, at 5,000 items and 500 files, before and
// after each optimisation. "Before" means the same code with the optimisation switched off.
import { chromium } from 'playwright';
import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
import { serve } from './serve.mjs';

const ITEMS = 5000;
const code = (await build({ entryPoints: ['tests/perf-entry.js'], bundle: true, format: 'iife', write: false, minify: true })).outputFiles[0].text;
const { server, url } = await serve(4301);
const browser = await chromium.launch();

async function run(cpuSlowdown) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.route(`${url}bench`, (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>bench</title><body></body>' }));
  await page.goto(`${url}bench`);
  await page.addScriptTag({ content: code });
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuSlowdown });
  const r = await page.evaluate((n) => window.bench(n), ITEMS);
  await ctx.close();
  return r;
}

async function firstLoad() {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 700 }, isMobile: true });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  // Slow 4G: 1.6 Mbps down = 200,000 bytes/s, 150 ms latency; CPU 4× slower.
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 200_000, uploadThroughput: 93_750 });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const t = Date.now();
  await page.goto(url, { waitUntil: 'commit' });
  await page.getByRole('heading', { name: 'Create your vault' }).waitFor();
  const ms = Date.now() - t;
  await ctx.close();
  return ms;
}

const plain = await run(1);
const slow = await run(4);
const loads = [await firstLoad(), await firstLoad(), await firstLoad()];
await browser.close(); server.close(); server.closeAllConnections();

const LABELS = [
  ['unlockFull', 'Unlock, full (key stretching and decrypt)'],
  ['unlockDecryptBefore', 'Decrypt on unlock, BEFORE (one at a time)'], ['unlockDecryptAfter', 'Decrypt on unlock, AFTER (batches of 200)'],
  ['listDrawBefore', 'Draw vault list, BEFORE (all rows)'], ['listDrawAfter', 'Draw vault list, AFTER (first 100, Show more)'],
  ['blobCheckBefore', 'Check 500 files held, BEFORE (one read each)'], ['blobCheckAfter', 'Check 500 files held, AFTER (one key listing)'],
  ['fileLookupBefore', 'Find files of 2,000 items, BEFORE (scan)'], ['fileLookupAfter', 'Find files of 2,000 items, AFTER (index)'],
  ['searchKeystroke', 'Search, one keystroke'], ['sortAll', 'Sort all by title'], ['dashboard', 'Compute dashboard'], ['writeSave', 'Write one save file'], ['readSave', 'Read one save file'], ['mergeAllChanged', 'Merge with every record changed'],
];
const lines = ['| Action, 5,000 items and 500 files | This container (ms) | CPU 4× slower (ms) |', '|---|---:|---:|'];
for (const [k, label] of LABELS) lines.push(`| ${label} | ${plain[k]} | ${slow[k]} |`);
lines.push(`| Save file size | ${plain.saveFileKB} KB | ${slow.saveFileKB} KB |`);
const table = lines.join('\n');
console.log(table);
console.log(`First load, slow 4G and CPU 4× slower, three runs: ${loads.join(', ')} ms`);
await writeFile('docs/perf-last.json', JSON.stringify({ plain, slow, loads }, null, 2));
await writeFile('docs/perf-last.md', `${table}\n\nFirst load to visible heading on simulated slow 4G with CPU 4× slower, three runs: ${loads.join(', ')} ms.\n`);
