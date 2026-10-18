// A 100 region parcellation stand-in: 50 areas per hemisphere, each with a Yeo network and a
// plain-English area tag. The twin and the procedural mesh both read this file, so a region id
// means the same thing in the sphere view, the mesh view and the attribution lists.

export const NETWORKS = ["Vis", "SomMot", "DorsAttn", "SalVentAttn", "Limbic", "Cont", "Default"] as const;
export type Network = (typeof NETWORKS)[number];

interface Area {
  name: string;
  network: Network;
  lobe: string;
}

/** The 50 areas of one hemisphere, ordered by network. */
const AREAS: Area[] = [
  { name: "Striate cortex", network: "Vis", lobe: "Occipital lobe" },
  { name: "Lingual gyrus", network: "Vis", lobe: "Occipital lobe" },
  { name: "Cuneus", network: "Vis", lobe: "Occipital lobe" },
  { name: "Lateral occipital", network: "Vis", lobe: "Occipital lobe" },
  { name: "Occipital pole", network: "Vis", lobe: "Occipital lobe" },
  { name: "Fusiform posterior", network: "Vis", lobe: "Temporal lobe" },
  { name: "Fusiform anterior", network: "Vis", lobe: "Temporal lobe" },
  { name: "Precentral upper", network: "SomMot", lobe: "Motor strip" },
  { name: "Precentral mid", network: "SomMot", lobe: "Motor strip" },
  { name: "Precentral lower", network: "SomMot", lobe: "Motor strip" },
  { name: "Postcentral upper", network: "SomMot", lobe: "Sensory strip" },
  { name: "Postcentral lower", network: "SomMot", lobe: "Sensory strip" },
  { name: "Paracentral lobule", network: "SomMot", lobe: "Motor strip" },
  { name: "Supplementary motor", network: "SomMot", lobe: "Motor strip" },
  { name: "Auditory belt", network: "SomMot", lobe: "Temporal lobe" },
  { name: "Superior parietal", network: "DorsAttn", lobe: "Parietal lobe" },
  { name: "Intraparietal sulcus", network: "DorsAttn", lobe: "Parietal lobe" },
  { name: "Frontal eye field", network: "DorsAttn", lobe: "Frontal lobe" },
  { name: "Precuneus dorsal", network: "DorsAttn", lobe: "Parietal lobe" },
  { name: "Middle temporal motion", network: "DorsAttn", lobe: "Temporal lobe" },
  { name: "Posterior insula", network: "SalVentAttn", lobe: "Insula" },
  { name: "Anterior insula", network: "SalVentAttn", lobe: "Insula" },
  { name: "Mid cingulate", network: "SalVentAttn", lobe: "Cingulate" },
  { name: "Supramarginal gyrus", network: "SalVentAttn", lobe: "Parietal lobe" },
  { name: "Frontal operculum", network: "SalVentAttn", lobe: "Frontal lobe" },
  { name: "Temporoparietal junction", network: "SalVentAttn", lobe: "Parietal lobe" },
  { name: "Temporal pole", network: "Limbic", lobe: "Temporal lobe" },
  { name: "Entorhinal cortex", network: "Limbic", lobe: "Medial temporal" },
  { name: "Parahippocampal gyrus", network: "Limbic", lobe: "Medial temporal" },
  { name: "Orbitofrontal medial", network: "Limbic", lobe: "Frontal lobe" },
  { name: "Orbitofrontal lateral", network: "Limbic", lobe: "Frontal lobe" },
  { name: "Subgenual cingulate", network: "Limbic", lobe: "Cingulate" },
  { name: "Dorsolateral prefrontal", network: "Cont", lobe: "Frontal lobe" },
  { name: "Middle frontal gyrus", network: "Cont", lobe: "Frontal lobe" },
  { name: "Inferior frontal junction", network: "Cont", lobe: "Frontal lobe" },
  { name: "Frontal pole", network: "Cont", lobe: "Frontal lobe" },
  { name: "Anterior cingulate", network: "Cont", lobe: "Cingulate" },
  { name: "Inferior parietal lateral", network: "Cont", lobe: "Parietal lobe" },
  { name: "Posterior cingulate dorsal", network: "Cont", lobe: "Cingulate" },
  { name: "Lateral temporal control", network: "Cont", lobe: "Temporal lobe" },
  { name: "Superior frontal medial", network: "Cont", lobe: "Frontal lobe" },
  { name: "Medial prefrontal", network: "Default", lobe: "Frontal lobe" },
  { name: "Posterior cingulate", network: "Default", lobe: "Cingulate" },
  { name: "Precuneus ventral", network: "Default", lobe: "Parietal lobe" },
  { name: "Angular gyrus", network: "Default", lobe: "Parietal lobe" },
  { name: "Superior temporal sulcus", network: "Default", lobe: "Temporal lobe" },
  { name: "Inferior temporal gyrus", network: "Default", lobe: "Temporal lobe" },
  { name: "Retrosplenial cortex", network: "Default", lobe: "Cingulate" },
  { name: "Hippocampal head", network: "Default", lobe: "Medial temporal" },
  { name: "Dorsomedial prefrontal", network: "Default", lobe: "Frontal lobe" },
];

export interface AtlasRegion {
  id: number;
  name: string;
  hemi: "L" | "R";
  network: Network;
  lobe: string;
  /** Unit sphere direction, used to label mesh vertices by nearest centroid. */
  u: [number, number, number];
  /** Centroid in the same millimetre space as the mesh. */
  mm: [number, number, number];
}

/** Ellipsoid half axes in mm for one hemisphere, plus how far its centre sits off the midline. */
export const SHELL = { rx: 28, ry: 72, rz: 46, offsetX: 30 };

/** Maps a unit sphere direction onto one hemisphere of the brain shell, in mm. */
export function shellPoint(u: [number, number, number], hemi: "L" | "R"): [number, number, number] {
  const side = hemi === "L" ? -1 : 1;
  return [side * SHELL.offsetX + SHELL.rx * u[0], SHELL.ry * u[1], SHELL.rz * u[2]];
}

/** Fibonacci sphere directions, evenly spread and fully deterministic. */
function fibonacci(count: number): [number, number, number][] {
  const golden = Math.PI * (3 - Math.sqrt(5));
  const out: [number, number, number][] = [];
  for (let i = 0; i < count; i++) {
    const y = 1 - (2 * i) / (count - 1);
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const a = golden * i;
    out.push([Math.cos(a) * r, y, Math.sin(a) * r]);
  }
  return out;
}

/** 50 directions per hemisphere, kept clear of the medial wall so every region owns vertices. */
function hemiDirections(hemi: "L" | "R"): [number, number, number][] {
  const side = hemi === "L" ? -1 : 1;
  const pool = fibonacci(180).filter((u) => side * u[0] > -0.3);
  const out: [number, number, number][] = [];
  for (let i = 0; i < 50; i++) out.push(pool[Math.floor((i * pool.length) / 50)]);
  return out;
}

function buildAtlas(): AtlasRegion[] {
  const regions: AtlasRegion[] = [];
  for (const hemi of ["L", "R"] as const) {
    const dirs = hemiDirections(hemi);
    AREAS.forEach((area, i) => {
      const u = dirs[i];
      regions.push({
        id: regions.length,
        name: `${hemi} ${area.name}`,
        hemi,
        network: area.network,
        lobe: area.lobe,
        u,
        mm: shellPoint(u, hemi),
      });
    });
  }
  return regions;
}

/** The 100 regions, left hemisphere first, ids 0 to 99. */
export const ATLAS: AtlasRegion[] = buildAtlas();

export const REGION_NAMES = ATLAS.map((r) => r.name);
export const REGION_NETWORKS = ATLAS.map((r) => r.network as string);
export const REGION_LOBES = ATLAS.map((r) => r.lobe);

/** Nearest region id to a unit direction, searched within one hemisphere. */
export function nearestRegion(u: [number, number, number], hemi: "L" | "R"): number {
  const lo = hemi === "L" ? 0 : 50;
  let best = lo;
  let bestDot = -2;
  for (let i = lo; i < lo + 50; i++) {
    const c = ATLAS[i].u;
    const dot = u[0] * c[0] + u[1] * c[1] + u[2] * c[2];
    if (dot > bestDot) {
      bestDot = dot;
      best = i;
    }
  }
  return best;
}
