import { gsap } from 'gsap';
import { MOCKS, parse, fetchNowPlaying } from './nowplaying.js';

// now playing satellite: album art on a faint tilted orbit around the hero text.
// any failure renders nothing and logs nothing. ?spotify=mock or ?spotify=mock-recent shows a sample.
const POLL_MS = 30000;
// a request that hangs this long is dropped, so the next poll is never blocked behind it
const TIMEOUT_MS = 10000;
const PERIOD = { playing: 90, recent: 240 };
const TILT = (-9 * Math.PI) / 180;
const SVG = 'http://www.w3.org/2000/svg';
const TEXT = '.hero-kicker, .hero-name, .hero-lede, .hero-links';
// the tile is judged where it will be LEAD seconds ahead (half the css fade on .sat-body), so each fade is half done
// as it meets or clears the text. it dims on touch but only brightens once this far clear, so it never flickers on an edge
const LEAD = 0.25;
const CLEAR = 6;

export function createSatellite({ endpoint, mock, reduced }) {
  const hero = document.querySelector('.hero');
  const anchor = hero?.querySelector('.hero-inner');
  const mockBody = MOCKS[mock];
  if (!hero || !anchor || (!endpoint && !mockBody)) return { dispose() {} };

  const orbit = document.createElement('div');
  orbit.className = 'orbit';
  orbit.hidden = true;
  orbit.innerHTML = `
    <svg class="orbit-path" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id="orbit-spot-fill"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
        <mask id="orbit-spot" maskUnits="userSpaceOnUse"><circle class="orbit-spot" r="120" fill="url(#orbit-spot-fill)"/></mask>
      </defs>
      <ellipse class="orbit-base"/>
      <ellipse class="orbit-lit" mask="url(#orbit-spot)"/>
    </svg>
    <a class="satellite" target="_blank" rel="noopener">
      <span class="sat-body">
        <img class="sat-art" alt="" width="32" height="32" decoding="async" referrerpolicy="no-referrer">
        <span class="sat-side">
          <img class="sat-icon" src="./assets/spotify-icon-white.svg" alt="" width="22" height="21">
          <span class="sat-eq" aria-hidden="true"><i></i><i></i><i></i></span>
        </span>
      </span>
      <span class="sat-label">
        <span class="sat-eyebrow"></span>
        <span class="sat-track"></span>
        <span class="sat-artists"></span>
        <img class="sat-logo" src="./assets/spotify-logo-white.svg" alt="Spotify" width="70" height="19">
      </span>
    </a>`;
  anchor.after(orbit);

  const svg = orbit.querySelector('.orbit-path');
  const ellipses = orbit.querySelectorAll('ellipse');
  const spot = orbit.querySelector('.orbit-spot');
  const link = orbit.querySelector('.satellite');
  const body = orbit.querySelector('.sat-body');
  const art = orbit.querySelector('.sat-art');
  const eyebrow = orbit.querySelector('.sat-eyebrow');
  const trackEl = orbit.querySelector('.sat-track');
  const artistsEl = orbit.querySelector('.sat-artists');

  const geo = { cx: 0, cy: 0, rx: 0, ry: 0, w: 0, h: 0 };
  const tile = { w: 0, h: 0 };
  const motion = { speed: 1 };
  let boxes = [];
  let behind = false;
  let angle = -0.55;
  let state = null;
  let timer = 0;
  let controller = null;
  let disposed = false;
  let last = performance.now();
  // the orbit keeps turning while nobody can see it, but the tile is only placed while it can be seen
  let onScreen = true;

  function layout() {
    const w = hero.clientWidth;
    const h = hero.clientHeight;
    const r = { x: anchor.offsetLeft, y: anchor.offsetTop, w: anchor.offsetWidth, h: anchor.offsetHeight };
    const cx = r.x + r.w / 2;
    // keep the orbit (and the satellite riding it) inside the viewport on the left
    const room = cx + hero.getBoundingClientRect().left - 28;
    Object.assign(geo, { w, h, cx, cy: r.y + r.h / 2, rx: Math.min(r.w / 2 + 96, room), ry: r.h / 2 + 52 });
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.setAttribute('width', String(w));
    svg.setAttribute('height', String(h));
    for (const e of ellipses) {
      e.setAttribute('cx', geo.cx.toFixed(1));
      e.setAttribute('cy', geo.cy.toFixed(1));
      e.setAttribute('rx', geo.rx.toFixed(1));
      e.setAttribute('ry', geo.ry.toFixed(1));
      e.setAttribute('transform', `rotate(${((TILT * 180) / Math.PI).toFixed(2)} ${geo.cx.toFixed(1)} ${geo.cy.toFixed(1)})`);
    }
    measure();
    place();
  }

  // hero text boxes in hero coordinates, read only on layout. offsets ignore the intro's translate
  function measure() {
    boxes = [...anchor.querySelectorAll(TEXT)].map((el) => {
      let x = 0;
      let y = 0;
      for (let n = el; n && n !== hero; n = n.offsetParent) {
        x += n.offsetLeft;
        y += n.offsetTop;
      }
      return { l: x, t: y, r: x + el.offsetWidth, b: y + el.offsetHeight };
    });
    tile.w = body.offsetWidth;
    tile.h = body.offsetHeight;
  }

  const covers = (l, t, pad) => boxes.some((b) => l < b.r + pad && l + tile.w > b.l - pad && t < b.b + pad && t + tile.h > b.t - pad);

  function setBehind(on) {
    if (on === behind) return;
    behind = on;
    orbit.classList.toggle('is-behind', on);
  }

  function point(a) {
    const ex = Math.cos(a) * geo.rx;
    const ey = Math.sin(a) * geo.ry;
    return [geo.cx + ex * Math.cos(TILT) - ey * Math.sin(TILT), geo.cy + ex * Math.sin(TILT) + ey * Math.cos(TILT)];
  }

  function place() {
    const [x, y] = point(angle);
    link.style.transform = `translate(${(x - 16).toFixed(1)}px, ${(y - 16).toFixed(1)}px)`;
    spot.setAttribute('cx', x.toFixed(1));
    spot.setAttribute('cy', y.toFixed(1));
    // the label opens toward the side with room
    orbit.classList.toggle('is-flipped', x > geo.w - 300);
    const lead = state ? ((LEAD * Math.PI * 2) / PERIOD[state.state]) * motion.speed : 0;
    const [ax, ay] = point(angle + lead);
    setBehind(!reduced.matches && covers(ax - 16, ay - 16, behind ? CLEAR : 0));
  }

  function tick() {
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    if (!state || reduced.matches) {
      // a still satellite never dims
      setBehind(false);
      return;
    }
    angle += ((dt * Math.PI * 2) / PERIOD[state.state]) * motion.speed;
    if (seen()) place();
  }

  function render(next) {
    if (!next || next.state === 'idle') {
      state = null;
      orbit.hidden = true;
      return;
    }
    const t = next.track;
    const playing = next.state === 'playing';
    const artists = t.artists.join(', ');
    if (art.getAttribute('src') !== t.image) art.src = t.image;
    link.href = t.url;
    eyebrow.textContent = playing ? 'now playing' : 'last played';
    trackEl.textContent = t.name;
    artistsEl.textContent = artists;
    link.setAttribute('aria-label', `${playing ? 'now playing' : 'last played'}: ${t.name} by ${artists}, opens on spotify`);
    orbit.classList.toggle('is-playing', playing);
    orbit.classList.toggle('is-recent', !playing);
    state = next;
    if (orbit.hidden) {
      orbit.hidden = false;
      layout();
    }
  }

  const active = () => !disposed && !document.hidden && !document.documentElement.matches('.is-stars, .is-peek');

  async function poll() {
    clearTimeout(timer);
    if (!active() || controller) return;
    if (mockBody) {
      render(parse(mockBody, true));
      return;
    }
    const c = (controller = new AbortController());
    const slow = setTimeout(() => c.abort(), TIMEOUT_MS);
    try {
      render(await fetchNowPlaying(endpoint, c.signal));
    } catch (err) {
      if (err?.name !== 'AbortError') render(null);
    } finally {
      clearTimeout(slow);
      controller = null;
      if (active()) timer = setTimeout(poll, POLL_MS);
    }
  }

  function setOpen(on) {
    orbit.classList.toggle('is-open', on);
    gsap.to(motion, { speed: on ? 0 : 1, duration: reduced.matches ? 0 : 0.4, ease: 'power2.out', overwrite: true });
  }

  function onVisibility() {
    if (document.hidden) {
      clearTimeout(timer);
      controller?.abort();
    } else poll();
  }

  // pause polling while the page is hidden (stars mode or a pull request peek), refetch when it
  // comes back. other class changes on the root, like the streak hover, must not fetch.
  const hiddenPage = () => document.documentElement.matches('.is-stars, .is-peek');
  let wasStars = hiddenPage();
  const seen = () => onScreen && !wasStars;
  const watcher = new MutationObserver(() => {
    const stars = hiddenPage();
    if (stars === wasStars) return;
    wasStars = stars;
    if (stars) {
      clearTimeout(timer);
      controller?.abort();
    } else {
      if (!orbit.hidden && onScreen) place();
      poll();
    }
  });
  // the margin covers the part of the orbit that can reach past the hero's box
  const sighting = new IntersectionObserver(
    ([entry]) => {
      onScreen = entry.isIntersecting;
      if (seen() && !orbit.hidden) place();
    },
    { rootMargin: '80px' }
  );

  const resizer = new ResizeObserver(layout);
  // text boxes change size when the fonts arrive
  const onFonts = () => !disposed && !orbit.hidden && layout();
  document.fonts?.addEventListener('loadingdone', onFonts);
  document.fonts?.ready.then(onFonts);
  link.addEventListener('pointerenter', () => setOpen(true));
  link.addEventListener('pointerleave', () => setOpen(link.matches(':focus-visible')));
  link.addEventListener('focus', () => setOpen(true));
  link.addEventListener('blur', () => setOpen(link.matches(':hover')));
  document.addEventListener('visibilitychange', onVisibility);
  watcher.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  resizer.observe(anchor);
  resizer.observe(hero);
  sighting.observe(hero);
  gsap.ticker.add(tick);
  poll();

  return {
    dispose() {
      disposed = true;
      clearTimeout(timer);
      controller?.abort();
      gsap.ticker.remove(tick);
      gsap.killTweensOf(motion);
      watcher.disconnect();
      resizer.disconnect();
      sighting.disconnect();
      document.fonts?.removeEventListener('loadingdone', onFonts);
      document.removeEventListener('visibilitychange', onVisibility);
      orbit.remove();
    },
  };
}
