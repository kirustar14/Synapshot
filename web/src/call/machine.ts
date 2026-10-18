// The call state machine. Pure: no DOM, no network, no clock of its own, so the whole
// running order can be tested without a camera.
//
// The order is consent, then setup, then every step the script returned, in the order the
// script returned them. The script already starts with the red flag screen, the quality
// check and calibration, so those are not special cased here.

import type { CallScript, ScriptStep } from "@/api/types";

/** How long the face may be missing inside a measured task before the call pauses. */
export const FACE_GRACE_MS = 3000;

/** Tasks that measure the eyes, where losing the face spoils the trial. */
export const WATCHED: readonly string[] = [
  "quality",
  "calib",
  "pursuit_h",
  "pursuit_v",
  "saccade",
  "antisaccade",
  "fixation",
  "picture",
];

export type SlotKind = "consent" | "setup" | "step";

export interface Slot {
  kind: SlotKind;
  id: string;
  step: ScriptStep | null;
  minutes: number;
}

export type PauseReason = "patient" | "face" | "hidden";

export interface State {
  slots: Slot[];
  at: number;
  /** Step ids the symptom route told us not to run. */
  skip: string[];
  paused: boolean;
  why: PauseReason | null;
  /** Set when the backend answered a red flag with stop. The page never decides this. */
  stopped: boolean;
  stopSay: string;
  stopAudio: string;
  /** True once the last slot is behind us. */
  ended: boolean;
  /** When the face first went missing, on the page clock. */
  faceSince: number | null;
  /** How many times the current slot has been restarted after a pause. */
  attempt: number;
}

export type Action =
  | { type: "next" }
  | { type: "skip"; ids: string[] }
  | { type: "stop"; say: string; audio?: string }
  | { type: "pause"; why: PauseReason }
  | { type: "resume" }
  | { type: "face"; seen: boolean; t: number }
  | { type: "end" };

/** The slot list for one script: consent, setup, then every step in order. */
export function plan(script: CallScript): Slot[] {
  const out: Slot[] = [
    { kind: "consent", id: "consent", step: null, minutes: 1 },
    { kind: "setup", id: "setup", step: null, minutes: 1 },
  ];
  for (const step of script.steps) {
    out.push({ kind: "step", id: step.id, step, minutes: Math.max(0.1, step.minutes) });
  }
  return out;
}

/** Fresh state at the consent screen. */
export function init(script: CallScript): State {
  return {
    slots: plan(script),
    at: 0,
    skip: [],
    paused: false,
    why: null,
    stopped: false,
    stopSay: "",
    stopAudio: "",
    ended: false,
    faceSince: null,
    attempt: 0,
  };
}

/** The slot the page is showing, or null when the call stopped or ended. */
export function current(state: State): Slot | null {
  if (state.stopped || state.ended) return null;
  return state.slots[state.at] ?? null;
}

/** The task the current slot runs, or "none" when it is consent, setup or a spoken step. */
export function task(state: State): string {
  const slot = current(state);
  return slot?.step?.task ?? "none";
}

/** True when the current task measures the eyes, so a lost face has to pause it. */
export function watched(state: State): boolean {
  return WATCHED.includes(task(state));
}

/** How far through the call we are, weighted by each step's own minutes. */
export function progress(state: State): number {
  const total = state.slots.reduce((sum, s) => sum + (state.skip.includes(s.id) ? 0 : s.minutes), 0);
  if (total <= 0) return 0;
  let done = 0;
  for (let i = 0; i < state.slots.length && i < state.at; i += 1) {
    const slot = state.slots[i];
    if (!state.skip.includes(slot.id)) done += slot.minutes;
  }
  if (state.ended) return 1;
  return Math.min(1, done / total);
}

/** Minutes of script still ahead, rounded for the patient facing label. */
export function minutesLeft(state: State): number {
  let left = 0;
  for (let i = state.at; i < state.slots.length; i += 1) {
    const slot = state.slots[i];
    if (!state.skip.includes(slot.id)) left += slot.minutes;
  }
  return Math.max(0, Math.round(left));
}

/** Moves to the next slot that is not on the skip list. */
function step(state: State): State {
  let i = state.at + 1;
  while (i < state.slots.length && state.skip.includes(state.slots[i].id)) i += 1;
  if (i >= state.slots.length) {
    return { ...state, at: state.slots.length, ended: true, paused: false, why: null, faceSince: null };
  }
  return { ...state, at: i, paused: false, why: null, faceSince: null, attempt: 0 };
}

/** Pause and resume driven by whether the camera can see a face. */
function face(state: State, seen: boolean, t: number): State {
  if (seen) {
    if (state.paused && state.why === "face") return { ...state, paused: false, why: null, faceSince: null, attempt: state.attempt + 1 };
    return state.faceSince === null ? state : { ...state, faceSince: null };
  }
  if (!watched(state) || state.paused) return state;
  const since = state.faceSince ?? t;
  if (t - since >= FACE_GRACE_MS) return { ...state, faceSince: since, paused: true, why: "face" };
  return state.faceSince === since ? state : { ...state, faceSince: since };
}

/** The one reducer. Once stopped, nothing moves again. */
export function reduce(state: State, action: Action): State {
  if (state.stopped) return state;
  switch (action.type) {
    case "next":
      return state.ended ? state : step(state);
    case "skip": {
      const merged = state.skip.slice();
      for (const id of action.ids) if (!merged.includes(id)) merged.push(id);
      return { ...state, skip: merged };
    }
    case "stop":
      return { ...state, stopped: true, paused: false, why: null, stopSay: action.say, stopAudio: action.audio ?? "" };
    case "pause":
      return state.paused ? state : { ...state, paused: true, why: action.why };
    case "resume":
      return state.paused ? { ...state, paused: false, why: null, faceSince: null, attempt: state.attempt + 1 } : state;
    case "face":
      return face(state, action.seen, action.t);
    case "end":
      return { ...state, ended: true, at: state.slots.length, paused: false, why: null };
    default:
      return state;
  }
}
