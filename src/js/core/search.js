import { categoryLabel, secretKeysOf } from './schema.js';

const collator = new Intl.Collator('en-IN', { sensitivity: 'base', numeric: true });

/** Text a search can match. Secrets stay out, so nothing reveals a password by matching it. */
export function haystackOf(item, custom = []) {
  const secrets = new Set(secretKeysOf(item.t));
  const parts = [item.title, categoryLabel(item.c, custom), item.notes ?? '', ...(item.tags ?? [])];
  for (const [k, v] of Object.entries(item.f ?? {})) if (!secrets.has(k)) parts.push(v);
  return parts.join('\n').toLowerCase();
}

/** Secondary order shared by every sort: then by date (newest first), then name, then id. */
function tieBreak(a, b) {
  const da = a.doc || '';
  const db = b.doc || '';
  if (da !== db) return da < db ? 1 : -1;
  const byName = collator.compare(a.title, b.title);
  if (byName !== 0) return byName;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

const PRIMARY = {
  updated: (a, b) => b.u - a.u,
  title: (a, b) => collator.compare(a.title, b.title),
  date: (a, b) => (a.doc === b.doc ? 0 : (a.doc || '') < (b.doc || '') ? 1 : -1),
  // Items with no expiry sort last whatever the direction, because they need no action.
  expiry: (a, b) => (a.exp === b.exp ? 0 : !a.exp ? 1 : !b.exp ? -1 : a.exp < b.exp ? -1 : 1),
  category: (a, b) => collator.compare(a.c, b.c),
};

export function sortItems(items, key = 'updated') {
  const primary = PRIMARY[key] ?? PRIMARY.updated;
  // Array.prototype.sort is stable; tieBreak makes the order total as well, so every
  // device shows the same list. Time O(n log n), memory O(n).
  return [...items].sort((a, b) => primary(a, b) || tieBreak(a, b));
}

/**
 * Filter then sort. Time O(n·t + m log m) for n items, t search words, m matches; memory O(n).
 * `hay` is an id→text Map built once per data change, so typing never rebuilds it.
 */
export function queryItems(items, hay, { q = '', cat = '', view = 'all', sort = 'updated' } = {}) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = items.filter((it) => {
    if (view === 'trash') { if (it.trash === undefined) return false; } else if (it.trash !== undefined) return false;
    if (view === 'favourites' && it.fav !== 1) return false;
    if (cat && it.c !== cat) return false;
    if (words.length === 0) return true;
    const text = hay.get(it.id) ?? '';
    return words.every((w) => text.includes(w));
  });
  return sortItems(hits, sort);
}
