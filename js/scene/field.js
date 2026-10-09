import * as THREE from 'three';
import { vertexShader, fragmentShader, MAX_LANGS } from './shaders.js';

// a single points object, one draw call
export function createField(layout) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(layout.positions, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(layout.sizes, 1));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(layout.colors, 3));
  geometry.setAttribute('aLang', new THREE.BufferAttribute(layout.langs, 1));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(layout.seeds, 1));

  const uniforms = {
    uTime: { value: 0 },
    uTwinkle: { value: 0.12 },
    uIntensity: { value: 0 },
    uFocal: { value: 15 },
    uPx: { value: 800 },
    uDpr: { value: 1 },
    uMaxPoint: { value: 256 },
    uHi: { value: new Float32Array(MAX_LANGS) },
    uLo: { value: new Float32Array(MAX_LANGS) },
    uLight: { value: new THREE.Vector2() },
    uFocusId: { value: -1 },
    uDim: { value: 0 },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;

  return {
    points,
    uniforms,
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
