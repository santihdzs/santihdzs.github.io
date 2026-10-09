// the 404 page: shows the requested path over the shared calm starfield
import { createSky } from './sky.js';

// the path only shows when it reads as a path: short, with no spaces. anything else leaves the line
// empty, and its reserved space keeps everything where it was
const MAX_PATH = 60;

const pathEl = document.querySelector('.nf-path code');
if (pathEl) {
  let p = location.pathname;
  try {
    p = decodeURI(p);
  } catch {
    // a malformed escape stays as it came
  }
  if (Array.from(p).length <= MAX_PATH && !/\s/.test(p)) pathEl.textContent = p;
}

const canvas = document.querySelector('.nf-sky');
if (canvas && !createSky(canvas, { quiet: () => [...(document.querySelector('.nf')?.children ?? [])] })) canvas.remove();
