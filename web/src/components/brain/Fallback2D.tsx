// What you get instead of a black rectangle when WebGL or float textures are missing. One dot
// per region at its real centroid, projected sagittally, coloured by the active layer.

import { AlertTriangle } from "lucide-react";
import { useMemo } from "react";
import type { Mesh, Twin } from "@/api/types";
import { LAYER_BY_ID, rampColor, type LayerId } from "./layers";
import { REGIONS, regionLabel, regionPoints, type LayerValues } from "./regionData";

interface Props {
  mesh: Mesh | undefined;
  twin: Twin | undefined;
  layer: LayerId;
  values: LayerValues;
  reason: string;
  selected: number | null;
  onSelect: (id: number | null) => void;
}

const W = 520;
const H = 300;

export function Fallback2D({ mesh, twin, layer, values, reason, selected, onSelect }: Props) {
  const def = LAYER_BY_ID[layer];
  const dots = useMemo(() => {
    const xyz = regionPoints(mesh, twin);
    if (!xyz) return [];
    let minY = Infinity;
    let maxY = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < REGIONS; i++) {
      minY = Math.min(minY, xyz[i * 3 + 1]);
      maxY = Math.max(maxY, xyz[i * 3 + 1]);
      minZ = Math.min(minZ, xyz[i * 3 + 2]);
      maxZ = Math.max(maxZ, xyz[i * 3 + 2]);
    }
    const spanY = maxY - minY || 1;
    const spanZ = maxZ - minZ || 1;
    return Array.from({ length: REGIONS }, (_, i) => {
      const left = xyz[i * 3] < 0;
      const half = left ? 0 : 1;
      const px = 26 + half * (W / 2) + ((xyz[i * 3 + 1] - minY) / spanY) * (W / 2 - 60);
      const py = H - 40 - ((xyz[i * 3 + 2] - minZ) / spanZ) * (H - 80);
      return { id: i, px, py, left };
    });
  }, [mesh, twin]);

  return (
    <div className="rounded-xl border border-destructive/30 bg-destructive-soft/40 p-4">
      <p role="alert" className="mb-3 flex items-start gap-2 text-xs font-semibold">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
        <span>
          The 3D viewer cannot run here, so this is a flat region map instead. {reason}
        </span>
      </p>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full rounded-lg bg-[#0b1418]"
        role="img"
        aria-label={`Flat region map, ${def.label} layer`}
      >
        <text x={26} y={22} fill="#7fd8e0" fontSize={11}>
          left hemisphere
        </text>
        <text x={26 + W / 2} y={22} fill="#7fd8e0" fontSize={11}>
          right hemisphere
        </text>
        {dots.map((d) => {
          const g = values.glow[d.id];
          const on = selected === d.id;
          return (
            <circle
              key={d.id}
              cx={d.px}
              cy={d.py}
              r={on ? 9 : 4 + g * 5}
              fill={rampColor(def.stops, values.pos[d.id])}
              stroke={on ? "#eaf8ff" : "rgba(255,255,255,0.18)"}
              strokeWidth={on ? 2 : 1}
              tabIndex={0}
              role="button"
              aria-label={`${regionLabel(mesh, twin, d.id).plain}, ${values.format(values.raw[d.id])}`}
              onClick={() => onSelect(on ? null : d.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") onSelect(on ? null : d.id);
              }}
            />
          );
        })}
      </svg>
    </div>
  );
}
