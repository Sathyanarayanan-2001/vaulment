import test from 'node:test';
import assert from 'node:assert/strict';
import * as d from '../../src/js/core/dates.js';

const T = '2026-11-05';
const parse = (s, t = T) => d.parseTypedDate(s, t);

test('typed 28/10 in 2026 → 2026-10-28', () => assert.equal(parse('28/10').iso, '2026-10-28'));
test('typed 28/10/26 and 28-10-2026 and 28.10.2026 → 2026-10-28', () => { for (const s of ['28/10/26', '28-10-2026', '28.10.2026', '2026-10-28']) assert.equal(parse(s).iso, '2026-10-28', s); });
test('phone keypad digits: 2810 → 28/10 this year; 28102026 and 281026 → 28/10/2026', () => { assert.equal(parse('2810').iso, '2026-10-28'); assert.equal(parse('28102026').iso, '2026-10-28'); assert.equal(parse('281026').iso, '2026-10-28'); assert.equal(parse('2026').ok, false); });
test('typed 1/2/2027 is 1 February, day first, not 2 January', () => assert.equal(parse('1/2/2027').iso, '2027-02-01'));
test('leap: 29/02/2028 valid; 29/02/2027 refused and names the leap year', () => {
  assert.equal(parse('29/02/2028').iso, '2028-02-29');
  const r = parse('29/02/2027'); assert.equal(r.ok, false); assert.match(r.error, /not a leap year/);
});
test('century rules: 1900 is not leap, 2000 is, 2100 is not', () => { assert.equal(d.isLeapYear(1900), false); assert.equal(d.isLeapYear(2000), true); assert.equal(d.isLeapYear(2100), false); });
test('month ends: 31/04 refused; 30/04 accepted; 31/12 accepted', () => { assert.equal(parse('31/04/2026').ok, false); assert.equal(parse('30/04/2026').ok, true); assert.equal(parse('31/12/2026').ok, true); });
test('refused: 32/01, 01/13, 00/01, abc, empty, ISO 2026-02-30', () => { for (const s of ['32/01/2026', '01/13/2026', '00/01/2026', 'abc', '', '2026-02-30']) assert.equal(parse(s).ok, false, s); });
test('format: 2026-10-28 → 28/10/2026', () => assert.equal(d.formatDate('2026-10-28'), '28/10/2026'));

test('midnight IST: 18:29:59.999 UTC is still 05/11; 18:30:00.000 UTC is 06/11', () => {
  assert.equal(d.todayIst(Date.UTC(2026, 10, 5, 18, 29, 59, 999)), '2026-11-05');
  assert.equal(d.todayIst(Date.UTC(2026, 10, 5, 18, 30, 0, 0)), '2026-11-06');
});
test('month end crossing at IST midnight: 31/01 → 01/02', () => {
  assert.equal(d.todayIst(Date.UTC(2027, 0, 31, 18, 29)), '2027-01-31');
  assert.equal(d.todayIst(Date.UTC(2027, 0, 31, 18, 30)), '2027-02-01');
});
test('leap crossing: 28/02/2028 → 29/02/2028 → 01/03/2028', () => {
  assert.equal(d.todayIst(Date.UTC(2028, 1, 28, 18, 30)), '2028-02-29');
  assert.equal(d.todayIst(Date.UTC(2028, 1, 29, 18, 30)), '2028-03-01');
});
test('year end crossing: 31/12 18:30 UTC is 01/01 next year', () => assert.equal(d.todayIst(Date.UTC(2026, 11, 31, 18, 30)), '2027-01-01'));
test('24-hour display: 2026-10-28 08:35 UTC = 28/10/2026 14:05 IST', () => assert.equal(d.formatDateTime(Date.UTC(2026, 9, 28, 8, 35)), '28/10/2026 14:05'));
test('24-hour display crosses midnight: 20:00 UTC = next day 01:30', () => assert.equal(d.formatDateTime(Date.UTC(2026, 9, 28, 20, 0)), '29/10/2026 01:30'));

test('ISO week: 2026-11-05 Thursday → CW45', () => assert.equal(d.isoWeek('2026-11-05').label, 'CW45'));
test('ISO week 53: 2026-12-31 Thu and 2027-01-03 Sun → week 53 of 2026', () => {
  assert.deepEqual(d.isoWeek('2026-12-31'), { year: 2026, week: 53, label: 'CW53' });
  assert.deepEqual(d.isoWeek('2027-01-03'), { year: 2026, week: 53, label: 'CW53' });
});
test('ISO week: 2027-01-04 Monday → CW01 of 2027', () => assert.deepEqual(d.isoWeek('2027-01-04'), { year: 2027, week: 1, label: 'CW01' }));
test('ISO week 53 in 2020: 2020-12-31 → 53; 2021-01-01 → 53 of 2020', () => { assert.equal(d.isoWeek('2020-12-31').week, 53); assert.deepEqual(d.isoWeek('2021-01-01'), { year: 2020, week: 53, label: 'CW53' }); });
test('ISO week: 2024-12-30 Monday belongs to CW01 of 2025', () => assert.deepEqual(d.isoWeek('2024-12-30'), { year: 2025, week: 1, label: 'CW01' }));
test('ISO week: Sunday stays with its Monday: 2026-11-08 → CW45, 2026-11-09 → CW46', () => { assert.equal(d.isoWeek('2026-11-08').week, 45); assert.equal(d.isoWeek('2026-11-09').week, 46); });
test('ISO weeks across a span agree with an independent weekday walk', () => {
  // Second method: count Thursdays from 1 January rather than using the formula.
  for (let day = d.isoToDayNumber('2015-01-01'); day < d.isoToDayNumber('2035-01-01'); day++) {
    const iso = d.dayNumberToIso(day);
    const js = new Date(`${iso}T00:00:00Z`); const wd = (js.getUTCDay() + 6) % 7;
    const thu = new Date(js.getTime() + (3 - wd) * 86400000);
    const y = thu.getUTCFullYear();
    let count = 0; for (let t = Date.UTC(y, 0, 1); t <= thu.getTime(); t += 86400000) if (new Date(t).getUTCDay() === 4) count++;
    assert.deepEqual([d.isoWeek(iso).year, d.isoWeek(iso).week], [y, count], iso);
  }
});

test('FY boundary: 31/03/2027 → FY 2026-27; 01/04/2027 → FY 2027-28', () => { assert.equal(d.financialYear('2027-03-31').label, 'FY 2026-27'); assert.equal(d.financialYear('2027-04-01').label, 'FY 2027-28'); });
test('FY: 2026-04-01 → FY 2026-27; 2026-01-15 → FY 2025-26', () => { assert.equal(d.financialYear('2026-04-01').label, 'FY 2026-27'); assert.equal(d.financialYear('2026-01-15').label, 'FY 2025-26'); });
test('FY century: 2099-06-01 → FY 2099-00; 1999-05-01 → FY 1999-00', () => { assert.equal(d.financialYear('2099-06-01').label, 'FY 2099-00'); assert.equal(d.financialYear('1999-05-01').label, 'FY 1999-00'); });
test('Derived period for 28/10/2026 → Oct 2026, CW44, FY 2026-27', () => assert.deepEqual(d.periodOf('2026-10-28'), { month: 'Oct 2026', week: 'CW44', fy: 'FY 2026-27' }));
test('Twelve months ending Nov 2026 start at Dec 2025', () => { const m = d.lastTwelveMonths('2026-11-05'); assert.equal(m.length, 12); assert.equal(m[0], '2025-12'); assert.equal(m[11], '2026-11'); });
test('daysBetween: 28/02/2028 → 01/03/2028 = 2 (leap); 2027 = 1', () => { assert.equal(d.daysBetween('2028-02-28', '2028-03-01'), 2); assert.equal(d.daysBetween('2027-02-28', '2027-03-01'), 1); });
test('isValidIso rejects non-dates', () => { for (const s of ['', null, 'x', '2026-13-01', '2026-00-10', '2026-02-29']) assert.equal(d.isValidIso(s), false); });
