// Floating labels with leader lines for the regions the active layer lights most, plus one for
// whatever is hovered or selected. The text is the plain language name, never a bare parcel id.

import { Html, Line } from "@react-three/drei";
import { useMemo } from "react";
import * as THREE from "three";
import type { Mesh, Twin } from "@/api/types";
import { LAYER_BY_ID, rampColor, type LayerId } from "./layers";
import { regionLabel, type LayerValues, type Ranked } from "./regionData";

interface Props {
  mesh: Mesh | undefined;
  twin: Twin | undefined;
  points: Float32Array;
  ranked: Ranked[];
  values: LayerValues;
  layer: LayerId;
  hovered: number | null;
  selected: number | null;
  onPick: (id: number | null) => void;
}

/** Pushes a centroid outward along its own direction so the card clears the surface. */
function anchor(points: Float32Array, id: number, lift: number): [number, number, number] {
  const v = new THREE.Vector3(points[id * 3], points[id * 3 + 1], points[id * 3 + 2]);
  const out = v.clone();
  if (out.lengthSq() < 1e-6) out.set(0, 0, 1);
  out.normalize().multiplyScalar(lift);
  return [v.x + out.x, v.y + out.y, v.z + out.z];
}

export function Callouts({ mesh, twin, points, ranked, values, layer, hovered, selected, onPick }: Props) {
  const def = LAYER_BY_ID[layer];
  const shown = useMemo(() => {
    const ids = ranked.map((r) => r.id);
    for (const extra of [selected, hovered]) {
      if (extra !== null && extra !== undefined && !ids.includes(extra)) ids.push(extra);
    }
    return ids.map((id) => ({
      id,
      label: regionLabel(mesh, twin, id),
      from: [points[id * 3], points[id * 3 + 1], points[id * 3 + 2]] as [number, number, number],
      to: anchor(points, id, 34),
    }));
  }, [ranked, selected, hovered, mesh, twin, points]);

  return (
    <>
      {shown.map((c) => {
        const on = c.id === selected || c.id === hovered;
        const color = rampColor(def.stops, values.pos[c.id]);
        return (
          <group key={c.id}>
            <Line
              points={[c.from, c.to]}
              color={on ? "#eaf8ff" : "#5fd3e0"}
              lineWidth={on ? 1.8 : 1}
              transparent
              opacity={on ? 0.95 : 0.45}
              depthWrite={false}
              depthTest={false}
              renderOrder={15}
            />
            <Html position={c.to} center zIndexRange={[12, 2]} pointerEvents="auto">
              <button
                type="button"
                onClick={() => onPick(c.id === selected ? null : c.id)}
                className={`pointer-events-auto whitespace-nowrap rounded-full border px-2 py-1 text-[10px] font-bold backdrop-blur-sm transition-colors ${
                  on
                    ? "border-white/70 bg-black/80 text-white"
                    : "border-cyan-200/35 bg-black/60 text-cyan-50 hover:border-white/60"
                }`}
              >
                <span className="mr-1 inline-block h-2 w-2 rounded-full align-middle" style={{ background: color }} aria-hidden />
                {c.label.plain}
                <span className="ml-1 font-mono opacity-75">{values.format(values.raw[c.id])}</span>
              </button>
            </Html>
          </group>
        );
      })}
    </>
  );
}
