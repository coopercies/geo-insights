import { useState } from 'react';
import { useStore } from '../store.js';
import { STATS } from '../lib/stats.js';
import { BASEMAP_OPTIONS } from '../lib/basemaps.js';
import ErrorBoundary from './ErrorBoundary.jsx';
import MapCard from './cards/MapCard.jsx';
import ChartCard from './cards/ChartCard.jsx';
import StatCard from './cards/StatCard.jsx';
import TextCard from './cards/TextCard.jsx';
import TableCard from './cards/TableCard.jsx';

const TITLES = { map: 'Map', chart: 'Chart', stat: 'Statistic', text: 'Text', table: 'Table' };

const CHART_TYPES = [
  { key: 'bar', label: 'Bar' },
  { key: 'histogram', label: 'Histogram' },
  { key: 'scatter', label: 'Scatter' },
  { key: 'line', label: 'Time series' },
  { key: 'box', label: 'Box plot' },
];

export default function CardShell({ card }) {
  const [open, setOpen] = useState(false);
  const removeCard = useStore((s) => s.removeCard);
  const duplicateCard = useStore((s) => s.duplicateCard);
  const datasets = useStore((s) => s.datasets);
  const dataset = datasets.find((d) => d.id === card.datasetId);

  const Body = { map: MapCard, chart: ChartCard, stat: StatCard, text: TextCard, table: TableCard }[card.type];

  return (
    <div className="card">
      <header className="card-head card-drag-handle">
        <span className="card-title">
          {card.config.title || TITLES[card.type]}
          {dataset && <span className="card-source"> · {dataset.name}</span>}
        </span>
        <span className="card-actions">
          {card.type !== 'text' && (
            <button title="Settings" onClick={() => setOpen((v) => !v)} className={open ? 'on' : ''}>⚙</button>
          )}
          <button title="Duplicate" onClick={() => duplicateCard(card.id)}>⧉</button>
          <button title="Remove" onClick={() => removeCard(card.id)}>✕</button>
        </span>
      </header>
      {open && <Settings card={card} dataset={dataset} onClose={() => setOpen(false)} />}
      <div className="card-body">
        {/* Per-card, so one bad card can't take the whole dashboard down. */}
        <ErrorBoundary
          fallback={(err, reset) => (
            <div className="card-empty">
              <strong>This card hit an error</strong>
              <span>{err.message}</span>
              <button onClick={reset}>Try again</button>
            </div>
          )}
        >
          <Body card={card} />
        </ErrorBoundary>
      </div>
    </div>
  );
}

function Settings({ card, dataset }) {
  const updateCard = useStore((s) => s.updateCard);
  const datasets = useStore((s) => s.datasets);
  const set = (patch) => updateCard(card.id, { config: patch });

  const numeric = dataset ? dataset.fields.filter((f) => f.type === 'number') : [];
  // Any text or date column can be grouped on; fewest distinct values first,
  // since those make the most readable charts.
  const cats = dataset
    ? dataset.fields
        .filter((f) => f.type === 'string' || f.type === 'date')
        .sort((a, b) => (a.distinct ?? 0) - (b.distinct ?? 0))
    : [];
  const dates = dataset ? dataset.fields.filter((f) => f.type === 'date' || f.type === 'number') : [];

  return (
    <div className="card-settings">
      <label>
        <span>Data</span>
        <select value={card.datasetId ?? ''} onChange={(e) => updateCard(card.id, { datasetId: e.target.value })}>
          {datasets.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </label>

      {card.type === 'map' && (
        <>
          <label>
            <span>Basemap</span>
            <select value={card.config.basemap ?? 'auto'} onChange={(e) => set({ basemap: e.target.value })}>
              {BASEMAP_OPTIONS.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
            </select>
          </label>
          <label>
            <span>Color by</span>
            <select value={card.config.colorField ?? ''} onChange={(e) => set({ colorField: e.target.value || null })}>
              <option value="">(single color)</option>
              {numeric.map((f) => <option key={f.name} value={f.name}>{f.name}</option>)}
            </select>
          </label>
          <label>
            <span>Classes</span>
            <select value={card.config.classes} onChange={(e) => set({ classes: Number(e.target.value) })}>
              {[3, 4, 5, 6, 7].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <label>
            <span>Opacity</span>
            <input type="range" min="0.1" max="1" step="0.05" value={card.config.opacity ?? 0.85}
                   onChange={(e) => set({ opacity: Number(e.target.value) })} />
          </label>
        </>
      )}

      {card.type === 'chart' && (
        <>
          <label>
            <span>Type</span>
            <select value={card.config.chartType} onChange={(e) => set({ chartType: e.target.value })}>
              {CHART_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
          </label>

          {['bar', 'line', 'box'].includes(card.config.chartType) && (
            <label>
              <span>{card.config.chartType === 'line' ? 'X axis' : 'Group by'}</span>
              <select value={card.config.groupField ?? ''} onChange={(e) => set({ groupField: e.target.value || null })}>
                <option value="">—</option>
                {(card.config.chartType === 'line' ? dates : cats).map((f) =>
                  <option key={f.name} value={f.name}>{f.name}</option>)}
              </select>
            </label>
          )}

          {['bar', 'line', 'histogram', 'box'].includes(card.config.chartType) && (
            <label>
              <span>{card.config.chartType === 'histogram' ? 'Field' : 'Measure'}</span>
              <select value={card.config.measureField ?? ''} onChange={(e) => set({ measureField: e.target.value || null })}>
                <option value="">—</option>
                {numeric.map((f) => <option key={f.name} value={f.name}>{f.name}</option>)}
              </select>
            </label>
          )}

          {['bar', 'line'].includes(card.config.chartType) && (
            <label>
              <span>Aggregate</span>
              <select value={card.config.stat} onChange={(e) => set({ stat: e.target.value })}>
                {STATS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </label>
          )}

          {card.config.chartType === 'scatter' && (
            <>
              <label>
                <span>X</span>
                <select value={card.config.xField ?? ''} onChange={(e) => set({ xField: e.target.value || null })}>
                  <option value="">—</option>
                  {numeric.map((f) => <option key={f.name} value={f.name}>{f.name}</option>)}
                </select>
              </label>
              <label>
                <span>Y</span>
                <select value={card.config.yField ?? ''} onChange={(e) => set({ yField: e.target.value || null })}>
                  <option value="">—</option>
                  {numeric.map((f) => <option key={f.name} value={f.name}>{f.name}</option>)}
                </select>
              </label>
            </>
          )}
        </>
      )}

      {card.type === 'stat' && (
        <>
          <label>
            <span>Statistic</span>
            <select value={card.config.stat} onChange={(e) => set({ stat: e.target.value })}>
              {STATS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </label>
          {card.config.stat !== 'count' && (
            <label>
              <span>Field</span>
              <select value={card.config.field ?? ''} onChange={(e) => set({ field: e.target.value || null })}>
                <option value="">—</option>
                {numeric.map((f) => <option key={f.name} value={f.name}>{f.name}</option>)}
              </select>
            </label>
          )}
          <label>
            <span>Label</span>
            <input type="text" value={card.config.label ?? ''} placeholder="(automatic)"
                   onChange={(e) => set({ label: e.target.value })} />
          </label>
        </>
      )}

      {card.type === 'table' && dataset && (
        <label className="wide">
          <span>Columns</span>
          <select multiple size={5}
                  value={card.config.columns ?? dataset.fields.slice(0, 8).map((f) => f.name)}
                  onChange={(e) => set({ columns: [...e.target.selectedOptions].map((o) => o.value) })}>
            {dataset.fields.map((f) => <option key={f.name} value={f.name}>{f.name}</option>)}
          </select>
        </label>
      )}

      <label>
        <span>Title</span>
        <input type="text" value={card.config.title ?? ''} placeholder="(automatic)"
               onChange={(e) => set({ title: e.target.value })} />
      </label>
    </div>
  );
}
