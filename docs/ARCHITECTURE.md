# Architecture

Version 1.0.0, 06/11/2026.

## Shape

A static single page with no framework. `scripts/build.mjs` bundles `src/js/ui/main.js` with esbuild and writes one `dist/index.html` holding all JavaScript, CSS and fonts. Only the files a browser insists on fetching stay separate: `sw.js`, `manifest.webmanifest` and icons.

```text
src/js/core/    pure logic, no browser needed: money, dates, csv, merge, schema, search, stats
src/js/crypto/  WebCrypto wrapper
src/js/store/   vault (encrypted store), idb, savefile, sync
src/js/ui/      DOM helper, pages, charts, gate screens
tests/unit/     Node tests of core, crypto, store, sync
tests/e2e/      real-browser tests through the UI
tests/golden/   five fixed examples
```

## Encryption

```text
master password --PBKDF2-SHA256, 600,000 rounds--> wrapping key ┐
recovery key    --PBKDF2-SHA256, 600,000 rounds--> wrapping key ┼--> wraps the data key (AES-256)
                                                                ┘
data key --AES-256-GCM, random IV, id as additional data--> every record and file
```

- The data key is random and non-extractable once unlocked. Changing the password rewrites the wrapped copy only.
- Each record's id is bound in as additional data, so ciphertext cannot be swapped between records.
- IndexedDB stores `{iv, ct}` per record. Titles, categories and dates are all inside the ciphertext.
- While unlocked, records live decrypted in one `Map`. Lock drops the Map and the key.

## Save file

```text
gzip( JSON { app, format, vaultId, device, session, at, keyring, iv, ct } )
ct = AES-GCM( gzip( JSON { recs, keyring } ) )
```

Encrypted bytes do not compress, so data is gzipped first; the outer gzip recovers what base64 adds. This keeps "one gzip JSON save file" true while OneDrive sees only ciphertext.

Name: `vaulment-save-<vault>-<device>-<UTC stamp>-<session>.json.gz`. The vault tag lets pruning skip other vaults' files without opening them. Attachments go to `blobs/<id>.bin` (IV then ciphertext), so the save file stays small.

## Sync

- Merge per record. Newer `u` wins; on an exact tie the larger canonical JSON text wins. `pickWinner` is a total order, so merge is commutative, associative and idempotent.
- A new edit is stamped `max(now, previous u + 1)`, so a slow clock cannot lose an edit.
- The keyring merges per slot, so a password change and a new recovery key on different devices both survive.
- A hard delete is the tombstone `{d:1, u}`. Trash is an ordinary field on the record.
- Every folder operation runs through one promise chain, so a pull waits for a running write.
- Writes come about 3 seconds after a change and on page hide. Each session rewrites one file. A device keeps its own newest 3 of this vault, always including the live file, and never deletes another device's saves, since that device's newest may not be merged yet.
- A file that cannot be read is skipped, stays unseen, and is retried on the next pull.
- A save from a different vault is left alone and shown as a sync problem.

## Complexity

n = items, m = incoming records, f = save files, t = search words, a = attachments.

| Operation | Time | Memory |
|---|---|---|
| Lookup by id | O(1), `Map` | O(n) |
| Files of one item | O(1) after O(n) rebuild on change, `Map` | O(a) |
| Search | O(n·t) filter, O(k log k) sort of k hits | O(n) |
| Sort | O(n log n), stable with total tie-break | O(n) |
| Merge | O(n + m), `Map` | O(n + m) |
| Pull | O(f·n) | O(n) |
| Write a save | O(n) | O(n) |
| Duplicate check on import | O(r) for r rows, `Set` of fingerprints | O(n + r) |
| Password reuse check | O(n), `Map` keyed by password | O(n) |
| CSV parse and write | O(characters) | O(characters) |
| Dashboard | O(n + a) | O(n) |

All are O(n log n) or better. The exception is one pull across f files, which is bounded because each device keeps 3 files.

## Unit conversions

All live in `src/js/core/units.js` and `money.js`:

| From | To | Rule |
|---|---|---|
| Rupees | Paise | multiply by 100, using string digits, never floats |
| Bytes | MB | divide by 1,048,576 |
| Bytes | KB | divide by 1,024 |
| Days | ms | multiply by 86,400,000 |
| UTC | IST | add 19,800,000 ms (5 h 30 min) |

## Dates and money

Dates are `YYYY-MM-DD` strings, so no device can shift them across a time zone. Week, month and financial year are always derived. Money is whole paise; totals are summed as `BigInt`.

## Injection defence

Pages are built with `h()`, which only makes text nodes and checked attributes. The CSP adds Trusted Types, which makes `innerHTML` throw, and hashes for the one inline script and style. `connect-src 'none'` stops the page making network requests. The route hash, save files and CSV rows all pass validation first.
