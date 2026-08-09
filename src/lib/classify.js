// Class-break methods for choropleths. Each returns the interior breaks —
// n classes produce n-1 breaks — so the callers stay identical.

import { quantile as d3quantile, extent } from 'd3-array';

export const CLASS_METHODS = [
  { id: 'quantile', label: 'Quantile (equal count)' },
  { id: 'equal', label: 'Equal interval' },
  { id: 'jenks', label: 'Natural breaks' },
  { id: 'stddev', label: 'Standard deviation' },
];

export function classBreaks(values, classes, method = 'quantile') {
  if (!values.length || classes < 2) return [];
  switch (method) {
    case 'equal': return equalInterval(values, classes);
    case 'jenks': return naturalBreaks(values, classes);
    case 'stddev': return standardDeviation(values, classes);
    case 'quantile':
    default: return quantileBreaks(values, classes);
  }
}

function dedupe(breaks, values, classes) {
  const unique = [...new Set(breaks)];
  // Heavy ties (lots of zeros, say) collapse breaks into each other; equal
  // interval at least still produces distinct edges.
  return unique.length === breaks.length ? breaks : equalInterval(values, classes);
}

export function quantileBreaks(values, classes) {
  const sorted = [...values].sort((a, b) => a - b);
  const breaks = [];
  for (let i = 1; i < classes; i++) breaks.push(d3quantile(sorted, i / classes));
  return dedupe(breaks, values, classes);
}

export function equalInterval(values, classes) {
  const [lo, hi] = extent(values);
  if (lo === hi) return [];
  const step = (hi - lo) / classes;
  return Array.from({ length: classes - 1 }, (_, i) => lo + step * (i + 1));
}

/**
 * Natural breaks via 1-D k-means (Jenks in spirit): seed on quantiles, then
 * iterate assignment and recentring until stable. Large inputs are sampled —
 * break positions are a summary, and a few thousand points fix them well
 * enough that the extra passes only cost time.
 */
export function naturalBreaks(values, classes) {
  const SAMPLE = 4000;
  let data = [...values].sort((a, b) => a - b);
  if (data.length > SAMPLE) {
    const step = data.length / SAMPLE;
    data = Array.from({ length: SAMPLE }, (_, i) => data[Math.floor(i * step)]);
  }
  const [lo, hi] = [data[0], data[data.length - 1]];
  if (lo === hi) return [];

  let centres = Array.from({ length: classes }, (_, i) =>
    d3quantile(data, (i + 0.5) / classes)
  );

  for (let iter = 0; iter < 40; iter++) {
    const sums = new Array(classes).fill(0);
    const counts = new Array(classes).fill(0);
    for (const v of data) {
      let best = 0, bestD = Infinity;
      for (let c = 0; c < classes; c++) {
        const d = Math.abs(v - centres[c]);
        if (d < bestD) { bestD = d; best = c; }
      }
      sums[best] += v;
      counts[best]++;
    }
    let moved = 0;
    const next = centres.map((c, i) => {
      if (!counts[i]) return c;
      const m = sums[i] / counts[i];
      moved += Math.abs(m - c);
      return m;
    });
    centres = next.sort((a, b) => a - b);
    if (moved < (hi - lo) * 1e-6) break;
  }

  // Breaks sit midway between adjacent cluster centres.
  const breaks = [];
  for (let i = 1; i < centres.length; i++) breaks.push((centres[i - 1] + centres[i]) / 2);
  return dedupe(breaks, values, classes);
}

/** Breaks at whole standard deviations either side of the mean. */
export function standardDeviation(values, classes) {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
  if (!sd) return [];
  const [lo, hi] = extent(values);
  const half = (classes - 1) / 2;
  const breaks = [];
  for (let i = 0; i < classes - 1; i++) {
    const offset = i - half + 0.5;
    const v = mean + offset * sd;
    if (v > lo && v < hi) breaks.push(v);
  }
  return breaks.length ? breaks : equalInterval(values, classes);
}

/**
 * Distinct values for colouring by a text field, most frequent first. The tail
 * past the palette ceiling folds into one "Other" bucket rather than inventing
 * hues that nobody can tell apart.
 */
export function categoryClasses(rows, field, max = 8) {
  const counts = new Map();
  for (const r of rows) {
    const v = r[field];
    const k = v === null || v === undefined || v === '' ? '(no value)' : String(v);
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const head = sorted.slice(0, max).map(([key, count]) => ({ key, count }));
  const tail = sorted.slice(max);
  if (tail.length) {
    head.push({ key: `Other (${tail.length})`, count: tail.reduce((a, b) => a + b[1], 0), isOther: true });
  }
  return head;
}
