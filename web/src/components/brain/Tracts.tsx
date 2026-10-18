// Tract tubes and the particles drifting along them. Two draw calls for the whole bundle:
// every tube is merged into one geometry and every particle rides a Bezier evaluated on the
// GPU, so changing the week only rewrites a 256 by 1 texture.

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { ThreeEvent } from "@react-three/fiber";
import { buildTracts } from "./geometry";
import { PARTICLE_FRAG, PARTICLE_VERT, TRACT_FRAG, TRACT_VERT } from "./shaders";
import type { TractInfo } from "./regionData";
import type { Uniforms } from "./uniforms";

interface Props {
  tracts: TractInfo[];
  points: Float32Array;
  uniforms: Uniforms;
  particles: boolean;
  onPick: (edgeIndex: number | null) => void;
}

const RADIAL = 4;
const ALONG = 18;

export function Tracts({ tracts, points, uniforms, particles, onPick }: Props) {
  const build = useMemo(() => buildTracts(tracts, points), [tracts, points]);
  const lastCast = useRef(0);

  const tube = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms,
        vertexShader: TRACT_VERT,
        fragmentShader: TRACT_FRAG,
        transparent: true,
        depthWrite: false,
        // Tracts run under the cortex, so they draw on top of it at low alpha rather than
        // being depth tested away by a surface they are meant to be seen through.
        // Depth tested, so the cortex in front of a tract hides it. With this off the
        // two hundred tubes painted over the surface unconditionally, and once the
        // cortex became slightly translucent they read as a khaki veil draped across
        // the brain with pale streaks through it. They are still shown through where
        // the cortex is genuinely transparent; they are no longer drawn through solid
        // tissue.
        depthTest: true,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    [uniforms],
  );

  const dust = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms,
        vertexShader: PARTICLE_VERT,
        fragmentShader: PARTICLE_FRAG,
        transparent: true,
        depthWrite: false,
        // Tracts run under the cortex, so they draw on top of it at low alpha rather than
        // being depth tested away by a surface they are meant to be seen through.
        // Depth tested, so the cortex in front of a tract hides it. With this off the
        // two hundred tubes painted over the surface unconditionally, and once the
        // cortex became slightly translucent they read as a khaki veil draped across
        // the brain with pale streaks through it. They are still shown through where
        // the cortex is genuinely transparent; they are no longer drawn through solid
        // tissue.
        depthTest: true,
        blending: THREE.AdditiveBlending,
      }),
    [uniforms],
  );

  useEffect(
    () => () => {
      build.tubes.dispose();
      build.particles.dispose();
    },
    [build],
  );

  useEffect(
    () => () => {
      tube.dispose();
      dust.dispose();
    },
    [tube, dust],
  );

  /** Vertex index back to the edge index, through the slot the builder handed out. */
  const edgeAt = (face: THREE.Face | null | undefined): number | null => {
    if (!face) return null;
    const perTract = (ALONG + 1) * RADIAL;
    const slot = Math.floor(face.a / perTract);
    const info = tracts[slot];
    return info ? info.index : null;
  };

  return (
    <>
      <mesh
        geometry={build.tubes}
        material={tube}
        renderOrder={12}
        raycast={function castThrottled(this: THREE.Mesh, raycaster: THREE.Raycaster, hits: THREE.Intersection[]) {
          const now = typeof performance === "undefined" ? 0 : performance.now();
          if (now - lastCast.current < 110) return;
          lastCast.current = now;
          THREE.Mesh.prototype.raycast.call(this, raycaster, hits);
        }}
        onClick={(e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation();
          onPick(edgeAt(e.face));
        }}
      />
      {particles && (
        <points geometry={build.particles} material={dust} renderOrder={13} frustumCulled={false} />
      )}
    </>
  );
}
