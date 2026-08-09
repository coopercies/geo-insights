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
const initialState = {
  datasets: [],
  cards: [],
  layout: [],
  selection: null, // { sourceCardId, datasetId, ids: number[], label }
  mode: currentMode(),
  activeDatasetId: null,
  status: null,
};

export const useStore = create((set, get) => ({
  ...initialState,

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
    const state = get();
    const ds = state.datasets.find((d) => d.id === (datasetId || state.activeDatasetId));
    const id = nextCardId();
    const card = {
      id,
      type,
      datasetId: ['text', 'title'].includes(type) ? null : (ds ? ds.id : null),
      config: { ...defaultConfig(type, ds), ...config },
    };
    set((s) => ({
      cards: [...s.cards, card],
      layout: [...s.layout, { i: id, ...defaultBox(type), ...nextFreeSlot(s.layout, defaultBox(type))}],
    }));
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

  setLayout(layout) {
    set({ layout });
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
    for (const c of project.cards || []) {
      const n = Number(String(c.id).replace('card', ''));
      if (Number.isFinite(n) && n > cardSeq) cardSeq = n;
    }
    set({
      datasets: project.datasets || [],
      cards: project.cards || [],
      layout: project.layout || [],
      selection: null,
      activeDatasetId: (project.datasets || [])[0]?.id ?? null,
    });
  },

  reset() {
    set({ ...initialState, mode: get().mode });
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
  const cats = ds ? ds.fields.filter((f) => f.type === 'string' && f.categorical) : [];
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
