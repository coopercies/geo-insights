// Autosave of the working dashboard.
//
// Everything lived in memory, so a reload emptied the canvas — including when
// the app itself suggested reloading to clear a problem. That made the advice
// destructive.
//
// IndexedDB rather than localStorage: a single layer runs to megabytes and
// localStorage caps out around 5 MB, whereas IndexedDB stores structured
// clones directly, so rows and geometry go in as objects with no serialising.

const DB_NAME = 'geo-insights';
const STORE = 'session';
const KEY = 'current';
const DEBOUNCE_MS = 1200;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(mode, fn) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function saveSession(state) {
  const record = {
    savedAt: new Date().toISOString(),
    datasets: state.datasets,
    cards: state.cards,
    layout: state.layout,
    pages: state.pages,
  };
  try {
    await withStore('readwrite', (store) => store.put(record, KEY));
    return { ok: true };
  } catch (err) {
    // Quota is the realistic failure; the app must keep working without autosave.
    return { ok: false, error: err && err.name === 'QuotaExceededError'
      ? 'This dashboard is too large to autosave — export it to keep a copy.'
      : 'Autosave is unavailable in this browser.' };
  }
}

export async function loadSession() {
  try {
    const record = await withStore('readonly', (store) => store.get(KEY));
    if (!record || !record.cards || !record.cards.length) return null;
    return record;
  } catch {
    return null;
  }
}

export async function clearSession() {
  try {
    await withStore('readwrite', (store) => store.delete(KEY));
  } catch {
    /* nothing to clear */
  }
}

/**
 * A restore that crashes the app would otherwise crash again on every reload.
 * The flag is set before restoring and cleared once the app is up, so a boot
 * loop can be detected and the session dropped rather than replayed forever.
 */
const FLAG = 'geoinsights.restoring';
export const markRestoring = () => { try { sessionStorage.setItem(FLAG, '1'); } catch { /* ignore */ } };
export const clearRestoring = () => { try { sessionStorage.removeItem(FLAG); } catch { /* ignore */ } };
export const crashedWhileRestoring = () => { try { return sessionStorage.getItem(FLAG) === '1'; } catch { return false; } };

/** Debounced autosave, so dragging a card doesn't write on every frame. */
export function createAutosave(getState) {
  let timer = null;
  let warned = false;
  return (onError) => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const state = getState();
      if (!state.cards.length && !state.datasets.length) return clearSession();
      const result = await saveSession(state);
      if (!result.ok && !warned) {
        warned = true;
        if (onError) onError(result.error);
      }
    }, DEBOUNCE_MS);
  };
}
