import * as THREE from 'three';
import { TEXTURE } from '../texture.js';
import { accentChannels } from '../accent.js';

// small on purpose: the field is low frequency and linear filtering keeps it smooth
const W = 128;
const H = 64;
const L = 0.72;

function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// smooth value noise summed over a few octaves, evaluated once on the cpu
function field(rand, cells, octaves = 4) {
  const layers = Array.from({ length: octaves }, (_, k) => {
    const c = cells * 2 ** k;
    return { c, g: Array.from({ length: (c + 1) * (c / 2 + 1) }, rand) };
  });
  const ease = (t) => t * t * (3 - 2 * t);
  return (u, v) => {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    for (const { c, g } of layers) {
      const cw = c + 1;
      const x = u * c;
      const y = v * (c / 2);
      const x0 = Math.floor(x);
      const y0 = Math.floor(y);
      const fx = ease(x - x0);
      const fy = ease(y - y0);
      const at = (i, j) => g[Math.min(j, c / 2) * cw + Math.min(i, c)];
      const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * fx;
      const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * fx;
      sum += (a + (b - a) * fy) * amp;
      norm += amp;
      amp *= 0.55;
    }
    return sum / norm;
  };
}

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// grayscale structure only: r density, g which of the two clouds, b glint. color is a uniform.
function paint() {
  const rand = mulberry32(20261006);
  const clouds = field(rand, 4);
  const filaments = field(rand, 8, 3);
  const mix = field(rand, 2);
  const glint = field(rand, 4);
  const data = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / (W - 1);
      const v = y / (H - 1);
      const d = smooth(0.33, 0.8, clouds(u, v)) ** 1.2 * (0.66 + 0.34 * smooth(0.3, 0.75, filaments(u, v)));
      const k = (y * W + x) * 4;
      data[k] = Math.round(d * 255);
      data[k + 1] = Math.round(smooth(0.28, 0.72, mix(u, v)) * 255);
      data[k + 2] = Math.round(smooth(0.6, 0.88, glint(u, v)) * 255);
      data[k + 3] = 255;
    }
  }
  return data;
}

const toLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function rgbToOklch(r, g, b) {
  const [lr, lg, lb] = [r, g, b].map((c) => toLin(c / 255));
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { c: Math.hypot(a, bb), h: Math.atan2(bb, a) };
}

function oklchToRgb(lightness, chroma, hue) {
  const a = chroma * Math.cos(hue);
  const b = chroma * Math.sin(hue);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((c) => toSrgb(Math.min(1, Math.max(0, c))));
}

const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const fragmentShader = /* glsl */ `
uniform sampler2D uTex;
uniform float uStrength;
uniform float uBlend;
uniform float uAspect;
uniform float uZoom;
uniform vec2 uOffset;
uniform vec3 uColA;
uniform vec3 uColB;
uniform vec3 uColG;
varying vec2 vUv;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  vec2 uv = (vUv - 0.5) * vec2(uAspect / 2.0, 1.0) * 0.9 / uZoom + 0.5 + uOffset;
  vec3 t = texture2D(uTex, uv).rgb;
  vec3 cloud = mix(uColA, uColB, t.g) * (1.0 - 0.28 * t.b) + uColG * (0.28 * t.b);
  vec3 c = t.r * cloud * uStrength * uBlend;
  // the field is faint enough to band on 8 bit screens, a half step of dither hides it
  c += (hash(gl_FragCoord.xy) - 0.5) / 255.0 * uBlend;
  gl_FragColor = vec4(max(c, 0.0), 1.0);
}
`;

// a full screen quad behind the stars plus a dom vignette, both driven by one blend value.
// one texture lookup per pixel, no noise math per frame, and recoloring is a uniform change.
export function createNebula() {
  const tex = new THREE.DataTexture(paint(), W, H, THREE.RGBAFormat);
  tex.wrapS = THREE.MirroredRepeatWrapping;
  tex.wrapT = THREE.MirroredRepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;

  const uniforms = {
    uTex: { value: tex },
    uStrength: { value: 0 },
    uBlend: { value: 0 },
    uAspect: { value: 1.6 },
    uZoom: { value: 1 },
    uOffset: { value: new THREE.Vector2() },
    uColA: { value: new THREE.Vector3() },
    uColB: { value: new THREE.Vector3() },
    uColG: { value: new THREE.Vector3() },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    depthTest: false,
    depthWrite: false,
    transparent: true,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;

  const vignette = document.createElement('div');
  vignette.className = 'vignette';
  vignette.setAttribute('aria-hidden', 'true');
  vignette.style.setProperty('--vignette', String(TEXTURE.vignette));
  vignette.style.opacity = '0';
  (document.querySelector('main') ?? document.body.firstChild).before(vignette);

  let lastKey = '';
  let lastOpacity = '';
  const colors = { a: null, b: null, g: null };

  // hues from the live accent: its own hue, one 40 degrees on, a faint complement. lightness is
  // matched and chroma kept low, and strength is normalized so the peak luminance never changes.
  function recolor({ r, g, b }) {
    const { c, h } = rgbToOklch(r, g, b);
    // dim light needs more chroma to read as a tint at all; a gray accent stays nearly gray
    const chroma = Math.min(0.12, Math.max(0.025, c * 0.8));
    const turn = Math.PI / 180;
    colors.a = oklchToRgb(L, chroma, h);
    colors.b = oklchToRgb(L, chroma, h + 40 * turn);
    colors.g = oklchToRgb(L, chroma * 1.1, h + 180 * turn);
    uniforms.uColA.value.fromArray(colors.a);
    uniforms.uColB.value.fromArray(colors.b);
    uniforms.uColG.value.fromArray(colors.g);
    uniforms.uStrength.value = TEXTURE.nebulaPeak / Math.max(lum(colors.a), lum(colors.b), 0.05);
  }

  return {
    mesh,
    update(time, cam, aspect, blend) {
      const a = accentChannels();
      const key = `${a.r.toFixed(1)},${a.g.toFixed(1)},${a.b.toFixed(1)}`;
      if (key !== lastKey) {
        lastKey = key;
        recolor(a);
      }
      uniforms.uBlend.value = blend;
      mesh.visible = blend > 0.001;
      uniforms.uAspect.value = aspect;
      uniforms.uZoom.value = 1 + Math.max(0, -cam.z) * TEXTURE.nebulaParallax;
      uniforms.uOffset.value.set(time * TEXTURE.nebulaDrift + cam.x * 0.004, time * TEXTURE.nebulaDrift * 0.4 + cam.y * 0.004);
      const opacity = blend.toFixed(3);
      if (opacity !== lastOpacity) {
        lastOpacity = opacity;
        vignette.style.opacity = opacity;
      }
    },
    colors: () => ({ ...colors, strength: uniforms.uStrength.value }),
    dispose() {
      mesh.geometry.dispose();
      material.dispose();
      tex.dispose();
      vignette.remove();
    },
  };
}
