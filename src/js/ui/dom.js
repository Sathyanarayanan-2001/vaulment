// DOM building. Every value reaches the page as a text node or a checked attribute, and
// the Content-Security-Policy turns on Trusted Types, so markup can never be injected
// through a title, a note or an imported cell.

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Only these targets may go in an href. Anything else, javascript: included, is dropped. */
export function safeHref(url) {
  const s = String(url ?? '').trim();
  if (s.startsWith('#/') || s.startsWith('blob:')) return s;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}

function applyProps(el, props) {
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') el.setAttribute('class', value);
    else if (key === 'css') for (const [p, v] of Object.entries(value)) el.style.setProperty(p, v);
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key === 'value' || key === 'checked') el[key] = value;
    else if (key === 'href') { const safe = safeHref(value); if (safe) el.setAttribute('href', safe); }
    else el.setAttribute(key, value === true ? '' : String(value));
  }
}

function append(el, kids) {
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
}

export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  applyProps(el, props);
  append(el, kids);
  return el;
}

const ICONS = {
  home: 'M4 11l8-7 8 7v9h-5v-6H9v6H4z',
  vault: 'M4 4h16v16H4zM12 9a3 3 0 100 6 3 3 0 000-6zM12 9V7M12 17v-2M15 12h2M7 12h2',
  plus: 'M12 5v14M5 12h14',
  chart: 'M5 20V10M12 20V4M19 20v-7',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  bell: 'M6 16V11a6 6 0 1112 0v5l2 2H4zM10 21h4',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.500-1-8-4-8-9V6z',
  sync: 'M4 12a8 8 0 0113.700-5.600L20 8.500M20 4v4.500h-4.500M20 12a8 8 0 01-13.700 5.600L4 15.500M4 20v-4.500h4.500',
  swap: 'M7 4v13M3 13l4 4 4-4M17 20V7M13 11l4-4 4 4',
  gear: 'M12 9a3 3 0 100 6 3 3 0 000-6zM19 12l2-1-2-4-2 1-2-2V4h-6v2L7 8 5 7l-2 4 2 1v2l-2 1 2 4 2-1 2 2v2h6v-2l2-2 2 1 2-4-2-1z',
  book: 'M5 4h6a2 2 0 012 2v14a2 2 0 00-2-2H5zM19 4h-6M19 4v14h-6',
  lock: 'M6 11h12v9H6zM9 11V8a3 3 0 016 0v3',
  sun: 'M12 8a4 4 0 100 8 4 4 0 000-8zM12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.500 1.500M17.500 17.500L19 19M19 5l-1.500 1.500M6.500 17.500L5 19',
  moon: 'M20 14a8 8 0 01-10-10 8 8 0 1010 10z',
  auto: 'M12 3a9 9 0 100 18zM12 3a9 9 0 010 18',
  star: 'M12 4l2.500 5 5.500.800-4 3.900 1 5.500-5-2.600-5 2.600 1-5.500-4-3.900 5.500-.800z',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 100 6 3 3 0 000-6z',
  eyeoff: 'M3 3l18 18M10.500 6.200C11 6.100 11.500 6 12 6c6 0 10 6 10 6a18 18 0 01-3 3.500M6.500 7.500A18 18 0 002 12s4 6 10 6c1.500 0 2.800-.3 4-.9',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13 7l4 4',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  file: 'M6 3h8l4 4v14H6zM14 3v4h4',
  dice: 'M4 4h16v16H4zM8.500 8.500h.01M15.500 15.500h.01M12 12h.01',
  check: 'M4 12l5 5L20 6',
  warn: 'M12 4l9 16H3zM12 10v4M12 17h.01',
  cross: 'M6 6l12 12M18 6L6 18',
  search: 'M11 4a7 7 0 100 14 7 7 0 000-14zM20 20l-4-4',
  cloud: 'M7 18a4 4 0 010-8 6 6 0 0111.500 1.500A3.500 3.500 0 0118 18z',
  upload: 'M12 16V5M7 9l5-5 5 5M4 20h16',
  down: 'M12 4v11M7 10l5 5 5-5M4 20h16',
  link: 'M14 5h5v5M19 5l-8 8M10 5H5v14h14v-5',
};

export function icon(name, size = 18) {
  const el = document.createElementNS(SVG_NS, 'svg');
  for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' })) el.setAttribute(k, v);
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', ICONS[name] ?? ICONS.file);
  el.append(path);
  return el;
}

export const clear = (el) => el.replaceChildren();

let toastHost = null;

/** Announce a result. role=status reaches screen readers; errors stay until read. */
export function toast(message, kind = 'ok') {
  toastHost ??= document.body.appendChild(h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }));
  const el = h('div', { class: `toast toast-${kind}` }, icon(kind === 'error' ? 'warn' : 'check'), h('span', null, message));
  toastHost.append(el);
  setTimeout(() => el.remove(), kind === 'error' ? 8000 : 3500);
}

/** A modal on <dialog>, which gives focus trapping and Escape handling without extra code. */
function modal(build) {
  return new Promise((resolve) => {
    const dialog = h('dialog', { class: 'dialog' });
    const close = (value) => { dialog.close(); dialog.remove(); resolve(value); };
    dialog.addEventListener('cancel', (e) => { e.preventDefault(); close(null); });
    build(dialog, close);
    document.body.append(dialog);
    dialog.showModal();
  });
}

export function confirmDialog({ title, body, action, danger = false }) {
  return modal((d, close) => {
    d.append(
      h('h2', null, title), h('p', null, body),
      h('div', { class: 'row end' },
        h('button', { class: 'btn', type: 'button', onclick: () => close(false) }, 'Cancel'),
        h('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, type: 'button', onclick: () => close(true) }, action)),
    );
  }).then(Boolean);
}

/** Ask for the master password again before something sensitive. Resolves to it, or null. */
export function askPassword({ title, body, action, check }) {
  return modal((d, close) => {
    const input = h('input', { type: 'password', id: 'dlg-pw', autocomplete: 'current-password', spellcheck: 'false' });
    const err = h('p', { class: 'field-error', role: 'alert' });
    const form = h('form', {
      novalidate: true,
      onsubmit: async (e) => {
        e.preventDefault();
        if (await check(input.value)) close(input.value);
        else { err.textContent = 'That password is not right. Try again.'; input.select(); }
      },
    },
    h('h2', null, title), h('p', null, body),
    h('label', { for: 'dlg-pw' }, 'Master password'), input, err,
    h('div', { class: 'row end' },
      h('button', { class: 'btn', type: 'button', onclick: () => close(null) }, 'Cancel'),
      h('button', { class: 'btn btn-primary', type: 'submit' }, action)));
    d.append(form);
  });
}

export function downloadBytes(bytes, name, mime) {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = h('a', { href: url, download: name, class: 'hidden' });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export const pickFile = (accept, multiple = false) => new Promise((resolve) => {
  const done = () => { resolve([...input.files]); input.remove(); };
  const input = h('input', { type: 'file', accept, multiple, class: 'hidden', onchange: done, oncancel: done });
  document.body.append(input);
  input.click();
});

export const fileBytes = async (file) => new Uint8Array(await file.arrayBuffer());
