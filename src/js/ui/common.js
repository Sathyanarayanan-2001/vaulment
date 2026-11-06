import { h, icon, toast } from './dom.js';
import { app, prefs } from './state.js';
import { CATEGORY_BY_ID, TEMPLATE_BY_ID, categoryLabel, secretKeysOf } from '../core/schema.js';
import { daysBetween, formatDate, todayIst } from '../core/dates.js';
import { MS_PER_SECOND } from '../core/units.js';

export const catVar = (id) => `var(--c${CATEGORY_BY_ID[id]?.slot ?? 0})`;

export const catChip = (id) => h('span', { class: 'chip', css: { '--cat': catVar(id) } }, h('i', { class: 'dot' }), categoryLabel(id, app.vault.customCategories()));

/** Status always pairs an icon and words with its colour, so colour is never the only signal. */
export function expiryBadge(exp) {
  if (!exp) return null;
  const left = daysBetween(todayIst(app.now()), exp);
  if (left < 0) return h('span', { class: 'badge badge-red' }, icon('warn', 14), `Expired ${formatDate(exp)}`);
  if (left === 0) return h('span', { class: 'badge badge-red' }, icon('warn', 14), 'Expires today');
  if (left <= 30) return h('span', { class: 'badge badge-amber' }, icon('bell', 14), `${left} day${left === 1 ? '' : 's'} left`);
  if (left <= 90) return h('span', { class: 'badge badge-amber' }, icon('bell', 14), `Due ${formatDate(exp)}`);
  return h('span', { class: 'badge' }, formatDate(exp));
}

let clipTimer = null;

/** Copy a secret, then blank the clipboard. Browsers allow that only while the tab has
 *  focus, so the toast states the plan rather than promising it. */
export async function copySecret(text, label) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    toast('Copying was blocked by the browser. Show the value and copy it by hand.', 'error');
    return;
  }
  const seconds = prefs.get('clipSeconds', 30);
  toast(`${label} copied. The clipboard clears in ${seconds} seconds.`);
  clearTimeout(clipTimer);
  clipTimer = setTimeout(() => { navigator.clipboard.writeText('').catch(() => {}); }, seconds * MS_PER_SECOND);
}

export const mainSecretOf = (item) => {
  const keys = secretKeysOf(item.t);
  if (keys.includes('pass') && item.f.pass) return { label: 'Password', value: item.f.pass };
  if (item.f.pin) return { label: 'PIN', value: item.f.pin };
  return null;
};

export function maskNumber(value) {
  if (!value) return '';
  return value.length <= 4 ? value : `•••• ${value.slice(-4)}`;
}

/** One line a list row can show safely: no secrets, long numbers cut to their last four. */
export function itemSummary(item) {
  const f = item.f;
  return [f.institution, f.kind, f.user, maskNumber(f.number)].filter(Boolean).slice(0, 2).join(', ') || TEMPLATE_BY_ID[item.t].label;
}

export const emptyState = (title, body, action) => h('div', { class: 'empty' }, h('h3', null, title), h('p', null, body), action);

export const linkButton = (href, text, cls = 'btn', iconName) => h('a', { class: cls, href }, iconName ? icon(iconName) : null, text);

export const pageHead = (title, sub, actions) => h('header', { class: 'page-head' },
  h('div', null, h('h1', { tabindex: '-1' }, title), sub ? h('p', { class: 'sub' }, sub) : null),
  actions ? h('div', { class: 'row' }, actions) : null);
