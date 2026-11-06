import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRupees, formatPaise, sumPaise, paiseToPlain, MAX_PAISE } from '../../src/js/core/money.js';
import { bytesToMib, formatBytes, IST_OFFSET_MS, MS_PER_DAY } from '../../src/js/core/units.js';

const ok = (s) => { const r = parseRupees(s); assert.equal(r.ok, true, s); return r.paise; };

test('parse: "1,23,456.78" → 12345678 paise (1,23,456 × 100 + 78)', () => assert.equal(ok('1,23,456.78'), 12345678));
test('parse: "1234.56" → 123456 exactly (float would give 123456.00000000001)', () => assert.equal(ok('1234.56'), 123456));
test('parse: "0.1" → 10 paise; "5" → 500; "₹ 7.5" → 750; "Rs. 2" → 200', () => { assert.equal(ok('0.1'), 10); assert.equal(ok('5'), 500); assert.equal(ok('₹ 7.5'), 750); assert.equal(ok('Rs. 2'), 200); });
test('parse: "4.35" → 435 (435.00000000000006 in float)', () => assert.equal(ok('4.35'), 435));
test('parse rejects: empty, negative, letters, three decimals, oversize', () => {
  for (const bad of ['', '-5', '12a', '1.234', '1.2.3', '99999999999999999999']) assert.equal(parseRupees(bad).ok, false, bad);
});
test('parse: errors say how to fix it', () => assert.match(parseRupees('1.234').error, /two digits/));
test('format: 12345678 → 1,23,456.78', () => assert.equal(formatPaise(12345678), '1,23,456.78'));
test('format: 0 → 0.00; 5 → 0.05; 99 → 0.99; 100 → 1.00', () => { assert.equal(formatPaise(0), '0.00'); assert.equal(formatPaise(5), '0.05'); assert.equal(formatPaise(99), '0.99'); assert.equal(formatPaise(100), '1.00'); });
test('format grouping: 99,999.00 | 1,00,000.00 | 10,00,000.00 | 1,00,00,000.00', () => {
  assert.equal(formatPaise(9999900), '99,999.00'); assert.equal(formatPaise(10000000), '1,00,000.00');
  assert.equal(formatPaise(100000000), '10,00,000.00'); assert.equal(formatPaise(1000000000), '1,00,00,000.00');
});
test('format: 999.00 has no comma; 1,000.00 has one', () => { assert.equal(formatPaise(99900), '999.00'); assert.equal(formatPaise(100000), '1,000.00'); });
test('format: symbol and negative', () => { assert.equal(formatPaise(150, { symbol: true }), '₹1.50'); assert.equal(formatPaise(-150), '-1.50'); });
test('format accepts BigInt beyond the safe integer range: 10^18 paise = 10^16 rupees → 10,00,00,00,00,00,00,000.00', () => assert.equal(formatPaise(10n ** 18n), '10,00,00,00,00,00,00,000.00'));
test('sum by hand: 0.10 + 0.20 = 0.30 exactly (float gives 0.30000000000000004)', () => assert.equal(sumPaise([10, 20]), 30n));
test('sum by hand: 1,23,456.78 + 76,543.22 = 2,00,000.00', () => assert.equal(formatPaise(sumPaise([12345678, 7654322])), '2,00,000.00'));
test('sum skips null, rejects fractions', () => { assert.equal(sumPaise([null, 5, undefined]), 5n); assert.throws(() => sumPaise([1.5])); });
test('sum of 1,00,000 × 0.01 = 1,000.00 to the paisa', () => assert.equal(formatPaise(sumPaise(new Array(100000).fill(1))), '1,000.00'));
test('sum at the cap stays exact past 2^53', () => assert.equal(sumPaise([MAX_PAISE, MAX_PAISE, MAX_PAISE, MAX_PAISE, MAX_PAISE, MAX_PAISE, MAX_PAISE, MAX_PAISE, MAX_PAISE, MAX_PAISE]), 10n ** 16n));
test('plain export: 123456 → 1234.56; 5 → 0.05', () => { assert.equal(paiseToPlain(123456), '1234.56'); assert.equal(paiseToPlain(5), '0.05'); });
test('round trip format → parse for edge amounts', () => { for (const p of [0, 1, 99, 100, 12345678, MAX_PAISE]) assert.equal(ok(formatPaise(p)), p); });
test('units: 1,048,576 bytes = 1 MiB; 5.5 h = 19,800,000 ms; 1 day = 86,400,000 ms', () => { assert.equal(bytesToMib(1048576), 1); assert.equal(IST_OFFSET_MS, 19800000); assert.equal(MS_PER_DAY, 86400000); });
test('formatBytes: 512 → 512 B; 2048 → 2.0 KB; 3,145,728 → 3.0 MB', () => { assert.equal(formatBytes(512), '512 B'); assert.equal(formatBytes(2048), '2.0 KB'); assert.equal(formatBytes(3145728), '3.0 MB'); });
