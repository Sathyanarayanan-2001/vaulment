import { IST_OFFSET_MS, MS_PER_DAY } from './units.js';

// Dates are stored as 'YYYY-MM-DD' strings. A date has no time zone, so holding it
// as text stops a device in another zone from shifting it by a day.

const pad2 = (n) => String(n).padStart(2, '0');

export const isLeapYear = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

export function daysInMonth(y, m) {
  return [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}

export const makeIso = (y, m, d) => `${String(y).padStart(4, '0')}-${pad2(m)}-${pad2(d)}`;

export function isValidIso(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '');
  if (!m) return false;
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  return mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo);
}

/** Days since 1970-01-01 for a date string; integer, so differences are whole days. */
export function isoToDayNumber(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / MS_PER_DAY);
}

export const dayNumberToIso = (n) => new Date(n * MS_PER_DAY).toISOString().slice(0, 10);

export const daysBetween = (fromIso, toIso) => isoToDayNumber(toIso) - isoToDayNumber(fromIso);

/** Today in India for a given instant. The date rolls over at 18:30 UTC, not 00:00 UTC. */
export const todayIst = (nowMs) => new Date(nowMs + IST_OFFSET_MS).toISOString().slice(0, 10);

/**
 * Read a day-first typed date. '28/10' takes the year from `todayIso`.
 * Also accepts 28/10/26, 28-10-2026, 28.10.2026 and ISO 2026-10-28 (from imports).
 * @returns {{ok:true, iso:string}|{ok:false, error:string}}
 */
export function parseTypedDate(text, todayIso) {
  const s = String(text ?? '').trim();
  const hint = 'Type the date day first, for example 28/10/2026.';
  if (s === '') return { ok: false, error: `No date entered. ${hint}` };
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return isValidIso(s) ? { ok: true, iso: s } : { ok: false, error: `${s} is not a real date. ${hint}` };
  }
  // Phone number pads often lack a slash, so 2810 and 28102026 are accepted as well.
  const m = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?$/.exec(s) ?? /^(\d{2})(\d{2})(\d{2}|\d{4})?$/.exec(s);
  if (!m) return { ok: false, error: `Could not read "${s}". ${hint}` };
  const day = +m[1];
  const month = +m[2];
  let year = m[3] === undefined ? +todayIso.slice(0, 4) : +m[3];
  if (m[3]?.length === 2) year += 2000;
  if (month < 1 || month > 12) return { ok: false, error: `Month ${month} does not exist. ${hint}` };
  if (day < 1 || day > daysInMonth(year, month)) {
    const leap = month === 2 && day === 29 ? ` ${year} is not a leap year.` : '';
    return { ok: false, error: `${pad2(day)}/${pad2(month)}/${year} is not a real date.${leap} ${hint}` };
  }
  return { ok: true, iso: makeIso(year, month, day) };
}

export function formatDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

/** 28/10/2026 14:05 in India time, always 24-hour. */
export function formatDateTime(ms) {
  const t = new Date(ms + IST_OFFSET_MS).toISOString();
  return `${formatDate(t.slice(0, 10))} ${t.slice(11, 16)}`;
}

/** ISO week (Monday to Sunday). The week belongs to the year holding its Thursday. */
export function isoWeek(iso) {
  const day = isoToDayNumber(iso);
  // 1970-01-01 was a Thursday, so (day + 3) mod 7 gives 0 for Monday … 6 for Sunday.
  const weekday = ((day + 3) % 7 + 7) % 7;
  const thursday = day - weekday + 3;
  const year = +dayNumberToIso(thursday).slice(0, 4);
  const week = Math.floor((thursday - isoToDayNumber(makeIso(year, 1, 1))) / 7) + 1;
  return { year, week, label: `CW${pad2(week)}` };
}

/** Indian financial year: 1 April to 31 March, labelled FY 2026-27. */
export function financialYear(iso) {
  const y = +iso.slice(0, 4);
  const m = +iso.slice(5, 7);
  const start = m >= 4 ? y : y - 1;
  return { start, label: `FY ${start}-${pad2((start + 1) % 100)}` };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function monthOf(iso) {
  const y = iso.slice(0, 4);
  const m = +iso.slice(5, 7);
  return { key: iso.slice(0, 7), label: `${MONTHS[m - 1]} ${y}` };
}

/** Everything derived from a date; none of these is ever typed in. */
export function periodOf(iso) {
  return { month: monthOf(iso).label, week: isoWeek(iso).label, fy: financialYear(iso).label };
}

/** The twelve month keys ending at `iso`, oldest first. */
export function lastTwelveMonths(iso) {
  let y = +iso.slice(0, 4);
  let m = +iso.slice(5, 7);
  const out = [];
  for (let i = 0; i < 12; i++) {
    out.unshift(`${y}-${pad2(m)}`);
    m -= 1;
    if (m === 0) { m = 12; y -= 1; }
  }
  return out;
}

export const monthKeyLabel = (key) => monthOf(`${key}-01`).label;
