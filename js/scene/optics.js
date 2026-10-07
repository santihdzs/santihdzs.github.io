// shared star optics. the vertex shader and the picker are both built from these numbers,
// so what reads as a star on screen and what can be clicked cannot drift apart.
export const SPRITE = 4;
export const APERTURE = 22;
export const BEHIND = 0.5;
export const COC_MAX = 46;
export const LO_BLUR = 18;
export const CORE_MIN = 2;
export const CORE_FAR = 18;
export const CORE_NEAR = 48;
export const NEAR_FROM = 1.8;
export const NEAR_TO = 6;

// a star whose rendered blur stays under this still reads as a star, past it it is haze
export const PICK_COC = 26;

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// disc core diameter in css px; the clamp opens up as a star gets close to the camera
export function coreSize(px, size, dist) {
  const max = CORE_NEAR + (CORE_FAR - CORE_NEAR) * smooth(NEAR_FROM, NEAR_TO, dist);
  return Math.min(max, Math.max(CORE_MIN, (px * size) / Math.max(dist, 0.001)));
}

// circle of confusion in css px, including the language filter's sharpen and blur
export function blurSize(dist, focal, hi = 0, lo = 0) {
  const d = Math.max(dist, 0.001);
  const a = d < focal ? APERTURE : APERTURE * BEHIND;
  const c = Math.min((a * Math.abs(d - focal)) / d, COC_MAX);
  return c * (1 - 0.85 * hi) + lo * LO_BLUR;
}

const f = (n) => (Number.isInteger(n) ? `${n}.0` : String(n));

export const GLSL = /* glsl */ `
#define SPRITE ${f(SPRITE)}
float starCore(float px, float size, float dist) {
  float coreMax = mix(${f(CORE_NEAR)}, ${f(CORE_FAR)}, smoothstep(${f(NEAR_FROM)}, ${f(NEAR_TO)}, dist));
  return clamp(px * size / dist, ${f(CORE_MIN)}, coreMax);
}
float starBlur(float dist, float focal, float hi, float lo) {
  float a = dist < focal ? ${f(APERTURE)} : ${f(APERTURE * BEHIND)};
  float c = min(a * abs(dist - focal) / dist, ${f(COC_MAX)});
  return c * (1.0 - 0.85 * hi) + lo * ${f(LO_BLUR)};
}
`;
