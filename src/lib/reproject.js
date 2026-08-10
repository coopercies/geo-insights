// Reprojecting a layer that arrived in a projected coordinate system.
//
// The transformation is the easy part; identifying the *source* CRS is not.
// GeoJSON exports routinely carry projected coordinates with no crs member, and
// the numbers alone cannot identify the system — State Plane feet, UTM metres
// and Web Mercator all overlap in magnitude. Guessing from magnitude would
// place data confidently in the wrong country.
//
// So this never guesses silently. It tests candidates against something known:
// where your other layers already are. A candidate that lands the data beside
// them is right; one that lands it in another hemisphere is not, and you see
// the distance either way before anything is applied.

import proj4 from 'proj4';

const WGS84 = '+proj=longlat +datum=WGS84 +no_defs';
const DEF_CACHE = new Map();
const STORAGE_KEY = 'geoinsights.projdefs';

// Definitions are fetched by EPSG code rather than bundled: epsg.io serves them
// with permissive CORS, and bundling a table risks shipping a wrong parameter,
// which is the one error that corrupts data without complaining.
export async function fetchDefinition(code) {
  const key = String(code);
  if (DEF_CACHE.has(key)) return DEF_CACHE.get(key);

  const stored = readStore();
  if (stored[key]) {
    DEF_CACHE.set(key, stored[key]);
    return stored[key];
  }

  const res = await fetch(`https://epsg.io/${encodeURIComponent(key)}.proj4`, { cache: 'force-cache' });
  if (!res.ok) throw new Error(`No definition found for EPSG:${key}.`);
  const def = (await res.text()).trim();
  if (!def.startsWith('+proj')) throw new Error(`EPSG:${key} did not return a usable definition.`);

  DEF_CACHE.set(key, def);
  stored[key] = def;
  writeStore(stored);
  return def;
}

function readStore() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}
function writeStore(obj) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
  } catch {
    /* private mode, quota — caching is an optimisation, not a requirement */
  }
}

/**
 * Candidates worth trying. UTM is computed from the target rather than listed,
 * since its zones are a formula. The State Plane entries are the ones a US
 * layer in feet is most likely to be; anything else is entered by code.
 */
export function candidatesFor(target) {
  const list = [{ code: 3857, label: 'Web Mercator' }];

  if (target) {
    const [lon, lat] = target;
    const zone = Math.floor((lon + 180) / 6) + 1;
    list.push({ code: 26900 + zone, label: `UTM zone ${zone}N (NAD83, metres)` });
    list.push({ code: 32600 + zone, label: `UTM zone ${zone}N (WGS84, metres)` });
    if (lat < 0) list.push({ code: 32700 + zone, label: `UTM zone ${zone}S (WGS84, metres)` });
  }

  // California State Plane in US survey feet — zones 1..6.
  for (let z = 1; z <= 6; z++) {
    list.push({ code: 2224 + z, label: `California zone ${z} (NAD83, US feet)` });
  }
  // …and in metres.
  for (let z = 1; z <= 6; z++) {
    list.push({ code: 26940 + z, label: `California zone ${z} (NAD83, metres)` });
  }
  return list;
}

const R = 6371; // km
export function haversine([lon1, lat1], [lon2, lat2]) {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const centre = (bbox) => [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];

const LON_NAMES = /^(x|lon|lng|long|longitude|point_x|x_coord|xcoord)$/i;
const LAT_NAMES = /^(y|lat|latitude|point_y|y_coord|ycoord)$/i;

/**
 * A reference point taken from the layer's own attributes. Exports frequently
 * carry X/Y or lat/lon columns in degrees even when the geometry is projected —
 * the file then contains the answer to its own question, and it beats asking
 * the user where their data is.
 */
export function targetFromAttributes(dataset) {
  if (!dataset || !dataset.fields || !dataset.rows) return null;
  const lon = dataset.fields.find((f) => f.type === 'number' && LON_NAMES.test(f.name));
  const lat = dataset.fields.find((f) => f.type === 'number' && LAT_NAMES.test(f.name));
  if (!lon || !lat) return null;

  // Only if those columns are plausibly degrees — an X column in feet is the
  // very thing we are trying to convert.
  if (Math.abs(lon.min) > 180 || Math.abs(lon.max) > 180) return null;
  if (Math.abs(lat.min) > 90 || Math.abs(lat.max) > 90) return null;
  if (lon.min === 0 && lon.max === 0) return null;

  return {
    at: [(lon.min + lon.max) / 2, (lat.min + lat.max) / 2],
    from: `${lon.name}/${lat.name} columns`,
  };
}

/** Where a candidate would put this layer's centre, or null if it can't. */
export async function tryCandidate(code, bbox) {
  const def = await fetchDefinition(code);
  const [x, y] = centre(bbox);
  const [lon, lat] = proj4(def, WGS84, [x, y]);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { code, def, at: [lon, lat] };
}

/**
 * Rank candidates by how close they land to `target` — the centre of the
 * layers already loaded in a known coordinate system. With a reference point
 * the right answer is usually unambiguous: the correct CRS lands within a few
 * kilometres, wrong ones land hundreds or thousands away.
 */
export async function detectCrs(bbox, target, extra = []) {
  const candidates = [...extra.map((code) => ({ code, label: `EPSG:${code}` })), ...candidatesFor(target)];
  const seen = new Set();
  const results = [];

  for (const c of candidates) {
    if (seen.has(c.code)) continue;
    seen.add(c.code);
    try {
      const hit = await tryCandidate(c.code, bbox);
      if (!hit) continue;
      results.push({
        ...hit,
        label: c.label,
        km: target ? haversine(hit.at, target) : null,
      });
    } catch {
      // A code with no definition is simply not a candidate.
    }
  }

  results.sort((a, b) => (a.km ?? Infinity) - (b.km ?? Infinity));
  return results;
}

/** Transform every coordinate. Returns a new FeatureCollection. */
export function reprojectCollection(fc, def) {
  const convert = (coords) =>
    typeof coords[0] === 'number' ? proj4(def, WGS84, [coords[0], coords[1]]) : coords.map(convert);

  return {
    type: 'FeatureCollection',
    features: fc.features.map((f) => ({
      ...f,
      geometry: f.geometry && f.geometry.coordinates
        ? { ...f.geometry, coordinates: convert(f.geometry.coordinates) }
        : f.geometry,
    })),
  };
}
