// The uniform objects. One per viewer instance, created once and mutated by the frame driver,
// so no React render ever touches a uniform.

import * as THREE from "three";

export type Uniforms = Record<string, THREE.IUniform>;

export interface ViewerTextures {
  vals: THREE.DataTexture;
  vals0: THREE.DataTexture;
  thick: THREE.DataTexture;
  tracts: THREE.DataTexture;
}

/** Cool cyan, the default hologram rim. */
export const RIM = new THREE.Color(0.32, 0.86, 0.95);

/** Everything the cortex shader reads. */
export function cortexUniforms(tex: ViewerTextures): Uniforms {
  return {
    uTime: { value: 0 },
    uInflate: { value: 0 },
    uAtrophy: { value: 0 },
    uPersonal: { value: 1 },
    uBump: { value: 0 },
    uRadius: { value: 25 },
    uScale: { value: new THREE.Vector3(1, 1, 1) },
    uHemi: { value: 0 },
    uSplit: { value: 0 },
    uThickGain: { value: 1 },
    uThick: { value: tex.thick },
    uVals: { value: tex.vals },
    uVals0: { value: tex.vals0 },
    uGlow: { value: 0.85 },
    uHolo: { value: 1 },
    uAlpha: { value: 0.22 },
    uMotion: { value: 1 },
    uWave: { value: -50 },
    uWaveOn: { value: 0 },
    uBorderOn: { value: 1 },
    uGhostOn: { value: 1 },
    uScanY: { value: 0 },
    uScanOn: { value: 1 },
    uDim: { value: 1 },
    uSulcLo: { value: 0 },
    uSulcHi: { value: 20 },
    uRim: { value: RIM.clone() },
    uLayer: { value: 0 },
  };
}

/** Everything the tract tube and particle shaders read. */
export function tractUniforms(tex: ViewerTextures): Uniforms {
  return {
    uTime: { value: 0 },
    uMotion: { value: 1 },
    uTracts: { value: tex.tracts },
    uWidth: { value: 0.9 },
    uFade: { value: 1 },
    uSize: { value: 2.6 },
  };
}
