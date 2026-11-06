# Worked examples

Every line below is asserted by `tests/unit/core.test.mjs` or `scripts/golden.mjs`. Inputs are made up.

| Example | Input | Expected output | Hand working |
|---|---|---|---|
| Date typed day first | `28/10`, typed in 2026 | 28/10/2026, Oct 2026, CW44, FY 2026-27 | The Thursday of that week is 29/10; it is week 44 |
| End of financial year | 31/03/2027 | Mar 2027, CW13, FY 2026-27 | March belongs to the year that began the April before |
| Start of financial year | 01/04/2027 | Apr 2027, CW13, FY 2027-28 | April starts a new year |
| ISO week 53 | 31/12/2026 | CW53, FY 2026-27 | 1 January 2026 was a Thursday, so 2026 has 53 weeks |
| Next year, same week | 03/01/2027 | CW53 | That Sunday's Thursday is 31/12/2026 |
| Leap day | 29/02/2028 | Feb 2028, CW09, FY 2027-28 | 2028 divides by 4 and not by 100 |
| Not a leap day | 29/02/2027 | Refused: 2027 is not a leap year | 2027 does not divide by 4 |
| Adding amounts | 0.10 + 0.20 + 1,23,456.78 | 1,23,457.08 | 10 + 20 + 1,23,45,678 paise = 1,23,45,708 paise |
| Grouping | 12345678.9 | 1,23,45,678.90 | Last three digits, then pairs |
| Merge tie | Same `u = 5`, titles apple and zebra | zebra, on every device | Larger canonical text wins |
| Long number in CSV | 627123456789 | `="627123456789"` | Excel keeps every digit |
