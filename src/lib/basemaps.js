// Basemap registry. Every option here is key-free — nothing needs an account or
// token, which is what keeps the app deployable as static files.

import { INK } from './palette.js';

export const BASEMAP_OPTIONS = [
  { id: 'auto', label: 'Match theme' },
  { id: 'positron', label: 'Positron (light)' },
  { id: 'darkmatter', label: 'Dark Matter' },
  { id: 'voyager', label: 'Voyager (streets)' },
  { id: 'osm', label: 'OpenStreetMap' },
  { id: 'satellite', label: 'Satellite' },
  { id: 'none', label: 'None — data only' },
];

const carto = (name) => `https://basemaps.cartocdn.com/gl/${name}-gl-style/style.json`;

// Only these two change appearance with the app theme; the rest are fixed, so a
// theme toggle shouldn't force them to reload (a style swap wipes the data layers).
const THEME_DEPENDENT = new Set(['auto', 'none']);

/** Identity for a resolved style — changes only when the style really changes. */
export function basemapKey(id, mode) {
  return THEME_DEPENDENT.has(id) ? `${id}:${mode}` : id;
}

export function resolveBasemap(id, mode) {
  switch (id) {
    case 'positron':
      return carto('positron');
    case 'darkmatter':
      return carto('dark-matter');
    case 'voyager':
      return carto('voyager');
    case 'osm':
      return rasterStyle(
        ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        '© OpenStreetMap contributors',
        19
      );
    case 'satellite':
      return rasterStyle(
        ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
        'Esri, Maxar, Earthstar Geographics',
        18
      );
    case 'none':
      return blankStyle(mode);
    case 'auto':
    default:
      return carto(mode === 'dark' ? 'dark-matter' : 'positron');
  }
}

function rasterStyle(tiles, attribution, maxzoom) {
  return {
    version: 8,
    sources: {
      base: { type: 'raster', tiles, tileSize: 256, maxzoom, attribution },
    },
    layers: [{ id: 'base', type: 'raster', source: 'base' }],
  };
}

function blankStyle(mode) {
  return {
    version: 8,
    sources: {},
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': INK[mode].plane } },
    ],
  };
}

/** Imagery needs light strokes; paper basemaps need the theme's own ink. */
export function isImagery(id) {
  return id === 'satellite';
}
