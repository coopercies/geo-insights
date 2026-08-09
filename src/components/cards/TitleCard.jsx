import { useEffect, useRef, useState } from 'react';
import { useStore } from '../../store.js';

const SIZES = [
  { id: 'sm', label: 'Small' },
  { id: 'md', label: 'Medium' },
  { id: 'lg', label: 'Large' },
  { id: 'xl', label: 'Display' },
];

const ALIGN = ['left', 'center', 'right'];

/**
 * A heading, separate from the markdown text card. Dashboards need a banner
 * across the top and section headers between rows, and forcing those through
 * markdown means fighting the body-text styling every time.
 */
export default function TitleCard({ card }) {
  const updateCard = useStore((s) => s.updateCard);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(card.config.text ?? '');
  const inputRef = useRef(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const commit = () => {
    setEditing(false);
    updateCard(card.id, { config: { text: draft } });
  };

  const size = card.config.size ?? 'lg';
  const align = card.config.align ?? 'left';
  const subtitle = card.config.subtitle ?? '';

  if (editing) {
    return (
      <div className={`title-card title-${size} align-${align}`}>
        <input
          ref={inputRef}
          className="title-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') { setDraft(card.config.text ?? ''); setEditing(false); }
          }}
          placeholder="Dashboard title"
        />
      </div>
    );
  }

  return (
    <div
      className={`title-card title-${size} align-${align}`}
      onDoubleClick={() => { setDraft(card.config.text ?? ''); setEditing(true); }}
      title="Double-click to edit"
    >
      <div className="title-text">{card.config.text || 'Double-click to add a title'}</div>
      {subtitle && <div className="title-sub">{subtitle}</div>}
    </div>
  );
}

export { SIZES as TITLE_SIZES, ALIGN as TITLE_ALIGN };
