import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { boot, watch, newVault, skipQuickStart, unlock, addItem, goto, MASTER } from './_harness.mjs';

let b; let ctx; let page; let problems;
before(async () => {
  b = await boot(4203);
  ctx = await b.browser.newContext({ acceptDownloads: true }); page = await ctx.newPage(); problems = watch(page);
  await newVault(page, b.url); await skipQuickStart(page);
});
after(() => b.close());

const SHEET = [
  'Family records export, made up', 'Printed on 05/11/2026', '',
  'Title,Category,Type,Bank,Account number,Password,Date,Expiry,Amount,Notes',
  'Sample savings,Banking,Bank account,Sample Bank,0012345678901,,01/04/2026,,1000.50,first',
  'Sample policy,Office,Insurance policy,,PL77,,01/04/2026,02/12/2026,500000,second',
  'Sample washer,Warranty,Warranty,,6.27E+11,,28/10/2026,28/10/2028,45999.50,third',
  'Sample savings,Banking,Bank account,Sample Bank,0012345678901,,,,,repeat row',
  'Broken row,Banking,Bank account,,,,31/02/2026,,,bad date',
  ',Banking,,,,,,,,no title',
].join('\n');

test('preview: preamble skipped, a status per row, and nothing is saved until Import', async () => {
  await goto(page, '#/transfer');
  await page.getByLabel('Or paste CSV text').fill(SHEET);
  await page.getByRole('button', { name: 'Show preview' }).click();
  const s = await page.locator('#import-summary').textContent();
  assert.match(s, /Header found on line 4/);
  assert.match(s, /2 ready, 1 to check, 1 duplicate, 2 with errors/);
  await goto(page, '#/vault');
  await page.getByText('Your vault is empty').waitFor();
});

test('Import saves exactly the ready and to-check rows', async () => {
  await goto(page, '#/transfer');
  await page.getByLabel('Or paste CSV text').fill(SHEET);
  await page.getByRole('button', { name: 'Show preview' }).click();
  await page.locator('#import-go').click();
  await page.getByText('Imported 3 item(s).').waitFor();
  await goto(page, '#/vault');
  await page.getByText('3 items').waitFor();
  assert.deepEqual(problems, []);
});

test('Import button is disabled when no row can be imported; bad text explains itself', async () => {
  await goto(page, '#/transfer');
  await page.getByRole('button', { name: 'Show preview' }).click();
  await page.getByText('Paste some CSV text first').waitFor();
  await page.getByLabel('Or paste CSV text').fill('nothing useful here');
  await page.getByRole('button', { name: 'Show preview' }).click();
  await page.getByText('No header row found').waitFor();
  await page.getByLabel('Or paste CSV text').fill(SHEET);
  await page.getByRole('button', { name: 'Show preview' }).click();
  assert.equal(await page.locator('#import-go').isDisabled(), true);
});

test('import from a file works; a non-UTF-8 file is refused in plain words', async () => {
  const p = join(tmpdir(), 'made-up-latin1.csv'); await writeFile(p, Buffer.from([0x54, 0x69, 0x74, 0x6c, 0x65, 0x2c, 0x4e, 0x6f, 0x74, 0x65, 0x0a, 0xe9, 0x2c, 0xe9]));
  const c = page.waitForEvent('filechooser');
  await page.locator('#import-file').click();
  await (await c).setFiles(p);
  await page.getByText('not UTF-8 text').waitFor();
});

// Hand total of the three imported rows: 1,000.50 + 5,00,000.00 + 45,999.50 = 5,47,000.00
test('dashboard figures match numbers worked out by hand', async () => {
  await goto(page, '#/dashboard');
  const stat = async (id) => page.locator(`#${id} .stat-value`).textContent();
  assert.equal(await stat('st-items'), '3');
  assert.equal(await stat('st-cats'), '3');
  assert.equal(await stat('st-files'), '0');
  // Run at any date, the expected value is computed separately from the fixed expiry dates.
  const now = await page.evaluate(() => Date.now());
  const today = new Date(now + 19800000).toISOString().slice(0, 10);
  const dayN = (s) => Date.parse(`${s}T00:00:00Z`) / 86400000;
  const within = ['2026-12-02', '2028-10-28'].filter((d) => dayN(d) - dayN(today) <= 90).length;
  assert.equal(await stat('st-due'), String(within));
  assert.equal(await stat('st-total'), '₹5,47,000.00');
  assert.equal(await page.locator('#amount-table tbody tr').count(), 3);
  const text = await page.locator('#amount-table').innerText();
  assert.match(text, /₹1,000\.50/); assert.match(text, /₹5,00,000\.00/); assert.match(text, /₹45,999\.50/);
});

test('month and financial-year tables equal a separate count of the same three rows', async () => {
  const cards = page.locator('.chart-card');
  const nowMs = await page.evaluate(() => Date.now());
  const y = new Date(nowMs + 19800000);
  const label = `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][y.getUTCMonth()]} ${y.getUTCFullYear()}`;
  await cards.nth(1).getByRole('button', { name: 'Table' }).click();
  const months = (await cards.nth(1).locator('tbody').innerText()).replace(/\s+/g, ' ');
  assert.ok(months.includes(`${label} 3`), `all three were added this month: ${months}`);
  // All three document dates (01/04/2026, 01/04/2026, 28/10/2026) fall in FY 2026-27.
  await cards.nth(2).getByRole('button', { name: 'Table' }).click();
  assert.equal((await cards.nth(2).locator('tbody').innerText()).replace(/\s+/g, ' ').trim(), 'FY 2026-27 3');
  await cards.nth(3).getByRole('button', { name: 'Table' }).click();
  const due = (await cards.nth(3).locator('tbody').innerText()).replace(/\s+/g, ' ');
  assert.equal([...due.matchAll(/(\d+)(?= |$)/g)].length >= 5, true);
  for (const i of [1, 2, 3]) await cards.nth(i).getByRole('button', { name: 'Chart' }).click();
});

test('every chart has a Chart and Table toggle, and the table shows the same numbers', async () => {
  const cards = page.locator('.chart-card');
  assert.equal(await cards.count(), 4);
  for (let i = 0; i < 4; i++) {
    const card = cards.nth(i);
    await card.getByRole('button', { name: 'Table' }).click();
    assert.equal(await card.locator('table').isVisible(), true);
    assert.equal(await card.getByRole('button', { name: 'Table' }).getAttribute('aria-pressed'), 'true');
    await card.getByRole('button', { name: 'Chart' }).click();
    assert.equal(await card.locator('table').isVisible(), false);
  }
  const first = cards.nth(0);
  await first.getByRole('button', { name: 'Table' }).click();
  const rows = (await first.locator('tbody').innerText()).replace(/\s+/g, ' ');
  for (const label of ['Banking 1', 'Office 1', 'Warranty 1']) assert.ok(rows.includes(label), rows);
  // Colour follows the category, not rank: Banking is slot 1 whatever else is shown.
  await first.getByRole('button', { name: 'Chart' }).click();
  const banking = first.locator('.bar-row', { hasText: 'Banking' }).locator('.bar-fill');
  assert.equal(await banking.evaluate((n) => n.style.background), 'var(--c1)');
});

test('chart hover shows a tooltip with the value', async () => {
  await page.locator('.chart-card').first().locator('.bar-fill').first().hover();
  assert.match(await page.locator('.chart-tip').textContent(), /: 1$/);
});

test('reminders groups by date and links to items', async () => {
  await goto(page, '#/reminders');
  await page.getByRole('link', { name: 'Sample policy' }).waitFor();
  await page.getByRole('link', { name: 'Sample washer' }).waitFor();
});

test('password health: finds weak and reused made-up passwords, all clear after a fix', async () => {
  await addItem(page, 'login', 'Sample one', { Password: 'password123' });
  await addItem(page, 'login', 'Sample two', { Password: 'password123' });
  await goto(page, '#/health');
  await page.getByRole('heading', { name: 'Weak (2)' }).waitFor();
  await page.getByRole('heading', { name: 'Reused (2)' }).waitFor();
  await goto(page, '#/dashboard');
  assert.equal(await page.locator('#st-weak .stat-value').textContent(), '2');
});

test('search box, category, show and sort controls drive the list and the address', async () => {
  await goto(page, '#/vault');
  await page.locator('#vault-q').fill('sample savings');
  await page.getByText('1 item', { exact: true }).waitFor();
  assert.ok(!page.url().includes('savings'), 'search words stay out of the address and history');
  await page.locator('#vault-q').fill('');
  await page.locator('#f-cat').selectOption('warranty');
  await page.getByText('1 item', { exact: true }).waitFor();
  await page.locator('#f-cat').selectOption('');
  await page.locator('#f-sort').selectOption('title');
  const titles = await page.locator('.row-link').allTextContents();
  assert.deepEqual(titles, [...titles].sort((a, b) => a.localeCompare(b)));
  await page.locator('#vault-q').fill('zzzz');
  await page.getByText('Nothing matches').waitFor();
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await page.getByText('5 items').waitFor();
  await goto(page, '#/vault?sort=evil');
  await page.getByText('does not recognise').waitFor();
});

test('long list pages at 100 rows with Show more', async () => {
  const rows = ['Title,Number'];
  for (let i = 0; i < 230; i++) rows.push(`Bulk item ${i},B${i}`);
  await goto(page, '#/transfer');
  await page.getByLabel('Or paste CSV text').fill(rows.join('\n'));
  await page.getByRole('button', { name: 'Show preview' }).click();
  await page.locator('#import-go').click();
  await page.getByText('Imported 230 item(s).').waitFor();
  await goto(page, '#/vault?q=bulk');
  await page.getByText('230 items').waitFor();
  assert.equal(await page.locator('#results tbody tr').count(), 100);
  await page.getByRole('button', { name: /Show more \(130 left\)/ }).click();
  assert.equal(await page.locator('#results tbody tr').count(), 200);
  await page.getByRole('button', { name: /Show more \(30 left\)/ }).click();
  assert.equal(await page.locator('#results tbody tr').count(), 230);
});

test('round trip: CSV export into an empty copy; counts and totals match', async () => {
  await goto(page, '#/dashboard');
  const items = await page.locator('#st-items .stat-value').textContent();
  const total = await page.locator('#st-total .stat-value').textContent();
  await goto(page, '#/transfer');
  await page.locator('#csv-go').click();
  await page.locator('#dlg-pw').fill(MASTER);
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).last().click();
  const d = await dl;
  assert.match(d.suggestedFilename(), /^vaulment-export-\d{8}\.csv$/);
  const bytes = await readFile(await d.path());
  assert.deepEqual([...bytes.subarray(0, 3)], [0xEF, 0xBB, 0xBF]);
  const text = bytes.toString('utf8');
  assert.ok(text.includes('"=""0012345678901"""'), 'long number protected, as a formula inside CSV quotes');
  assert.ok(text.includes('6.27E+11'), 'shortened number stays visible as text');

  const ctx2 = await b.browser.newContext(); const p2 = await ctx2.newPage();
  await newVault(p2, b.url); await skipQuickStart(p2);
  await goto(p2, '#/transfer');
  const c = p2.waitForEvent('filechooser');
  await p2.locator('#import-file').click();
  await (await c).setFiles(await d.path());
  await p2.locator('#import-go').click();
  await p2.getByText(/Imported \d+ item\(s\)/).waitFor();
  await goto(p2, '#/dashboard');
  assert.equal(await p2.locator('#st-items .stat-value').textContent(), items);
  assert.equal(await p2.locator('#st-total .stat-value').textContent(), total);
  await ctx2.close();
});

test('round trip: encrypted backup into a new device; same counts, total, and password needed', async () => {
  await addItem(page, 'note', 'Note with a file');
  const f = join(tmpdir(), 'made-up-a.txt'); await writeFile(f, 'made-up attachment');
  const c = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Add files' }).click();
  await (await c).setFiles(f);
  await page.getByText('made-up-a.txt').waitFor();
  await goto(page, '#/dashboard');
  const items = await page.locator('#st-items .stat-value').textContent();
  const total = await page.locator('#st-total .stat-value').textContent();
  await goto(page, '#/transfer');
  const dl = page.waitForEvent('download');
  await page.locator('#backup-go').click();
  const d = await dl;
  assert.match(d.suggestedFilename(), /^vaulment-backup-\d{8}\.json\.gz$/);
  const raw = (await readFile(await d.path()));
  const { gunzipSync } = await import('node:zlib');
  const plain = gunzipSync(raw).toString();
  for (const canary of ['Sample savings', 'made-up attachment', 'password123']) assert.ok(!plain.includes(canary), canary);

  const ctx2 = await b.browser.newContext(); const p2 = await ctx2.newPage(); const pr2 = watch(p2);
  await p2.goto(b.url);
  await p2.getByRole('button', { name: 'Bring my vault to this device' }).click();
  const c2 = p2.waitForEvent('filechooser');
  await p2.getByRole('button', { name: 'Open a backup' }).click();
  await (await c2).setFiles(await d.path());
  await p2.locator('#restore-pw').fill('wrong password');
  await p2.getByRole('button', { name: 'Open my vault' }).click();
  await p2.getByText('does not open this file').waitFor();
  await p2.locator('#restore-pw').fill(MASTER);
  await p2.getByRole('button', { name: 'Open my vault' }).click();
  await p2.locator('#sync-chip').waitFor();
  await goto(p2, '#/dashboard');
  await p2.locator('#st-items').waitFor();
  assert.equal(await p2.locator('#st-items .stat-value').textContent(), items);
  assert.equal(await p2.locator('#st-total .stat-value').textContent(), total);
  assert.equal(await p2.locator('#st-files .stat-value').textContent(), '1');
  await goto(p2, '#/vault?q=Note%20with');
  await p2.getByRole('link', { name: 'Note with a file' }).click();
  const dl2 = p2.waitForEvent('download');
  await p2.getByRole('button', { name: 'Download made-up-a.txt' }).click();
  assert.equal((await readFile(await (await dl2).path())).toString(), 'made-up attachment');
  await p2.reload(); await unlock(p2);
  assert.deepEqual(pr2, []);
  await ctx2.close();
});

test('new device with a forgotten password: backup plus recovery key opens it', async () => {
  const ctx3 = await b.browser.newContext({ acceptDownloads: true }); const p3 = await ctx3.newPage(); const pr3 = watch(p3);
  const code = await newVault(p3, b.url); await skipQuickStart(p3);
  await addItem(p3, 'note', 'Saved by the recovery key');
  await goto(p3, '#/transfer');
  const dl = p3.waitForEvent('download');
  await p3.locator('#backup-go').click();
  const file = await (await dl).path();
  const ctx4 = await b.browser.newContext(); const p4 = await ctx4.newPage(); const pr4 = watch(p4);
  await p4.goto(b.url);
  await p4.getByRole('button', { name: 'Bring my vault to this device' }).click();
  const c = p4.waitForEvent('filechooser');
  await p4.getByRole('button', { name: 'Open a backup' }).click();
  await (await c).setFiles(file);
  await p4.getByRole('button', { name: /Forgot the password/ }).click();
  await p4.locator('#restore-rk').fill(code);
  await p4.locator('#restore-new').fill('another made-up phrase 3'); await p4.locator('#restore-new2').fill('another made-up phrase 3');
  await p4.getByRole('button', { name: 'Open my vault' }).click();
  await p4.locator('#sync-chip').waitFor();
  await goto(p4, '#/vault'); await p4.getByRole('link', { name: 'Saved by the recovery key' }).waitFor();
  await p4.reload(); await unlock(p4, 'another made-up phrase 3');
  assert.deepEqual([...pr3, ...pr4], []);
  await ctx3.close(); await ctx4.close();
});

test('bring back old items from a backup, through the page', async () => {
  const ctx3 = await b.browser.newContext({ acceptDownloads: true }); const p3 = await ctx3.newPage();
  await newVault(p3, b.url); await skipQuickStart(p3);
  await addItem(p3, 'note', 'Note to lose');
  await goto(p3, '#/transfer');
  const dl = p3.waitForEvent('download');
  await p3.locator('#backup-go').click();
  const file = await (await dl).path();
  await goto(p3, '#/vault'); await p3.getByRole('link', { name: 'Note to lose' }).click();
  await p3.getByRole('button', { name: 'Move to trash' }).click();
  await p3.locator('dialog').getByRole('button', { name: 'Move to trash' }).click();
  await p3.waitForFunction(() => location.hash === '#/vault');
  await goto(p3, '#/vault?view=trash');
  await p3.getByRole('button', { name: 'Delete forever' }).click();
  await p3.locator('dialog').getByRole('button', { name: 'Delete forever' }).click();
  await p3.getByText('The trash is empty').waitFor();
  await goto(p3, '#/transfer');
  const c = p3.waitForEvent('filechooser');
  await p3.locator('#copies-go').click();
  await (await c).setFiles(file);
  await p3.getByText('Brought back 1 item(s)').waitFor();
  await goto(p3, '#/vault'); await p3.getByRole('link', { name: 'Note to lose (restored)' }).waitFor();
  await ctx3.close();
});

test('restore page refuses a file that is not a backup', async () => {
  await goto(page, '#/transfer');
  const f = join(tmpdir(), 'made-up-not-backup.gz'); await writeFile(f, 'not gzip');
  const c = page.waitForEvent('filechooser');
  await page.locator('#restore-go').click();
  await (await c).setFiles(f);
  await page.getByText('Could not merge that file').waitFor();
});
