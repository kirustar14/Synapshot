// The vessel layer: dural sinuses, deep veins, named cortical veins and the arteries.
//
// Each vessel is a tube swept along its polyline, with its own calibre. They are merged
// into one geometry per group so the whole venous system is four draw calls, and the
// groups are separate because the arteries are off by default: in a head injury the
// venous side is what usually matters, and both at once is a thicket.
//
// Drawn opaque with depth testing on, unlike the tracts. A vessel is a surface structure
// that sits outside or on the cortex, so occluding it correctly is the point; the tracts
// run underneath and are deliberately shown through.
//
// This is a diagram. The caption says so wherever the layer appears, because a rendered
// vessel next to a rendered brain is exactly the thing that gets mistaken for an
// angiogram. Nothing here is this patient's anatomy.

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { Vessel } from "@/api/client";

/** Microhaemorrhage foci read off the SWI report. */
export interface Focus {
  /** MNI millimetres. */
  at: [number, number, number];
  /** Diameter in mm, as the report measured it. */
  mm: number;
}

const RADIAL = 6;

/** One tube along a polyline, as a geometry ready to merge. */
function tubeOf(points: number[][], radius: number): THREE.BufferGeometry | null {
  if (points.length < 2) return null;
  const curve = new THREE.CatmullRomCurve3(
    points.map((p) => new THREE.Vector3(p[0], p[1], p[2])),
    false,
    "catmullrom",
    0.4,
  );
  // Segments scale with how long the vessel is, so a short sinus does not get the same
  // 64 segments as one that runs the length of the falx.
  const segments = Math.max(12, Math.min(96, Math.round(curve.getLength() / 3)));
  return new THREE.TubeGeometry(curve, segments, Math.max(0.4, radius), RADIAL, false);
}

/** Every vessel in one group, merged into a single geometry. */
function mergeGroup(vessels: Vessel[]): THREE.BufferGeometry | null {
  const parts: THREE.BufferGeometry[] = [];
  for (const v of vessels) {
    const got = tubeOf(v.points, v.radius_mm);
    if (got) parts.push(got);
  }
  if (!parts.length) return null;

  // Merge by hand rather than pulling in BufferGeometryUtils: every part has the same
  // attributes in the same order, so this is a concatenation with an index offset.
  let verts = 0;
  let indices = 0;
  for (const g of parts) {
    verts += g.getAttribute("position").count;
    indices += g.getIndex()?.count ?? 0;
  }
  const position = new Float32Array(verts * 3);
  const normal = new Float32Array(verts * 3);
  const index = new Uint32Array(indices);

  let vo = 0;
  let io = 0;
  for (const g of parts) {
    const p = g.getAttribute("position") as THREE.BufferAttribute;
    const n = g.getAttribute("normal") as THREE.BufferAttribute;
    const idx = g.getIndex();
    position.set(p.array as Float32Array, vo * 3);
    normal.set(n.array as Float32Array, vo * 3);
    if (idx) {
      for (let i = 0; i < idx.count; i++) index[io + i] = (idx.array as ArrayLike<number>)[i] + vo;
      io += idx.count;
    }
    vo += p.count;
    g.dispose();
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(position, 3));
  out.setAttribute("normal", new THREE.BufferAttribute(normal, 3));
  out.setIndex(new THREE.BufferAttribute(index, 1));
  return out;
}

export function Vessels({
  vessels,
  groups,
  arteries,
  foci,
  showFoci,
}: {
  vessels: Vessel[];
  groups: Record<string, { label: string; colour: string; about: string }>;
  arteries: boolean;
  foci: Focus[];
  showFoci: boolean;
}) {
  const built = useMemo(() => {
    const byGroup = new Map<string, Vessel[]>();
    for (const v of vessels) {
      if (v.group === "artery" && !arteries) continue;
      byGroup.set(v.group, [...(byGroup.get(v.group) ?? []), v]);
    }
    return [...byGroup.entries()]
      .map(([key, list]) => ({
        key,
        colour: groups[key]?.colour ?? "#60a5fa",
        geometry: mergeGroup(list),
      }))
      .filter((g): g is { key: string; colour: string; geometry: THREE.BufferGeometry } => g.geometry !== null);
  }, [vessels, groups, arteries]);

  useEffect(() => () => built.forEach((g) => g.geometry.dispose()), [built]);

  return (
    <group>
      {built.map((g) => (
        <mesh key={g.key} geometry={g.geometry} renderOrder={2}>
          <meshStandardMaterial
            color={g.colour}
            // Arteries are flatter and veins catch a little light, which is roughly how
            // they look on a cast and makes the two readable apart in a still.
            roughness={g.key === "artery" ? 0.75 : 0.35}
            metalness={0.08}
            emissive={g.colour}
            emissiveIntensity={g.key === "artery" ? 0.12 : 0.22}
            transparent
            opacity={0.92}
          />
        </mesh>
      ))}

      {/* SWI microhaemorrhage foci. Red-orange nodes, sized by what the report measured,
          with a soft halo so a 2 mm focus is findable without being drawn bigger than it
          is. These are the only patient-specific thing in this layer. */}
      {showFoci &&
        foci.map((f, i) => (
          <group key={i} position={f.at}>
            <mesh renderOrder={3}>
              <sphereGeometry args={[Math.max(1.2, f.mm / 2), 16, 12]} />
              <meshStandardMaterial
                color="#f97316"
                emissive="#ef4444"
                emissiveIntensity={0.9}
                roughness={0.4}
              />
            </mesh>
            <mesh renderOrder={2}>
              <sphereGeometry args={[Math.max(1.2, f.mm / 2) * 2.6, 12, 10]} />
              <meshBasicMaterial color="#f97316" transparent opacity={0.13} depthWrite={false} />
            </mesh>
          </group>
        ))}
    </group>
  );
}
