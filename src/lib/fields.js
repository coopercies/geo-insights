// Field type inference — decides which chart types and stats a column can drive.

const DATE_HINT = /(date|time|year|month|day|_dt|timestamp)/i;
const ID_HINT =
  /(^|_)(id|fid|objectid|geoid|gid|uid|guid|code|zip|zcta|fips|tract|ct\d*|bg|blockgroup|block|puma|cbsa|censustract)($|_|\d)/i;

function looksNumeric(v) {
  if (v === null || v === undefined || v === '') return false;
  if (typeof v === 'number') return Number.isFinite(v);
  if (typeof v !== 'string') return false;
  const cleaned = v.replace(/[$,%\s]/g, '');
  return cleaned !== '' && Number.isFinite(Number(cleaned));
}

export function toNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const n = Number(v.replace(/[$,%\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function looksDate(v) {
  if (v instanceof Date) return true;
  if (typeof v !== 'string' || v.length < 6) return false;
  return !Number.isNaN(Date.parse(v));
}

/**
 * Profile every column: type, cardinality, range. Sampling caps the cost on
 * large layers; a full scan follows only for the min/max of numeric fields.
 */
export function inferFields(rows) {
  if (!rows.length) return [];
  const sample = rows.length > 800 ? sampleRows(rows, 800) : rows;
  const names = new Set();
  for (const r of sample) for (const k of Object.keys(r)) if (!k.startsWith('__')) names.add(k);

  return [...names].map((name) => {
    let numeric = 0, dateish = 0, present = 0;
    const distinct = new Set();
    for (const r of sample) {
      const v = r[name];
      if (v === null || v === undefined || v === '') continue;
      present++;
      if (looksNumeric(v)) numeric++;
      else if (looksDate(v)) dateish++;
      if (distinct.size <= 200) distinct.add(v);
    }
    if (!present) return { name, type: 'string', distinct: 0, missing: rows.length };

    let type = 'string';
    if (numeric / present > 0.9) type = 'number';
    else if (dateish / present > 0.9 || (DATE_HINT.test(name) && dateish > 0)) type = 'date';

    // A numeric column that is really a key shouldn't be offered for sums.
    const isKey = ID_HINT.test(name) || distinct.size === present;
    const field = { name, type, distinct: distinct.size, isKey: isKey && type !== 'number' ? true : ID_HINT.test(name) };

    if (type === 'number') {
      let min = Infinity, max = -Infinity, count = 0, allInt = true;
      for (const r of rows) {
        const n = toNumber(r[name]);
        if (n === null) continue;
        if (n < min) min = n;
        if (n > max) max = n;
        if (allInt && !Number.isInteger(n)) allInt = false;
        count++;
      }
      field.min = count ? min : 0;
      field.max = count ? max : 0;
      field.count = count;

      // Identifiers masquerade as measures — a tract number classified into
      // quantiles produces a meaningless choropleth. Whole numbers that are
      // near-unique per row are keys, not things worth summing. This only
      // steers the default field choice; the column stays selectable.
      const nearUnique = present > 20 && distinct.size / present > 0.98;
      if (field.isKey || (allInt && nearUnique && Math.abs(field.max) >= 1000)) {
        field.isKey = true;
      }
    }
    if (type === 'string') {
      field.categorical = distinct.size <= 60;
    }
    return field;
  }).sort((a, b) => a.name.localeCompare(b.name));
}

function sampleRows(rows, n) {
  const step = rows.length / n;
  const out = [];
  for (let i = 0; i < n; i++) out.push(rows[Math.floor(i * step)]);
  return out;
}

export const isNumeric = (f) => f && f.type === 'number';
export const isCategorical = (f) => f && (f.type === 'string' || f.type === 'date');
