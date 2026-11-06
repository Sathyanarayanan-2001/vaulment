| Action, 5,000 items and 500 files | This container (ms) | CPU 4× slower (ms) |
|---|---:|---:|
| Unlock, full (key stretching and decrypt) | 456.5 | 810.1 |
| Decrypt on unlock, BEFORE (one at a time) | 156.8 | 580.6 |
| Decrypt on unlock, AFTER (batches of 200) | 140.6 | 498.4 |
| Draw vault list, BEFORE (all rows) | 279.3 | 1363.3 |
| Draw vault list, AFTER (first 100, Show more) | 6.3 | 22.3 |
| Check 500 files held, BEFORE (one read each) | 118.8 | 613.2 |
| Check 500 files held, AFTER (one key listing) | 1.2 | 3.3 |
| Find files of 2,000 items, BEFORE (scan) | 133.1 | 638.2 |
| Find files of 2,000 items, AFTER (index) | 0.2 | 2.1 |
| Search, one keystroke | 0.8 | 7.8 |
| Sort all by title | 1.5 | 10 |
| Compute dashboard | 31.9 | 138.4 |
| Write one save file | 39.6 | 230.8 |
| Read one save file | 16.9 | 80.9 |
| Merge with every record changed | 63.3 | 302.8 |
| Save file size | 93 KB | 93 KB |

First load to visible heading on simulated slow 4G with CPU 4× slower, three runs: 1175, 1138, 1131 ms.
