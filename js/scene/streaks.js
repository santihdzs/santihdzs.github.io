import * as THREE from 'three';
import { gsap } from 'gsap';
import { GLSL as OPTICS, SPRITE } from './optics.js';
import { SPHERE } from './shaders.js';

// the cadence: one streak every 10 to 20 seconds, never two at once
export const STREAK_INTERVAL = [10, 20];
// gold is its own palette. it never follows the accent or the language filter.
export const GOLD = { head: [1.0, 0.83, 0.5], tail: [0.97, 0.78, 0.42] };

const HEAD_SIZE = 0.05;
const SPAWN = 9;
const TAIL_PX = 120;
const CAPTURE = 42;
const IGNORE = 'a, button, input, select, textarea, label, summary, [role="button"], [role="dialog"], p, h1, h2, h3, h4, li, dt, dd, blockquote, figcaption, pre, code';

const headVertex = /* glsl */ `
${OPTICS}
uniform float uPx;
uniform float uDpr;
uniform float uMaxPoint;
varying float vCore;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float dist = max(-mv.z, 0.001);
  vCore = starCore(uPx, ${HEAD_SIZE.toFixed(3)}, dist);
  gl_PointSize = min(vCore * SPRITE * uDpr, uMaxPoint);
  gl_Position = projectionMatrix * mv;
}
`;

const headFragment = /* glsl */ `
#define SPRITE ${SPRITE.toFixed(1)}
${SPHERE}
uniform vec3 uColor;
uniform vec2 uLight;
uniform float uAlpha;
varying float vCore;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(c, c);
  if (r2 > 1.0) discard;
  float r = sqrt(r2);
  const float rd = 1.0 / SPRITE;
  float disc = 1.0 - smoothstep(rd - 0.05, rd + 0.02, r);
  float halo = exp(-r2 * 4.2) * 0.42;
  vec2 q = c / rd;
  vec3 point = mix(uColor, vec3(1.0), (1.0 - smoothstep(0.0, rd * 0.55, r)) * 0.55);
  // a tiny head is a bright point, a near one reads as a small gold sphere
  float shade = smoothstep(5.0, 14.0, vCore) * (1.0 - smoothstep(0.92, 1.0, dot(q, q)));
  vec3 col = mix(point, litSphere(q, uColor, uLight), shade);
  gl_FragColor = vec4(mix(uColor, col, disc), (disc * 0.95 + halo) * uAlpha);
}
`;

const tailVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const tailFragment = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
varying vec2 vUv;
void main() {
  float across = abs(vUv.y - 0.5) * 2.0;
  float a = pow(vUv.x, 1.6) * (1.0 - smoothstep(0.2, 1.0, across)) * uAlpha;
  gl_FragColor = vec4(uColor, a);
}
`;

function shuffled(n, avoid) {
  const bag = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }
  // never repeat the last one across a refill
  if (n > 1 && bag[bag.length - 1] === avoid) [bag[0], bag[bag.length - 1]] = [bag[bag.length - 1], bag[0]];
  return bag;
}

// pull request streaks as real objects in the scene. hover and clicks are hit tested at the
// document level against the projected head and tail, so they stay reachable over the page.
export function createStreaks({ prs, reduced, scene, camera, view, uniforms, canFire, onHit }) {
  const root = document.documentElement;
  const inert = { pointer() {}, frame() {}, pause() {}, resume() {}, setPaused() {}, dispose() {}, fireNow: () => false, get active() { return null; }, screen: () => null, headWorld: () => null, debug: () => null };
  if (!prs.length) return inert;

  const headGeo = new THREE.BufferGeometry();
  headGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
  const headMat = new THREE.ShaderMaterial({
    uniforms: {
      uPx: uniforms.uPx,
      uDpr: uniforms.uDpr,
      uMaxPoint: uniforms.uMaxPoint,
      uLight: uniforms.uLight,
      uColor: { value: new THREE.Vector3().fromArray(GOLD.head) },
      uAlpha: { value: 0 },
    },
    vertexShader: headVertex,
    fragmentShader: headFragment,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const head = new THREE.Points(headGeo, headMat);
  head.frustumCulled = false;
  head.renderOrder = 2;

  const tailMat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Vector3().fromArray(GOLD.tail) }, uAlpha: { value: 0 } },
    vertexShader: tailVertex,
    fragmentShader: tailFragment,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const tail = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), tailMat);
  tail.frustumCulled = false;
  tail.renderOrder = 1;

  const group = new THREE.Group();
  group.add(tail, head);
  group.visible = false;
  scene.add(group);

  const tmp = new THREE.Vector3();
  const back = new THREE.Vector3();
  let bag = [];
  let last = -1;
  let timer = 0;
  let current = null;
  let paused = false;
  let catching = false;
  let lastPointer = null;

  function schedule(ms = (STREAK_INTERVAL[0] + Math.random() * (STREAK_INTERVAL[1] - STREAK_INTERVAL[0])) * 1000) {
    clearTimeout(timer);
    if (paused) return;
    timer = setTimeout(fire, ms);
  }

  // a screen point at the spawn depth in front of the camera, in world space
  function toWorld(x, y, out) {
    const halfH = Math.tan((camera.fov * Math.PI) / 360) * SPAWN;
    const halfW = halfH * camera.aspect;
    return out.set(
      camera.position.x + (((x - view.left) / view.w) * 2 - 1) * halfW,
      camera.position.y - (((y - view.top) / view.h) * 2 - 1) * halfH,
      camera.position.z - SPAWN
    );
  }

  function fire() {
    if (paused || reduced.matches || document.hidden) return schedule();
    if (!canFire()) return schedule(3000);
    if (!bag.length) bag = shuffled(prs.length, last);
    const index = bag.pop();
    last = index;

    const w = view.w;
    const h = view.h;
    const dir = Math.random() < 0.5 ? 1 : -1;
    const angle = (12 + Math.random() * 14) * (Math.PI / 180);
    const length = w * (0.22 + Math.random() * 0.1);
    const drop = Math.sin(angle) * length;
    const y0 = view.top + h * 0.05 + Math.random() * Math.max(0, h * 0.4 - drop - h * 0.05);
    const x0 = view.left + (dir > 0 ? w * (0.1 + Math.random() * 0.45) : w * (0.45 + Math.random() * 0.45));
    const start = toWorld(x0, y0, new THREE.Vector3());
    const end = toWorld(x0 + Math.cos(angle) * length * dir, y0 + drop, new THREE.Vector3());
    const worldPerPx = (2 * Math.tan((camera.fov * Math.PI) / 360) * SPAWN) / view.h;

    const state = { p: 0, hold: 0 };
    current = {
      index,
      pr: prs[index],
      start,
      end,
      dirX: end.x - start.x,
      dirY: end.y - start.y,
      worldPerPx,
      state,
      focused: false,
      screen: { x: 0, y: 0, ux: 1, uy: 0, size: 6 },
      tween: null,
    };
    current.tween = gsap.to(state, { p: 1, duration: 3.6 + Math.random() * 1.4, ease: 'none', onComplete: () => finish() });
    group.visible = true;
  }

  function setCatching(on) {
    if (on === catching) return;
    catching = on;
    root.classList.toggle('is-catching', on);
    if (current?.tween && !current.focused) gsap.to(current.tween, { timeScale: on ? 0.25 : 1, duration: 0.35, ease: 'power2.out', overwrite: true });
  }

  function finish(reschedule = true) {
    if (current?.tween) {
      gsap.killTweensOf([current.tween, current.state]);
      current.tween.kill();
    }
    current = null;
    group.visible = false;
    setCatching(false);
    if (reschedule) schedule();
  }

  function hit(px, py) {
    if (!current || current.focused) return false;
    const s = current.screen;
    const vx = px - s.x;
    const vy = py - s.y;
    const along = Math.max(-TAIL_PX, Math.min(10, vx * s.ux + vy * s.uy));
    return Math.hypot(px - (s.x + s.ux * along), py - (s.y + s.uy * along)) < CAPTURE;
  }

  const blocked = (target) => target instanceof Element && !!target.closest(IGNORE);

  function onClick(e) {
    if (!current || current.focused || e.button !== 0 || blocked(e.target)) return;
    if (!hit(e.clientX, e.clientY)) return;
    e.preventDefault();
    e.stopPropagation();
    setCatching(false);
    onHit(current);
  }

  function onVisibility() {
    if (document.hidden) {
      clearTimeout(timer);
      if (current && !current.focused) finish(false);
    } else if (!current) schedule();
  }

  document.addEventListener('click', onClick, true);
  document.addEventListener('visibilitychange', onVisibility);
  schedule();

  return {
    get active() {
      return current;
    },
    pointer(x, y, target) {
      lastPointer = { x, y, target };
      setCatching(!!current && !current.focused && !blocked(target) && hit(x, y));
    },
    // place the streak for this frame and refresh its projected head for hit testing
    frame() {
      if (!current) return;
      const { state, start, end } = current;
      const p = state.p;
      tmp.copy(start).lerp(end, p);
      headGeo.attributes.position.array.set([tmp.x, tmp.y, tmp.z]);
      headGeo.attributes.position.needsUpdate = true;
      const trail = Math.sin((Math.PI / 2) * Math.min(1, p / 0.18)) * Math.sin((Math.PI / 2) * Math.min(1, (1 - p) / 0.28));
      // while its card is open the head holds at full strength, then eases back into its fade
      const alpha = trail + (1 - trail) * state.hold;
      headMat.uniforms.uAlpha.value = alpha;
      tailMat.uniforms.uAlpha.value = alpha * (1 - state.hold * 0.6);
      const len = Math.hypot(current.dirX, current.dirY) || 1;
      const ux = current.dirX / len;
      const uy = current.dirY / len;
      const tailLen = TAIL_PX * current.worldPerPx * Math.min(1, 0.3 + p * 2.2);
      tail.position.set(tmp.x - (ux * tailLen) / 2, tmp.y - (uy * tailLen) / 2, tmp.z);
      tail.rotation.z = Math.atan2(uy, ux);
      tail.scale.set(tailLen, 1.6 * current.worldPerPx, 1);

      const s = current.screen;
      const a = tmp.clone().project(camera);
      back.set(tmp.x - ux * 0.05, tmp.y - uy * 0.05, tmp.z).project(camera);
      s.x = view.left + (a.x * 0.5 + 0.5) * view.w;
      s.y = view.top + (0.5 - a.y * 0.5) * view.h;
      const sx = s.x - (view.left + (back.x * 0.5 + 0.5) * view.w);
      const sy = s.y - (view.top + (0.5 - back.y * 0.5) * view.h);
      const sl = Math.hypot(sx, sy) || 1;
      s.ux = sx / sl;
      s.uy = sy / sl;
      const dist = Math.max(0.001, camera.position.z - tmp.z);
      s.size = Math.min(48, Math.max(2, (uniforms.uPx.value * HEAD_SIZE) / dist));
      if (lastPointer && !current.focused) setCatching(!blocked(lastPointer.target) && hit(lastPointer.x, lastPointer.y));
    },
    // ease to a stop in world space, then call back with the resting head
    pause(done) {
      if (!current) return;
      current.focused = true;
      const c = current;
      gsap.to(c.state, { hold: 1, duration: reduced.matches ? 0 : 0.4, ease: 'power2.out', overwrite: 'auto' });
      if (reduced.matches) {
        c.tween.timeScale(0);
        done?.();
        return;
      }
      gsap.to(c.tween, { timeScale: 0, duration: 0.15, ease: 'power2.out', overwrite: true, onComplete: () => done?.() });
    },
    // pick the trajectory back up from where it held, including what is left of its fade
    resume() {
      if (!current) return;
      const c = current;
      c.focused = false;
      gsap.to(c.state, { hold: 0, duration: reduced.matches ? 0 : 0.8, ease: 'power2.inOut', overwrite: 'auto' });
      if (reduced.matches) c.tween.timeScale(1);
      else gsap.to(c.tween, { timeScale: 1, duration: 0.6, ease: 'power2.in', overwrite: true });
    },
    headWorld() {
      return current ? current.start.clone().lerp(current.end, current.state.p) : null;
    },
    screen() {
      return current ? { x: current.screen.x, y: current.screen.y, size: current.screen.size } : null;
    },
    setPaused(on) {
      paused = on;
      if (on) {
        clearTimeout(timer);
        if (current && !current.focused) finish(false);
      } else if (!current) schedule();
    },
    // debug only: launch one now instead of waiting for the cadence
    fireNow() {
      if (current) return false;
      clearTimeout(timer);
      fire();
      return !!current;
    },
    debug() {
      if (!current) return null;
      const h = current.start.clone().lerp(current.end, current.state.p);
      return { index: current.index, url: current.pr.url, p: current.state.p, timeScale: current.tween.timeScale(), focused: current.focused, hold: current.state.hold, head: { x: h.x, y: h.y, z: h.z }, screen: { ...current.screen } };
    },
    dispose() {
      clearTimeout(timer);
      if (current?.tween) {
        gsap.killTweensOf([current.tween, current.state]);
        current.tween.kill();
      }
      setCatching(false);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('visibilitychange', onVisibility);
      scene.remove(group);
      headGeo.dispose();
      headMat.dispose();
      tail.geometry.dispose();
      tailMat.dispose();
    },
  };
}
