// One command that reruns everything and writes the counts to docs/verification-last.md,
// so a reported number always comes from a run, never from memory.
import { spawnSync } from 'node:child_process';
import { readdirSync, writeFileSync } from 'node:fs';

const run = (label, cmd, args) => {
  const started = Date.now();
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 28 });
  const out = `${r.stdout}\n${r.stderr}`;
  const num = (k) => Number(new RegExp(`^# ${k} (\\d+)`, 'm').exec(out)?.[1] ?? 0);
  const res = { label, ok: r.status === 0, tests: num('tests'), pass: num('pass'), fail: num('fail'), seconds: Math.round((Date.now() - started) / 1000), out };
  console.log(`${res.ok ? 'PASS' : 'FAIL'} ${label}${res.tests ? ` (${res.pass}/${res.tests})` : ''} ${res.seconds}s`);
  if (!res.ok) console.log(out.split('\n').filter((l) => /^not ok|error:|Error/.test(l)).slice(0, 20).join('\n'));
  return res;
};

const e2e = readdirSync('tests/e2e').filter((f) => f.endsWith('.test.mjs')).map((f) => `tests/e2e/${f}`);
const appearance = e2e.filter((f) => f.includes('06-phone'));
const behaviour = e2e.filter((f) => !f.includes('06-phone'));
const results = [
  run('Build', 'node', ['scripts/build.mjs']),
  run('Privacy check', 'node', ['scripts/check-privacy.mjs']),
  run('Function round 1: unit tests in Node', 'node', ['--test', '--test-reporter=tap', 'tests/unit/*.test.mjs']),
  run('Golden set', 'node', ['scripts/golden.mjs']),
  run('Function round 2: real browser through the UI', 'node', ['--test', '--test-reporter=tap', '--test-concurrency=1', ...behaviour]),
  run('Appearance round 1: measured layout, targets, contrast, axe', 'node', ['--test', '--test-reporter=tap', '--test-concurrency=1', ...appearance]),
  run('Lighthouse, mobile profile', 'node', ['scripts/lighthouse.mjs']),
];
const golden = /Golden score: (\d+\/\d+)/.exec(results[3].out)?.[1];
const lh = /Worst first contentful paint.*/.exec(results[6].out)?.[0];
const lines = ['| Check | Result | Passed | Total |', '|---|---|---:|---:|', ...results.map((r) => `| ${r.label} | ${r.ok ? 'pass' : 'FAIL'} | ${r.tests ? r.pass : ''} | ${r.tests || ''} |`), '', `Golden score: ${golden}.`, `${lh}.`];
writeFileSync('docs/verification-last.md', `${lines.join('\n')}\n`);
if (results.some((r) => !r.ok)) process.exit(1);
