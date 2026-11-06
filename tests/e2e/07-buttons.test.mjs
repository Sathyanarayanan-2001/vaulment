import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, watch, newVault, skipQuickStart, addItem, goto } from './_harness.mjs';

let b; before(async () => { b = await boot(4207); }); after(() => b.close());

const PAGES = ['#/home', '#/vault', '#/vault?view=favourites', '#/vault?view=trash', '#/add', '#/dashboard', '#/reminders', '#/health', '#/sync', '#/transfer', '#/settings', '#/guide', '#/more', '#/new/login', '#/new/card'];
// These leave the page, or open a native picker or a destructive confirm covered by other suites.
const SKIP = /Choose|Add files|Lock vault|Erase|Move to trash|Delete|Restore|Remove|Merge|Send save|Download backup|Choose CSV|Save|Cancel|Make a new|Export CSV|Change password|Add category|Show preview/i;

test('every control has an accessible name, and pressing every safe button raises no error', async () => {
  const ctx = await b.browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage(); const problems = watch(page);
  await newVault(page, b.url); await skipQuickStart(page);
  await addItem(page, 'login', 'Made-up mail', { Password: 'password123' });
  await addItem(page, 'insurance', 'Made-up policy', { 'Sum insured (₹)': '5,00,000', 'Renewal date': '01/12/2026' });
  let pressed = 0; let checked = 0;
  for (const hash of PAGES) {
    await goto(page, hash); await page.waitForTimeout(50);
    const unnamed = await page.evaluate(() => [...document.querySelectorAll('button, a[href], input, select, textarea')].filter((e) => {
      if (e.type === 'hidden') return false;
      const name = (e.getAttribute('aria-label') || e.textContent || e.labels?.[0]?.textContent || e.getAttribute('title') || '').trim();
      return !name;
    }).map((e) => e.outerHTML.slice(0, 80)));
    assert.deepEqual(unnamed, [], hash);
    const count = await page.locator('main button:visible').count();
    checked += count;
    for (let i = 0; i < count; i++) {
      const btn = page.locator('main button:visible').nth(i);
      if (!(await btn.count())) break;
      const label = (await btn.getAttribute('aria-label')) || (await btn.textContent()) || '';
      if (SKIP.test(label) || await btn.isDisabled()) continue;
      await btn.click(); pressed += 1;
      await page.waitForTimeout(15);
      if (await page.locator('dialog[open]').count()) await page.keyboard.press('Escape');
      await goto(page, hash);
    }
  }
  assert.ok(checked >= 30, `checked ${checked}`); assert.ok(pressed >= 15, `pressed ${pressed}`);
  assert.deepEqual(problems, []);
  console.log(`# buttons checked ${checked}, pressed ${pressed}`);
  await ctx.close();
});

test('every Home tile and tab link opens its page', async () => {
  const ctx = await b.browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage(); const problems = watch(page);
  await newVault(page, b.url); await skipQuickStart(page);
  const tiles = [['Vault', 'Vault'], ['Add item', 'Add item'], ['Dashboard', 'Dashboard'], ['Reminders', 'Reminders'], ['Password health', 'Password health'], ['Sync', 'Sync'], ['Import and export', 'Import and export'], ['Settings', 'Settings'], ['Guide', 'Guide']];
  for (const [name, heading] of tiles) {
    await goto(page, '#/home');
    await page.getByRole('navigation', { name: 'All tabs' }).getByRole('link', { name: new RegExp(`^${name}`) }).click();
    await page.getByRole('heading', { level: 1, name: heading }).waitFor();
  }
  for (const [name, heading] of [...tiles.filter(([n]) => n !== 'Add item'), ['Home', 'Your vault']]) {
    await page.locator('.side').getByRole('link', { name }).click();
    await page.getByRole('heading', { level: 1, name: heading }).waitFor();
  }
  assert.deepEqual(problems, []);
  await ctx.close();
});

test('empty states say what to do next on every data page', async () => {
  const ctx = await b.browser.newContext(); const page = await ctx.newPage();
  await newVault(page, b.url); await skipQuickStart(page);
  for (const [hash, text, action] of [['#/vault', 'Your vault is empty', 'Add item'], ['#/dashboard', 'Nothing to count yet', 'Add item'], ['#/reminders', 'No dates to watch yet', 'Add item'], ['#/health', 'No passwords saved yet', 'Add online account']]) {
    await goto(page, hash);
    await page.getByText(text).waitFor();
    assert.ok(await page.locator('.empty').getByRole('link', { name: action }).isVisible(), hash);
  }
  await ctx.close();
});

test('keyboard shortcuts: n, / and l', async () => {
  const ctx = await b.browser.newContext(); const page = await ctx.newPage();
  await newVault(page, b.url); await skipQuickStart(page);
  await page.keyboard.press('n'); await page.getByRole('heading', { name: 'Add item' }).waitFor();
  await page.keyboard.press('/'); await page.getByRole('heading', { name: 'Vault', exact: true }).waitFor();
  await page.keyboard.press('/'); assert.equal(await page.evaluate(() => document.activeElement.id), 'vault-q');
  await page.keyboard.press('Escape'); await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.press('l'); await page.getByRole('heading', { name: 'Unlock your vault' }).waitFor();
  await ctx.close();
});
