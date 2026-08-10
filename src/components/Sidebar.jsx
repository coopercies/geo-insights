import { useRef, useState } from 'react';
import { useStore } from '../store.js';
import ReprojectDialog from './ReprojectDialog.jsx';

const CARD_BUTTONS = [
  { type: 'map', label: 'Map', icon: '🗺', needsGeo: true },
  { type: 'chart', label: 'Chart', icon: '📊' },
  { type: 'stat', label: 'Statistic', icon: '#' },
  { type: 'table', label: 'Table', icon: '▦' },
  { type: 'title', label: 'Title', icon: 'H', needsData: false },
  { type: 'text', label: 'Text', icon: 'T', needsData: false },
];

export default function Sidebar({ onFiles }) {
  const datasets = useStore((s) => s.datasets);
  const activeDatasetId = useStore((s) => s.activeDatasetId);
  const addCard = useStore((s) => s.addCard);
  const removeDataset = useStore((s) => s.removeDataset);
  const setStatus = useStore((s) => s.setStatus);
  const inputRef = useRef(null);
  const [expanded, setExpanded] = useState(null);
  const [reprojecting, setReprojecting] = useState(null);

  const active = datasets.find((d) => d.id === activeDatasetId) ?? datasets[0];

  return (
    <aside className="sidebar">
      <div className="sidebar-section">
        <div className="sidebar-label">Data</div>
        <button className="btn-primary full" onClick={() => inputRef.current.click()}>
          Add data…
        </button>
        <input
          ref={inputRef} type="file" multiple hidden
          accept=".geojson,.json,.csv,.tsv,.zip"
          onChange={(e) => { onFiles([...e.target.files]); e.target.value = ''; }}
        />

        {!datasets.length && (
          <p className="sidebar-hint">
            Drop a <code>.geojson</code>, <code>.csv</code>, or zipped shapefile anywhere
            on the page. CSVs with latitude/longitude columns are mapped automatically.
          </p>
        )}

        <ul className="dataset-list">
          {datasets.map((d) => (
            <li key={d.id} className={d.id === active?.id ? 'on' : ''}>
              <div className="dataset-row" onClick={() => setExpanded(expanded === d.id ? null : d.id)}>
                <span className="dataset-name" title={d.name}>{d.name}</span>
                <span className="dataset-meta">
                  {d.rows.length.toLocaleString()}
                  {d.projected ? ' · needs reprojecting' : d.geometryType ? ` · ${d.geometryType}` : ' · no geometry'}
                </span>
                <button className="icon-btn" title="Remove dataset"
                        onClick={(e) => { e.stopPropagation(); removeDataset(d.id); }}>✕</button>
              </div>
              {expanded === d.id && d.projected && (
                <div className="dataset-fix">
                  <button className="btn-primary full" onClick={(e) => { e.stopPropagation(); setReprojecting(d); }}>
                    Reproject to lat/long…
                  </button>
                </div>
              )}
              {expanded === d.id && (
                <ul className="field-list">
                  {d.fields.map((f) => (
                    <li key={f.name}>
                      <span className={`type-chip t-${f.type}`}>{f.type[0].toUpperCase()}</span>
                      <span className="field-name" title={f.name}>{f.name}</span>
                      {f.type === 'number' && (
                        <span className="field-range">{fmt(f.min)} – {fmt(f.max)}</span>
                      )}
                      {f.type === 'string' && (
                        <span className="field-range">
                          {f.distinct}{f.distinctCapped ? '+' : ''} values
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </div>

      <div className="sidebar-section">
        <div className="sidebar-label">Add card</div>
        <div className="card-buttons">
          {CARD_BUTTONS.map((b) => {
            const disabled = b.needsData === false ? false : !datasets.length;
            const noGeo = b.needsGeo && active && !active.geojson;
            return (
              <button
                key={b.type}
                disabled={disabled}
                title={noGeo ? `${active.name} has no geometry` : b.label}
                onClick={() => {
                  if (noGeo) return setStatus({ kind: 'error', text: `${active.name} has no geometry to map.` });
                  addCard(b.type, active?.id);
                }}
              >
                <span className="card-btn-icon">{b.icon}</span>
                {b.label}
              </button>
            );
          })}
        </div>
      </div>

      {reprojecting && (
        <ReprojectDialog dataset={reprojecting} onClose={() => setReprojecting(null)} />
      )}
    </aside>
  );
}

function fmt(v) {
  if (v === undefined || v === null) return '—';
  if (Math.abs(v) >= 100000 || (v !== 0 && Math.abs(v) < 0.01)) return v.toExponential(1);
  return Number(v.toFixed(2)).toLocaleString();
}
