// background texture for stars mode: a nebula drawn in the scene and a vignette, both faded by
// one blend value. text mode has no texture at all. ?texture=none turns it off for debugging.
export const TEXTURE = {
  nebulaPeak: 0.047,
  nebulaDrift: 0.0012,
  nebulaParallax: 0.0035,
  vignette: 0.32,
};

export function textureMode() {
  return new URLSearchParams(window.location.search).get('texture') === 'none' ? 'none' : 'nebula';
}

export const wantsNebula = (mode) => mode === 'nebula';
