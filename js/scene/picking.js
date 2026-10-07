import * as THREE from 'three';
import { coreSize, blurSize, PICK_COC } from './optics.js';

// screen space projection of star positions, mirroring what the vertex shader does.
// coordinates are local to the canvas; callers add the canvas offset.
export function createPicker(layout) {
  const view = new THREE.Matrix4();
  const clip = new THREE.Matrix4();
  const out = { x: 0, y: 0, dist: 0 };

  function prepare(camera, object) {
    view.multiplyMatrices(camera.matrixWorldInverse, object.matrixWorld);
    clip.multiplyMatrices(camera.projectionMatrix, view);
  }

  function project(i, w, h) {
    const p = layout.positions;
    const x = p[i * 3];
    const y = p[i * 3 + 1];
    const z = p[i * 3 + 2];
    const v = view.elements;
    const e = clip.elements;
    const cw = e[3] * x + e[7] * y + e[11] * z + e[15];
    out.dist = -(v[2] * x + v[6] * y + v[10] * z + v[14]);
    out.x = ((e[0] * x + e[4] * y + e[8] * z + e[12]) / cw * 0.5 + 0.5) * w;
    out.y = (0.5 - (e[1] * x + e[5] * y + e[9] * z + e[13]) / cw * 0.5) * h;
    return out;
  }

  // the rendered disc of star i at a given distance, the same numbers the shader uses
  function disc(i, dist, focal, px, langs, focus = -1) {
    const l = langs[layout.langs[i]];
    const lo = i === focus ? 0 : l.lo;
    const core = coreSize(px, layout.sizes[i], dist);
    const coc = blurSize(dist, focal, l.hi, lo);
    return { core, coc, size: core + coc, lo };
  }

  // a star is pickable while its rendered blur still reads as a star. the click radius grows
  // with the displayed disc, and the score favors proximity first and sharpness second.
  function nearest(px, py, w, h, { focal, px: scale, langs, exclude = -1 }) {
    let best = -1;
    let bestScore = Infinity;
    for (let i = 0; i < layout.n; i++) {
      if (i === exclude) continue;
      const s = project(i, w, h);
      if (s.dist < 0.8) continue;
      const d = disc(i, s.dist, focal, scale, langs);
      if (d.lo > 0.5 || d.coc >= PICK_COC) continue;
      const radius = Math.max(14, d.size / 2 + 8);
      const gap = Math.hypot(s.x - px, s.y - py);
      if (gap > radius) continue;
      const score = gap / radius + 0.8 * (d.coc / PICK_COC);
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    }
    return best;
  }

  return { prepare, project, disc, nearest };
}
