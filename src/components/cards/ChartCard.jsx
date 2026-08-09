import { useMemo, useRef, useState } from 'react';
import { scaleLinear } from '../../lib/scale.js';
import { useStore, useFilteredRows } from '../../store.js';
import { INK, seriesColor } from '../../lib/palette.js';
import { groupBy, histogram, formatValue, numericValues } from '../../lib/stats.js';
import { toNumber } from '../../lib/fields.js';
import { useSize } from '../useSize.js';
import { quantile } from 'd3-array';

const PAD = { top: 12, right: 16, bottom: 34, left: 56 };
const BAR_RADIUS = 4;
const GAP = 2; // surface gap between adjacent fills

export default function ChartCard({ card }) {
  const [ref, size] = useSize();
  const { dataset, rows, filtered } = useFilteredRows(card);
  const mode = useStore((s) => s.mode);
  const ink = INK[mode];

  if (!dataset) return <div className="card-empty">No dataset bound to this chart.</div>;

  const body = (() => {
    if (!size.width || !size.height) return null;
    switch (card.config.chartType) {
      case 'bar': return <BarChart card={card} dataset={dataset} rows={rows} size={size} ink={ink} mode={mode} />;
      case 'histogram': return <Histogram card={card} dataset={dataset} rows={rows} size={size} ink={ink} mode={mode} />;
      case 'scatter': return <Scatter card={card} dataset={dataset} rows={rows} size={size} ink={ink} mode={mode} />;
      case 'line': return <LineChart card={card} dataset={dataset} rows={rows} size={size} ink={ink} mode={mode} />;
      case 'box': return <BoxPlot card={card} dataset={dataset} rows={rows} size={size} ink={ink} mode={mode} />;
      default: return <div className="card-empty">Pick a chart type.</div>;
    }
  })();

  return (
    <div className="chart-wrap" ref={ref}>
      {filtered && <div className="chart-filter-badge">filtered to selection · {rows.length.toLocaleString()} rows</div>}
      {body}
    </div>
  );
}

/* ---------------------------------------------------------------- bar ---- */

function BarChart({ card, dataset, rows, size, ink, mode }) {
  const select = useStore((s) => s.select);
  const selection = useStore((s) => s.selection);
  const { groupField, measureField, stat } = card.config;
  const [hover, setHover] = useState(null);

  const data = useMemo(() => {
    if (!groupField) return [];
    return groupBy(rows, groupField, measureField, stat);
  }, [rows, groupField, measureField, stat]);

  if (!groupField) return <div className="card-empty">Choose a field to group by.</div>;
  if (!data.length) return <div className="card-empty">No rows in the current selection.</div>;

  // Horizontal bars: category names are usually long, and this keeps them readable.
  const left = Math.min(180, Math.max(80, ...data.map((d) => d.key.length * 6.6)));
  const pad = { ...PAD, left, bottom: 28 };
  const w = size.width - pad.left - pad.right;
  const h = size.height - pad.top - pad.bottom;
  if (w <= 0 || h <= 0) return null;

  const max = Math.max(0, ...data.map((d) => d.value));
  const x = scaleLinear([0, max || 1], [0, w]);
  const band = h / data.length;
  const barH = Math.max(3, band - Math.max(GAP, band * 0.25));

  const activeKey = selection && selection.sourceCardId === card.id ? selection.label : null;
  const ticks = x.ticks(4);

  return (
    <svg width={size.width} height={size.height} role="img" className="chart-svg">
      <g transform={`translate(${pad.left},${pad.top})`}>
        {ticks.map((t) => (
          <g key={t} transform={`translate(${x(t)},0)`}>
            <line y1={0} y2={h} stroke={ink.grid} strokeWidth={1} />
            <text y={h + 16} textAnchor="middle" fill={ink.muted} fontSize={11}>{formatValue(t)}</text>
          </g>
        ))}
        <line x1={0} x2={0} y1={0} y2={h} stroke={ink.axis} strokeWidth={1} />

        {data.map((d, i) => {
          const y = i * band + (band - barH) / 2;
          const bw = Math.max(0, x(d.value));
          const isActive = activeKey === d.key;
          const dim = activeKey !== null && !isActive;
          return (
            <g key={d.key}
               onClick={() => select(card.id, dataset.id, d.ids, d.key)}
               onMouseEnter={() => setHover(d)}
               onMouseLeave={() => setHover(null)}
               style={{ cursor: 'pointer' }}>
              {/* Full-width hit target so thin bars stay clickable. */}
              <rect x={-pad.left} y={i * band} width={w + pad.left} height={band} fill="transparent" />
              <rect
                x={0} y={y} width={bw} height={barH}
                rx={Math.min(BAR_RADIUS, bw / 2)}
                fill={seriesColor(0, mode)}
                opacity={dim ? 0.35 : 1}
              />
              <text x={-8} y={y + barH / 2 + 4} textAnchor="end" fontSize={11}
                    fill={isActive ? ink.primary : ink.secondary}>
                {truncate(d.key, Math.floor(pad.left / 6.6))}
              </text>
              {(hover === d || data.length <= 12) && (
                <text x={bw + 6} y={y + barH / 2 + 4} fontSize={11} fill={ink.secondary}>
                  {formatValue(d.value)}
                </text>
              )}
            </g>
          );
        })}
      </g>
    </svg>
  );
}

/* ---------------------------------------------------------- histogram ---- */

function Histogram({ card, dataset, rows, size, ink, mode }) {
  const select = useStore((s) => s.select);
  const selection = useStore((s) => s.selection);
  const field = card.config.measureField || card.config.xField;
  const [hover, setHover] = useState(null);

  const bins = useMemo(() => (field ? histogram(rows, field) : []), [rows, field]);

  if (!field) return <div className="card-empty">Choose a numeric field.</div>;
  if (!bins.length) return <div className="card-empty">No numeric values in the current selection.</div>;

  const w = size.width - PAD.left - PAD.right;
  const h = size.height - PAD.top - PAD.bottom;
  if (w <= 0 || h <= 0) return null;

  const lo = bins[0].x0;
  const hi = bins[bins.length - 1].x1;
  const x = scaleLinear([lo, hi], [0, w]);
  const maxCount = Math.max(...bins.map((b) => b.value));
  const y = scaleLinear([0, maxCount], [h, 0]);
  const activeLabel = selection && selection.sourceCardId === card.id ? selection.label : null;

  return (
    <svg width={size.width} height={size.height} role="img" className="chart-svg">
      <g transform={`translate(${PAD.left},${PAD.top})`}>
        {y.ticks(4).map((t) => (
          <g key={t} transform={`translate(0,${y(t)})`}>
            <line x1={0} x2={w} stroke={ink.grid} strokeWidth={1} />
            <text x={-8} y={4} textAnchor="end" fill={ink.muted} fontSize={11}>{formatValue(t)}</text>
          </g>
        ))}
        <line x1={0} x2={w} y1={h} y2={h} stroke={ink.axis} strokeWidth={1} />
        {x.ticks(5).map((t) => (
          <text key={t} x={x(t)} y={h + 18} textAnchor="middle" fill={ink.muted} fontSize={11}>
            {formatValue(t)}
          </text>
        ))}

        {bins.map((b, i) => {
          const bx = x(b.x0);
          const bw = Math.max(1, x(b.x1) - x(b.x0) - GAP);
          const by = y(b.value);
          const bh = h - by;
          const label = `${formatValue(b.x0)} – ${formatValue(b.x1)}`;
          const dim = activeLabel !== null && activeLabel !== label;
          return (
            <g key={i}
               onClick={() => select(card.id, dataset.id, b.ids, label)}
               onMouseEnter={() => setHover(b)}
               onMouseLeave={() => setHover(null)}
               style={{ cursor: 'pointer' }}>
              <rect x={bx} y={0} width={bw + GAP} height={h} fill="transparent" />
              <rect x={bx} y={by} width={bw} height={Math.max(0, bh)}
                    rx={Math.min(BAR_RADIUS, bw / 2, bh / 2 || 0)}
                    fill={seriesColor(0, mode)} opacity={dim ? 0.35 : 1} />
            </g>
          );
        })}

        <text x={w / 2} y={h + 32} textAnchor="middle" fill={ink.secondary} fontSize={11}>{field}</text>
      </g>
      {hover && (
        <ChartTip ink={ink} x={PAD.left + x(hover.x0) + 6} y={PAD.top + y(hover.value)}
                  lines={[`${formatValue(hover.x0)} – ${formatValue(hover.x1)}`, `${hover.value.toLocaleString()} rows`]} />
      )}
    </svg>
  );
}

/* ------------------------------------------------------------ scatter ---- */

function Scatter({ card, dataset, rows, size, ink, mode }) {
  const select = useStore((s) => s.select);
  const { xField, yField } = card.config;
  const brushRef = useRef(null);
  const [brush, setBrush] = useState(null);
  const [hover, setHover] = useState(null);

  const pts = useMemo(() => {
    if (!xField || !yField) return [];
    const out = [];
    for (const r of rows) {
      const xv = toNumber(r[xField]);
      const yv = toNumber(r[yField]);
      if (xv === null || yv === null) continue;
      out.push({ x: xv, y: yv, id: r.__i });
    }
    return out;
  }, [rows, xField, yField]);

  if (!xField || !yField) return <div className="card-empty">Choose X and Y fields.</div>;
  if (!pts.length) return <div className="card-empty">No paired numeric values in the current selection.</div>;

  const w = size.width - PAD.left - PAD.right;
  const h = size.height - PAD.top - PAD.bottom;
  if (w <= 0 || h <= 0) return null;

  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x = scaleLinear([Math.min(...xs), Math.max(...xs)], [0, w]).nice();
  const y = scaleLinear([Math.min(...ys), Math.max(...ys)], [h, 0]).nice();
  const r = pts.length > 4000 ? 2 : pts.length > 800 ? 3 : 4.5;

  const toLocal = (e) => {
    const rect = brushRef.current.getBoundingClientRect();
    return { x: e.clientX - rect.left - PAD.left, y: e.clientY - rect.top - PAD.top };
  };

  const onDown = (e) => {
    const p = toLocal(e);
    setBrush({ x0: p.x, y0: p.y, x1: p.x, y1: p.y, live: true });
  };
  const onMove = (e) => {
    if (!brush || !brush.live) return;
    const p = toLocal(e);
    setBrush((b) => ({ ...b, x1: p.x, y1: p.y }));
  };
  const onUp = () => {
    if (!brush || !brush.live) return;
    const b = { ...brush, live: false };
    setBrush(null);
    if (Math.abs(b.x1 - b.x0) < 4 && Math.abs(b.y1 - b.y0) < 4) return select(card.id, dataset.id, null);
    const [lox, hix] = [Math.min(b.x0, b.x1), Math.max(b.x0, b.x1)];
    const [loy, hiy] = [Math.min(b.y0, b.y1), Math.max(b.y0, b.y1)];
    const ids = pts.filter((p) => {
      const px = x(p.x), py = y(p.y);
      return px >= lox && px <= hix && py >= loy && py <= hiy;
    }).map((p) => p.id);
    select(card.id, dataset.id, ids, `${ids.length.toLocaleString()} brushed`);
  };

  return (
    <svg ref={brushRef} width={size.width} height={size.height} role="img" className="chart-svg"
         onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp}
         style={{ cursor: 'crosshair' }}>
      <g transform={`translate(${PAD.left},${PAD.top})`}>
        {y.ticks(4).map((t) => (
          <g key={t} transform={`translate(0,${y(t)})`}>
            <line x1={0} x2={w} stroke={ink.grid} strokeWidth={1} />
            <text x={-8} y={4} textAnchor="end" fill={ink.muted} fontSize={11}>{formatValue(t)}</text>
          </g>
        ))}
        {x.ticks(5).map((t) => (
          <text key={t} x={x(t)} y={h + 18} textAnchor="middle" fill={ink.muted} fontSize={11}>{formatValue(t)}</text>
        ))}
        <line x1={0} x2={w} y1={h} y2={h} stroke={ink.axis} strokeWidth={1} />

        {pts.map((p) => (
          <circle key={p.id} cx={x(p.x)} cy={y(p.y)} r={r}
                  fill={seriesColor(0, mode)} fillOpacity={0.6}
                  stroke={ink.surface} strokeWidth={pts.length > 2000 ? 0 : 1}
                  onMouseEnter={() => setHover(p)} onMouseLeave={() => setHover(null)} />
        ))}

        {brush && (
          <rect x={Math.min(brush.x0, brush.x1)} y={Math.min(brush.y0, brush.y1)}
                width={Math.abs(brush.x1 - brush.x0)} height={Math.abs(brush.y1 - brush.y0)}
                fill={seriesColor(0, mode)} fillOpacity={0.12}
                stroke={seriesColor(0, mode)} strokeWidth={1} />
        )}

        <text x={w / 2} y={h + 32} textAnchor="middle" fill={ink.secondary} fontSize={11}>{xField}</text>
        <text transform={`rotate(-90) translate(${-h / 2},${-PAD.left + 14})`} textAnchor="middle"
              fill={ink.secondary} fontSize={11}>{yField}</text>
      </g>
      {hover && (
        <ChartTip ink={ink} x={PAD.left + x(hover.x) + 10} y={PAD.top + y(hover.y) - 10}
                  lines={[`${xField}: ${formatValue(hover.x)}`, `${yField}: ${formatValue(hover.y)}`]} />
      )}
    </svg>
  );
}

/* --------------------------------------------------------------- line ---- */

function LineChart({ card, dataset, rows, size, ink, mode }) {
  const { groupField, measureField, stat } = card.config;
  const [hover, setHover] = useState(null);

  const data = useMemo(() => {
    if (!groupField) return [];
    const g = groupBy(rows, groupField, measureField, stat, 10000);
    return g
      .map((d) => ({ ...d, t: Date.parse(d.key), num: Number(d.key) }))
      .map((d) => ({ ...d, sortKey: Number.isFinite(d.t) ? d.t : d.num }))
      .filter((d) => Number.isFinite(d.sortKey))
      .sort((a, b) => a.sortKey - b.sortKey);
  }, [rows, groupField, measureField, stat]);

  if (!groupField) return <div className="card-empty">Choose a date or ordered field for the X axis.</div>;
  if (data.length < 2) return <div className="card-empty">Need at least two points along the X axis.</div>;

  const w = size.width - PAD.left - PAD.right;
  const h = size.height - PAD.top - PAD.bottom;
  if (w <= 0 || h <= 0) return null;

  const x = scaleLinear([data[0].sortKey, data[data.length - 1].sortKey], [0, w]);
  const maxV = Math.max(...data.map((d) => d.value));
  const minV = Math.min(0, ...data.map((d) => d.value));
  const y = scaleLinear([minV, maxV], [h, 0]).nice();
  const path = data.map((d, i) => `${i ? 'L' : 'M'}${x(d.sortKey)},${y(d.value)}`).join(' ');
  const isTime = Number.isFinite(Date.parse(data[0].key));

  const onMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left - PAD.left;
    let best = null, bestD = Infinity;
    for (const d of data) {
      const dist = Math.abs(x(d.sortKey) - px);
      if (dist < bestD) { bestD = dist; best = d; }
    }
    setHover(bestD < 40 ? best : null);
  };

  return (
    <svg width={size.width} height={size.height} role="img" className="chart-svg"
         onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
      <g transform={`translate(${PAD.left},${PAD.top})`}>
        {y.ticks(4).map((t) => (
          <g key={t} transform={`translate(0,${y(t)})`}>
            <line x1={0} x2={w} stroke={ink.grid} strokeWidth={1} />
            <text x={-8} y={4} textAnchor="end" fill={ink.muted} fontSize={11}>{formatValue(t)}</text>
          </g>
        ))}
        <line x1={0} x2={w} y1={h} y2={h} stroke={ink.axis} strokeWidth={1} />
        {x.ticks(5).map((t) => (
          <text key={t} x={x(t)} y={h + 18} textAnchor="middle" fill={ink.muted} fontSize={11}>
            {isTime ? new Date(t).toLocaleDateString('en-US', { year: 'numeric', month: 'short' }) : formatValue(t)}
          </text>
        ))}

        <path d={path} fill="none" stroke={seriesColor(0, mode)} strokeWidth={2}
              strokeLinejoin="round" strokeLinecap="round" />

        {hover && (
          <>
            <line x1={x(hover.sortKey)} x2={x(hover.sortKey)} y1={0} y2={h}
                  stroke={ink.axis} strokeWidth={1} strokeDasharray="3 3" />
            <circle cx={x(hover.sortKey)} cy={y(hover.value)} r={5}
                    fill={seriesColor(0, mode)} stroke={ink.surface} strokeWidth={2} />
          </>
        )}
        <text x={w / 2} y={h + 32} textAnchor="middle" fill={ink.secondary} fontSize={11}>{groupField}</text>
      </g>
      {hover && (
        <ChartTip ink={ink} x={PAD.left + x(hover.sortKey) + 10} y={PAD.top + y(hover.value) - 10}
                  lines={[hover.key, formatValue(hover.value)]} />
      )}
    </svg>
  );
}

/* ---------------------------------------------------------------- box ---- */

function BoxPlot({ card, dataset, rows, size, ink, mode }) {
  const select = useStore((s) => s.select);
  const { groupField, measureField } = card.config;

  const groups = useMemo(() => {
    if (!groupField || !measureField) return [];
    const buckets = new Map();
    for (const r of rows) {
      const k = r[groupField] == null || r[groupField] === '' ? '(no value)' : String(r[groupField]);
      const v = toNumber(r[measureField]);
      if (v === null) continue;
      if (!buckets.has(k)) buckets.set(k, { vals: [], ids: [] });
      buckets.get(k).vals.push(v);
      buckets.get(k).ids.push(r.__i);
    }
    return [...buckets.entries()].map(([key, { vals, ids }]) => {
      const s = [...vals].sort((a, b) => a - b);
      const q1 = quantile(s, 0.25), med = quantile(s, 0.5), q3 = quantile(s, 0.75);
      const iqr = q3 - q1;
      return {
        key, ids,
        q1, med, q3,
        lo: Math.max(s[0], q1 - 1.5 * iqr),
        hi: Math.min(s[s.length - 1], q3 + 1.5 * iqr),
        n: s.length,
      };
    }).sort((a, b) => b.med - a.med).slice(0, 14);
  }, [rows, groupField, measureField]);

  if (!groupField || !measureField) return <div className="card-empty">Choose a group field and a numeric measure.</div>;
  if (!groups.length) return <div className="card-empty">No numeric values in the current selection.</div>;

  const pad = { ...PAD, bottom: 52 };
  const w = size.width - pad.left - pad.right;
  const h = size.height - pad.top - pad.bottom;
  if (w <= 0 || h <= 0) return null;

  const lo = Math.min(...groups.map((g) => g.lo));
  const hi = Math.max(...groups.map((g) => g.hi));
  const y = scaleLinear([lo, hi], [h, 0]).nice();
  const band = w / groups.length;
  const bw = Math.min(46, band * 0.6);

  return (
    <svg width={size.width} height={size.height} role="img" className="chart-svg">
      <g transform={`translate(${pad.left},${pad.top})`}>
        {y.ticks(4).map((t) => (
          <g key={t} transform={`translate(0,${y(t)})`}>
            <line x1={0} x2={w} stroke={ink.grid} strokeWidth={1} />
            <text x={-8} y={4} textAnchor="end" fill={ink.muted} fontSize={11}>{formatValue(t)}</text>
          </g>
        ))}
        {groups.map((g, i) => {
          const cx = i * band + band / 2;
          return (
            <g key={g.key} style={{ cursor: 'pointer' }}
               onClick={() => select(card.id, dataset.id, g.ids, g.key)}>
              <rect x={i * band} y={0} width={band} height={h} fill="transparent" />
              <line x1={cx} x2={cx} y1={y(g.lo)} y2={y(g.hi)} stroke={ink.axis} strokeWidth={1} />
              <line x1={cx - bw / 4} x2={cx + bw / 4} y1={y(g.lo)} y2={y(g.lo)} stroke={ink.axis} strokeWidth={1} />
              <line x1={cx - bw / 4} x2={cx + bw / 4} y1={y(g.hi)} y2={y(g.hi)} stroke={ink.axis} strokeWidth={1} />
              <rect x={cx - bw / 2} y={y(g.q3)} width={bw} height={Math.max(1, y(g.q1) - y(g.q3))}
                    rx={2} fill={seriesColor(0, mode)} fillOpacity={0.55}
                    stroke={seriesColor(0, mode)} strokeWidth={1} />
              <line x1={cx - bw / 2} x2={cx + bw / 2} y1={y(g.med)} y2={y(g.med)}
                    stroke={ink.surface} strokeWidth={2} />
              <text x={cx} y={h + 16} textAnchor="end" fontSize={10} fill={ink.muted}
                    transform={`rotate(-35 ${cx} ${h + 16})`}>
                {truncate(g.key, 14)}
              </text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}

/* -------------------------------------------------------------- shared --- */

function ChartTip({ x, y, lines, ink }) {
  const width = Math.max(...lines.map((l) => l.length)) * 6.6 + 16;
  return (
    <g transform={`translate(${x},${y})`} pointerEvents="none">
      <rect x={0} y={-lines.length * 16 - 8} width={width} height={lines.length * 16 + 10} rx={6}
            fill={ink.surface} stroke={ink.border} />
      {lines.map((l, i) => (
        <text key={i} x={8} y={-lines.length * 16 + i * 16 + 6} fontSize={11}
              fill={i === 0 ? ink.primary : ink.secondary}>{l}</text>
      ))}
    </g>
  );
}

function truncate(s, n) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
