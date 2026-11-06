# Quality record

Version 1.0.0, 06/11/2026. Holds the stage checkpoints, DMAIC, root-cause analysis and FMEA for the first release.

## Stage checkpoints

Each stage moved on only when its exit criteria passed. Counts are the numbers at that moment.

| Stage | Deliverables | Tests run | Unresolved at exit | Exit |
|---|---|---|---|---|
| 1 Plan | File plan, security and sync design, browser facts | GitHub access check: repository cannot be created from this session | Hand-over by zip | Pass |
| 2 Core logic | Money, dates, CSV, schema, merge, search, stats, routes | 119 unit: 118 first, then 119 after correcting one mistaken expected value | None | Pass |
| 3 Storage and sync | WebCrypto vault, IndexedDB, save files, sync engine | 168 unit | Wrong-vault warning found and fixed before exit | Pass |
| 4 Pages and styles | All tabs, charts, quick start, offline, manifest, CSP | 73 browser tests; defects below fixed | None | Pass |
| 5 Import and export | CSV preview, export, backups, round trips | Included in browser suite | None | Pass |
| 6 Documents and CI | Repository files, Actions, this record | actionlint clean; privacy check | Actions cannot run until pushed | Pass with note |
| 7 Second round | Independent review, first-time user, regression, zip | See [VERIFICATION.md](VERIFICATION.md) | Items in [KNOWN-LIMITS.md](KNOWN-LIMITS.md) | Pass with note |

## DMAIC

**Define.** A vault one person can trust for years with bank details and identity papers, across two laptops and a phone. Critical outcomes: nothing readable leaves the device, nothing is silently lost, and first load is under 2 seconds.

**Measure.** Baselines came from the first full test runs: unit and browser pass counts, Lighthouse first paint, and timings at 5,000 items in [PERFORMANCE.md](PERFORMANCE.md).

**Analyse.** Root causes are below. Most serious defects shared one pattern: the design was checked for the normal path between two healthy devices, and the failures sat on recovery paths and on what a *locked* or *new* device can see.

**Improve.** Findings from two independent review passes and four usability problems were fixed, along with defects found by testing. Lists rendered in pages of 100, and lookups moved to maps and sets. Measured results are in PERFORMANCE.md.

**Control.** `npm run verify` reruns everything and writes its counts. CI runs the same checks on every push and pull request and blocks deployment on failure. The golden set must score 15/15. The privacy check fails on anything resembling real data.

## Root causes (5 Whys)

### Recovery key useless on a new device (critical; found by independent review)

1. Why could a valid recovery key not open the vault after losing the laptop? The restore screen accepted only a password.
2. Why? Recovery was written for the unlock screen, which needs a keyring stored locally.
3. Why was the local keyring assumed? Recovery was designed around forgetting a password, not around losing the device too.
4. Why was that not caught? Tests covered each path alone. None combined both losses.
5. Why? Test scenarios came from features rather than from how the data can be lost.

**Fix:** recovery on the restore screen, using the keyring in the save file. **Control:** a unit test and a browser test of exactly this case, and an FMEA line.

### Keyring trusted from outside the ciphertext (high; independent review)

1. Why could a tampered file damage recovery on other devices? A new device stored the outer keyring.
2. Why? That copy was needed to reach the data key, and it was reused after unlocking.
3. Why reused? It was the value already in hand, and an inner copy had not been treated as different.
4. Why not? Unwrapping succeeding was taken as proof of the whole keyring, yet it proves one slot.
5. Why? Authenticated and unauthenticated data sat in one object with no marking.

**Fix:** only the inner copy is stored, and slots merge separately.

### Save tap lost on a phone (found by browser test)

1. Why did Save do nothing? The tap landed on nothing.
2. Why? The button moved between finger down and finger up.
3. Why? Blur brought back the tab bar, which shifted the page.
4. Why did the tab bar come back? It was hidden only while a field had focus.
5. Why was that the rule? It was written to keep the keyboard clear, without thinking about the tap that ends typing.

**Fix:** forms have no tab bar; Save takes its place.

### Item names and search words reaching browser history (found by browser test)

1. Why did an item title stay in the page after lock? It was in the tab title.
2. Why there? The title copied the page heading.
3. Why does that matter? Tab titles and URLs go into history, which Chrome can sync.
4. Why not considered? "Stored" was taken to mean IndexedDB and files only.
5. Why? The privacy check looked at storage the app owns, not storage the browser keeps for it.

**Fix:** fixed tab titles, and search words stay out of the address. A test checks both.

### Other defects found and fixed

| Found by | Defect | Fix |
|---|---|---|
| Unit test | Wrong-vault warning cleared by the next write | Warning held in state, shown by every settle |
| Self-review | First tap after a long absence reset the idle timer instead of locking | Tap checks idle time first |
| Self-review | Other open tab kept stale data | Tabs tell each other to reload |
| Self-review | Attached web page could open on the app origin | Only PDFs and images open; everything else downloads |
| Measured layout | Home search 42 px high | 48 px |
| Appearance review | Total broke across two lines; zero bars showed a sliver; half-way axis tick on whole counts | Fixed |
| Independent review | Pruning could delete another vault's saves or the live file | Vault tag in file name; live file exempt |
| Independent review | Unlocked flag set before records loaded; late merge after lock | Key assigned last; merges refused when locked |
| Independent review | Locked device refused a password changed elsewhere | Refused password tried against saves in the folder |
| Independent review | Truncated attachment stored and never refetched | Authenticated before storing |
| Independent review | Erase could lose unsynced work | Asks again when changes have not been saved elsewhere |
| Independent review | Backup could not bring back deleted items | Bring back old items, as copies |
| Independent review | Recovery key applied before it was confirmed | Applied only after the tick; auto-lock held on that screen |
| Independent review | Screen claimed an old recovery key stops working everywhere | Wording corrected; limit documented |
| Independent review | CSV Id could overwrite settings; lock could wait on a hung folder; backup hid missing files | Fixed |
| Independent re-check | Restore tried only the newest-named save | Every readable save is tried |
| Independent re-check | A forged or old save could change the local keyring | Newer slot required, and the key must open stored data |
| Independent re-check | Lock during a save could write an empty vault | Snapshot taken first, with the key |
| Independent re-check | Lock during a reload handed the key back | A lock outranks any load in progress |
| Independent re-check | One damaged file stalled a restore; Bring back missed removed files and purged trash | Per-file handling; both restored |
| Independent re-check | Stale recovery key could restore an old password; phone had no way to accept a changed password; unconfirmed recovery key was forgotten after a closed tab; Erase missed unsynced edits after reload | Merged keyring; Open a backup on the unlock screen; Home warning; flag survives reload |
| Usability test | Home search looked dead; "save file" and "backup" named one thing twice; "Send save file" sent nothing; dead-end message on a different vault | Live results; one word, backup; "Make a backup"; next step named |

## FMEA

Severity (S), occurrence (O) and detection (D) are 1 to 10, where 10 is worst or hardest to detect. Risk priority (RPN) = S × O × D. Scores are my judgement, not measured rates. "After" is the state as shipped.

| Area | Failure mode | Effect | Cause | S | O | D | RPN before | Control in place | RPN after |
|---|---|---|---|---:|---:|---:|---:|---|---:|
| Storage | Device lost and password forgotten | All data lost | Recovery only worked locally | 10 | 3 | 8 | 240 | Recovery from a save file, tested | 30 |
| Storage | Sibling page on the shared origin captures the password | Full exposure | Shared github.io origin | 10 | 2 | 9 | 180 | Documented. Cached page hash-checked. Needs a separate origin to close | 140 |
| Storage | Browser clears IndexedDB | Local copy lost | Storage pressure | 8 | 3 | 5 | 120 | `persist()` on every entry, sync, backups | 60 |
| Storage | Tampered keyring in a shared folder | Recovery broken on all devices | Unauthenticated copy stored | 9 | 2 | 7 | 126 | Inner copy only, slots merged | 18 |
| Storage | Weak master password | Offline guessing succeeds | User choice | 10 | 3 | 6 | 180 | Length and strength check, 600,000 rounds | 90 |
| Sync | Pruning deletes needed saves | Unmerged edits lost | Device-only rule | 9 | 3 | 7 | 189 | Vault tag, own device only, live file kept | 27 |
| Sync | Partial file delivered | Sync stops | OneDrive delay | 6 | 7 | 3 | 126 | Skip and retry, tested | 18 |
| Sync | Two devices edit one item | Older edit replaced | Per-record merge, as specified | 5 | 4 | 7 | 140 | Documented. Newest wins, the same on every device | 140 |
| Sync | Password changed elsewhere | Locked device refuses it | Pull needs an unlock | 6 | 4 | 4 | 96 | Tried against folder saves; recovery key works too | 24 |
| Sync | Phone has no folder access | Phone falls behind | Android browser or OneDrive limits | 6 | 7 | 2 | 84 | Hand-moved backup. Real behaviour unverified | 84 |
| Import | Excel already shortened a number | Digits lost before import | 6.27E+11 in the file | 8 | 4 | 3 | 96 | Row marked Check with an explanation | 32 |
| Import | Header not recognised | Nothing imports | Unusual column names | 3 | 5 | 2 | 30 | Clear message, aliases | 18 |
| Import | CSV cell overwrites another record | Settings or data replaced | Trusted Id column | 7 | 2 | 6 | 84 | Only unused item ids accepted | 14 |
| Import | Formula in an exported cell | Runs in Excel | Spreadsheet behaviour | 6 | 2 | 5 | 60 | Cells protected, reversibly | 12 |
| Evaluation | Rupee total off by a paisa | Wrong figure | Floating point | 6 | 3 | 5 | 90 | Whole paise, BigInt totals, hand checks | 6 |
| Evaluation | Wrong FY or week near a boundary | Wrong period | Date logic | 4 | 3 | 5 | 60 | Exhaustive 20-year test against a second method | 8 |
| Evaluation | Expiry off by a day | Renewal missed | Time-zone drift | 7 | 3 | 5 | 105 | Dates held as text; IST midnight tested | 14 |
| Reporting | Dashboard differs from data | False confidence | Separate tallies drift | 5 | 3 | 5 | 75 | One pass, checked against separate counts | 15 |
| Reporting | Total mixes unlike amounts | Misread as one sum | Convenience tile | 4 | 5 | 4 | 80 | Labelled, split table shown | 24 |
| Reporting | Plain CSV left on disk | Secrets exposed | User handling | 9 | 4 | 7 | 252 | Warning and password gate; still depends on the user | 126 |
| Reporting | Reminder missed | Renewal lapses | Static page cannot notify | 6 | 5 | 6 | 180 | Shown on Home and Reminders when opened. Inherent | 120 |

Highest remaining: shared origin (140), same-item edit conflict (140), plain CSV (126), reminders (120).
