// The pure parts of the viewer: the ramps, the per region channels and the plain language
// names. No three, no canvas, so this runs in jsdom with nothing mocked.

import { describe, expect, it } from "vitest";
import type { Mesh, Twin } from "@/api/types";
import { LAYERS, rampColor, sampleRamp } from "./layers";
import { atWeek, layerValues, pickTracts, regionLabel, regionPoints, topDamaged, REGIONS } from "./regionData";

const WEEKS = Array.from({ length: 13 }, (_, i) => i);

/** A twin with one hot region, one cold region and a flat recovery rate. */
function twinFixture(peak = 0.2): Twin {
  const regions = Array.from({ length: REGIONS }, (_, id) => {
    const d0 = id === 7 ? peak : peak * 0.1;
    const damage = WEEKS.map((w) => d0 * Math.exp(-0.2 * w));
    return {
      id,
      name: id < 50 ? `LH_Vis_${id + 1}` : `RH_Cont_${id - 49}`,
      hemi: (id < 50 ? "L" : "R") as "L" | "R",
      x: id < 50 ? -40 : 40,
      y: -50,
      z: 20,
      ei: 1 + id * 0.001,
      template_ei: 1,
      damage,
      activity: WEEKS.map(() => -2),
      damage_lo: damage.map((v) => Math.max(0, v - (id === 7 ? 0.1 : 0.02))),
      damage_hi: damage.map((v) => v + (id === 7 ? 0.1 : 0.02)),
      recovery: 1.2,
      network: "Visual",
    };
  });
  const edges = Array.from({ length: 12 }, (_, i) => ({
    a: i,
    b: i + 20,
    damage: WEEKS.map((w) => (i === 0 ? 0.6 : 0.05) * Math.exp(-0.2 * w)),
    template_w: 0.5,
    personal_w: 0.5 + i * 0.01,
  }));
  return { weeks: WEEKS, regions, edges, top_tracts: [] };
}

const meshFixture = (): Mesh => ({
  space: "fsaverage6",
  pial: [],
  inflated: [],
  faces: [],
  labels: [],
  region_names: Array.from({ length: REGIONS }, (_, i) => (i < 50 ? `LH_Vis_${i + 1}` : `RH_Cont_${i - 49}`)),
  networks: Array.from({ length: REGIONS }, () => "Visual"),
  border: [],
  lobes: Array.from({ length: REGIONS }, (_, i) => (i < 50 ? "occipital" : "frontal")),
  source: "fsaverage6",
});

describe("layer ramps", () => {
  it("gives every layer a meaning, ticks and ordered stops", () => {
    for (const layer of LAYERS) {
      expect(layer.meaning.length).toBeGreaterThan(10);
      expect(layer.ticks.length).toBeGreaterThan(1);
      expect(layer.stops[0].at).toBe(0);
      expect(layer.stops[layer.stops.length - 1].at).toBe(1);
      for (let i = 1; i < layer.stops.length; i++) {
        expect(layer.stops[i].at).toBeGreaterThan(layer.stops[i - 1].at);
      }
    }
  });

  it("returns the end stops exactly at each end of the ramp", () => {
    for (const layer of LAYERS) {
      expect(sampleRamp(layer.stops, 0)).toEqual(layer.stops[0].rgb);
      const hot = sampleRamp(layer.stops, 1);
      const want = layer.stops[layer.stops.length - 1].rgb;
      for (let c = 0; c < 3; c++) expect(hot[c]).toBeCloseTo(want[c], 5);
    }
    expect(rampColor(LAYERS[0].stops, 0)).toMatch(/^rgb\(/);
  });

  it("says the healing layer is flat because the model has one global rate", () => {
    const healing = LAYERS.find((l) => l.id === "healing");
    expect(healing?.note).toMatch(/single global recovery rate/);
  });
});

describe("week reads", () => {
  it("interpolates between whole weeks and clamps outside the range", () => {
    expect(atWeek([0, 10, 20], 1.5)).toBe(15);
    expect(atWeek([0, 10, 20], -4)).toBe(0);
    expect(atWeek([0, 10, 20], 99)).toBe(20);
    expect(atWeek(undefined, 3)).toBe(0);
  });
});

describe("layer values", () => {
  it("scales damage to this patient's own peak and reports it", () => {
    const twin = twinFixture(0.2);
    const v = layerValues("damage", { twin, week: 0 });
    expect(v.scaleTop).toBeCloseTo(0.2, 5);
    expect(v.pos[7]).toBeCloseTo(1, 5);
    expect(v.raw[7]).toBeCloseTo(0.2, 5);
    expect(v.glow[0]).toBeLessThan(v.glow[7]);
  });

  it("never amplifies a nearly healthy brain past the floor", () => {
    const v = layerValues("damage", { twin: twinFixture(0.01), week: 0 });
    expect(v.scaleTop).toBe(0.04);
    expect(v.pos[7]).toBeLessThanOrEqual(0.25);
  });

  it("fades damage as the weeks run", () => {
    const twin = twinFixture();
    const early = layerValues("damage", { twin, week: 0 }).raw[7];
    const late = layerValues("damage", { twin, week: 12 }).raw[7];
    expect(late).toBeLessThan(early);
  });

  it("centres activity on zero", () => {
    const v = layerValues("activity", { twin: twinFixture(), week: 0 });
    expect(v.pos[0]).toBeCloseTo((-2 + 3) / 6, 5);
    expect(v.raw[0]).toBeCloseTo(-2, 5);
  });

  it("gives every region the same healing value, because the model has one rate", () => {
    const v = layerValues("healing", { twin: twinFixture(), week: 4 });
    expect(new Set(Array.from(v.raw)).size).toBe(1);
  });

  it("tints healing with the counterfactual multiplier", () => {
    const twin = twinFixture();
    const base = layerValues("healing", { twin, week: 0 }).raw[0];
    const faster = layerValues("healing", { twin, week: 0, recoveryMult: 1.5 }).raw[0];
    expect(faster).toBeCloseTo(base * 1.5, 5);
  });

  it("stays blank when the what-if has not run", () => {
    expect(layerValues("intervention", { twin: twinFixture(), week: 0 }).empty).toBe(true);
    const effect = Array.from({ length: REGIONS }, (_, i) => (i === 3 ? 0.5 : -0.1));
    const v = layerValues("intervention", { twin: twinFixture(), week: 0, effect });
    expect(v.empty).toBe(false);
    expect(v.pos[3]).toBeGreaterThan(0.5);
    expect(v.pos[0]).toBeLessThan(0.5);
  });

  it("returns a blank layer rather than throwing with no twin", () => {
    const v = layerValues("damage", { twin: undefined, week: 0 });
    expect(v.empty).toBe(true);
    expect(v.glow[0]).toBe(0);
  });
});

describe("plain language", () => {
  it("names a parcel in words a person can say, and keeps the code", () => {
    const label = regionLabel(meshFixture(), twinFixture(), 7);
    expect(label.plain).toContain("left");
    expect(label.plain).toContain("occipital");
    expect(label.code).toBe("LH_Vis_8");
  });

  it("ranks the worst regions first", () => {
    const top = topDamaged(twinFixture(), 0, 5);
    expect(top[0].id).toBe(7);
    expect(top.length).toBe(5);
    expect(top[0].value).toBeGreaterThan(top[1].value);
  });
});

describe("tracts and centroids", () => {
  it("draws the most damaged tracts first and keeps the weekly arrays", () => {
    const picked = pickTracts(twinFixture(), 5);
    expect(picked.length).toBe(5);
    expect(picked[0].damageW0).toBeCloseTo(0.6, 5);
    expect(picked[0].damage.length).toBe(13);
  });

  it("prefers mesh.region_xyz over the twin centroids", () => {
    const mesh = { ...meshFixture(), region_xyz: Array.from({ length: REGIONS * 3 }, () => 5) } as Mesh;
    const fromMesh = regionPoints(mesh, twinFixture());
    expect(fromMesh?.[0]).toBe(5);
    const fromTwin = regionPoints(meshFixture(), twinFixture());
    expect(fromTwin?.[0]).toBe(-40);
  });
});
