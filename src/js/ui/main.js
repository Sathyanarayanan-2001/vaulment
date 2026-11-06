import { h, icon, toast } from './dom.js';
import { app, prefs } from './state.js';
import { addPage, editPage, itemPage, vaultPage } from './pages-items.js';
import { dashboardPage, healthPage, homePage, remindersPage } from './pages-insight.js';
import { guidePage, morePage, settingsPage, syncPage, transferPage } from './pages-tools.js';
import { quickStart, setupScreen, unlockScreen } from './gate.js';
import { Vault } from '../store/vault.js';
import { openIdbBackend, memoryBackend } from '../store/idb.js';
import { SyncEngine, STATES } from '../store/sync.js';
import { parseRoute } from '../core/route.js';
import { MS_PER_MINUTE, MS_PER_SECOND } from '../core/units.js';
import { newId } from '../crypto/vaultcrypto.js';
import { VERSION, BUILD_DATE } from '../core/version.js';

const root = document.getElementById('app');
const tabs = 'BroadcastChannel' in globalThis ? new BroadcastChannel('vaulment-tabs') : null;
const PULL_EVERY_MS = MS_PER_MINUTE;
const LOCK_FLUSH_LIMIT_MS = 3 * MS_PER_SECOND;

const NAV = [
  ['home', 'Home', 'home', 'pb'], ['vault', 'Vault', 'vault', 'pb'], ['add', 'Add item', 'plus', 'pb'], ['dashboard', 'Dashboard', 'chart', 'pb'],
  ['reminders', 'Reminders', 'bell', 'p'], ['health', 'Password health', 'shield', 'p'], ['sync', 'Sync', 'sync', 'p'], ['transfer', 'Import and export', 'swap', 'p'],
  ['settings', 'Settings', 'gear', 'p'], ['guide', 'Guide', 'book', 'p'], ['more', 'More', 'more', 'b'],
];

const PAGE_FOR = { home: homePage, vault: vaultPage, add: addPage, dashboard: dashboardPage, reminders: remindersPage, health: healthPage, sync: syncPage, transfer: transferPage, settings: settingsPage, guide: guidePage, more: morePage, item: itemPage, edit: editPage, new: editPage };
const MORE_PAGES = new Set(['reminders', 'health', 'sync', 'transfer', 'settings', 'guide', 'more']);
const ACTIVE_ALIAS = { item: 'vault', edit: 'vault', new: 'add' };

const THEME_ICON = { system: 'auto', light: 'sun', dark: 'moon' };
const THEME_NEXT = { system: 'light', light: 'dark', dark: 'system' };

app.setTheme = (theme) => {
  prefs.set('theme', theme);
  if (theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  drawThemeButton();
};

let themeBtn = null;
function drawThemeButton() {
  if (!themeBtn) return;
  const t = prefs.get('theme', 'system');
  themeBtn.replaceChildren(icon(THEME_ICON[t]));
  themeBtn.setAttribute('aria-label', `Theme: ${t}. Switch to ${THEME_NEXT[t]}.`);
  themeBtn.setAttribute('title', `Theme: ${t}`);
}

let syncChip = null;
const SYNC_ICON = { saved: 'check', saving: 'sync', waiting: 'cloud', access: 'warn', problem: 'warn' };
function drawSyncChip(state, message) {
  if (!syncChip) return;
  // Not having chosen a folder yet is a choice, not a fault, so it stays neutral.
  syncChip.className = `sync sync-${state === 'access' && !app.folderHandle ? 'idle' : state}`;
  syncChip.replaceChildren(icon(SYNC_ICON[state], 16), h('span', null, STATES[state]));
  syncChip.title = message || STATES[state];
}

let mainEl = null;

function shell() {
  themeBtn = h('button', { class: 'btn-icon', type: 'button', id: 'theme-btn', onclick: () => app.setTheme(THEME_NEXT[prefs.get('theme', 'system')]) });
  syncChip = h('a', { href: '#/sync', id: 'sync-chip', role: 'status' });
  mainEl = h('main', { id: 'main', class: 'main', tabindex: '-1' });
  const navLink = ([page, label, ic]) => h('a', { href: `#/${page}`, 'data-page': page }, icon(ic, 20), h('span', null, label));
  root.replaceChildren(
    h('a', { class: 'skip', href: '#main', onclick: (e) => { e.preventDefault(); mainEl.focus(); } }, 'Skip to content'),
    h('div', { class: 'layout' },
      h('aside', { class: 'side' },
        h('a', { class: 'brand', href: '#/home' }, h('span', { class: 'brand-mark' }, icon('lock', 18)), h('span', { class: 'brand-name' }, 'Vaulment')),
        h('nav', { 'aria-label': 'Main' }, NAV.filter((n) => n[3].includes('p')).map(navLink))),
      h('div', { class: 'body' },
        h('header', { class: 'top' },
          h('a', { class: 'brand brand-top', href: '#/home', 'aria-label': 'Vaulment home' }, h('span', { class: 'brand-mark' }, icon('lock', 18))),
          syncChip,
          h('span', { class: 'spacer' }),
          themeBtn,
          h('button', { class: 'btn-icon', type: 'button', id: 'lock-btn', 'aria-label': 'Lock vault', title: 'Lock vault', onclick: () => app.lock() }, icon('lock'))),
        mainEl)),
    h('nav', { class: 'bottom', 'aria-label': 'Main' }, NAV.filter((n) => n[3].includes('b')).map(navLink)));
  drawThemeButton();
  drawSyncChip(app.sync.state, app.sync.message);
}

function render() {
  if (!mainEl) return;
  const route = parseRoute(location.hash);
  app.route = route;
  if (route.error) { toast(route.error, 'error'); history.replaceState(null, '', route.page === 'vault' ? '#/vault' : '#/home'); }
  app.dirtyForm = false;
  // On a form the Save bar replaces the tab bar. If both could show, the tab bar returning
  // on blur would shift Save from under the finger and swallow the tap.
  document.body.classList.toggle('formpage', route.page === 'edit' || route.page === 'new');
  document.body.classList.remove('typing'); // A removed field may never fire focusout.
  mainEl.replaceChildren(PAGE_FOR[route.page](route));
  const active = ACTIVE_ALIAS[route.page] ?? route.page;
  for (const a of root.querySelectorAll('nav a[data-page]')) {
    const page = a.dataset.page;
    const on = page === active || (page === 'more' && MORE_PAGES.has(active));
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  // Tab titles land in browser history, which Chrome can sync, so an item's name never goes there.
  const named = NAV.find((n) => n[0] === route.page);
  document.title = named ? `${named[1]} | Vaulment` : 'Vaulment';
  window.scrollTo(0, 0);
  mainEl.querySelector('h1')?.focus({ preventScroll: true });
}

app.refresh = render;

/** Redraw after sync brings changes, unless that would throw away what is being typed. */
function softRefresh() {
  if (!mainEl) return;
  const page = app.route.page;
  if (page === 'edit' || page === 'new' || page === 'transfer' || page === 'settings') return;
  if (document.activeElement?.matches?.('input,textarea,select')) return;
  if (document.querySelector('dialog[open]')) return;
  const y = window.scrollY;
  render();
  window.scrollTo(0, y);
}

let idleAt = Date.now();

const idleTooLong = () => !app.holdLock && Date.now() - idleAt > prefs.get('autoLock', 5) * MS_PER_MINUTE;

/** The first tap after a long absence must lock, not count as fresh activity. Otherwise a
 *  phone left in a bag for an hour would stay unlocked for whoever picks it up. */
function touchIdle() {
  if (app.vault?.unlocked && idleTooLong()) { lock(); return; }
  idleAt = Date.now();
}

async function lock() {
  if (!app.vault.unlocked || app.holdLock) return;
  // A hung folder must not leave the vault open. The save stays queued for the next unlock.
  await Promise.race([app.sync.flush(), new Promise((r) => setTimeout(r, LOCK_FLUSH_LIMIT_MS))]);
  app.vault.lock();
  mainEl = null;
  syncChip = null;
  document.querySelectorAll('dialog').forEach((d) => d.remove());
  document.title = 'Vaulment';
  app.searchText = '';
  location.hash = '#/home';
  unlockScreen(root, enter);
}
app.lock = lock;

async function restoreFolder() {
  const handle = await app.vault.db.get('kv', 'folder').catch(() => null);
  if (!handle) return;
  app.folderHandle = handle;
  await app.sync.connect(handle);
}

app.chooseFolder = async () => {
  let dir;
  try {
    dir = await showDirectoryPicker({ id: 'vaulment-sync', mode: 'readwrite' });
  } catch (e) {
    if (e.name !== 'AbortError') toast(`Could not open that folder. ${e.message}`, 'error');
    return;
  }
  app.folderHandle = dir;
  await app.vault.db.put('kv', 'folder', dir).catch(() => {}); // A test double cannot be cloned; a real handle can.
  await app.sync.connect(dir);
  toast('Sync folder connected.');
  render();
};

app.reconnectFolder = async () => {
  const dir = app.folderHandle;
  if (!dir) return;
  // A browser asks again only inside a click, so this cannot be done at start-up.
  const state = await dir.requestPermission({ mode: 'readwrite' }).catch(() => 'denied');
  if (state === 'granted') { await app.sync.connect(dir); toast('Folder access restored.'); render(); } else toast('Access was not allowed. Press Allow access again and choose Allow.', 'error');
};

app.forgetFolder = async () => {
  await app.vault.db.del('kv', 'folder');
  app.folderHandle = null;
  app.sync.disconnect();
  render();
};

async function enter({ firstRun = false, dir = null } = {}) {
  // Ask on every entry, not just on create: a device that restored a vault needs this too.
  navigator.storage?.persist?.().catch(() => {});
  shell();
  render();
  touchIdle();
  if (dir) {
    app.folderHandle = dir;
    await app.vault.db.put('kv', 'folder', dir).catch(() => {});
    await app.sync.connect(dir);
  } else if (app.folderHandle) {
    await app.sync.connect(app.folderHandle);
  } else {
    await restoreFolder();
  }
  if (!app.folderHandle) app.sync.setState('access', 'No sync folder is connected. Your data is saved on this device only.');
  if (firstRun && !prefs.get('quickstart', false)) { prefs.set('quickstart', true); quickStart(); }
}
app.enter = enter;

function deviceId() {
  let id = prefs.get('device', null);
  if (!/^[a-z0-9]{6,12}$/.test(id ?? '')) { id = newId('d').slice(2, 10); prefs.set('device', id); }
  return id;
}

/** The field being typed in must stay above the on-screen keyboard. The app never closes
 *  or redraws a form on resize; it only scrolls the focused field back into view. */
function keepFieldVisible() {
  const el = document.activeElement;
  if (el?.matches?.('input,textarea,select') && window.innerWidth <= 760) el.scrollIntoView({ block: 'center', behavior: 'instant' });
}

function wireGlobalEvents() {
  document.addEventListener('focusin', (e) => {
    if (e.target.matches('input:not([type=checkbox]),textarea,select')) { document.body.classList.add('typing'); setTimeout(keepFieldVisible, 300); }
  });
  document.addEventListener('focusout', () => setTimeout(() => {
    if (!document.activeElement?.matches?.('input,textarea,select')) document.body.classList.remove('typing');
  }, 200));
  window.visualViewport?.addEventListener('resize', keepFieldVisible);

  window.addEventListener('hashchange', render);
  for (const ev of ['pointerdown', 'keydown', 'scroll', 'input']) document.addEventListener(ev, touchIdle, { passive: true, capture: true });

  document.addEventListener('keydown', (e) => {
    if (!mainEl || e.ctrlKey || e.metaKey || e.altKey || e.target.matches('input,textarea,select') || document.querySelector('dialog[open]')) return;
    if (e.key === '/') { e.preventDefault(); if (location.hash.startsWith('#/vault')) document.getElementById('vault-q')?.focus(); else location.hash = '#/vault'; }
    if (e.key === 'n') location.hash = '#/add';
    if (e.key === 'l') lock();
  });

  // Page close is unreliable on phones, so the last dependable moment to save is "hidden".
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') app.sync.flush();
    else if (app.vault.unlocked) { if (idleTooLong()) lock(); else app.sync.pull(); }
  });
  setInterval(() => { if (app.vault.unlocked && idleTooLong()) lock(); }, 5 * MS_PER_SECOND);
  setInterval(() => { if (app.vault.unlocked && document.visibilityState === 'visible') app.sync.pull(); }, PULL_EVERY_MS);

  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); app.installPrompt = e; });
}

function registerWorker() {
  // file: pages cannot register a service worker, and trying throws.
  if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
  const policy = globalThis.trustedTypes?.createPolicy('vaulment', { createScriptURL: (s) => { if (s !== 'sw.js') throw new TypeError('Blocked script URL'); return s; } });
  navigator.serviceWorker.register(policy ? policy.createScriptURL('sw.js') : 'sw.js').catch(() => {});
}

async function start() {
  app.version = VERSION;
  app.buildDate = BUILD_DATE;
  let backend;
  try {
    backend = await openIdbBackend();
  } catch {
    // A locked-down private window can refuse IndexedDB. Keep the app usable and say so.
    backend = memoryBackend();
    toast('This browser is blocking storage, so nothing will be kept after you close this tab.', 'error');
  }
  app.vault = new Vault(backend);
  app.sync = new SyncEngine({ vault: app.vault, device: deviceId(), session: newId('s').slice(2, 10), onState: (state, message) => {
    // Survives a reload, so Erase can still warn about changes that never left this device.
    if (state === 'saved') prefs.set('unsynced', false);
    else if (app.sync?.dirty) prefs.set('unsynced', true);
    drawSyncChip(state, message);
  } });
  app.vault.onChange(() => { app.sync.markDirty(); softRefresh(); tabs?.postMessage('changed'); });
  // A second open tab holds its own copy in memory, so it reloads when this one saves.
  tabs?.addEventListener('message', async () => {
    if (!app.vault.unlocked) return;
    await app.vault.reload();
    softRefresh();
  });
  wireGlobalEvents();
  registerWorker();
  if (await app.vault.hasVault()) unlockScreen(root, enter);
  else setupScreen(root, enter);
}

start();
