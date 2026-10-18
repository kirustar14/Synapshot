import { describe, expect, it } from "vitest";
import {
  ENVIRONMENT_PERIOD,
  LEAF_DURATION,
  LEAF_STARTS,
  environmentAt,
  leafAt,
  windAt,
} from "./motion";
import { JUNCTIONS, NEURAL_PATHS } from "./BrainTrace";

describe("the room's motion continuity", () => {
  it("matches every wind output and its velocity at the loop boundary", () => {
    const delta = 0.0001;
    for (const key of ["wind", "foliage", "tips", "light"] as const) {
      expect(environmentAt(0)[key]).toBeCloseTo(
        environmentAt(ENVIRONMENT_PERIOD)[key],
        10,
      );
      const velocity = (t: number) =>
        (environmentAt(t + delta)[key] - environmentAt(t - delta)[key]) /
        (2 * delta);
      expect(velocity(0)).toBeCloseTo(velocity(ENVIRONMENT_PERIOD), 8);
    }
  });
  it("keeps resets invisible and leaves intermittent", () => {
    for (let i = 0; i < LEAF_STARTS.length; i++) {
      expect(leafAt(0, i).opacity).toBe(0);
      expect(leafAt(ENVIRONMENT_PERIOD - 0.001, i).opacity).toBe(0);
    }
    let quiet = 0;
    let peak = 0;
    for (let t = 0; t < ENVIRONMENT_PERIOD; t += 0.1) {
      const visible = LEAF_STARTS.filter(
        (_, i) => leafAt(t, i).opacity > 0,
      ).length;
      if (!visible) quiet++;
      peak = Math.max(peak, visible);
      expect(Number.isFinite(windAt(t))).toBe(true);
    }
    expect(quiet).toBeGreaterThan(5);
    expect(peak).toBeGreaterThan(2);
    expect(peak).toBeLessThanOrEqual(4);
  });
  it("carries every leaf from offscreen left to offscreen right without reversing", () => {
    LEAF_STARTS.forEach((start, i) => {
      expect(leafAt(start, i).x).toBeLessThan(0);
      expect(leafAt(start + LEAF_DURATION, i).x).toBeGreaterThan(1122);
      let previous = -Infinity;
      for (let t = 0; t <= LEAF_DURATION; t += 0.1) {
        const state = leafAt(start + t, i);
        expect(state.x).toBeGreaterThanOrEqual(previous);
        previous = state.x;
      }
    });
  });
});

describe("neural branch topology", () => {
  it("starts and ends each continuous path at its named junction", () => {
    for (const edge of NEURAL_PATHS) {
      expect(edge.d.match(/M/g)).toHaveLength(1);
      const numbers = edge.d.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
      expect(numbers.slice(0, 2)).toEqual(JUNCTIONS[edge.from]);
      expect(numbers.slice(-2)).toEqual(JUNCTIONS[edge.to]);
    }
  });
  it("can reach every major pathway from the original signal", () => {
    const reached = new Set(["a"]);
    for (let pass = 0; pass < NEURAL_PATHS.length; pass++) {
      for (const edge of NEURAL_PATHS)
        if (reached.has(edge.from)) reached.add(edge.to);
    }
    expect(
      [...new Set(NEURAL_PATHS.flatMap((edge) => [edge.from, edge.to]))].every(
        (id) => reached.has(id),
      ),
    ).toBe(true);
  });
});
