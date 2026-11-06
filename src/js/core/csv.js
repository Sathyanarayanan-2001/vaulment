// RFC 4180 reading and writing, plus the two spreadsheet traps:
// Excel rewrites long digit strings as 6.27E+11 (and the digits are gone for good), and
// runs any cell that starts with = + - @ as a formula.

export const BOM = '﻿';

const FORMULA_START = /^'*[=+\-@\t\r]/;
const LONG_DIGITS = /^\d{11,}$|^0\d+$/;

/** Make one value safe for a spreadsheet; `unprotectCell` reverses it exactly. */
export function protectCell(value) {
  const s = String(value ?? '');
  // ="…" makes Excel keep every digit, and it stays a constant text expression.
  if (LONG_DIGITS.test(s)) return `="${s}"`;
  if (FORMULA_START.test(s)) return `'${s}`;
  return s;
}

export function unprotectCell(value) {
  const m = /^="(\d+)"$/.exec(value);
  if (m) return m[1];
  if (/^'+[=+\-@\t\r]/.test(value)) return value.slice(1);
  return value;
}

const quote = (cell) => (/[",\r\n]/.test(cell) || /^\s|\s$/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell);

/** UTF-8 with BOM (the caller encodes), CRLF rows, quotes where needed. Time O(total chars). */
export function toCsv(rows) {
  return BOM + rows.map((r) => r.map((c) => quote(protectCell(c))).join(',')).join('\r\n') + '\r\n';
}

function detectDelimiter(firstLines) {
  const counts = { ',': 0, ';': 0, '\t': 0 };
  for (const ch of firstLines) if (ch in counts) counts[ch] += 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

/** Character-by-character parser. Time O(n); handles quotes, doubled quotes and embedded newlines. */
export function parseCsv(text) {
  const src = text.startsWith(BOM) ? text.slice(1) : text;
  const delim = detectDelimiter(src.slice(0, 4096));
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; } else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"' && cell === '') inQuotes = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length > 0) { row.push(cell); rows.push(row); }
  return rows;
}
