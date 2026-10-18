// The Treatment tab is a reference, not a simulation, and the words prove it.
//
// It used to run the dynamic mean field model with a receptor weighted gain and show a
// baseline, a treated version and the gap between them. Those controls are gone, and this
// is the cheap check that they do not come back: a grep over the source for the words
// that only existed to drive them.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");
const TAB = readFileSync(join(ROOT, "src/components/workspace/tabs/TreatmentTab.tsx"), "utf8");

describe("the treatment tab", () => {
  it("has no simulation controls left in it", () => {
    for (const word of ["With drug", "Difference", "Simulate"]) {
      expect(TAB).not.toContain(word);
    }
  });

  it("does not reach for the route that ran the simulation", () => {
    for (const word of ["intervention", "drugImpact", "useDrugImpact", "region_effect"]) {
      expect(TAB).not.toContain(word);
    }
  });

  it("says what it is and is not, in one sentence", () => {
    expect(TAB).toContain("does not predict whether it will help");
  });

  it("puts the symptom match above the formulary list", () => {
    const suggested = TAB.indexOf("Commonly considered for the symptoms this patient reports");
    const search = TAB.indexOf("Search the formulary");
    expect(suggested).toBeGreaterThan(-1);
    expect(search).toBeGreaterThan(-1);
    expect(suggested).toBeLessThan(search);
  });

  it("never tells anybody what to do", () => {
    for (const word of ["recommend", "best for", "should take", "will improve"]) {
      expect(TAB.toLowerCase()).not.toContain(word);
    }
  });
});
