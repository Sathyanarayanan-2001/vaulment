# Performance

Measured by `npm run perf` in Chromium, in a Linux container, at 5,000 items and 500 files. "Before" is the same code with the optimisation switched off. CPU slowdown is emulated. No physical phone was available.

Latest figures: [perf-last.md](perf-last.md).

The slowest ordinary action is unlocking. Most of that is 600,000 rounds of key stretching, which is deliberate, so it was left alone.

| Optimisation | Why |
|---|---|
| Draw 100 rows, with Show more | By far the biggest gain; the page stays quick however large the vault |
| Key listing instead of one read per file | This runs on every pull |
| Index of files by item | Replaces a scan per lookup |
| Decrypt in batches of 200 | Small gain, about 10% or less; kept because it adds no complexity |

## First load

Lighthouse mobile profile: see [verification-last.md](verification-last.md). Second method: `npm run perf` loads the real page in throttled Chromium and times the visible heading.
