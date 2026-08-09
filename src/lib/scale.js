// Minimal linear scale with nice() and ticks() — enough for the chart cards,
// without pulling d3-scale in for one function.

export function scaleLinear(domain, range) {
  let [d0, d1] = domain;
  const [r0, r1] = range;
  if (d0 === d1) { d0 -= 0.5; d1 += 0.5; }

  const fn = (v) => r0 + ((v - d0) / (d1 - d0)) * (r1 - r0);

  fn.domain = () => [d0, d1];
  fn.range = () => [r0, r1];
  fn.invert = (p) => d0 + ((p - r0) / (r1 - r0)) * (d1 - d0);

  fn.ticks = (count = 5) => {
    const step = tickStep(d0, d1, count);
    if (!Number.isFinite(step) || step <= 0) return [d0];
    const start = Math.ceil(d0 / step) * step;
    const out = [];
    for (let v = start; v <= d1 + step * 1e-9; v += step) {
      out.push(Math.abs(v) < step * 1e-9 ? 0 : Number(v.toPrecision(12)));
    }
    return out;
  };

  fn.nice = (count = 5) => {
    const step = tickStep(d0, d1, count);
    if (!Number.isFinite(step) || step <= 0) return fn;
    return scaleLinear([Math.floor(d0 / step) * step, Math.ceil(d1 / step) * step], range);
  };

  return fn;
}

function tickStep(start, stop, count) {
  const raw = (stop - start) / Math.max(1, count);
  const power = Math.floor(Math.log10(raw));
  const err = raw / 10 ** power;
  const mult = err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1;
  return mult * 10 ** power;
}
