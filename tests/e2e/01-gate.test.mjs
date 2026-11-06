import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, watch, newVault, skipQuickStart, unlock, addItem, MASTER, goto } from './_harness.mjs';

let b; before(async () => { b = await boot(4201); }); after(() => b.close());
const fresh = async (opts) => { const ctx = await b.browser.newContext(opts); const page = await ctx.newPage(); return { ctx, page, problems: watch(page) }; };

test('setup refuses a short, a weak and a mismatched password, each with a reason', async () => {
  const { ctx, page, problems } = await fresh();
  await page.goto(b.url);
  const go = async (a, c) => { await page.locator('#new-pw').fill(a); await page.locator('#new-pw2').fill(c); await page.getByRole('button', { name: 'Create my vault' }).click(); await page.waitForTimeout(120); return page.getByRole('alert').first().textContent(); };
  assert.match(await go('short', 'short'), /at least 10/);
  assert.match(await go('password123', 'password123'), /easy to guess/);
  assert.match(await go('made-up test phrase', 'different phrase 1'), /do not match/);
  assert.deepEqual(problems, []); await ctx.close();
});

test('recovery key screen will not continue until the box is ticked', async () => {
  const { ctx, page } = await fresh();
  await page.goto(b.url);
  await page.locator('#new-pw').fill(MASTER); await page.locator('#new-pw2').fill(MASTER);
  await page.getByRole('button', { name: 'Create my vault' }).click();
  await page.getByRole('heading', { name: 'Save your recovery key' }).waitFor();
  assert.match(await page.locator('#recovery-code').textContent(), /^([0-9A-Z]{5}-){5}[0-9A-Z]{5}$/);
  await page.getByRole('button', { name: 'Continue' }).click();
  assert.match(await page.getByRole('alert').first().textContent(), /Tick the box/);
  await ctx.close();
});

test('quick start: appears on first visit, steps 1 to 4, then does not return; reopens from Guide', async () => {
  const { ctx, page, problems } = await fresh();
  await newVault(page, b.url);
  for (const n of [1, 2, 3]) { assert.ok(await page.getByText(`step ${n} of 4`).isVisible()); await page.getByRole('button', { name: 'Next' }).click(); }
  await page.getByRole('button', { name: 'Back' }).click(); assert.ok(await page.getByText('step 3 of 4').isVisible());
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Finish' }).click();
  await page.reload(); await unlock(page);
  assert.equal(await page.locator('dialog[open]').count(), 0);
  await goto(page, '#/guide'); await page.getByRole('button', { name: 'Show quick start' }).click();
  assert.ok(await page.getByText('step 1 of 4').isVisible());
  await page.keyboard.press('Escape'); assert.equal(await page.locator('dialog').count(), 0);
  assert.deepEqual(problems, []); await ctx.close();
});

test('lock button clears the page; wrong password refused; right password opens', async () => {
  const { ctx, page, problems } = await fresh();
  await newVault(page, b.url); await skipQuickStart(page);
  await addItem(page, 'note', 'Private made-up note');
  await page.getByRole('button', { name: 'Lock vault' }).click();
  await page.getByRole('heading', { name: 'Unlock your vault' }).waitFor();
  assert.ok(!(await page.content()).includes('Private made-up note'));
  assert.equal(await page.title(), 'Vaulment');
  await page.locator('input[type=password]').fill('wrong password here');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await page.getByRole('alert').first().filter({ hasText: 'not right' }).waitFor();
  await unlock(page);
  await goto(page, '#/vault'); await page.getByText('Private made-up note').waitFor();
  assert.deepEqual(problems, []); await ctx.close();
});

test('auto-lock fires after the chosen idle time', async () => {
  const { ctx, page } = await fresh();
  await page.clock.install();
  await newVault(page, b.url); await skipQuickStart(page);
  await goto(page, '#/settings'); await page.getByLabel('Lock after no activity').selectOption('1');
  await page.clock.fastForward('00:50'); await page.waitForTimeout(100);
  assert.equal(await page.getByRole('heading', { name: 'Unlock your vault' }).count(), 0);
  await page.clock.fastForward('01:10');
  await page.getByRole('heading', { name: 'Unlock your vault' }).waitFor({ timeout: 5000 });
  await ctx.close();
});

test('first tap after a long absence locks instead of counting as activity', async () => {
  const { ctx, page } = await fresh();
  await page.clock.install();
  await newVault(page, b.url); await skipQuickStart(page);
  // Jumps the clock without firing timers, as a phone does when frozen in the background.
  await page.clock.setSystemTime(Date.now() + 10 * 60 * 1000);
  await page.getByRole('main').locator('h1').click();
  await page.getByRole('heading', { name: 'Unlock your vault' }).waitFor({ timeout: 3000 });
  await ctx.close();
});

test('two tabs on one device: a save in one appears in the other', async () => {
  const { ctx, page } = await fresh();
  await newVault(page, b.url); await skipQuickStart(page);
  const tab2 = await ctx.newPage();
  await tab2.goto(b.url); await unlock(tab2);
  await goto(tab2, '#/vault');
  await addItem(page, 'note', 'Saved in tab one');
  await tab2.getByRole('link', { name: 'Saved in tab one' }).waitFor({ timeout: 3000 });
  await ctx.close();
});

test('recovery key: forgot password, set a new one, data intact, old password dead', async () => {
  const { ctx, page, problems } = await fresh();
  const code = await newVault(page, b.url); await skipQuickStart(page);
  await addItem(page, 'note', 'Kept through recovery');
  await page.getByRole('button', { name: 'Lock vault' }).click();
  await page.getByRole('button', { name: /Forgot the password/ }).click();
  await page.locator('#rk-input').fill('AAAAA-BBBBB-CCCCC-DDDDD-EEEEE-FFFFF');
  await page.locator('#rk-pw').fill('a new made-up phrase 7'); await page.locator('#rk-pw2').fill('a new made-up phrase 7');
  await page.getByRole('button', { name: 'Set new password' }).click();
  await page.getByRole('alert').first().filter({ hasText: 'recovery key is not right' }).waitFor();
  await page.locator('#rk-input').fill(code);
  await page.getByRole('button', { name: 'Set new password' }).click();
  await page.locator('#sync-chip').waitFor();
  await goto(page, '#/vault'); await page.getByText('Kept through recovery').waitFor();
  await page.reload();
  await page.locator('input[type=password]').fill(MASTER); await page.getByRole('button', { name: 'Unlock' }).click();
  await page.getByRole('alert').first().filter({ hasText: 'not right' }).waitFor();
  await unlock(page, 'a new made-up phrase 7');
  assert.deepEqual(problems, []); await ctx.close();
});

test('change password in Settings: wrong current refused, new one works after reload', async () => {
  const { ctx, page, problems } = await fresh();
  await newVault(page, b.url); await skipQuickStart(page);
  await goto(page, '#/settings');
  await page.locator('#cp-old').fill('not my password'); await page.locator('#cp-new').fill('fresh made-up phrase 9'); await page.locator('#cp-new2').fill('fresh made-up phrase 9');
  await page.getByRole('button', { name: 'Change password' }).click();
  await page.getByRole('alert').first().filter({ hasText: 'current password is not right' }).waitFor();
  await page.locator('#cp-old').fill(MASTER);
  await page.getByRole('button', { name: 'Change password' }).click();
  await page.getByText('Master password changed').waitFor();
  await page.reload(); await unlock(page, 'fresh made-up phrase 9');
  assert.deepEqual(problems, []); await ctx.close();
});

test('new recovery key: password gate, new code shown, then back in the app', async () => {
  const { ctx, page, problems } = await fresh();
  const old = await newVault(page, b.url); await skipQuickStart(page);
  await goto(page, '#/settings');
  await page.getByRole('button', { name: 'Make a new recovery key' }).click();
  await page.locator('#dlg-pw').fill('wrong one'); await page.getByRole('button', { name: 'Make new key' }).click();
  await page.locator('dialog').getByText('not right').waitFor();
  await page.locator('#dlg-pw').fill(MASTER); await page.getByRole('button', { name: 'Make new key' }).click();
  await page.getByRole('heading', { name: 'Save your recovery key' }).waitFor();
  const fresh2 = await page.locator('#recovery-code').textContent();
  assert.notEqual(fresh2, old);
  // Close the tab here and the old key must still be the valid one: nothing is applied yet.
  await page.reload();
  await page.getByRole('button', { name: /Forgot the password/ }).click();
  await page.locator('#rk-input').fill(old);
  await page.locator('#rk-pw').fill(MASTER); await page.locator('#rk-pw2').fill(MASTER);
  await page.getByRole('button', { name: 'Set new password' }).click();
  await page.locator('#sync-chip').waitFor();
  await goto(page, '#/settings');
  await page.getByRole('button', { name: 'Make a new recovery key' }).click();
  await page.locator('#dlg-pw').fill(MASTER); await page.getByRole('button', { name: 'Make new key' }).click();
  await page.getByRole('heading', { name: 'Save your recovery key' }).waitFor();
  await page.getByLabel('I have saved my recovery key').check(); await page.getByRole('button', { name: 'Continue' }).click();
  await page.locator('#sync-chip').waitFor();
  assert.deepEqual(problems, []); await ctx.close();
});

test('erase this device: two confirmations, then the first-run screen', async () => {
  const { ctx, page, problems } = await fresh();
  await newVault(page, b.url); await skipQuickStart(page);
  await goto(page, '#/settings');
  await page.getByRole('button', { name: 'Erase vault from this device' }).click();
  await page.locator('#dlg-pw').fill(MASTER); await page.locator('dialog').getByRole('button', { name: 'Erase' }).click();
  await page.getByRole('button', { name: 'Erase this device' }).click();
  await page.getByRole('heading', { name: 'Create your vault' }).waitFor();
  assert.deepEqual(problems, []); await ctx.close();
});

test('theme: follows system first; button cycles and the choice survives reload', async () => {
  const { ctx, page } = await fresh({ colorScheme: 'dark' });
  await newVault(page, b.url); await skipQuickStart(page);
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  assert.equal(await bg(), 'rgb(15, 23, 42)');
  await page.locator('#theme-btn').click();
  assert.equal(await bg(), 'rgb(238, 242, 246)');
  await page.locator('#theme-btn').click(); assert.equal(await bg(), 'rgb(15, 23, 42)');
  await page.locator('#theme-btn').click(); await page.locator('#theme-btn').click();
  await page.reload();
  assert.equal(await bg(), 'rgb(238, 242, 246)');
  await ctx.close();
});
