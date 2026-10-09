import { gsap } from 'gsap';

// the interface highlight. css reads --accent (hex) and --accent-rgb (channels for rgb() with alpha);
// both are written together from one tween so every use stays in sync.
export const DEFAULT_ACCENT = '#4ade80';

const root = document.documentElement;
const icon = document.querySelector('link[rel="icon"]');
const defaultIcon = icon?.getAttribute('href') ?? '';
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const state = Object.fromEntries(['r', 'g', 'b'].map((k, i) => [k, rgb(DEFAULT_ACCENT)[i]]));
let target = DEFAULT_ACCENT;

function faviconSvg(hex) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><defs><radialGradient id="g"><stop offset="0" stop-color="${hex}" stop-opacity=".55"/><stop offset=".45" stop-color="${hex}" stop-opacity=".18"/><stop offset="1" stop-color="${hex}" stop-opacity="0"/></radialGradient></defs><circle cx="16" cy="16" r="16" fill="url(#g)"/><circle cx="16" cy="16" r="6" fill="${hex}"/></svg>`;
}

function write() {
  const c = [state.r, state.g, state.b].map((v) => Math.round(v));
  root.style.setProperty('--accent', `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`);
  root.style.setProperty('--accent-rgb', c.join(' '));
}

function settle() {
  if (target === DEFAULT_ACCENT) {
    root.style.removeProperty('--accent');
    root.style.removeProperty('--accent-rgb');
    if (icon) icon.setAttribute('href', defaultIcon);
  } else {
    write();
    if (icon) icon.setAttribute('href', `data:image/svg+xml,${encodeURIComponent(faviconSvg(target))}`);
  }
}

export function setAccent(hex = DEFAULT_ACCENT, { instant = false } = {}) {
  target = hex.toLowerCase();
  const [r, g, b] = rgb(target);
  gsap.killTweensOf(state);
  if (instant) {
    Object.assign(state, { r, g, b });
    settle();
    return;
  }
  gsap.to(state, { r, g, b, duration: 0.35, ease: 'power2.out', onUpdate: write, onComplete: settle });
}

// the live tweened channels (0 to 255), read every frame by the scene so it moves in step
export const accentChannels = () => state;
