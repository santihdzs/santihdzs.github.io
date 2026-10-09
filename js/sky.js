// a calm 2d starfield in the home page's star tints, shared by the 404 page and the narrow view.
// a few soft dots drift slowly and go nearly silent behind the text. static under reduced motion,
// paused while the tab is hidden. returns null when there is no 2d canvas, which leaves the dark background.
import { SLOTS, starRgb } from './palette.js';

const MAX = 150;
const MIN = 100;
// one dot per this many css pixels of viewport, within MIN and MAX
const AREA_PER_DOT = 9000;
// the drift is slow enough that 30 frames a second look the same as 60. the slack keeps a 60hz screen on every other frame
const FRAME_MS = 1000 / 30 - 4;

// quiet() returns the elements whose boxes the dots stay out of
export function createSky(canvas, { quiet }) {
  const ctx = canvas?.getContext('2d') ?? null;
  if (!ctx) return null;
  try {
    return start(canvas, ctx, quiet);
  } catch {
    return null;
  }
}

function start(canvas, ctx, quiet) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const rand = mulberry(7);
  // mostly the neutral slot, with a light scatter of the language tints
  const pickSlot = () => (rand() < 0.45 ? SLOTS.length - 1 : Math.floor(rand() * (SLOTS.length - 1)));
  const sprites = SLOTS.map((_, slot) => sprite(starRgb(slot)));
  const stars = Array.from({ length: MAX }, () => {
    const depth = rand();
    return {
      x: rand(),
      y: rand(),
      r: 0.7 + depth * depth * 1.4,
      a: 0.16 + rand() * 0.3,
      // nearer dots drift a little faster, all of them slowly
      vx: -(1.2 + depth * 3.2),
      vy: -(0.4 + depth * 1.2),
      slot: pickSlot(),
    };
  });

  let w = 0;
  let h = 0;
  let count = MIN;
  let raf = 0;
  let last = 0;
  // the text, padded, where dots go almost silent. read on resize, scroll and font load only
  let text = { l: 0, t: 0, r: 0, b: 0 };

  function measure() {
    const boxes = quiet().map((el) => el.getBoundingClientRect());
    if (!boxes.length) return;
    text = {
      l: Math.min(...boxes.map((b) => b.left)) - 24,
      t: Math.min(...boxes.map((b) => b.top)) - 24,
      r: Math.max(...boxes.map((b) => b.right)) + 24,
      b: Math.max(...boxes.map((b) => b.bottom)) + 24,
    };
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    count = Math.max(MIN, Math.min(MAX, Math.round((w * h) / AREA_PER_DOT)));
    measure();
    draw();
  }

  function draw() {
    ctx.clearRect(0, 0, w, h);
    for (let i = 0; i < count; i++) {
      const s = stars[i];
      const x = s.x * w;
      const y = s.y * h;
      // nearly silent behind the text, easing back to full over the next 80px
      const away = Math.hypot(Math.max(text.l - x, 0, x - text.r), Math.max(text.t - y, 0, y - text.b));
      const q = 0.15 + 0.85 * smooth(away / 80);
      const size = s.r * 6;
      ctx.globalAlpha = s.a * q;
      ctx.drawImage(sprites[s.slot], x - size / 2, y - size / 2, size, size);
    }
    ctx.globalAlpha = 1;
  }

  function frame(now) {
    if (now - last < FRAME_MS) {
      raf = requestAnimationFrame(frame);
      return;
    }
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    for (let i = 0; i < count; i++) {
      const s = stars[i];
      s.x = wrap(s.x + (s.vx * dt) / w);
      s.y = wrap(s.y + (s.vy * dt) / h);
    }
    draw();
    raf = requestAnimationFrame(frame);
  }

  function play() {
    if (raf || reduced.matches || document.hidden) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }

  function pause() {
    cancelAnimationFrame(raf);
    raf = 0;
  }

  const onVisibility = () => (document.hidden ? pause() : play());
  const onMotion = () => (reduced.matches ? pause() : play());
  const onScroll = () => {
    measure();
    if (!raf) draw();
  };

  resize();
  canvas.classList.add('is-on');
  play();
  window.addEventListener('resize', resize);
  window.addEventListener('scroll', onScroll, { passive: true });
  document.fonts?.ready.then(onScroll);
  document.addEventListener('visibilitychange', onVisibility);
  reduced.addEventListener('change', onMotion);

  return {
    dispose() {
      pause();
      window.removeEventListener('resize', resize);
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('visibilitychange', onVisibility);
      reduced.removeEventListener('change', onMotion);
      ctx.clearRect(0, 0, w, h);
      canvas.classList.remove('is-on');
    },
  };
}

// a soft round glow, drawn once per tint and reused for every dot
function sprite(rgb) {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  const [r, gr, b] = rgb.map((v) => Math.round(v * 255));
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, `rgba(${r}, ${gr}, ${b}, 1)`);
  grad.addColorStop(0.22, `rgba(${r}, ${gr}, ${b}, 0.55)`);
  grad.addColorStop(1, `rgba(${r}, ${gr}, ${b}, 0)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  return c;
}

function wrap(v) {
  return ((v % 1) + 1) % 1;
}

function smooth(t) {
  const x = Math.min(Math.max(t, 0), 1);
  return x * x * (3 - 2 * x);
}

// small seeded random, so the sky looks the same on every visit
function mulberry(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
