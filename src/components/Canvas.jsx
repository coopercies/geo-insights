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
  const allCards = useStore((s) => s.cards);
  const allLayout = useStore((s) => s.layout);
  const activePageId = useStore((s) => s.activePageId);
  const setLayout = useStore((s) => s.setLayout);
  const readOnly = useStore((s) => s.readOnly);
  const [ref, size] = useSize();

  // Only the active page is mounted. Keeping hidden pages in the tree would
  // mean every map on every page holding a live WebGL context.
  const cards = allCards.filter((c) => !activePageId || c.pageId === activePageId);
  const visible = new Set(cards.map((c) => c.id));
  const layout = allLayout.filter((l) => visible.has(l.i));

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
