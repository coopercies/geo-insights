import { useState } from 'react';
import { useStore } from '../store.js';
import { STATS } from '../lib/stats.js';
import { BASEMAP_OPTIONS } from '../lib/basemaps.js';
import { RAMP_OPTIONS, CATEGORICAL } from '../lib/palette.js';
import { CLASS_METHODS } from '../lib/classify.js';
import ErrorBoundary from './ErrorBoundary.jsx';
import MapCard from './cards/MapCard.jsx';
import ChartCard from './cards/ChartCard.jsx';
import StatCard from './cards/StatCard.jsx';
import TextCard from './cards/TextCard.jsx';
import TitleCard, { TITLE_SIZES, TITLE_ALIGN } from './cards/TitleCard.jsx';
import TableCard from './cards/TableCard.jsx';

const TITLES = { map: 'Map', chart: 'Chart', stat: 'Statistic', text: 'Text', table: 'Table', title: 'Title' };

const CHART_TYPES = [
  { key: 'bar', label: 'Bar' },
  { key: 'stacked', label: 'Stacked bar' },
  { key: 'grouped', label: 'Grouped bar' },
  { key: 'donut', label: 'Donut' },
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
  const readOnly = useStore((s) => s.readOnly);
  const dataset = datasets.find((d) => d.id === card.datasetId);

  const Body = {
    map: MapCard, chart: ChartCard, stat: StatCard,
    text: TextCard, table: TableCard, title: TitleCard,
  }[card.type];

  // In a published view, title and text cards are the content — a header bar
  // labelled "Title" above a title is just chrome.
  const bareCard = readOnly && ['title', 'text'].includes(card.type) && !card.config.title;

  return (
    <div className={`card${bareCard ? ' card-bare' : ''}`}>
      {!bareCard && (
      <header className={`card-head${readOnly ? '' : ' card-drag-handle'}`}>
        <span className="card-title">
          {card.config.title || TITLES[card.type]}
          {dataset && <span className="card-source"> · {dataset.name}</span>}
        </span>
        {!readOnly && (
          <span className="card-actions">
            {!['text'].includes(card.type) && (
              <button title="Settings" onClick={() => setOpen((v) => !v)} className={open ? 'on' : ''}>⚙</button>
            )}
            <button title="Duplicate" onClick={() => duplicateCard(card.id)}>⧉</button>
            <button title="Remove" onClick={() => removeCard(card.id)}>✕</button>
          </span>
        )}
      </header>
      )}
      {open && !readOnly && <Settings card={card} dataset={dataset} onClose={() => setOpen(false)} />}
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

  const mode = useStore((s) => s.mode);
  const numeric = dataset ? dataset.fields.filter((f) => f.type === 'number') : [];
  // Identifiers and coordinates stay selectable but never seed a default.
  const measures = numeric.filter((f) => !f.isKey);
  const colorMode = card.config.colorMode ?? (card.config.colorField ? 'graduated' : 'single');
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
      {!['title', 'text'].includes(card.type) && (
        <label>
          <span>Data</span>
          <select value={card.datasetId ?? ''} onChange={(e) => updateCard(card.id, { datasetId: e.target.value })}>
            {datasets.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
      )}

      {card.type === 'map' && (
        <>
          <label>
            <span>Basemap</span>
            <select value={card.config.basemap ?? 'auto'} onChange={(e) => set({ basemap: e.target.value })}>
              {BASEMAP_OPTIONS.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
            </select>
          </label>
          <label>
            <span>Symbology</span>
            <select value={colorMode} onChange={(e) => {
              const next = e.target.value;
              // Each mode wants a different kind of field, so re-seed sensibly.
              const field = next === 'graduated' ? (measures[0]?.name ?? null)
                : next === 'categorical' ? (cats[0]?.name ?? null)
                : null;
              set({ colorMode: next, colorField: field });
            }}>
              <option value="single">Single color</option>
              <option value="graduated">Graduated (numeric)</option>
              <option value="categorical">Categories (text)</option>
            </select>
          </label>

          {colorMode !== 'single' && (
            <label>
              <span>Color by</span>
              <select value={card.config.colorField ?? ''} onChange={(e) => set({ colorField: e.target.value || null })}>
                <option value="">—</option>
                {(colorMode === 'categorical' ? cats : numeric).map((f) =>
                  <option key={f.name} value={f.name}>{f.name}</option>)}
              </select>
            </label>
          )}

          {colorMode === 'graduated' && (
            <>
              <label>
                <span>Ramp</span>
                <select value={card.config.ramp ?? 'blue'} onChange={(e) => set({ ramp: e.target.value })}>
                  {RAMP_OPTIONS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                </select>
              </label>
              <label>
                <span>Breaks</span>
                <select value={card.config.method ?? 'quantile'} onChange={(e) => set({ method: e.target.value })}>
                  {CLASS_METHODS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              </label>
              <label>
                <span>Classes</span>
                <select value={card.config.classes ?? 5} onChange={(e) => set({ classes: Number(e.target.value) })}>
                  {[3, 4, 5, 6, 7, 8, 9].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              <label className="checkbox">
                <span>Reverse</span>
                <input type="checkbox" checked={!!card.config.reverseRamp}
                       onChange={(e) => set({ reverseRamp: e.target.checked })} />
              </label>
            </>
          )}

          {colorMode === 'single' && (
            <label>
              <span>Color</span>
              <div className="swatch-row">
                {CATEGORICAL[mode].map((c) => (
                  <button key={c} type="button" title={c}
                          className={`swatch-btn${(card.config.singleColor ?? CATEGORICAL[mode][0]) === c ? ' on' : ''}`}
                          style={{ background: c }}
                          onClick={() => set({ singleColor: c })} />
                ))}
              </div>
            </label>
          )}

          {dataset && dataset.geometryType === 'point' && (
            <label>
              <span>Size by</span>
              <select value={card.config.sizeField ?? ''} onChange={(e) => set({ sizeField: e.target.value || null })}>
                <option value="">(fixed size)</option>
                {measures.map((f) => <option key={f.name} value={f.name}>{f.name}</option>)}
              </select>
            </label>
          )}

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

          {['bar', 'line', 'box', 'donut', 'stacked', 'grouped'].includes(card.config.chartType) && (
            <label>
              <span>{card.config.chartType === 'line' ? 'X axis' : 'Group by'}</span>
              <select value={card.config.groupField ?? ''} onChange={(e) => set({ groupField: e.target.value || null })}>
                <option value="">—</option>
                {(card.config.chartType === 'line' ? dates : cats).map((f) =>
                  <option key={f.name} value={f.name}>{f.name}</option>)}
              </select>
            </label>
          )}

          {['bar', 'line', 'histogram', 'box', 'donut', 'stacked', 'grouped'].includes(card.config.chartType) && (
            <label>
              <span>{card.config.chartType === 'histogram' ? 'Field' : 'Measure'}</span>
              <select value={card.config.measureField ?? ''} onChange={(e) => set({ measureField: e.target.value || null })}>
                <option value="">—</option>
                {numeric.map((f) => <option key={f.name} value={f.name}>{f.name}</option>)}
              </select>
            </label>
          )}

          {card.config.chartType === 'bar' && (
            <label>
              <span>Bars</span>
              <select value={card.config.orientation ?? 'horizontal'}
                      onChange={(e) => set({ orientation: e.target.value })}>
                <option value="horizontal">Horizontal</option>
                <option value="vertical">Vertical</option>
              </select>
            </label>
          )}

          {['stacked', 'grouped'].includes(card.config.chartType) && (
            <label>
              <span>Split by</span>
              <select value={card.config.seriesField ?? ''} onChange={(e) => set({ seriesField: e.target.value || null })}>
                <option value="">—</option>
                {cats.map((f) => <option key={f.name} value={f.name}>{f.name}</option>)}
              </select>
            </label>
          )}

          {['bar', 'line', 'stacked', 'grouped', 'donut'].includes(card.config.chartType) && (
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

      {card.type === 'title' && (
        <>
          <label className="wide">
            <span>Text</span>
            <input type="text" value={card.config.text ?? ''} placeholder="Dashboard title"
                   onChange={(e) => set({ text: e.target.value })} />
          </label>
          <label className="wide">
            <span>Subtitle</span>
            <input type="text" value={card.config.subtitle ?? ''} placeholder="(optional)"
                   onChange={(e) => set({ subtitle: e.target.value })} />
          </label>
          <label>
            <span>Size</span>
            <select value={card.config.size ?? 'lg'} onChange={(e) => set({ size: e.target.value })}>
              {TITLE_SIZES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </label>
          <label>
            <span>Align</span>
            <select value={card.config.align ?? 'left'} onChange={(e) => set({ align: e.target.value })}>
              {TITLE_ALIGN.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
        </>
      )}

      {card.type !== 'title' && (
        <label>
          <span>Card title</span>
          <input type="text" value={card.config.title ?? ''} placeholder="(automatic)"
                 onChange={(e) => set({ title: e.target.value })} />
        </label>
      )}
    </div>
  );
}
