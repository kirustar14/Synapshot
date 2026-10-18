// The call state machine, tested without a camera, a network or a clock.

import { describe, expect, it } from "vitest";
import type { CallScript, ScriptStep } from "@/api/types";
import { FACE_GRACE_MS, current, init, minutesLeft, plan, progress, reduce } from "@/call/machine";
import type { State } from "@/call/machine";

const IDS = [
  "redflags",
  "quality",
  "calib",
  "symptoms",
  "encode",
  "pursuit_h",
  "pursuit_v",
  "saccade",
  "symptoms_rerate",
  "antisaccade",
  "fixation",
  "npc",
  "speech_ah",
  "speech_pataka",
  "speech_passage",
  "picture",
  "fluency",
  "recall",
  "wrap",
];

const TASKS: Record<string, ScriptStep["task"]> = {
  redflags: "redflags",
  quality: "quality",
  calib: "calib",
  symptoms: "symptoms",
  encode: "encode",
  pursuit_h: "pursuit_h",
  pursuit_v: "pursuit_v",
  saccade: "saccade",
  symptoms_rerate: "symptoms",
  antisaccade: "antisaccade",
  fixation: "fixation",
  npc: "npc",
  speech_ah: "speech_ah",
  speech_pataka: "speech_pataka",
  speech_passage: "speech_passage",
  picture: "picture",
  fluency: "fluency",
  recall: "recall",
  wrap: "wrap",
};

function script(): CallScript {
  return {
    consent: ["one", "two"],
    steps: IDS.map((id) => ({
      id,
      say: `line for ${id}`,
      audio: `${id}.mp3`,
      task: TASKS[id],
      minutes: 0.5,
      tier: "A",
      params: {},
    })),
    voice_base: "/voice/",
    symptom_items: ["headache", "fatigue"],
    redflag_items: ["one?", "two?"],
    words: ["apple"],
    passage: "a passage",
    picture: "kitchen",
    fluency_seconds: 60,
  };
}

/** Walks the machine forward and returns every slot id it visited. */
function walk(state: State, steps = 100): string[] {
  const seen: string[] = [];
  let at = state;
  for (let i = 0; i < steps; i += 1) {
    const slot = current(at);
    if (!slot) break;
    seen.push(slot.id);
    at = reduce(at, { type: "next" });
  }
  return seen;
}

describe("stage order", () => {
  it("starts at consent, then setup, then every script step in order", () => {
    const order = walk(init(script()));
    expect(order).toEqual(["consent", "setup", ...IDS]);
  });

  it("plans one slot per step plus consent and setup", () => {
    expect(plan(script())).toHaveLength(IDS.length + 2);
  });

  it("ends after the last step and reports full progress", () => {
    let state = init(script());
    for (let i = 0; i < IDS.length + 2; i += 1) state = reduce(state, { type: "next" });
    expect(current(state)).toBeNull();
    expect(state.ended).toBe(true);
    expect(progress(state)).toBe(1);
  });

  it("counts down the minutes left as it goes", () => {
    const state = init(script());
    const before = minutesLeft(state);
    const later = minutesLeft(reduce(reduce(state, { type: "next" }), { type: "next" }));
    expect(later).toBeLessThan(before);
  });
});

describe("the short version", () => {
  it("skips every step the symptom route named", () => {
    let state = init(script());
    state = reduce(state, { type: "skip", ids: ["antisaccade", "fixation", "npc", "fluency"] });
    const order = walk(state);
    expect(order).not.toContain("antisaccade");
    expect(order).not.toContain("fixation");
    expect(order).not.toContain("npc");
    expect(order).not.toContain("fluency");
    expect(order).toContain("speech_ah");
    expect(order[order.length - 1]).toBe("wrap");
  });

  it("jumps straight past a skipped step when it is the next one", () => {
    let state = init(script());
    while (current(state)?.id !== "saccade") state = reduce(state, { type: "next" });
    state = reduce(state, { type: "skip", ids: ["symptoms_rerate", "antisaccade"] });
    state = reduce(state, { type: "next" });
    expect(current(state)?.id).toBe("fixation");
  });

  it("never skips a step twice over", () => {
    let state = init(script());
    state = reduce(state, { type: "skip", ids: ["npc"] });
    state = reduce(state, { type: "skip", ids: ["npc", "fluency"] });
    expect(state.skip).toEqual(["npc", "fluency"]);
  });

  it("leaves the total progress consistent when steps are dropped", () => {
    let state = init(script());
    state = reduce(state, { type: "skip", ids: ["antisaccade", "fixation"] });
    const order = walk(state);
    expect(order).toHaveLength(IDS.length + 2 - 2);
  });
});

describe("stopping on a red flag", () => {
  it("stops the call and keeps the wording the backend sent", () => {
    let state = init(script());
    state = reduce(state, { type: "next" });
    state = reduce(state, { type: "next" });
    expect(current(state)?.id).toBe("redflags");
    state = reduce(state, { type: "stop", say: "Please get help now.", audio: "emergency.mp3" });
    expect(state.stopped).toBe(true);
    expect(state.stopSay).toBe("Please get help now.");
    expect(state.stopAudio).toBe("emergency.mp3");
    expect(current(state)).toBeNull();
  });

  it("ignores everything after a stop", () => {
    let state = reduce(init(script()), { type: "stop", say: "stop here" });
    const frozen = state;
    state = reduce(state, { type: "next" });
    state = reduce(state, { type: "resume" });
    state = reduce(state, { type: "skip", ids: ["wrap"] });
    state = reduce(state, { type: "face", seen: false, t: 99999 });
    expect(state).toBe(frozen);
  });
});

describe("pausing", () => {
  /** Moves the machine to one step by id. */
  function at(id: string): State {
    let state = init(script());
    while (current(state) && current(state)?.id !== id) state = reduce(state, { type: "next" });
    return state;
  }

  it("pauses an eye task when the face has been gone for three seconds", () => {
    let state = at("pursuit_h");
    state = reduce(state, { type: "face", seen: false, t: 1000 });
    expect(state.paused).toBe(false);
    state = reduce(state, { type: "face", seen: false, t: 1000 + FACE_GRACE_MS - 1 });
    expect(state.paused).toBe(false);
    state = reduce(state, { type: "face", seen: false, t: 1000 + FACE_GRACE_MS });
    expect(state.paused).toBe(true);
    expect(state.why).toBe("face");
  });

  it("does not pause a speaking task when the face goes missing", () => {
    let state = at("speech_passage");
    state = reduce(state, { type: "face", seen: false, t: 0 });
    state = reduce(state, { type: "face", seen: false, t: 20000 });
    expect(state.paused).toBe(false);
  });

  it("resumes on its own once the face comes back, and counts the retry", () => {
    let state = at("saccade");
    state = reduce(state, { type: "face", seen: false, t: 0 });
    state = reduce(state, { type: "face", seen: false, t: FACE_GRACE_MS });
    expect(state.paused).toBe(true);
    state = reduce(state, { type: "face", seen: true, t: FACE_GRACE_MS + 400 });
    expect(state.paused).toBe(false);
    expect(state.attempt).toBe(1);
  });

  it("forgets a brief blink rather than counting it towards the three seconds", () => {
    let state = at("fixation");
    state = reduce(state, { type: "face", seen: false, t: 0 });
    state = reduce(state, { type: "face", seen: true, t: 500 });
    expect(state.faceSince).toBeNull();
    state = reduce(state, { type: "face", seen: false, t: 1000 });
    state = reduce(state, { type: "face", seen: false, t: 1000 + FACE_GRACE_MS - 1 });
    expect(state.paused).toBe(false);
  });

  it("pauses and resumes when the patient asks, and clears the pause on the next step", () => {
    let state = at("calib");
    state = reduce(state, { type: "pause", why: "patient" });
    expect(state.paused).toBe(true);
    state = reduce(state, { type: "resume" });
    expect(state.paused).toBe(false);
    state = reduce(state, { type: "pause", why: "hidden" });
    state = reduce(state, { type: "next" });
    expect(state.paused).toBe(false);
    expect(state.attempt).toBe(0);
  });
});
