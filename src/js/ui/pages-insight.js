import { h, icon } from './dom.js';
import { app, prefs } from './state.js';
import { barList, chartCard, columns } from './charts.js';
import { catVar, copySecret, emptyState, expiryBadge, linkButton, mainSecretOf, pageHead } from './common.js';
import { itemRow, itemTable } from './pages-items.js';
import { computeStats } from '../core/stats.js';
import { queryItems, sortItems } from '../core/search.js';
import { daysBetween, monthKeyLabel, todayIst } from '../core/dates.js';
import { formatPaise } from '../core/money.js';
import { formatBytes } from '../core/units.js';
import { TEMPLATE_BY_ID } from '../core/schema.js';
import { passwordReport } from '../core/passwords.js';

const NAV_TILES = [
  ['#/vault', 'vault', 'Vault', 'Search and open everything'],
  ['#/add', 'plus', 'Add item', 'Store something new'],
  ['#/dashboard', 'chart', 'Dashboard', 'Counts, dates and totals'],
  ['#/reminders', 'bell', 'Reminders', 'Renewals and expiry dates'],
  ['#/health', 'shield', 'Password health', 'Weak, reused or old passwords'],
  ['#/sync', 'sync', 'Sync', 'OneDrive folder and save files'],
  ['#/transfer', 'swap', 'Import and export', 'CSV files and backups'],
  ['#/settings', 'gear', 'Settings', 'Theme, auto-lock, categories'],
  ['#/guide', 'book', 'Guide', 'How everything works'],
];

export function homePage() {
  const items = app.vault.items();
  const live = items.filter((i) => i.trash === undefined);
  const favs = live.filter((i) => i.fav === 1);
  const today = todayIst(app.now());
  const soon = sortItems(live.filter((i) => i.exp && daysBetween(today, i.exp) <= 30), 'expiry').slice(0, 5);
  const hits = h('ul', { class: 'quick home-hits', id: 'home-hits' });
  const showHits = () => {
    hits.replaceChildren();
    if (!q.value.trim()) return;
    const found = queryItems(app.vault.items(), app.vault.hay, { q: q.value });
    if (found.length === 0) hits.append(h('li', { class: 'sub' }, 'Nothing matches. Passwords and PINs are never searched.'));
    for (const it of found.slice(0, 6)) {
      const s = mainSecretOf(it);
      hits.append(h('li', { css: { '--cat': catVar(it.c) } }, h('a', { href: `#/item/${it.id}` }, it.title),
        s ? h('button', { class: 'btn btn-sm', type: 'button', 'aria-label': `Copy ${s.label.toLowerCase()} for ${it.title}`, onclick: () => copySecret(s.value, s.label) }, icon('copy', 16), `Copy ${s.label.toLowerCase()}`) : null));
    }
    if (found.length > 6) hits.append(h('li', null, h('a', { href: '#/vault', onclick: () => { app.searchText = q.value; } }, `See all ${found.length} results`)));
  };
  const q = h('input', { type: 'search', id: 'home-q', placeholder: 'Find an item', 'aria-label': 'Find an item', autocomplete: 'off', spellcheck: 'false', enterkeyhint: 'search', oninput: showHits });
  const greeting = live.length === 0 ? 'Start by adding one item.' : `${live.length} ${live.length === 1 ? 'item' : 'items'} in your vault.`;
  return h('div', null,
    h('section', { class: 'home-head' },
      h('h1', { tabindex: '-1' }, 'Your vault'),
      h('p', { class: 'lede' }, 'Vaulment keeps your bank details, Indian records, office papers, online accounts, medical reports, warranties and certificates in one place. It encrypts everything on this device before storing or syncing it, and nothing is sent to any server.'),
      h('p', { class: 'sub' }, greeting),
      h('div', { class: 'home-actions' },
        linkButton('#/add', 'Add item', 'btn btn-primary btn-lg', 'plus'),
        h('form', { class: 'search-wrap', role: 'search', novalidate: true, onsubmit: (e) => { e.preventDefault(); app.searchText = q.value; app.go('#/vault'); } }, icon('search'), q)),
      hits),
    prefs.get('recoveryPending', false) ? h('p', { class: 'notice' }, icon('warn'), 'Your recovery key was not confirmed as saved. Make a new one in Settings now, or a forgotten password means losing everything.') : null,
    favs.length > 0 ? h('section', { class: 'card' }, h('h2', null, 'Favourites'), h('ul', { class: 'quick' }, favs.slice(0, 8).map((it) => {
      const s = mainSecretOf(it);
      return h('li', { css: { '--cat': catVar(it.c) } }, h('a', { href: `#/item/${it.id}` }, it.title),
        s ? h('button', { class: 'btn btn-sm', type: 'button', 'aria-label': `Copy ${s.label.toLowerCase()} for ${it.title}`, onclick: () => copySecret(s.value, s.label) }, icon('copy', 16), `Copy ${s.label.toLowerCase()}`) : null);
    }))) : null,
    soon.length > 0 ? h('section', { class: 'card' }, h('h2', null, 'Due in 30 days'), h('ul', { class: 'quick' }, soon.map((it) => h('li', { css: { '--cat': catVar(it.c) } }, h('a', { href: `#/item/${it.id}` }, it.title), expiryBadge(it.exp))))) : null,
    h('nav', { 'aria-label': 'All tabs', class: 'tiles' }, NAV_TILES.map(([href, ic, t, sub]) => h('a', { class: 'tile', href }, icon(ic, 20), h('span', null, h('strong', null, t), h('span', { class: 'row-sub' }, sub))))));
}

const tile = (id, label, value, note, cls = '') => h('div', { class: `stat ${cls}`, id }, h('span', { class: 'stat-value' }, value), h('span', { class: 'stat-label' }, label), note ? h('span', { class: 'row-sub' }, note) : null);

export function dashboardPage() {
  const v = app.vault;
  const s = computeStats(v.items(), v.attachments(), v.customCategories(), app.now());
  if (s.items === 0) {
    return h('div', null, pageHead('Dashboard'), emptyState('Nothing to count yet', 'Add a few items and this page fills in with counts, dates and totals.', linkButton('#/add', 'Add item', 'btn btn-primary', 'plus')));
  }
  const amountRows = Object.entries(s.amounts).sort(([a], [b]) => (a < b ? -1 : 1)).map(([t, paise]) => [TEMPLATE_BY_ID[t].amt ?? TEMPLATE_BY_ID[t].label, TEMPLATE_BY_ID[t].label, formatPaise(paise, { symbol: true })]);
  const dueRows = [['Overdue', s.due.overdue], ['Next 30 days', s.due.in30], ['31 to 90 days', s.due.in90], ['91 to 365 days', s.due.in365], ['Later', s.due.later]];
  const catRows = s.byCategory.filter((c) => c.count > 0).sort((a, b) => b.count - a.count || (a.label < b.label ? -1 : 1));
  const monthRows = s.byMonth.map((m) => ({ label: monthKeyLabel(m.key), short: monthKeyLabel(m.key).slice(0, 3), value: m.count }));
  return h('div', null,
    pageHead('Dashboard', `As of today in ${s.week}, ${s.fy}`),
    h('div', { class: 'stats' },
      tile('st-items', 'Items', s.items, `${s.addedThisWeek} added in ${s.week}`),
      tile('st-cats', 'Categories in use', s.categoriesUsed),
      tile('st-files', 'Files', s.files, formatBytes(s.fileBytes)),
      tile('st-due', 'Due within 90 days', s.due.overdue + s.due.in30 + s.due.in90, `${s.due.overdue} overdue`),
      tile('st-weak', 'Passwords to fix', s.passwordsToFix, `of ${s.passwordsChecked} checked`),
      tile('st-total', 'All amounts added up', formatPaise(s.totalAmount, { symbol: true }), 'Mixes types; see the split below', 'stat-money')),
    h('div', { class: 'chart-grid' },
      chartCard('Items by category', 'Each category keeps its colour everywhere.', barList(catRows.map((c) => ({ label: c.label, value: c.count, color: catVar(c.id) }))), ['Category', 'Items'], catRows.map((c) => [c.label, c.count])),
      chartCard('Added per month', 'Last twelve months, by the date each item was added.', columns(monthRows), ['Month', 'Items'], monthRows.map((m) => [m.label, m.value])),
      chartCard('Items by financial year', 'By document date, or the date added when there is none.', columns(s.byFy.map((f) => ({ label: f.label, short: f.label.slice(5), value: f.count }))), ['Financial year', 'Items'], s.byFy.map((f) => [f.label, f.count])),
      chartCard('Expiry and renewal dates', 'Count of items by time left.', barList(dueRows.map(([label, value], i) => ({ label, value, color: i === 0 ? 'var(--red)' : i < 3 ? 'var(--amber)' : 'var(--neutral-mark)' }))), ['When', 'Items'], dueRows)),
    amountRows.length > 0 ? h('section', { class: 'card' }, h('h2', null, 'Amounts by type'),
      h('table', { class: 'data-table plain', id: 'amount-table' }, h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Measure'), h('th', { scope: 'col' }, 'Item type'), h('th', { scope: 'col', class: 'num' }, 'Total'))),
        h('tbody', null, amountRows.map((r) => h('tr', null, h('td', { 'data-label': 'Measure' }, r[0]), h('td', { 'data-label': 'Item type' }, r[1]), h('td', { class: 'num', 'data-label': 'Total' }, r[2])))))) : null);
}

export function remindersPage() {
  const today = todayIst(app.now());
  const live = app.vault.items().filter((i) => i.trash === undefined && i.exp);
  if (live.length === 0) {
    return h('div', null, pageHead('Reminders'), emptyState('No dates to watch yet', 'Add a renewal or expiry date to an insurance policy, card, warranty or ID, and it shows up here.', linkButton('#/add', 'Add item', 'btn btn-primary', 'plus')));
  }
  const groups = [['Overdue', (d) => d < 0], ['Next 30 days', (d) => d >= 0 && d <= 30], ['31 to 90 days', (d) => d > 30 && d <= 90], ['Later', (d) => d > 90]];
  return h('div', null, pageHead('Reminders', 'Vaulment shows dates here when you open it. It cannot notify you while closed.'),
    groups.map(([label, test]) => {
      const list = sortItems(live.filter((i) => test(daysBetween(today, i.exp))), 'expiry');
      return list.length === 0 ? null : h('section', { class: 'card' }, h('h2', null, `${label} (${list.length})`), itemTable(list.map((it) => itemRow(it))));
    }));
}

export function healthPage() {
  const r = passwordReport(app.vault.items(), app.now());
  if (r.checked === 0) {
    return h('div', null, pageHead('Password health'), emptyState('No passwords saved yet', 'Add an online account or a bank login and it is checked here. Checks run on this device only.', linkButton('#/new/login', 'Add online account', 'btn btn-primary', 'plus')));
  }
  const group = (title, why, list) => (list.length === 0 ? null : h('section', { class: 'card' }, h('h2', null, `${title} (${list.length})`), h('p', { class: 'sub' }, why), itemTable(list.map((it) => itemRow(it)))));
  const clean = r.weak.length + r.reused.length + r.old.length === 0;
  return h('div', null,
    pageHead('Password health', `${r.checked} passwords checked on this device. Nothing is sent anywhere.`),
    clean ? h('p', { class: 'notice notice-ok' }, icon('check'), 'No weak, reused or old passwords.') : null,
    group('Weak', 'Short or common. Replace these with generated passwords.', r.weak),
    group('Reused', 'One leak exposes every account that shares a password.', r.reused),
    group('Older than a year', 'Consider changing these, starting with banking.', r.old));
}

