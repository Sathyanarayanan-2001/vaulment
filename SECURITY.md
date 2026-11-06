# Security

## What this protects against

| Threat | Protection |
|---|---|
| Someone gets your OneDrive files | Everything in them is AES-256-GCM encrypted. The master password is not there. |
| Someone copies your browser profile | IndexedDB holds ciphertext only. |
| Someone sees the public code | It holds no secrets and no data. |
| A tampered or corrupted save file | GCM authentication fails and the file is skipped. Records are validated before merging. The keyring outside the ciphertext is only a way in; the stored copy comes from inside. |
| Injected markup in an imported cell or title | DOM text nodes, Trusted Types and a strict CSP. |
| A bug trying to send data out | `connect-src 'none'` blocks network requests from the page. |

## What it cannot protect against

- **An unlocked device.** Whoever can use it can read the vault. Lock it, and keep auto-lock short.
- **Malware on the device.** A keylogger sees the master password.
- **A weak master password.** Offline guessing is slowed, not stopped. Use a long phrase.
- **A compromised deployment.** A static web app runs the code it is served. If the GitHub account were taken over, a changed page could steal the master password. Protect the account with two-factor sign-in.
- **Other apps on the same github.io origin. This is the largest remaining risk.** Every project under `sathyanarayanan-2001.github.io` shares one browser origin. A malicious or compromised sibling page could open Vaulment in a window it controls and capture the master password as you type it, or delete your local copy. An independent review demonstrated the password capture. Today's sibling projects are your own, so this needs one of them to be compromised first. Keep them free of third-party scripts. The real fix is a separate origin: a custom subdomain, or a second GitHub account used only for Vaulment. Tampering with the cached offline page is blocked, since the service worker checks the page's SHA-256.
- **The clipboard.** Other software can read it during the 30 seconds before clearing, and clearing only works if the tab has focus at that moment.
- **Plain CSV exports.** They show every secret. Delete them after use.

- **Old passwords and old files.** Changing the password or recovery key does not re-encrypt the data; it rewraps the same data key. Save files and backups made earlier still open with the old password or old recovery key. If an old password is exposed and someone also holds an old file, they can reach the data key. Delete old backups after changing a password for that reason.
- **Opened documents.** A PDF opened in its own tab stays there after the vault locks. Close it.

## Unfixable by design

If you lose both the master password and the recovery key, the data is gone. There is no back door.

## Reporting a problem

Open a private security advisory on the repository, or contact the owner. Do not put real data in an issue.

## Repository rules

No personal data, real entries, bank references or backups may be committed. `.gitignore` blocks save, backup, export and secret patterns, and `npm run privacy` fails CI if one slips through. Tests use made-up values only. Tokens are read from the environment.
