// Procedural stand-in for the real fsaverage6 surface. Two noisy folded ellipsoids, one per
// hemisphere, about 20k vertices in total. Used only when the backend has no /api/mesh and
// public/mesh.json is absent. Anything built from this must carry a visible placeholder badge.

import type { Mesh } from "@/api/types";
import { ATLAS, REGION_LOBES, REGION_NAMES, REGION_NETWORKS, SHELL, nearestRegion } from "./atlas";
import { rng, round } from "./rng";

const LAT = 70;
const LON = 140;

/** Gyral folding as a smooth sum of sines over the sphere, in mm along the radial direction. */
function fold(theta: number, phi: number): number {
  return (
    2.3 * Math.sin(6 * phi) * Math.sin(5 * theta) +
    1.4 * Math.sin(11 * phi + 2) * Math.sin(9 * theta) +
    0.9 * Math.sin(17 * theta + 0.7) +
    0.7 * Math.sin(23 * phi) * Math.sin(3 * theta)
  );
}

function buildHemisphere(hemi: "L" | "R", pial: number[], inflated: number[], labels: number[], faces: number[]) {
  const side = hemi === "L" ? -1 : 1;
  const base = pial.length / 3;
  const jitter = rng(hemi === "L" ? 1301 : 2602);

  for (let i = 0; i <= LAT; i++) {
    const theta = (i / LAT) * Math.PI;
    const st = Math.sin(theta);
    const ct = Math.cos(theta);
    for (let j = 0; j <= LON; j++) {
      const phi = (j / LON) * Math.PI * 2;
      const u: [number, number, number] = [st * Math.cos(phi), ct, st * Math.sin(phi)];
      const d = fold(theta, phi) + jitter.normal() * 0.18;

      pial.push(
        round(side * SHELL.offsetX + (SHELL.rx + d) * u[0], 2),
        round((SHELL.ry + d) * u[1], 2),
        round((SHELL.rz + d) * u[2], 2),
      );
      inflated.push(
        round(side * (SHELL.offsetX + 4) + 30 * u[0], 2),
        round(58 * u[1], 2),
        round(52 * u[2], 2),
      );
      labels.push(side * u[0] < -0.45 ? -1 : nearestRegion(u, hemi));
    }
  }

  const rowLen = LON + 1;
  for (let i = 0; i < LAT; i++) {
    for (let j = 0; j < LON; j++) {
      const a = base + i * rowLen + j;
      const b = a + 1;
      const c = a + rowLen;
      const d = c + 1;
      faces.push(a, c, b, b, c, d);
    }
  }
}

/** Per vertex flag, 1 when any face neighbour carries a different label. */
function borderFlags(labels: number[], faces: number[]): number[] {
  const border = new Array<number>(labels.length).fill(0);
  for (let f = 0; f < faces.length; f += 3) {
    const a = faces[f];
    const b = faces[f + 1];
    const c = faces[f + 2];
    if (labels[a] !== labels[b] || labels[b] !== labels[c] || labels[a] !== labels[c]) {
      border[a] = 1;
      border[b] = 1;
      border[c] = 1;
    }
  }
  return border;
}

let cached: Mesh | null = null;

/** The procedural mesh. Built once per page load, then reused. */
export function proceduralMesh(): Mesh {
  if (cached) return cached;
  const pial: number[] = [];
  const inflated: number[] = [];
  const labels: number[] = [];
  const faces: number[] = [];
  buildHemisphere("L", pial, inflated, labels, faces);
  buildHemisphere("R", pial, inflated, labels, faces);
  cached = {
    space: "fsaverage6",
    pial,
    inflated,
    faces,
    labels,
    region_names: REGION_NAMES,
    networks: REGION_NETWORKS,
    border: borderFlags(labels, faces),
    lobes: REGION_LOBES,
    source: "procedural",
  };
  return cached;
}

export const meshVertexCount = () => proceduralMesh().labels.length;

/** Index of the vertex nearest a point in mm, used to anchor the impact site. */
export function nearestVertex(point: [number, number, number]): number {
  const m = proceduralMesh();
  let best = 0;
  let bestD = Infinity;
  for (let v = 0; v < m.labels.length; v++) {
    const dx = m.pial[v * 3] - point[0];
    const dy = m.pial[v * 3 + 1] - point[1];
    const dz = m.pial[v * 3 + 2] - point[2];
    const d = dx * dx + dy * dy + dz * dz;
    if (d < bestD) {
      bestD = d;
      best = v;
    }
  }
  return best;
}

/** Region centroid in mm, taken from the atlas so the sphere and mesh views line up. */
export const regionCentroid = (id: number) => ATLAS[id].mm;
