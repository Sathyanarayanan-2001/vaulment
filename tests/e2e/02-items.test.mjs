import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { boot, watch, newVault, skipQuickStart, addItem, goto } from './_harness.mjs';

let b; let ctx; let page; let problems;
before(async () => {
  b = await boot(4202);
  ctx = await b.browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'], acceptDownloads: true });
  page = await ctx.newPage(); problems = watch(page);
  await newVault(page, b.url); await skipQuickStart(page);
});
after(() => b.close());
const noErrors = () => assert.deepEqual(problems, []);

test('Home to a blank form takes two taps: Add item, then a type', async () => {
  await goto(page, '#/home');
  await page.getByRole('main').getByRole('link', { name: 'Add item' }).first().click();
  await page.getByRole('link', { name: 'Bank account' }).click();
  await page.getByRole('heading', { name: 'New bank account' }).waitFor();
});

test('Home search shows results as you type, with a copy button; no match says so', async () => {
  await addItem(page, 'login', 'Made-up home search', { Password: 'Made-up-Search-1!' });
  await goto(page, '#/home');
  await page.locator('#home-q').fill('home sea');
  await page.locator('#home-hits').getByRole('link', { name: 'Made-up home search' }).waitFor();
  await page.locator('#home-hits').getByRole('button', { name: 'Copy password for Made-up home search' }).waitFor();
  await page.locator('#home-q').fill('zzzz');
  await page.getByText('Nothing matches.').waitFor();
  await page.locator('#home-q').fill('home sea');
  await page.locator('#home-q').press('Enter');
  await page.getByRole('heading', { name: 'Vault', exact: true }).waitFor();
  assert.equal(await page.locator('#vault-q').inputValue(), 'home sea');
  await page.locator('#vault-q').fill('');
  await page.getByRole('link', { name: 'Made-up home search' }).click();
  await page.getByRole('button', { name: 'Move to trash' }).click();
  await page.locator('dialog').getByRole('button', { name: 'Move to trash' }).click();
  await page.waitForFunction(() => location.hash === '#/vault');
  await goto(page, '#/vault?view=trash');
  await page.getByRole('button', { name: 'Delete forever' }).click();
  await page.locator('dialog').getByRole('button', { name: 'Delete forever' }).click();
  await page.getByText('The trash is empty').waitFor();
});

test('every item type opens, saves with a title, and shows in the vault', async () => {
  const types = ['bank_account', 'card', 'gov_record', 'investment', 'office_doc', 'insurance', 'login', 'medical', 'warranty', 'education', 'resume', 'document', 'note'];
  for (const t of types) await addItem(page, t, `Made-up ${t}`);
  await goto(page, '#/vault');
  await page.getByText('13 items').waitFor();
  noErrors();
});

test('bad input is refused field by field, in plain words, and nothing is saved', async () => {
  await goto(page, '#/new/warranty');
  await page.getByLabel('Purchase date').fill('31/04/2026');
  await page.getByLabel('Warranty ends').fill('banana');
  await page.getByLabel('Purchase price (₹)').fill('12.345');
  await page.getByRole('button', { name: 'Save item' }).click();
  await page.getByText('Add a title so you can find this item later.').waitFor();
  await page.getByText('31/04/2026 is not a real date').waitFor();
  await page.getByText('Could not read "banana"').waitFor();
  await page.getByText('at most two digits').waitFor();
  assert.equal(await page.evaluate(() => document.activeElement.id), 'f-title');
  await page.getByText('Fix the marked field').waitFor();
});

test('web address: bare name gets https, javascript: is refused', async () => {
  await goto(page, '#/new/login');
  await page.getByLabel('Title').fill('Made-up URL test');
  await page.getByLabel('Website', { exact: true }).fill('javascript:alert(1)');
  await page.getByRole('button', { name: 'Save item' }).click();
  await page.getByText('Use a web address').waitFor();
  await page.getByLabel('Website', { exact: true }).fill('example.test/login');
  await page.getByRole('button', { name: 'Save item' }).click();
  const link = page.getByRole('link', { name: /example\.test/ });
  assert.equal(await link.getAttribute('href'), 'https://example.test/login');
  assert.equal(await link.getAttribute('rel'), 'noreferrer noopener');
});

test('date, derived period and money display: 28/10 → CW44, FY 2026-27; 1234567.5 → ₹12,34,567.50', async () => {
  await addItem(page, 'insurance', 'Made-up cover', { 'Start date': '28/10/2026', 'Renewal date': '27/10/2027', 'Sum insured (₹)': '1234567.5' });
  await page.getByText('28/10/2026 (Oct 2026, CW44, FY 2026-27)').waitFor();
  await page.getByText('₹12,34,567.50').waitFor();
  await page.getByRole('link', { name: 'Edit' }).click();
  assert.equal(await page.getByLabel('Sum insured (₹)').inputValue(), '12,34,567.50');
  await page.getByLabel('Start date').fill('2810');
  await page.getByLabel('Renewal date').focus();
  assert.equal(await page.getByLabel('Start date').inputValue(), '28/10/2026');
  await page.getByText('Oct 2026, CW44, FY 2026-27').waitFor();
});

test('long reference numbers stay exact text; leading zeros stay', async () => {
  await addItem(page, 'bank_account', 'Made-up savings', { 'Account number': '00012345678901234567', 'Mobile PIN': '0042' });
  await page.getByText('00012345678901234567').waitFor();
});

test('secrets: hidden by default, Show reveals, Hide masks, Copy fills the clipboard', async () => {
  await addItem(page, 'login', 'Made-up mail', { 'User name or email': 'sample@example.test', Password: 'Made-up-Secret-99!' });
  assert.ok(!(await page.locator('main').innerText()).includes('Made-up-Secret-99!'));
  await page.getByRole('button', { name: 'Show Password' }).click();
  await page.getByText('Made-up-Secret-99!').waitFor();
  await page.getByRole('button', { name: 'Hide Password' }).click();
  assert.ok(!(await page.locator('main').innerText()).includes('Made-up-Secret-99!'));
  await page.getByRole('button', { name: 'Copy Password' }).click();
  await page.getByText('clipboard clears in 30 seconds').first().waitFor();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'Made-up-Secret-99!');
});

test('password generator fills a strong password', async () => {
  await goto(page, '#/new/login');
  await page.getByRole('button', { name: 'Generate Password' }).click();
  const v = await page.locator('#f-pass').inputValue();
  assert.equal(v.length, 20);
  await page.getByText('Strength: strong').waitFor();
});

test('markup in a title, note or tag shows as text and never runs', async () => {
  const evil = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=1</script>';
  await addItem(page, 'note', evil, { });
  await page.getByRole('link', { name: 'Edit' }).click();
  await page.getByLabel('Notes').fill(evil); await page.getByLabel('Tags').fill('<b>tag</b>');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await page.getByRole('link', { name: 'Edit' }).waitFor();
  assert.equal(await page.evaluate(() => window.__pwned), undefined);
  assert.equal(await page.locator('main img, main script, main b').count(), 0);
  await goto(page, '#/vault');
  await page.getByRole('link', { name: /<img/ }).first().waitFor();
  assert.equal(await page.evaluate(() => window.__pwned), undefined);
  noErrors();
});

test('favourite: shows on Home with one-tap copy; removing it takes it off', async () => {
  await goto(page, '#/vault?q=Made-up%20mail');
  await page.getByRole('link', { name: 'Made-up mail' }).click();
  await page.getByRole('button', { name: 'Add favourite' }).click();
  await page.getByRole('button', { name: 'Remove favourite' }).waitFor();
  await goto(page, '#/home');
  await page.getByRole('button', { name: 'Copy password for Made-up mail' }).click();
  await page.getByText('clipboard clears').first().waitFor();
  await page.getByRole('main').getByRole('link', { name: 'Made-up mail' }).click();
  await page.getByRole('button', { name: 'Remove favourite' }).click();
  await page.getByRole('button', { name: 'Add favourite' }).waitFor();
  await goto(page, '#/home');
  await page.getByRole('heading', { name: 'Your vault' }).waitFor();
  assert.equal(await page.getByRole('heading', { name: 'Favourites' }).count(), 0);
});

test('trash: move, restore, delete forever with confirmation', async () => {
  await addItem(page, 'note', 'Made-up trash note');
  await page.getByRole('button', { name: 'Move to trash' }).click();
  await page.locator('dialog').getByRole('button', { name: 'Move to trash' }).click();
  await page.waitForFunction(() => location.hash === '#/vault');
  await goto(page, '#/vault?view=trash');
  await page.getByRole('link', { name: 'Made-up trash note' }).waitFor();
  await page.getByRole('button', { name: 'Restore' }).click();
  await page.getByText('Item restored.').first().waitFor();
  await goto(page, '#/vault?q=trash%20note');
  await page.getByRole('link', { name: 'Made-up trash note' }).click();
  await page.getByRole('button', { name: 'Move to trash' }).click();
  await page.locator('dialog').getByRole('button', { name: 'Move to trash' }).click();
  await page.waitForFunction(() => location.hash === '#/vault');
  await goto(page, '#/vault?view=trash');
  await page.getByRole('button', { name: 'Delete forever' }).click();
  await page.locator('dialog').getByRole('button', { name: 'Cancel' }).click();
  assert.equal(await page.getByRole('link', { name: 'Made-up trash note' }).count(), 1);
  await page.getByRole('button', { name: 'Delete forever' }).click();
  await page.locator('dialog').getByRole('button', { name: 'Delete forever' }).click();
  await page.getByText('The trash is empty').waitFor();
  noErrors();
});

test('files: attach on the form and from the item, preview an image, download exact bytes, remove', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  const pngPath = join(tmpdir(), 'made-up-scan.png'); await writeFile(pngPath, png);
  const pdfPath = join(tmpdir(), 'made-up-bill.pdf'); await writeFile(pdfPath, '%PDF-1.4 made up');
  await goto(page, '#/new/warranty');
  await page.getByLabel('Title').fill('Made-up washer');
  let chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Add files' }).click();
  await (await chooser).setFiles(pngPath);
  await page.getByRole('listitem').filter({ hasText: 'made-up-scan.png' }).waitFor();
  await page.getByRole('button', { name: 'Save item' }).click();
  await page.getByText('made-up-scan.png').waitFor();
  chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Add files' }).click();
  await (await chooser).setFiles(pdfPath);
  await page.getByText('made-up-bill.pdf').waitFor();
  await page.getByRole('button', { name: 'Open made-up-scan.png' }).click();
  await page.getByRole('img', { name: 'Preview of made-up-scan.png' }).waitFor();
  assert.ok(await page.evaluate(() => document.querySelector('.att-preview img').complete));
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download made-up-bill.pdf' }).click();
  const d = await dl; const { readFile } = await import('node:fs/promises');
  assert.equal((await readFile(await d.path())).toString(), '%PDF-1.4 made up');
  assert.equal(d.suggestedFilename(), 'made-up-bill.pdf');
  await page.getByRole('button', { name: 'Remove made-up-bill.pdf' }).click();
  await page.locator('dialog').getByRole('button', { name: 'Remove file' }).click();
  await page.getByText('made-up-bill.pdf').first().waitFor({ state: 'detached' });
  noErrors();
});

test('an attached web page never opens on the app origin; it downloads instead', async () => {
  const p = join(tmpdir(), 'made-up-page.html'); await writeFile(p, '<script>opener&&(opener.__pwned=1)</script>');
  await goto(page, '#/vault?q=washer');
  await page.getByRole('link', { name: 'Made-up washer' }).click();
  const c = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Add files' }).click();
  await (await c).setFiles(p);
  await page.getByText('made-up-page.html').waitFor();
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Open made-up-page.html' }).click();
  assert.equal((await dl).suggestedFilename(), 'made-up-page.html');
  await page.getByRole('button', { name: 'Remove made-up-page.html' }).click();
  await page.locator('dialog').getByRole('button', { name: 'Remove file' }).click();
  await page.getByText('made-up-page.html').first().waitFor({ state: 'detached' });
});

test('OCR is optional: no detector means guidance, a detector adds text to Notes', async () => {
  await goto(page, '#/vault?q=washer');
  await page.getByRole('link', { name: 'Made-up washer' }).click();
  await page.getByRole('button', { name: 'Open made-up-scan.png' }).click();
  await page.getByText('Reading text from images is not available').waitFor();
  await page.evaluate(() => { window.TextDetector = class { async detect() { return [{ rawValue: 'Serial 123 made up' }]; } }; });
  await page.getByRole('button', { name: 'Open made-up-scan.png' }).click();
  await page.getByRole('button', { name: 'Read text from image' }).click();
  await page.getByText('Text added to Notes.').waitFor();
  await page.evaluate(() => { delete window.TextDetector; });
});

test('clipboard really clears after the delay', async () => {
  const c2 = await b.browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const p2 = await c2.newPage();
  await p2.clock.install();
  await newVault(p2, b.url); await skipQuickStart(p2);
  await addItem(p2, 'login', 'Made-up mail', { Password: 'Made-up-Secret-99!' });
  await goto(p2, '#/settings'); await p2.getByLabel('Clear copied secrets after').selectOption('15');
  await goto(p2, '#/vault');
  await p2.getByRole('button', { name: 'Copy password for Made-up mail' }).click();
  assert.equal(await p2.evaluate(() => navigator.clipboard.readText()), 'Made-up-Secret-99!');
  await p2.clock.fastForward('00:16'); await p2.waitForTimeout(100);
  assert.equal(await p2.evaluate(() => navigator.clipboard.readText()), '');
  await c2.close();
});

test('a link to a missing item explains itself; a bad page falls back to Home with a message', async () => {
  await goto(page, '#/item/r_doesnotexist000');
  await page.getByText('This item is not here').waitFor();
  await goto(page, '#/nonsense');
  await page.getByText('That page does not exist').waitFor();
  await page.getByRole('heading', { name: 'Your vault' }).waitFor();
  noErrors();
});

test('custom category: add, use it on an item, refuse a duplicate, removal blocked while in use', async () => {
  await goto(page, '#/settings');
  await page.getByLabel('New category').fill('Made-up pets');
  await page.getByRole('button', { name: 'Add category' }).click();
  await page.getByText('Made-up pets (0)').waitFor();
  await page.getByLabel('New category').fill('made-up PETS');
  await page.getByRole('button', { name: 'Add category' }).click();
  await page.getByText('already have a category').waitFor();
  await addItem(page, 'note', 'Made-up vet card', { });
  await page.getByRole('link', { name: 'Edit' }).click();
  await page.getByLabel('Category').selectOption({ label: 'Made-up pets' });
  await page.getByRole('button', { name: 'Save changes' }).click();
  await page.getByRole('main').getByText('Made-up pets').waitFor();
  await goto(page, '#/settings');
  await page.getByText('Made-up pets (1)').waitFor();
  assert.equal(await page.getByRole('button', { name: 'Remove Made-up pets' }).isDisabled(), true);
  noErrors();
});
