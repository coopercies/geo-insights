// Projects are self-contained JSON: layout, card config, and the data itself.
// That keeps a saved file portable (no missing-source-file problem), at the
// cost of size — hence the warning threshold below.

const FORMAT = 'geo-insights/v1';
const WARN_BYTES = 60 * 1024 * 1024;

export function serialize({ datasets, cards, layout, pages = [] }) {
  return JSON.stringify({
    format: FORMAT,
    savedAt: new Date().toISOString(),
    datasets,
    cards,
    layout,
    pages,
  });
}

/**
 * A dataset minus its payload. Everything a dashboard needs to render its
 * controls — field list, geometry type, extent — without the rows themselves.
 */
export function datasetMeta(ds) {
  return {
    id: ds.id,
    name: ds.name,
    hash: ds.hash ?? null,
    fields: ds.fields,
    geometryType: ds.geometryType,
    bbox: ds.bbox,
    coordFields: ds.coordFields ?? null,
    rowCount: ds.rows.length,
  };
}

/** Just the payload, keyed by content hash. */
export function datasetPayload(ds) {
  return JSON.stringify({ rows: ds.rows, geojson: ds.geojson });
}

/**
 * Split a project for storage where config and data live apart: a small config
 * record that changes every time you nudge a card, and immutable payloads keyed
 * by content hash that are written once and shared between dashboards.
 *
 * Local .geoinsights.json files keep using serialize() — a single portable file
 * with nothing to resolve is the right shape for something you email.
 */
export function splitProject({ datasets, cards, layout, pages = [] }) {
  return {
    config: {
      format: FORMAT,
      savedAt: new Date().toISOString(),
      cards,
      layout,
      pages,
      datasets: datasets.map(datasetMeta),
    },
    payloads: datasets
      .filter((ds) => ds.hash)
      .map((ds) => ({ hash: ds.hash, name: ds.name, body: datasetPayload(ds) })),
  };
}

/** Rebuild full datasets from a config plus a hash -> payload lookup. */
export function joinProject(config, payloadByHash) {
  const datasets = (config.datasets || []).map((meta) => {
    const payload = payloadByHash[meta.hash];
    if (!payload) throw new Error(`Missing data for layer "${meta.name}" (${meta.hash ?? 'no hash'}).`);
    const parsed = typeof payload === 'string' ? JSON.parse(payload) : payload;
    return { ...meta, rows: parsed.rows, geojson: parsed.geojson };
  });
  return { datasets, cards: config.cards || [], layout: config.layout || [], pages: config.pages || [] };
}

export function downloadProject(state, filename = 'dashboard.geoinsights.json') {
  const text = serialize(state);
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  return blob.size;
}

export async function readProject(file) {
  const text = await file.text();
  const data = JSON.parse(text);
  if (data.format !== FORMAT) {
    throw new Error(`Not a Geo Insights project file (found format "${data.format ?? 'none'}").`);
  }
  return data;
}

export function sizeWarning(bytes) {
  return bytes > WARN_BYTES
    ? `Saved ${(bytes / 1024 / 1024).toFixed(0)} MB — large projects reload slowly. Consider trimming columns before import.`
    : null;
}

export function isProjectFile(file) {
  return file.name.endsWith('.geoinsights.json');
}
