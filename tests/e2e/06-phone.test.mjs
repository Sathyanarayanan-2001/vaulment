import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { boot, watch, newVault, skipQuickStart, addItem, goto, unlock } from './_harness.mjs';

const axeSource = await readFile(new URL('../../node_modules/axe-core/axe.min.js', import.meta.url), 'utf8');
const PAGES = ['#/home', '#/vault', '#/add', '#/dashboard', '#/reminders', '#/health', '#/sync', '#/transfer', '#/settings', '#/guide', '#/more', '#/new/card', '#/new/bank_account'];
const WIDTHS = [320, 360, 390];

let b; before(async () => { b = await boot(4206); }); after(() => b.close());

async function seeded(viewport, colorScheme = 'light') {
  const ctx = await b.browser.newContext({ viewport, hasTouch: true, isMobile: viewport.width < 500, colorScheme, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  await newVault(page, b.url); await skipQuickStart(page);
  await addItem(page, 'login', 'A very long made-up account title that keeps going and going to test wrapping at narrow widths', { Website: 'https://example.test/a/very/long/path/that/does/not/wrap/easily/at/all/1234567890', 'User name or email': 'a.very.long.made.up.user.name@example.test', Password: 'password123' });
  await addItem(page, 'card', 'Made-up card', { 'Card number': '4000123412341234', 'Valid until': '30/11/2026' });
  await addItem(page, 'insurance', 'Made-up policy', { 'Sum insured (₹)': '123456789012.34', 'Start date': '01/04/2026', 'Renewal date': '01/12/2026' });
  return { ctx, page };
}

/** Sideways scroll and any on-screen control under 44 px. */
const measure = (page) => page.evaluate(() => {
  const small = [];
  const sel = 'button, a[href], input:not([type=hidden]), select, textarea, summary, [role=button]';
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0 || getComputedStyle(el).visibility === 'hidden') continue;
    if (el.closest('.skip') || el.classList.contains('skip')) continue;
    // A checkbox is hit through its label; an inline link in running text is exempt in WCAG 2.5.8.
    const box = el.type === 'checkbox' ? el.closest('label').getBoundingClientRect() : r;
    if (el.matches('.guide-sec a, p a')) continue;
    if (box.height < 44 || box.width < 44) small.push(`${el.tagName}.${el.className} "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 24)}" ${Math.round(box.width)}x${Math.round(box.height)}`);
  }
  const de = document.documentElement;
  const over = [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > innerWidth + 1 && getComputedStyle(e).position !== 'fixed').slice(0, 3).map((e) => e.className || e.tagName);
  return { scrollW: de.scrollWidth, innerW: innerWidth, small, over };
});

for (const width of WIDTHS) {
  test(`phone ${width} px: no sideways scroll and 44 px targets on every page`, async () => {
    const { ctx, page } = await seeded({ width, height: 700 });
    for (const hash of PAGES) {
      await goto(page, hash); await page.waitForTimeout(60);
      const m = await measure(page);
      assert.ok(m.scrollW <= m.innerW, `${hash}: scrollWidth ${m.scrollW} > ${m.innerW} (${m.over})`);
      assert.deepEqual(m.small, [], hash);
      assert.equal(await page.locator('.bottom').isVisible(), !hash.startsWith('#/new'), `${hash}: bottom tabs, except on forms where Save takes their place`);
      assert.equal(await page.locator('.side').isVisible(), false);
    }
    // Item detail, with secrets open.
    await goto(page, '#/vault?q=Made-up%20card'); await page.getByRole('link', { name: 'Made-up card' }).click();
    await page.getByRole('heading', { name: 'Made-up card', exact: true }).waitFor();
    const m = await measure(page);
    assert.ok(m.scrollW <= m.innerW, `item: ${m.scrollW}`); assert.deepEqual(m.small, []);
    await ctx.close();
  });
}

test('phone 320 px: a toast stays inside the screen, and a large total is never cut', async () => {
  const { ctx, page } = await seeded({ width: 320, height: 680 });
  await addItem(page, 'note', 'One more note');
  const r = await page.evaluate(() => { const b = document.querySelector('.toast').getBoundingClientRect(); return { left: b.left, right: b.right, w: innerWidth }; });
  assert.ok(r.left >= 0 && r.right <= r.w, JSON.stringify(r));
  await goto(page, '#/dashboard');
  const v = page.locator('#st-total .stat-value');
  assert.equal(await v.textContent(), '₹1,23,45,67,89,012.34');
  assert.ok(await v.evaluate((n) => n.scrollWidth <= n.clientWidth), 'value fits on one line');
  await ctx.close();
});

test('phone: tables become cards', async () => {
  const { ctx, page } = await seeded({ width: 360, height: 700 });
  await goto(page, '#/vault');
  await page.locator('.items tbody tr').first().waitFor();
  const d = await page.evaluate(() => ({ tr: getComputedStyle(document.querySelector('.items tbody tr')).display, head: document.querySelector('.items thead').getBoundingClientRect().height }));
  assert.equal(d.tr, 'block');
  assert.ok(d.head <= 1);
  await ctx.close();
});

test('on the Vault page the tab bar steps aside only while typing', async () => {
  const { ctx, page } = await seeded({ width: 360, height: 700 });
  await goto(page, '#/vault');
  await page.locator('#vault-q').focus();
  await page.waitForTimeout(50);
  assert.equal(await page.locator('.bottom').isVisible(), false);
  await page.evaluate(() => document.activeElement.blur());
  await page.waitForTimeout(300);
  assert.equal(await page.locator('.bottom').isVisible(), true);
  await ctx.close();
});

test('number fields open the numeric keyboard', async () => {
  const { ctx, page } = await seeded({ width: 360, height: 700 });
  await goto(page, '#/new/card');
  const mode = (id) => page.locator(id).getAttribute('inputmode');
  assert.equal(await mode('#f-number'), 'numeric'); assert.equal(await mode('#f-pin'), 'numeric'); assert.equal(await mode('#f-cvv'), 'numeric');
  assert.equal(await mode('#f-amt'), 'decimal'); assert.equal(await mode('#f-exp'), 'numeric');
  await ctx.close();
});

test('on-screen keyboard: the field stays visible, the form stays open, typing survives', async () => {
  const { ctx, page } = await seeded({ width: 360, height: 720 });
  await goto(page, '#/new/bank_account');
  await page.getByLabel('Title').fill('Keep this text');
  const field = page.locator('#f-mpin');
  await field.scrollIntoViewIfNeeded(); await field.focus();
  await field.fill('1234');
  assert.equal(await page.locator('.bottom').isVisible(), false, 'tab bar is out of the way on a form');
  // A keyboard opening shrinks the viewport by roughly half on a phone.
  await page.setViewportSize({ width: 360, height: 360 });
  await page.waitForTimeout(400);
  const box = await page.evaluate(() => { const r = document.activeElement.getBoundingClientRect(); return { id: document.activeElement.id, top: r.top, bottom: r.bottom, h: innerHeight }; });
  assert.equal(box.id, 'f-mpin');
  assert.ok(box.top >= 0 && box.bottom <= box.h, JSON.stringify(box));
  assert.equal(await page.getByLabel('Title').inputValue(), 'Keep this text');
  assert.equal(await field.inputValue(), '1234');
  await page.setViewportSize({ width: 360, height: 720 });
  await page.waitForTimeout(100);
  assert.equal(await page.getByRole('heading', { name: 'New bank account' }).isVisible(), true);
  await ctx.close();
});

const CONTRAST_PAGES = [...PAGES];

for (const [name, viewport, scheme] of [['desktop light', { width: 1280, height: 800 }, 'light'], ['desktop dark', { width: 1280, height: 800 }, 'dark'], ['phone light', { width: 360, height: 700 }, 'light'], ['phone dark', { width: 360, height: 700 }, 'dark']]) {
  test(`axe-core on every page, ${name}: no WCAG A or AA violations`, async () => {
    const { ctx, page } = await seeded(viewport, scheme);
    const problems = watch(page);
    const out = [];
    const run = async (label) => {
      const r = await page.evaluate(async (src) => {
        // Trusted Types blocks eval, so axe is loaded through the test harness only.
        if (!window.axe) (0, eval)(src);
        return (await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] })).violations.map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`);
      }, axeSource);
      for (const v of r) out.push(`${label} ${v}`);
    };
    for (const hash of CONTRAST_PAGES) { await goto(page, hash); await page.waitForTimeout(60); await run(hash); }
    await goto(page, '#/dashboard'); await page.locator('.chart-card').first().getByRole('button', { name: 'Table' }).click(); await run('dashboard table');
    assert.deepEqual(out, []); assert.deepEqual(problems, []);
    await ctx.close();
  });
}

function lum(hex) { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; }
const ratio = (a, b2) => { const [x, y] = [lum(a), lum(b2)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test('second method: every text and surface token pair worked out directly meets 4.5:1', async () => {
  const css = await readFile(new URL('../../src/styles/app.css', import.meta.url), 'utf8');
  const blocks = [css.slice(css.indexOf(':root {'), css.indexOf('@media (prefers-color-scheme')), css.slice(css.indexOf(':root[data-theme="dark"]'), css.indexOf('*, *::before'))];
  const fails = [];
  for (const [mode, block] of ['light', 'dark'].map((m, i) => [m, blocks[i]])) {
    const t = Object.fromEntries([...block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})/g)].map((x) => [x[1], x[2]]));
    const pairs = [['ink', 'bg'], ['ink', 'surface'], ['ink', 'surface-2'], ['ink-2', 'bg'], ['ink-2', 'surface'], ['ink-2', 'surface-2'], ['muted', 'bg'], ['muted', 'surface'], ['muted', 'surface-2'], ['accent-text', 'bg'], ['accent-text', 'surface'], ['accent-text', 'accent-soft'], ['accent-ink', 'accent'], ['amber-ink', 'amber-bg'], ['red-ink', 'red-bg'], ['red-ink', 'surface'], ['ok-ink', 'ok-bg'], ['surface', 'red'], ['bg', 'ink']];
    for (const [fg, bg] of pairs) { const r = ratio(t[fg], t[bg]); if (r < 4.5) fails.push(`${mode} ${fg} on ${bg}: ${r.toFixed(2)}`); }
  }
  assert.deepEqual(fails, []);
});

test('reduced motion and focus: motion rules exist and focus is visible', async () => {
  const css = await readFile(new URL('../../src/styles/app.css', import.meta.url), 'utf8');
  assert.match(css, /prefers-reduced-motion: reduce/);
  const { ctx, page } = await seeded({ width: 1280, height: 800 });
  await goto(page, '#/vault');
  await page.keyboard.press('Tab');
  const outline = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
  assert.equal(outline, 'solid');
  await ctx.close();
});

test('IBM Plex Sans really loads from the page itself', async () => {
  const { ctx, page } = await seeded({ width: 1280, height: 800 });
  const ok = await page.evaluate(async () => { await document.fonts.ready; return { reg: document.fonts.check('14px "IBM Plex Sans"', '₹1,23,456.78'), used: getComputedStyle(document.body).fontFamily }; });
  assert.equal(ok.reg, true); assert.match(ok.used, /IBM Plex Sans/);
  await ctx.close();
});
