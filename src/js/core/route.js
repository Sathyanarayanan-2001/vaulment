// The address hash is the only "query" this app has. It can be typed or pasted, so it is
// validated against a closed list before anything uses it.

import { CATEGORY_IDS, TEMPLATE_BY_ID, ID_PATTERN } from './schema.js';

export const PAGES = ['home', 'vault', 'add', 'dashboard', 'reminders', 'health', 'sync', 'transfer', 'settings', 'guide', 'more'];
const PAGE_SET = new Set(PAGES);
const SORTS = new Set(['updated', 'title', 'date', 'expiry', 'category']);
const VIEWS = new Set(['all', 'favourites', 'trash']);
export const MAX_QUERY = 200;

/** @returns {{page:string, id?:string, template?:string, params:object, error?:string}} */
export function parseRoute(hash) {
  const raw = String(hash ?? '').replace(/^#\/?/, '');
  const [pathPart, queryPart = ''] = raw.split('?');
  const path = pathPart.split('/').filter(Boolean);
  const params = {};
  const home = (error) => ({ page: 'home', params: {}, error });

  if (path.length === 0) return { page: 'home', params };
  const head = path[0];

  if (head === 'item' || head === 'edit') {
    if (path.length !== 2 || !ID_PATTERN.test(path[1])) return home('That link does not point to a valid item. Pick one from the vault.');
    return { page: head, id: path[1], params };
  }
  if (head === 'new') {
    if (path.length !== 2 || !Object.hasOwn(TEMPLATE_BY_ID, path[1])) return home('That item type does not exist. Use Add item to pick one.');
    return { page: 'new', template: path[1], params };
  }
  if (path.length !== 1 || !PAGE_SET.has(head)) return home('That page does not exist, so you are back on Home.');

  if (head === 'vault') {
    for (const pair of queryPart.split('&').filter(Boolean)) {
      const eq = pair.indexOf('=');
      const key = eq < 0 ? pair : pair.slice(0, eq);
      let value;
      try {
        value = decodeURIComponent((eq < 0 ? '' : pair.slice(eq + 1)).replace(/\+/g, ' '));
      } catch {
        return { page: 'vault', params: {}, error: 'That search link is damaged, so the filters were cleared.' };
      }
      if (key === 'cat' && (CATEGORY_IDS.has(value) || ID_PATTERN.test(value))) params.cat = value;
      else if (key === 'sort' && SORTS.has(value)) params.sort = value;
      else if (key === 'view' && VIEWS.has(value)) params.view = value;
      else if (key === 'q') params.q = value.slice(0, MAX_QUERY);
      else return { page: 'vault', params: {}, error: 'That search link has a setting the vault does not recognise, so the filters were cleared.' };
    }
  }
  return { page: head, params };
}

export function buildVaultHash(params) {
  const q = new URLSearchParams();
  for (const k of ['q', 'cat', 'sort', 'view']) if (params[k]) q.set(k, params[k]);
  const s = q.toString();
  return s ? `#/vault?${s}` : '#/vault';
}
