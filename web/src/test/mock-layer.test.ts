import { describe, expect, it } from "vitest";
import { mock } from "@/mock/db";

describe("mock layer", () => {
  it("seeds six patients covering every demo profile", () => {
    const rows = mock.patients();
    expect(rows).toHaveLength(6);
    expect(rows.map((r) => r.week)).toEqual([0, 4, 6, 3, 5, 2]);
    expect(rows.some((r) => r.flags.includes("red_flag"))).toBe(true);
    expect(rows.some((r) => r.flags.includes("low_quality"))).toBe(true);
    expect(rows.some((r) => r.flags.includes("drift"))).toBe(true);
    expect(rows.some((r) => r.flags.includes("missed_call"))).toBe(true);
    expect(mock.patient("p6").fc_fit).toBeNull();
    expect(mock.patient("p6").template_only).toBe(true);
  });

  it("returns 13 weekly forecast points with bands that narrow", () => {
    const f = mock.forecast("p2");
    expect(f.weeks).toHaveLength(13);
    for (const s of f.signals) {
      expect(s.mean).toHaveLength(13);
      const first = s.hi[0] - s.lo[0];
      const last = s.hi[12] - s.lo[12];
      expect(last).toBeLessThan(first);
    }
  });

  it("reports three observables for the low quality profile and six otherwise", () => {
    const low = mock.forecast("p5").signals.filter((s) => s.obs.length > 0);
    const normal = mock.forecast("p2").signals.filter((s) => s.obs.length > 0);
    expect(low).toHaveLength(3);
    expect(normal).toHaveLength(6);
    expect(mock.patient("p5").last_call?.channel.flash_ok).toBe(false);
  });

  it("builds a twin with ordered damage bands and 200 edges", () => {
    const twin = mock.twin("p3");
    expect(twin.regions).toHaveLength(100);
    expect(twin.edges).toHaveLength(200);
    for (const r of twin.regions) {
      expect(r.damage).toHaveLength(13);
      // recovery is this patient's k over the population mean k, so above 1 is healing
      // faster than typical and below 1 is slower. It is not capped at 1.
      expect(r.recovery).toBeGreaterThan(0.2);
      expect(r.recovery).toBeLessThan(4);
      for (let w = 0; w < 13; w++) {
        expect(r.damage_lo[w]).toBeLessThanOrEqual(r.damage[w]);
        expect(r.damage[w]).toBeLessThanOrEqual(r.damage_hi[w]);
      }
    }
    expect(twin.regions.filter((r) => r.hemi === "L")).toHaveLength(50);
  });

  it("builds a procedural mesh with about 20k vertices and consistent arrays", () => {
    const m = mock.mesh();
    const vertices = m.labels.length;
    expect(vertices).toBeGreaterThan(18000);
    expect(vertices).toBeLessThan(23000);
    expect(m.pial).toHaveLength(vertices * 3);
    expect(m.inflated).toHaveLength(vertices * 3);
    expect(m.border).toHaveLength(vertices);
    expect(m.faces.length % 3).toBe(0);
    expect(m.region_names).toHaveLength(100);
    expect(m.networks).toHaveLength(100);
    expect(m.lobes).toHaveLength(100);
    expect(m.source).toBe("procedural");
    expect(m.labels.some((l) => l === -1)).toBe(true);
    expect(m.border.some((b) => b === 1)).toBe(true);
    expect(Math.max(...m.labels)).toBe(99);
  });

  it("returns shape, receptors, loadings and a what-if with the disclaimer", () => {
    const shape = mock.shape("p1");
    expect(shape.thick_z).toHaveLength(100);
    expect(shape.impact.amp).toHaveLength(13);
    expect(shape.template_diff).toHaveLength(mock.mesh().labels.length);

    // Exactly the five the backend serves, spelled its way, or the what-if target
    // picker would send a name the intervention route rejects.
    const rec = mock.receptors();
    expect(rec.names).toEqual(["GABA-A", "NMDA", "D2", "5-HT2A", "mu-opioid"]);
    for (const name of rec.names) expect(rec.maps[name]).toHaveLength(100);

    const loads = mock.loadings();
    const total = loads.weights[loads.signals[0]].reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 2);

    // The intervention what-if used to be checked here. It is gone: it simulated a
    // treatment response, which is the one thing this model must not claim to do. The
    // receptor maps above are what the pathway viewer that replaced it reads.
  });

  it("gives a cohort of 50 with coverage rising to the target", () => {
    const c = mock.cohort();
    expect(c.size).toBe(50);
    expect(c.k_true).toHaveLength(50);
    expect(c.effects.map((e) => e.name)).toEqual(["c_e4", "c_bio", "b_e4", "b_fe4"]);
    expect(c.coverage[0].cov).toBeLessThan(0.6);
    expect(c.coverage[12].cov).toBeGreaterThan(0.75);
  });

  it("gives a full call script with every task and a voice line per step", () => {
    const script = mock.callScript();
    const tasks = new Set(script.steps.map((s) => s.task));
    for (const task of ["redflags", "quality", "calib", "symptoms", "encode", "pursuit_h", "pursuit_v", "saccade", "antisaccade", "fixation", "npc", "speech_ah", "speech_pataka", "speech_passage", "picture", "fluency", "recall", "wrap"]) {
      expect(tasks.has(task as never)).toBe(true);
    }
    expect(script.words).toHaveLength(15);
    expect(script.redflag_items).toHaveLength(7);
    expect(script.symptom_items).toHaveLength(8);
    expect(script.voice_base).toBe("/voice/");
    expect(mock.voices().lines).toHaveLength(script.steps.length);
  });

  it("mutates the store when the demo advances a week", () => {
    const before = mock.patients().find((p) => p.id === "p2");
    mock.advanceWeek("p2");
    const after = mock.patients().find((p) => p.id === "p2");
    expect(after?.week).toBe((before?.week ?? 0) + 1);
    expect(mock.messages("p2").length).toBeGreaterThan(3);
  });

  it("mutates the store when drift is injected and an alert is acked", () => {
    const before = mock.patients().find((p) => p.id === "p1")?.drift_z ?? 0;
    mock.injectDrift("p1", 3);
    expect(mock.patients().find((p) => p.id === "p1")?.drift_z).toBeGreaterThan(before);

    const open = mock.alerts().filter((a) => !a.acked);
    expect(open.length).toBeGreaterThan(0);
    mock.ack(open[0].id);
    expect(mock.alerts().find((a) => a.id === open[0].id)?.acked).toBe(true);
  });

  it("walks a web call from link to summary", () => {
    const start = mock.createCall("p1", true);
    expect(start.token).toHaveLength(10);
    expect(mock.callStatus(start.token).state).toBe("waiting");

    mock.callConsent(start.token, { calls: true, ai: true, recording: true, genetic: false });
    const noFlags = { worsening_headache: false, repeated_vomiting: false, seizure: false,
      increasing_confusion: false, new_weakness_or_numbness: false, slurred_speech: false,
      unusual_drowsiness: false };
    expect(mock.callRedflags(start.token, noFlags).stop).toBe(false);
    expect(mock.callRedflags(start.token, { ...noFlags, seizure: true }).stop).toBe(true);

    const short = mock.callSymptoms(start.token, { headache: 9, fatigue: 8, nausea: 3 }, "baseline");
    expect(short.short).toBe(true);
    expect(short.skip.length).toBeGreaterThan(0);

    const finish = mock.callFinish(start.token, false);
    expect(finish.call_id).toBeTruthy();
    expect(mock.callStatus(start.token).state).toBe("processing");
  });

  it("resets back to the seeded cohort", () => {
    mock.reset();
    expect(mock.patients().find((p) => p.id === "p2")?.week).toBe(4);
  });
});
