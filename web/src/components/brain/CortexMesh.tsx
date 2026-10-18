// The cortex itself. Two meshes over one BufferGeometry, back faces first at low alpha so you
// can see depth through the brain, then front faces. Both share one uniforms object, so the
// back pass is a define rather than a second set of state.

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { ThreeEvent } from "@react-three/fiber";
import { CORTEX_FRAG, CORTEX_VERT } from "./shaders";
import type { Uniforms } from "./uniforms";

interface Props {
  geometry: THREE.BufferGeometry;
  uniforms: Uniforms;
  hologram: boolean;
  labels: number[];
  onHover: (id: number | null) => void;
  onPick: (id: number | null) => void;
}

function makeMaterial(uniforms: Uniforms, back: boolean): THREE.ShaderMaterial {
  // The back pass is the same shader at a fraction of the brightness, so the depth you see
  // through the cortex never competes with the front surface.
  const frag = CORTEX_FRAG;
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: CORTEX_VERT,
    fragmentShader: frag,
    defines: back ? { BACK_PASS: "" } : {},
    side: back ? THREE.BackSide : THREE.FrontSide,
    transparent: !back,
    // Depth writes are on for a reason. A folded cortex crosses a view ray a dozen times, and
    // with additive blending every one of those sheets would stack into a white blob. Writing
    // depth keeps it to the nearest back face and the nearest front face, which is the depth
    // cue we actually wanted.
    depthWrite: true,
    depthTest: true,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
  });
}

/** Switches a material between the hologram look and flat anatomical shading. */
function applyLook(mat: THREE.ShaderMaterial, hologram: boolean) {
  // Opaque in both looks now. The hologram look keeps its glow in the shader but no longer
  // blends additively, so the cortex reads as a solid surface instead of a see-through one.
  void hologram;
  mat.blending = THREE.NormalBlending;
  mat.needsUpdate = true;
}

export function CortexMesh({ geometry, uniforms, hologram, labels, onHover, onPick }: Props) {
  const front = useMemo(() => makeMaterial(uniforms, false), [uniforms]);
  const back = useMemo(() => makeMaterial(uniforms, true), [uniforms]);
  const hovered = useRef<number | null>(null);

  useEffect(() => {
    applyLook(front, hologram);
    applyLook(back, hologram);
  }, [front, back, hologram]);

  useEffect(
    () => () => {
      front.dispose();
      back.dispose();
    },
    [front, back],
  );

  const regionAt = (face: THREE.Face | null | undefined): number | null => {
    const vertex = face?.a;
    if (vertex === undefined) return null;
    const label = labels[vertex];
    return label === undefined || label < 0 ? null : label;
  };

  const move = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    const id = regionAt(e.face);
    if (id === hovered.current) return;
    hovered.current = id;
    onHover(id);
  };

  const leave = () => {
    if (hovered.current === null) return;
    hovered.current = null;
    onHover(null);
  };

  return (
    <>
      
      <mesh geometry={geometry} material={back} renderOrder={1} />
      <mesh
        geometry={geometry}
        material={front}
        renderOrder={2}
        onPointerMove={move}
        onPointerOut={leave}
        onClick={(e) => {
          e.stopPropagation();
          onPick(regionAt(e.face) ?? hovered.current);
        }}
      />
    </>
  );
}
