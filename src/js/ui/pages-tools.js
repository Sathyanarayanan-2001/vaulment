import { h, icon, clear, toast, confirmDialog, askPassword, downloadBytes, pickFile, fileBytes } from './dom.js';
import { app, prefs, AUTOLOCK_CHOICES, CLIPBOARD_CHOICES } from './state.js';
import { pageHead } from './common.js';
import { quickStart, recoveryScreen } from './gate.js';
import { STATES } from '../store/sync.js';
import { DB_NAME } from '../store/idb.js';
import { exportCsv, importable, planImport } from '../core/importer.js';
import { formatDateTime, todayIst } from '../core/dates.js';
import { formatPaise, sumPaise } from '../core/money.js';
import { formatBytes } from '../core/units.js';
import { categoryLabel, LIMITS } from '../core/schema.js';
import { WORKED_EXAMPLES } from '../core/examples.js';
import { passwordBits, strengthLabel } from '../core/passwords.js';
import { newId } from '../crypto/vaultcrypto.js';
import { REVISIONS } from '../core/version.js';

export function morePage() {
  const links = [['#/reminders', 'bell', 'Reminders'], ['#/health', 'shield', 'Password health'], ['#/sync', 'sync', 'Sync'], ['#/transfer', 'swap', 'Import and export'], ['#/settings', 'gear', 'Settings'], ['#/guide', 'book', 'Guide']];
  return h('div', null, pageHead('More'), h('nav', { class: 'tiles', 'aria-label': 'More tabs' }, links.map(([href, ic, t]) => h('a', { class: 'tile', href }, icon(ic, 20), h('span', null, h('strong', null, t))))));
}

const stamp = () => todayIst(app.now()).replace(/-/g, '');

export function syncPage() {
  const s = app.sync;
  const line = (label, value) => h('div', { class: 'kv' }, h('dt', null, label), h('dd', null, value));
  const body = h('div', null);

  const draw = () => {
    clear(body);
    const connected = Boolean(app.folderHandle);
    body.append(
      h('section', { class: 'card' },
        h('h2', null, 'Sync folder'),
        h('dl', { class: 'kvs' },
          line('State', h('strong', { id: 'sync-state' }, STATES[s.state])),
          line('Folder', connected ? app.folderHandle.name : 'Not connected'),
          line('Last saved', s.lastSave ? formatDateTime(s.lastSave) : 'Not in this session'),
          line('Last checked for changes', s.lastPull ? formatDateTime(s.lastPull) : 'Not in this session'),
          s.skipped.size > 0 ? line('Waiting for', `${s.skipped.size} save file(s) that cannot be read yet. They are retried automatically.`) : null,
          s.pendingBlobs > 0 ? line('Files on the way', `${s.pendingBlobs} attachment(s) not delivered yet`) : null,
          s.rejected > 0 ? line('Records refused', `${s.rejected} damaged record(s) were left out`) : null,
          app.vault.unreadable > 0 ? line('Unreadable on this device', `${app.vault.unreadable} stored record(s) could not be decrypted. Merge a backup to replace them.`) : null),
        s.message ? h('p', { class: 'notice' }, icon('warn'), s.message) : null,
        app.folderSupported ? h('div', { class: 'row' },
          h('button', { class: `btn ${connected ? '' : 'btn-primary'}`, type: 'button', id: 'choose-folder', onclick: app.chooseFolder }, icon('cloud'), connected ? 'Change folder' : 'Choose folder'),
          connected && s.state === 'access' ? h('button', { class: 'btn btn-primary', type: 'button', onclick: app.reconnectFolder }, 'Allow access') : null,
          connected ? h('button', { class: 'btn', type: 'button', id: 'sync-now', onclick: async () => { await s.pull(); await s.write(); toast('Sync finished.'); draw(); } }, icon('sync'), 'Sync now') : null,
          connected ? h('button', { class: 'btn btn-danger-text', type: 'button', onclick: app.forgetFolder }, 'Stop syncing') : null)
          : h('p', { class: 'notice' }, icon('warn'), 'This browser cannot open a folder directly. Use the backup steps below. They carry the same encrypted data.')),
      h('section', { class: 'card' },
        h('h2', null, 'Move a backup by hand'),
        h('p', null, 'Use this on a phone, or whenever folder sync is not available. A backup is one encrypted file with every item and attachment. Make one here, put it in OneDrive, then merge it on the other device.'),
        h('div', { class: 'row' },
          h('button', { class: 'btn', type: 'button', id: 'send-save', onclick: sendSave }, icon('down'), 'Make a backup'),
          h('button', { class: 'btn', type: 'button', id: 'open-save', onclick: openSave }, icon('upload'), 'Merge a backup'))),
    );
  };

  const sendSave = async () => {
    const bytes = await s.exportBundle();
    const name = `vaulment-backup-${stamp()}.json.gz`;
    const file = new File([bytes], name, { type: 'application/gzip' });
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    downloadBytes(bytes, name, 'application/gzip');
    toast('Backup downloaded. Put it in OneDrive to reach your other device.');
  };
  const openSave = async () => {
    const [file] = await pickFile('.gz,application/gzip,application/octet-stream');
    if (!file) return;
    try {
      const r = await s.importBundle(await fileBytes(file));
      toast(`Merged ${r.changed} change(s) and ${r.files} file(s).${r.damaged ? ` ${r.damaged} damaged file(s) were left out.` : ''}`, r.damaged ? 'error' : 'ok');
      draw();
    } catch (e) {
      toast(`Could not merge that file. ${e.message}`, 'error');
    }
  };

  draw();
  return h('div', null,
    pageHead('Sync', 'Every device merges item by item, and the newest edit wins. A deletion reaches the others as well.'),
    body);
}

export function transferPage() {
  const preview = h('div', { id: 'import-preview' });
  const err = h('p', { class: 'form-error', role: 'alert' });
  const paste = h('textarea', { id: 'import-text', rows: 5, placeholder: 'Title,User name,Password', spellcheck: 'false', autocomplete: 'off' });

  const STATUS = { ready: ['Ready', 'badge-ok', 'check'], warning: ['Check', 'badge-amber', 'warn'], duplicate: ['Duplicate', '', 'copy'], error: ['Error', 'badge-red', 'cross'] };

  const showPlan = (text) => {
    err.textContent = '';
    clear(preview);
    const v = app.vault;
    const plan = planImport(text, { existing: v.items(), usedIds: [...v.recs.keys()], customCats: v.customCategories(), todayIso: todayIst(app.now()), nowMs: app.now(), newId: () => newId('r') });
    if (!plan.ok) { err.textContent = plan.error; return; }
    const { summary } = plan;
    const toImport = importable(plan);
    const importBtn = h('button', { class: 'btn btn-primary', type: 'button', id: 'import-go', disabled: toImport.length === 0, onclick: async () => {
      await v.addMany(toImport);
      toast(`Imported ${toImport.length} item(s).`);
      clear(preview);
      paste.value = '';
    } }, `Import ${toImport.length} item(s)`);
    preview.append(
      h('h3', null, 'Preview'),
      h('p', { class: 'sub', id: 'import-summary' }, `Header found on line ${plan.headerLine}. ${summary.ready} ready, ${summary.warning} to check, ${summary.duplicate} duplicate, ${summary.error} with errors. Nothing is saved until you press Import.`),
      plan.unknown.length > 0 ? h('p', { class: 'sub' }, `Columns ignored: ${plan.unknown.join(', ')}`) : null,
      h('div', { class: 'scroll-y' }, h('table', { class: 'data-table plain' },
        h('thead', null, h('tr', null, ['Line', 'Status', 'Title', 'Category', 'Message'].map((x) => h('th', { scope: 'col' }, x)))),
        h('tbody', null, plan.rows.slice(0, 500).map((r) => {
          const [label, cls, ic] = STATUS[r.status];
          return h('tr', null,
            h('td', { 'data-label': 'Line', class: 'num' }, r.line),
            h('td', { 'data-label': 'Status' }, h('span', { class: `badge ${cls}` }, icon(ic, 14), label)),
            h('td', { 'data-label': 'Title' }, r.rec.title || 'No title'),
            h('td', { 'data-label': 'Category' }, categoryLabel(r.rec.c, v.customCategories())),
            h('td', { 'data-label': 'Message' }, r.messages.join(' ')));
        })))),
      plan.rows.length > 500 ? h('p', { class: 'sub' }, `Showing the first 500 of ${plan.rows.length} rows. All are included in the import.`) : null,
      h('div', { class: 'row end' }, h('button', { class: 'btn', type: 'button', onclick: () => clear(preview) }, 'Cancel'), importBtn));
  };

  const exportPlain = async () => {
    const pw = await askPassword({ title: 'Export without encryption?', body: 'This file shows every password and PIN in plain text. Keep it off OneDrive and delete it after use. Enter your master password to continue.', action: 'Export CSV', check: (p) => app.vault.checkPassword(p) });
    if (!pw) return;
    const csv = exportCsv(app.vault.items(), app.vault.customCategories());
    downloadBytes(new TextEncoder().encode(csv), `vaulment-export-${stamp()}.csv`, 'text/csv;charset=utf-8');
    const live = app.vault.items().filter((i) => i.trash === undefined);
    toast(`Exported ${live.length} item(s), total ${formatPaise(sumPaise(live.map((i) => i.amt)), { symbol: true })}.`);
  };

  return h('div', null,
    pageHead('Import and export'),
    h('section', { class: 'card' },
      h('h2', null, 'Import from CSV'),
      h('p', null, 'Works with a Chrome or Edge password export, a Vaulment export, or your own sheet. Vaulment finds the header row, even below title lines, and matches columns by name.'),
      h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', id: 'import-file', onclick: async () => {
        const [file] = await pickFile('.csv,.tsv,.txt,text/csv');
        if (!file) return;
        try { showPlan(new TextDecoder('utf-8', { fatal: true }).decode(await fileBytes(file))); } catch { err.textContent = 'That file is not UTF-8 text. In Excel, use Save As, CSV UTF-8.'; }
      } }, icon('upload'), 'Choose CSV file')),
      h('div', { class: 'field' }, h('label', { for: 'import-text' }, 'Or paste CSV text'), paste),
      h('button', { class: 'btn', type: 'button', id: 'import-preview-btn', onclick: () => { if (paste.value.trim()) showPlan(paste.value); else err.textContent = 'Paste some CSV text first, or choose a file.'; } }, 'Show preview'),
      err, preview),
    h('section', { class: 'card' },
      h('h2', null, 'Encrypted backup'),
      h('p', null, 'One file with every item and attachment, locked with your master password. You can keep this one on OneDrive.'),
      h('p', { class: 'sub' }, 'Merge keeps the newest version of each item. To get back something deleted or overwritten since the backup, use Bring back old items: they return as copies marked restored, and nothing current changes.'),
      h('div', { class: 'row' }, h('button', { class: 'btn btn-primary', type: 'button', id: 'backup-go', onclick: async () => {
        downloadBytes(await app.sync.exportBundle(), `vaulment-backup-${stamp()}.json.gz`, 'application/gzip');
        prefs.set('lastBackup', app.now());
        if (app.sync.bundleMissing > 0) toast(`Backup downloaded, but ${app.sync.bundleMissing} file(s) have not reached this device yet and are not in it. Sync, then back up again.`, 'error');
        else toast('Backup downloaded.');
      } }, icon('down'), 'Download backup'),
      h('button', { class: 'btn', type: 'button', id: 'restore-go', onclick: async () => {
        const [file] = await pickFile('.gz,application/gzip,application/octet-stream');
        if (!file) return;
        try { const r = await app.sync.importBundle(await fileBytes(file)); toast(`Merged ${r.changed} change(s) and ${r.files} file(s).${r.damaged ? ` ${r.damaged} damaged file(s) were left out.` : ''}`, r.damaged ? 'error' : 'ok'); } catch (e) { toast(`Could not merge that file. ${e.message}`, 'error'); }
      } }, icon('upload'), 'Merge a backup'),
      h('button', { class: 'btn', type: 'button', id: 'copies-go', onclick: async () => {
        const [file] = await pickFile('.gz,application/gzip,application/octet-stream');
        if (!file) return;
        try { const r = await app.sync.restoreCopies(await fileBytes(file)); toast(`Brought back ${r.items} item(s) and ${r.files} file(s).${r.failed ? ` ${r.failed} could not be restored.` : ''}`, r.failed ? 'error' : 'ok'); } catch (e) { toast(`Could not read that file. ${e.message}`, 'error'); }
      } }, icon('sync'), 'Bring back old items'))),
    h('section', { class: 'card' },
      h('h2', null, 'Plain CSV export'),
      h('p', null, 'For moving to another tool, or for a sheet. Files are not included. Long numbers stay as text, so Excel cannot shorten them.'),
      h('button', { class: 'btn', type: 'button', id: 'csv-go', onclick: exportPlain }, icon('down'), 'Export CSV')));
}

function categoriesEditor() {
  const list = h('ul', { class: 'cats' });
  const name = h('input', { id: 'new-cat', type: 'text', maxlength: LIMITS.category, autocomplete: 'off' });
  const err = h('p', { class: 'field-error', role: 'alert' });
  const draw = () => {
    clear(list);
    const cats = app.vault.customCategories();
    if (cats.length === 0) list.append(h('li', { class: 'sub' }, 'None yet.'));
    for (const c of cats) {
      const used = app.vault.items().filter((i) => i.c === c.id).length;
      list.append(h('li', null, h('span', null, `${c.label} (${used})`), h('button', { class: 'btn btn-sm btn-danger-text', type: 'button', disabled: used > 0, title: used > 0 ? 'Move its items to another category first' : null, 'aria-label': `Remove ${c.label}`, onclick: async () => { await app.vault.setCustomCategories(cats.filter((x) => x.id !== c.id)); draw(); } }, 'Remove')));
    }
  };
  draw();
  return h('div', null, list, h('form', { class: 'row', novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    const label = name.value.trim();
    const cats = app.vault.customCategories();
    if (!label) { err.textContent = 'Type a name for the category first.'; return; }
    if (cats.some((c) => c.label.toLowerCase() === label.toLowerCase())) { err.textContent = 'You already have a category with that name.'; return; }
    await app.vault.setCustomCategories([...cats, { id: newId('u'), label }]);
    name.value = ''; err.textContent = ''; draw();
  } }, h('div', { class: 'field grow' }, h('label', { for: 'new-cat' }, 'New category'), name), h('button', { class: 'btn', type: 'submit' }, 'Add category')), err);
}

export function settingsPage() {
  const storage = h('dd', null, 'Checking');
  navigator.storage?.estimate?.().then(async (e) => {
    const persisted = await navigator.storage.persisted?.();
    storage.textContent = `${formatBytes(e.usage ?? 0)} used${persisted ? ', protected from automatic clearing' : ', may be cleared by the browser if space runs out'}`;
  }).catch(() => { storage.textContent = 'Not available in this browser'; });

  const theme = h('select', { id: 's-theme', onchange: (e) => app.setTheme(e.target.value) }, [['system', 'Follow system'], ['light', 'Light'], ['dark', 'Dark']].map(([v, t]) => h('option', { value: v, selected: prefs.get('theme', 'system') === v }, t)));
  const auto = h('select', { id: 's-lock', onchange: (e) => prefs.set('autoLock', Number(e.target.value)) }, AUTOLOCK_CHOICES.map((m) => h('option', { value: m, selected: prefs.get('autoLock', 5) === m }, `${m} minute${m === 1 ? '' : 's'}`)));
  const clip = h('select', { id: 's-clip', onchange: (e) => prefs.set('clipSeconds', Number(e.target.value)) }, CLIPBOARD_CHOICES.map((m) => h('option', { value: m, selected: prefs.get('clipSeconds', 30) === m }, `${m} seconds`)));

  const oldPw = h('input', { id: 'cp-old', type: 'password', autocomplete: 'current-password' });
  const newPw = h('input', { id: 'cp-new', type: 'password', autocomplete: 'new-password' });
  const newPw2 = h('input', { id: 'cp-new2', type: 'password', autocomplete: 'new-password' });
  const cpErr = h('p', { class: 'field-error', role: 'alert' });
  const changePw = async (e) => {
    e.preventDefault();
    cpErr.textContent = '';
    if (newPw.value.length < 10 || strengthLabel(passwordBits(newPw.value)) === 'weak') { cpErr.textContent = 'Use at least 10 characters that are hard to guess.'; return; }
    if (newPw.value !== newPw2.value) { cpErr.textContent = 'The two new passwords do not match. Type them again.'; return; }
    try {
      await app.vault.changePassword(oldPw.value, newPw.value);
      app.sync.markDirty();
      oldPw.value = ''; newPw.value = ''; newPw2.value = '';
      toast('Master password changed. Your other devices switch to it after their next sync.');
    } catch (err) { cpErr.textContent = err.message; }
  };

  return h('div', null,
    pageHead('Settings'),
    h('section', { class: 'card' }, h('h2', null, 'Appearance and safety'),
      h('div', { class: 'form-grid' },
        h('div', { class: 'field' }, h('label', { for: 's-theme' }, 'Theme'), theme),
        h('div', { class: 'field' }, h('label', { for: 's-lock' }, 'Lock after no activity'), auto),
        h('div', { class: 'field' }, h('label', { for: 's-clip' }, 'Clear copied secrets after'), clip))),
    h('section', { class: 'card' }, h('h2', null, 'Custom categories'), categoriesEditor()),
    h('section', { class: 'card' }, h('h2', null, 'Master password'),
      h('form', { class: 'form-grid', novalidate: true, onsubmit: changePw },
        h('div', { class: 'field' }, h('label', { for: 'cp-old' }, 'Current password'), oldPw),
        h('div', { class: 'field' }, h('label', { for: 'cp-new' }, 'New password'), newPw),
        h('div', { class: 'field' }, h('label', { for: 'cp-new2' }, 'Type it again'), newPw2),
        cpErr, h('div', null, h('button', { class: 'btn', type: 'submit', id: 'cp-go' }, 'Change password'))),
      h('hr'),
      h('button', { class: 'btn', type: 'button', id: 'new-rk', onclick: async () => {
        const pw = await askPassword({ title: 'Make a new recovery key?', body: 'The old key stops working for this vault from now on. Older save files and backups can still be opened with it, so replace those too if the old key was seen by anyone. Enter your master password to continue.', action: 'Make new key', check: (p) => app.vault.checkPassword(p) });
        if (!pw) return;
        const { keyring, recoveryCode } = await app.vault.prepareRecovery(pw);
        recoveryScreen(document.getElementById('app'), recoveryCode, async () => {
          await app.vault.applyKeyring(keyring);
          app.sync.markDirty();
          app.enter();
        });
      } }, 'Make a new recovery key')),
    h('section', { class: 'card' }, h('h2', null, 'This device'),
      h('dl', { class: 'kvs' }, h('div', { class: 'kv' }, h('dt', null, 'Storage'), storage)),
      app.installPrompt ? h('button', { class: 'btn', type: 'button', onclick: async () => { app.installPrompt.prompt(); app.installPrompt = null; } }, icon('down'), 'Install app') : null,
      h('button', { class: 'btn btn-danger-text', type: 'button', id: 'erase', onclick: eraseDevice }, icon('trash'), 'Erase vault from this device')),
    h('section', { class: 'card' }, h('h2', null, 'About'),
      h('p', null, `Version ${app.version}, built ${app.buildDate}`),
      h('h3', null, 'Revision history'),
      h('table', { class: 'data-table plain' }, h('thead', null, h('tr', null, ['Version', 'Date', 'Changes'].map((x) => h('th', { scope: 'col' }, x)))),
        h('tbody', null, REVISIONS.map((r) => h('tr', null, h('td', { 'data-label': 'Version' }, r.version), h('td', { 'data-label': 'Date', class: 'num' }, r.date), h('td', { 'data-label': 'Changes' }, r.note)))))));
}

async function eraseDevice() {
  const pw = await askPassword({ title: 'Erase this device?', body: 'This removes the vault from this device only. Save files in your folder stay. Enter your master password to confirm.', action: 'Erase', check: (p) => app.vault.checkPassword(p) });
  if (!pw) return;
  if (!(await confirmDialog({ title: 'Last check', body: 'Without a save file or another device, this data cannot be recovered.', action: 'Erase this device', danger: true }))) return;
  await app.sync.flush();
  if ((app.sync.dirty || prefs.get('unsynced', false)) && !(await confirmDialog({ title: 'Some changes are not saved elsewhere', body: 'Recent changes have not reached a sync folder, so erasing now loses them. Make a backup first, unless you are sure.', action: 'Erase anyway', danger: true }))) return;
  app.vault.db.close();
  indexedDB.deleteDatabase(DB_NAME);
  location.hash = '';
  location.reload();
}

const section = (title, open, ...kids) => h('details', { class: 'guide-sec', open }, h('summary', null, title), h('div', null, ...kids));
const steps = (...lines) => h('ol', null, lines.map((l) => h('li', null, l)));
const bullets = (...lines) => h('ul', null, lines.map((l) => h('li', null, l)));

export function guidePage() {
  return h('div', { class: 'guide' },
    pageHead('Guide', 'How Vaulment works and how to use it.', h('button', { class: 'btn', type: 'button', id: 'qs-again', onclick: quickStart }, 'Show quick start')),
    section('The idea in one minute', true,
      h('p', null, 'Vaulment is a web page that behaves like an app. All your data stays on your devices and in your own OneDrive folder. Everything is encrypted before it is stored, so the page, OneDrive and anyone who copies the files see only scrambled data.'),
      h('p', null, 'Your master password opens the vault. Nobody can reset it. The recovery key is the only other way in, so keep it on paper.')),
    section('Add and find items', false,
      steps('Press Add item on Home.', 'Pick a type, such as Bank account or Warranty.', 'Fill in what you have. Only the title is required.', 'Press Save item.'),
      h('p', null, 'Search looks through titles, banks, user names, notes and tags. It never looks inside passwords or PINs. Tick favourite to keep an item on Home, where one tap copies its password.')),
    section('Dates, weeks and money', false,
      bullets('Type dates day first: 28/10 or 28/10/2026. On a phone, 28102026 works too.', 'Month, ISO week and financial year come from the date; you never type them.', 'Amounts show with lakh grouping and are stored as whole paise, so totals are exact.')),
    section('Files', false,
      bullets('Add images, PDFs and office files up to 25 MB each.', 'Files are encrypted on this device, then copied to your sync folder in the blobs subfolder.', 'Reading text from images needs a browser feature that only some devices have. Where it is missing, the button does not appear and you can type into Notes instead.')),
    section('Sync across your laptops and phone', false,
      steps('Open Sync and press Choose folder.', 'Pick a folder inside OneDrive, for example OneDrive, Vaulment.', 'On the next laptop, choose Bring my vault to this device, then pick the same folder and use the same master password.'),
      h('p', null, 'Vaulment saves about 3 seconds after a change and when you leave the page. The state beside the logo is always visible: Saved, Saving, Changes waiting, Folder access needed or Sync problem.'),
      h('p', null, 'Files that have not finished downloading are skipped and tried again later. Two devices can edit at once: the newest edit to each item wins.'),
      h('h3', null, 'On a phone'),
      h('p', null, 'OneDrive on Android may not offer a folder that browsers can open. If Sync says so, use Make a backup on one device, put the file in OneDrive with the OneDrive app, and use Merge a backup on the other. The file is encrypted, so that is safe.')),
    section('Import and export', false,
      bullets('Import reads any CSV and finds the header row by itself. You see a preview with a status per row, and nothing is saved until you press Import.', 'Encrypted backup is the safe export. Plain CSV shows every secret, so delete it after use.', 'Long numbers export as text, so Excel cannot turn them into 6.27E+11.')),
    section('Staying safe', false,
      bullets('The vault locks after a period of no activity. Change the time in Settings.', 'Copied secrets are cleared from the clipboard after 30 seconds, as long as the tab has focus at that moment.', 'Keep the recovery key on paper.', 'Do a backup now and then, even with sync on.', 'Anyone who can use your unlocked device can read your vault, so lock it before you step away.')),
    section('Worked examples', false,
      h('div', { class: 'scroll-y' }, h('table', { class: 'data-table plain' }, h('thead', null, h('tr', null, ['Example', 'You enter', 'Vaulment gives'].map((x) => h('th', { scope: 'col' }, x)))),
        h('tbody', null, WORKED_EXAMPLES.map((e) => h('tr', null, h('td', { 'data-label': 'Example' }, e.topic), h('td', { 'data-label': 'You enter' }, e.input), h('td', { 'data-label': 'Vaulment gives' }, e.expected))))))),
    section('Keyboard shortcuts on a laptop', false, bullets('/ jumps to search.', 'n starts a new item.', 'l locks the vault.')));
}

