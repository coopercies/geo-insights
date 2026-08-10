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
// Past this a bar stops reading as a bar and starts reading as a block.
const MAX_BAR = 56;
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
      case 'donut': return <Donut card={card} dataset={dataset} rows={rows} size={size} ink={ink} mode={mode} />;
      case 'stacked':
      case 'grouped':
        return <MultiBar card={card} dataset={dataset} rows={rows} size={size} ink={ink} mode={mode} />;
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

/**
 * Path for a bar rounded only at its data-end, so the baseline stays square
 * and the bar reads as anchored rather than floating.
 */
function barPath({ x, y, w, h, r, dir }) {
  if (w <= 0 || h <= 0) return '';
  if (dir === 'right') {
    const rr = Math.max(0, Math.min(r, w, h / 2));
    return `M${x},${y} H${x + w - rr} A${rr},${rr} 0 0 1 ${x + w},${y + rr} V${y + h - rr} A${rr},${rr} 0 0 1 ${x + w - rr},${y + h} H${x} Z`;
  }
  const rr = Math.max(0, Math.min(r, h, w / 2));
  return `M${x},${y + h} V${y + rr} A${rr},${rr} 0 0 1 ${x + rr},${y} H${x + w - rr} A${rr},${rr} 0 0 1 ${x + w},${y + rr} V${y + h} Z`;
}

function BarChart({ card, dataset, rows, size, ink, mode }) {
  const select = useStore((s) => s.select);
  const selection = useStore((s) => s.selection);
  const { groupField, measureField, stat } = card.config;
  const vertical = card.config.orientation === 'vertical';
  const [hover, setHover] = useState(null);

  // Show only as many bars as can carry a readable label; the rest fold into
  // "Other" rather than collapsing into an unreadable stack of hairlines.
  const limit = vertical
    ? clamp(Math.floor((size.width - PAD.left - PAD.right) / 26), 4, 20)
    : clamp(Math.floor((size.height - PAD.top - 28) / 15), 4, 20);

  const data = useMemo(() => {
    if (!groupField) return [];
    return groupBy(rows, groupField, measureField, stat, limit);
  }, [rows, groupField, measureField, stat, limit]);

  if (!groupField) return <div className="card-empty">Choose a field to group by.</div>;
  if (!data.length) return <div className="card-empty">No rows in the current selection.</div>;

  const activeKey = selection && selection.sourceCardId === card.id ? selection.label : null;
  const max = Math.max(0, ...data.map((d) => d.value));
  const fill = seriesColor(0, mode);

  const onPick = (d) => select(card.id, dataset.id, d.ids, d.key);

  if (vertical) {
    // Category labels go under the axis at an angle, so they need the room.
    const longest = Math.max(...data.map((d) => d.key.length));
    const pad = { ...PAD, bottom: Math.min(96, 30 + Math.min(longest, 18) * 5.2) };
    const w = size.width - pad.left - pad.right;
    const h = size.height - pad.top - pad.bottom;
    if (w <= 0 || h <= 0) return null;

    const y = scaleLinear([0, max || 1], [h, 0]).nice();
    const band = w / data.length;
    const barW = Math.min(MAX_BAR, Math.max(2, band - Math.max(GAP, band * 0.25)));

    return (
      <svg width={size.width} height={size.height} role="img" className="chart-svg">
        <g transform={`translate(${pad.left},${pad.top})`}>
          {y.ticks(4).map((t) => (
            <g key={t} transform={`translate(0,${y(t)})`}>
              <line x1={0} x2={w} stroke={ink.grid} strokeWidth={1} />
              <text x={-8} y={4} textAnchor="end" fill={ink.muted} fontSize={11}>{formatValue(t)}</text>
            </g>
          ))}
          <line x1={0} x2={w} y1={h} y2={h} stroke={ink.axis} strokeWidth={1} />

          {data.map((d, i) => {
            const bx = i * band + (band - barW) / 2;
            const by = y(d.value);
            const isActive = activeKey === d.key;
            const dim = activeKey !== null && !isActive;
            const cx = i * band + band / 2;
            return (
              <g key={d.key} onClick={() => onPick(d)}
                 onMouseEnter={() => setHover(d)} onMouseLeave={() => setHover(null)}
                 style={{ cursor: 'pointer' }}>
                <rect x={i * band} y={0} width={band} height={h} fill="transparent" />
                <path d={barPath({ x: bx, y: by, w: barW, h: h - by, r: BAR_RADIUS, dir: 'up' })}
                      fill={fill} opacity={dim ? 0.35 : 1} />
                <text x={cx} y={h + 14} textAnchor="end" fontSize={10}
                      fill={isActive ? ink.primary : ink.muted}
                      transform={`rotate(-35 ${cx} ${h + 14})`}>
                  {truncate(d.key, 18)}
                </text>
                {(hover === d || data.length <= 12) && (
                  <text x={cx} y={by - 5} textAnchor="middle" fontSize={11} fill={ink.secondary}>
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

  // Horizontal: the safe default, since category names are usually long.
  const left = Math.min(180, Math.max(80, ...data.map((d) => d.key.length * 6.6)));
  const pad = { ...PAD, left, bottom: 28 };
  const w = size.width - pad.left - pad.right;
  const h = size.height - pad.top - pad.bottom;
  if (w <= 0 || h <= 0) return null;

  const x = scaleLinear([0, max || 1], [0, w]);
  const band = h / data.length;
  const barH = Math.min(MAX_BAR, Math.max(3, band - Math.max(GAP, band * 0.25)));

  return (
    <svg width={size.width} height={size.height} role="img" className="chart-svg">
      <g transform={`translate(${pad.left},${pad.top})`}>
        {x.ticks(4).map((t) => (
          <g key={t} transform={`translate(${x(t)},0)`}>
            <line y1={0} y2={h} stroke={ink.grid} strokeWidth={1} />
            <text y={h + 16} textAnchor="middle" fill={ink.muted} fontSize={11}>{formatValue(t)}</text>
          </g>
        ))}
        <line x1={0} x2={0} y1={0} y2={h} stroke={ink.axis} strokeWidth={1} />

        {data.map((d, i) => {
          const by = i * band + (band - barH) / 2;
          const bw = Math.max(0, x(d.value));
          const isActive = activeKey === d.key;
          const dim = activeKey !== null && !isActive;
          return (
            <g key={d.key} onClick={() => onPick(d)}
               onMouseEnter={() => setHover(d)} onMouseLeave={() => setHover(null)}
               style={{ cursor: 'pointer' }}>
              {/* Full-width hit target so thin bars stay clickable. */}
              <rect x={-pad.left} y={i * band} width={w + pad.left} height={band} fill="transparent" />
              <path d={barPath({ x: 0, y: by, w: bw, h: barH, r: BAR_RADIUS, dir: 'right' })}
                    fill={fill} opacity={dim ? 0.35 : 1} />
              <text x={-8} y={by + barH / 2 + 4} textAnchor="end" fontSize={11}
                    fill={isActive ? ink.primary : ink.secondary}>
                {truncate(d.key, Math.floor(pad.left / 6.6))}
              </text>
              {(hover === d || data.length <= 12) && (() => {
                // Near the right edge the label would be clipped, so flip it
                // inside the bar where there is guaranteed room.
                const label = formatValue(d.value);
                const outside = bw + 8 + label.length * 6.4 < w;
                return (
                  <text
                    x={outside ? bw + 6 : bw - 6}
                    y={by + barH / 2 + 4}
                    textAnchor={outside ? 'start' : 'end'}
                    fontSize={11}
                    fill={outside ? ink.secondary : ink.surface}
                    fontWeight={outside ? 400 : 550}
                  >
                    {label}
                  </text>
                );
              })()}
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

/* -------------------------------------------------------------- donut ---- */

function Donut({ card, dataset, rows, size, ink, mode }) {
  const select = useStore((s) => s.select);
  const selection = useStore((s) => s.selection);
  const { groupField, measureField, stat } = card.config;
  const [hover, setHover] = useState(null);

  // Eight slices is the palette ceiling; past that nobody can tell them apart.
  const data = useMemo(() => {
    if (!groupField) return [];
    return groupBy(rows, groupField, measureField, stat, 8);
  }, [rows, groupField, measureField, stat]);

  if (!groupField) return <div className="card-empty">Choose a field to group by.</div>;
  if (!data.length) return <div className="card-empty">No rows in the current selection.</div>;

  const total = data.reduce((a, d) => a + Math.max(0, d.value), 0);
  if (total <= 0) return <div className="card-empty">Nothing to divide — every value is zero.</div>;

  const legendW = Math.min(190, Math.max(120, size.width * 0.42));
  const plotW = size.width - legendW;
  const cx = plotW / 2;
  const cy = size.height / 2;
  const outer = Math.max(10, Math.min(plotW, size.height) / 2 - 14);
  const inner = outer * 0.58; // a donut, so the centre can carry the total
  const activeKey = selection && selection.sourceCardId === card.id ? selection.label : null;

  let angle = -Math.PI / 2;
  const arcs = data.map((d, i) => {
    const frac = Math.max(0, d.value) / total;
    const a0 = angle;
    const a1 = angle + frac * Math.PI * 2;
    angle = a1;
    return { d, i, a0, a1, frac };
  });

  const arcPath = (a0, a1, rIn, rOut) => {
    // A full circle can't be drawn as a single arc — nudge it closed.
    const span = a1 - a0;
    const end = span >= Math.PI * 2 ? a1 - 0.0001 : a1;
    const large = end - a0 > Math.PI ? 1 : 0;
    const p = (r, a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    const [x0, y0] = p(rOut, a0), [x1, y1] = p(rOut, end);
    const [x2, y2] = p(rIn, end), [x3, y3] = p(rIn, a0);
    return `M${x0},${y0} A${rOut},${rOut} 0 ${large} 1 ${x1},${y1} L${x2},${y2} A${rIn},${rIn} 0 ${large} 0 ${x3},${y3} Z`;
  };

  return (
    <svg width={size.width} height={size.height} role="img" className="chart-svg">
      {arcs.map(({ d, i, a0, a1, frac }) => {
        const isActive = activeKey === d.key;
        const dim = activeKey !== null && !isActive;
        const pop = hover === d || isActive ? 3 : 0;
        return (
          <g key={d.key} style={{ cursor: 'pointer' }}
             onClick={() => select(card.id, dataset.id, d.ids, d.key)}
             onMouseEnter={() => setHover(d)} onMouseLeave={() => setHover(null)}>
            <path d={arcPath(a0, a1, inner, outer + pop)}
                  fill={seriesColor(i, mode)} opacity={dim ? 0.35 : 1}
                  stroke={ink.surface} strokeWidth={2} />
          </g>
        );
      })}
      <text x={cx} y={cy - 2} textAnchor="middle" fontSize={18} fontWeight={620} fill={ink.primary}>
        {formatValue(hover ? hover.value : total)}
      </text>
      <text x={cx} y={cy + 15} textAnchor="middle" fontSize={10} fill={ink.muted}>
        {hover ? truncate(hover.key, 16) : 'total'}
      </text>

      {/* Legend carries identity, so colour is never the only channel. */}
      {data.map((d, i) => (
        <g key={d.key} transform={`translate(${plotW + 6},${18 + i * 18})`} style={{ cursor: 'pointer' }}
           onClick={() => select(card.id, dataset.id, d.ids, d.key)}
           onMouseEnter={() => setHover(d)} onMouseLeave={() => setHover(null)}>
          <rect x={0} y={-8} width={legendW - 10} height={16} fill="transparent" />
          <rect x={0} y={-5} width={10} height={10} rx={2} fill={seriesColor(i, mode)} />
          <text x={16} y={4} fontSize={11} fill={ink.secondary}>
            {truncate(d.key, Math.floor((legendW - 70) / 6.2))}
          </text>
          <text x={legendW - 14} y={4} fontSize={10} textAnchor="end" fill={ink.muted}>
            {((d.value / total) * 100).toFixed(0)}%
          </text>
        </g>
      ))}
    </svg>
  );
}

/* ------------------------------------------------- stacked / grouped ----- */

function MultiBar({ card, dataset, rows, size, ink, mode }) {
  const select = useStore((s) => s.select);
  const selection = useStore((s) => s.selection);
  const { groupField, seriesField, measureField, stat } = card.config;
  const stacked = card.config.chartType === 'stacked';
  const [hover, setHover] = useState(null);

  const { groups, series } = useMemo(() => {
    if (!groupField || !seriesField) return { groups: [], series: [] };
    const primary = groupBy(rows, groupField, measureField, stat, 12);
    const seriesTotals = new Map();
    for (const r of rows) {
      const k = r[seriesField] == null || r[seriesField] === '' ? '(no value)' : String(r[seriesField]);
      seriesTotals.set(k, (seriesTotals.get(k) || 0) + 1);
    }
    const names = [...seriesTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k]) => k);
    const nameSet = new Set(names);
    const hasOther = seriesTotals.size > names.length;
    const allNames = hasOther ? [...names, 'Other'] : names;

    const byId = new Map(rows.map((r) => [r.__i, r]));
    const out = primary.map((g) => {
      const parts = new Map(allNames.map((n) => [n, { value: 0, ids: [] }]));
      for (const id of g.ids) {
        const r = byId.get(id);
        if (!r) continue;
        const raw = r[seriesField];
        const k = raw == null || raw === '' ? '(no value)' : String(raw);
        const bucket = nameSet.has(k) ? k : 'Other';
        const p = parts.get(bucket);
        if (!p) continue;
        p.ids.push(id);
        p.value += stat === 'count' || !measureField ? 1 : (toNumber(r[measureField]) ?? 0);
      }
      return { key: g.key, ids: g.ids, parts: allNames.map((n) => ({ name: n, ...parts.get(n) })) };
    });
    return { groups: out, series: allNames };
  }, [rows, groupField, seriesField, measureField, stat]);

  if (!groupField || !seriesField) {
    return <div className="card-empty">Choose a field to group by and a field to split by.</div>;
  }
  if (!groups.length) return <div className="card-empty">No rows in the current selection.</div>;

  const legendH = 20;
  const longest = Math.max(...groups.map((g) => g.key.length));
  const pad = { ...PAD, top: PAD.top + legendH, bottom: Math.min(90, 30 + Math.min(longest, 16) * 5 ) };
  const w = size.width - pad.left - pad.right;
  const h = size.height - pad.top - pad.bottom;
  if (w <= 0 || h <= 0) return null;

  const max = stacked
    ? Math.max(...groups.map((g) => g.parts.reduce((a, p) => a + p.value, 0)))
    : Math.max(...groups.flatMap((g) => g.parts.map((p) => p.value)));
  const y = scaleLinear([0, max || 1], [h, 0]).nice();
  const band = w / groups.length;
  const inner = Math.max(2, band * 0.72);
  const activeKey = selection && selection.sourceCardId === card.id ? selection.label : null;

  return (
    <svg width={size.width} height={size.height} role="img" className="chart-svg">
      {/* legend — always present for two or more series */}
      {series.map((s, i) => (
        <g key={s} transform={`translate(${PAD.left + i * Math.min(110, w / series.length)},12)`}>
          <rect x={0} y={-5} width={9} height={9} rx={2} fill={seriesColor(i, mode)} />
          <text x={14} y={4} fontSize={10} fill={ink.secondary}>{truncate(s, 12)}</text>
        </g>
      ))}

      <g transform={`translate(${pad.left},${pad.top})`}>
        {y.ticks(4).map((t) => (
          <g key={t} transform={`translate(0,${y(t)})`}>
            <line x1={0} x2={w} stroke={ink.grid} strokeWidth={1} />
            <text x={-8} y={4} textAnchor="end" fill={ink.muted} fontSize={11}>{formatValue(t)}</text>
          </g>
        ))}
        <line x1={0} x2={w} y1={h} y2={h} stroke={ink.axis} strokeWidth={1} />

        {groups.map((g, gi) => {
          const dim = activeKey !== null && activeKey !== g.key;
          const cx = gi * band + band / 2;
          let acc = 0;
          return (
            <g key={g.key} style={{ cursor: 'pointer' }}
               onClick={() => select(card.id, dataset.id, g.ids, g.key)}>
              <rect x={gi * band} y={0} width={band} height={h} fill="transparent" />
              {g.parts.map((p, si) => {
                if (p.value <= 0) return null;
                let x0, bw, y0, bh;
                if (stacked) {
                  x0 = gi * band + (band - inner) / 2;
                  bw = inner;
                  y0 = y(acc + p.value);
                  bh = Math.max(0, y(acc) - y(acc + p.value) - GAP);
                  acc += p.value;
                } else {
                  const each = inner / g.parts.length;
                  x0 = gi * band + (band - inner) / 2 + si * each;
                  bw = Math.max(1, each - GAP);
                  y0 = y(p.value);
                  bh = h - y(p.value);
                }
                return (
                  <path key={p.name}
                        d={barPath({ x: x0, y: y0, w: bw, h: bh, r: BAR_RADIUS, dir: 'up' })}
                        fill={seriesColor(si, mode)} opacity={dim ? 0.35 : 1}
                        onMouseEnter={() => setHover({ group: g.key, name: p.name, value: p.value })}
                        onMouseLeave={() => setHover(null)} />
                );
              })}
              <text x={cx} y={h + 14} textAnchor="end" fontSize={10} fill={ink.muted}
                    transform={`rotate(-35 ${cx} ${h + 14})`}>
                {truncate(g.key, 16)}
              </text>
            </g>
          );
        })}
      </g>
      {hover && (
        <ChartTip ink={ink} x={PAD.left + 8} y={pad.top + 4}
                  lines={[`${hover.group} · ${hover.name}`, formatValue(hover.value)]} />
      )}
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

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
