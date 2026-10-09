import { gsap } from 'gsap';

const SVG = 'http://www.w3.org/2000/svg';
const TRAIL = 180;

// the flyer reuses the footer rocket's outline and silhouette. exhaust lives in a group masked
// by the silhouette, so trail and flame start at the nozzle and never draw inside the outline.
// a second cut, one css pixel wider all round, keeps the mask's antialiased and resampled edge
// outside the outline at any sub-pixel position of the flight.
function buildFlyer(rocketSvg) {
  const silhouette = rocketSvg.querySelector('.rocket-silhouette').getAttribute('d');
  const height = 44 + TRAIL;
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', `-10 0 48 ${height}`);
  svg.setAttribute('width', '48');
  svg.setAttribute('height', String(height));
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.innerHTML = `
    <defs>
      <linearGradient id="rocket-trail-fly" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" style="stop-color: var(--accent); stop-opacity: 0.7"/>
        <stop offset="1" style="stop-color: var(--accent); stop-opacity: 0"/>
      </linearGradient>
      <mask id="rocket-cut-fly" maskUnits="userSpaceOnUse" x="-10" y="0" width="48" height="${height}">
        <rect x="-10" y="0" width="48" height="${height}" fill="#fff"/>
        <path d="${silhouette}" fill="#000" stroke="#000" stroke-width="2.6" stroke-linejoin="round"/>
        <path d="${silhouette}" fill="none" stroke="#000" stroke-width="4.6" stroke-linejoin="round"/>
      </mask>
    </defs>
    <g mask="url(#rocket-cut-fly)">
      <rect class="rocket-trail" x="13" y="31.5" width="2" height="${TRAIL}" rx="1" fill="url(#rocket-trail-fly)"/>
      <path class="rocket-flame" d="M12.4 33c0 2.7.9 4.8 1.6 6.8.7-2 1.6-4.1 1.6-6.8z" fill="currentColor"/>
    </g>`;
  svg.append(rocketSvg.querySelector('.rocket-outline').cloneNode(true));
  return svg;
}

// stars only mode, entered from the top bar toggle or the footer rocket
export function createMode({ scene, reduced }) {
  const root = document.documentElement;
  const toggle = document.querySelector('.mode-toggle');
  const label = toggle.querySelector('.mode-label');
  const rocket = document.querySelector('.rocket');
  const rocketSvg = rocket.querySelector('.rocket-svg');
  const page = [document.querySelector('main'), document.querySelector('.site-footer'), document.querySelector('.skip')].filter(Boolean);
  const debug = new URLSearchParams(window.location.search).has('debug');

  let active = false;
  let launch = null;
  let peeking = false;
  let peekFocus = null;

  const fadePage = (visible) =>
    gsap.to(page, {
      autoAlpha: visible ? 1 : 0,
      duration: reduced.matches ? 0 : 0.6,
      ease: 'power2.out',
      overwrite: true,
      ...(visible ? { clearProps: 'opacity,visibility' } : {}),
    });

  function setLabel(text, pressed) {
    label.textContent = text;
    toggle.setAttribute('aria-pressed', String(pressed));
  }

  function enter() {
    if (active) return;
    active = true;
    root.classList.add('is-stars');
    setLabel('back to page', true);
    for (const el of page) el.inert = true;
    fadePage(false);
    scene.setMode('stars');
  }

  function exit() {
    if (!active) return;
    active = false;
    scene.setMode('content');
    root.classList.remove('is-stars');
    window.scrollTo(0, 0);
    setLabel('stars only', false);
    for (const el of page) el.inert = false;
    fadePage(true);
  }

  // a pull request card opened from the page is a peek: the page fades and goes inert like stars
  // mode, but scroll position, focus and the toggle state all come back exactly when it closes
  function onPr(open, ctx, restore) {
    if (open) {
      if (ctx.mode === 'content') {
        peeking = true;
        peekFocus = document.activeElement;
        root.classList.add('is-peek');
        for (const el of page) el.inert = true;
        fadePage(false);
        setLabel('back to page', false);
      } else {
        setLabel('back to stars', true);
      }
      return;
    }
    if (peeking) {
      peeking = false;
      root.classList.remove('is-peek');
      // a peek closed by entering stars mode (a launch that lands mid peek) leaves the page to stars mode
      if (!active) {
        for (const el of page) el.inert = false;
        fadePage(true);
      }
      const target = [restore, peekFocus].find((el) => el && el !== document.body && document.contains(el) && !el.closest('[inert]'));
      if (target && (document.activeElement === document.body || !document.activeElement)) target.focus({ preventScroll: true });
      peekFocus = null;
    }
    setLabel(active ? 'back to page' : 'stars only', active);
  }

  function landFocus(hadFocus) {
    if (hadFocus) toggle.focus({ preventScroll: true });
  }

  function onLaunch() {
    if (active || launch) return;
    const hadFocus = document.activeElement === rocket;
    if (reduced.matches) {
      enter();
      landFocus(hadFocus);
      return;
    }

    // fly a fixed copy so the page can scroll underneath it
    const r = rocketSvg.getBoundingClientRect();
    const flyer = document.createElement('div');
    flyer.className = 'rocket-flyer';
    flyer.style.cssText = `left:${r.left - 10}px;top:${r.top}px;width:48px;height:${44 + TRAIL}px`;
    flyer.append(buildFlyer(rocketSvg));
    const flame = flyer.querySelector('.rocket-flame');
    const trail = flyer.querySelector('.rocket-trail');
    // collapsed before it is ever painted, so the first frame never flashes a full trail
    gsap.set(trail, { scaleY: 0, opacity: 0, transformOrigin: '50% 0%' });
    document.body.append(flyer);
    rocketSvg.style.visibility = 'hidden';
    const distance = r.bottom + TRAIL + 60;
    const scroll = { y: window.scrollY };

    const cleanup = () => {
      flyer.remove();
      rocketSvg.style.visibility = '';
      launch = null;
      if (debug) delete window.__launch;
    };

    launch = gsap.timeline({ onComplete: cleanup });
    launch
      .to(flame, { opacity: 0.95, scaleY: 1.6, transformOrigin: '50% 0%', duration: 0.2, ease: 'power1.out' }, 0)
      .to(flyer, { y: -distance, duration: 1.4, ease: 'power2.in' }, 0.06)
      .fromTo(trail, { scaleY: 0, opacity: 0 }, { scaleY: 1, opacity: 1, duration: 0.8, ease: 'power2.in', immediateRender: false }, 0.1)
      .to(scroll, { y: 0, duration: 1.3, ease: 'power2.inOut', onUpdate: () => window.scrollTo(0, scroll.y) }, 0)
      .call(() => {
        enter();
        landFocus(hadFocus);
      }, null, 1.42);
    if (debug) window.__launch = launch;
  }

  function onToggle() {
    // with a pull request open the toggle closes it back into wherever it was opened from
    if (scene.prOpen) scene.closeCard();
    else if (active) exit();
    else enter();
  }

  function onKey(e) {
    if (e.key === 'Escape' && active && !e.defaultPrevented) {
      e.preventDefault();
      exit();
    }
  }

  scene.onPr = onPr;
  // scrolling past the newest commit returns to the page
  scene.onOverscrollExit = () => exit();

  toggle.addEventListener('click', onToggle);
  rocket.addEventListener('click', onLaunch);
  document.addEventListener('keydown', onKey);
  toggle.hidden = false;
  rocket.hidden = false;

  return {
    dispose() {
      launch?.progress(1);
      if (scene.prOpen) scene.closeCard();
      exit();
      scene.onPr = null;
      scene.onOverscrollExit = null;
      toggle.removeEventListener('click', onToggle);
      rocket.removeEventListener('click', onLaunch);
      document.removeEventListener('keydown', onKey);
      toggle.hidden = true;
      rocket.hidden = true;
    },
  };
}
