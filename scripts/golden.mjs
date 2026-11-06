// Golden set: five fixed examples, scored on three points each (correct, complete, format
// followed). The app has no AI prompt inside it, so "evaluate every prompt change" is applied
// here as "evaluate every code change": this runs in CI and fails on anything under 15/15.
import { readFileSync } from 'node:fs';
import { parseTypedDate, financialYear, isoWeek } from '../src/js/core/dates.js';
import { formatPaise, parseRupees, sumPaise } from '../src/js/core/money.js';
import { merge } from '../src/js/core/merge.js';
import { canonicalJson } from '../src/js/core/canonical.js';
import { planImport } from '../src/js/core/importer.js';

const iso = (s) => parseTypedDate(s, '2026-11-05').iso;
const RUN = {
  period: (x) => x.map((d) => financialYear(iso(d)).label),
  week: (x) => x.map((d) => isoWeek(iso(d)).label),
  total: (x) => [formatPaise(sumPaise(x.map((r) => parseRupees(r).paise)))],
  merge: ({ a, b }) => {
    const ab = merge(new Map(Object.entries(a)), new Map(Object.entries(b)));
    return [canonicalJson(Object.fromEntries([...ab].sort(([p], [q]) => (p < q ? -1 : 1))))];
  },
  import: (text) => {
    let n = 0;
    const p = planImport(text, { todayIso: '2026-11-05', nowMs: 1, newId: () => `r_golden${String(++n).padStart(4, '0')}` });
    const first = p.rows[0].rec;
    return [`ready:${p.summary.ready}`, `duplicate:${p.summary.duplicate}`, `error:${p.summary.error}`, first.f.number, String(first.amt)];
  },
};

const examples = JSON.parse(readFileSync(new URL('../tests/golden/examples.json', import.meta.url)));
let score = 0;
console.log('Example | correct | complete | format | score');
for (const ex of examples) {
  const got = RUN[ex.kind](ex.input);
  const complete = got.length === ex.expected.length && got.every((v) => v !== undefined && v !== '');
  const correct = complete && got.every((v, i) => v === ex.expected[i]);
  const format = got.every((v) => new RegExp(ex.format).test(v));
  const s = Number(correct) + Number(complete) + Number(format);
  score += s;
  console.log(`${ex.name} | ${correct ? 'yes' : 'NO'} | ${complete ? 'yes' : 'NO'} | ${format ? 'yes' : 'NO'} | ${s}/3`);
}
console.log(`Golden score: ${score}/${examples.length * 3}`);
if (score !== examples.length * 3) process.exit(1);
