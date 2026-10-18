// The transmitter pathways: serotonin, dopamine, noradrenaline, acetylcholine, histamine.
//
// Each one is a tube swept along a hand placed centreline that starts at its source
// nucleus and ends in the territory it projects to. They are drawn for whichever
// medicines are lit in the Treatment tab, one colour per transmitter system, and one can
// be flashed by clicking its name in a medicine's dropdown.
//
// Same build as Vessels, and for the same reason: a tube along a polyline, merged per
// group so the whole system is one draw call. Drawn under the cortex rather than on it,
// because these run through the middle of the brain rather than over the surface.
//
// This is a diagram. The centrelines are textbook neuroanatomy, not tractography, and not
// this patient's. The caption says so wherever the layer appears, because a rendered tube
// next to a rendered brain is the exact thing that gets mistaken for a measurement.

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { PathwayLine } from "@/api/client";

const RADIAL = 6;

/** One tube along a centreline. */
function tubeOf(points: number[][], radius: number): THREE.BufferGeometry | null {
  if (points.length < 2) return null;
  const curve = new THREE.CatmullRomCurve3(
    points.map((p) => new THREE.Vector3(p[0], p[1], p[2])),
    false,
    "catmullrom",
    0.4,
  );
  const segments = Math.max(12, Math.min(96, Math.round(curve.getLength() / 3)));
  return new THREE.TubeGeometry(curve, segments, Math.max(0.6, radius), RADIAL, false);
}

/** Every pathway of one transmitter system, in that system's colour. */
function Group({
  lines,
  color,
  flashed,
}: {
  lines: PathwayLine[];
  color: string;
  flashed: string;
}) {
  const ref = useRef<THREE.Mesh>(null);
  const mat = useRef<THREE.MeshStandardMaterial>(null);
  const hit = lines.some((l) => l.key === flashed);
  const since = useRef(0);

  const geometry = useMemo(() => {
    const parts = lines.map((l) => tubeOf(l.points, l.radius_mm)).filter(Boolean);
    if (!parts.length) return null;
    // Merged by hand rather than through BufferGeometryUtils, which is not imported
    // anywhere else here and would be a dependency for one call.
    const merged = new THREE.BufferGeometry();
    const pos: number[] = [];
    const norm: number[] = [];
    for (const part of parts as THREE.BufferGeometry[]) {
      const p = part.getAttribute("position");
      const n = part.getAttribute("normal");
      const idx = part.getIndex();
      const order = idx ? Array.from(idx.array) : p.array.map((_, i) => i);
      for (const i of order) {
        pos.push(p.getX(i), p.getY(i), p.getZ(i));
        norm.push(n.getX(i), n.getY(i), n.getZ(i));
      }
      part.dispose();
    }
    merged.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    merged.setAttribute("normal", new THREE.Float32BufferAttribute(norm, 3));
    return merged;
  }, [lines]);

  // Restart the flash whenever this group becomes the flashed one.
  useEffect(() => {
    if (hit) since.current = 0;
  }, [hit, flashed]);

  useFrame((_, dt) => {
    if (!mat.current) return;
    if (!hit) {
      mat.current.emissiveIntensity = 0.35;
      return;
    }
    since.current += dt;
    // One pulse over about a second and a half, then back to the resting brightness.
    const t = Math.min(1, since.current / 1.5);
    mat.current.emissiveIntensity = 0.35 + 1.6 * Math.sin(Math.PI * t) * (1 - t * 0.4);
  });

  useEffect(() => () => geometry?.dispose(), [geometry]);
  if (!geometry) return null;

  return (
    <mesh ref={ref} geometry={geometry} renderOrder={2}>
      <meshStandardMaterial
        ref={mat}
        color={color}
        emissive={color}
        emissiveIntensity={0.35}
        roughness={0.45}
        metalness={0.05}
        transparent
        opacity={0.92}
      />
    </mesh>
  );
}

export function Pathways({
  lines,
  groups,
  show,
  flashed,
}: {
  lines: PathwayLine[];
  groups: { key: string; label: string; color: string }[];
  /** Transmitter systems to draw, by group key. */
  show: string[];
  flashed: string;
}) {
  const byGroup = useMemo(() => {
    const out = new Map<string, PathwayLine[]>();
    for (const line of lines) {
      if (!show.includes(line.group)) continue;
      const got = out.get(line.group) ?? [];
      got.push(line);
      out.set(line.group, got);
    }
    return out;
  }, [lines, show]);

  if (byGroup.size === 0) return null;

  return (
    <>
      {[...byGroup.entries()].map(([key, rows]) => (
        <Group
          key={key}
          lines={rows}
          color={groups.find((g) => g.key === key)?.color ?? "#888888"}
          flashed={flashed}
        />
      ))}
    </>
  );
}
