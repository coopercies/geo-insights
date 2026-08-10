import { create } from 'zustand';
import { currentMode } from './lib/palette.js';

let cardSeq = 0;
const nextCardId = () => `card${++cardSeq}`;

/**
 * Selection is the cross-filter spine: exactly one selection is active at a
 * time, owned by the card that made it. Every other card bound to the same
 * dataset reads it and filters itself. This mirrors how Insights behaved —
 * selecting on any card drives all the others.
 */
let pageSeq = 0;
const nextPageId = () => `page${++pageSeq}`;

const initialState = {
  // A published dashboard is rendered by the same components as the editor;
  // this flag is what removes the editing affordances rather than a separate
  // read-only copy of every card.
  readOnly: false,
  datasets: [],
  cards: [],
  layout: [],
  // Pages are how a dashboard separates subjects — "overview" from "health
  // disparities" — without cramming one canvas. Cards belong to exactly one.
  pages: [],
  activePageId: null,
  selection: null, // { sourceCardId, datasetId, ids: number[], label }
  mode: currentMode(),
  activeDatasetId: null,
  status: null,
};

export const useStore = create((set, get) => ({
  ...initialState,

  /** Every card needs a page; create the implicit first one on demand. */
  ensurePage() {
    const state = get();
    if (state.pages.length) return state.activePageId ?? state.pages[0].id;
    const id = nextPageId();
    set({ pages: [{ id, name: 'Page 1' }], activePageId: id });
    return id;
  },

  addPage(name) {
    const id = nextPageId();
    set((s) => ({
      pages: [...s.pages, { id, name: name || `Page ${s.pages.length + 1}` }],
      activePageId: id,
    }));
    return id;
  },

  renamePage(id, name) {
    set((s) => ({ pages: s.pages.map((p) => (p.id === id ? { ...p, name } : p)) }));
  },

  removePage(id) {
    const { pages } = get();
    if (pages.length <= 1) return; // a dashboard always has at least one page
    set((s) => {
      const doomed = s.cards.filter((c) => c.pageId === id).map((c) => c.id);
      const remaining = s.pages.filter((p) => p.id !== id);
      return {
        pages: remaining,
        cards: s.cards.filter((c) => c.pageId !== id),
        layout: s.layout.filter((l) => !doomed.includes(l.i)),
        activePageId: s.activePageId === id ? remaining[0].id : s.activePageId,
        selection: s.selection && doomed.includes(s.selection.sourceCardId) ? null : s.selection,
      };
    });
  },

  duplicatePage(id) {
    const state = get();
    const source = state.pages.find((p) => p.id === id);
    if (!source) return;
    const newPageId = nextPageId();
    const idMap = new Map();
    const cards = state.cards
      .filter((c) => c.pageId === id)
      .map((c) => {
        const copy = { ...c, id: nextCardId(), pageId: newPageId, config: { ...c.config } };
        idMap.set(c.id, copy.id);
        return copy;
      });
    const layout = state.layout
      .filter((l) => idMap.has(l.i))
      .map((l) => ({ ...l, i: idMap.get(l.i) }));
    set((s) => ({
      pages: [...s.pages, { id: newPageId, name: `${source.name} copy` }],
      cards: [...s.cards, ...cards],
      layout: [...s.layout, ...layout],
      activePageId: newPageId,
    }));
  },

  setActivePage(id) {
    set({ activePageId: id });
  },

  movePage(id, delta) {
    set((s) => {
      const i = s.pages.findIndex((p) => p.id === id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= s.pages.length) return {};
      const pages = [...s.pages];
      [pages[i], pages[j]] = [pages[j], pages[i]];
      return { pages };
    });
  },

  setReadOnly(readOnly) {
    set({ readOnly });
  },

  setMode(mode) {
    document.documentElement.dataset.theme = mode;
    set({ mode });
  },

  setStatus(status) {
    set({ status });
    if (status && status.kind !== 'error') {
      setTimeout(() => {
        if (get().status === status) set({ status: null });
      }, 4000);
    }
  },

  addDataset(ds) {
    set((s) => ({
      datasets: [...s.datasets, ds],
      activeDatasetId: ds.id,
    }));
    // A first dataset with geometry deserves a map immediately — that is the
    // whole point of the app, and an empty canvas is a bad first impression.
    const { cards } = get();
    if (!cards.length) {
      if (ds.geojson) get().addCard('map', ds.id);
      get().addCard('stat', ds.id);
    }
    return ds.id;
  },

  removeDataset(id) {
    set((s) => {
      const cards = s.cards.filter((c) => c.datasetId !== id);
      return {
        datasets: s.datasets.filter((d) => d.id !== id),
        cards,
        layout: s.layout.filter((l) => cards.some((c) => c.id === l.i)),
        selection: s.selection && s.selection.datasetId === id ? null : s.selection,
        activeDatasetId: s.activeDatasetId === id ? null : s.activeDatasetId,
      };
    });
  },

  addCard(type, datasetId, config = {}) {
    const pageId = get().ensurePage();
    const state = get();
    const ds = state.datasets.find((d) => d.id === (datasetId || state.activeDatasetId));
    const id = nextCardId();
    const card = {
      id,
      pageId,
      type,
      datasetId: ['text', 'title'].includes(type) ? null : (ds ? ds.id : null),
      config: { ...defaultConfig(type, ds), ...config },
    };
    set((s) => {
      // Placement must only see the page being edited; measuring against every
      // page's layout pushes cards into empty space that isn't theirs.
      const onPage = new Set(s.cards.filter((c) => c.pageId === pageId).map((c) => c.id));
      const pageLayout = s.layout.filter((l) => onPage.has(l.i));
      return {
        cards: [...s.cards, card],
        layout: [...s.layout, { i: id, ...defaultBox(type), ...nextFreeSlot(pageLayout, defaultBox(type)) }],
      };
    });
    return id;
  },

  updateCard(id, patch) {
    set((s) => ({
      cards: s.cards.map((c) =>
        c.id === id ? { ...c, ...patch, config: { ...c.config, ...(patch.config || {}) } } : c
      ),
    }));
  },

  removeCard(id) {
    set((s) => ({
      cards: s.cards.filter((c) => c.id !== id),
      layout: s.layout.filter((l) => l.i !== id),
      selection: s.selection && s.selection.sourceCardId === id ? null : s.selection,
    }));
  },

  duplicateCard(id) {
    const card = get().cards.find((c) => c.id === id);
    if (!card) return;
    get().addCard(card.type, card.datasetId, { ...card.config });
  },

  /**
   * The grid only ever reports the page on screen, so merge its entries into
   * the full layout instead of replacing it — otherwise switching pages would
   * wipe the layout of every page you're not looking at.
   */
  setLayout(pageLayout) {
    set((s) => {
      const seen = new Set(pageLayout.map((l) => l.i));
      return { layout: [...s.layout.filter((l) => !seen.has(l.i)), ...pageLayout] };
    });
  },

  /** ids === null clears; an empty array is a real (empty) selection. */
  select(sourceCardId, datasetId, ids, label) {
    if (ids === null) return set({ selection: null });
    set({ selection: { sourceCardId, datasetId, ids, label: label || `${ids.length} selected` } });
  },

  clearSelection() {
    set({ selection: null });
  },

  loadProject(project) {
    cardSeq = 0;
    pageSeq = 0;
    for (const c of project.cards || []) {
      const n = Number(String(c.id).replace('card', ''));
      if (Number.isFinite(n) && n > cardSeq) cardSeq = n;
    }
    for (const p of project.pages || []) {
      const n = Number(String(p.id).replace('page', ''));
      if (Number.isFinite(n) && n > pageSeq) pageSeq = n;
    }

    // Dashboards saved before pages existed have neither pages nor pageIds;
    // fold them onto a single page rather than refusing to open.
    let pages = project.pages || [];
    let cards = project.cards || [];
    if (!pages.length) {
      const id = `page${++pageSeq}`;
      pages = [{ id, name: 'Page 1' }];
      cards = cards.map((c) => ({ ...c, pageId: c.pageId ?? id }));
    } else {
      const fallback = pages[0].id;
      cards = cards.map((c) => ({ ...c, pageId: c.pageId ?? fallback }));
    }

    set({
      datasets: project.datasets || [],
      cards,
      layout: project.layout || [],
      pages,
      activePageId: pages[0].id,
      selection: null,
      activeDatasetId: (project.datasets || [])[0]?.id ?? null,
    });
  },

  reset() {
    set({ ...initialState, mode: get().mode, readOnly: get().readOnly });
  },
}));

/** Rows for a card, with the active cross-filter applied. */
export function useFilteredRows(card) {
  const datasets = useStore((s) => s.datasets);
  const selection = useStore((s) => s.selection);
  const ds = datasets.find((d) => d.id === card.datasetId);
  if (!ds) return { dataset: null, rows: [], allRows: [], filtered: false };

  const applies = selection && selection.datasetId === ds.id && selection.sourceCardId !== card.id;
  if (!applies) return { dataset: ds, rows: ds.rows, allRows: ds.rows, filtered: false };

  const keep = new Set(selection.ids);
  return {
    dataset: ds,
    rows: ds.rows.filter((r) => keep.has(r.__i)),
    allRows: ds.rows,
    filtered: true,
  };
}

function defaultConfig(type, ds) {
  const numeric = ds ? ds.fields.filter((f) => f.type === 'number' && !f.isKey) : [];
  // Every text column is groupable, but one value per row makes a meaningless
  // chart — an h3 index or a name field yields 20 bars of 1 and a huge "Other".
  // Fewest distinct values first, and nothing near-unique as a default.
  const rows = ds ? ds.rows.length : 0;
  const cats = ds
    ? ds.fields
        .filter((f) => f.type === 'string' && !f.isKey)
        // distinctCapped means the count stopped at the cap, so the column has
        // at least a thousand values — never a sensible default grouping.
        .filter((f) => !f.distinctCapped)
        .filter((f) => !rows || (f.distinct ?? 0) <= Math.max(24, rows * 0.5))
        .sort((a, b) => (a.distinct ?? 0) - (b.distinct ?? 0))
    : [];
  switch (type) {
    case 'map':
      return {
        colorMode: numeric[0] ? 'graduated' : 'single',
        colorField: numeric[0]?.name ?? null,
        classes: 5,
        method: 'quantile',
        ramp: 'blue',
        reverseRamp: false,
        sizeField: null,
        basemap: 'auto',
        opacity: 0.85,
      };
    case 'chart':
      return {
        chartType: cats.length ? 'bar' : 'histogram',
        groupField: cats[0]?.name ?? null,
        measureField: numeric[0]?.name ?? null,
        xField: numeric[0]?.name ?? null,
        yField: numeric[1]?.name ?? numeric[0]?.name ?? null,
        stat: 'count',
        orientation: 'horizontal',
        seriesField: cats[1]?.name ?? cats[0]?.name ?? null,
      };
    case 'stat':
      return { stat: 'count', field: numeric[0]?.name ?? null, label: '' };
    case 'text':
      return { markdown: '## Notes\n\nDouble-click to edit.' };
    case 'title':
      return { text: '', subtitle: '', size: 'lg', align: 'left' };
    case 'table':
      return { columns: null };
    default:
      return {};
  }
}

function defaultBox(type) {
  switch (type) {
    case 'map': return { w: 6, h: 12, minW: 3, minH: 6 };
    case 'chart': return { w: 6, h: 9, minW: 3, minH: 5 };
    case 'stat': return { w: 3, h: 4, minW: 2, minH: 3 };
    case 'text': return { w: 4, h: 5, minW: 2, minH: 2 };
    case 'title': return { w: 12, h: 3, minW: 2, minH: 2 };
    case 'table': return { w: 6, h: 9, minW: 3, minH: 4 };
    default: return { w: 4, h: 6, minW: 2, minH: 2 };
  }
}

const COLS = 12;

/** Place a new card in the first gap wide enough, else below everything. */
function nextFreeSlot(layout, box) {
  if (!layout.length) return { x: 0, y: 0 };
  const rowEnd = new Map();
  for (const l of layout) {
    for (let x = l.x; x < l.x + l.w; x++) {
      rowEnd.set(x, Math.max(rowEnd.get(x) ?? 0, l.y + l.h));
    }
  }
  let best = null;
  for (let x = 0; x + box.w <= COLS; x++) {
    let y = 0;
    for (let c = x; c < x + box.w; c++) y = Math.max(y, rowEnd.get(c) ?? 0);
    if (best === null || y < best.y) best = { x, y };
  }
  return best ?? { x: 0, y: Infinity };
}
