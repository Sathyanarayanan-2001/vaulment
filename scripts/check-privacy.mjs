// Fails if anything that looks like personal data or a save file is tracked by git.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const tracked = execSync('git ls-files', { encoding: 'utf8' }).split('\n').filter(Boolean);
const BLOCKED_NAMES = /(^|\/)(vaulment-(save|backup|export|recovery)[^/]*|.*\.(vbak|bak|gz|dump|sqlite|pem|key|p12|pfx|env))$|(^|\/)\.env/i;
const TEXT = /\.(mjs|js|json|md|css|html|yml|yaml|txt|webmanifest)$/;
const SECRET = [
  [/gh[pousr]_[A-Za-z0-9_]{30,}/, 'GitHub token'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'],
  [/AKIA[0-9A-Z]{16}/, 'AWS key'],
  [/\b[A-Z]{5}[0-9]{4}[A-Z]\b/, 'something shaped like a PAN'],
  [/\b[A-Z]{4}0[A-Z0-9]{6}\b/, 'something shaped like an IFSC'],
];
// Made-up fixture values that are allowed because they are obviously fake.
const ALLOWED = new Set(['SMPL0000001']);

const problems = [];
for (const file of tracked) {
  if (BLOCKED_NAMES.test(file)) problems.push(`${file}: file name looks like a save, backup, export or secret`);
  if (!TEXT.test(file) || file === 'package-lock.json') continue;
  const text = readFileSync(file, 'utf8');
  for (const [re, label] of SECRET) {
    const m = re.exec(text);
    if (m && !ALLOWED.has(m[0])) problems.push(`${file}: contains ${label}`);
  }
}
if (problems.length > 0) { console.error(problems.join('\n')); process.exit(1); }
console.log(`Privacy check passed on ${tracked.length} tracked files.`);
