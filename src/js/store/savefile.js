import { decryptBytes, encodeText, decodeText, encryptBytes, fromBase64, gunzip, gzip, toBase64 } from '../crypto/vaultcrypto.js';

// A save file is gzip JSON, as asked for, but the records inside are AES-GCM ciphertext:
// a OneDrive folder is somebody else's computer. Layers, outside in:
//   gzip( JSON{ header, iv, ct: base64( AES-GCM( gzip( JSON{recs, keyring} ) ) ) } )
// Encrypted bytes do not compress, so the data is gzipped before encryption; the outer
// gzip claws back the 33% that base64 adds.

export const SAVE_APP = 'vaulment';
export const SAVE_FORMAT = 1;
const AAD = 'save:v1';

const SAVE_NAME = /^vaulment-save-([a-z0-9]{8})-([a-z0-9]{6,12})-(\d{17})-([a-z0-9]{6,12})\.json\.gz$/;

/** The vault is in the file name so pruning can leave every other vault's saves alone
 *  without having to open them. */
export const vaultTag = (vaultId) => vaultId.toLowerCase().replace(/[^a-z0-9]/g, '').padEnd(8, '0').slice(0, 8);

export function saveFileName(vaultId, device, session, nowMs) {
  const stamp = new Date(nowMs).toISOString().replace(/\D/g, '').slice(0, 17);
  return `vaulment-save-${vaultTag(vaultId)}-${device}-${stamp}-${session}.json.gz`;
}

export function parseSaveName(name) {
  const m = SAVE_NAME.exec(name);
  return m ? { vault: m[1], device: m[2], stamp: m[3], session: m[4] } : null;
}

export async function packSave({ dek, keyring, recs, device, session, nowMs, blobs }) {
  const inner = await gzip(encodeText(JSON.stringify({ recs, keyring })));
  const { iv, ct } = await encryptBytes(dek, inner, `${AAD}:${keyring.vaultId}`);
  const envelope = {
    app: SAVE_APP, format: SAVE_FORMAT, vaultId: keyring.vaultId, device, session, at: nowMs,
    // The keyring is here in the clear so a brand-new device can start from this file. It
    // holds only wrapped keys. Once unlocked, the authenticated copy inside `ct` is used.
    keyring, iv: toBase64(iv), ct: toBase64(ct),
  };
  if (blobs) envelope.blobs = blobs;
  return gzip(encodeText(JSON.stringify(envelope)));
}

/** Read and shape-check the outer layer. Throws if unreadable, which callers treat as "try later". */
export async function readEnvelope(bytes) {
  const env = JSON.parse(decodeText(await gunzip(bytes)));
  if (env?.app !== SAVE_APP || !Number.isInteger(env.format)) throw new Error('Not a Vaulment save file.');
  if (env.format > SAVE_FORMAT) throw new Error('This save file comes from a newer version. Update the app on this device.');
  if (typeof env.iv !== 'string' || typeof env.ct !== 'string' || typeof env.vaultId !== 'string' || !env.keyring) throw new Error('The save file is incomplete.');
  return env;
}

export async function openEnvelope(env, dek) {
  const inner = await decryptBytes(dek, fromBase64(env.iv), fromBase64(env.ct), `${AAD}:${env.vaultId}`);
  return JSON.parse(decodeText(await gunzip(inner)));
}
