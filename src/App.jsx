import { useCallback, useEffect, useRef, useState } from 'react';
import Sidebar from './components/Sidebar.jsx';
import Canvas from './components/Canvas.jsx';
import { useStore } from './store.js';
import { ingestFile, ingestUrl, sizeVerdict } from './lib/ingest.js';
import { downloadProject, readProject, sizeWarning, isProjectFile } from './lib/project.js';
import { parseRoute } from './lib/router.js';
import { loadSharedProject } from './lib/share.js';
import { loadPublishedProject, isSignedIn } from './lib/api.js';
import AccountBar from './components/AccountBar.jsx';
import ShareDialog from './components/ShareDialog.jsx';
import PageTabs from './components/PageTabs.jsx';
import OpenDialog from './components/OpenDialog.jsx';

export default function App() {
  const route = useRef(parseRoute()).current;
  return route.name === 'view' ? <SharedDashboard shareId={route.shareId} /> : <Editor />;
}

/** A published dashboard: same cards, same interactions, nothing editable. */
function SharedDashboard({ shareId }) {
  const [state, setState] = useState({ status: 'loading', error: null, title: null });
  const cards = useStore((s) => s.cards);
  const selection = useStore((s) => s.selection);
  const mode = useStore((s) => s.mode);
  const setMode = useStore((s) => s.setMode);
  const clearSelection = useStore((s) => s.clearSelection);
  const loadProject = useStore((s) => s.loadProject);
  const setReadOnly = useStore((s) => s.setReadOnly);
  const loadedRef = useRef(false);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    setReadOnly(true);
    // Backend first, then statically published files — dashboards published
    // before the backend existed keep working.
    loadPublishedProject(shareId)
      .then((fromApi) => fromApi || loadSharedProject(shareId))
      .then((project) => {
        loadProject(project);
        setState({ status: 'ready', error: null, title: project.title });
      })
      .catch((err) => setState({ status: 'error', error: err.message, title: null }));
  }, [shareId, loadProject, setReadOnly]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') clearSelection(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [clearSelection]);

  if (state.status === 'error') {
    return (
      <div className="app">
        <div className="empty-state">
          <div className="empty-card">
            <h1>Dashboard unavailable</h1>
            <p>{state.error}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" />
          {state.title || 'Geo Insights'}
        </div>
        <div className="topbar-center">
          {selection ? (
            <div className="selection-pill">
              <strong>{selection.label}</strong>
              <button onClick={clearSelection} title="Clear selection (Esc)">clear</button>
            </div>
          ) : (
            cards.length > 0 && <span className="topbar-quiet">select on any card to filter the rest</span>
          )}
        </div>
        <div className="topbar-actions">
          <span className="view-badge">shared view</span>
          <button className="mode-toggle" title="Toggle light/dark"
                  onClick={() => setMode(mode === 'dark' ? 'light' : 'dark')}>
            {mode === 'dark' ? '☀' : '☾'}
          </button>
        </div>
      </header>

      {state.status === 'ready' && <PageTabs />}

      <div className="main">
        {state.status === 'loading'
          ? <div className="empty-state"><div className="empty-card"><h1>Loading dashboard…</h1></div></div>
          : <Canvas />}
      </div>
    </div>
  );
}

function Editor() {
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [openOpen, setOpenOpen] = useState(false);
  const [project, setProject] = useState(null);
  const [signedIn, setSignedIn] = useState(isSignedIn());
  const urlLoadedRef = useRef(false);

  const datasets = useStore((s) => s.datasets);
  const cards = useStore((s) => s.cards);
  const layout = useStore((s) => s.layout);
  const pages = useStore((s) => s.pages);
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
          const warning = sizeVerdict(file.size, file.name).warning;
          const ds = await ingestFile(file);
          addDataset(ds);
          setStatus({
            kind: 'ok',
            text: warning
              ? `Added ${ds.name} — ${ds.rows.length.toLocaleString()} rows. ${warning}`
              : `Added ${ds.name} — ${ds.rows.length.toLocaleString()} rows, ${ds.fields.length} fields`,
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
    const bytes = downloadProject({ datasets, cards, layout, pages });
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
          <AccountBar onSignedIn={() => setSignedIn(true)} />
          {signedIn && (
            <button className="btn-primary" onClick={() => setShareOpen(true)} disabled={!datasets.length}>
              Save &amp; share
            </button>
          )}
          <button onClick={() => setOpenOpen(true)} title="Open a saved dashboard or a project file">
            Open
          </button>
          <button onClick={save} disabled={!datasets.length} title="Download a .geoinsights.json file">
            Export
          </button>
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

      {cards.length > 0 && <PageTabs />}

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

      {openOpen && (
        <OpenDialog
          onClose={() => setOpenOpen(false)}
          onOpened={(rec) => setProject(rec)}
          onFiles={handleFiles}
        />
      )}

      {shareOpen && (
        <ShareDialog
          project={project}
          onClose={() => setShareOpen(false)}
          onSaved={(rec) => rec && setProject(rec)}
        />
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
          <li><strong>Esc</strong> clears the selection. <strong>Export</strong> writes a self-contained project file.</li>
          <li><strong>Open</strong> reopens a saved dashboard, or a project file from this computer.</li>
        </ul>
      </div>
    </div>
  );
}
