import { secretKeysOf } from './schema.js';
import { MS_PER_DAY } from './units.js';

const SETS = {
  lower: 'abcdefghijkmnpqrstuvwxyz',
  upper: 'ABCDEFGHJKLMNPQRSTUVWXYZ',
  digits: '23456789',
  symbols: '!#$%&*+-=?@_',
};

/**
 * A uniform random index below `limit`. Plain `byte % limit` favours low values, so bytes
 * above the largest multiple of limit are thrown away and redrawn.
 */
export function randomBelow(limit, getRandomValues) {
  const ceiling = Math.floor(0x100000000 / limit) * limit;
  const buf = new Uint32Array(1);
  for (;;) {
    getRandomValues(buf);
    if (buf[0] < ceiling) return buf[0] % limit;
  }
}

export function generatePassword({ length = 20, lower = true, upper = true, digits = true, symbols = true } = {}, getRandomValues = (b) => crypto.getRandomValues(b)) {
  const groups = [lower && SETS.lower, upper && SETS.upper, digits && SETS.digits, symbols && SETS.symbols].filter(Boolean);
  if (groups.length === 0) throw new RangeError('Pick at least one set of characters.');
  if (length < groups.length || length > 128) throw new RangeError('Length is out of range.');
  const all = groups.join('');
  const out = groups.map((g) => g[randomBelow(g.length, getRandomValues)]);
  while (out.length < length) out.push(all[randomBelow(all.length, getRandomValues)]);
  for (let i = out.length - 1; i > 0; i--) { // Fisher-Yates, so the required characters do not sit first.
    const j = randomBelow(i + 1, getRandomValues);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.join('');
}

const COMMON = new Set(['password', 'password1', 'password123', '123456', '12345678', '123456789', '1234567890', 'qwerty', 'qwerty123', 'abc123', 'admin', 'admin123', 'welcome', 'welcome1', 'india123', 'iloveyou', 'letmein', '111111', '000000']);

/** Rough strength in bits: length × log2(character pool), with penalties for patterns. */
export function passwordBits(pw) {
  if (!pw) return 0;
  if (COMMON.has(pw.toLowerCase())) return 0;
  let pool = 0;
  if (/[a-z]/.test(pw)) pool += 26;
  if (/[A-Z]/.test(pw)) pool += 26;
  if (/[0-9]/.test(pw)) pool += 10;
  if (/[^a-zA-Z0-9]/.test(pw)) pool += 33;
  const unique = new Set(pw).size;
  // A repeated character adds little, so count at most twice each distinct character.
  const effective = Math.min(pw.length, unique * 2);
  return Math.round(effective * Math.log2(pool));
}

export function strengthLabel(bits) {
  if (bits < 40) return 'weak';
  if (bits < 70) return 'fair';
  return 'strong';
}

/** The password held by an item, if its template has one in `pass`. */
const passwordOf = (item) => (secretKeysOf(item.t).includes('pass') ? item.f.pass ?? '' : '');

/**
 * Password health. Time O(n), memory O(n): reuse is found with a hash map keyed by the
 * password rather than comparing every pair of items.
 */
export function passwordReport(items, nowMs, maxAgeDays = 365) {
  const live = items.filter((i) => i.trash === undefined && passwordOf(i));
  const byPassword = new Map();
  for (const it of live) {
    const pw = passwordOf(it);
    if (!byPassword.has(pw)) byPassword.set(pw, []);
    byPassword.get(pw).push(it);
  }
  const weak = [];
  const old = [];
  const reused = [];
  for (const it of live) {
    if (strengthLabel(passwordBits(passwordOf(it))) === 'weak') weak.push(it);
    if (nowMs - (it.pwu ?? it.cr) > maxAgeDays * MS_PER_DAY) old.push(it);
  }
  for (const group of byPassword.values()) if (group.length > 1) reused.push(...group);
  return { checked: live.length, weak, old, reused };
}
