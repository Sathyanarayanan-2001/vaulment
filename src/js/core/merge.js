import { canonicalJson } from './canonical.js';

// Per-record last-writer-wins. pickWinner is a total order on (u, canonical text), and
// taking the maximum of a total order is commutative, associative and idempotent. That
// is what lets devices merge save files in any order and still settle on the same data.

export const isTombstone = (r) => r?.d === 1;

export const makeTombstone = (u) => ({ d: 1, u });

/** Newer update time wins; on an exact tie the larger canonical text wins. */
export function pickWinner(a, b) {
  if (a === undefined) return b;
  if (b === undefined) return a;
  if (a.u !== b.u) return a.u > b.u ? a : b;
  return canonicalJson(a) >= canonicalJson(b) ? a : b;
}

/**
 * Merge two stores into a new Map. Time O(n + m), memory O(n + m): one hash lookup per id.
 * @param {Map<string, object>} a
 * @param {Map<string, object>} b
 */
export function merge(a, b) {
  const out = new Map(a);
  for (const [id, rec] of b) out.set(id, pickWinner(out.get(id), rec));
  return out;
}

/**
 * Merge `incoming` into `local` in place and report which ids changed.
 * Time O(m) for m incoming records.
 * @returns {string[]} ids whose stored record changed
 */
export function mergeInto(local, incoming) {
  const changed = [];
  for (const [id, rec] of incoming) {
    const current = local.get(id);
    const winner = pickWinner(current, rec);
    if (current === undefined || (winner !== current && canonicalJson(winner) !== canonicalJson(current))) {
      local.set(id, winner);
      changed.push(id);
    }
  }
  return changed;
}

/**
 * Stamp for a new edit. It must beat the record's previous stamp even when this
 * device's clock runs behind the device that wrote it, or the edit would silently lose.
 */
export const nextStamp = (previousU, nowMs) => Math.max(nowMs, (previousU ?? 0) + 1);
