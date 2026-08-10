import { useEffect, useRef, useState, useMemo } from 'react';
import { Map as MapLibreMap, NavigationControl } from 'maplibre-gl';
import { useStore } from '../../store.js';
import { SEQUENTIAL, rampSteps, rampFor, seriesColor, INK } from '../../lib/palette.js';
import { classBreaks, categoryClasses } from '../../lib/classify.js';
import { numericValues, formatValue } from '../../lib/stats.js';
import { toNumber } from '../../lib/fields.js';
import { resolveBasemap, basemapKey, isImagery } from '../../lib/basemaps.js';
import ReprojectDialog from '../ReprojectDialog.jsx';

const SRC = 'data';
const CLASS_COUNT_DEFAULT = 5;
const STYLE_TIMEOUT_MS = 20000;

/**
 * Ask the network what actually happened, rather than guessing in the message.
 * A blocked request and a slow one look identical from inside MapLibre, but a
 * direct fetch tells them apart: extensions and blockers reject at the network
 * layer, which surfaces as a TypeError rather than an HTTP status.
 */
async function diagnoseBasemap(basemap, mode) {
  const style = resolveBasemap(basemap, mode);
  const url = typeof style === 'string'
    ? style
    : (style.sources && style.sources.base && style.sources.base.tiles || [])[0];

  if (!url) return 'The basemap style could not be resolved.';

  const probe = url.replace('{z}', '3').replace('{x}', '2').replace('{y}', '3');
  try {
    const res = await fetch(probe, { mode: 'cors', cache: 'no-store' });
    if (res.ok) {
      return `The tile host answered (HTTP ${res.status}), but the map never finished ` +
        `drawing. This is usually WebGL being blocked or throttled — try reloading, ` +
        `or check that hardware acceleration is enabled.`;
    }
    return `The tile host returned HTTP ${res.status} for ${hostOf(probe)}. ` +
      `The service may be down or rate-limiting.`;
  } catch {
    return `The request to ${hostOf(probe)} was refused before it reached the network. ` +
      `That is almost always a content blocker, privacy extension, or VPN — ` +
      `allow that host, or carry on without a basemap.`;
  }
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return 'the tile host';
  }
}

/** WebGL is required. Without it MapLibre throws and the card would sit blank. */
function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

/** Rebuild source data carrying only the id and the styling value — keeps the
 *  GL source small even when the table has 200 columns. */
const NO_DATA = '#b8b6ae';

/**
 * Source data carries only what the paint expressions read: the row id, the
 * numeric value being classed (`__v`), the category slot (`__c`), and the
 * numeric value driving symbol size (`__s`). Keeps the GL source small even
 * when the table has 200 columns.
 */
function styledGeoJSON(dataset, { colorMode, colorField, sizeField, categoryIndex }) {
  const byId = new Map(dataset.rows.map((r) => [r.__i, r]));
  return {
    type: 'FeatureCollection',
    features: dataset.geojson.features.map((f) => {
      const row = byId.get(f.properties.__i);
      const props = { __i: f.properties.__i };

      if (row && colorMode === 'graduated' && colorField) {
        const v = toNumber(row[colorField]);
        if (v !== null) props.__v = v;
      }
      if (row && colorMode === 'categorical' && colorField) {
        const raw = row[colorField];
        const key = raw === null || raw === undefined || raw === '' ? '(no value)' : String(raw);
        // Anything outside the palette ceiling lands in the "Other" slot.
        props.__c = categoryIndex.has(key) ? categoryIndex.get(key) : categoryIndex.get('__other__') ?? -1;
      }
      if (row && sizeField) {
        const s = toNumber(row[sizeField]);
        if (s !== null) props.__s = s;
      }
      return { type: 'Feature', id: f.id, geometry: f.geometry, properties: props };
    }),
  };
}

function graduatedExpression(breaks, colors) {
  if (!breaks.length) return colors[Math.floor(colors.length / 2)];
  const expr = ['step', ['get', '__v'], colors[0]];
  breaks.forEach((b, i) => expr.push(b, colors[i + 1]));
  // Features with no value would otherwise fall into the first class and read
  // as a real low value; paint them neutral instead.
  return ['case', ['==', ['get', '__v'], null], NO_DATA, expr];
}

function categoricalExpression(classList, mode) {
  const expr = ['match', ['get', '__c']];
  classList.forEach((c, i) => expr.push(i, seriesColor(i, mode)));
  expr.push(NO_DATA);
  return expr;
}

/** Symbol radius interpolated from a measure — area-proportional, not radius. */
function sizeExpression(min, max) {
  if (min === max) return ['interpolate', ['linear'], ['zoom'], 3, 2.5, 10, 6, 16, 11];
  return [
    'interpolate', ['linear'], ['zoom'],
    3, ['interpolate', ['linear'], ['sqrt', ['max', ['coalesce', ['get', '__s'], min], 0]], Math.sqrt(Math.max(min, 0)), 1.5, Math.sqrt(Math.max(max, 0)), 7],
    10, ['interpolate', ['linear'], ['sqrt', ['max', ['coalesce', ['get', '__s'], min], 0]], Math.sqrt(Math.max(min, 0)), 3, Math.sqrt(Math.max(max, 0)), 18],
    16, ['interpolate', ['linear'], ['sqrt', ['max', ['coalesce', ['get', '__s'], min], 0]], Math.sqrt(Math.max(min, 0)), 5, Math.sqrt(Math.max(max, 0)), 34],
  ];
}

export default function MapCard({ card }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const boxRef = useRef(null);
  const dragRef = useRef(null);
  // `ready` means the style is parsed and layers can be added — deliberately
  // NOT the map's `load` event, which also waits on basemap tiles. Gating data
  // layers on tiles means a blocked basemap host costs you your own data too.
  const [ready, setReady] = useState(false);
  const [tilesOk, setTilesOk] = useState(false);
  // Bumped whenever a style swap has wiped our layers, so the layer effect
  // re-runs and rebuilds them.
  const [styleEpoch, setStyleEpoch] = useState(0);
  const [hover, setHover] = useState(null);
  const [trouble, setTrouble] = useState(null);
  const [slowTiles, setSlowTiles] = useState(false);
  const [reprojecting, setReprojecting] = useState(false);

  const datasets = useStore((s) => s.datasets);
  const selection = useStore((s) => s.selection);
  const mode = useStore((s) => s.mode);
  const select = useStore((s) => s.select);
  const updateCard = useStore((s) => s.updateCard);

  const dataset = datasets.find((d) => d.id === card.datasetId);
  const colorField = card.config.colorField;
  const colorMode = card.config.colorMode ?? (colorField ? 'graduated' : 'single');
  const classes = card.config.classes ?? CLASS_COUNT_DEFAULT;
  const method = card.config.method ?? 'quantile';
  const rampId = card.config.ramp ?? 'blue';
  const reverse = !!card.config.reverseRamp;
  const singleColor = card.config.singleColor ?? seriesColor(0, mode);
  const sizeField = card.config.sizeField ?? null;

  // Graduated classing.
  const { breaks, colors } = useMemo(() => {
    if (!dataset || colorMode !== 'graduated' || !colorField) {
      return { breaks: [], colors: rampFor(rampId, classes, mode, reverse) };
    }
    const vals = numericValues(dataset.rows, colorField);
    const b = classBreaks(vals, classes, method);
    return { breaks: b, colors: rampFor(rampId, b.length + 1, mode, reverse) };
  }, [dataset, colorMode, colorField, classes, method, rampId, mode, reverse]);

  // Categorical classing.
  const categories = useMemo(() => {
    if (!dataset || colorMode !== 'categorical' || !colorField) return [];
    return categoryClasses(dataset.rows, colorField, 8);
  }, [dataset, colorMode, colorField]);

  const categoryIndex = useMemo(() => {
    const m = new Map();
    categories.forEach((c, i) => {
      m.set(c.key, i);
      if (c.isOther) m.set('__other__', i);
    });
    return m;
  }, [categories]);

  // Symbol-size range.
  const sizeRange = useMemo(() => {
    if (!dataset || !sizeField) return null;
    const vals = numericValues(dataset.rows, sizeField);
    return vals.length ? [Math.min(...vals), Math.max(...vals)] : null;
  }, [dataset, sizeField]);

  const basemap = card.config.basemap ?? 'auto';
  const styleKey = basemapKey(basemap, mode);
  const appliedStyleRef = useRef(null);

  // --- map lifecycle -------------------------------------------------------
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    if (!webglAvailable()) {
      setTrouble({
        title: 'WebGL is unavailable',
        detail:
          'MapLibre renders with WebGL. It may be disabled in your browser settings, ' +
          'or blocked by hardware acceleration being turned off.',
      });
      return;
    }

    // StrictMode mounts, unmounts, and remounts every effect in development.
    // Constructing a map only to remove() it milliseconds later tears down
    // MapLibre's shared worker pool, and the replacement map can come up with
    // no render loop at all — a black canvas that never requests a tile and
    // never reports an error. Deferring construction by a tick means the
    // throwaway mount is cancelled before any map exists, so exactly one is
    // ever built.
    let map = null;
    let cancelled = false;

    const timer = setTimeout(() => {
      if (cancelled || !containerRef.current) return;

      try {
        map = new MapLibreMap({
          container: containerRef.current,
          style: resolveBasemap(basemap, mode),
          center: [-98, 39],
          zoom: 3,
          attributionControl: { compact: true },
        });
      } catch (err) {
        setTrouble({ title: 'The map could not start', detail: err.message });
        return;
      }

      appliedStyleRef.current = styleKey;
      map.addControl(new NavigationControl({ showCompass: false }), 'top-right');

      // styledata fires whenever style data changes — including several times
      // during a setStyle, while the old style is still being torn down. So
      // rather than trusting one event to mean "the new style is ready", treat
      // a missing source as the signal that our layers need rebuilding. That
      // converges no matter how many intermediate events arrive, and it fixes
      // the theme/basemap switch silently dropping the data layer.
      map.on('styledata', () => {
        const style = map.getStyle();
        if (!style || !style.layers) return;
        setReady(true);
        setTrouble(null);
        if (!map.getSource(SRC)) setStyleEpoch((v) => v + 1);
      });
      map.on('load', () => setTilesOk(true));

      // Browsers cap how many WebGL contexts a page may hold (~16 in Chrome)
      // and silently kill the oldest when that is exceeded. The card keeps its
      // header and legend and simply stops drawing — a blank rectangle with no
      // explanation, which is the one failure mode this app should never ship
      // again. preventDefault lets the browser restore the context if it can.
      const canvas = map.getCanvas();
      canvas.addEventListener('webglcontextlost', (e) => {
        e.preventDefault();
        setReady(false);
        setTrouble({
          title: 'This map was suspended',
          detail:
            'Browsers limit how many maps can render at once, and this one was ' +
            'dropped to make room. Close a map card, or move some onto another ' +
            'page — only the page you are viewing holds a live map.',
        });
      });
      canvas.addEventListener('webglcontextrestored', () => {
        setTrouble(null);
        setStyleEpoch((v) => v + 1);
        setReady(true);
      });

      // A tile hiccup on a working map is noise; a failure before anything
      // renders is worth surfacing. The render decides — it only shows this
      // while the style is still missing.
      map.on('error', (e) => {
        const msg = e && e.error ? e.error.message : String(e);
        console.error('[map]', msg);
        setTrouble({ title: 'The basemap failed to load', detail: msg });
      });

      mapRef.current = map;
      if (import.meta.env.DEV) {
        // Dev-only handles so a stress test can drive every map at once.
        window.__map = map;
        (window.__maps ||= []).push(map);
      }
    }, 0);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (map) {
        if (import.meta.env.DEV && window.__maps) {
          window.__maps = window.__maps.filter((m) => m !== map);
        }
        map.remove();
      }
      mapRef.current = null;
      appliedStyleRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // A style that never arrives leaves a blank card with no explanation. Probe
  // the host directly so the message names the real cause instead of guessing.
  useEffect(() => {
    if (ready || trouble || basemap === 'none') return;
    const t = setTimeout(async () => {
      const map = mapRef.current;

      // Ask the map before accusing it. A timer alone reports a slow load as a
      // failure, and this warning claimed WebGL was blocked on maps that were
      // merely still parsing — the accusation was the bug, not the map.
      if (map) {
        const style = map.getStyle();
        if (style && style.layers && style.layers.length) {
          setReady(true);
          return;
        }
      }

      if (!map) {
        setTrouble({
          title: 'The map could not start',
          detail: 'The map never initialised on this card. Reloading usually clears it.',
          offerNoBasemap: true,
        });
        return;
      }

      setTrouble({
        title: 'The basemap did not load',
        detail: await diagnoseBasemap(basemap, mode),
        offerNoBasemap: true,
      });
    }, STYLE_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [ready, trouble, basemap, mode]);

  // Style parsed but tiles never arrived: the data is drawn and usable, so this
  // is a footnote rather than an overlay. Delayed so it can't flash on a normal load.
  useEffect(() => {
    if (!ready || tilesOk || basemap === 'none') {
      setSlowTiles(false);
      return;
    }
    const t = setTimeout(() => setSlowTiles(true), STYLE_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [ready, tilesOk, basemap]);

  // Swapping the style wipes every custom layer, so drop `ready` and let the
  // data effect rebuild them once the new style settles.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (appliedStyleRef.current === styleKey) return;
    appliedStyleRef.current = styleKey;
    setReady(false);
    setTilesOk(false);
    setTrouble(null);
    // The persistent styledata listener flips `ready` back on once it parses.
    map.setStyle(resolveBasemap(basemap, mode));
  }, [styleKey, ready, basemap, mode]);

  // --- data + layers -------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !dataset || !dataset.geojson) return;

    const data = styledGeoJSON(dataset, { colorMode, colorField, sizeField, categoryIndex });
    const kind = dataset.geometryType;
    const ink = INK[mode];
    // Theme ink disappears against imagery; force a light stroke there instead.
    const stroke = isImagery(basemap)
      ? { hairline: 'rgba(255,255,255,0.45)', strong: '#ffffff', ring: 'rgba(0,0,0,0.55)' }
      : { hairline: ink.border, strong: ink.primary, ring: ink.surface };

    if (map.getSource(SRC)) {
      map.getSource(SRC).setData(data);
    } else {
      map.addSource(SRC, { type: 'geojson', data, promoteId: '__i' });
    }

    const fill =
      colorMode === 'categorical' && categories.length ? categoricalExpression(categories, mode)
      : colorMode === 'graduated' && colorField ? graduatedExpression(breaks, colors)
      : singleColor;
    const opacity = card.config.opacity ?? 0.85;
    const radius = sizeField && sizeRange
      ? sizeExpression(sizeRange[0], sizeRange[1])
      : ['interpolate', ['linear'], ['zoom'], 3, 2.5, 10, 6, 16, 11];

    const ensure = (spec) => {
      if (!map.getLayer(spec.id)) map.addLayer(spec);
    };

    if (kind === 'polygon') {
      ensure({ id: 'lyr-fill', type: 'fill', source: SRC, paint: {} });
      map.setPaintProperty('lyr-fill', 'fill-color', fill);
      map.setPaintProperty('lyr-fill', 'fill-opacity', opacity);
      ensure({ id: 'lyr-line', type: 'line', source: SRC, paint: {} });
      map.setPaintProperty('lyr-line', 'line-color', stroke.hairline);
      map.setPaintProperty('lyr-line', 'line-width', 0.5);
      ensure({ id: 'lyr-hi', type: 'line', source: SRC, paint: {} });
      map.setPaintProperty('lyr-hi', 'line-color', stroke.strong);
      map.setPaintProperty('lyr-hi', 'line-width', 0);
    } else if (kind === 'line') {
      ensure({ id: 'lyr-line', type: 'line', source: SRC, paint: {} });
      map.setPaintProperty('lyr-line', 'line-color', fill);
      map.setPaintProperty('lyr-line', 'line-width', 2);
      map.setPaintProperty('lyr-line', 'line-opacity', opacity);
      ensure({ id: 'lyr-hi', type: 'line', source: SRC, paint: {} });
      map.setPaintProperty('lyr-hi', 'line-color', stroke.strong);
      map.setPaintProperty('lyr-hi', 'line-width', 0);
    } else {
      ensure({ id: 'lyr-circle', type: 'circle', source: SRC, paint: {} });
      map.setPaintProperty('lyr-circle', 'circle-color', fill);
      map.setPaintProperty('lyr-circle', 'circle-opacity', opacity);
      map.setPaintProperty('lyr-circle', 'circle-radius', radius);
      map.setPaintProperty('lyr-circle', 'circle-stroke-width', 1);
      map.setPaintProperty('lyr-circle', 'circle-stroke-color', stroke.ring);
      // A ring layer above the fills; its width is driven by selection state,
      // so it is invisible until it has something to mark.
      ensure({ id: 'lyr-hi', type: 'circle', source: SRC, paint: {} });
      map.setPaintProperty('lyr-hi', 'circle-radius', radius);
      map.setPaintProperty('lyr-hi', 'circle-color', 'rgba(0,0,0,0)');
      map.setPaintProperty('lyr-hi', 'circle-stroke-width', 0);
      map.setPaintProperty('lyr-hi', 'circle-stroke-color', stroke.strong);
    }
  }, [ready, styleEpoch, dataset, colorMode, colorField, breaks, colors, categories, categoryIndex,
      singleColor, sizeField, sizeRange, mode, basemap, card.config.opacity]);

  // Fit to data the first time a layer lands.
  const fittedRef = useRef(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !dataset || !dataset.bbox) return;
    if (fittedRef.current === dataset.id) return;
    const [minX, minY, maxX, maxY] = dataset.bbox;
    // Defence in depth: an out-of-range extent makes fitBounds throw, and that
    // exception used to escape as a raw MapLibre message on a dead card.
    if (![minX, minY, maxX, maxY].every(Number.isFinite) ||
        Math.abs(minY) > 90 || Math.abs(maxY) > 90 ||
        Math.abs(minX) > 180 || Math.abs(maxX) > 180) {
      return;
    }
    fittedRef.current = dataset.id;
    map.fitBounds([[minX, minY], [maxX, maxY]], { padding: 32, duration: 0, maxZoom: 14 });
  }, [ready, dataset]);

  // --- cross-filter response ----------------------------------------------
  //
  // Selection is an *emphasis* treatment, not a decoration. The earlier version
  // ringed every selected feature in white, which at a few thousand points
  // merged into a solid white mass that hid the categories underneath — the
  // selection obscured exactly what it was meant to reveal.
  //
  // Now the selected keep their full colour and the unselected fade back to
  // faint context. Selection state lives in feature-state rather than a filter
  // expression carrying thousands of ids, which also stops the paint expression
  // growing with the size of the selection.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !dataset || !map.getSource(SRC)) return;

    const applies = selection && selection.datasetId === dataset.id;
    const ids = applies ? selection.ids : [];

    map.removeFeatureState({ source: SRC });
    for (const id of ids) map.setFeatureState({ source: SRC, id }, { sel: true });

    const isSel = ['boolean', ['feature-state', 'sel'], false];
    const base = card.config.opacity ?? 0.85;
    const ink = INK[mode];
    const imagery = isImagery(basemap);

    // A ring helps you find a handful of features. Past that it is noise, and
    // the rings merge into each other rather than marking anything.
    const ringed = applies && ids.length > 0 && ids.length <= 150;

    if (map.getLayer('lyr-fill')) {
      map.setPaintProperty('lyr-fill', 'fill-opacity',
        applies ? ['case', isSel, base, 0.07] : base);
    }
    if (map.getLayer('lyr-circle')) {
      map.setPaintProperty('lyr-circle', 'circle-opacity',
        applies ? ['case', isSel, 1, 0.09] : base);
      // A hairline in the surface colour separates overlapping selected dots
      // without the halo swallowing them.
      map.setPaintProperty('lyr-circle', 'circle-stroke-width',
        applies ? ['case', isSel, 1.1, 0] : 1);
      map.setPaintProperty('lyr-circle', 'circle-stroke-color',
        imagery ? 'rgba(0,0,0,0.55)' : ink.surface);
    }
    if (map.getLayer('lyr-line') && dataset.geometryType === 'line') {
      map.setPaintProperty('lyr-line', 'line-opacity',
        applies ? ['case', isSel, 1, 0.12] : base);
    } else if (map.getLayer('lyr-line')) {
      // Polygon hairlines: mute them for unselected so the fills carry it.
      map.setPaintProperty('lyr-line', 'line-opacity', applies ? ['case', isSel, 1, 0.15] : 1);
    }

    // The emphasis outline. Kept thin and tinted rather than a thick white
    // halo, and only drawn for selections small enough for it to mean something.
    if (map.getLayer('lyr-hi')) {
      const accent = imagery ? '#ffffff' : ink.primary;
      if (dataset.geometryType === 'point') {
        map.setPaintProperty('lyr-hi', 'circle-stroke-width',
          ringed ? ['case', isSel, 1.6, 0] : 0);
        map.setPaintProperty('lyr-hi', 'circle-stroke-color', accent);
        map.setPaintProperty('lyr-hi', 'circle-opacity', 0);
      } else {
        map.setPaintProperty('lyr-hi', 'line-width', applies ? ['case', isSel, 1.6, 0] : 0);
        map.setPaintProperty('lyr-hi', 'line-color', accent);
      }
    }
  }, [ready, styleEpoch, selection, dataset, card.id, card.config.opacity, mode, basemap]);

  // --- interaction ---------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !dataset) return;
    const layerIds = ['lyr-fill', 'lyr-line', 'lyr-circle'].filter((l) => map.getLayer(l));
    if (!layerIds.length) return;

    const byId = new Map(dataset.rows.map((r) => [r.__i, r]));

    const onClick = (e) => {
      const hits = map.queryRenderedFeatures(e.point, { layers: layerIds });
      if (!hits.length) return select(card.id, dataset.id, null);
      const id = hits[0].properties.__i;
      select(card.id, dataset.id, [id], '1 feature');
    };

    const onMove = (e) => {
      const hits = map.queryRenderedFeatures(e.point, { layers: layerIds });
      map.getCanvas().style.cursor = hits.length ? 'pointer' : '';
      if (!hits.length) return setHover(null);
      const row = byId.get(hits[0].properties.__i);
      if (!row) return setHover(null);
      setHover({ x: e.point.x, y: e.point.y, row });
    };

    const onLeave = () => setHover(null);

    map.on('click', onClick);
    map.on('mousemove', onMove);
    map.on('mouseout', onLeave);
    return () => {
      map.off('click', onClick);
      map.off('mousemove', onMove);
      map.off('mouseout', onLeave);
    };
  }, [ready, dataset, card.id, select]);

  // Shift-drag box select.
  useEffect(() => {
    const map = mapRef.current;
    const container = containerRef.current;
    if (!map || !ready || !dataset || !container) return;

    const canvas = map.getCanvas();

    const onDown = (e) => {
      if (!e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      map.dragPan.disable();
      const rect = container.getBoundingClientRect();
      dragRef.current = { x0: e.clientX - rect.left, y0: e.clientY - rect.top, rect };
    };

    const onMove = (e) => {
      const d = dragRef.current;
      if (!d) return;
      const x1 = e.clientX - d.rect.left;
      const y1 = e.clientY - d.rect.top;
      const box = boxRef.current;
      if (!box) return;
      box.style.display = 'block';
      box.style.left = `${Math.min(d.x0, x1)}px`;
      box.style.top = `${Math.min(d.y0, y1)}px`;
      box.style.width = `${Math.abs(x1 - d.x0)}px`;
      box.style.height = `${Math.abs(y1 - d.y0)}px`;
    };

    const onUp = (e) => {
      const d = dragRef.current;
      if (!d) return;
      dragRef.current = null;
      map.dragPan.enable();
      if (boxRef.current) boxRef.current.style.display = 'none';

      const x1 = e.clientX - d.rect.left;
      const y1 = e.clientY - d.rect.top;
      if (Math.abs(x1 - d.x0) < 4 && Math.abs(y1 - d.y0) < 4) return;

      const layerIds = ['lyr-fill', 'lyr-line', 'lyr-circle'].filter((l) => map.getLayer(l));
      const hits = map.queryRenderedFeatures(
        [[Math.min(d.x0, x1), Math.min(d.y0, y1)], [Math.max(d.x0, x1), Math.max(d.y0, y1)]],
        { layers: layerIds }
      );
      const ids = [...new Set(hits.map((h) => h.properties.__i))];
      select(card.id, dataset.id, ids, `${ids.length.toLocaleString()} selected on map`);
    };

    canvas.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      canvas.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [ready, dataset, card.id, select]);

  // Grid resizes change the container without a window event.
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(() => mapRef.current && mapRef.current.resize());
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  if (!dataset) return <div className="card-empty">No dataset bound to this map.</div>;

  // Caught here rather than letting MapLibre throw "Invalid LngLat latitude
  // value" from inside fitBounds, which says nothing about the actual problem.
  if (dataset.projected) {
    return (
      <div className="card-empty">
        <strong>{dataset.name} isn’t in latitude/longitude</strong>
        <span>
          Its coordinates look like {dataset.projected.units} — around{' '}
          {dataset.projected.sample[0].toLocaleString()},{' '}
          {dataset.projected.sample[1].toLocaleString()} rather than degrees. GeoJSON is
          meant to be WGS84 (EPSG:4326), and this file declares no CRS, so nothing
          converted it.
        </span>
        <span>
          Its attributes already work in charts, tables and statistics.
        </span>
        <button className="btn-primary" onClick={() => setReprojecting(true)}>
          Reproject to lat/long…
        </button>
        {reprojecting && (
          <ReprojectDialog dataset={dataset} onClose={() => setReprojecting(false)} />
        )}
      </div>
    );
  }

  if (!dataset.geojson) {
    return (
      <div className="card-empty">
        <strong>{dataset.name}</strong> has no geometry.
        <span>Add latitude/longitude columns, or drop a GeoJSON instead.</span>
      </div>
    );
  }

  return (
    <div className="map-wrap">
      <div ref={containerRef} className="map-canvas" />
      <div ref={boxRef} className="map-selectbox" />
      {colorMode === 'graduated' && colorField && breaks.length > 0 && (
        <GraduatedLegend field={colorField} breaks={breaks} colors={colors} />
      )}
      {colorMode === 'categorical' && colorField && categories.length > 0 && (
        <CategoryLegend field={colorField} categories={categories} mode={mode} />
      )}
      {sizeField && sizeRange && dataset.geometryType === 'point' && (
        <SizeLegend field={sizeField} range={sizeRange}
                    color={colorMode === 'single' ? singleColor : seriesColor(0, mode)} />
      )}
      {!slowTiles && (
        <div className="map-hint">Shift-drag to select · click a feature · click empty space to clear</div>
      )}
      {hover && <HoverCard hover={hover} colorField={colorField} />}
      {!ready && trouble && (
        <div className="map-trouble">
          <div className="map-trouble-title">{trouble.title}</div>
          <p>{trouble.detail}</p>
          {trouble.offerNoBasemap && (
            <button className="btn-primary" onClick={() => updateCard(card.id, { config: { basemap: 'none' } })}>
              Continue without a basemap
            </button>
          )}
        </div>
      )}
      {!ready && !trouble && <div className="map-loading">Loading basemap…</div>}
      {slowTiles && (
        <div className="map-notice">Basemap tiles unavailable — showing your data only</div>
      )}
    </div>
  );
}

function GraduatedLegend({ field, breaks, colors }) {
  const labels = colors.map((c, i) => {
    const lo = i === 0 ? null : breaks[i - 1];
    const hi = i === colors.length - 1 ? null : breaks[i];
    if (lo === null) return `< ${formatValue(hi)}`;
    if (hi === null) return `≥ ${formatValue(lo)}`;
    return `${formatValue(lo)} – ${formatValue(hi)}`;
  });
  return (
    <div className="map-legend">
      <div className="map-legend-title">{field}</div>
      {colors.map((c, i) => (
        <div key={i} className="map-legend-row">
          <span className="swatch" style={{ background: c }} />
          <span>{labels[i]}</span>
        </div>
      ))}
    </div>
  );
}

function CategoryLegend({ field, categories, mode }) {
  return (
    <div className="map-legend">
      <div className="map-legend-title">{field}</div>
      {categories.map((c, i) => (
        <div key={c.key} className="map-legend-row">
          <span className="swatch" style={{ background: seriesColor(i, mode) }} />
          <span title={c.key}>{c.key.length > 22 ? `${c.key.slice(0, 21)}…` : c.key}</span>
          <span className="legend-count">{c.count.toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

/** Nested circles, since size legends read better as area than as a list. */
function SizeLegend({ field, range, color }) {
  const [min, max] = range;
  const mid = min + (max - min) / 2;
  const r = (v) => {
    if (max === min) return 10;
    return 4 + (Math.sqrt(Math.max(v, 0)) - Math.sqrt(Math.max(min, 0))) /
      (Math.sqrt(Math.max(max, 0)) - Math.sqrt(Math.max(min, 0)) || 1) * 12;
  };
  return (
    <div className="map-legend map-legend-size">
      <div className="map-legend-title">{field}</div>
      <svg width={78} height={40} aria-hidden="true">
        {[max, mid, min].map((v, i) => (
          <circle key={i} cx={20} cy={36 - r(v)} r={r(v)}
                  fill="none" stroke={color} strokeWidth={1.5} opacity={0.9} />
        ))}
        <text x={42} y={12} fontSize={9} fill="currentColor">{formatValue(max)}</text>
        <text x={42} y={36} fontSize={9} fill="currentColor">{formatValue(min)}</text>
      </svg>
    </div>
  );
}

function HoverCard({ hover, colorField }) {
  const entries = Object.entries(hover.row)
    .filter(([k]) => !k.startsWith('__'))
    .sort(([a], [b]) => (a === colorField ? -1 : b === colorField ? 1 : 0))
    .slice(0, 8);
  return (
    <div className="map-hover" style={{ left: hover.x + 14, top: hover.y + 14 }}>
      {entries.map(([k, v]) => (
        <div key={k} className="map-hover-row">
          <span className="k">{k}</span>
          <span className="v">{typeof v === 'number' ? formatValue(v) : String(v ?? '—')}</span>
        </div>
      ))}
    </div>
  );
}
