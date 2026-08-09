import { useCallback, useEffect, useRef, useState } from 'react';
import Sidebar from './components/Sidebar.jsx';
import Canvas from './components/Canvas.jsx';
import { useStore } from './store.js';
import { ingestFile, ingestUrl } from './lib/ingest.js';
import { downloadProject, readProject, sizeWarning, isProjectFile } from './lib/project.js';

export default function App() {
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const urlLoadedRef = useRef(false);

  const datasets = useStore((s) => s.datasets);
  const cards = useStore((s) => s.cards);
  const layout = useStore((s) => s.layout);
  const selection = useStore((s) => s.selection);
  const mode = useStore((s) => s.mode);
  const status = useStore((s) => s.status);
  const addDataset = useStore((s) => s.addDataset);
  const clearSelection = useStore((s) => s.clearSelection);
  const setMode = useStore((s) => s.setMode);
  const setStatus = useStore((s) => s.setStatus);
  const loadProject = useStore((s) => s.loadProject);
  const reset = useStore((s) => s.reset);

  const handleFiles = useCallback(async (files) => {
    if (!files.length) return;
    setBusy(true);
    try {
      for (const file of files) {
        try {
          if (isProjectFile(file)) {
            loadProject(await readProject(file));
            setStatus({ kind: 'ok', text: `Opened ${file.name}` });
            continue;
          }
          const ds = await ingestFile(file);
          addDataset(ds);
          setStatus({
            kind: 'ok',
            text: `Added ${ds.name} — ${ds.rows.length.toLocaleString()} rows, ${ds.fields.length} fields`,
          });
        } catch (err) {
          setStatus({ kind: 'error', text: err.message });
        }
      }
    } finally {
      setBusy(false);
    }
  }, [addDataset, loadProject, setStatus]);

  // Window-wide drop, so files can land anywhere rather than on one target.
  useEffect(() => {
    let depth = 0;
    const onEnter = (e) => { e.preventDefault(); depth++; setDragging(true); };
    const onLeave = (e) => { e.preventDefault(); if (--depth <= 0) { depth = 0; setDragging(false); } };
    const onOver = (e) => e.preventDefault();
    const onDrop = (e) => {
      e.preventDefault();
      depth = 0;
      setDragging(false);
      handleFiles([...e.dataTransfer.files]);
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('dragover', onOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('drop', onDrop);
    };
  }, [handleFiles]);

  // ?data=<url> loads a layer at startup, so a published dashboard can carry
  // its own data without bundling it.
  useEffect(() => {
    const url = new URLSearchParams(window.location.search).get('data');
    if (!url || urlLoadedRef.current) return;
    urlLoadedRef.current = true; // StrictMode runs mount effects twice in dev
    setBusy(true);
    ingestUrl(url)
      .then((ds) => {
        addDataset(ds);
        setStatus({ kind: 'ok', text: `Loaded ${ds.name} — ${ds.rows.length.toLocaleString()} rows` });
      })
      .catch((err) => setStatus({ kind: 'error', text: err.message }))
      .finally(() => setBusy(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') clearSelection(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [clearSelection]);

  const save = () => {
    const bytes = downloadProject({ datasets, cards, layout });
    const warn = sizeWarning(bytes);
    setStatus(warn ? { kind: 'error', text: warn } : { kind: 'ok', text: 'Project saved.' });
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" />
          Geo Insights
        </div>

        <div className="topbar-center">
          {selection ? (
            <div className="selection-pill">
              <strong>{selection.label}</strong>
              <button onClick={clearSelection} title="Clear selection (Esc)">clear</button>
            </div>
          ) : (
            datasets.length > 0 && <span className="topbar-quiet">no selection — all rows shown</span>
          )}
        </div>

        <div className="topbar-actions">
          <button onClick={save} disabled={!datasets.length}>Save</button>
          <button onClick={() => {
            if (cards.length && !confirm('Clear the current dashboard?')) return;
            reset();
          }}>New</button>
          <button className="mode-toggle" title="Toggle light/dark"
                  onClick={() => setMode(mode === 'dark' ? 'light' : 'dark')}>
            {mode === 'dark' ? '☀' : '☾'}
          </button>
        </div>
      </header>

      <div className="main">
        <Sidebar onFiles={handleFiles} />
        {cards.length ? <Canvas /> : <EmptyState />}
      </div>

      {dragging && (
        <div className="drop-overlay">
          <div className="drop-inner">
            <div className="drop-title">Drop to add data</div>
            <div className="drop-sub">GeoJSON · CSV · zipped shapefile · saved project</div>
          </div>
        </div>
      )}

      {busy && <div className="busy-bar" />}

      {status && (
        <div className={`toast ${status.kind === 'error' ? 'toast-error' : ''}`}
             onClick={() => setStatus(null)}>
          {status.text}
        </div>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="empty-state">
      <div className="empty-card">
        <h1>Build a dashboard from your data</h1>
        <p>
          Drop a GeoJSON, CSV, or zipped shapefile anywhere on this page. A map and a
          statistic appear automatically; add charts, tables, and notes from the left.
        </p>
        <ul>
          <li><strong>Shift-drag on the map</strong> to select features — every chart and statistic follows.</li>
          <li><strong>Click a bar or brush a scatter</strong> to push a selection back to the map.</li>
          <li><strong>Esc</strong> clears the selection. <strong>Save</strong> writes a self-contained project file.</li>
        </ul>
      </div>
    </div>
  );
}
