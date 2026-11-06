import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalJson } from '../../src/js/core/canonical.js';
import { merge, mergeInto, pickWinner, makeTombstone, nextStamp } from '../../src/js/core/merge.js';
import { rng } from './_helpers.mjs';

test('canonical: key order does not matter, at any depth', () => assert.equal(canonicalJson({ b: 1, a: { z: [1, { y: 2, x: 3 }], k: 'v' } }), canonicalJson({ a: { k: 'v', z: [1, { x: 3, y: 2 }] }, b: 1 })));
test('canonical: expected text for {b:1,a:"x"} is {"a":"x","b":1}', () => assert.equal(canonicalJson({ b: 1, a: 'x' }), '{"a":"x","b":1}'));
test('canonical: undefined keys vanish; null stays', () => assert.equal(canonicalJson({ a: undefined, b: null }), '{"b":null}'));
test('newer u wins whichever side it is on', () => { const a = { u: 5 }; const b = { u: 6 }; assert.equal(pickWinner(a, b), b); assert.equal(pickWinner(b, a), b); });
test('tie: larger canonical text wins, both ways round', () => {
  const a = { u: 5, title: 'apple' }; const b = { title: 'zebra', u: 5 };
  assert.equal(pickWinner(a, b), b); assert.equal(pickWinner(b, a), b);
});
test('tie between key orders of the same data stays settled', () => assert.equal(canonicalJson(pickWinner({ a: 1, u: 2 }, { u: 2, a: 1 })), '{"a":1,"u":2}'));
test('tombstone newer than the record wins; record newer than tombstone wins', () => {
  assert.deepEqual(pickWinner({ u: 5, title: 'x' }, makeTombstone(6)), { d: 1, u: 6 });
  assert.equal(pickWinner({ u: 7, title: 'x' }, makeTombstone(6)).title, 'x');
});
test('nextStamp beats the old stamp even when this clock is behind', () => { assert.equal(nextStamp(9000, 100), 9001); assert.equal(nextStamp(100, 9000), 9000); assert.equal(nextStamp(undefined, 5), 5); });
test('mergeInto reports only real changes', () => {
  const local = new Map([['a', { u: 1 }], ['b', { u: 5 }]]);
  const changed = mergeInto(local, new Map([['a', { u: 2 }], ['b', { u: 1 }], ['c', { u: 1 }]]));
  assert.deepEqual(changed.sort(), ['a', 'c']); assert.equal(local.get('b').u, 5);
});
test('mergeInto same data twice changes nothing the second time', () => {
  const inc = new Map([['a', { u: 2, x: 1 }]]); const local = new Map();
  assert.equal(mergeInto(local, inc).length, 1); assert.equal(mergeInto(local, inc).length, 0);
});

// Random stores share ids and clash on u so that tie-breaks and tombstones are really exercised.
function randomStore(r) {
  const m = new Map();
  const n = Math.floor(r() * 30);
  for (let i = 0; i < n; i++) {
    const id = `r_${Math.floor(r() * 40)}`;
    const u = Math.floor(r() * 8);
    m.set(id, r() < 0.25 ? makeTombstone(u) : { u, title: `t${Math.floor(r() * 4)}`, n: Math.floor(r() * 3) });
  }
  return m;
}
const snap = (m) => canonicalJson(Object.fromEntries([...m].sort(([a], [b]) => (a < b ? -1 : 1))));

for (const [name, check] of Object.entries({
  commutative: (a, b) => assert.equal(snap(merge(a, b)), snap(merge(b, a))),
  associative: (a, b, c) => assert.equal(snap(merge(merge(a, b), c)), snap(merge(a, merge(b, c)))),
  idempotent: (a, b) => { const m = merge(a, b); assert.equal(snap(merge(m, m)), snap(m)); assert.equal(snap(merge(m, b)), snap(m)); },
})) {
  test(`merge() is ${name} on 2,000 randomised triples`, () => {
    const r = rng(20261105);
    for (let i = 0; i < 2000; i++) check(randomStore(r), randomStore(r), randomStore(r));
  });
}
test('any merge order of 5 devices settles to the same result (500 shuffles)', () => {
  const r = rng(7);
  for (let i = 0; i < 500; i++) {
    const devices = Array.from({ length: 5 }, () => randomStore(r));
    const forward = devices.reduce(merge, new Map());
    const shuffled = [...devices].sort(() => r() - 0.5).reduce(merge, new Map());
    assert.equal(snap(forward), snap(shuffled));
  }
});
