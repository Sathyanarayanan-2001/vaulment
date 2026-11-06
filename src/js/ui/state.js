// Shared app state and the small preferences that live in localStorage. The key prefix
// matters: every project on one github.io account shares this browser origin.

const PREFIX = 'vaulment.';

export const prefs = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch { /* A private window can refuse this; the app works without it. */ }
  },
};

export const app = {
  vault: null,
  sync: null,
  version: '',
  buildDate: '',
  route: { page: 'home', params: {} },
  refresh: () => {},
  go: (hash) => { location.hash = hash; },
  lock: () => {},
  installPrompt: null,
  folderHandle: null,
  folderSupported: 'showDirectoryPicker' in globalThis,
  now: () => Date.now(),
};

export const AUTOLOCK_CHOICES = [1, 5, 15, 30];
export const CLIPBOARD_CHOICES = [15, 30, 60];
