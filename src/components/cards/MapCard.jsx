import { useEffect, useRef, useState, useMemo } from 'react';
import { Map as MapLibreMap, NavigationControl } from 'maplibre-gl';
import { useStore } from '../../store.js';
import { SEQUENTIAL, rampSteps, INK } from '../../lib/palette.js';
import { quantileBreaks, numericValues, formatValue } from '../../lib/stats.js';
import { toNumber } from '../../lib/fields.js';
import { resolveBasemap, basemapKey, isImagery } from '../../lib/basemaps.js';

const SRC = 'data';
const CLASS_COUNT_DEFAULT = 5;
const STYLE_TIMEOUT_MS = 12000;

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
function styledGeoJSON(dataset, colorField) {
  const byId = new Map(dataset.rows.map((r) => [r.__i, r]));
  return {
    type: 'FeatureCollection',
    features: dataset.geojson.features.map((f) => {
      const row = byId.get(f.properties.__i);
      const v = colorField && row ? toNumber(row[colorField]) : null;
      return {
        type: 'Feature',
        id: f.id,
        geometry: f.geometry,
        properties: { __i: f.properties.__i, __v: v === null ? undefined : v },
      };
    }),
  };
}

function colorExpression(breaks, colors) {
  if (!breaks.length) return colors[Math.floor(colors.length / 2)];
  const expr = ['step', ['coalesce', ['get', '__v'], -Infinity], colors[0]];
  breaks.forEach((b, i) => expr.push(b, colors[i + 1]));
  // Features with no value fall in the first step; paint them neutral instead.
  return ['case', ['==', ['get', '__v'], null], '#b8b6ae', expr];
}

export default function MapCard({ card }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const boxRef = useRef(null);
  const dragRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [hover, setHover] = useState(null);
  const [trouble, setTrouble] = useState(null);

  const datasets = useStore((s) => s.datasets);
  const selection = useStore((s) => s.selection);
  const mode = useStore((s) => s.mode);
  const select = useStore((s) => s.select);

  const dataset = datasets.find((d) => d.id === card.datasetId);
  const colorField = card.config.colorField;
  const classes = card.config.classes ?? CLASS_COUNT_DEFAULT;

  const { breaks, colors } = useMemo(() => {
    if (!dataset || !colorField) return { breaks: [], colors: rampSteps(SEQUENTIAL, 5) };
    const vals = numericValues(dataset.rows, colorField);
    const b = quantileBreaks(vals, classes);
    return { breaks: b, colors: rampSteps(SEQUENTIAL, b.length + 1) };
  }, [dataset, colorField, classes]);

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

    let map;
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
    map.on('load', () => {
      setReady(true);
      setTrouble(null);
    });
    // Tile hiccups on a working map are noise; a failure before the map ever
    // loads is the thing worth surfacing, so record it and let the render
    // decide (it only shows while `ready` is false).
    map.on('error', (e) => {
      const msg = e && e.error ? e.error.message : String(e);
      console.error('[map]', msg);
      setTrouble({ title: 'The basemap failed to load', detail: msg });
    });
    mapRef.current = map;
    if (import.meta.env.DEV) window.__map = map;
    return () => {
      map.remove();
      mapRef.current = null;
      appliedStyleRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // A map that never reports `load` leaves a blank card with no explanation.
  useEffect(() => {
    if (ready || trouble) return;
    const t = setTimeout(() => {
      setTrouble({
        title: 'The basemap is taking too long',
        detail:
          'Tiles are fetched from an external host. A content blocker, VPN, or ' +
          'offline network will stop them. Data layers still work — switch the ' +
          'basemap to "None" to work without one.',
      });
    }, STYLE_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [ready, trouble]);

  // Swapping the style wipes every custom layer, so drop `ready` and let the
  // data effect rebuild them once the new style settles.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (appliedStyleRef.current === styleKey) return;
    appliedStyleRef.current = styleKey;
    setReady(false);
    map.setStyle(resolveBasemap(basemap, mode));
    map.once('styledata', () => setReady(true));
  }, [styleKey, ready, basemap, mode]);

  // --- data + layers -------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !dataset || !dataset.geojson) return;

    const data = styledGeoJSON(dataset, colorField);
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

    const fill = colorExpression(breaks, colors);
    const opacity = card.config.opacity ?? 0.85;

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
      ensure({ id: 'lyr-hi', type: 'line', source: SRC, paint: {}, filter: ['==', ['get', '__i'], -1] });
      map.setPaintProperty('lyr-hi', 'line-color', stroke.strong);
      map.setPaintProperty('lyr-hi', 'line-width', 2);
    } else if (kind === 'line') {
      ensure({ id: 'lyr-line', type: 'line', source: SRC, paint: {} });
      map.setPaintProperty('lyr-line', 'line-color', fill);
      map.setPaintProperty('lyr-line', 'line-width', 2);
      map.setPaintProperty('lyr-line', 'line-opacity', opacity);
      ensure({ id: 'lyr-hi', type: 'line', source: SRC, paint: {}, filter: ['==', ['get', '__i'], -1] });
      map.setPaintProperty('lyr-hi', 'line-color', stroke.strong);
      map.setPaintProperty('lyr-hi', 'line-width', 4);
    } else {
      ensure({ id: 'lyr-circle', type: 'circle', source: SRC, paint: {} });
      map.setPaintProperty('lyr-circle', 'circle-color', fill);
      map.setPaintProperty('lyr-circle', 'circle-opacity', opacity);
      map.setPaintProperty('lyr-circle', 'circle-radius', [
        'interpolate', ['linear'], ['zoom'], 3, 2.5, 10, 6, 16, 11,
      ]);
      map.setPaintProperty('lyr-circle', 'circle-stroke-width', 1);
      map.setPaintProperty('lyr-circle', 'circle-stroke-color', stroke.ring);
      ensure({ id: 'lyr-hi', type: 'circle', source: SRC, paint: {}, filter: ['==', ['get', '__i'], -1] });
      map.setPaintProperty('lyr-hi', 'circle-radius', [
        'interpolate', ['linear'], ['zoom'], 3, 4, 10, 8, 16, 13,
      ]);
      map.setPaintProperty('lyr-hi', 'circle-color', 'rgba(0,0,0,0)');
      map.setPaintProperty('lyr-hi', 'circle-stroke-width', 2.5);
      map.setPaintProperty('lyr-hi', 'circle-stroke-color', stroke.strong);
    }
  }, [ready, dataset, colorField, breaks, colors, mode, basemap, card.config.opacity]);

  // Fit to data the first time a layer lands.
  const fittedRef = useRef(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !dataset || !dataset.bbox) return;
    if (fittedRef.current === dataset.id) return;
    fittedRef.current = dataset.id;
    const [minX, minY, maxX, maxY] = dataset.bbox;
    map.fitBounds([[minX, minY], [maxX, maxY]], { padding: 32, duration: 0, maxZoom: 14 });
  }, [ready, dataset]);

  // --- cross-filter response ----------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !dataset) return;
    const layers = ['lyr-fill', 'lyr-line', 'lyr-circle'].filter((l) => map.getLayer(l));
    const applies = selection && selection.datasetId === dataset.id;

    if (map.getLayer('lyr-hi')) {
      map.setFilter('lyr-hi', applies
        ? ['in', ['get', '__i'], ['literal', selection.ids]]
        : ['==', ['get', '__i'], -1]);
    }

    // Dim the unselected rather than hiding them — context matters on a map.
    const base = card.config.opacity ?? 0.85;
    const dimmed = applies && selection.sourceCardId !== card.id;
    for (const l of layers) {
      const prop = l === 'lyr-fill' ? 'fill-opacity' : l === 'lyr-line' ? 'line-opacity' : 'circle-opacity';
      map.setPaintProperty(l, prop, dimmed
        ? ['case', ['in', ['get', '__i'], ['literal', selection.ids]], base, 0.15]
        : base);
    }
  }, [ready, selection, dataset, card.id, card.config.opacity]);

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
      {colorField && breaks.length > 0 && (
        <Legend field={colorField} breaks={breaks} colors={colors} />
      )}
      <div className="map-hint">Shift-drag to select · click a feature · click empty space to clear</div>
      {hover && <HoverCard hover={hover} colorField={colorField} />}
      {!ready && trouble && (
        <div className="map-trouble">
          <div className="map-trouble-title">{trouble.title}</div>
          <p>{trouble.detail}</p>
        </div>
      )}
      {!ready && !trouble && <div className="map-loading">Loading basemap…</div>}
    </div>
  );
}

function Legend({ field, breaks, colors }) {
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
