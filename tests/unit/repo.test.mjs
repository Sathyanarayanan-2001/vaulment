import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ignored = (name) => spawnSync('git', ['check-ignore', '-q', '--no-index', name]).status === 0;
const inGit = spawnSync('git', ['rev-parse', '--git-dir']).status === 0;

test('.gitignore blocks save, backup, export and secret files', { skip: !inGit }, () => {
  for (const name of ['vaulment-save-aaaaaaaa-d1-20260101000000000-s1.json.gz', 'vaulment-backup-20261105.json.gz', 'vaulment-export-20261105.csv', 'vaulment-recovery-key.txt', 'my-accounts.csv', 'statement.xlsx', 'old.bak', 'backups/a.txt', '.env', 'server.pem', 'keys.p12']) {
    assert.ok(ignored(name), name);
  }
});
test('.gitignore leaves source files alone', { skip: !inGit }, () => {
  for (const name of ['src/js/ui/main.js', 'README.md', 'tests/golden/examples.json', 'src/icons/icon-192.png', 'package-lock.json']) assert.ok(!ignored(name), name);
});

const walk = (dir) => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
const sources = walk('src').filter((f) => f.endsWith('.js'));

test('no source file writes raw markup or runs strings as code', () => {
  for (const f of sources) {
    const code = readFileSync(f, 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const bad of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'eval(', 'new Function']) assert.ok(!code.includes(bad), `${f}: ${bad}`);
    assert.ok(!/\bfetch\(/.test(code) || f.endsWith('sw.js'), `${f}: only the service worker may call fetch`);
    assert.ok(!/XMLHttpRequest|sendBeacon|WebSocket/.test(code), f);
    assert.ok(!/setAttribute\('style'/.test(code), `${f}: inline style attributes are blocked by CSP`);
    assert.ok(!/console\.(log|info|debug)/.test(code), `${f}: nothing is logged`);
  }
});
test('every dependency is pinned to an exact version, and a lock file exists', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  for (const [n, v] of Object.entries(pkg.devDependencies)) assert.match(v, /^\d+\.\d+\.\d+$/, n);
  assert.equal(Object.keys(pkg.dependencies ?? {}).length, 0, 'the shipped page has no runtime dependencies');
  assert.ok(statSync('package-lock.json').size > 0);
});
test('every Action is pinned to a full commit hash', () => {
  const yml = readFileSync('.github/workflows/ci.yml', 'utf8');
  const uses = [...yml.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]);
  assert.ok(uses.length >= 5);
  for (const u of uses) assert.match(u, /@[0-9a-f]{40}$/, u);
});
test('version, revision history and package agree', async () => {
  const { VERSION, REVISIONS } = await import('../../src/js/core/version.js');
  assert.equal(VERSION, JSON.parse(readFileSync('package.json', 'utf8')).version);
  assert.equal(REVISIONS[0].version, VERSION);
  assert.ok(readFileSync('CHANGELOG.md', 'utf8').includes(`## ${VERSION}`));
});
