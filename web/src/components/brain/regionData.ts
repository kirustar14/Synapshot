// Turns twin, mesh and what-if payloads into the three per-region channels the shader needs,
// plus the plain language names the callouts read out. Pure TypeScript so the side panels
// share it with the 3D bundle.

import type { Attribution, Mesh, Twin } from "@/api/types";
import type { LayerId } from "./layers";

export const REGIONS = 100;

/** Linear read of a weekly array at a possibly fractional week. */
export function atWeek(series: number[] | undefined, week: number): number {
  if (!series || series.length === 0) return 0;
  const last = series.length - 1;
  const w = Math.min(last, Math.max(0, week));
  const lo = Math.floor(w);
  const hi = Math.min(last, lo + 1);
  return series[lo] + (series[hi] - series[lo]) * (w - lo);
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export interface LayerValues {
  /** Position along the layer ramp, 0 to 1, one per region. */
  pos: Float32Array;
  /** How brightly the region glows, 0 to 1. */
  glow: Float32Array;
  /** Shimmer amount, 0 to 1. Only the uncertainty layer uses it. */
  shimmer: Float32Array;
  /** The real number behind the colour, for panels and callouts. */
  raw: Float32Array;
  /** Formats one raw value the way its layer reads best. */
  format: (v: number) => string;
  /** True when the layer has no data yet and the mesh should stay unlit. */
  empty: boolean;
  /** What the bright end of the ramp means for this patient, when the layer auto scales. */
  scaleTop?: number;
  /** What the dark end means. Set when the ramp spans a range rather than starting at 0. */
  scaleLo?: number;
}

export interface LayerCtx {
  twin: Twin | undefined;
  week: number;
  /** region_effect from the intervention route. */
  effect?: number[] | null;
  /** Per region weights for the signal drivers layer. */
  weights?: number[] | null;
  /** Counterfactual recovery multiplier, which tints the healing layer. */
  recoveryMult?: number;
}

const blank = (): LayerValues => ({
  pos: new Float32Array(REGIONS),
  glow: new Float32Array(REGIONS),
  shimmer: new Float32Array(REGIONS),
  raw: new Float32Array(REGIONS),
  format: (v) => v.toFixed(2),
  empty: true,
});

const edgeDiffCache = new WeakMap<Twin, Float32Array>();

/** Mean of personal weight minus template weight over the tracts touching each region. */
function edgeDiff(twin: Twin): Float32Array {
  const hit = edgeDiffCache.get(twin);
  if (hit) return hit;
  const sum = new Float32Array(REGIONS);
  const hits = new Float32Array(REGIONS);
  for (const e of twin.edges) {
    const d = e.personal_w - e.template_w;
    if (e.a >= 0 && e.a < REGIONS) {
      sum[e.a] += d;
      hits[e.a] += 1;
    }
    if (e.b >= 0 && e.b < REGIONS) {
      sum[e.b] += d;
      hits[e.b] += 1;
    }
  }
  const out = new Float32Array(REGIONS);
  for (let i = 0; i < REGIONS; i++) out[i] = hits[i] > 0 ? sum[i] / hits[i] : 0;
  edgeDiffCache.set(twin, out);
  return out;
}

/** Largest absolute value in an array, floored so a flat array does not divide by zero. */
function peak(values: ArrayLike<number>, floor: number): number {
  let m = floor;
  for (let i = 0; i < values.length; i++) {
    const a = Math.abs(values[i]);
    if (a > m) m = a;
  }
  return m;
}

/** The three shader channels plus the raw numbers for one layer at one week. */
export function layerValues(id: LayerId, ctx: LayerCtx): LayerValues {
  const { twin, week } = ctx;
  if (!twin || twin.regions.length === 0) return blank();
  const out = blank();
  out.empty = false;
  const regions = twin.regions;

  if (id === "damage") {
    // Damage from a rotational impact is diffuse, not focal: the strain model damages
    // edges by how they are oriented against the blow, so most of the brain carries
    // some. A real patient's week 0 field is often 0.12 to 0.17, a spread of about 1.5x
    // sitting well above zero.
    //
    // Dividing by the maximum, which is what this used to do, then mapped that whole
    // field onto the top third of the ramp and lit the entire cortex red. The brain
    // looked catastrophically injured when the model was saying something quite mild and
    // quite even.
    //
    // So the ramp spans the patient's own range instead of starting at zero: dark is
    // their least damaged region, bright is their worst. That makes the relative
    // structure visible, which is the useful thing, and it is explicitly a relative map.
    // `scaleLo` and `scaleTop` are both reported so the legend can say what the two ends
    // actually are rather than implying 0 to 1.
    let top = 0;
    let lo = Infinity;
    for (const r of regions) {
      const v = r.damage?.[0] ?? 0;
      top = Math.max(top, v);
      lo = Math.min(lo, v);
    }
    if (!Number.isFinite(lo)) lo = 0;
    // A floor on the span, so a perfectly even field is not amplified into noise. Below
    // this the differences between regions are smaller than the filter's own spread.
    const span = Math.max(0.02, top - lo);
    for (let i = 0; i < REGIONS; i++) {
      const v = atWeek(regions[i]?.damage, week);
      out.raw[i] = v;
      out.pos[i] = clamp01((v - lo) / span);
      // Glow is capped well under 1. The bloom pass multiplies this, and anything near
      // the top blows the surface out to white and loses every parcel boundary with it.
      out.glow[i] = 0.55 * clamp01(Math.pow((v - lo) / span, 1.8));
    }
    out.scaleLo = lo;
    out.scaleTop = top;
    out.format = (v) => v.toFixed(3);
    return out;
  }

  if (id === "uncertainty") {
    const widths = new Float32Array(REGIONS);
    for (let i = 0; i < REGIONS; i++) {
      widths[i] = Math.max(0, atWeek(regions[i]?.damage_hi, week) - atWeek(regions[i]?.damage_lo, week));
    }
    const top = peak(widths, 0.08);
    for (let i = 0; i < REGIONS; i++) {
      out.raw[i] = widths[i];
      out.pos[i] = clamp01(widths[i] / top);
      out.glow[i] = clamp01(0.25 + 0.6 * (widths[i] / top));
      out.shimmer[i] = clamp01(widths[i] / top);
    }
    out.scaleTop = top;
    out.format = (v) => `${v.toFixed(2)} wide`;
    return out;
  }

  if (id === "healing") {
    const mult = ctx.recoveryMult ?? 1;
    for (let i = 0; i < REGIONS; i++) {
      const v = (regions[i]?.recovery ?? 1) * mult;
      out.raw[i] = v;
      out.pos[i] = clamp01((v - 0.5) / 1);
      out.glow[i] = 0.55;
    }
    out.format = (v) => `${v.toFixed(2)}x typical`;
    return out;
  }

  if (id === "activity") {
    for (let i = 0; i < REGIONS; i++) {
      const v = atWeek(regions[i]?.activity, week);
      out.raw[i] = v;
      out.pos[i] = clamp01((v + 3) / 6);
      out.glow[i] = clamp01(Math.abs(v) / 3);
    }
    out.format = (v) => `${v >= 0 ? "+" : ""}${v.toFixed(2)} z`;
    return out;
  }

  if (id === "ei") {
    for (let i = 0; i < REGIONS; i++) {
      const r = regions[i];
      const v = (r?.ei ?? 0) - (r?.template_ei ?? 0);
      out.raw[i] = v;
      out.pos[i] = clamp01(v / 0.6 + 0.5);
      out.glow[i] = clamp01(Math.abs(v) / 0.3);
    }
    out.format = (v) => `${v >= 0 ? "+" : ""}${v.toFixed(3)}`;
    return out;
  }

  if (id === "template") {
    const diff = edgeDiff(twin);
    const top = peak(diff, 0.05);
    for (let i = 0; i < REGIONS; i++) {
      out.raw[i] = diff[i];
      out.pos[i] = clamp01(diff[i] / (2 * top) + 0.5);
      out.glow[i] = clamp01(Math.abs(diff[i]) / top);
    }
    out.scaleTop = top;
    out.format = (v) => `${v >= 0 ? "+" : ""}${v.toFixed(3)} weight`;
    return out;
  }

  if (id === "intervention") {
    const effect = ctx.effect;
    if (!effect || effect.length === 0) return blank();
    const top = peak(effect, 1e-4);
    for (let i = 0; i < REGIONS; i++) {
      const v = effect[i] ?? 0;
      out.raw[i] = v;
      out.pos[i] = clamp01(v / (2 * top) + 0.5);
      out.glow[i] = clamp01(Math.abs(v) / top);
    }
    out.scaleTop = top;
    out.format = (v) => `${v >= 0 ? "+" : ""}${v.toFixed(3)} rate`;
    return out;
  }

  if (id === "difference") {
    const weights = ctx.weights;
    if (!weights || weights.length === 0) return blank();
    const top = peak(weights, 0.02);
    for (let i = 0; i < REGIONS; i++) {
      const v = weights[i] ?? 0;
      out.raw[i] = v;
      out.pos[i] = clamp01(v / (2 * top) + 0.5);
      out.glow[i] = clamp01(Math.abs(v) / top);
    }
    out.scaleTop = top;
    out.format = (v) => `${v >= 0 ? "+" : ""}${v.toFixed(3)} damage`;
    return out;
  }

  const weights = ctx.weights;
  if (!weights || weights.length === 0) return blank();
  const top = peak(weights, 1e-6);
  for (let i = 0; i < REGIONS; i++) {
    const v = weights[i] ?? 0;
    out.raw[i] = v;
    out.pos[i] = clamp01(v / top);
    out.glow[i] = clamp01(v / top);
  }
  out.format = (v) => `${(v * 100).toFixed(1)} percent of the signal`;
  return out;
}

/* ---------------------------------------------------------------- plain language */

export interface RegionLabel {
  id: number;
  /** Something a person can say out loud, for example "left upper parietal". */
  plain: string;
  /** The parcellation name exactly as the atlas spells it. */
  code: string;
  hemi: string;
  lobe: string;
  network: string;
}

/** Left or right out of either spelling the backends use, LH_Vis_1 or "L Cuneus". */
function hemiOf(name: string, fallback: number): string {
  if (/^LH[_ ]/i.test(name) || /^L /.test(name)) return "left";
  if (/^RH[_ ]/i.test(name) || /^R /.test(name)) return "right";
  return fallback < REGIONS / 2 ? "left" : "right";
}

/** Front, back, upper or lower, from the region centroid, so two parcels read apart. */
function placeOf(xyz: Float32Array | null, id: number): string {
  if (!xyz) return "";
  const y = xyz[id * 3 + 1];
  const z = xyz[id * 3 + 2];
  if (z > 30) return "upper ";
  if (y > 28) return "front ";
  if (y < -32) return "back ";
  if (z < -22) return "lower ";
  return "";
}

/** Readable name, lobe, hemisphere and network for one region. */
export function regionLabel(mesh: Mesh | undefined, twin: Twin | undefined, id: number): RegionLabel {
  const code = mesh?.region_names?.[id] ?? twin?.regions?.[id]?.name ?? `Region ${id + 1}`;
  const lobe = (mesh?.lobes?.[id] ?? "cortex").toLowerCase().replace(/ lobe$/, "");
  const network = mesh?.networks?.[id] ?? twin?.regions?.[id]?.network ?? "unknown";
  const hemi = hemiOf(code, id);
  const xyz = regionPoints(mesh, twin);
  const plain = `${hemi} ${placeOf(xyz, id)}${lobe}`.replace(/\s+/g, " ").trim();
  return { id, plain, code, hemi, lobe, network };
}

const pointsCache = new WeakMap<object, Float32Array>();

/**
 * Region centroids in the mesh coordinate space. Prefers mesh.region_xyz, which the backend
 * computes from the surface, and falls back to the twin's own x, y, z which are the same
 * centroids. Never recomputed from the vertex arrays.
 */
export function regionPoints(mesh: Mesh | undefined, twin: Twin | undefined): Float32Array | null {
  const fromMesh = (mesh as { region_xyz?: number[] } | undefined)?.region_xyz;
  if (fromMesh && fromMesh.length >= REGIONS * 3) {
    const hit = pointsCache.get(mesh as object);
    if (hit) return hit;
    const out = Float32Array.from(fromMesh.slice(0, REGIONS * 3));
    pointsCache.set(mesh as object, out);
    return out;
  }
  if (!twin || twin.regions.length === 0) return null;
  const hit = pointsCache.get(twin);
  if (hit) return hit;
  const out = new Float32Array(REGIONS * 3);
  twin.regions.forEach((r) => {
    if (r.id < 0 || r.id >= REGIONS) return;
    out[r.id * 3] = r.x;
    out[r.id * 3 + 1] = r.y;
    out[r.id * 3 + 2] = r.z;
  });
  pointsCache.set(twin, out);
  return out;
}

export interface Ranked {
  id: number;
  value: number;
}

/** The regions with the most damage at this week, highest first. */
export function topDamaged(twin: Twin | undefined, week: number, count: number): Ranked[] {
  if (!twin) return [];
  return twin.regions
    .map((r) => ({ id: r.id, value: atWeek(r.damage, week) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, count);
}

/** The regions the active layer lights most, so callouts follow whatever is on screen. */
export function topLit(values: LayerValues, count: number): Ranked[] {
  const all: Ranked[] = [];
  for (let i = 0; i < REGIONS; i++) all.push({ id: i, value: values.glow[i] });
  return all.sort((a, b) => b.value - a.value).slice(0, count);
}

/* ---------------------------------------------------------------- signal drivers */

/** Region weights for one signal, read off the attribution tract names when loadings are absent. */
export function weightsFromAttribution(twin: Twin | undefined, rows: Attribution[] | undefined, signal: string): number[] | null {
  if (!twin || !rows) return null;
  const row = rows.find((r) => r.signal === signal);
  if (!row) return null;
  const byName = new Map<string, number>();
  twin.regions.forEach((r) => byName.set(r.name, r.id));
  const out = new Array<number>(REGIONS).fill(0);
  let any = false;
  for (const t of row.tracts) {
    for (const part of t.name.split(" to ")) {
      const id = byName.get(part.trim());
      if (id === undefined) continue;
      out[id] += Math.max(0, t.score);
      any = true;
    }
  }
  if (!any) return null;
  const total = out.reduce((a, b) => a + b, 0) || 1;
  return out.map((v) => v / total);
}

/* ---------------------------------------------------------------- tracts */

export interface TractInfo {
  /** Index into twin.edges, so the weekly damage array stays the source of truth. */
  index: number;
  a: number;
  b: number;
  damage: number[];
  damageW0: number;
  label: string;
}

/** The strongest tracts to draw, damaged ones first so the top 200 are the interesting ones. */
export function pickTracts(twin: Twin | undefined, count: number): TractInfo[] {
  if (!twin) return [];
  return twin.edges
    .map((e, index) => ({ e, index }))
    .sort((x, y) => y.e.damage[0] - x.e.damage[0])
    .slice(0, count)
    .map(({ e, index }) => ({
      index,
      a: e.a,
      b: e.b,
      damage: e.damage,
      damageW0: e.damage[0],
      label: `${twin.regions[e.a]?.name ?? e.a} to ${twin.regions[e.b]?.name ?? e.b}`,
    }));
}

/** Mean damage over every tract at one week, for the timeline curve. */
export function globalDamage(twin: Twin | undefined, week: number): { mean: number; lo: number; hi: number } {
  if (!twin || twin.regions.length === 0) return { mean: 0, lo: 0, hi: 0 };
  let mean = 0;
  let lo = 0;
  let hi = 0;
  for (const r of twin.regions) {
    mean += atWeek(r.damage, week);
    lo += atWeek(r.damage_lo, week);
    hi += atWeek(r.damage_hi, week);
  }
  const n = twin.regions.length;
  return { mean: mean / n, lo: lo / n, hi: hi / n };
}
