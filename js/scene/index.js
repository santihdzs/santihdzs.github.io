import * as THREE from 'three';
import { gsap } from 'gsap';
import { buildLayout, STAR_FOCAL } from './layout.js';
import { createField } from './field.js';
import { createNebula } from './nebula.js';
import { createPicker } from './picking.js';
import { createCard, formatMonth } from './card.js';
import { createStreaks } from './streaks.js';
import { createPerf } from './perf.js';
import { MAX_LANGS } from './shaders.js';
import { wantsNebula } from '../texture.js';

const FOV = 55;
const CONTENT_FOCAL = 15;
const CONTENT_INTENSITY = 0.5;
// below the hero the field softens into a dimmer, fully defocused haze behind the text
const READING_FOCAL = 2.5;
const READING_INTENSITY = 0.36;
const FLY_DIST = 2.6;
const DRIFT = 0.0025;
const PARALLAX = 0.06;
const MODE_TIME = 0.8;
const FLIGHT_TIME = 1.1;

// overscroll exit at the newest end: armed after some travel, a fresh gesture after the camera
// rests at the edge, wheel distance accumulated against a threshold, reset after a pause
const EXIT = { arm: 3, rest: 300, threshold: 280, idle: 400, pull: 0.25 };
const HINT = 'click a star, scroll to travel back in time';
const EXIT_HINT = 'scroll again to return to the page';

function createContext(canvas) {
  try {
    return canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'high-performance',
    });
  } catch {
    return null;
  }
}

// returns null when webgl2 is unavailable so the caller can skip the scene silently
export function createStarfield({ data, prs = [], reduced, texture = 'nebula' }) {
  const canvas = document.createElement('canvas');
  canvas.className = 'starfield';
  canvas.setAttribute('aria-hidden', 'true');
  const gl = createContext(canvas);
  if (!gl) return null;

  let renderer;
  try {
    // colors are authored as display values, skip three's conversions entirely
    THREE.ColorManagement.enabled = false;
    renderer = new THREE.WebGLRenderer({ canvas, context: gl });
  } catch {
    return null;
  }
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setClearColor(0x06080b, 1);

  const still = () => reduced.matches;
  const layout = buildLayout(data);
  const field = createField(layout);
  const { uniforms, points } = field;
  const scene = new THREE.Scene();
  scene.add(points);
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 400);
  const picker = createPicker(layout);
  const maxPoint = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)?.[1] ?? 64;

  // per repo chronological order for the card's prev and next
  const repoOrder = new Map();
  const repoPos = new Int32Array(layout.n);
  for (let i = layout.n - 1; i >= 0; i--) {
    const r = data.commits[i].repo;
    if (!repoOrder.has(r)) repoOrder.set(r, []);
    const list = repoOrder.get(r);
    repoPos[i] = list.length;
    list.push(i);
  }

  // the canvas is the one source of truth for the viewport. with classic scrollbars and
  // scrollbar-gutter: stable it can be narrower than window.innerWidth.
  const view = { left: 0, top: 0, w: 1, h: 1 };
  const cam = { x: 0, y: 0, z: 0 };
  // everything the field looks like: focal plane, brightness, and the nebula blend (0 page, 1 stars)
  const look = { focal: CONTENT_FOCAL, intensity: 0, nebula: 0 };
  const band = { target: 0, value: 0 };
  const exit = { armed: false, edgeSince: 0, lastWheel: 0, acc: 0, hint: false };
  const travelMin = layout.zOldest + STAR_FOCAL;
  // home is the newest end of the tunnel: its focal plane sits just past the newest commits
  const travelMax = 0;
  const langs = Array.from({ length: MAX_LANGS }, () => ({ hi: 0, lo: 0 }));
  const pointer = { x: -1, y: -1, nx: 0, ny: 0, overCanvas: false, target: null };
  const parallax = { x: 0, y: 0 };
  const tmp = new THREE.Vector3();

  let mode = 'content';
  let travelTarget = 0;
  let focus = -1;
  let saved = null;
  let pr = null;
  let ctx = null;
  let flying = false;
  let hover = -1;
  let langFilter = null;
  let drift = 0;
  let time = 0;
  let last = performance.now();
  let running = false;
  let lost = false;
  let lastMonth = '';
  let signature = '';
  let drag = null;
  let blend = 0;

  const busy = () => focus >= 0 || pr !== null;
  const perf = createPerf({ onChange: () => applySize() });

  const ring = document.createElement('div');
  ring.className = 'star-ring';

  const ui = document.createElement('div');
  ui.className = 'stars-ui';
  ui.innerHTML = `
    <div class="stars-ui-inner">
      <button class="browse" type="button">browse commits</button>
      <p class="hint"></p>
      <p class="readout" aria-hidden="true"></p>
    </div>`;
  const browse = ui.querySelector('.browse');
  const hint = ui.querySelector('.hint');
  const readout = ui.querySelector('.readout');
  hint.textContent = HINT;

  const card = createCard({
    data,
    reduced,
    owner: data.user || 'santihdzs',
    onClose: () => (pr ? closePr() : unfocus()),
    onStep: step,
  });

  document.body.prepend(canvas);
  document.body.append(ring);
  (document.querySelector('.topbar') ?? canvas).after(ui);
  const nebula = wantsNebula(texture) ? createNebula() : null;
  if (nebula) scene.add(nebula.mesh);

  const streaks = createStreaks({
    prs,
    reduced,
    scene,
    camera,
    view,
    uniforms,
    canFire: () => !busy() && !flying && !document.hidden,
    onHit: (s) => focusPr(s),
  });

  function measure() {
    const r = canvas.getBoundingClientRect();
    view.left = r.left;
    view.top = r.top;
    view.w = Math.max(1, r.width);
    view.h = Math.max(1, r.height);
  }

  function applySize() {
    measure();
    renderer.setPixelRatio(perf.dpr);
    renderer.setSize(view.w, view.h, false);
    camera.aspect = view.w / view.h;
    camera.updateProjectionMatrix();
    uniforms.uPx.value = view.h / (2 * Math.tan((FOV * Math.PI) / 360));
    uniforms.uDpr.value = perf.dpr;
    uniforms.uMaxPoint.value = maxPoint;
    canvas.dataset.dpr = String(perf.dpr);
    signature = '';
  }

  const resizer = new ResizeObserver(applySize);
  let dprQuery = null;
  function watchDpr() {
    dprQuery?.removeEventListener('change', onDpr);
    dprQuery = matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    dprQuery.addEventListener('change', onDpr);
  }
  function onDpr() {
    perf.setDevice(window.devicePixelRatio || 1);
    applySize();
    watchDpr();
  }

  function worldPosition(i) {
    points.updateMatrixWorld();
    return tmp.fromArray(layout.positions, i * 3).applyMatrix4(points.matrixWorld);
  }

  // projected client position and displayed disc of a star, null when behind the camera
  function screenOf(i) {
    picker.prepare(camera, points);
    const s = picker.project(i, view.w, view.h);
    if (s.dist <= 0.05) return null;
    const d = picker.disc(i, s.dist, uniforms.uFocal.value, uniforms.uPx.value, langs, focus);
    return { x: s.x + view.left, y: s.y + view.top, dist: s.dist, size: d.size, coc: d.coc };
  }

  function navFor(i) {
    const list = repoOrder.get(data.commits[i].repo);
    return {
      canPrev: repoPos[i] > 0,
      canNext: repoPos[i] < list.length - 1,
      repoIndex: repoPos[i] + 1,
      repoTotal: list.length,
      index: layout.n - i,
      total: layout.n,
    };
  }

  function setHint(text, visible) {
    if (hint.textContent !== text) hint.textContent = text;
    hint.classList.toggle('is-faded', !visible);
  }

  function fadeHint() {
    if (!exit.hint) setHint(hint.textContent, false);
  }

  function focusStar(i, opener) {
    if (i < 0 || i >= layout.n || pr) return;
    // saved is the camera before the first flight, chained flights keep it
    if (focus < 0) saved = { x: cam.x, y: cam.y, z: cam.z };
    focus = i;
    flying = true;
    setHover(-1);
    fadeHint();
    releaseExit();
    if (card.isOpen) card.setMoving(true);
    const p = worldPosition(i);
    const duration = still() ? 0 : FLIGHT_TIME;
    gsap.to(cam, {
      x: p.x,
      y: p.y,
      z: p.z + FLY_DIST,
      duration,
      ease: 'power3.inOut',
      overwrite: true,
      onComplete: () => {
        flying = false;
        if (focus === i) card.show({ kind: 'commit', index: i, nav: navFor(i) }, opener);
      },
    });
    gsap.to(look, { focal: FLY_DIST, duration, ease: 'power3.inOut', overwrite: 'auto' });
  }

  function unfocus() {
    if (focus < 0) return;
    focus = -1;
    card.hide();
    const back = saved ?? { x: 0, y: 0, z: travelTarget };
    saved = null;
    const duration = still() ? 0 : FLIGHT_TIME;
    flying = true;
    gsap.to(cam, {
      ...back,
      duration,
      ease: 'power3.inOut',
      overwrite: true,
      onComplete: () => {
        flying = false;
        travelTarget = cam.z;
      },
    });
    gsap.to(look, { focal: mode === 'stars' ? STAR_FOCAL : CONTENT_FOCAL, duration, ease: 'power3.inOut', overwrite: 'auto' });
  }

  // a pull request streak was clicked: remember exactly where we were, hold the streak in
  // world space, look like stars mode (a peek when it came from the page) and fly to its head
  function focusPr(s) {
    if (busy() || flying) return;
    pr = s;
    ctx = {
      mode,
      scrollY: window.scrollY,
      cam: { x: cam.x, y: cam.y, z: cam.z },
      travelTarget,
      look: { focal: look.focal, intensity: look.intensity, nebula: look.nebula },
    };
    flying = true;
    setHover(-1);
    releaseExit();
    fadeHint();
    api.onPr?.(true, ctx);
    const duration = still() ? 0 : FLIGHT_TIME;
    gsap.to(look, { intensity: 1, nebula: 1, duration: still() ? 0 : MODE_TIME, ease: 'power2.inOut', overwrite: 'auto' });
    streaks.pause(() => {
      if (pr !== s) return;
      const p = streaks.headWorld();
      if (!p) return;
      gsap.to(cam, {
        x: p.x,
        y: p.y,
        z: p.z + FLY_DIST,
        duration,
        ease: 'power3.inOut',
        overwrite: true,
        onComplete: () => {
          flying = false;
          if (pr === s) card.show({ kind: 'pr', pr: s.pr });
        },
      });
      gsap.to(look, { focal: FLY_DIST, duration, ease: 'power3.inOut', overwrite: 'auto' });
    });
  }

  // every way out of a pull request card lands back in the captured context
  function closePr() {
    if (!pr) return;
    const back = ctx;
    pr = null;
    ctx = null;
    const restore = card.hide();
    const duration = still() ? 0 : FLIGHT_TIME;
    flying = true;
    travelTarget = back.travelTarget;
    gsap.to(cam, {
      ...back.cam,
      duration,
      ease: 'power3.inOut',
      overwrite: true,
      onComplete: () => {
        flying = false;
      },
    });
    gsap.to(look, { ...back.look, duration, ease: 'power3.inOut', overwrite: true });
    streaks.resume();
    api.onPr?.(false, back, restore);
  }

  // scope "repo" walks one repo chronologically, "all" walks every commit
  function step(scope, dir) {
    if (focus < 0) return;
    let target = -1;
    if (scope === 'repo') {
      const list = repoOrder.get(data.commits[focus].repo);
      target = list[repoPos[focus] + dir] ?? -1;
    } else {
      target = focus - dir;
    }
    if (target >= 0 && target < layout.n) focusStar(target);
  }

  function setHover(i) {
    if (hover === i) return;
    hover = i;
    ring.classList.toggle('is-visible', i >= 0);
    canvas.style.cursor = i >= 0 ? 'pointer' : '';
  }

  function travelBy(dz) {
    if (mode !== 'stars' || busy() || flying) return;
    travelTarget = Math.min(travelMax, Math.max(travelMin, travelTarget + dz));
    if (travelMax - travelTarget >= EXIT.arm) exit.armed = true;
    if (dz < 0) fadeHint();
  }

  function atRestingEdge(now) {
    return exit.edgeSince > 0 && now - exit.edgeSince >= EXIT.rest;
  }

  function pushExit(amount) {
    exit.acc += amount;
    band.target = Math.min(1, exit.acc / EXIT.threshold);
    showExitHint();
    if (exit.acc >= EXIT.threshold) commitExit();
  }

  function releaseExit() {
    if (exit.acc === 0 && band.target === 0) return;
    exit.acc = 0;
    band.target = 0;
  }

  function showExitHint() {
    exit.hint = true;
    setHint(EXIT_HINT, true);
  }

  function hideExitHint() {
    if (!exit.hint) return;
    exit.hint = false;
    setHint(EXIT_HINT, false);
  }

  function commitExit() {
    // fold the rubber band into the base look so the exit transition starts where the eye is
    look.focal = uniforms.uFocal.value;
    look.intensity = uniforms.uIntensity.value;
    look.nebula = blend;
    band.target = 0;
    band.value = 0;
    exit.acc = 0;
    api.onOverscrollExit?.();
  }

  function onWheel(e) {
    if (mode !== 'stars') return;
    const now = performance.now();
    const quiet = now - exit.lastWheel;
    exit.lastWheel = now;
    if (busy() || flying) return;
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? view.h : 1;
    const dy = e.deltaY * unit;
    // toward the present while parked at the newest end: a fresh gesture can return to the page
    if (dy < 0 && exit.armed && (exit.acc > 0 || (atRestingEdge(now) && quiet >= EXIT.rest))) {
      pushExit(-dy);
      return;
    }
    if (dy > 0) {
      releaseExit();
      hideExitHint();
    }
    travelBy(-dy * (layout.depth / 2400));
    if (dy < 0 && exit.armed && travelTarget >= travelMax) showExitHint();
  }

  function onKey(e) {
    if (mode !== 'stars' || busy() || e.defaultPrevented || e.altKey || e.metaKey || e.ctrlKey) return;
    const stepZ = Math.max(0.6, layout.depth / 30);
    const moves = {
      ArrowDown: -stepZ,
      ArrowLeft: -stepZ,
      PageDown: -stepZ * 4,
      ArrowUp: stepZ,
      ArrowRight: stepZ,
      PageUp: stepZ * 4,
      Home: Infinity,
      End: -Infinity,
    };
    if (!(e.key in moves)) return;
    e.preventDefault();
    travelBy(moves[e.key]);
  }

  function onPointerMove(e) {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.nx = ((e.clientX - view.left) / view.w) * 2 - 1;
    pointer.ny = ((e.clientY - view.top) / view.h) * 2 - 1;
    pointer.overCanvas = e.target === canvas;
    pointer.target = e.target;
    streaks.pointer(e.clientX, e.clientY, e.target);
    if (!drag || e.pointerId !== drag.id) return;
    const dy = e.clientY - drag.y;
    drag.y = e.clientY;
    drag.moved += Math.abs(dy);
    // dragging down pulls toward the present, past the edge it works like the wheel
    if (dy > 0 && exit.armed && (exit.acc > 0 || (drag.fresh && travelTarget >= travelMax))) {
      pushExit(dy * 1.2);
      return;
    }
    if (dy < 0 && exit.acc > 0) releaseExit();
    travelBy(dy * (layout.depth / 1200));
  }

  function onPointerDown(e) {
    if (mode !== 'stars' || e.pointerType === 'mouse') return;
    drag = { id: e.pointerId, y: e.clientY, moved: 0, fresh: atRestingEdge(performance.now()) };
  }

  function onPointerUp(e) {
    if (!drag || e.pointerId !== drag.id) return;
    if (exit.acc > 0 && exit.acc < EXIT.threshold) releaseExit();
    setTimeout(() => (drag = null), 0);
  }

  function pickAt(clientX, clientY, exclude = -1) {
    picker.prepare(camera, points);
    return picker.nearest(clientX - view.left, clientY - view.top, view.w, view.h, {
      focal: uniforms.uFocal.value,
      px: uniforms.uPx.value,
      langs,
      exclude,
    });
  }

  function onCanvasClick(e) {
    // clicks during a flight are dropped, never queued
    if (flying) return;
    // with a pull request open, anywhere but its head closes it
    if (pr) {
      const s = streaks.screen();
      if (!s || Math.hypot(s.x - e.clientX, s.y - e.clientY) > Math.max(14, s.size * 2 + 8)) closePr();
      return;
    }
    if (mode !== 'stars') return;
    if (drag && drag.moved > 8) return;
    const i = pickAt(e.clientX, e.clientY, focus);
    if (i >= 0) {
      focusStar(i);
      return;
    }
    if (focus >= 0) {
      const s = screenOf(focus);
      const onFocused = s && Math.hypot(s.x - e.clientX, s.y - e.clientY) <= Math.max(14, s.size / 2 + 8);
      if (!onFocused) unfocus();
    }
  }

  function updateHover() {
    if (mode !== 'stars' || pr || flying || !pointer.overCanvas) {
      setHover(-1);
      return;
    }
    setHover(pickAt(pointer.x, pointer.y, focus));
    if (hover < 0) return;
    const s = screenOf(hover);
    if (!s) return;
    ring.style.setProperty('--s', `${Math.round(Math.max(18, s.size + 12))}px`);
    ring.style.transform = `translate(${s.x}px, ${s.y}px)`;
  }

  function updateReadout() {
    if (mode !== 'stars') return;
    const label = formatMonth(layout.timeAt(cam.z - uniforms.uFocal.value));
    if (label !== lastMonth) {
      lastMonth = label;
      readout.textContent = label;
    }
  }

  function tick() {
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    const rm = still();

    if (!rm) time += dt;
    if (!rm && !busy() && !flying) drift += dt * DRIFT;
    points.rotation.z = drift;

    if (mode === 'stars' && !busy() && !flying) {
      // travel eases, except under reduced motion where it jumps
      cam.z += (travelTarget - cam.z) * (rm ? 1 : 1 - Math.exp(-dt * 4.5));
      const resting = travelTarget >= travelMax && Math.abs(cam.z - travelMax) < 0.02;
      if (!resting) exit.edgeSince = 0;
      else if (!exit.edgeSince) exit.edgeSince = now;
    } else {
      exit.edgeSince = 0;
    }
    if (exit.acc > 0 && !drag && now - exit.lastWheel > EXIT.idle) releaseExit();
    if (exit.hint && exit.acc === 0 && !(travelTarget >= travelMax)) hideExitHint();

    if (mode === 'content' && !busy() && !flying && !gsap.isTweening(look)) {
      const t = Math.min(1, Math.max(0, window.scrollY / view.h - 0.35) / 0.5);
      const k = rm ? 1 : 1 - Math.exp(-dt * 3);
      look.focal += (CONTENT_FOCAL + (READING_FOCAL - CONTENT_FOCAL) * t - look.focal) * k;
      look.intensity += (CONTENT_INTENSITY + (READING_INTENSITY - CONTENT_INTENSITY) * t - look.intensity) * k;
    }

    // the rubber band pulls at most a quarter of the way toward the page's look, nebula included
    band.value += (band.target - band.value) * (rm ? 1 : 1 - Math.exp(-dt * 10));
    const pull = band.value * EXIT.pull;
    uniforms.uFocal.value = look.focal + (CONTENT_FOCAL - look.focal) * pull;
    uniforms.uIntensity.value = look.intensity + (CONTENT_INTENSITY - look.intensity) * pull;
    blend = look.nebula * (1 - pull);

    const k = 1 - Math.exp(-dt * 3);
    const amount = rm ? 0 : busy() ? PARALLAX * 0.3 : PARALLAX;
    parallax.x += (pointer.nx * amount - parallax.x) * k;
    parallax.y += (-pointer.ny * amount * 0.6 - parallax.y) * k;
    camera.position.set(cam.x + parallax.x, cam.y + parallax.y, cam.z);
    camera.updateMatrixWorld();
    points.updateMatrixWorld();
    // the light drifts a few degrees with the parallax so highlights move a little
    uniforms.uLight.value.set((parallax.x / PARALLAX) * 0.14, (parallax.y / PARALLAX) * 0.14);

    for (let i = 0; i < MAX_LANGS; i++) {
      uniforms.uHi.value[i] = langs[i].hi;
      uniforms.uLo.value[i] = langs[i].lo;
    }
    uniforms.uTime.value = time;
    uniforms.uTwinkle.value = rm ? 0 : 0.12;
    uniforms.uFocusId.value = focus;
    nebula?.update(time, cam, view.w / view.h, blend);
    streaks.frame();

    updateHover();
    updateReadout();
    card.frame(dt, pr ? streaks.screen() : focus >= 0 ? screenOf(focus) : null, view, pointer);

    // with reduced motion nothing moves on its own, so only render on change
    if (rm) {
      const sig = [
        camera.position.x, camera.position.y, camera.position.z,
        uniforms.uIntensity.value, uniforms.uFocal.value, drift, blend,
        uniforms.uHi.value.join(), uniforms.uLo.value.join(), focus, canvas.width, canvas.height,
      ].join('|');
      if (sig === signature) return;
      signature = sig;
    }
    if (lost) return;
    renderer.render(scene, camera);
    if (!rm) perf.frame(now);
  }

  function start() {
    if (running || document.hidden) return;
    running = true;
    last = performance.now();
    perf.reset();
    gsap.ticker.add(tick);
  }

  function stop() {
    if (!running) return;
    running = false;
    gsap.ticker.remove(tick);
    perf.reset();
  }

  function onVisibility() {
    if (document.hidden) stop();
    else start();
  }

  function onContextLost(e) {
    e.preventDefault();
    lost = true;
  }

  function onContextRestored() {
    lost = false;
    signature = '';
  }

  window.addEventListener('wheel', onWheel, { passive: true });
  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);
  document.addEventListener('keydown', onKey);
  document.addEventListener('visibilitychange', onVisibility);
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('click', onCanvasClick);
  canvas.addEventListener('webglcontextlost', onContextLost);
  canvas.addEventListener('webglcontextrestored', onContextRestored);
  browse.addEventListener('click', () => focusStar(0, browse));

  applySize();
  resizer.observe(canvas);
  watchDpr();
  start();
  gsap.to(look, { intensity: CONTENT_INTENSITY, duration: still() ? 0 : 1.6, ease: 'power2.out' });

  const api = {
    onPr: null,
    onOverscrollExit: null,
    get mode() {
      return mode;
    },
    get prOpen() {
      return pr !== null;
    },
    get prOrigin() {
      return ctx?.mode ?? null;
    },
    setMode(next) {
      if (next === mode) return;
      // a pull request card keeps its own return context
      if (pr) closePr();
      mode = next;
      exit.armed = false;
      exit.acc = 0;
      exit.edgeSince = 0;
      exit.hint = false;
      band.target = 0;
      if (next === 'stars') {
        const duration = still() ? 0 : MODE_TIME;
        travelTarget = Math.min(travelMax, Math.max(travelMin, cam.z));
        setHint(HINT, true);
        lastMonth = '';
        gsap.to(look, {
          intensity: 1,
          nebula: 1,
          ...(focus < 0 ? { focal: STAR_FOCAL } : {}),
          duration,
          ease: 'power2.inOut',
          overwrite: 'auto',
        });
        return;
      }
      // leaving with a card open is one motion: from wherever the camera is straight home,
      // the look easing with it. no stop at the saved position on the way.
      const hadCard = focus >= 0;
      if (hadCard) {
        focus = -1;
        saved = null;
        card.hide();
      }
      setHover(-1);
      travelTarget = 0;
      const duration = still() ? 0 : hadCard ? FLIGHT_TIME : MODE_TIME;
      flying = duration > 0;
      gsap.to(look, { intensity: CONTENT_INTENSITY, focal: CONTENT_FOCAL, nebula: 0, duration, ease: 'power3.inOut', overwrite: true });
      gsap.to(cam, {
        x: 0,
        y: 0,
        z: 0,
        duration,
        ease: 'power3.inOut',
        overwrite: true,
        onComplete: () => {
          flying = false;
        },
      });
      if (!duration) flying = false;
    },
    focusStar,
    closeCard() {
      if (pr) closePr();
      else unfocus();
    },
    get cardOpen() {
      return card.isOpen;
    },
    get languageFilter() {
      return langFilter;
    },
    setLanguageFocus(index) {
      langFilter = index;
      const duration = still() ? 0 : 0.25;
      langs.forEach((s, i) => {
        const on = index !== null && i === index;
        const off = index !== null && i !== index;
        gsap.to(s, { hi: on ? 1 : 0, lo: off ? 1 : 0, duration, ease: 'power2.out', overwrite: true });
      });
    },
    dispose() {
      stop();
      resizer.disconnect();
      dprQuery?.removeEventListener('change', onDpr);
      gsap.killTweensOf([cam, look, ...langs]);
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', onVisibility);
      streaks.dispose();
      card.dispose();
      ui.remove();
      ring.remove();
      field.dispose();
      nebula?.dispose();
      renderer.dispose();
      canvas.remove();
      if (window.__starfield === debug) delete window.__starfield;
    },
  };

  // read only hooks for automated checks, only with ?debug in the url. positions are client px.
  const debug = {
    layout,
    view,
    project(i) {
      picker.prepare(camera, points);
      const s = picker.project(i, view.w, view.h);
      const d = picker.disc(i, s.dist, uniforms.uFocal.value, uniforms.uPx.value, langs);
      return { x: s.x + view.left, y: s.y + view.top, dist: s.dist, size: d.size, coc: d.coc, lo: d.lo };
    },
    pickAt: (x, y, exclude = -1) => pickAt(x, y, exclude),
    streak: () => streaks.debug(),
    fireStreak: () => streaks.fireNow(),
    nebulaColors: () => nebula?.colors() ?? null,
    state: () => ({
      mode,
      focus,
      flying,
      hover,
      pr: pr ? pr.pr.url : null,
      ctx: ctx && JSON.parse(JSON.stringify(ctx)),
      filter: langFilter,
      cam: { x: cam.x, y: cam.y, z: cam.z },
      camera: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
      saved: saved && { x: saved.x, y: saved.y, z: saved.z },
      travelTarget,
      focal: uniforms.uFocal.value,
      intensity: uniforms.uIntensity.value,
      nebula: blend,
      band: band.value,
      exit: { ...exit },
      hasNebula: !!nebula,
      dpr: perf.dpr,
    }),
  };
  if (new URLSearchParams(window.location.search).has('debug')) window.__starfield = debug;

  return api;
}
