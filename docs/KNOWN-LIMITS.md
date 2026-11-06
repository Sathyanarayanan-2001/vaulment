# Known limits

## Not verified on real hardware

Everything was tested in Chromium on Linux with emulated phone sizes. These need checking by you, using [USER-TEST.md](USER-TEST.md):

- **OneDrive folder on Android.** Sources disagree on when Chrome for Android gained `showDirectoryPicker`, and I do not know whether the OneDrive app offers a folder that browsers can open. The app detects what is available and falls back to moving a backup by hand, which is tested.
- **The real folder picker.** It is a native dialog that automated tests cannot drive. Tests used a stand-in over a real folder, plus the browser's own file-system handle.
- **Real OneDrive delivery delays.** Simulated with partial and missing files.
- **Real on-screen keyboards.** Simulated by shrinking the viewport.
- **First load on a physical mid-range phone.** Measured with Lighthouse's simulated profile and with throttled Chromium.
- **Text reading from images.** `TextDetector` was simulated. Chrome ships it only on some platforms, so the button may never appear.

## Behaviour to expect

- A plain CSV has no attachments. Use the encrypted backup for those.
- Reminders show when the app is open. A static page cannot notify you while closed.
- Two devices editing one item: the older edit is replaced, per item, not per field.
- Unsaved typing on a form is lost if auto-lock fires.
- A backup holds every file in memory while it is built, so a very large vault of scans needs a device with enough memory.
- Tombstones stay forever. Each is about 30 bytes.
- Clipboard clearing needs the tab to have focus.
- Private windows: Chromium crashes when an off-the-record profile reads a stored private-file-system handle back from IndexedDB. Reproduced in a page with no app code. Normal windows passed the same test. Vaulment is not meant for private windows anyway, since their storage is thrown away.
