// Call-only UI state. Nothing in here belongs to any other screen, which is why it is its
// own store rather than part of src/store/app.ts.
//
// The accessibility choices persist, because a patient who needs large text needs it every
// week and should not have to find the button again.

import { create } from "zustand";

const KEY = "unnamed-call-prefs";

export interface Prefs {
  bigText: boolean;
  contrast: boolean;
  reduceMotion: boolean;
  captions: boolean;
  muted: boolean;
}

interface CallState extends Prefs {
  /** A calm one line banner, or an empty string for none. */
  banner: string;
  /** How many measurement posts are still waiting to land. */
  pending: number;
  set: (p: Partial<Prefs>) => void;
  setBanner: (text: string) => void;
  setPending: (count: number) => void;
}

const systemReduce =
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;

function read(): Prefs {
  const base: Prefs = { bigText: false, contrast: false, reduceMotion: systemReduce, captions: true, muted: false };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    return { ...base, ...(JSON.parse(raw) as Partial<Prefs>) };
  } catch {
    return base;
  }
}

function write(prefs: Prefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // Private browsing can block storage. The choice still applies for this call.
  }
}

export const useCallStore = create<CallState>((set, get) => ({
  ...read(),
  banner: "",
  pending: 0,
  set: (p) => {
    const next = { ...get(), ...p };
    write({
      bigText: next.bigText,
      contrast: next.contrast,
      reduceMotion: next.reduceMotion,
      captions: next.captions,
      muted: next.muted,
    });
    set(p);
  },
  setBanner: (banner) => set({ banner }),
  setPending: (pending) => set({ pending }),
}));

export { KEY as PREFS_KEY };
