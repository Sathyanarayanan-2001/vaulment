import { h, icon, downloadBytes, fileBytes, pickFile, toast } from './dom.js';
import { app, prefs } from './state.js';
import { passwordBits, strengthLabel } from '../core/passwords.js';
import { VaultError } from '../store/vault.js';
import { readEnvelope } from '../store/savefile.js';
import { SyncEngine } from '../store/sync.js';

const MIN_PASSWORD = 10;

const brand = () => h('div', { class: 'gate-brand' }, h('span', { class: 'brand-mark' }, icon('lock', 20)), h('span', { class: 'brand-name' }, 'Vaulment'));

const gateShell = (...kids) => h('main', { class: 'gate', id: 'main' }, h('div', { class: 'gate-card' }, brand(), ...kids));

function passwordField(id, label, autocomplete) {
  const input = h('input', { id, type: 'password', autocomplete, spellcheck: 'false', autocapitalize: 'none', required: true });
  const toggle = h('button', {
    class: 'btn-icon', type: 'button', 'aria-label': `Show ${label.toLowerCase()}`, 'aria-pressed': 'false',
    onclick: () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      toggle.setAttribute('aria-pressed', String(show));
      toggle.setAttribute('aria-label', `${show ? 'Hide' : 'Show'} ${label.toLowerCase()}`);
      toggle.replaceChildren(icon(show ? 'eyeoff' : 'eye'));
    },
  }, icon('eye'));
  return { input, el: h('div', { class: 'field' }, h('label', { for: id }, label), h('div', { class: 'input-row' }, input, toggle)) };
}

const newPasswordProblem = (pw, again) => {
  if (pw.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters. A short sentence works well.`;
  if (strengthLabel(passwordBits(pw)) === 'weak') return 'That password is easy to guess. Use a longer one with a few unrelated words.';
  if (pw !== again) return 'The two passwords do not match. Type them again.';
  return null;
};

function meter(input) {
  const out = h('p', { class: 'hint', 'aria-live': 'polite' }, `At least ${MIN_PASSWORD} characters.`);
  input.addEventListener('input', () => {
    out.textContent = input.value ? `Strength: ${strengthLabel(passwordBits(input.value))}` : `At least ${MIN_PASSWORD} characters.`;
  });
  return out;
}

const errorLine = () => h('p', { class: 'field-error', role: 'alert' });

function busy(button, label, work) {
  return async (e) => {
    e?.preventDefault();
    const old = button.textContent;
    button.disabled = true;
    button.textContent = label;
    // Key stretching blocks the frame it starts in, so let the label paint first.
    await new Promise((r) => setTimeout(r, 30));
    try { await work(); } finally { button.disabled = false; button.textContent = old; }
  };
}

export function setupScreen(root, done) {
  const pw = passwordField('new-pw', 'Master password', 'new-password');
  const again = passwordField('new-pw2', 'Type it again', 'new-password');
  const err = errorLine();
  const create = h('button', { class: 'btn btn-primary wide', type: 'submit' }, 'Create my vault');
  const form = h('form', { novalidate: true, onsubmit: busy(create, 'Creating', async () => {
    const problem = newPasswordProblem(pw.input.value, again.input.value);
    if (problem) { err.textContent = problem; return; }
    const code = await app.vault.create(pw.input.value);
    await app.vault.loadAll();
    prefs.set('recoveryPending', true); // Cleared by the tick. Home nags until then.
    recoveryScreen(root, code, () => done({ firstRun: true }));
  }) },
  pw.el, meter(pw.input), again.el, err, create);
  root.replaceChildren(gateShell(
    h('h1', { tabindex: '-1' }, 'Create your vault'),
    h('p', null, 'Everything you store is encrypted with this password. It never leaves this device, and it cannot be reset by anyone.'),
    form,
    h('hr'),
    h('p', { class: 'sub' }, 'Already use Vaulment on another device?'),
    h('button', { class: 'btn wide', type: 'button', onclick: () => restoreScreen(root, done) }, 'Bring my vault to this device'),
  ));
  pw.input.focus();
}

/** `confirm` applies the key if it has not been applied yet, and runs only after the tick. */
export function recoveryScreen(root, code, confirm) {
  app.holdLock = true; // Auto-lock here would wipe the only copy of the key from the screen.
  let clearTimer = null;
  const copy = () => navigator.clipboard.writeText(code).then(() => {
    toast('Recovery key copied. The clipboard clears in 60 seconds.');
    clearTimeout(clearTimer);
    clearTimer = setTimeout(() => navigator.clipboard.writeText('').catch(() => {}), 60_000);
  }, () => toast('Copying was blocked. Write the key down instead.', 'error'));
  const saved = h('input', { type: 'checkbox', id: 'rk-saved' });
  const err = errorLine();
  root.replaceChildren(gateShell(
    h('h1', { tabindex: '-1' }, 'Save your recovery key'),
    h('p', null, 'If you forget the master password, this key is the only way back in. Print it or write it down, and keep it away from your devices.'),
    h('output', { class: 'recovery-code', id: 'recovery-code' }, code),
    h('div', { class: 'row' },
      h('button', { class: 'btn', type: 'button', onclick: copy }, icon('copy'), 'Copy'),
      h('button', { class: 'btn', type: 'button', onclick: () => downloadBytes(new TextEncoder().encode(`Vaulment recovery key\r\n${code}\r\n`), 'vaulment-recovery-key.txt', 'text/plain') }, icon('down'), 'Download')),
    h('label', { class: 'check', for: 'rk-saved' }, saved, h('span', null, 'I have saved my recovery key')),
    err,
    h('button', { class: 'btn btn-primary wide', type: 'button', onclick: async () => {
      if (!saved.checked) { err.textContent = 'Tick the box once your key is safe. Without it, a forgotten password means losing everything.'; return; }
      app.holdLock = false;
      prefs.set('recoveryPending', false);
      await confirm();
    } }, 'Continue'),
  ));
}

export function unlockScreen(root, done) {
  const pw = passwordField('unlock-pw', 'Master password', 'current-password');
  const err = errorLine();
  const open = h('button', { class: 'btn btn-primary wide', type: 'submit' }, 'Unlock');
  const form = h('form', { novalidate: true, onsubmit: busy(open, 'Unlocking', async () => {
    if (!pw.input.value) { err.textContent = 'Type your master password to unlock.'; return; }
    try {
      await app.vault.unlock(pw.input.value);
      done({ firstRun: false });
    } catch (e) {
      if (e instanceof VaultError && await tryPasswordFromFolder(pw.input.value)) { done({ firstRun: false }); return; }
      err.textContent = e instanceof VaultError ? e.message : 'Could not open the vault. Reload the page and try again.';
      pw.input.select();
    }
  }) }, pw.el, err, open);
  root.replaceChildren(gateShell(
    h('h1', { tabindex: '-1' }, 'Unlock your vault'),
    form,
    h('button', { class: 'btn-link', type: 'button', onclick: () => recoverScreen(root, done) }, 'Forgot the password? Use your recovery key'),
    // A phone with no folder has only this way to learn of a password changed elsewhere.
    h('button', { class: 'btn-link', type: 'button', onclick: async () => {
      if (!pw.input.value) { err.textContent = 'Type the new master password first, then pick the backup.'; return; }
      const [file] = await pickFile('.gz,application/gzip,application/octet-stream');
      if (!file) return;
      try {
        const bytes = await fileBytes(file);
        if (await app.vault.unlockFromEnvelope(await readEnvelope(bytes), pw.input.value)) {
          await app.sync.importBundle(bytes);
          done({ firstRun: false });
        } else err.textContent = 'That password does not open a newer copy of this vault from that file.';
      } catch (e) {
        err.textContent = `Could not read that file. ${e.message}`;
      }
    } }, 'Password changed on another device? Open a backup'),
  ));
  pw.input.focus();
}

/** The password may have been changed on another device; its save can prove it. */
async function tryPasswordFromFolder(password) {
  const dir = app.folderHandle ?? await app.vault.db.get('kv', 'folder').catch(() => null);
  if (!dir) return false;
  try {
    // This runs inside the Unlock click, the one moment a browser lets a page ask for access.
    if (dir.requestPermission && (await dir.requestPermission({ mode: 'readwrite' })) !== 'granted') return false;
    for await (const { env } of SyncEngine.envelopes(dir)) {
      if (await app.vault.unlockFromEnvelope(env, password)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

function recoverScreen(root, done) {
  const code = h('input', { id: 'rk-input', type: 'text', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'characters' });
  const pw = passwordField('rk-pw', 'New master password', 'new-password');
  const again = passwordField('rk-pw2', 'Type it again', 'new-password');
  const err = errorLine();
  const go = h('button', { class: 'btn btn-primary wide', type: 'submit' }, 'Set new password');
  const form = h('form', { novalidate: true, onsubmit: busy(go, 'Checking', async () => {
    const problem = newPasswordProblem(pw.input.value, again.input.value);
    if (problem) { err.textContent = problem; return; }
    try {
      await app.vault.unlockRecovery(code.value, pw.input.value);
      done({ firstRun: false });
    } catch (e) {
      err.textContent = e instanceof VaultError ? e.message : 'Could not use that key. Check it and try again.';
    }
  }) },
  h('div', { class: 'field' }, h('label', { for: 'rk-input' }, 'Recovery key'), code), pw.el, again.el, err, go);
  root.replaceChildren(gateShell(
    h('h1', { tabindex: '-1' }, 'Use your recovery key'),
    form,
    h('button', { class: 'btn-link', type: 'button', onclick: () => unlockScreen(root, done) }, 'Back to unlock'),
  ));
  code.focus();
}

function restoreScreen(root, done) {
  const status = h('p', { class: 'hint', 'aria-live': 'polite' });
  const err = errorLine();
  let candidates = []; // Every readable save: the newest-named file can be a stale one.
  let dir = null;
  const pw = passwordField('restore-pw', 'Master password', 'current-password');
  const code = h('input', { id: 'restore-rk', type: 'text', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'characters' });
  const newPw = passwordField('restore-new', 'New master password', 'new-password');
  const newPw2 = passwordField('restore-new2', 'Type it again', 'new-password');
  const recoveryFields = h('div', { hidden: true }, h('div', { class: 'field' }, h('label', { for: 'restore-rk' }, 'Recovery key'), code), newPw.el, newPw2.el);
  let useRecovery = false;
  const open = h('button', { class: 'btn btn-primary wide', type: 'submit' }, 'Open my vault');
  const swap = h('button', { class: 'btn-link', type: 'button', onclick: () => {
    useRecovery = !useRecovery;
    pw.el.hidden = useRecovery;
    recoveryFields.hidden = !useRecovery;
    swap.textContent = useRecovery ? 'Use my master password instead' : 'Forgot the password? Use your recovery key';
    err.textContent = '';
  } }, 'Forgot the password? Use your recovery key');
  const form = h('form', { novalidate: true, hidden: true, onsubmit: busy(open, 'Opening', async () => {
    if (useRecovery) {
      const problem = newPasswordProblem(newPw.input.value, newPw2.input.value);
      if (problem) { err.textContent = problem; return; }
    }
    let last = null;
    for (const { env, bytes } of candidates) {
      try {
        if (useRecovery) await app.vault.adoptEnvelopeRecovery(env, code.value, newPw.input.value);
        else await app.vault.adoptEnvelope(env, pw.input.value);
        await app.sync.importBundle(bytes);
        done({ firstRun: false, dir });
        return;
      } catch (e) {
        last = e;
      }
    }
    err.textContent = last instanceof VaultError ? last.message : `Could not open that file. ${last?.message ?? ''}`;
  }) }, pw.el, recoveryFields, err, open, swap);

  const ready = (list, d) => {
    candidates = list;
    dir = d;
    status.textContent = 'Backup found. Enter the master password from your other device.';
    form.hidden = false;
    pw.input.focus();
  };
  root.replaceChildren(gateShell(
    h('h1', { tabindex: '-1' }, 'Bring your vault here'),
    h('p', null, 'Point Vaulment at your sync folder, or open a backup. Your master password stays the same on every device.'),
    app.folderSupported ? h('button', { class: 'btn wide', type: 'button', onclick: async () => {
      let picked;
      try { picked = await showDirectoryPicker({ id: 'vaulment-sync', mode: 'readwrite' }); } catch { return; }
      const found = [];
      for await (const one of SyncEngine.envelopes(picked)) found.push(one);
      if (found.length > 0) ready(found, picked);
      else status.textContent = 'No readable save file in that folder yet. If your sync app is still downloading, wait and try again.';
    } }, icon('cloud'), 'Choose sync folder') : null,
    h('button', { class: 'btn wide', type: 'button', onclick: async () => {
      const [file] = await pickFile('.gz,application/gzip,application/octet-stream');
      if (!file) return;
      try {
        const bytes = await fileBytes(file);
        ready([{ env: await readEnvelope(bytes), bytes }], null);
      } catch (e) {
        status.textContent = `That file could not be read: ${e.message} Pick another file.`;
      }
    } }, icon('file'), 'Open a backup'),
    status, form,
    h('button', { class: 'btn-link', type: 'button', onclick: () => setupScreen(root, done) }, 'Back'),
  ));
}

const QUICK_STEPS = [
  { t: 'Add your first item', b: 'Press Add item, pick a type such as Bank account, fill in what you have, and save. Attach a passbook photo or a PDF if you like.' },
  { t: 'Connect your OneDrive folder', b: 'Open Sync and choose a folder inside OneDrive. Vaulment saves an encrypted copy there, and your other devices read it from the same folder.' },
  { t: 'Check your recovery key is safe', b: 'Keep it on paper, away from your laptops and phone. It is the only way back in if you forget the master password.' },
  { t: 'Install it as an app', b: 'In Chrome or Edge, use Install from the address bar or menu. It then opens like an app and works offline.' },
];

/** First-visit tour. Can be reopened from the Guide. */
export function quickStart() {
  let step = 0;
  const dialog = h('dialog', { class: 'dialog', 'aria-labelledby': 'qs-title' });
  const finish = () => { dialog.close(); dialog.remove(); };
  dialog.addEventListener('cancel', (e) => { e.preventDefault(); finish(); });
  const draw = () => {
    const s = QUICK_STEPS[step];
    const last = step === QUICK_STEPS.length - 1;
    dialog.replaceChildren(
      h('p', { class: 'sub' }, `Quick start: step ${step + 1} of ${QUICK_STEPS.length}`),
      h('h2', { id: 'qs-title' }, s.t),
      h('p', null, s.b),
      h('div', { class: 'row end' },
        h('button', { class: 'btn', type: 'button', onclick: finish }, 'Skip'),
        step > 0 ? h('button', { class: 'btn', type: 'button', onclick: () => { step -= 1; draw(); } }, 'Back') : null,
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => { if (last) finish(); else { step += 1; draw(); } } }, last ? 'Finish' : 'Next')),
    );
  };
  draw();
  document.body.append(dialog);
  dialog.showModal();
}
