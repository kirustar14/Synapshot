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
  it("spans this patient's own range and reports every end", () => {
    // The fixture is one region at the peak and ninety-nine at a tenth of it, which is
    // the shape the percentile top exists for: region 7 is the outlier, so it is windowed
    // out of the scale and clamped to the bright end rather than owning it. scaleTop is
    // therefore the top of the colour scale, and scaleMax is the worst region. They are
    // different numbers on purpose and a legend has to use the right one.
    const twin = twinFixture(0.2);
    const v = layerValues("damage", { twin, week: 0 });
    expect(v.scaleLo).toBeCloseTo(0.02, 5);
    expect(v.scaleTop).toBeCloseTo(0.02, 5);
    expect(v.scaleMax).toBeCloseTo(0.2, 5);
    expect(v.pos[7]).toBeCloseTo(1, 5);
    expect(v.pos[0]).toBeCloseTo(0, 5);
    expect(v.raw[7]).toBeCloseTo(0.2, 5);
    expect(v.glow[0]).toBeLessThan(v.glow[7]);
  });

  it("puts the cluster just under the worst region at the top of the ramp too", () => {
    // The bug this is here for: on a real field the gap from the worst region to the
    // second worst is wider than the whole spread from second to twelfth, so scaling to
    // the maximum left every region within one percent of the worst sitting in orange
    // while exactly one went red. Regions that are nearly as damaged have to look nearly
    // as damaged.
    const twin = twinFixture(0.2);
    twin.regions.forEach((r, i) => {
      // One outlier, then a tight cluster, then a long tail down to 0.315.
      const d0 = i === 7 ? 0.436 : i < 14 ? 0.405 + (i % 7) * 0.001 : 0.315 + (i % 60) * 0.0012;
      r.damage = r.damage.map(() => d0);
    });
    const v = layerValues("damage", { twin, week: 0 });

    // The cluster members are all within 0.007 of each other and all read at the top.
    for (const i of [1, 2, 3, 4, 5, 6]) {
      expect(v.raw[i]).toBeGreaterThan(0.4);
      expect(v.pos[i]).toBeGreaterThan(0.9);
    }
    // And the floor is untouched: the least damaged region still keeps its own colour.
    expect(Math.min(...v.pos)).toBeCloseTo(0, 5);
  });

  it("spreads glow across the whole range, not just the worst region", () => {
    // This used to cap glow at 0.55 for the bloom pass. Bloom is gone, and the shader
    // that replaced it fades a region in over smoothstep(0.1, 0.6, glow), so the cap put
    // the median region at a colour mix of 0.001: one bright parcel on an otherwise
    // untouched cortex, which is not a damage map. The worst region must reach the top of
    // the range and the middle of the field has to land in the middle of it.
    // A real field, spread evenly from 0.12 to 0.17, rather than the one-hot fixture:
    // the bug was about the middle of a spread field going dark, and a fixture with one
    // spike and ninety-nine identical regions has no middle to lose.
    const spread = twinFixture(0.2);
    spread.regions.forEach((r, i) => {
      const d0 = 0.12 + (0.05 * i) / (REGIONS - 1);
      r.damage = WEEKS.map((w) => d0 * Math.exp(-0.2 * w));
    });
    const v = layerValues("damage", { twin: spread, week: 0 });

    expect(Math.max(...v.glow)).toBeCloseTo(1, 5);

    // The middle of the field lands in the middle of the ramp. Under the old cap this
    // was 0.14, which the shader's knee then crushed to a colour mix of 0.001.
    const mid = [...v.glow].sort((a, b) => a - b)[Math.floor(REGIONS / 2)];
    expect(mid).toBeGreaterThan(0.3);
    expect(mid).toBeLessThan(0.7);

    // The floor still holds: the least damaged region keeps its own colour, so a diffuse
    // field reads as a gradient instead of a wall of red.
    expect(Math.min(...v.glow)).toBeCloseTo(0, 5);
  });

  it("does not amplify an even field into structure that is not there", () => {
    // Every region the same. The spread floor means this renders flat rather than
    // turning rounding noise into a map.
    const flat = twinFixture(0.01);
    for (const r of flat.regions) r.damage = r.damage.map(() => 0.01);
    const v = layerValues("damage", { twin: flat, week: 0 });
    expect(v.scaleLo).toBeCloseTo(0.01, 5);
    expect(v.scaleTop).toBeCloseTo(0.01, 5);
    expect(Math.max(...v.pos)).toBeCloseTo(0, 5);
  });

  it("shows structure in a narrow field instead of a wall of red", () => {
    // A real week 0 is about 0.12 to 0.17, a spread of 1.5x well above zero. Dividing by
    // the maximum put the least damaged region at 68 percent of the ramp and lit the
    // whole cortex. The range mapping puts it at zero, where it belongs.
    const narrow = twinFixture(0.17);
    narrow.regions.forEach((r, i) => {
      const v = i === 7 ? 0.17 : 0.12 + (i % 5) * 0.004;
      r.damage = r.damage.map(() => v);
    });
    const v = layerValues("damage", { twin: narrow, week: 0 });
    expect(v.pos[7]).toBeCloseTo(1, 5);
    expect(Math.min(...v.pos)).toBeCloseTo(0, 5);
    expect(v.raw[7]).toBeCloseTo(0.17, 5);
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
