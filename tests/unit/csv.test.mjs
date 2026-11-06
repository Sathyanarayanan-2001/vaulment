import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, toCsv, protectCell, unprotectCell, BOM } from '../../src/js/core/csv.js';
import { planImport, exportCsv, findHeaderRow, importable } from '../../src/js/core/importer.js';
import { item } from './_helpers.mjs';

const OPT = () => { let n = 0; return { existing: [], customCats: [], todayIso: '2026-11-05', nowMs: 1_800_000_000_000, newId: () => `r_import${String(++n).padStart(6, '0')}` }; };

test('CSV starts with a UTF-8 byte order mark and ends rows with CRLF', () => { const s = toCsv([['a', 'b']]); assert.equal(s[0], BOM); assert.equal(s.slice(1), 'a,b\r\n'); });
test('fields with comma, quote or newline are quoted; quotes doubled', () => assert.equal(toCsv([['a,b', 'say "hi"', 'x\ny']]).slice(1), '"a,b","say ""hi""","x\ny"\r\n'));
test('parser: quoted comma, doubled quote, embedded newline', () => assert.deepEqual(parseCsv('"a,b","say ""hi""","x\ny"\r\n1,2,3\r\n'), [['a,b', 'say "hi"', 'x\ny'], ['1', '2', '3']]));
test('parser: strips BOM; handles LF, CR and no final newline', () => assert.deepEqual(parseCsv(`${BOM}a,b\nc,d\re,f`), [['a', 'b'], ['c', 'd'], ['e', 'f']]));
test('parser: semicolon and tab files', () => { assert.deepEqual(parseCsv('a;b\n1;2'), [['a', 'b'], ['1', '2']]); assert.deepEqual(parseCsv('a\tb\n1\t2'), [['a', 'b'], ['1', '2']]); });
test('long number stays text: 627123456789 → ="627123456789" and back', () => { assert.equal(protectCell('627123456789'), '="627123456789"'); assert.equal(unprotectCell('="627123456789"'), '627123456789'); });
test('leading zero stays: 00123 → protected and back', () => assert.equal(unprotectCell(protectCell('00123')), '00123'));
test('formula injection: =1+1, +1, -1, @x are neutralised and reversible', () => { for (const s of ['=1+1', '+91', '-x', '@sum', "'=x", "''+y", '="123"']) { assert.equal(protectCell(s)[0], "'", s); assert.equal(unprotectCell(protectCell(s)), s, s); } });
test('ordinary values pass through unchanged', () => { for (const s of ['hello', '1234', "it's", 'a=b']) assert.equal(protectCell(s), s); });

test('header found after preamble lines', () => assert.equal(findHeaderRow([['My export'], ['Generated today', ''], ['Title', 'Password'], ['x', 'y']]), 2));
test('no header: clear message', () => { const p = planImport('just,some\nrandom,cells\n', OPT()); assert.equal(p.ok, false); assert.match(p.error, /header row/i); });
test('no title column: clear message', () => { const p = planImport('Password,Email\na,b\n', OPT()); assert.equal(p.ok, false); assert.match(p.error, /title column/i); });
test('aliases: Chrome password export columns map over', () => {
  const p = planImport('name,url,username,password,note\nSample site,https://example.test,me@example.test,Pw!sample1,hello\n', OPT());
  const r = p.rows[0]; assert.equal(r.status, 'ready'); assert.equal(r.rec.t, 'login'); assert.equal(r.rec.c, 'online');
  assert.equal(r.rec.f.user, 'me@example.test'); assert.equal(r.rec.notes, 'hello');
});
test('preview statuses: ready, warning, duplicate, error, one each', () => {
  const csv = ['Report title line', 'Title,Number,Date,Amount', 'Doc one,111,28/10/2026,1000', 'Doc two,6.27E+11,,', 'Doc one,111,,', 'Doc bad,,31/04/2026,', ',,,'].join('\n');
  const p = planImport(csv, OPT());
  assert.equal(p.headerLine, 2);
  assert.deepEqual(p.rows.map((r) => r.status), ['ready', 'warning', 'duplicate', 'error']);
  assert.deepEqual(p.summary, { total: 4, ready: 1, warning: 1, duplicate: 1, error: 1 });
  assert.equal(p.rows[0].rec.amt, 100000); assert.equal(p.rows[0].rec.doc, '2026-10-28');
  assert.match(p.rows[1].messages[0], /shortened by Excel/);
  assert.equal(importable(p).length, 2);
});
test('existing vault rows are duplicates', () => {
  const opt = OPT(); opt.existing = [item({ title: 'Doc one', f: { number: '111' }, t: 'document' })];
  assert.equal(planImport('Title,Number\nDoc one,111\n', opt).rows[0].status, 'duplicate');
});
test('bad amount and bad JSON each explain themselves', () => {
  const p = planImport('Title,Amount,Other fields\nA,12x,\nB,,{oops\n', OPT());
  assert.match(p.rows[0].messages[0], /Amount/); assert.match(p.rows[1].messages[0], /valid JSON/);
});
test('a CSV Id cannot name settings, a file or a tombstone', () => {
  const opt = OPT(); opt.usedIds = ['c_categories', 'a_somefile0001', 'r_deletedone1'];
  const p = planImport('Id,Title\nc_categories,One\na_somefile0001,Two\nr_deletedone1,Three\nr_freshidgood,Four\n', opt);
  const ids = p.rows.map((r) => r.rec.id);
  assert.ok(ids[0].startsWith('r_import')); assert.ok(ids[1].startsWith('r_import')); assert.ok(ids[2].startsWith('r_import'));
  assert.equal(ids[3], 'r_freshidgood');
});
test('planImport saves nothing: the input list is untouched', () => { const opt = OPT(); const before = opt.existing.length; planImport('Title,Number\nA,1\n', opt); assert.equal(opt.existing.length, before); });
test('script text stays plain data in a title', () => { const p = planImport('Title,Notes\n<img src=x onerror=alert(1)>,n\n', OPT()); assert.equal(p.rows[0].rec.title, '<img src=x onerror=alert(1)>'); });

test('round trip: export then import gives identical items', () => {
  const items = [
    item({ t: 'login', c: 'online', title: 'Sample, "quoted"', f: { url: 'https://example.test', user: 'u', pass: '=pw+1' }, tags: ['a', 'b'], notes: 'line1\nline2', fav: 1 }),
    item({ t: 'bank_account', c: 'banking', title: 'Sample savings', f: { number: '00012345678901234', institution: 'Sample Bank', ifsc: 'SMPL0000001', mpin: '0123' }, doc: '' }),
    item({ t: 'insurance', c: 'office', title: 'Sample policy', doc: '2026-04-01', exp: '2027-03-31', amt: 50000000, f: { kind: 'Health' } }),
  ];
  const plan = planImport(exportCsv(items), OPT());
  assert.equal(plan.summary.ready, 3);
  const out = importable(plan);
  for (const [i, it] of items.entries()) {
    const got = out[i];
    assert.equal(got.id, it.id); assert.equal(got.title, it.title); assert.deepEqual(got.f, it.f); assert.equal(got.amt, it.amt);
    assert.equal(got.doc, it.doc); assert.equal(got.exp, it.exp); assert.deepEqual(got.tags, it.tags); assert.equal(got.notes, it.notes); assert.equal(got.fav, it.fav); assert.equal(got.c, it.c); assert.equal(got.t, it.t);
  }
});
test('export leaves out items in the trash', () => assert.equal(planImport(exportCsv([item({ trash: 5 }), item({ title: 'Kept' })]), OPT()).summary.ready, 1));
