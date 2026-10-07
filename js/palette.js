// slot colors at matched oklch lightness (~0.80). slot 0 is the site accent, slot 8 is the neutral "other".
// the language to slot mapping is decided once, in scripts/build-commits.mjs.
export const SLOTS = [
  '#4ade80',
  '#86c3ff',
  '#c3b0fd',
  '#f1a1ce',
  '#fda293',
  '#ebb16c',
  '#56d3da',
  '#c8c26b',
  '#b7bfc7',
];

export function slotColor(slot) {
  return SLOTS[slot] ?? SLOTS[8];
}

export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

// stars read as a bright glow with a hue, so their color is pushed toward white
export function starRgb(slot, toWhite = 0.45) {
  return hexToRgb(slotColor(slot)).map((c) => c + (1 - c) * toWhite);
}
