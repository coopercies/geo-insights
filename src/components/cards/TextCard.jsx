import { useState, useRef, useEffect } from 'react';
import { marked } from 'marked';
import { useStore } from '../../store.js';

marked.setOptions({ breaks: true });

export default function TextCard({ card }) {
  const updateCard = useStore((s) => s.updateCard);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(card.config.markdown ?? '');
  const areaRef = useRef(null);

  useEffect(() => {
    if (editing && areaRef.current) {
      areaRef.current.focus();
      areaRef.current.setSelectionRange(draft.length, draft.length);
    }
  }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps

  const commit = () => {
    setEditing(false);
    updateCard(card.id, { config: { markdown: draft } });
  };

  if (editing) {
    return (
      <textarea
        ref={areaRef}
        className="text-card-editor"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { setDraft(card.config.markdown ?? ''); setEditing(false); }
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commit();
        }}
        placeholder="Markdown supported — # headings, **bold**, - lists, [links](url)"
      />
    );
  }

  const html = marked.parse(card.config.markdown || '_Double-click to write._');
  return (
    <div
      className="text-card"
      onDoubleClick={() => { setDraft(card.config.markdown ?? ''); setEditing(true); }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
