| Action, 5,000 items and 500 files | This container (ms) | CPU 4× slower (ms) |
|---|---:|---:|
| Unlock, full (key stretching and decrypt) | 571.8 | 946.2 |
| Decrypt on unlock, BEFORE (one at a time) | 162.9 | 613.4 |
| Decrypt on unlock, AFTER (batches of 200) | 169.6 | 596.2 |
| Draw vault list, BEFORE (all rows) | 232.7 | 1274.2 |
| Draw vault list, AFTER (first 100, Show more) | 4.5 | 21.9 |
| Check 500 files held, BEFORE (one read each) | 137.1 | 587.4 |
| Check 500 files held, AFTER (one key listing) | 2 | 6.6 |
| Find files of 2,000 items, BEFORE (scan) | 143.5 | 680.4 |
| Find files of 2,000 items, AFTER (index) | 0.1 | 0.2 |
| Search, one keystroke | 0.7 | 5.6 |
| Sort all by title | 1.7 | 10.2 |
| Compute dashboard | 29.8 | 126.6 |
| Write one save file | 42.2 | 192 |
| Read one save file | 16.5 | 109.5 |
| Merge with every record changed | 88.7 | 367 |
| Save file size | 93 KB | 93 KB |

First load to visible heading on simulated slow 4G with CPU 4× slower, three runs: 881, 832, 810 ms.
