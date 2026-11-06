// Thin promise wrapper over IndexedDB. The database name carries the app prefix because
// every project on one github.io account shares a browser origin.

export const DB_NAME = 'vaulment-db';
const DB_VERSION = 1;
const STORES = ['kv', 'recs', 'blobs'];

function done(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function openIdbBackend() {
  const open = indexedDB.open(DB_NAME, DB_VERSION);
  open.onupgradeneeded = () => {
    for (const s of STORES) if (!open.result.objectStoreNames.contains(s)) open.result.createObjectStore(s);
  };
  const db = await done(open);
  // A second tab on a newer version must not be blocked by this tab's open connection.
  db.onversionchange = () => db.close();

  const tx = (store, mode) => db.transaction(store, mode).objectStore(store);
  const txDone = (t) => new Promise((resolve, reject) => {
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });

  return {
    get: (store, key) => done(tx(store, 'readonly').get(key)),
    put: async (store, key, value) => { const t = db.transaction(store, 'readwrite'); t.objectStore(store).put(value, key); await txDone(t); },
    del: async (store, key) => { const t = db.transaction(store, 'readwrite'); t.objectStore(store).delete(key); await txDone(t); },
    keys: (store) => done(tx(store, 'readonly').getAllKeys()),
    /** One transaction for a whole batch: all-or-nothing, and far quicker than one per record. */
    putMany: async (store, entries) => {
      const t = db.transaction(store, 'readwrite');
      const os = t.objectStore(store);
      for (const [key, value] of entries) os.put(value, key);
      await txDone(t);
    },
    delMany: async (store, keys) => {
      const t = db.transaction(store, 'readwrite');
      const os = t.objectStore(store);
      for (const key of keys) os.delete(key);
      await txDone(t);
    },
    entries: async (store) => {
      const os = tx(store, 'readonly');
      const [keys, values] = await Promise.all([done(os.getAllKeys()), done(os.getAll())]);
      return keys.map((k, i) => [k, values[i]]);
    },
    clear: async (store) => { const t = db.transaction(store, 'readwrite'); t.objectStore(store).clear(); await txDone(t); },
    close: () => db.close(),
  };
}

/** In-memory stand-in with the same contract, for unit tests in Node. */
export function memoryBackend() {
  const data = { kv: new Map(), recs: new Map(), blobs: new Map() };
  return {
    data,
    get: async (s, k) => data[s].get(k),
    put: async (s, k, v) => { data[s].set(k, v); },
    del: async (s, k) => { data[s].delete(k); },
    keys: async (s) => [...data[s].keys()],
    putMany: async (s, es) => { for (const [k, v] of es) data[s].set(k, v); },
    delMany: async (s, ks) => { for (const k of ks) data[s].delete(k); },
    entries: async (s) => [...data[s]],
    clear: async (s) => data[s].clear(),
    close: () => {},
  };
}
