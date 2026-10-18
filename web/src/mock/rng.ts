// Seeded randomness for the mock layer. Math.random is never used here, so every reload
// shows the same cohort and the same charts.

export interface Rng {
  next: () => number;
  normal: () => number;
  pick: <T>(arr: readonly T[]) => T;
  range: (lo: number, hi: number) => number;
  int: (lo: number, hi: number) => number;
}

/** Mulberry32. Small, fast, good enough for fixture data, fully deterministic from the seed. */
export function rng(seed: number): Rng {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const normal = () => {
    const u = Math.max(next(), 1e-9);
    const v = next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  return {
    next,
    normal,
    pick: <T,>(arr: readonly T[]) => arr[Math.floor(next() * arr.length)],
    range: (lo: number, hi: number) => lo + next() * (hi - lo),
    int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
  };
}

/** FNV-1a, so a string id can seed a generator and always give the same patient. */
export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
