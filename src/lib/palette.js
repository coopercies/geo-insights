// Validated categorical palette + sequential ramp.
// Slot order is the colorblind-safety mechanism — do not reorder or cycle it.

export const CATEGORICAL = {
  light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'],
  dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
};

// Blue, light -> dark. Used for choropleths and graduated symbols.
export const SEQUENTIAL = [
  '#cde2fb', '#b7d3f6', '#9ec5f4', '#86b6ef', '#6da7ec',
  '#5598e7', '#3987e5', '#2a78d6', '#256abf', '#1c5cab',
  '#184f95', '#104281', '#0d366b',
];

/**
 * Single-hue sequential ramps, light → dark. Blue is the skill's validated
 * reference; the rest were generated in OKLCH from the categorical anchors on
 * a matched lightness band, so every ramp reads with the same structure.
 * All are monotonic in lightness and clear 8:1 at the dark end against the
 * light surface.
 */
export const RAMPS = {
  blue: SEQUENTIAL,
  orange: ['#ffcbab', '#ffae86', '#ff9465', '#ff7c49', '#e96936', '#cd5b2e', '#ae512d', '#8c4930', '#6a4133'],
  teal: ['#adf8d2', '#85e8b9', '#5fd6a2', '#3dc38d', '#22af7b', '#1a996b', '#24835d', '#2e6c50', '#335645'],
  green: ['#b7f9b1', '#95e98e', '#75d76e', '#5bc454', '#47af42', '#3d9938', '#398335', '#396c35', '#385636'],
  yellow: ['#ffdb95', '#ffc366', '#f4ac34', '#e29700', '#cc8400', '#b47300', '#986400', '#7c5617', '#5f4928'],
  magenta: ['#ffcce5', '#ffb0d1', '#ff97bd', '#ed80a9', '#d76e96', '#bd5f83', '#a05470', '#824a5f', '#63424d'],
  violet: ['#dbdcff', '#c5c4ff', '#b0adff', '#9d97ff', '#8a84f5', '#7973d8', '#6864b6', '#585691', '#49496c'],
  red: ['#ffc4bb', '#ffa59c', '#ff8880', '#ff6e69', '#f35b57', '#d64e4b', '#b54743', '#91433f', '#6d3e3a'],
};

// Two poles that read as opposite, with a neutral midpoint that reads as
// "nothing". The midpoint tracks the surface, so it recedes in either mode.
export const DIVERGING_RAMP = {
  light: ['#184f95', '#2163b5', '#2a78d6', '#9abbe6', '#f0efec', '#e6928a', '#d03b3b', '#af3030', '#8f2626'],
  dark: ['#184f95', '#2163b5', '#2a78d6', '#38567b', '#383835', '#8b413b', '#d03b3b', '#af3030', '#8f2626'],
};

export const RAMP_OPTIONS = [
  { id: 'blue', label: 'Blue (sequential)' },
  { id: 'teal', label: 'Teal (sequential)' },
  { id: 'green', label: 'Green (sequential)' },
  { id: 'orange', label: 'Orange (sequential)' },
  { id: 'yellow', label: 'Yellow (sequential)' },
  { id: 'red', label: 'Red (sequential)' },
  { id: 'magenta', label: 'Magenta (sequential)' },
  { id: 'violet', label: 'Violet (sequential)' },
  { id: 'diverging', label: 'Blue ↔ Red (diverging)' },
];

/** Steps for a named ramp, sampled to `n` classes and optionally reversed. */
export function rampFor(id, n, mode = 'light', reverse = false) {
  const base = id === 'diverging' ? DIVERGING_RAMP[mode] : (RAMPS[id] || RAMPS.blue);
  const steps = rampSteps(base, n);
  return reverse ? [...steps].reverse() : steps;
}

export const DIVERGING = {
  low: '#2a78d6',
  mid: { light: '#f0efec', dark: '#383835' },
  high: '#d03b3b',
};

export const INK = {
  light: {
    surface: '#fcfcfb',
    plane: '#f9f9f7',
    primary: '#0b0b0b',
    secondary: '#52514e',
    muted: '#898781',
    grid: '#e1e0d9',
    axis: '#c3c2b7',
    border: 'rgba(11,11,11,0.10)',
  },
  dark: {
    surface: '#1a1a19',
    plane: '#0d0d0d',
    primary: '#ffffff',
    secondary: '#c3c2b7',
    muted: '#898781',
    grid: '#2c2c2a',
    axis: '#383835',
    border: 'rgba(255,255,255,0.10)',
  },
};

/** Series color for slot i, never cycled past the 8-slot ceiling. */
export function seriesColor(i, mode = 'light') {
  const slots = CATEGORICAL[mode];
  return slots[Math.min(i, slots.length - 1)];
}

/** Sample n evenly spaced steps out of a ramp. */
export function rampSteps(ramp, n) {
  if (n <= 1) return [ramp[Math.floor(ramp.length / 2)]];
  return Array.from({ length: n }, (_, i) =>
    ramp[Math.round((i / (n - 1)) * (ramp.length - 1))]
  );
}

export function currentMode() {
  if (typeof document === 'undefined') return 'light';
  const stamped = document.documentElement.dataset.theme;
  if (stamped === 'dark' || stamped === 'light') return stamped;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
