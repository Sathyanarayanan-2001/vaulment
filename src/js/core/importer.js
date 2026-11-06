import { CATEGORIES, CATEGORY_BY_ID, TEMPLATE_BY_ID, TEMPLATES, ID_PATTERN, categoryLabel, validateItem } from './schema.js';
import { parseCsv, toCsv, unprotectCell } from './csv.js';
import { parseTypedDate, formatDate } from './dates.js';
import { parseRupees, paiseToPlain } from './money.js';

export const COLUMNS = {
  id: ['id', 'record id'],
  title: ['title', 'name', 'item', 'account', 'account name', 'description', 'document', 'site'],
  category: ['category', 'group', 'folder'],
  type: ['type', 'item type', 'template'],
  institution: ['institution', 'bank', 'issuer', 'insurer', 'company', 'provider', 'employer'],
  user: ['username', 'user name', 'user', 'user id', 'login', 'login id', 'email', 'login_username'],
  pass: ['password', 'pass', 'login_password', 'secret'],
  number: ['number', 'account number', 'account no', 'a/c no', 'card number', 'policy number', 'reference', 'reference number', 'ref no', 'id number', 'document number'],
  url: ['url', 'website', 'web site', 'link', 'login_uri', 'address'],
  doc: ['document date', 'date', 'issue date', 'purchase date', 'start date'],
  exp: ['expiry date', 'expiry', 'expires', 'valid until', 'renewal date', 'due date'],
  amount: ['amount', 'amount (inr)', 'amount inr', 'value', 'sum insured', 'price', 'rupees'],
  tags: ['tags', 'labels'],
  notes: ['notes', 'note', 'comment', 'comments', 'remarks'],
  favourite: ['favourite', 'favorite', 'starred'],
  extra: ['other fields'],
};

const ALIAS_TO_COLUMN = new Map(Object.entries(COLUMNS).flatMap(([col, names]) => names.map((n) => [n, col])));
const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/** The header is the first row (of the first 25) naming two known columns; lines above it are preamble. */
export function findHeaderRow(rows) {
  const limit = Math.min(rows.length, 25);
  for (let i = 0; i < limit; i++) {
    const seen = new Set(rows[i].map((c) => ALIAS_TO_COLUMN.get(norm(c))).filter(Boolean));
    if (seen.size >= 2) return i;
  }
  return -1;
}

export function mapColumns(header) {
  const map = {};
  const unknown = [];
  header.forEach((name, i) => {
    const col = ALIAS_TO_COLUMN.get(norm(name));
    if (col && map[col] === undefined) map[col] = i;
    else if (String(name).trim() !== '') unknown.push(String(name).trim());
  });
  return { map, unknown };
}

/** Same thing on two rows, or one row and the vault. Lookups run on a Set in O(1). */
export function fingerprint(rec) {
  const f = rec.f ?? {};
  return [rec.t, rec.title.trim().toLowerCase(), f.user ?? '', f.number ?? '', f.url ?? ''].join('\u001f');
}

const LOST_DIGITS = /^\d+(\.\d+)?[eE]\+?\d+$/;

function resolveCategory(text, customCats) {
  const n = norm(text);
  if (!n) return null;
  const byLabel = CATEGORIES.find((c) => norm(c.label) === n || c.id === n) ?? customCats.find((c) => norm(c.label) === n);
  return byLabel?.id ?? null;
}

function resolveTemplate(text) {
  const n = norm(text);
  if (!n) return null;
  return TEMPLATE_BY_ID[n]?.id ?? TEMPLATES.find((t) => norm(t.label) === n)?.id ?? null;
}

/**
 * Turn CSV text into a preview. Nothing is saved here; the Import button commits `rows`.
 * Time O(r + c) for r rows and c characters, because duplicates use a Set of fingerprints.
 * @param {(n:number)=>string} newId supplies an id per row
 */
export function planImport(text, { existing = [], usedIds = null, customCats = [], todayIso, nowMs, newId }) {
  const table = parseCsv(text);
  const headerAt = findHeaderRow(table);
  if (headerAt < 0) {
    return { ok: false, error: 'No header row found. The file needs a row naming at least two columns, such as Title and Password.' };
  }
  const { map, unknown } = mapColumns(table[headerAt]);
  if (map.title === undefined) {
    return { ok: false, error: 'No title column found. Name one column Title or Name, then try again.' };
  }
  const seen = new Set(existing.map(fingerprint));
  const seenIds = new Set(usedIds ?? existing.map((r) => r.id));
  const cell = (row, col) => (map[col] === undefined ? '' : unprotectCell(String(row[map[col]] ?? '')).trim());
  const rows = [];

  for (let i = headerAt + 1; i < table.length; i++) {
    const raw = table[i];
    if (raw.every((c) => String(c).trim() === '')) continue;
    const line = i + 1;
    const problems = [];
    const warnings = [];

    const typeText = cell(raw, 'type');
    let t = resolveTemplate(typeText);
    if (typeText && !t) warnings.push(`Type "${typeText}" is not known, so it was read as a document.`);
    if (!t) t = cell(raw, 'pass') || cell(raw, 'url') ? 'login' : 'document';

    const catText = cell(raw, 'category');
    let c = resolveCategory(catText, customCats);
    if (catText && !c) warnings.push(`Category "${catText}" is not known, so it uses the default for this type.`);
    if (!c) c = TEMPLATE_BY_ID[t].cat;

    const f = {};
    for (const key of ['institution', 'user', 'pass', 'number', 'url']) {
      const v = cell(raw, key);
      if (v) f[key] = v;
    }
    if (f.number && LOST_DIGITS.test(f.number)) {
      warnings.push(`Number "${f.number}" looks shortened by Excel; the lost digits cannot be recovered. Check the original.`);
    }
    const extraText = cell(raw, 'extra');
    if (extraText) {
      try {
        const extra = JSON.parse(extraText);
        if (extra === null || typeof extra !== 'object' || Array.isArray(extra)) throw new Error('not an object');
        Object.assign(f, extra);
      } catch {
        problems.push('The Other fields column is not valid JSON. Export again or clear that cell.');
      }
    }

    let doc = '';
    const docText = cell(raw, 'doc');
    if (docText) {
      const r = parseTypedDate(docText, todayIso);
      if (r.ok) doc = r.iso; else problems.push(`Document date: ${r.error}`);
    }
    let exp = '';
    const expText = cell(raw, 'exp');
    if (expText) {
      const r = parseTypedDate(expText, todayIso);
      if (r.ok) exp = r.iso; else problems.push(`Expiry date: ${r.error}`);
    }
    let amt = null;
    const amtText = cell(raw, 'amount');
    if (amtText) {
      const r = parseRupees(amtText);
      if (r.ok) amt = r.paise; else problems.push(`Amount: ${r.error}`);
    }

    const idText = cell(raw, 'id');
    // Only an item id may be reused. A cell could otherwise name the settings record, or a
    // tombstone or file, and replace it.
    const id = ID_PATTERN.test(idText) && idText.startsWith('r_') && !seenIds.has(idText) ? idText : newId(i);
    const rec = {
      id, k: 'item', c, t,
      title: cell(raw, 'title'),
      f, doc, exp, amt,
      tags: cell(raw, 'tags').split(/[;|]/).map((s) => s.trim()).filter(Boolean),
      notes: cell(raw, 'notes'),
      fav: /^(1|yes|true|y)$/i.test(cell(raw, 'favourite')) ? 1 : 0,
      cr: nowMs, u: nowMs,
    };
    if (rec.title === '') problems.push('This row has no title. Fill in the title cell.');
    else problems.push(...validateItem(rec, new Set(customCats.map((x) => x.id))));

    const key = rec.title ? fingerprint(rec) : null;
    let status;
    if (problems.length > 0) status = 'error';
    else if (seen.has(key)) status = 'duplicate';
    else status = warnings.length > 0 ? 'warning' : 'ready';
    if (status === 'ready' || status === 'warning') { seen.add(key); seenIds.add(id); }
    rows.push({ line, status, messages: status === 'duplicate' ? ['Already in the vault, so it will be skipped.'] : [...problems, ...warnings], rec });
  }

  const count = (s) => rows.filter((r) => r.status === s).length;
  return {
    ok: true, headerLine: headerAt + 1, unknown, rows,
    summary: { total: rows.length, ready: count('ready'), warning: count('warning'), duplicate: count('duplicate'), error: count('error') },
  };
}

export const importable = (plan) => plan.rows.filter((r) => r.status === 'ready' || r.status === 'warning').map((r) => r.rec);

const EXPORT_HEADER = ['Id', 'Title', 'Category', 'Type', 'Institution', 'Username', 'Password', 'Number', 'Website', 'Document date', 'Expiry date', 'Amount (INR)', 'Tags', 'Notes', 'Favourite', 'Other fields'];
const FLAT = new Set(['institution', 'user', 'pass', 'number', 'url']);

/** One row per live item. Attachments are files, so only the encrypted backup carries them. */
export function exportCsv(items, customCats = []) {
  const rows = [EXPORT_HEADER];
  for (const it of items) {
    if (it.trash !== undefined) continue;
    const other = Object.fromEntries(Object.entries(it.f).filter(([k]) => !FLAT.has(k)));
    rows.push([
      it.id, it.title, categoryLabel(it.c, customCats), TEMPLATE_BY_ID[it.t].label,
      it.f.institution ?? '', it.f.user ?? '', it.f.pass ?? '', it.f.number ?? '', it.f.url ?? '',
      it.doc ? formatDate(it.doc) : '', it.exp ? formatDate(it.exp) : '',
      typeof it.amt === 'number' ? paiseToPlain(it.amt) : '',
      (it.tags ?? []).join('; '), it.notes ?? '', it.fav === 1 ? 'yes' : '',
      Object.keys(other).length > 0 ? JSON.stringify(other) : '',
    ]);
  }
  return toCsv(rows);
}

export { CATEGORY_BY_ID };
