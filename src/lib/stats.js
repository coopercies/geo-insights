// Aggregations for KPI cards and chart binning.

import { quantile as d3quantile, bin as d3bin, extent } from 'd3-array';
import { toNumber } from './fields.js';

export const STATS = [
  { key: 'count', label: 'Count', needsField: false },
  { key: 'sum', label: 'Sum', needsField: true },
  { key: 'mean', label: 'Mean', needsField: true },
  { key: 'median', label: 'Median', needsField: true },
  { key: 'min', label: 'Min', needsField: true },
  { key: 'max', label: 'Max', needsField: true },
  { key: 'stddev', label: 'Std dev', needsField: true },
];

export function numericValues(rows, field) {
  const out = [];
  for (const r of rows) {
    const n = toNumber(r[field]);
    if (n !== null) out.push(n);
  }
  return out;
}

export function computeStat(rows, field, stat) {
  if (stat === 'count') return rows.length;
  if (!field) return null;
  const vals = numericValues(rows, field);
  if (!vals.length) return null;
  switch (stat) {
    case 'sum': return vals.reduce((a, b) => a + b, 0);
    case 'mean': return vals.reduce((a, b) => a + b, 0) / vals.length;
    case 'median': return d3quantile([...vals].sort((a, b) => a - b), 0.5);
    case 'min': return Math.min(...vals);
    case 'max': return Math.max(...vals);
    case 'stddev': {
      const m = vals.reduce((a, b) => a + b, 0) / vals.length;
      return Math.sqrt(vals.reduce((a, b) => a + (b - m) ** 2, 0) / vals.length);
    }
    default: return null;
  }
}

/** Quantile breaks for choropleths; falls back to equal interval when ties collapse. */
export function quantileBreaks(values, classes) {
  if (!values.length) return [];
  const sorted = [...values].sort((a, b) => a - b);
  const breaks = [];
  for (let i = 1; i < classes; i++) breaks.push(d3quantile(sorted, i / classes));
  const unique = [...new Set(breaks)];
  if (unique.length === breaks.length) return breaks;

  const [lo, hi] = extent(sorted);
  if (lo === hi) return [];
  const step = (hi - lo) / classes;
  return Array.from({ length: classes - 1 }, (_, i) => lo + step * (i + 1));
}

/** Group rows by a categorical field, aggregating a measure (or counting). */
export function groupBy(rows, groupField, measureField, stat, limit = 20) {
  const buckets = new Map();
  for (const r of rows) {
    const key = r[groupField];
    const k = key === null || key === undefined || key === '' ? '(no value)' : String(key);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(r);
  }
  let out = [...buckets.entries()].map(([key, group]) => ({
    key,
    value: computeStat(group, measureField, stat) ?? 0,
    n: group.length,
    ids: group.map((r) => r.__i),
  }));
  out.sort((a, b) => b.value - a.value);

  // Long tails become "Other" rather than an unreadable axis.
  if (out.length > limit) {
    const head = out.slice(0, limit);
    const tail = out.slice(limit);
    head.push({
      key: `Other (${tail.length})`,
      value: stat === 'count' || stat === 'sum'
        ? tail.reduce((a, b) => a + b.value, 0)
        : tail.reduce((a, b) => a + b.value, 0) / tail.length,
      n: tail.reduce((a, b) => a + b.n, 0),
      ids: tail.flatMap((t) => t.ids),
      isOther: true,
    });
    out = head;
  }
  return out;
}

/** Histogram bins that carry their member row ids, so bars stay selectable. */
export function histogram(rows, field, thresholds = 24) {
  const pairs = [];
  for (const r of rows) {
    const n = toNumber(r[field]);
    if (n !== null) pairs.push({ v: n, id: r.__i });
  }
  if (!pairs.length) return [];
  const binner = d3bin().value((d) => d.v).thresholds(thresholds);
  return binner(pairs).map((b) => ({
    x0: b.x0,
    x1: b.x1,
    value: b.length,
    ids: b.map((d) => d.id),
  }));
}

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const plain = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

export function formatValue(v, { compactAbove = 100000 } = {}) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  if (!Number.isFinite(v)) return '—';
  if (Math.abs(v) >= compactAbove) return compact.format(v);
  if (Number.isInteger(v)) return v.toLocaleString('en-US');
  return plain.format(v);
}
