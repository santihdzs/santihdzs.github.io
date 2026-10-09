import { GLSL as OPTICS, SPRITE } from './optics.js';
import { MAX_LANGS } from './data.js';

export { MAX_LANGS };

// shared lit sphere shading: sharp stars and the pull request heads use the same light
export const SPHERE = /* glsl */ `
vec3 litSphere(vec2 q, vec3 color, vec2 light) {
  float q2 = dot(q, q);
  vec3 n = vec3(q.x, -q.y, sqrt(max(0.0, 1.0 - q2)));
  vec3 l = normalize(vec3(-0.55 + light.x, 0.6 + light.y, 0.62));
  float diffuse = max(dot(n, l), 0.0);
  float spec = pow(max(dot(reflect(-l, n), vec3(0.0, 0.0, 1.0)), 0.0), 22.0);
  float rim = pow(1.0 - n.z, 2.4);
  return color * (0.42 + 0.66 * diffuse) + vec3(0.38 * spec) + color * rim * 0.32;
}
`;

export const vertexShader = /* glsl */ `
${OPTICS}
attribute float aSize;
attribute vec3 aColor;
attribute float aLang;
attribute float aSeed;

uniform float uTime;
uniform float uTwinkle;
uniform float uIntensity;
uniform float uFocal;
uniform float uPx;
uniform float uDpr;
uniform float uMaxPoint;
uniform float uHi[${MAX_LANGS}];
uniform float uLo[${MAX_LANGS}];
uniform float uFocusId;

varying vec3 vColor;
varying float vAlpha;
varying float vBlur;
varying float vCore;

void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float dist = max(-mv.z, 0.001);
  int li = int(aLang + 0.5);
  float hi = uHi[li];
  float lo = uLo[li];
  // the star behind an open card always renders, whatever the language filter says
  if (abs(float(gl_VertexID) - uFocusId) < 0.5) lo = 0.0;

  float core = starCore(uPx, aSize, dist);
  float coc = starBlur(dist, uFocal, hi, lo);
  float size = core + coc;

  // blurred stars spread their light over a larger disc, but keep enough of it to read as haze
  float alpha = mix(0.17, 1.0, pow(core / size, 1.2));
  alpha *= 1.0 + uTwinkle * sin(uTime * (0.25 + aSeed * 0.45) + aSeed * 6.2831);
  alpha *= mix(1.0, 0.1, lo) * (1.0 + 0.8 * hi);
  alpha *= smoothstep(0.5, 2.2, dist);
  alpha *= mix(1.0, 0.35, smoothstep(uFocal + 10.0, uFocal + 38.0, dist));
  alpha *= uIntensity;

  vColor = aColor;
  vAlpha = alpha;
  vBlur = coc / size;
  vCore = core;
  gl_PointSize = min(size * SPRITE * uDpr, uMaxPoint);
  gl_Position = projectionMatrix * mv;
}
`;

export const fragmentShader = /* glsl */ `
#define SPRITE ${SPRITE.toFixed(1)}
${SPHERE}
uniform vec2 uLight;

varying vec3 vColor;
varying float vAlpha;
varying float vBlur;
varying float vCore;

void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(c, c);
  if (r2 > 1.0) discard;
  float r = sqrt(r2);

  // the disc fills 1 / SPRITE of the sprite, the rest is halo
  const float rd = 1.0 / SPRITE;
  float soft = mix(0.05, rd, vBlur);
  float disc = 1.0 - smoothstep(rd - soft, rd + soft * 0.4, r);
  float halo = exp(-r2 * 4.2) * mix(0.34, 0.16, vBlur);
  float hot = (1.0 - smoothstep(0.0, rd * 0.55, r)) * (1.0 - vBlur);
  vec3 col = mix(vColor, vec3(1.0), hot * 0.55);

  // sharp, large stars shade as small lit spheres; as blur rises this fades back to the flat glow
  float shade = (1.0 - smoothstep(0.03, 0.3, vBlur)) * smoothstep(9.0, 22.0, vCore);
  if (shade > 0.001) {
    vec2 q = c / rd;
    float inDisc = 1.0 - smoothstep(0.92, 1.0, dot(q, q));
    col = mix(col, litSphere(q, vColor, uLight), shade * inDisc);
  }

  gl_FragColor = vec4(col, (disc * 0.9 + halo) * vAlpha);
}
`;
