// Network first for the page, cached copy when offline. Every project on one github.io
// account shares an origin, so this worker only ever touches caches with its own prefix.
const VERSION = '__VERSION__';
// SHA-256 of this build's index.html. Another project on this origin could rewrite the Cache
// but cannot change this file, so the hash is how a tampered offline page gets caught.
const PAGE_HASH = '__PAGE_HASH__';
const PREFIX = 'vaulment-';
const CACHE = `${PREFIX}${VERSION}`;
const SHELL = ['./', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png'];
const NETWORK_TIMEOUT_MS = 4000;
const RETRIES = 2;
const BACKOFF_MS = 400;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith(PREFIX) && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A slow connection must not leave the page blank while a good copy sits in the cache. */
async function fetchWithRetry(request, hasFallback) {
  let last;
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    const ctrl = new AbortController();
    const timer = hasFallback ? setTimeout(() => ctrl.abort(), NETWORK_TIMEOUT_MS) : null;
    try {
      const res = await fetch(request, { signal: ctrl.signal, cache: 'no-cache' });
      if (res.ok) return res;
      last = new Error(`HTTP ${res.status}`);
    } catch (err) {
      last = err;
    } finally {
      clearTimeout(timer);
    }
    if (attempt < RETRIES - 1) await sleep(BACKOFF_MS * 2 ** attempt);
  }
  throw last;
}

async function isGenuinePage(res) {
  const digest = await crypto.subtle.digest('SHA-256', await res.clone().arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('') === PAGE_HASH;
}

async function networkFirst(request, cacheKey, isPage) {
  const cache = await caches.open(CACHE);
  let cached = await cache.match(cacheKey);
  if (cached && isPage && !(await isGenuinePage(cached))) {
    await cache.delete(cacheKey);
    cached = undefined;
  }
  try {
    const res = await fetchWithRetry(request, Boolean(cached));
    // A newer deployment fails this check until its own worker installs, and is not cached yet.
    if (!isPage || await isGenuinePage(res)) await cache.put(cacheKey, res.clone());
    return res;
  } catch (err) {
    if (cached) return cached;
    return new Response('Vaulment is offline and has not been saved on this device yet. Connect once, then try again.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(new URL(self.registration.scope).pathname)) return;
  if (request.mode === 'navigate') event.respondWith(networkFirst(new Request('./'), './', true));
  else event.respondWith(networkFirst(request, request, false));
});
