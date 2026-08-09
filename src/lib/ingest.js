// Turn dropped files into datasets: rows + (optional) GeoJSON with stable ids.

import Papa from 'papaparse';
import shp from 'shpjs';
import { inferFields, toNumber } from './fields.js';

const LAT_NAMES = ['latitude', 'lat', 'y', 'ycoord', 'y_coord', 'lat_dd', 'point_y'];
const LON_NAMES = ['longitude', 'lon', 'lng', 'long', 'x', 'xcoord', 'x_coord', 'lon_dd', 'point_x'];

let seq = 0;
const nextId = () => `ds${++seq}_${Date.now().toString(36)}`;

// Parsing GeoJSON costs roughly 6x the file size in heap (measured), on top of
// a UTF-16 copy of the text itself. Past this, the tab is killed mid-parse —
// which looks like the page going blank, with no error to catch or report.
const HARD_LIMIT_BYTES = 150 * 1024 * 1024;
const SLOW_LIMIT_BYTES = 40 * 1024 * 1024;

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(0)} MB`;

export function sizeVerdict(bytes, name) {
  if (bytes > HARD_LIMIT_BYTES) {
    return {
      ok: false,
      message:
        `${name} is ${mb(bytes)}, which is too large to open in a browser — parsing it ` +
        `would run the tab out of memory. Reduce it first: simplify geometry at ` +
        `mapshaper.org, drop unused columns, or aggregate points to hexes and load ` +
        `the result.`,
    };
  }
  if (bytes > SLOW_LIMIT_BYTES) {
    return { ok: true, warning: `${name} is ${mb(bytes)} — expect a slow load and sluggish panning.` };
  }
  return { ok: true };
}

export async function ingestFile(file) {
  const name = file.name;
  const lower = name.toLowerCase();

  const verdict = sizeVerdict(file.size, name);
  if (!verdict.ok) throw new Error(verdict.message);

  if (lower.endsWith('.geojson') || lower.endsWith('.json')) {
    const text = await file.text();
    return fromGeoJSON(parseJSON(text, name), stripExt(name));
  }
  if (lower.endsWith('.csv') || lower.endsWith('.tsv')) {
    const text = await file.text();
    return fromCSV(text, stripExt(name), lower.endsWith('.tsv') ? '\t' : ',');
  }
  if (lower.endsWith('.zip')) {
    const buf = await file.arrayBuffer();
    const parsed = await shp(buf);
    // shpjs returns one FeatureCollection, or an array when the zip holds several.
    const fc = Array.isArray(parsed) ? mergeCollections(parsed) : parsed;
    return fromGeoJSON(fc, stripExt(name));
  }
  if (lower.endsWith('.shp') || lower.endsWith('.dbf') || lower.endsWith('.shx')) {
    throw new Error(
      `Shapefiles are a set of files, so a loose .shp can't be read on its own. ` +
      `Zip the .shp/.shx/.dbf/.prj together and drop the .zip instead.`
    );
  }
  if (lower.endsWith('.gpkg')) {
    throw new Error(
      `GeoPackage isn't supported yet — it's a SQLite database that needs a heavy ` +
      `parser. Export to GeoJSON from QGIS (right-click layer -> Export) and drop that.`
    );
  }
  throw new Error(`Unrecognized file type: ${name}. Supported: .geojson, .json, .csv, .tsv, zipped shapefile.`);
}

/**
 * Load a layer straight from a URL — lets a published dashboard point at a
 * hosted GeoJSON/CSV via ?data=… instead of shipping the data in the bundle.
 * The host must send permissive CORS headers.
 */
export async function ingestUrl(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not fetch ${url} — HTTP ${res.status}`);
  const text = await res.text();
  const name = stripExt(decodeURIComponent(url.split('/').pop() || 'remote layer'));
  if (/\.csv$/i.test(url)) return fromCSV(text, name, ',');
  if (/\.tsv$/i.test(url)) return fromCSV(text, name, '\t');
  return fromGeoJSON(parseJSON(text, name), name);
}

/** Translate the low-level parse failures into something actionable. */
function parseJSON(text, name) {
  try {
    return JSON.parse(text);
  } catch (err) {
    if (err instanceof RangeError) {
      throw new Error(`${name} is too large for the browser to parse — reduce it and try again.`);
    }
    throw new Error(`${name} isn't valid JSON: ${err.message}`);
  }
}

function stripExt(n) {
  return n.replace(/\.[^.]+$/, '');
}

function mergeCollections(list) {
  return {
    type: 'FeatureCollection',
    features: list.flatMap((fc) => fc.features || []),
  };
}

export function fromGeoJSON(input, name) {
  let features;
  if (input.type === 'FeatureCollection') features = input.features || [];
  else if (input.type === 'Feature') features = [input];
  else if (input.type && input.coordinates) features = [{ type: 'Feature', geometry: input, properties: {} }];
  else throw new Error(`${name}: not a GeoJSON FeatureCollection.`);

  if (!features.length) throw new Error(`${name}: no features found.`);

  const rows = [];
  const outFeatures = [];
  let i = 0;
  for (const f of features) {
    if (!f) continue;
    const props = { ...(f.properties || {}) };
    props.__i = i;
    rows.push(props);
    outFeatures.push({ type: 'Feature', id: i, geometry: f.geometry, properties: { __i: i } });
    i++;
  }

  const geojson = { type: 'FeatureCollection', features: outFeatures };
  return finalize({ name, rows, geojson });
}

export function fromCSV(text, name, delimiter) {
  const res = Papa.parse(text.trim(), {
    header: true,
    delimiter,
    skipEmptyLines: 'greedy',
    dynamicTyping: false,
  });
  if (!res.data.length) throw new Error(`${name}: no rows parsed.`);

  const rows = res.data.map((r, i) => ({ ...r, __i: i }));
  const headers = res.meta.fields || [];
  const latField = pickCoord(headers, LAT_NAMES);
  const lonField = pickCoord(headers, LON_NAMES);

  let geojson = null;
  if (latField && lonField) {
    const features = [];
    for (const r of rows) {
      const lat = toNumber(r[latField]);
      const lon = toNumber(r[lonField]);
      // Guard against x/y columns that hold projected metres, not degrees.
      if (lat === null || lon === null) continue;
      if (Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
      features.push({
        type: 'Feature',
        id: r.__i,
        geometry: { type: 'Point', coordinates: [lon, lat] },
        properties: { __i: r.__i },
      });
    }
    if (features.length) geojson = { type: 'FeatureCollection', features };
  }

  return finalize({ name, rows, geojson, coordFields: latField ? { lat: latField, lon: lonField } : null });
}

function pickCoord(headers, candidates) {
  for (const c of candidates) {
    const hit = headers.find((h) => h && h.toLowerCase().replace(/[^a-z_]/g, '') === c);
    if (hit) return hit;
  }
  return null;
}

function finalize({ name, rows, geojson, coordFields = null }) {
  const fields = inferFields(rows);
  const geometryType = geojson ? dominantGeometry(geojson) : null;
  return {
    id: nextId(),
    name,
    rows,
    geojson,
    geometryType,
    bbox: geojson ? computeBBox(geojson) : null,
    fields,
    coordFields,
  };
}

function dominantGeometry(fc) {
  for (const f of fc.features) {
    const t = f.geometry && f.geometry.type;
    if (!t) continue;
    if (t.includes('Polygon')) return 'polygon';
    if (t.includes('LineString')) return 'line';
    if (t.includes('Point')) return 'point';
  }
  return null;
}

export function computeBBox(fc) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const visit = (coords) => {
    if (typeof coords[0] === 'number') {
      const [x, y] = coords;
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      return;
    }
    for (const c of coords) visit(c);
  };
  for (const f of fc.features) {
    if (f.geometry && f.geometry.coordinates) visit(f.geometry.coordinates);
  }
  return Number.isFinite(minX) ? [minX, minY, maxX, maxY] : null;
}
