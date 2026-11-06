import { isValidIso } from './dates.js';
import { MAX_PAISE } from './money.js';

// Colour slot is tied to the category id, not to its rank in any chart, so a category
// keeps its colour whatever else is on screen.
export const CATEGORIES = [
  { id: 'banking', label: 'Banking', slot: 1, hint: 'Accounts, cards, online PINs, passbooks' },
  { id: 'records', label: 'Indian records', slot: 2, hint: 'Voter ID, DigiLocker, income tax, TRACES, PF, CKYC, investments' },
  { id: 'office', label: 'Office', slot: 3, hint: 'Salary letters, insurance, variable pay' },
  { id: 'online', label: 'Online accounts', slot: 4, hint: 'Apple, Google, Facebook, OneDrive, Netflix' },
  { id: 'medical', label: 'Medical', slot: 5, hint: 'Health checks, scan reports' },
  { id: 'warranty', label: 'Warranty', slot: 6, hint: 'Bills and warranty cards' },
  { id: 'education', label: 'Education and career', slot: 7, hint: 'College and school documents, resume' },
  { id: 'other', label: 'Other', slot: 8, hint: 'Anything else' },
];
export const CATEGORY_IDS = new Set(CATEGORIES.map((c) => c.id));
export const CATEGORY_BY_ID = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));

export const DEFAULT_INSTITUTIONS = ['HDFC', 'UCO Bank', 'Indian Bank', 'Cash wallet'];

const RECORD_DOCS = ['Voter ID', 'PAN', 'Aadhaar', 'Passport', 'Driving licence', 'DigiLocker', 'Employment registration', 'Income tax', 'TRACES', 'PF (EPFO)', 'EY process pay', 'CKYC', 'Investment', 'Other'];

// Field types drive the keyboard, masking and validation.
// text: free text · ref: long number kept as text · secret: masked · pin: masked digits
const f = (k, label, type = 'text', extra = {}) => ({ k, label, type, ...extra });

export const TEMPLATES = [
  { id: 'bank_account', label: 'Bank account', cat: 'banking', fields: [
    f('institution', 'Bank', 'text', { list: 'institutions' }), f('holder', 'Account holder'), f('number', 'Account number', 'ref', { digits: true }),
    f('ifsc', 'IFSC'), f('branch', 'Branch'), f('cif', 'Customer ID (CIF)', 'ref', { digits: true }), f('url', 'Net banking address', 'url'),
    f('user', 'Net banking user ID'), f('pass', 'Login password', 'secret'), f('txn', 'Transaction password', 'secret'), f('mpin', 'Mobile PIN', 'pin'),
  ] },
  { id: 'card', label: 'Debit or credit card', cat: 'banking', amt: 'Credit limit', exp: 'Valid until', fields: [
    f('institution', 'Bank', 'text', { list: 'institutions' }), f('cardType', 'Card type', 'select', { options: ['Debit', 'Credit', 'Prepaid'] }),
    f('network', 'Network', 'select', { options: ['RuPay', 'Visa', 'Mastercard', 'Other'] }), f('holder', 'Name on card'), f('number', 'Card number', 'ref', { digits: true }),
    f('cvv', 'CVV', 'pin'), f('pin', 'ATM PIN', 'pin'), f('ipin', 'Online PIN', 'pin'),
  ] },
  { id: 'gov_record', label: 'Indian record', cat: 'records', doc: 'Issue date', exp: 'Valid until', fields: [
    f('kind', 'Record', 'select', { options: RECORD_DOCS }), f('holder', 'Name on record'), f('number', 'ID or reference number', 'ref'),
    f('url', 'Portal address', 'url'), f('user', 'Portal user ID'), f('pass', 'Portal password', 'secret'),
  ] },
  { id: 'investment', label: 'Investment', cat: 'records', doc: 'Start date', exp: 'Maturity date', amt: 'Amount invested', fields: [
    f('institution', 'Held with', 'text'), f('number', 'Folio or reference number', 'ref'), f('url', 'Portal address', 'url'), f('user', 'Portal user ID'), f('pass', 'Portal password', 'secret'),
  ] },
  { id: 'office_doc', label: 'Office document', cat: 'office', doc: 'Document date', amt: 'Amount', fields: [
    f('kind', 'Document', 'select', { options: ['Salary letter', 'Variable pay', 'Offer letter', 'Appraisal', 'Form 16', 'Other'] }), f('institution', 'Employer'), f('number', 'Reference number', 'ref'),
  ] },
  { id: 'insurance', label: 'Insurance policy', cat: 'office', doc: 'Start date', exp: 'Renewal date', amt: 'Sum insured', fields: [
    f('institution', 'Insurer'), f('number', 'Policy number', 'ref'), f('kind', 'Cover', 'select', { options: ['Health', 'Term life', 'Vehicle', 'Home', 'Other'] }), f('url', 'Portal address', 'url'), f('user', 'Portal user ID'), f('pass', 'Portal password', 'secret'),
  ] },
  { id: 'login', label: 'Online account', cat: 'online', fields: [
    f('url', 'Website', 'url'), f('user', 'User name or email'), f('pass', 'Password', 'secret'), f('recovery', 'Recovery codes or hints', 'secretarea'),
  ] },
  { id: 'medical', label: 'Medical document', cat: 'medical', doc: 'Report date', fields: [
    f('institution', 'Hospital or lab'), f('kind', 'Report', 'select', { options: ['Health check', 'Scan report', 'Blood test', 'Prescription', 'Discharge summary', 'Other'] }), f('doctor', 'Doctor'),
  ] },
  { id: 'warranty', label: 'Warranty', cat: 'warranty', doc: 'Purchase date', exp: 'Warranty ends', amt: 'Purchase price', fields: [
    f('institution', 'Brand or seller'), f('model', 'Product model'), f('number', 'Serial number', 'ref'),
  ] },
  { id: 'education', label: 'Education document', cat: 'education', doc: 'Issue date', fields: [
    f('institution', 'School or college'), f('kind', 'Document', 'select', { options: ['Mark sheet', 'Degree certificate', 'Transfer certificate', 'Course certificate', 'Other'] }), f('number', 'Register number', 'ref'),
  ] },
  { id: 'resume', label: 'Resume', cat: 'education', doc: 'Last updated', fields: [f('institution', 'Written for (optional)')] },
  { id: 'document', label: 'Any other document', cat: 'other', doc: 'Document date', exp: 'Valid until', amt: 'Amount', fields: [
    f('institution', 'Issued by'), f('number', 'Reference number', 'ref'),
  ] },
  { id: 'note', label: 'Secure note', cat: 'other', fields: [] },
];
export const TEMPLATE_BY_ID = Object.fromEntries(TEMPLATES.map((t) => [t.id, t]));

export const ID_PATTERN = /^[a-z]_[a-z0-9]{8,32}$/;
const KEY_PATTERN = /^[a-z][a-zA-Z0-9]{0,31}$/;
// These are valid JSON keys, but they must not become property names on anything.
const FORBIDDEN_KEYS = new Set(['constructor', 'prototype', 'toString', 'valueOf', 'hasOwnProperty']);

export const LIMITS = { title: 200, field: 4000, notes: 20000, tags: 20, tag: 40, fileName: 255, category: 40 };
export const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB = 26,214,400 bytes

const isStamp = (n) => Number.isSafeInteger(n) && n >= 0;

/**
 * Validate an item. Runs on save, on import and on every record read from a save file,
 * because a file in a shared folder is untrusted input.
 * @returns {string[]} problems in plain words; empty when valid
 */
export function validateItem(rec, customCategoryIds = null) {
  const e = [];
  if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return ['The record is not an object.'];
  if (!ID_PATTERN.test(rec.id ?? '')) e.push('The record id is not valid.');
  if (rec.k !== 'item') e.push('The record kind is not valid.');
  if (!isStamp(rec.u) || !isStamp(rec.cr)) e.push('The record has a bad time stamp.');
  if (!Object.hasOwn(TEMPLATE_BY_ID, rec.t ?? '')) e.push('The item type is not recognised.');
  const knownCat = CATEGORY_IDS.has(rec.c) || (ID_PATTERN.test(rec.c ?? '') && (customCategoryIds === null || customCategoryIds.has(rec.c)));
  if (!knownCat) e.push('The category is not recognised.');
  if (typeof rec.title !== 'string' || rec.title.trim() === '') e.push('Add a title so you can find this item later.');
  else if (rec.title.length > LIMITS.title) e.push(`Keep the title under ${LIMITS.title} characters.`);
  if (rec.f === null || typeof rec.f !== 'object' || Array.isArray(rec.f)) e.push('The fields are not valid.');
  else {
    for (const [k, v] of Object.entries(rec.f)) {
      if (!KEY_PATTERN.test(k) || FORBIDDEN_KEYS.has(k)) e.push(`Field name "${k.slice(0, 40)}" is not allowed.`);
      else if (typeof v !== 'string') e.push(`Field ${k} must be text.`);
      else if (v.length > LIMITS.field) e.push(`Field ${k} is longer than ${LIMITS.field} characters.`);
    }
  }
  if (rec.doc && !isValidIso(rec.doc)) e.push('The document date is not a real date.');
  if (rec.exp && !isValidIso(rec.exp)) e.push('The expiry date is not a real date.');
  if (rec.amt !== null && rec.amt !== undefined && !(Number.isSafeInteger(rec.amt) && rec.amt >= 0 && rec.amt <= MAX_PAISE)) e.push('The amount must be whole paise.');
  if (rec.notes !== undefined && (typeof rec.notes !== 'string' || rec.notes.length > LIMITS.notes)) e.push(`Keep notes under ${LIMITS.notes} characters.`);
  if (!Array.isArray(rec.tags) || rec.tags.length > LIMITS.tags || rec.tags.some((t) => typeof t !== 'string' || t.length > LIMITS.tag)) e.push(`Use at most ${LIMITS.tags} short tags.`);
  if (rec.fav !== 0 && rec.fav !== 1) e.push('The favourite flag is not valid.');
  if (rec.trash !== undefined && !isStamp(rec.trash)) e.push('The trash time is not valid.');
  if (rec.pwu !== undefined && !isStamp(rec.pwu)) e.push('The password date is not valid.');
  return e;
}

export function validateAttachment(rec) {
  const e = [];
  if (!rec || typeof rec !== 'object') return ['The attachment is not an object.'];
  if (!ID_PATTERN.test(rec.id ?? '')) e.push('The attachment id is not valid.');
  if (rec.k !== 'att') e.push('The attachment kind is not valid.');
  if (!ID_PATTERN.test(rec.item ?? '')) e.push('The attachment parent is not valid.');
  if (typeof rec.name !== 'string' || rec.name === '' || rec.name.length > LIMITS.fileName) e.push('The file name is not valid.');
  if (typeof rec.mime !== 'string' || rec.mime.length > 100) e.push('The file type is not valid.');
  if (!Number.isSafeInteger(rec.size) || rec.size < 0 || rec.size > MAX_FILE_BYTES) e.push('The file size is not valid.');
  if (!isStamp(rec.u) || !isStamp(rec.cr)) e.push('The attachment has a bad time stamp.');
  return e;
}

export function validateConfig(rec) {
  const e = [];
  if (rec?.k !== 'cfg' || !isStamp(rec.u) || !Array.isArray(rec.cats)) return ['The settings record is not valid.'];
  for (const c of rec.cats) {
    if (!ID_PATTERN.test(c?.id ?? '') || typeof c.label !== 'string' || c.label.trim() === '' || c.label.length > LIMITS.category) e.push('A custom category is not valid.');
  }
  return e;
}

export const CONFIG_ID = 'c_categories';

/** Validate any stored record, tombstones included. */
export function validateAny(id, rec) {
  if (!ID_PATTERN.test(id)) return ['The record id is not valid.'];
  if (rec?.d === 1) {
    return isStamp(rec.u) && Object.keys(rec).length === 2 ? [] : ['The deletion marker is not valid.'];
  }
  if (rec?.id !== id) return ['The record id does not match its key.'];
  if (rec.k === 'item') return validateItem(rec);
  if (rec.k === 'att') return validateAttachment(rec);
  if (rec.k === 'cfg') return validateConfig(rec);
  return ['The record kind is not recognised.'];
}

export const categoryLabel = (id, custom = []) => CATEGORY_BY_ID[id]?.label ?? custom.find((c) => c.id === id)?.label ?? 'Other';

/** Field values that are never searched, shown in lists or exported to a health report. */
export const secretKeysOf = (templateId) => (TEMPLATE_BY_ID[templateId]?.fields ?? [])
  .filter((x) => x.type === 'secret' || x.type === 'pin' || x.type === 'secretarea')
  .map((x) => x.k);
