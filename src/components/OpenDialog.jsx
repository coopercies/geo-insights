import { useEffect, useRef, useState } from 'react';
import { listProjects, openProject, deleteProject, isSignedIn } from '../lib/api.js';
import { useStore } from '../store.js';

const when = (iso) => {
  if (!iso) return '';
  const d = new Date(iso.replace(' ', 'T'));
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};

/**
 * Opening a dashboard. Both routes live here on purpose: saved dashboards from
 * the backend, and project files from disk. Dropping a file on the window
 * already worked but nothing said so, which made it undiscoverable.
 */
export default function OpenDialog({ onClose, onOpened, onFiles }) {
  const [projects, setProjects] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const setStatus = useStore((s) => s.setStatus);
  const loadProject = useStore((s) => s.loadProject);
  const fileRef = useRef(null);
  const signedIn = isSignedIn();

  useEffect(() => {
    if (!signedIn) return setProjects([]);
    listProjects()
      .then(setProjects)
      .catch((err) => { setError(err.message); setProjects([]); });
  }, [signedIn]);

  const open = async (rec) => {
    setBusy(rec.id);
    setError(null);
    try {
      const { project, record } = await openProject(rec.id);
      loadProject(project);
      onOpened(record);
      setStatus({ kind: 'ok', text: `Opened “${record.title || 'Untitled dashboard'}”` });
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const remove = async (rec) => {
    if (!confirm(`Delete “${rec.title || 'Untitled dashboard'}”? Its layers stay stored and shared links stop working.`)) return;
    setBusy(rec.id);
    try {
      await deleteProject(rec.id);
      setProjects((list) => list.filter((p) => p.id !== rec.id));
      setStatus({ kind: 'ok', text: 'Dashboard deleted.' });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Open a dashboard</h2>

        {signedIn ? (
          projects === null ? (
            <p className="modal-note">Loading your dashboards…</p>
          ) : projects.length === 0 ? (
            <p className="modal-note">
              You haven’t saved a dashboard yet. Build one, then use <strong>Save &amp; share</strong>.
            </p>
          ) : (
            <ul className="project-list">
              {projects.map((p) => (
                <li key={p.id}>
                  <button className="project-open" onClick={() => open(p)} disabled={!!busy}>
                    <span className="project-name">{p.title || 'Untitled dashboard'}</span>
                    <span className="project-meta">
                      {(p.config?.pages?.length || 1)} page{(p.config?.pages?.length || 1) === 1 ? '' : 's'}
                      {' · '}{(p.config?.cards?.length || 0)} cards
                      {' · '}{(p.datasets?.length || 0)} layer{(p.datasets?.length || 0) === 1 ? '' : 's'}
                      {' · '}edited {when(p.updated)}
                    </span>
                  </button>
                  <span className="project-actions">
                    {p.visibility === 'unlisted' && <span className="project-badge">shared</span>}
                    <button title="Delete" onClick={() => remove(p)} disabled={!!busy}>✕</button>
                  </span>
                </li>
              ))}
            </ul>
          )
        ) : (
          <p className="modal-note">
            Sign in to see dashboards you’ve saved. You can still open a project file
            from this computer.
          </p>
        )}

        {error && <div className="modal-error">{error}</div>}

        <div className="open-file">
          <div className="share-label">From this computer</div>
          <p className="modal-note">
            A <code>.geoinsights.json</code> file holds the layout and its data together.
            You can also drop one anywhere on the page.
          </p>
          <button onClick={() => fileRef.current.click()}>Choose a project file…</button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,.geoinsights.json"
            hidden
            onChange={(e) => {
              const files = [...e.target.files];
              e.target.value = '';
              if (files.length) { onFiles(files); onClose(); }
            }}
          />
        </div>

        <button className="modal-close" onClick={onClose} title="Close">✕</button>
      </div>
    </div>
  );
}
