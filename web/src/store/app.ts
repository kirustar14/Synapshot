// App-wide UI state. Everything here is a user choice, never server data: server data lives
// in TanStack Query. Dark mode and the demo unlock are mirrored into localStorage.

import { create } from "zustand";
import type { Scenario } from "@/api/types";

const DARK_KEY = "synapshot-dark";
// Demo mode: run the check-in here on this laptop's webcam instead of texting a link to
// a phone. Persisted, because it is a property of the machine you are demoing on.
const DEMO_KEY = "synapshot-demo-mode";

export interface ScenarioSlot {
  id: string;
  label: string;
  scenario: Scenario;
}

export type Layer = "damage" | "activity" | "ei" | "template_diff";

export interface ViewerSettings {
  layer: Layer;
  week: number;
  /** 0 is the pial surface, 1 is fully inflated. */
  inflate: number;
  /** 0 is the template, 1 is the patient's own shape. */
  personalization: number;
  hologram: boolean;
  reduceMotion: boolean;
  tracts: boolean;
}

interface AppState {
  selectedPatient: string | null;
  setSelectedPatient: (id: string | null) => void;

  dark: boolean;
  setDark: (v: boolean) => void;

  demoMode: boolean;
  setDemoMode: (v: boolean) => void;

  scenarios: ScenarioSlot[];
  setScenarios: (s: ScenarioSlot[]) => void;

  viewer: ViewerSettings;
  setViewer: (v: Partial<ViewerSettings>) => void;

  demo: { driftSize: number; lastAction: string | null; ringing: boolean };
  setDemo: (d: Partial<AppState["demo"]>) => void;
}

/** Reads a persisted flag without throwing when storage is blocked or absent. */
function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeFlag(key: string, value: boolean) {
  try {
    localStorage.setItem(key, value ? "1" : "0");
  } catch {
    // Private browsing can block storage. The session still works, it just does not persist.
  }
}

const prefersReducedMotion =
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;

export const useApp = create<AppState>((set) => ({
  selectedPatient: null,
  setSelectedPatient: (id) => set({ selectedPatient: id }),

  dark: readFlag(DARK_KEY),
  setDark: (v) => {
    writeFlag(DARK_KEY, v);
    set({ dark: v });
  },

  demoMode: readFlag(DEMO_KEY),
  setDemoMode: (v) => {
    writeFlag(DEMO_KEY, v);
    set({ demoMode: v });
  },

  scenarios: [
    { id: "s1", label: "Scenario 1", scenario: { helmet: "A", angle_deg: 30 } },
    { id: "s2", label: "Scenario 2", scenario: { helmet: "B", angle_deg: 30 } },
  ],
  setScenarios: (scenarios) => set({ scenarios }),

  viewer: {
    layer: "damage",
    week: 0,
    inflate: 0,
    personalization: 1,
    hologram: true,
    reduceMotion: prefersReducedMotion,
    tracts: true,
  },
  setViewer: (v) => set((s) => ({ viewer: { ...s.viewer, ...v } })),

  demo: { driftSize: 1.5, lastAction: null, ringing: false },
  setDemo: (d) => set((s) => ({ demo: { ...s.demo, ...d } })),
}));

export { DARK_KEY, DEMO_KEY };
