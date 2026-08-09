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

// Second sequential context, when two magnitude encodings share a page.
export const SEQUENTIAL_ALT = [
  '#fbdccd', '#f7bfa5', '#f4a37e', '#f08757', '#eb6834',
  '#d95926', '#bf4c1f', '#a03f19', '#822f10',
];

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
