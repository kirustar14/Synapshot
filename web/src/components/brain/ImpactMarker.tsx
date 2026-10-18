// The impact site. A pulsing ring tangent to the surface at shape.impact.point, plus the ring
// the injury replay expands across the cortex.

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type RefObject } from "react";
import * as THREE from "three";

interface Props {
  point: [number, number, number];
  radius: number;
  motion: boolean;
  /** Replay wave radius in mm, or a negative number when the replay is not running. */
  wave: RefObject<number>;
}

export function ImpactMarker({ point, radius, motion, wave }: Props) {
  const inner = useRef<THREE.Group>(null);
  const halo = useRef<THREE.Mesh>(null);

  const quaternion = useMemo(() => {
    const out = new THREE.Vector3(...point);
    if (out.lengthSq() < 1e-6) out.set(0, 0, 1);
    out.normalize();
    return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), out);
  }, [point]);

  const ring = useMemo(() => new THREE.RingGeometry(radius * 0.32, radius * 0.4, 48), [radius]);
  const disc = useMemo(() => new THREE.CircleGeometry(radius * 0.3, 40), [radius]);
  const waveRing = useMemo(() => new THREE.RingGeometry(0.94, 1, 64), []);

  useEffect(
    () => () => {
      ring.dispose();
      disc.dispose();
      waveRing.dispose();
    },
    [ring, disc, waveRing],
  );

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (inner.current) {
      const beat = motion ? 1 + 0.16 * Math.sin(t * 2.6) : 1;
      inner.current.scale.setScalar(beat);
    }
    const w = wave.current ?? -1;
    if (halo.current) {
      const on = w > 0;
      halo.current.visible = on;
      if (on) {
        halo.current.scale.setScalar(Math.max(0.01, w));
        const mat = halo.current.material as THREE.MeshBasicMaterial;
        mat.opacity = Math.max(0, 0.75 - w / 190);
      }
    }
  });

  return (
    <group position={point} quaternion={quaternion} renderOrder={14}>
      <group ref={inner}>
        <mesh geometry={ring}>
          <meshBasicMaterial color="#ff8a3d" transparent opacity={0.9} blending={THREE.AdditiveBlending} depthWrite={false} depthTest={false} side={THREE.DoubleSide} />
        </mesh>
        <mesh geometry={disc}>
          <meshBasicMaterial color="#ffb37a" transparent opacity={0.22} blending={THREE.AdditiveBlending} depthWrite={false} depthTest={false} side={THREE.DoubleSide} />
        </mesh>
      </group>
      <mesh ref={halo} geometry={waveRing} visible={false}>
        <meshBasicMaterial color="#ffd0a0" transparent opacity={0.5} blending={THREE.AdditiveBlending} depthWrite={false} depthTest={false} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}
