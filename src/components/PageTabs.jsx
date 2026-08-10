import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store.js';

/**
 * Page tabs. Shown to viewers too — a published dashboard with three pages is
 * unusable if only the first is reachable — but only editable in the editor.
 */
export default function PageTabs() {
  const pages = useStore((s) => s.pages);
  const activePageId = useStore((s) => s.activePageId);
  const readOnly = useStore((s) => s.readOnly);
  const cards = useStore((s) => s.cards);
  const setActivePage = useStore((s) => s.setActivePage);
  const addPage = useStore((s) => s.addPage);
  const renamePage = useStore((s) => s.renamePage);
  const removePage = useStore((s) => s.removePage);
  const duplicatePage = useStore((s) => s.duplicatePage);
  const movePage = useStore((s) => s.movePage);

  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState('');
  const [menuId, setMenuId] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingId]);

  useEffect(() => {
    if (!menuId) return;
    const close = () => setMenuId(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [menuId]);

  // One page and nothing to switch to isn't a tab bar, it's clutter.
  if (pages.length <= 1 && readOnly) return null;

  const commit = () => {
    const name = draft.trim();
    if (name) renamePage(editingId, name);
    setEditingId(null);
  };

  const countFor = (pageId) => cards.filter((c) => c.pageId === pageId).length;

  return (
    <div className="page-tabs">
      {pages.map((page, i) => {
        const active = page.id === activePageId;
        if (editingId === page.id) {
          return (
            <input
              key={page.id}
              ref={inputRef}
              className="page-tab-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit();
                if (e.key === 'Escape') setEditingId(null);
              }}
            />
          );
        }
        return (
          <div key={page.id} className={`page-tab${active ? ' on' : ''}`}>
            <button
              className="page-tab-label"
              onClick={() => setActivePage(page.id)}
              onDoubleClick={() => {
                if (readOnly) return;
                setDraft(page.name);
                setEditingId(page.id);
              }}
              title={readOnly ? page.name : `${page.name} — double-click to rename`}
            >
              {page.name}
              <span className="page-tab-count">{countFor(page.id)}</span>
            </button>
            {!readOnly && active && (
              <button
                className="page-tab-menu"
                title="Page options"
                onClick={(e) => { e.stopPropagation(); setMenuId(menuId === page.id ? null : page.id); }}
              >
                ⋯
              </button>
            )}
            {menuId === page.id && (
              <div className="page-menu" onClick={(e) => e.stopPropagation()}>
                <button onClick={() => { setDraft(page.name); setEditingId(page.id); setMenuId(null); }}>
                  Rename
                </button>
                <button onClick={() => { duplicatePage(page.id); setMenuId(null); }}>
                  Duplicate page
                </button>
                <button disabled={i === 0} onClick={() => { movePage(page.id, -1); setMenuId(null); }}>
                  Move left
                </button>
                <button disabled={i === pages.length - 1} onClick={() => { movePage(page.id, 1); setMenuId(null); }}>
                  Move right
                </button>
                <button
                  className="danger"
                  disabled={pages.length <= 1}
                  onClick={() => {
                    const n = countFor(page.id);
                    const ok = n === 0 || confirm(`Delete "${page.name}" and its ${n} card${n === 1 ? '' : 's'}?`);
                    if (ok) removePage(page.id);
                    setMenuId(null);
                  }}
                >
                  Delete page
                </button>
              </div>
            )}
          </div>
        );
      })}

      {!readOnly && (
        <button className="page-add" title="Add a page" onClick={() => addPage()}>+</button>
      )}
    </div>
  );
}
