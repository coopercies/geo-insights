import GridLayout from 'react-grid-layout';
import { useStore } from '../store.js';
import CardShell from './CardShell.jsx';
import { useSize } from './useSize.js';

// react-grid-layout v2 groups its settings into config objects; the v1 flat
// props (rowHeight, margin, draggableHandle…) are silently ignored.
const GRID_CONFIG = { cols: 12, rowHeight: 28, margin: [14, 14] };
const DRAG_CONFIG = { handle: '.card-drag-handle' };
const RESIZE_CONFIG = { handles: ['se'] };
const DRAG_LOCKED = { enabled: false };
const RESIZE_LOCKED = { enabled: false, handles: [] };

export default function Canvas() {
  const cards = useStore((s) => s.cards);
  const layout = useStore((s) => s.layout);
  const setLayout = useStore((s) => s.setLayout);
  const readOnly = useStore((s) => s.readOnly);
  const [ref, size] = useSize();

  return (
    <div className="canvas" ref={ref}>
      {size.width > 0 && (
        <GridLayout
          className="grid"
          layout={layout}
          width={size.width}
          gridConfig={GRID_CONFIG}
          dragConfig={readOnly ? DRAG_LOCKED : DRAG_CONFIG}
          resizeConfig={readOnly ? RESIZE_LOCKED : RESIZE_CONFIG}
          onLayoutChange={setLayout}
        >
          {cards.map((card) => (
            <div key={card.id}>
              <CardShell card={card} />
            </div>
          ))}
        </GridLayout>
      )}
    </div>
  );
}
