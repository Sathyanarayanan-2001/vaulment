// Worked examples shown in the Guide and asserted by the unit tests, so the Guide
// can never drift from what the code does. Inputs are made up.

export const WORKED_EXAMPLES = [
  { topic: 'Date typed day first', input: '28/10 (typed in 2026)', fn: 'date', arg: '28/10', expected: '28/10/2026, Oct 2026, CW44, FY 2026-27' },
  { topic: 'End of financial year', input: '31/03/2027', fn: 'date', arg: '31/03/2027', expected: '31/03/2027, Mar 2027, CW13, FY 2026-27' },
  { topic: 'Start of financial year', input: '01/04/2027', fn: 'date', arg: '01/04/2027', expected: '01/04/2027, Apr 2027, CW13, FY 2027-28' },
  { topic: 'ISO week 53', input: '31/12/2026', fn: 'date', arg: '31/12/2026', expected: '31/12/2026, Dec 2026, CW53, FY 2026-27' },
  { topic: 'Leap day', input: '29/02/2028', fn: 'date', arg: '29/02/2028', expected: '29/02/2028, Feb 2028, CW09, FY 2027-28' },
  { topic: 'Adding amounts exactly', input: '0.10 + 0.20 + 1,23,456.78', fn: 'sum', arg: ['0.10', '0.20', '1,23,456.78'], expected: '1,23,457.08' },
  { topic: 'Lakh and crore grouping', input: '12345678.9', fn: 'sum', arg: ['12345678.9'], expected: '1,23,45,678.90' },
];
