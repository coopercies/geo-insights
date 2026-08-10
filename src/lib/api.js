// Backend client: accounts, saved dashboards, published links.
//
// The API is served from the same origin as the app (nginx proxies /api/ to
// PocketBase), so there are no CORS concerns and the session cookie/token
// story stays simple.
//
// Everything here degrades: if the backend is unreachable the app still works
// as a local-file tool, which is how it started and how the no-login demo runs.

import PocketBase from 'pocketbase';
import { datasetMeta, datasetPayload, joinProject } from './project.js';

export const pb = new PocketBase(window.location.origin);

// Keep the session across reloads; PocketBase stores it in localStorage.
pb.autoCancellation(false);

export const isSignedIn = () => pb.authStore.isValid;
export const currentUser = () => pb.authStore.record ?? null;

export async function backendAvailable() {
  try {
    const res = await fetch('/api/health', { cache: 'no-store' });
    return res.ok;
  } catch {
    return false;
  }
}

export async function signIn(email, password) {
  await pb.collection('users').authWithPassword(email, password);
  return currentUser();
}

export function signOut() {
  pb.authStore.clear();
}

export function onAuthChange(fn) {
  return pb.authStore.onChange(() => fn(currentUser()), false);
}

/** A share id is a bearer token — long enough that it can't be walked. */
function newShareId() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Upload a dataset unless its bytes are already stored. Content addressing is
 * what makes re-saving cheap: only the config record changes.
 */
async function ensureDataset(ds, ownerId) {
  if (!ds.hash) throw new Error(`Layer "${ds.name}" has no content hash.`);

  // The unique index on hash means a duplicate create would fail anyway; look
  // first so re-saving a dashboard is a no-op rather than an error.
  try {
    const existing = await pb.collection('datasets').getFirstListItem(`hash="${ds.hash}"`);
    if (existing) return existing.id;
  } catch (err) {
    if (err.status !== 404) throw err;
  }

  const body = new FormData();
  body.append('hash', ds.hash);
  body.append('name', ds.name);
  body.append('rowCount', String(ds.rows.length));
  body.append('geometryType', ds.geometryType ?? '');
  body.append('meta', JSON.stringify(datasetMeta(ds)));
  body.append('owner', ownerId);
  body.append('payload', new Blob([datasetPayload(ds)], { type: 'application/json' }), `${ds.hash}.json`);

  const created = await pb.collection('datasets').create(body);
  return created.id;
}

/**
 * Save a dashboard. Returns the project record. Datasets upload once; a later
 * save of the same dashboard rewrites only the small config record.
 */
export async function saveProject({ datasets, cards, layout, pages = [] }, { id = null, title = '', visibility = 'private' } = {}) {
  const user = currentUser();
  if (!user) throw new Error('Sign in to save a dashboard.');

  const datasetIds = [];
  for (const ds of datasets) datasetIds.push(await ensureDataset(ds, user.id));

  const payload = {
    title,
    visibility,
    owner: user.id,
    datasets: datasetIds,
    config: { cards, layout, pages, datasets: datasets.map(datasetMeta) },
  };

  if (id) return pb.collection('projects').update(id, payload);
  return pb.collection('projects').create({ ...payload, shareId: newShareId() });
}

export function listProjects() {
  return pb.collection('projects').getFullList({ sort: '-updated' });
}

/**
 * Open a saved dashboard you own. Returns the reconstructed project plus the
 * record, so a later save updates this dashboard rather than creating a copy.
 */
export async function openProject(id) {
  const record = await pb.collection('projects').getOne(id, { expand: 'datasets' });
  const expanded = record.expand?.datasets ?? [];

  const payloads = await Promise.all(
    expanded.map(async (d) => {
      const res = await fetch(pb.files.getURL(d, d.payload), { cache: 'force-cache' });
      if (!res.ok) throw new Error(`Missing data for layer "${d.name}".`);
      return [d.hash, await res.text()];
    })
  );

  return { project: joinProject(record.config, Object.fromEntries(payloads)), record };
}

export function deleteProject(id) {
  return pb.collection('projects').delete(id);
}

/** Revoking a link is just a new share id; the old one stops resolving. */
export function regenerateShareId(id) {
  return pb.collection('projects').update(id, { shareId: newShareId() });
}

export function setVisibility(id, visibility) {
  return pb.collection('projects').update(id, { visibility });
}

/**
 * Fetch a published dashboard by share id.
 *
 * Deliberately not a collection query: finding a project by shareId is a list
 * operation, and granting anonymous list access would let anyone page through
 * every unlisted dashboard and collect its share ids. The /api/share/{id}
 * endpoint takes one id and returns that dashboard or nothing.
 */
export async function loadPublishedProject(shareId) {
  // Returning null means "not here, try the static files". Anything after this
  // point is a real failure and must surface: swallowing it once turned a
  // broken payload URL into a misleading "never published" message.
  let res;
  try {
    res = await fetch(`/api/share/${encodeURIComponent(shareId)}`, { cache: 'no-cache' });
  } catch {
    return null; // no backend on this host at all
  }
  if (res.status === 404) return null;

  // A host with no backend may answer /api/* with its SPA fallback — a 200
  // carrying index.html. Treat anything that isn't JSON as "no backend here"
  // rather than trying to parse markup.
  const type = res.headers.get('content-type') || '';
  if (!type.includes('json')) return null;

  if (!res.ok) throw new Error(`Could not load the dashboard — HTTP ${res.status}.`);

  const data = await res.json();
  const payloads = await Promise.all(
    (data.datasets || []).map(async (d) => {
      // Immutable and content-addressed, so these cache hard.
      const r = await fetch(d.url, { cache: 'force-cache' });
      if (!r.ok) throw new Error(`Missing data for layer "${d.name}".`);
      return [d.hash, await r.text()];
    })
  );

  return {
    ...joinProject(data.config, Object.fromEntries(payloads)),
    title: data.title || null,
    publishedAt: data.publishedAt || null,
  };
}
