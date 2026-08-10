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
export async function saveProject({ datasets, cards, layout }, { id = null, title = '', visibility = 'private' } = {}) {
  const user = currentUser();
  if (!user) throw new Error('Sign in to save a dashboard.');

  const datasetIds = [];
  for (const ds of datasets) datasetIds.push(await ensureDataset(ds, user.id));

  const payload = {
    title,
    visibility,
    owner: user.id,
    datasets: datasetIds,
    config: { cards, layout, datasets: datasets.map(datasetMeta) },
  };

  if (id) return pb.collection('projects').update(id, payload);
  return pb.collection('projects').create({ ...payload, shareId: newShareId() });
}

export function listProjects() {
  return pb.collection('projects').getFullList({ sort: '-updated' });
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
 * Fetch a published dashboard by share id. No auth: the rule allows viewing
 * unlisted projects, and datasets are fetched by id from the project's own
 * config, so there is no way to enumerate anyone's layers.
 */
export async function loadPublishedProject(shareId) {
  let record;
  try {
    record = await pb.collection('projects').getFirstListItem(`shareId="${shareId}"`, { expand: 'datasets' });
  } catch (err) {
    if (err.status === 404) return null; // caller falls back to static /shared
    throw err;
  }

  const expanded = record.expand?.datasets ?? [];
  const payloads = await Promise.all(
    expanded.map(async (d) => {
      const url = pb.files.getURL(d, d.payload);
      const res = await fetch(url, { cache: 'force-cache' });
      if (!res.ok) throw new Error(`Missing data for layer "${d.name}".`);
      return [d.hash, await res.text()];
    })
  );

  return {
    ...joinProject(record.config, Object.fromEntries(payloads)),
    title: record.title || null,
    publishedAt: record.updated,
  };
}
