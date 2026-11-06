# Contributing

This is a personal tool, but it follows normal repository practice.

1. Work on a branch, never on `main`.
2. Run `npm ci`, then `npm run verify` before opening a pull request. It rebuilds, then reruns every test.
3. Write tests first for anything you refactor (characterisation tests), and state the input and the hand-worked result in each test name or comment.
4. Update `src/js/core/version.js` (version, date, revision note) and `CHANGELOG.md`.
5. Merge through a pull request after CI passes.

## Rules that are easy to break

- Never set `innerHTML`. Trusted Types will throw. Build the DOM with `h()`.
- No `style` attributes. CSP blocks them. Use the `css` prop of `h()`.
- Money is whole paise; dates are `YYYY-MM-DD` strings. Month, week and financial year are always derived.
- Comments explain why, not what.
- Test data is made up. `npm run privacy` fails on anything that looks like real data or a save file.
- Never put tokens or passwords in code. Read secrets from the environment.
