# Verification

Counts come from `npm run verify`, written to [verification-last.md](verification-last.md). Nothing here is from memory.

| Round | Method | Covers |
|---|---|---|
| Function 1 | Unit tests in Node, with hand-worked expected values | Formulas, dates, merge laws, crypto, sync, CSV, repository rules |
| Function 2 | Real Chromium through the screen | Every page and button, files, two-laptop sync, offline, round trips |
| Appearance 1 | Measured: overflow, target size, axe-core, contrast by direct calculation | 320, 360 and 390 px; light and dark |
| Appearance 2 | Screenshots read by eye | Phone and desktop, light and dark |
| Independent | A separate reviewer who had not seen the work | Security and data safety |
| Usability | Five tasks | First-time use |

## About the usability test

It was run by a separate AI agent standing in for a first-time user, working only from what appeared on screen. **No human took part.** All five tasks passed and it found no blockers. Its four major problems were fixed. A real person may stumble elsewhere; [USER-TEST.md](USER-TEST.md) lists what to try.

## Golden set

Five fixed examples in `tests/golden/examples.json`, each scored for correct, complete and format followed. The app has no AI prompt, so "evaluate every prompt change" is applied as "evaluate every code change".

## Required tests and where they live

| Requirement | File |
|---|---|
| Midnight crossings, month ends, 29 February | `tests/unit/dates.test.mjs` |
| Totals to the paisa | `tests/unit/money.test.mjs`, `tests/e2e/03-data.test.mjs` |
| ISO week 53, 31 March to 1 April | `tests/unit/dates.test.mjs` |
| Two devices adding at once; deletion reaches the other | `tests/unit/sync.test.mjs`, `tests/e2e/04-sync.test.mjs` |
| `merge()` commutative, associative, idempotent on random data | `tests/unit/merge.test.mjs` |
| Reload then airplane mode | `tests/e2e/05-offline-security.test.mjs` |
| 320, 360, 390 px | `tests/e2e/06-phone.test.mjs` |
| Round trip | `tests/e2e/03-data.test.mjs`, `tests/unit/csv.test.mjs` |
| Dashboard against separate numbers | `tests/unit/core.test.mjs`, `tests/e2e/03-data.test.mjs` |
| Characterisation before refactoring | `tests/unit/characterisation.test.mjs` |

## Not verified

See [KNOWN-LIMITS.md](KNOWN-LIMITS.md). In short: real OneDrive, real Android and the native folder picker.

## GitHub Actions

The same checks passed on GitHub before merging pull request #1: 199 unit tests, 87 browser tests, golden set 15/15, and Lighthouse first load of 968 ms at worst. The first run failed one test on timing, which is recorded in [QUALITY.md](QUALITY.md). Deployment to Pages reported success.
