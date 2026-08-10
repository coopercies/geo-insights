import { useState } from 'react';
import { saveProject, setVisibility, regenerateShareId } from '../lib/api.js';
import { useStore } from '../store.js';

/**
 * Save-and-share, in one place. Saving is what publishing needs anyway, so
 * splitting them into two actions would only make you do both.
 */
export default function ShareDialog({ project, onClose, onSaved }) {
  const datasets = useStore((s) => s.datasets);
  const cards = useStore((s) => s.cards);
  const layout = useStore((s) => s.layout);
  const pages = useStore((s) => s.pages);
  const setStatus = useStore((s) => s.setStatus);

  const [record, setRecord] = useState(project);
  const [title, setTitle] = useState(project?.title ?? '');
  const [busy, setBusy] = useState(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(null);

  const shared = record?.visibility === 'unlisted';
  const link = record ? `${window.location.origin}/v/${record.shareId}` : null;

  const run = async (label, fn) => {
    setBusy(label);
    setError(null);
    try {
      const next = await fn();
      if (next) setRecord(next);
      if (onSaved) onSaved(next);
      return next;
    } catch (err) {
      setError(err.message || String(err));
      return null;
    } finally {
      setBusy(null);
    }
  };

  const save = () =>
    run('save', async () => {
      const next = await saveProject({ datasets, cards, layout, pages }, {
        id: record?.id ?? null,
        title: title.trim(),
        visibility: record?.visibility ?? 'private',
      });
      setStatus({ kind: 'ok', text: 'Dashboard saved.' });
      return next;
    });

  const publish = () =>
    run('publish', async () => {
      const saved = await saveProject({ datasets, cards, layout, pages }, {
        id: record?.id ?? null,
        title: title.trim(),
        visibility: 'unlisted',
      });
      setStatus({ kind: 'ok', text: 'Dashboard published — anyone with the link can view it.' });
      return saved;
    });

  const unpublish = () =>
    run('unpublish', async () => {
      const next = await setVisibility(record.id, 'private');
      setStatus({ kind: 'ok', text: 'Link disabled. The dashboard is private again.' });
      return next;
    });

  const revoke = () =>
    run('revoke', async () => {
      const next = await regenerateShareId(record.id);
      setStatus({ kind: 'ok', text: 'Old link revoked. The new one is below.' });
      return next;
    });

  const copy = async () => {
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{record ? 'Save & share' : 'Save dashboard'}</h2>

        <label className="modal-field">
          <span>Title</span>
          <input type="text" value={title} placeholder="Untitled dashboard"
                 onChange={(e) => setTitle(e.target.value)} />
        </label>

        <p className="modal-note">
          {datasets.length} layer{datasets.length === 1 ? '' : 's'} ·{' '}
          {cards.length} card{cards.length === 1 ? '' : 's'}. Layers already stored are
          reused, so re-saving only rewrites the layout.
        </p>

        {error && <div className="modal-error">{error}</div>}

        <div className="modal-actions">
          <button onClick={save} disabled={!!busy}>
            {busy === 'save' ? 'Saving…' : 'Save'}
          </button>
          {!shared && (
            <button className="btn-primary" onClick={publish} disabled={!!busy}>
              {busy === 'publish' ? 'Publishing…' : 'Publish & get link'}
            </button>
          )}
        </div>

        {shared && (
          <div className="share-block">
            <div className="share-label">Anyone with this link can view it — no sign-in</div>
            <div className="share-link">
              <input type="text" readOnly value={link} onFocus={(e) => e.target.select()} />
              <button onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
            </div>
            <p className="modal-note">
              A link is a bearer token: whoever holds it has access, and links travel
              through forwarded email and chat history. Revoke replaces it with a new
              one and immediately breaks the old.
            </p>
            <div className="modal-actions">
              <button onClick={revoke} disabled={!!busy}>
                {busy === 'revoke' ? 'Revoking…' : 'Revoke link'}
              </button>
              <button onClick={unpublish} disabled={!!busy}>
                {busy === 'unpublish' ? 'Disabling…' : 'Make private'}
              </button>
            </div>
          </div>
        )}

        <button className="modal-close" onClick={onClose} title="Close">✕</button>
      </div>
    </div>
  );
}
