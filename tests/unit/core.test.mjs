import test from 'node:test';
import assert from 'node:assert/strict';
import { item, id } from './_helpers.mjs';
import { validateItem, validateAny, validateAttachment, CATEGORIES, TEMPLATES, CATEGORY_IDS } from '../../src/js/core/schema.js';
import { sortItems, queryItems, haystackOf } from '../../src/js/core/search.js';
import { generatePassword, passwordBits, strengthLabel, passwordReport, randomBelow } from '../../src/js/core/passwords.js';
import { computeStats } from '../../src/js/core/stats.js';
import { parseRoute, buildVaultHash } from '../../src/js/core/route.js';
import { formatPaise, parseRupees, sumPaise } from '../../src/js/core/money.js';
import { parseTypedDate, formatDate, periodOf } from '../../src/js/core/dates.js';
import { WORKED_EXAMPLES } from '../../src/js/core/examples.js';

const NOW = Date.UTC(2026, 10, 5, 6, 0);

test('validate: a good item passes', () => assert.deepEqual(validateItem(item()), []));
test('validate: blank title asks for a title', () => assert.match(validateItem(item({ title: ' ' }))[0], /Add a title/));
for (const [name, over] of Object.entries({
  'bad id': { id: '../x' }, 'unknown template': { t: 'nope' }, 'unknown category': { c: 'nope!' }, 'bad date': { doc: '2026-02-30' }, 'fractional paise': { amt: 1.5 },
  'negative paise': { amt: -1 }, 'non-text field': { f: { a: 1 } }, 'proto key': { f: { constructor: 'x' } }, 'tags not array': { tags: 'x' }, 'bad fav': { fav: 2 }, 'bad stamp': { u: -1 },
})) test(`validate rejects ${name}`, () => assert.ok(validateItem(item(over)).length > 0));
test('validate: __proto__ in parsed JSON is refused', () => assert.ok(validateItem(item({ f: JSON.parse('{"__proto__":"x"}') })).length > 0));
test('validateAny: tombstone good; tombstone with extra keys refused; wrong key refused', () => {
  assert.deepEqual(validateAny('r_abcdefgh1', { d: 1, u: 5 }), []);
  assert.ok(validateAny('r_abcdefgh1', { d: 1, u: 5, title: 'x' }).length > 0);
  assert.ok(validateAny('r_abcdefgh1', item()).length > 0);
});
test('validateAttachment: oversize refused', () => assert.ok(validateAttachment({ id: id('a'), k: 'att', item: id(), name: 'x.pdf', mime: 'application/pdf', size: 1e9, u: 1, cr: 1 }).length > 0));
test('every template points at a real category; ids unique', () => {
  for (const t of TEMPLATES) assert.ok(CATEGORY_IDS.has(t.cat), t.id);
  assert.equal(new Set(TEMPLATES.map((t) => t.id)).size, TEMPLATES.length);
  assert.equal(new Set(CATEGORIES.map((c) => c.slot)).size, CATEGORIES.length);
});

test('sort: stable total order: equal titles fall back to date (newest first), then id', () => {
  const a = item({ id: 'r_aaaaaaaa1', title: 'Same', doc: '2026-01-01' });
  const b = item({ id: 'r_aaaaaaaa2', title: 'Same', doc: '2026-06-01' });
  const c = item({ id: 'r_aaaaaaaa3', title: 'Same', doc: '2026-06-01' });
  assert.deepEqual(sortItems([a, c, b], 'title').map((x) => x.id), ['r_aaaaaaaa2', 'r_aaaaaaaa3', 'r_aaaaaaaa1']);
});
test('sort: same date falls back to name', () => {
  const a = item({ title: 'Zebra', doc: '2026-01-01' }); const b = item({ title: 'Apple', doc: '2026-01-01' });
  assert.deepEqual(sortItems([a, b], 'date').map((x) => x.title), ['Apple', 'Zebra']);
});
test('sort: expiry puts items with no expiry last', () => {
  const a = item({ title: 'None' }); const b = item({ title: 'Later', exp: '2030-01-01' }); const c = item({ title: 'Soon', exp: '2027-01-01' });
  assert.deepEqual(sortItems([a, b, c], 'expiry').map((x) => x.title), ['Soon', 'Later', 'None']);
});
test('sort: result identical whatever the input order', () => {
  const list = Array.from({ length: 50 }, (_, i) => item({ title: `T${i % 5}`, doc: `2026-0${(i % 3) + 1}-01` }));
  const once = sortItems(list, 'title').map((x) => x.id);
  assert.deepEqual(sortItems([...list].reverse(), 'title').map((x) => x.id), once);
});
test('search: all words must match; case ignored', () => {
  const a = item({ title: 'Sample Savings', notes: 'Chennai branch' }); const b = item({ title: 'Sample Other' });
  const hay = new Map([a, b].map((x) => [x.id, haystackOf(x)]));
  assert.deepEqual(queryItems([a, b], hay, { q: 'sample CHENNAI' }).map((x) => x.id), [a.id]);
});
test('search never matches a password or PIN', () => {
  const a = item({ t: 'login', f: { pass: 'hunter2', user: 'me' } }); const b = item({ t: 'card', f: { pin: '4321', cvv: '987' } });
  const hay = new Map([a, b].map((x) => [x.id, haystackOf(x)]));
  for (const q of ['hunter2', '4321', '987']) assert.equal(queryItems([a, b], hay, { q }).length, 0, q);
  assert.equal(queryItems([a, b], hay, { q: 'me' }).length, 1);
});
test('query views: trash only in trash; favourites only favourites; category filter', () => {
  const a = item({ trash: 5 }); const b = item({ fav: 1, c: 'banking' }); const c = item();
  const hay = new Map();
  assert.deepEqual(queryItems([a, b, c], hay, { view: 'trash' }).map((x) => x.id), [a.id]);
  assert.deepEqual(queryItems([a, b, c], hay, { view: 'favourites' }).map((x) => x.id), [b.id]);
  assert.deepEqual(queryItems([a, b, c], hay, { cat: 'banking' }).map((x) => x.id), [b.id]);
  assert.equal(queryItems([a, b, c], hay).length, 2);
});

test('generator: length and all four character sets', () => {
  for (let i = 0; i < 200; i++) {
    const p = generatePassword({ length: 16 });
    assert.equal(p.length, 16); assert.match(p, /[a-z]/); assert.match(p, /[A-Z]/); assert.match(p, /[2-9]/); assert.match(p, /[!#$%&*+\-=?@_]/);
  }
});
test('generator refuses impossible settings', () => { assert.throws(() => generatePassword({ lower: false, upper: false, digits: false, symbols: false })); assert.throws(() => generatePassword({ length: 2 })); });
test('randomBelow redraws values above the fair ceiling', () => {
  const seq = [0xFFFFFFFF, 7]; let i = 0;
  assert.equal(randomBelow(10, (b) => { b[0] = seq[i++]; }), 7); assert.equal(i, 2);
});
test('strength: common password = 0 bits, weak; long mixed = strong; repeats penalised', () => {
  assert.equal(passwordBits('password123'), 0); assert.equal(strengthLabel(passwordBits('abc')), 'weak');
  assert.equal(strengthLabel(passwordBits(generatePassword({ length: 20 }))), 'strong');
  assert.ok(passwordBits('aaaaaaaaaaaaaaaaaaaa') < passwordBits('abcdefghijklmnopqrst'));
});
test('health: reuse found by map; old by date; trash ignored', () => {
  const a = item({ t: 'login', f: { pass: 'Sh4red!pass-word' }, cr: NOW, u: NOW });
  const b = item({ t: 'login', f: { pass: 'Sh4red!pass-word' }, cr: NOW, u: NOW });
  const c = item({ t: 'login', f: { pass: 'abc' }, cr: NOW - 400 * 86400000 });
  const d = item({ t: 'login', f: { pass: 'abc' }, trash: 1 });
  const r = passwordReport([a, b, c, d], NOW);
  assert.equal(r.checked, 3); assert.equal(r.reused.length, 2); assert.deepEqual(r.weak.map((x) => x.id), [c.id]); assert.deepEqual(r.old.map((x) => x.id), [c.id]);
});

test('stats: hand-worked vault of 6 items', () => {
  // By hand: 5 live (1 trashed). banking 2, online 1, office 1, warranty 1 → 4 categories.
  // Money: 5,00,000.00 + 45,999.50 + 0.50 = 5,46,000.00. Expiries from 05/11/2026:
  // 01/11/2026 overdue, 05/12/2026 is 30 days (in30), 03/02/2027 is 90 days (in90).
  const items = [
    item({ c: 'banking', t: 'card', exp: '2026-11-01', cr: NOW, doc: '' }),
    item({ c: 'banking', t: 'bank_account', cr: NOW - 40 * 86400000, doc: '2026-03-31', amt: 50 }),
    item({ c: 'online', t: 'login', f: { pass: 'abc' }, cr: NOW }),
    item({ c: 'office', t: 'insurance', amt: 50000000, exp: '2026-12-05', doc: '2026-04-01', cr: NOW }),
    item({ c: 'warranty', t: 'warranty', amt: 4599950, exp: '2027-02-03', doc: '2026-04-01', cr: NOW }),
    item({ c: 'medical', t: 'medical', trash: 1, amt: 999, cr: NOW }),
  ];
  const atts = [{ item: items[0].id, size: 1000 }, { item: items[5].id, size: 500 }];
  const s = computeStats(items, atts, [], NOW);
  assert.equal(s.items, 5); assert.equal(s.trashed, 1); assert.equal(s.categoriesUsed, 4); assert.equal(s.files, 1); assert.equal(s.fileBytes, 1000);
  assert.equal(formatPaise(s.totalAmount), '5,46,000.00');
  assert.deepEqual(s.due, { overdue: 1, in30: 1, in90: 1, in365: 0, later: 0 });
  assert.equal(s.byCategory.find((c) => c.id === 'banking').count, 2);
  assert.equal(s.byMonth.at(-1).count, 4); assert.equal(s.byMonth.at(-2).count, 0); assert.equal(s.byMonth.at(-3).count, 1); // added 40 days ago is 26/09/2026
  assert.equal(s.week, 'CW45'); assert.equal(s.fy, 'FY 2026-27'); assert.equal(s.addedThisWeek, 4);
  assert.deepEqual(s.byFy.map((f) => [f.label, f.count]), [['FY 2025-26', 1], ['FY 2026-27', 4]]);
  assert.equal(s.weak, 1);
});
test('stats boundary: expiry today is due, not overdue; 31 days is in90; 366 days is later', () => {
  const s = computeStats([item({ exp: '2026-11-05' }), item({ exp: '2026-12-06' }), item({ exp: '2027-11-06' })], [], [], NOW);
  assert.deepEqual(s.due, { overdue: 0, in30: 1, in90: 1, in365: 0, later: 1 });
});
test('stats totals equal a separate tally on 1,000 varied items', () => {
  const list = Array.from({ length: 1000 }, (_, i) => item({ c: CATEGORIES[i % 8].id, amt: i % 3 === 0 ? i * 137 : null, cr: NOW - i * 86400000 }));
  const s = computeStats(list, [], [], NOW);
  let manual = 0n; for (let i = 0; i < 1000; i += 3) manual += BigInt(i * 137);
  assert.equal(s.totalAmount, manual);
  assert.equal(s.byCategory.reduce((n, c) => n + c.count, 0), 1000);
});

test('route: pages, ids and templates pass; junk falls back with a message', () => {
  assert.equal(parseRoute('#/dashboard').page, 'dashboard');
  assert.equal(parseRoute('').page, 'home');
  assert.equal(parseRoute('#/item/r_abcdefgh12').id, 'r_abcdefgh12');
  assert.equal(parseRoute('#/new/login').template, 'login');
  for (const bad of ['#/nope', '#/item/<script>', '#/item', '#/new/constructor', '#/new/__proto__', '#/dashboard/extra']) { const r = parseRoute(bad); assert.equal(r.page, 'home', bad); assert.ok(r.error, bad); }
});
test('route: vault filters validated; a bad one clears them', () => {
  assert.deepEqual(parseRoute('#/vault?cat=banking&sort=title&q=a%20b').params, { cat: 'banking', sort: 'title', q: 'a b' });
  assert.ok(parseRoute('#/vault?sort=evil').error); assert.ok(parseRoute('#/vault?cat=%3Cimg').error); assert.ok(parseRoute('#/vault?q=%E0%A4%A').error);
  assert.equal(parseRoute(`#/vault?q=${'a'.repeat(500)}`).params.q.length, 200);
});
test('route: hash builder round trips', () => { const p = { q: 'a&b c', cat: 'office', sort: 'date' }; assert.deepEqual(parseRoute(buildVaultHash(p)).params, p); });

test('worked examples in the Guide match the code', () => {
  for (const ex of WORKED_EXAMPLES) {
    if (ex.fn === 'date') {
      const r = parseTypedDate(ex.arg, '2026-11-05'); const p = periodOf(r.iso);
      assert.equal(`${formatDate(r.iso)}, ${p.month}, ${p.week}, ${p.fy}`, ex.expected, ex.topic);
    } else assert.equal(formatPaise(sumPaise(ex.arg.map((a) => parseRupees(a).paise))), ex.expected, ex.topic);
  }
});
