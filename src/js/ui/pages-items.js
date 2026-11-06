import { h, icon, clear, toast, confirmDialog, pickFile, fileBytes, downloadBytes } from './dom.js';
import { app } from './state.js';
import { catChip, catVar, copySecret, emptyState, expiryBadge, itemSummary, linkButton, mainSecretOf, pageHead } from './common.js';
import { CATEGORIES, DEFAULT_INSTITUTIONS, LIMITS, MAX_FILE_BYTES, TEMPLATES, TEMPLATE_BY_ID, categoryLabel } from '../core/schema.js';
import { queryItems } from '../core/search.js';
import { buildVaultHash } from '../core/route.js';
import { formatDate, formatDateTime, parseTypedDate, periodOf, todayIst } from '../core/dates.js';
import { formatPaise, parseRupees } from '../core/money.js';
import { formatBytes } from '../core/units.js';
import { generatePassword, passwordBits, strengthLabel } from '../core/passwords.js';
import { newId } from '../crypto/vaultcrypto.js';
import { VaultError } from '../store/vault.js';

const PAGE_SIZE = 100;

export function itemRow(it, opts = {}) {
  const secret = mainSecretOf(it);
  const trashView = opts.trash;
  return h('tr', { css: { '--cat': catVar(it.c) } },
    h('td', { class: 'cell-title', 'data-label': 'Item' },
      h('a', { href: `#/item/${it.id}`, class: 'row-link' }, it.fav === 1 ? h('span', { class: 'fav', title: 'Favourite' }, icon('star', 14)) : null, h('span', null, it.title)),
      h('span', { class: 'row-sub' }, itemSummary(it))),
    h('td', { 'data-label': 'Category' }, catChip(it.c)),
    h('td', { 'data-label': 'Date', class: `num ${it.doc ? '' : 'cell-none'}` }, it.doc ? formatDate(it.doc) : h('span', { class: 'muted' }, 'None')),
    h('td', { 'data-label': 'Expiry', class: it.exp ? null : 'cell-none' }, expiryBadge(it.exp) ?? h('span', { class: 'muted' }, 'None')),
    h('td', { class: 'cell-actions', 'data-label': 'Actions' }, trashView ? [
      h('button', { class: 'btn btn-sm', type: 'button', onclick: async () => { await app.vault.setTrash(it.id, false); toast('Item restored.'); app.refresh(); } }, 'Restore'),
      h('button', { class: 'btn btn-sm btn-danger-text', type: 'button', onclick: async () => {
        if (await confirmDialog({ title: 'Delete forever?', body: `${it.title} and its files will be removed from every device. This cannot be undone.`, action: 'Delete forever', danger: true })) {
          await app.vault.purge(it.id); toast('Item deleted forever.'); app.refresh();
        }
      } }, 'Delete forever'),
    ] : secret ? h('button', { class: 'btn btn-sm', type: 'button', 'aria-label': `Copy ${secret.label.toLowerCase()} for ${it.title}`, onclick: () => copySecret(secret.value, secret.label) }, icon('copy', 16), `Copy ${secret.label.toLowerCase()}`) : null));
}

export const itemTable = (rows, hasActions = true) => h('table', { class: 'data-table items' },
  h('thead', null, h('tr', null, ['Item', 'Category', 'Date', 'Expiry'].map((x) => h('th', { scope: 'col' }, x)), hasActions ? h('th', { scope: 'col' }, h('span', { class: 'sr' }, 'Actions')) : null)),
  h('tbody', null, rows));

const categoryOptions = (selected) => {
  const custom = app.vault.customCategories();
  return [...CATEGORIES, ...custom].map((c) => h('option', { value: c.id, selected: c.id === selected }, c.label));
};

export function vaultPage(route) {
  // Search words stay out of the address, because addresses land in browser history.
  const params = { ...route.params, q: route.params.q ?? app.searchText ?? '' };
  const results = h('div', { id: 'results' });
  const count = h('p', { class: 'sub', 'aria-live': 'polite', id: 'result-count' });
  let shown = PAGE_SIZE;
  const search = h('input', {
    type: 'search', id: 'vault-q', value: params.q ?? '', placeholder: 'Search titles, banks, user names, notes', 'aria-label': 'Search the vault', autocomplete: 'off', spellcheck: 'false', enterkeyhint: 'search',
    oninput: () => { params.q = search.value; app.searchText = search.value; shown = PAGE_SIZE; sync(); },
  });
  const sel = (id, label, value, opts, key) => h('div', { class: 'field-inline' }, h('label', { for: id }, label), h('select', { id, onchange: (e) => { params[key] = e.target.value || undefined; shown = PAGE_SIZE; sync(); } }, opts.map(([v, t]) => h('option', { value: v, selected: v === (value ?? '') }, t))));

  const draw = () => {
    const all = queryItems(app.vault.items(), app.vault.hay, params);
    count.textContent = `${all.length} ${all.length === 1 ? 'item' : 'items'}`;
    clear(results);
    if (all.length === 0) {
      const anyFilter = params.q || params.cat || (params.view && params.view !== 'all');
      results.append(params.view === 'trash' ? emptyState('The trash is empty', 'Items you delete wait here, so you can restore them.')
        : anyFilter ? emptyState('Nothing matches', 'Try fewer words, or clear the filters. Passwords and PINs are never searched.', h('button', { class: 'btn', type: 'button', onclick: () => { app.searchText = ''; if (location.hash === '#/vault') app.refresh(); else app.go('#/vault'); } }, 'Clear filters'))
          : emptyState('Your vault is empty', 'Add your first bank account, password or document. It takes under a minute.', linkButton('#/add', 'Add item', 'btn btn-primary', 'plus')));
      return;
    }
    const trash = params.view === 'trash';
    results.append(itemTable(all.slice(0, shown).map((it) => itemRow(it, { trash }))));
    if (all.length > shown) results.append(h('div', { class: 'center' }, h('button', { class: 'btn', type: 'button', onclick: () => { shown += PAGE_SIZE; draw(); } }, `Show more (${all.length - shown} left)`)));
    if (trash) results.append(h('div', { class: 'row end pad' }, h('button', { class: 'btn btn-danger-text', type: 'button', onclick: async () => {
      if (await confirmDialog({ title: 'Empty the trash?', body: `${all.length} item(s) and their files will be removed from every device. This cannot be undone.`, action: 'Empty trash', danger: true })) {
        for (const it of all) await app.vault.purge(it.id);
        toast('Trash emptied.'); draw();
      }
    } }, 'Empty trash')));
  };
  const sync = () => { history.replaceState(null, '', buildVaultHash({ ...params, q: '' })); draw(); };
  draw();

  return h('div', null,
    pageHead('Vault', null, linkButton('#/add', 'Add item', 'btn btn-primary', 'plus')),
    h('div', { class: 'filters' },
      h('div', { class: 'search-wrap' }, icon('search'), search),
      sel('f-cat', 'Category', params.cat, [['', 'All categories'], ...[...CATEGORIES, ...app.vault.customCategories()].map((c) => [c.id, c.label])], 'cat'),
      sel('f-view', 'Show', params.view, [['', 'All items'], ['favourites', 'Favourites'], ['trash', 'Trash']], 'view'),
      sel('f-sort', 'Sort by', params.sort, [['', 'Recently changed'], ['title', 'Title'], ['date', 'Document date'], ['expiry', 'Expiry'], ['category', 'Category']], 'sort')),
    count, results);
}

export function addPage() {
  const custom = app.vault.customCategories();
  return h('div', null,
    pageHead('Add item', 'Pick what you are storing.'),
    h('div', { class: 'add-grid' }, CATEGORIES.map((c) => h('section', { class: 'add-group', css: { '--cat': catVar(c.id) } },
      h('h2', null, c.label), h('p', { class: 'sub' }, c.hint),
      h('div', { class: 'add-list' }, TEMPLATES.filter((t) => t.cat === c.id).map((t) => h('a', { class: 'add-link', href: `#/new/${t.id}` }, t.label)))))),
    custom.length > 0 ? h('p', { class: 'sub pad' }, 'To use a custom category, pick any type above and change Category on the form.') : null);
}

function fieldRow(label, value, { secret = false, multiline = false, href = null, onCopy = true } = {}) {
  const shownValue = h('span', { class: multiline ? 'pre' : null }, secret ? '••••••••' : value);
  const buttons = [];
  if (secret) {
    let open = false;
    const eye = h('button', { class: 'btn-icon', type: 'button', 'aria-label': `Show ${label}`, 'aria-pressed': 'false', onclick: () => {
      open = !open;
      shownValue.textContent = open ? value : '••••••••';
      shownValue.classList.toggle('secret-open', open);
      eye.setAttribute('aria-label', `${open ? 'Hide' : 'Show'} ${label}`);
      eye.setAttribute('aria-pressed', String(open));
      eye.replaceChildren(icon(open ? 'eyeoff' : 'eye'));
    } }, icon('eye'));
    buttons.push(eye);
  }
  if (onCopy) buttons.push(h('button', { class: 'btn-icon', type: 'button', 'aria-label': `Copy ${label}`, onclick: () => copySecret(value, label) }, icon('copy')));
  return h('div', { class: 'kv' }, h('dt', null, label), h('dd', null,
    href ? h('a', { href, target: '_blank', rel: 'noreferrer noopener' }, value, ' ', icon('link', 14)) : shownValue,
    h('span', { class: 'kv-actions' }, buttons)));
}

function attachmentList(item, editable) {
  const list = h('div', { class: 'att-list' });
  const preview = h('div', { class: 'att-preview' });
  const draw = () => {
    clear(list);
    const atts = app.vault.attachmentsOf(item.id).filter((a) => app.vault.get(a.id));
    if (atts.length === 0) list.append(h('p', { class: 'sub' }, 'No files yet. Add a scan, photo or PDF.'));
    for (const a of atts) {
      const open = async (download) => {
        const bytes = await app.vault.readAttachment(a.id);
        if (!bytes) { toast('This file has not arrived on this device yet. Open Sync, then try again.', 'error'); return; }
        if (download) { downloadBytes(bytes, a.name, a.mime); return; }
        if (a.mime.startsWith('image/')) {
          const url = URL.createObjectURL(new Blob([bytes], { type: a.mime }));
          const img = h('img', { src: url, alt: `Preview of ${a.name}` });
          img.addEventListener('load', () => URL.revokeObjectURL(url));
          const read = 'TextDetector' in globalThis ? h('button', { class: 'btn btn-sm', type: 'button', onclick: () => readText(img, read) }, 'Read text from image') : null;
          preview.replaceChildren(img, read ?? h('p', { class: 'sub' }, 'Reading text from images is not available in this browser. Type anything you want to search for into Notes.'));
        } else if (a.mime === 'application/pdf') {
          const url = URL.createObjectURL(new Blob([bytes], { type: a.mime }));
          window.open(url, '_blank', 'noopener');
          setTimeout(() => URL.revokeObjectURL(url), 60_000);
        } else {
          // A blob page runs on this origin, so an attached web page must not open here.
          downloadBytes(bytes, a.name, 'application/octet-stream');
        }
      };
      list.append(h('div', { class: 'att' }, icon('file'),
        h('span', { class: 'att-name' }, a.name, h('span', { class: 'row-sub' }, formatBytes(a.size))),
        h('button', { class: 'btn btn-sm', type: 'button', 'aria-label': `Open ${a.name}`, onclick: () => open(false) }, 'Open'),
        h('button', { class: 'btn btn-sm', type: 'button', 'aria-label': `Download ${a.name}`, onclick: () => open(true) }, 'Download'),
        editable ? h('button', { class: 'btn btn-sm btn-danger-text', type: 'button', 'aria-label': `Remove ${a.name}`, onclick: async () => {
          if (await confirmDialog({ title: 'Remove this file?', body: `${a.name} will be removed from every device.`, action: 'Remove file', danger: true })) { await app.vault.removeAttachment(a.id); draw(); }
        } }, 'Remove') : null));
    }
  };
  async function readText(img, button) {
    // The browser's built-in detector is the light option. Where it is missing the app
    // still works, and the feature simply does not appear.
    try {
      const blocks = await new TextDetector().detect(img);
      const text = blocks.map((b) => b.rawValue).join('\n');
      if (!text) { toast('No text was found in this image.', 'error'); return; }
      await app.vault.putItem({ ...app.vault.get(item.id), notes: [app.vault.get(item.id).notes, text].filter(Boolean).join('\n\n').slice(0, LIMITS.notes) });
      toast('Text added to Notes.');
    } catch {
      toast('Could not read this image. Type the text into Notes instead.', 'error');
    }
    button.disabled = false;
  }
  draw();
  return h('div', null, list, preview,
    editable ? h('button', { class: 'btn', type: 'button', onclick: async () => {
      const files = await pickFile('image/*,application/pdf,.doc,.docx,.xls,.xlsx,.txt', true);
      for (const file of files) {
        try { await app.vault.addAttachment(item.id, file.name, file.type, await fileBytes(file)); } catch (e) { toast(e.message, 'error'); }
      }
      if (files.length > 0) { toast(`${files.length} file(s) added.`); draw(); }
    } }, icon('upload'), 'Add files') : null);
}

export function itemPage(route) {
  const it = app.vault.get(route.id);
  if (!it || it.k !== 'item') {
    return h('div', null, pageHead('Item not found'), emptyState('This item is not here', 'It may have been deleted on another device. Go back to the vault to find what you need.', linkButton('#/vault', 'Open vault', 'btn btn-primary')));
  }
  const tpl = TEMPLATE_BY_ID[it.t];
  const rows = [];
  for (const fd of tpl.fields) {
    const value = it.f[fd.k];
    if (!value) continue;
    const secret = fd.type === 'secret' || fd.type === 'pin' || fd.type === 'secretarea';
    let href = null;
    if (fd.type === 'url') { try { href = /^https?:$/.test(new URL(value).protocol) ? value : null; } catch { href = null; } }
    rows.push(fieldRow(fd.label, value, { secret, href, multiline: fd.type === 'secretarea' }));
  }
  const keys = new Set(tpl.fields.map((x) => x.k));
  for (const [k, v] of Object.entries(it.f)) if (!keys.has(k) && v) rows.push(fieldRow(k, v));
  if (it.doc) { const p = periodOf(it.doc); rows.push(fieldRow(tpl.doc ?? 'Date', `${formatDate(it.doc)} (${p.month}, ${p.week}, ${p.fy})`, { onCopy: false })); }
  if (it.exp) rows.push(h('div', { class: 'kv' }, h('dt', null, tpl.exp ?? 'Expiry'), h('dd', null, h('span', null, formatDate(it.exp)), ' ', expiryBadge(it.exp))));
  if (typeof it.amt === 'number') rows.push(fieldRow(tpl.amt ?? 'Amount', formatPaise(it.amt, { symbol: true }), { onCopy: false }));
  if (it.tags?.length) rows.push(fieldRow('Tags', it.tags.join(', '), { onCopy: false }));
  if (it.notes) rows.push(fieldRow('Notes', it.notes, { multiline: true }));

  const favBtn = h('button', { class: 'btn', type: 'button', 'aria-pressed': String(it.fav === 1), onclick: async () => { await app.vault.putItem({ ...app.vault.get(it.id), fav: it.fav === 1 ? 0 : 1 }); app.refresh(); } }, icon('star'), it.fav === 1 ? 'Remove favourite' : 'Add favourite');
  const inTrash = it.trash !== undefined;
  return h('div', null,
    pageHead(it.title, null, inTrash ? h('button', { class: 'btn', type: 'button', onclick: async () => { await app.vault.setTrash(it.id, false); toast('Item restored.'); app.refresh(); } }, 'Restore') : [
      favBtn,
      linkButton(`#/edit/${it.id}`, 'Edit', 'btn', 'edit'),
    ]),
    h('p', { class: 'row meta' }, catChip(it.c), h('span', { class: 'sub' }, tpl.label)),
    inTrash ? h('p', { class: 'notice' }, icon('warn'), 'This item is in the trash.') : null,
    h('section', { class: 'card spine', css: { '--cat': catVar(it.c) } }, rows.length > 0 ? h('dl', { class: 'kvs' }, rows) : h('p', { class: 'sub' }, 'No details saved yet. Choose Edit to add them.')),
    h('section', { class: 'card' }, h('h2', null, 'Files'), attachmentList(it, !inTrash)),
    h('p', { class: 'sub pad' }, `Added ${formatDateTime(it.cr)}, last changed ${formatDateTime(it.u)}`),
    !inTrash ? h('div', { class: 'row pad' }, h('button', { class: 'btn btn-danger-text', type: 'button', onclick: async () => {
      if (await confirmDialog({ title: 'Move to trash?', body: `${it.title} moves to the trash. You can restore it from there.`, action: 'Move to trash', danger: true })) {
        await app.vault.setTrash(it.id, true); toast('Moved to trash.'); app.go('#/vault');
      }
    } }, icon('trash'), 'Move to trash')) : null);
}

function secretInput(fd, value, id) {
  const input = h('input', { id, name: fd.k, type: 'password', value, autocomplete: 'off', spellcheck: 'false', autocapitalize: 'none', inputmode: fd.type === 'pin' ? 'numeric' : null, 'data-lpignore': 'true' });
  const eye = h('button', { class: 'btn-icon', type: 'button', 'aria-label': `Show ${fd.label}`, 'aria-pressed': 'false', onclick: () => {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    eye.setAttribute('aria-label', `${show ? 'Hide' : 'Show'} ${fd.label}`);
    eye.setAttribute('aria-pressed', String(show));
    eye.replaceChildren(icon(show ? 'eyeoff' : 'eye'));
  } }, icon('eye'));
  const parts = [input, eye];
  let meter = null;
  if (fd.type === 'secret') {
    meter = h('p', { class: 'hint', 'aria-live': 'polite' });
    const rate = () => { meter.textContent = input.value ? `Strength: ${strengthLabel(passwordBits(input.value))}` : ''; };
    input.addEventListener('input', rate);
    rate();
    parts.push(h('button', { class: 'btn-icon', type: 'button', 'aria-label': `Generate ${fd.label}`, title: 'Generate a strong password', onclick: () => {
      input.value = generatePassword({ length: 20 });
      input.type = 'text';
      eye.replaceChildren(icon('eyeoff'));
      rate();
    } }, icon('dice')));
  }
  return [h('div', { class: 'input-row' }, parts), meter];
}

function dateField(id, label, value) {
  const today = todayIst(app.now());
  const input = h('input', { id, name: id, type: 'text', inputmode: 'numeric', value: value ? formatDate(value) : '', placeholder: 'dd/mm/yyyy', autocomplete: 'off', 'aria-describedby': `${id}-hint` });
  const hint = h('p', { class: 'hint', id: `${id}-hint` }, 'Day first, for example 28/10/2026 or 28/10.');
  const update = () => {
    if (input.value.trim() === '') { hint.textContent = 'Day first, for example 28/10/2026 or 28/10.'; return; }
    const r = parseTypedDate(input.value, today);
    if (r.ok) { const p = periodOf(r.iso); hint.textContent = `${p.month}, ${p.week}, ${p.fy}`; }
  };
  input.addEventListener('blur', () => { const r = parseTypedDate(input.value, today); if (input.value.trim() && r.ok) input.value = formatDate(r.iso); update(); });
  update();
  return { input, el: h('div', { class: 'field' }, h('label', { for: id }, label), input, hint, h('p', { class: 'field-error', id: `${id}-err` })) };
}

/** Add `https://` when someone types a bare site name; refuse any other scheme. */
function normaliseUrl(text) {
  const s = text.trim();
  if (s === '') return { ok: true, value: '' };
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('scheme');
    return { ok: true, value: withScheme };
  } catch {
    return { ok: false, error: 'Use a web address such as https://example.com.' };
  }
}

export function editPage(route) {
  const existing = route.page === 'edit' ? app.vault.get(route.id) : null;
  if (route.page === 'edit' && !existing) return itemPage(route);
  const tpl = TEMPLATE_BY_ID[existing?.t ?? route.template];
  const id = existing?.id ?? newId('r');
  const d = existing ?? { c: tpl.cat, f: {}, doc: '', exp: '', amt: null, tags: [], notes: '', fav: 0 };
  const today = todayIst(app.now());

  const title = h('input', { id: 'f-title', name: 'title', type: 'text', value: d.title ?? '', maxlength: LIMITS.title, autocomplete: 'off', spellcheck: 'false', required: true });
  const titleErr = h('p', { class: 'field-error', id: 'f-title-err' });
  const cat = h('select', { id: 'f-category', name: 'category' }, categoryOptions(d.c));
  const inputs = new Map();
  const fieldEls = tpl.fields.map((fd) => {
    const fid = `f-${fd.k}`;
    const value = d.f[fd.k] ?? '';
    let control;
    if (fd.type === 'secret' || fd.type === 'pin') {
      const parts = secretInput(fd, value, fid);
      control = parts;
      inputs.set(fd, parts[0].querySelector('input'));
    } else if (fd.type === 'secretarea') {
      const ta = h('textarea', { id: fid, rows: 3, value, spellcheck: 'false', autocomplete: 'off' });
      control = ta; inputs.set(fd, ta);
    } else if (fd.type === 'select') {
      const opts = fd.options.includes(value) || !value ? fd.options : [value, ...fd.options];
      const s = h('select', { id: fid }, h('option', { value: '' }, 'Choose'), opts.map((o) => h('option', { value: o, selected: o === value }, o)));
      control = s; inputs.set(fd, s);
    } else {
      const input = h('input', {
        id: fid, type: fd.type === 'url' ? 'url' : 'text', value, autocomplete: 'off', spellcheck: 'false',
        inputmode: fd.type === 'url' ? 'url' : fd.digits ? 'numeric' : null,
        list: fd.list ? 'institution-list' : null, autocapitalize: fd.type === 'url' || fd.type === 'ref' ? 'none' : null,
      });
      control = input; inputs.set(fd, input);
    }
    return h('div', { class: 'field' }, h('label', { for: fid }, fd.label), control, h('p', { class: 'field-error', id: `${fid}-err` }));
  });

  const docF = tpl.doc || existing?.doc ? dateField('f-doc', tpl.doc ?? 'Document date', d.doc) : null;
  const expF = tpl.exp || existing?.exp ? dateField('f-exp', tpl.exp ?? 'Expiry date', d.exp) : null;
  const amtInput = h('input', { id: 'f-amt', type: 'text', inputmode: 'decimal', value: typeof d.amt === 'number' ? formatPaise(d.amt) : '', placeholder: '1,23,456.78', autocomplete: 'off' });
  const amtErr = h('p', { class: 'field-error', id: 'f-amt-err' });
  const amtF = tpl.amt || typeof d.amt === 'number' ? h('div', { class: 'field' }, h('label', { for: 'f-amt' }, `${tpl.amt ?? 'Amount'} (₹)`), amtInput, amtErr) : null;
  const tags = h('input', { id: 'f-tags', type: 'text', value: (d.tags ?? []).join(', '), autocomplete: 'off', spellcheck: 'false' });
  const notes = h('textarea', { id: 'f-notes', rows: 4, value: d.notes ?? '', spellcheck: 'false', maxlength: LIMITS.notes, autocomplete: 'off' });
  const fav = h('input', { id: 'f-fav', type: 'checkbox', checked: d.fav === 1 });
  const pending = [];
  const pendingList = h('ul', { class: 'pending' });
  const summary = h('p', { class: 'form-error', role: 'alert', tabindex: '-1' });

  const setErr = (input, errEl, msg) => {
    errEl.textContent = msg;
    if (msg) { input.setAttribute('aria-invalid', 'true'); input.setAttribute('aria-describedby', errEl.id); } else input.removeAttribute('aria-invalid');
  };

  const save = async (e) => {
    e.preventDefault();
    let first = null;
    const fail = (input, errEl, msg) => { setErr(input, errEl, msg); first ??= input; };
    setErr(title, titleErr, '');
    if (!title.value.trim()) fail(title, titleErr, 'Add a title so you can find this item later.');
    const f = {};
    for (const [fd, input] of inputs) {
      const errEl = document.getElementById(`f-${fd.k}-err`);
      setErr(input, errEl, '');
      let v = input.value;
      if (fd.type !== 'secret' && fd.type !== 'pin' && fd.type !== 'secretarea') v = v.trim();
      if (fd.type === 'url') {
        const r = normaliseUrl(v);
        if (!r.ok) { fail(input, errEl, r.error); continue; }
        v = r.value;
      }
      if (fd.type === 'pin' && v && !/^\d{3,12}$/.test(v) && fd.k !== 'mpin') { fail(input, errEl, 'Use 3 to 12 digits.'); continue; }
      if (v) f[fd.k] = v;
    }
    for (const [k, v] of Object.entries(d.f)) if (!tpl.fields.some((x) => x.k === k)) f[k] = v;
    const readDate = (fld) => {
      if (!fld) return '';
      const errEl = fld.el.querySelector('.field-error');
      setErr(fld.input, errEl, '');
      if (!fld.input.value.trim()) return '';
      const r = parseTypedDate(fld.input.value, today);
      if (!r.ok) { fail(fld.input, errEl, r.error); return ''; }
      return r.iso;
    };
    const doc = readDate(docF);
    const exp = readDate(expF);
    let amt = null;
    if (amtF) {
      setErr(amtInput, amtErr, '');
      if (amtInput.value.trim()) {
        const r = parseRupees(amtInput.value);
        if (r.ok) amt = r.paise; else fail(amtInput, amtErr, r.error);
      }
    }
    if (first) { summary.textContent = 'Fix the marked field, then save again.'; first.focus(); return; }
    summary.textContent = '';
    const draft = {
      ...d, id, k: 'item', t: tpl.id, c: cat.value, title: title.value.trim(), f, doc, exp, amt,
      tags: tags.value.split(/[,;]/).map((s) => s.trim()).filter(Boolean).slice(0, LIMITS.tags),
      notes: notes.value, fav: fav.checked ? 1 : 0,
    };
    try {
      await app.vault.putItem(draft);
      for (const file of pending) await app.vault.addAttachment(id, file.name, file.type, await fileBytes(file));
      app.dirtyForm = false;
      toast('Item saved.');
      app.go(`#/item/${id}`);
    } catch (err) {
      summary.textContent = err instanceof VaultError ? err.message : `Could not save: ${err.message}`;
    }
  };

  const form = h('form', { class: 'item-form', novalidate: true, onsubmit: save, oninput: () => { app.dirtyForm = true; } },
    h('section', { class: 'card spine', css: { '--cat': catVar(d.c) } },
      h('div', { class: 'field' }, h('label', { for: 'f-title' }, 'Title (required)'), title, titleErr),
      h('div', { class: 'field' }, h('label', { for: 'f-category' }, 'Category'), cat),
      h('div', { class: 'form-grid' }, fieldEls, docF?.el, expF?.el, amtF)),
    h('section', { class: 'card' },
      h('div', { class: 'field' }, h('label', { for: 'f-tags' }, 'Tags'), tags, h('p', { class: 'hint' }, 'Separate with commas.')),
      h('div', { class: 'field' }, h('label', { for: 'f-notes' }, 'Notes'), notes),
      h('label', { class: 'check', for: 'f-fav' }, fav, h('span', null, 'Show on Home as a favourite')),
      h('div', { class: 'field' },
        h('button', { class: 'btn', type: 'button', onclick: async () => {
          for (const file of await pickFile('image/*,application/pdf,.doc,.docx,.xls,.xlsx,.txt', true)) {
            if (file.size > MAX_FILE_BYTES) { toast(`${file.name} is larger than 25 MB. Compress it, then add it again.`, 'error'); continue; }
            pending.push(file);
            pendingList.append(h('li', null, file.name));
          }
        } }, icon('upload'), 'Add files'), pendingList)),
    summary,
    h('div', { class: 'form-bar' },
      h('a', { class: 'btn', href: existing ? `#/item/${id}` : '#/add', onclick: () => { app.dirtyForm = false; } }, 'Cancel'),
      h('button', { class: 'btn btn-primary', type: 'submit' }, existing ? 'Save changes' : 'Save item')));

  const list = h('datalist', { id: 'institution-list' }, DEFAULT_INSTITUTIONS.map((x) => h('option', { value: x })));
  return h('div', null, pageHead(existing ? `Edit ${existing.title}` : `New ${tpl.label.toLowerCase()}`, categoryLabel(d.c, app.vault.customCategories())), list, form);
}

