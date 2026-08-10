import { useRef } from 'react';

/**
 * A segmented control: a sliding thumb over a small set of mutually exclusive
 * options. Worth using instead of a dropdown when the choices are few and the
 * alternatives are worth seeing — picking a symbology mode is a decision, not a
 * lookup, and a closed dropdown hides two thirds of it.
 *
 * Keep it to four options with short labels; past that a dropdown wins.
 */
export default function Segmented({ value, options, onChange, name }) {
  const ref = useRef(null);
  const index = Math.max(0, options.findIndex((o) => o.value === value));

  // Arrow keys move between segments, as a radio group should.
  const onKeyDown = (e) => {
    const delta = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1
      : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1
      : 0;
    if (!delta) return;
    e.preventDefault();
    const next = (index + delta + options.length) % options.length;
    onChange(options[next].value);
    const buttons = ref.current?.querySelectorAll('button');
    if (buttons && buttons[next]) buttons[next].focus();
  };

  return (
    <div
      ref={ref}
      className="segmented"
      role="radiogroup"
      aria-label={name}
      onKeyDown={onKeyDown}
      style={{ '--seg-count': options.length, '--seg-index': index }}
    >
      <span className="segmented-thumb" aria-hidden="true" />
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          tabIndex={o.value === value ? 0 : -1}
          className={`segmented-option${o.value === value ? ' on' : ''}`}
          title={o.hint || o.label}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
