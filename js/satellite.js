import { gsap } from 'gsap';

// now playing satellite: album art on a faint tilted orbit around the hero text.
// any failure renders nothing and logs nothing. ?spotify=mock or ?spotify=mock-recent shows a sample.
const POLL_MS = 30000;
const PERIOD = { playing: 90, recent: 240 };
const TILT = (-9 * Math.PI) / 180;
const SVG = 'http://www.w3.org/2000/svg';

// stand in artwork for the mock, generated so the mock makes no network request
const MOCK_ART = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2b3a67"/><stop offset=".55" stop-color="#3f7f86"/><stop offset="1" stop-color="#d9a066"/></linearGradient></defs><rect width="64" height="64" fill="url(#a)"/><circle cx="44" cy="22" r="9" fill="#f3e3c3" opacity=".85"/></svg>'
)}`;

const MOCKS = {
  mock: {
    state: 'playing',
    track: { name: 'Lorem Ipsum Dolor', artists: ['Sit Amet', 'Consectetur'], album: 'Adipiscing Elit', image: MOCK_ART, url: 'https://open.spotify.com/', durationMs: 214000, progressMs: 61000 },
  },
  'mock-recent': {
    state: 'recent',
    track: { name: 'Sed Do Eiusmod Tempor', artists: ['Incididunt'], album: 'Ut Labore', image: MOCK_ART, url: 'https://open.spotify.com/', durationMs: 187000, playedAt: '2026-10-06T18:42:00Z' },
  },
};

// only well formed payloads render; anything else counts as a failure
function parse(body, mock) {
  if (!body || !['playing', 'recent', 'idle'].includes(body.state)) return null;
  if (body.state === 'idle') return { state: 'idle' };
  const t = body.track;
  const okImage = typeof t?.image === 'string' && (t.image.startsWith('https://') || (mock && t.image.startsWith('data:image/svg+xml')));
  const okUrl = typeof t?.url === 'string' && t.url.startsWith('https://open.spotify.com/');
  const artists = Array.isArray(t?.artists) ? t.artists.filter((a) => typeof a === 'string' && a) : [];
  if (typeof t?.name !== 'string' || !t.name || !artists.length || !okImage || !okUrl) return null;
  return { state: body.state, track: { name: t.name, artists, image: t.image, url: t.url } };
}

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
        <img class="sat-art" alt="" width="32" height="32" decoding="async">
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
  const art = orbit.querySelector('.sat-art');
  const eyebrow = orbit.querySelector('.sat-eyebrow');
  const trackEl = orbit.querySelector('.sat-track');
  const artistsEl = orbit.querySelector('.sat-artists');

  const geo = { cx: 0, cy: 0, rx: 0, ry: 0, w: 0, h: 0 };
  const motion = { speed: 1 };
  let angle = -0.55;
  let state = null;
  let timer = 0;
  let controller = null;
  let disposed = false;
  let last = performance.now();

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
    place();
  }

  function place() {
    const ex = Math.cos(angle) * geo.rx;
    const ey = Math.sin(angle) * geo.ry;
    const x = geo.cx + ex * Math.cos(TILT) - ey * Math.sin(TILT);
    const y = geo.cy + ex * Math.sin(TILT) + ey * Math.cos(TILT);
    link.style.transform = `translate(${(x - 16).toFixed(1)}px, ${(y - 16).toFixed(1)}px)`;
    spot.setAttribute('cx', x.toFixed(1));
    spot.setAttribute('cy', y.toFixed(1));
    // the label opens toward the side with room
    orbit.classList.toggle('is-flipped', x > geo.w - 300);
  }

  function tick() {
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    if (!state || reduced.matches) return;
    angle += ((dt * Math.PI * 2) / PERIOD[state.state]) * motion.speed;
    place();
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
    controller = new AbortController();
    try {
      const res = await fetch(endpoint, { signal: controller.signal, credentials: 'omit', cache: 'no-store' });
      render(res.ok ? parse(await res.json(), false) : null);
    } catch (err) {
      if (err?.name !== 'AbortError') render(null);
    } finally {
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
  const watcher = new MutationObserver(() => {
    const stars = hiddenPage();
    if (stars === wasStars) return;
    wasStars = stars;
    if (stars) {
      clearTimeout(timer);
      controller?.abort();
    } else poll();
  });

  const resizer = new ResizeObserver(layout);
  link.addEventListener('pointerenter', () => setOpen(true));
  link.addEventListener('pointerleave', () => setOpen(link.matches(':focus-visible')));
  link.addEventListener('focus', () => setOpen(true));
  link.addEventListener('blur', () => setOpen(link.matches(':hover')));
  document.addEventListener('visibilitychange', onVisibility);
  watcher.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  resizer.observe(anchor);
  resizer.observe(hero);
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
      document.removeEventListener('visibilitychange', onVisibility);
      orbit.remove();
    },
  };
}
