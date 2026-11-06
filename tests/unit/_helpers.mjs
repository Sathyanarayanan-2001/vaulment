// Made-up fixtures only. Nothing here resembles a real person, bank or account.
let n = 0;
export const id = (p = 'r') => `${p}_test${String(++n).padStart(8, '0')}`;
export const item = (over = {}) => ({
  id: id(), k: 'item', c: 'other', t: 'document', title: 'Sample item', f: {}, doc: '', exp: '', amt: null,
  tags: [], notes: '', fav: 0, cr: 1_700_000_000_000, u: 1_700_000_000_000, ...over,
});
/** Small seeded generator, so a failing randomised test can be replayed exactly. */
export function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
