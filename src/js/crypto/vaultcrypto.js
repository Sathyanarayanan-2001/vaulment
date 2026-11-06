// All encryption uses the browser's WebCrypto. Nothing here is home-made except the
// file layout. One random data key (DEK) encrypts everything; the master password and
// the recovery key each wrap a copy of it, so changing the password rewrites one small
// record instead of the whole vault.

// OWASP's figure for PBKDF2-HMAC-SHA256 is 600,000 iterations.
export const PBKDF2_ITERATIONS = 600_000;
const GCM_IV_BYTES = 12;
const KEY_BITS = 256;
const SALT_BYTES = 16;

const { subtle } = globalThis.crypto;
export const randomBytes = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));
const utf8 = new TextEncoder();
const utf8d = new TextDecoder('utf-8', { fatal: true });

export function toBase64(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  // String.fromCharCode(...hugeArray) overflows the call stack, so feed it in chunks.
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(text) {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function streamed(bytes, transform) {
  const stream = new Blob([bytes]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
export const gzip = (bytes) => streamed(bytes, new CompressionStream('gzip'));
export const gunzip = (bytes) => streamed(bytes, new DecompressionStream('gzip'));

/** NFKC, because the same password typed on Windows and Android can differ in Unicode form. */
const normalise = (password) => password.normalize('NFKC');

async function deriveWrappingKey(secret, salt, iterations) {
  const base = await subtle.importKey('raw', utf8.encode(normalise(secret)), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base,
    { name: 'AES-GCM', length: KEY_BITS },
    false,
    ['wrapKey', 'unwrapKey'],
  );
}

async function wrapWith(secret, dek, iterations, aad, u) {
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(GCM_IV_BYTES);
  const kek = await deriveWrappingKey(secret, salt, iterations);
  const ct = await subtle.wrapKey('raw', dek, kek, { name: 'AES-GCM', iv, additionalData: utf8.encode(aad) });
  return { salt: toBase64(salt), iv: toBase64(iv), ct: toBase64(ct), iter: iterations, u };
}

async function unwrapWith(secret, slot, aad, extractable) {
  const kek = await deriveWrappingKey(secret, fromBase64(slot.salt), slot.iter);
  return subtle.unwrapKey(
    'raw', fromBase64(slot.ct), kek,
    { name: 'AES-GCM', iv: fromBase64(slot.iv), additionalData: utf8.encode(aad) },
    { name: 'AES-GCM' }, extractable, ['encrypt', 'decrypt'],
  );
}

// Crockford base32 leaves out I, L, O and U, so a printed code cannot be misread.
const RECOVERY_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const RECOVERY_GROUPS = 6;
const RECOVERY_GROUP_LEN = 5; // 6 × 5 × 5 bits = 150 bits of randomness

export function newRecoveryCode() {
  // A byte mod 32 is uniform, since 256 is an exact multiple of 32.
  const chars = [...randomBytes(RECOVERY_GROUPS * RECOVERY_GROUP_LEN)].map((b) => RECOVERY_ALPHABET[b % 32]);
  const groups = [];
  for (let i = 0; i < chars.length; i += RECOVERY_GROUP_LEN) groups.push(chars.slice(i, i + RECOVERY_GROUP_LEN).join(''));
  return groups.join('-');
}

export const cleanRecoveryCode = (text) => String(text).toUpperCase().replace(/[^0-9A-Z]/g, '');

/** Generate a data key and a keyring. Returns the code once; only its wrapped copy is kept. */
export async function createKeyring(password, nowMs, iterations = PBKDF2_ITERATIONS) {
  const dek = await subtle.generateKey({ name: 'AES-GCM', length: KEY_BITS }, true, ['encrypt', 'decrypt']);
  const vaultId = toBase64(randomBytes(12)).replace(/[+/=]/g, 'x');
  const recoveryCode = newRecoveryCode();
  const keyring = {
    v: 1, vaultId, u: nowMs,
    pw: await wrapWith(password, dek, iterations, `pw:${vaultId}`, nowMs),
    rc: await wrapWith(cleanRecoveryCode(recoveryCode), dek, iterations, `rc:${vaultId}`, nowMs),
  };
  return { keyring, recoveryCode };
}

const MAX_ITERATIONS = 10_000_000;

/** A keyring from a file is untrusted: check its shape, and cap the iteration count so a
 *  tampered file cannot hang the device in key stretching. */
export function isKeyringShape(k) {
  const slot = (s) => s && [s.salt, s.iv, s.ct].every((x) => typeof x === 'string') && Number.isSafeInteger(s.iter) && s.iter >= 1000 && s.iter <= MAX_ITERATIONS && Number.isSafeInteger(s.u);
  return Boolean(k && typeof k.vaultId === 'string' && slot(k.pw) && slot(k.rc));
}

/** @throws when the password is wrong: GCM authentication fails on unwrap. */
export const unlockWithPassword = (keyring, password, extractable = false) => unwrapWith(password, keyring.pw, `pw:${keyring.vaultId}`, extractable);
export const unlockWithRecovery = (keyring, code, extractable = false) => unwrapWith(cleanRecoveryCode(code), keyring.rc, `rc:${keyring.vaultId}`, extractable);

/** New keyring slot for a new password; the data key and all data stay as they are. */
export async function rewrapPassword(keyring, extractableDek, newPassword, nowMs) {
  return { ...keyring, u: nowMs, pw: await wrapWith(newPassword, extractableDek, keyring.pw.iter, `pw:${keyring.vaultId}`, nowMs) };
}

export async function rewrapRecovery(keyring, extractableDek, nowMs) {
  const recoveryCode = newRecoveryCode();
  const rc = await wrapWith(cleanRecoveryCode(recoveryCode), extractableDek, keyring.rc.iter, `rc:${keyring.vaultId}`, nowMs);
  return { keyring: { ...keyring, u: nowMs, rc }, recoveryCode };
}

/** AES-256-GCM. A fresh random IV per message; `aad` ties ciphertext to its record id, so
 *  someone with folder access cannot swap two records' ciphertexts unnoticed. */
export async function encryptBytes(dek, bytes, aad) {
  const iv = randomBytes(GCM_IV_BYTES);
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: utf8.encode(aad) }, dek, bytes);
  return { iv, ct: new Uint8Array(ct) };
}

export async function decryptBytes(dek, iv, ct, aad) {
  return new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv, additionalData: utf8.encode(aad) }, dek, ct));
}

export async function encryptJson(dek, value, aad) {
  return encryptBytes(dek, utf8.encode(JSON.stringify(value)), aad);
}

export async function decryptJson(dek, iv, ct, aad) {
  return JSON.parse(utf8d.decode(await decryptBytes(dek, iv, ct, aad)));
}

export const encodeText = (s) => utf8.encode(s);
export const decodeText = (b) => utf8d.decode(b);

export const newId = (prefix) => {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  // 252 is the largest multiple of 36 under 256; higher bytes would bias the alphabet.
  const out = [];
  while (out.length < 20) for (const b of randomBytes(24)) if (b < 252 && out.length < 20) out.push(alphabet[b % 36]);
  return `${prefix}_${out.join('')}`;
};
