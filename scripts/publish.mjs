#!/usr/bin/env node
// Publish a saved dashboard as a shareable, read-only link.
//
//   node scripts/publish.mjs my-dashboard.geoinsights.json [--title "…"] [--id custom-id]
//
// Writes the static layout the viewer expects:
//   public/shared/<id>/project.json    config: cards, layout, dataset metadata
//   public/shared/data/<hash>.json     payloads, immutable, shared between dashboards
//
// Then ./deploy.sh ships it. Read-only sharing needs no database — this exists
// so the feature is usable before the write path (publishing from the browser)
// is built.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHARED = join(ROOT, 'public', 'shared');

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? null : args[i + 1];
};

if (!file) {
  console.error('usage: node scripts/publish.mjs <project.geoinsights.json> [--title "…"] [--id custom-id]');
  process.exit(1);
}

const project = JSON.parse(readFileSync(file, 'utf8'));
if (!project.datasets || !project.cards) {
  console.error(`${file} does not look like a saved project (no datasets/cards).`);
  process.exit(1);
}

// Unguessable by default: a share link is a bearer token, so the id has to be
// long enough that it can't be walked.
const shareId = flag('id') || randomBytes(9).toString('base64url');
const title = flag('title') || null;

mkdirSync(join(SHARED, shareId), { recursive: true });
mkdirSync(join(SHARED, 'data'), { recursive: true });

let written = 0, reused = 0, bytes = 0;

const metas = project.datasets.map((ds) => {
  const body = JSON.stringify({ rows: ds.rows, geojson: ds.geojson });
  // Hash the payload we actually write, so the file name always matches it.
  const hash = ds.hash || createHash('sha256').update(body).digest('hex');
  const path = join(SHARED, 'data', `${hash}.json`);
  if (existsSync(path)) {
    reused++;
  } else {
    writeFileSync(path, body);
    written++;
    bytes += body.length;
  }
  return {
    id: ds.id,
    name: ds.name,
    hash,
    fields: ds.fields,
    geometryType: ds.geometryType,
    bbox: ds.bbox,
    coordFields: ds.coordFields ?? null,
    rowCount: ds.rows.length,
  };
});

writeFileSync(
  join(SHARED, shareId, 'project.json'),
  JSON.stringify({
    format: 'geo-insights/v1',
    publishedAt: new Date().toISOString(),
    title,
    cards: project.cards,
    layout: project.layout,
    datasets: metas,
  }, null, 2)
);

const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;
console.log(`published  ${shareId}`);
console.log(`  layers   ${metas.length} (${written} written, ${reused} already stored)`);
console.log(`  payload  ${mb(bytes)} new`);
console.log(`  local    http://localhost:5173/v/${shareId}`);
console.log(`\nRun ./deploy.sh to publish it live.`);
