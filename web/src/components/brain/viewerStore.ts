// Viewer only state. It lives here rather than in store/app.ts so the brain components own
// their own controls, and so the two brains on the compare screen share a week, a layer and
// a camera without either page wiring it up.

import { create } from "zustand";
import type { LayerId } from "./layers";

export const WEEK_MAX = 12;
export const RECEPTOR_TARGETS = ["GABA-A", "NMDA", "D2", "5-HT2A", "mu-opioid"] as const;
export type ReceptorTarget = (typeof RECEPTOR_TARGETS)[number];

export type ViewPreset = "left" | "right" | "top" | "front";
export type HemiMode = "both" | "split" | "L" | "R";

/** Seconds the injury replay runs for before it hands over to the week player. */
export const REPLAY_SECONDS = 6;

export interface CameraPose {
  position: [number, number, number];
  target: [number, number, number];
}

interface ViewerState {
  layer: LayerId;
  setLayer: (l: LayerId) => void;

  /** Week 0 to 12. Fractional while the player is running so damage fades smoothly. */
  week: number;
  setWeek: (w: number) => void;
  playing: boolean;
  setPlaying: (v: boolean) => void;
  speed: number;
  setSpeed: (v: number) => void;

  inflate: number;
  personal: number;
  setInflate: (v: number) => void;
  setPersonal: (v: number) => void;

  hologram: boolean;
  reduceMotion: boolean;
  tracts: boolean;
  borders: boolean;
  ghost: boolean;
  callouts: boolean;
  hemi: HemiMode;
  setFlag: (patch: Partial<Pick<ViewerState, "hologram" | "reduceMotion" | "tracts" | "borders" | "ghost" | "callouts">>) => void;
  setHemi: (h: HemiMode) => void;

  hovered: number | null;
  selected: number | null;
  setHovered: (id: number | null) => void;
  setSelected: (id: number | null) => void;
  /** Which person panel row is under the cursor, so the mesh can show what that input does. */
  highlight: string | null;
  setHighlight: (key: string | null) => void;

  selectedTract: number | null;
  setSelectedTract: (i: number | null) => void;

  /** Replay clock in seconds, or null when the replay is not running. */
  replay: number | null;
  replayPaused: boolean;
  startReplay: () => void;
  stopReplay: () => void;
  setReplay: (t: number | null) => void;
  setReplayPaused: (v: boolean) => void;

  signal: string | null;
  setSignal: (s: string | null) => void;

  target: ReceptorTarget;
  gain: number;
  showReceptorMap: boolean;
  setWhatIf: (patch: Partial<Pick<ViewerState, "target" | "gain" | "showReceptorMap">>) => void;

  /** Counterfactual sliders. recoveryMult tints the healing layer when on. */
  cfOn: boolean;
  recoveryMult: number;
  permShift: number;
  setCf: (patch: Partial<Pick<ViewerState, "cfOn" | "recoveryMult" | "permShift">>) => void;

  preset: { name: ViewPreset; stamp: number } | null;
  setPreset: (name: ViewPreset) => void;

  /** Shared camera for the compare screen. The viewer being dragged owns it. */
  camLeader: string | null;
  camPose: CameraPose | null;
  claimCamera: (id: string | null) => void;
  pushCamera: (pose: CameraPose) => void;

  diffMode: boolean;
  setDiffMode: (v: boolean) => void;
}

const prefersReduced =
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;

export const useViewer = create<ViewerState>((set) => ({
  layer: "damage",
  setLayer: (layer) => set({ layer }),

  week: 0,
  setWeek: (week) => set({ week: Math.min(WEEK_MAX, Math.max(0, week)) }),
  playing: false,
  setPlaying: (playing) => set({ playing }),
  speed: 1,
  setSpeed: (speed) => set({ speed }),

  inflate: 0,
  personal: 1,
  setInflate: (inflate) => set({ inflate }),
  setPersonal: (personal) => set({ personal }),

  hologram: true,
  reduceMotion: prefersReduced,
  tracts: true,
  borders: true,
  ghost: true,
  callouts: true,
  hemi: "both",
  setFlag: (patch) => set(patch),
  setHemi: (hemi) => set({ hemi }),

  hovered: null,
  selected: null,
  setHovered: (hovered) => set({ hovered }),
  setSelected: (selected) => set({ selected }),
  highlight: null,
  setHighlight: (highlight) => set({ highlight }),

  selectedTract: null,
  setSelectedTract: (selectedTract) => set({ selectedTract }),

  replay: null,
  replayPaused: false,
  startReplay: () => set({ replay: 0, replayPaused: false, playing: false, week: 0 }),
  stopReplay: () => set({ replay: null, replayPaused: false, playing: false }),
  setReplay: (replay) => set({ replay }),
  setReplayPaused: (replayPaused) => set({ replayPaused }),

  signal: null,
  setSignal: (signal) => set({ signal }),

  target: "GABA-A",
  gain: 0,
  showReceptorMap: false,
  setWhatIf: (patch) => set(patch),

  cfOn: false,
  recoveryMult: 1,
  permShift: 0,
  setCf: (patch) => set(patch),

  preset: null,
  setPreset: (name) => set({ preset: { name, stamp: Date.now() } }),

  camLeader: null,
  camPose: null,
  claimCamera: (camLeader) => set({ camLeader }),
  pushCamera: (camPose) => set({ camPose }),

  diffMode: false,
  setDiffMode: (diffMode) => set({ diffMode }),
}));

/** Reads the week the player should show, which the replay drives while it runs. */
export function replayWeek(elapsed: number): number {
  const scrubStart = REPLAY_SECONDS * 0.55;
  if (elapsed <= scrubStart) return 0;
  const span = REPLAY_SECONDS - scrubStart;
  return Math.min(WEEK_MAX, ((elapsed - scrubStart) / span) * WEEK_MAX);
}
