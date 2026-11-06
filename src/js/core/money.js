import { PAISE_PER_RUPEE } from './units.js';

/** Largest single amount: 10^15 paise = 10^13 rupees (10 lakh crore), safely below
 *  Number.MAX_SAFE_INTEGER (about 9.007 × 10^15), so every stored amount is an exact integer. */
export const MAX_PAISE = 1_000_000_000_000_000;

/**
 * Parse typed rupees into whole paise using string operations only, because
 * Number('1234.56') * 100 gives 123456.00000000001 for many inputs.
 * @returns {{ok:true, paise:number}|{ok:false, error:string}}
 */
export function parseRupees(text) {
  const clean = String(text ?? '').replace(/[₹\s,]/g, '').replace(/^Rs\.?/i, '');
  if (clean === '') return { ok: false, error: 'Enter an amount, for example 1,23,456.78.' };
  if (clean.startsWith('-')) return { ok: false, error: 'Amounts cannot be negative. Remove the minus sign.' };
  const m = /^(\d+)(?:\.(\d*))?$/.exec(clean);
  if (!m) return { ok: false, error: 'Use digits only, for example 1,23,456.78.' };
  const fraction = m[2] ?? '';
  if (fraction.length > 2) return { ok: false, error: 'Use at most two digits after the decimal point.' };
  const paiseBig = BigInt(m[1]) * BigInt(PAISE_PER_RUPEE) + BigInt(fraction.padEnd(2, '0'));
  if (paiseBig > BigInt(MAX_PAISE)) return { ok: false, error: 'That amount is too large to store. Check for extra digits.' };
  return { ok: true, paise: Number(paiseBig) };
}

/** Group an integer digit string the Indian way: last three, then pairs. */
function groupLakh(digits) {
  if (digits.length <= 3) return digits;
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3);
  return rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3;
}

/**
 * Format whole paise as rupees with lakh grouping, e.g. 12345678 → 1,23,456.78.
 * Accepts number or BigInt because totals are summed as BigInt.
 */
export function formatPaise(paise, { symbol = false } = {}) {
  const value = BigInt(paise);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const rupees = (abs / 100n).toString();
  const frac = (abs % 100n).toString().padStart(2, '0');
  return `${negative ? '-' : ''}${symbol ? '₹' : ''}${groupLakh(rupees)}.${frac}`;
}

/** Exact total of whole-paise values. BigInt, so no total can ever drift or overflow. */
export function sumPaise(values) {
  let total = 0n;
  for (const v of values) {
    if (v === null || v === undefined) continue;
    if (!Number.isSafeInteger(v)) throw new TypeError('Money must be held as whole paise');
    total += BigInt(v);
  }
  return total;
}

/** Plain rupee text for an export cell: no grouping, so spreadsheets read it as a number. */
export function paiseToPlain(paise) {
  const value = BigInt(paise);
  return `${value / 100n}.${(value % 100n).toString().padStart(2, '0')}`;
}
