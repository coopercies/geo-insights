// Loading a published dashboard.
//
// A published dashboard is plain static files — a config record plus one file
// per dataset, named by content hash:
//
//   /shared/<shareId>/project.json     cards, layout, dataset metadata
//   /shared/data/<hash>.json           rows + geometry, immutable
//
// That means read-only sharing needs no database at all: any web server can
// host it, payloads are shared between dashboards that use the same layer, and
// a link is pinned to the exact bytes it was published with. A backend is only
// needed for the *write* path — publishing from the browser.

import { joinProject } from './project.js';

export const SHARE_ROOT = '/shared';

export async function loadSharedProject(shareId, root = SHARE_ROOT) {
  const configUrl = `${root}/${encodeURIComponent(shareId)}/project.json`;
  const res = await fetch(configUrl, { cache: 'no-cache' });
  if (res.status === 404) {
    throw new Error('This dashboard link no longer exists, or was never published.');
  }
  if (!res.ok) throw new Error(`Could not load the dashboard — HTTP ${res.status}.`);

  const config = await res.json();
  const metas = config.datasets || [];

  // Payloads are immutable, so they can be cached hard and fetched in parallel.
  const payloads = await Promise.all(
    metas.map(async (meta) => {
      if (!meta.hash) throw new Error(`Layer "${meta.name}" was published without a content hash.`);
      const r = await fetch(`${root}/data/${meta.hash}.json`, { cache: 'force-cache' });
      if (!r.ok) throw new Error(`Missing data for layer "${meta.name}" (HTTP ${r.status}).`);
      return [meta.hash, await r.text()];
    })
  );

  return {
    ...joinProject(config, Object.fromEntries(payloads)),
    title: config.title || null,
    publishedAt: config.publishedAt || config.savedAt || null,
  };
}
