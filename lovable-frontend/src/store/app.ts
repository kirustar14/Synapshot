import { create } from "zustand";
import type { Scenario } from "@/api/types";

export interface ScenarioSlot { id: string; label: string; scenario: Scenario }

interface AppState {
  selectedPatient: string | null;
  setSelectedPatient: (id: string | null) => void;
  scenarios: ScenarioSlot[];
  setScenarios: (s: ScenarioSlot[]) => void;
  demoUnlocked: boolean;
  setDemoUnlocked: (v: boolean) => void;
  dark: boolean;
  setDark: (v: boolean) => void;
  demo: { driftSize: number; lastAction: string | null; ringing: boolean };
  setDemo: (d: Partial<AppState["demo"]>) => void;
}

export const useApp = create<AppState>((set) => ({
  selectedPatient: null,
  setSelectedPatient: (id) => set({ selectedPatient: id }),
  scenarios: [
    { id: "s1", label: "Scenario 1", scenario: { helmet: "A", angle_deg: 30 } },
    { id: "s2", label: "Scenario 2", scenario: { helmet: "B", angle_deg: 30 } },
  ],
  setScenarios: (scenarios) => set({ scenarios }),
  demoUnlocked: false,
  setDemoUnlocked: (v) => set({ demoUnlocked: v }),
  dark: false,
  setDark: (v) => set({ dark: v }),
  demo: { driftSize: 1.5, lastAction: null, ringing: false },
  setDemo: (d) => set((s) => ({ demo: { ...s.demo, ...d } })),
}));
