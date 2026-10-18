// The eight viewer layers: colour ramp, plain language meaning, legend ticks and caveats.
// Pure TypeScript, no three import, so the side panels can use it without pulling the 3D
// bundle. The ramps here are the single source of truth: shaders.ts generates its GLSL
// colormap from these same stops, so a legend swatch and a lit region always agree.

export type LayerId =
  | "damage"
  | "uncertainty"
  | "healing"
  | "activity"
  | "ei"
  | "template"
  | "intervention"
  | "drivers"
  | "difference";

export interface Stop {
  /** Position along the ramp, 0 to 1. */
  at: number;
  rgb: [number, number, number];
}

export interface Tick {
  at: number;
  label: string;
}

export interface LayerDef {
  id: LayerId;
  label: string;
  /** One line of plain language shown under the switcher. */
  meaning: string;
  /** An extra honesty note, shown as a small caveat line when present. */
  note?: string;
  /** Set when the layer is a hypothesis rather than a measurement. */
  hypothesis?: boolean;
  /** Set when the layer only exists for clinicians. */
  clinicianOnly?: boolean;
  stops: Stop[];
  ticks: Tick[];
}

const ink: [number, number, number] = [0.05, 0.13, 0.17];

export const LAYERS: LayerDef[] = [
  {
    id: "damage",
    label: "Damage",
    meaning: "How far each region is from its healthy wiring at this week.",
    stops: [
      { at: 0, rgb: ink },
      { at: 0.35, rgb: [0.35, 0.3, 0.2] },
      { at: 0.65, rgb: [0.98, 0.62, 0.14] },
      { at: 1, rgb: [1, 0.2, 0.16] },
    ],
    ticks: [
      { at: 0, label: "none" },
      { at: 0.5, label: "0.5" },
      { at: 1, label: "1.0" },
    ],
  },
  {
    id: "uncertainty",
    label: "Uncertainty",
    meaning: "Where the twin is not sure yet. It shrinks as weeks of calls arrive.",
    note: "Width of the 10 to 90 percent band on this region's damage.",
    stops: [
      { at: 0, rgb: ink },
      { at: 0.5, rgb: [0.38, 0.33, 0.6] },
      { at: 1, rgb: [0.82, 0.78, 1] },
    ],
    ticks: [
      { at: 0, label: "tight" },
      { at: 1, label: "wide" },
    ],
  },
  {
    id: "healing",
    label: "Healing",
    meaning: "This patient's recovery rate against the typical patient. Above 1 is faster.",
    note: "The model has a single global recovery rate, so this layer is uniform across the cortex. Regional detail would need a regional k.",
    stops: [
      { at: 0, rgb: [0.85, 0.18, 0.18] },
      { at: 0.5, rgb: [0.92, 0.66, 0.2] },
      { at: 1, rgb: [0.25, 0.86, 0.45] },
    ],
    ticks: [
      { at: 0, label: "0.5x" },
      { at: 0.5, label: "1.0x" },
      { at: 1, label: "1.5x" },
    ],
  },
  {
    id: "activity",
    label: "Simulated activity",
    meaning: "Firing rate against healthy. Zero is healthy, below zero is firing too little.",
    stops: [
      { at: 0, rgb: [0.14, 0.4, 0.95] },
      { at: 0.5, rgb: [0.95, 0.95, 0.95] },
      { at: 1, rgb: [0.95, 0.25, 0.2] },
    ],
    ticks: [
      { at: 0, label: "-3" },
      { at: 0.5, label: "0" },
      { at: 1, label: "+3" },
    ],
  },
  {
    id: "ei",
    label: "Excitation and inhibition",
    meaning: "Local balance against the template. Blue is more inhibited, red is more excited.",
    stops: [
      { at: 0, rgb: [0.2, 0.55, 0.95] },
      { at: 0.5, rgb: [0.55, 0.53, 0.5] },
      { at: 1, rgb: [0.95, 0.35, 0.25] },
    ],
    ticks: [
      { at: 0, label: "-0.3" },
      { at: 0.5, label: "0" },
      { at: 1, label: "+0.3" },
    ],
  },
  {
    id: "template",
    label: "Template against personal",
    meaning: "Where this person's connectome is stronger or weaker than the template brain.",
    note: "Mean of personal weight minus template weight over the tracts touching each region.",
    stops: [
      { at: 0, rgb: [0.15, 0.75, 0.72] },
      { at: 0.5, rgb: [0.4, 0.4, 0.42] },
      { at: 1, rgb: [0.85, 0.3, 0.85] },
    ],
    ticks: [
      { at: 0, label: "weaker" },
      { at: 0.5, label: "same" },
      { at: 1, label: "stronger" },
    ],
  },
  {
    id: "intervention",
    label: "Intervention what-if",
    meaning: "Modelled change in firing rate from a receptor weighted gain change.",
    note: "Hypothetical visualization only. Not a treatment recommendation. Not shown to patients.",
    clinicianOnly: true,
    stops: [
      { at: 0, rgb: [0.62, 0.3, 0.95] },
      { at: 0.5, rgb: [0.1, 0.12, 0.16] },
      { at: 1, rgb: [0.2, 0.92, 0.82] },
    ],
    ticks: [
      { at: 0, label: "down" },
      { at: 0.5, label: "none" },
      { at: 1, label: "up" },
    ],
  },
  {
    id: "drivers",
    label: "Signal drivers",
    meaning: "Which regions the model leans on when it predicts one signal.",
    note: "Hypothesis from the signal to region loadings, not a measured cause.",
    hypothesis: true,
    stops: [
      { at: 0, rgb: ink },
      { at: 0.55, rgb: [0.16, 0.5, 0.6] },
      { at: 1, rgb: [0.4, 0.95, 1] },
    ],
    ticks: [
      { at: 0, label: "low" },
      { at: 1, label: "high" },
    ],
  },
  {
    id: "difference",
    label: "Damage difference",
    meaning: "Where one scenario leaves more damage than the other at this week.",
    note: "Only the scenario screen uses this layer. It needs two runs to compare.",
    stops: [
      { at: 0, rgb: [0.2, 0.86, 0.78] },
      { at: 0.5, rgb: [0.12, 0.14, 0.18] },
      { at: 1, rgb: [1, 0.46, 0.2] },
    ],
    ticks: [
      { at: 0, label: "-0.3" },
      { at: 0.5, label: "same" },
      { at: 1, label: "+0.3" },
    ],
  },
];

export const LAYER_BY_ID: Record<LayerId, LayerDef> = LAYERS.reduce(
  (acc, l) => {
    acc[l.id] = l;
    return acc;
  },
  {} as Record<LayerId, LayerDef>,
);

/** The GLSL smoothstep, so a legend swatch in CSS matches the lit mesh exactly. */
function smooth(a: number, b: number, x: number): number {
  if (a === b) return x < a ? 0 : 1;
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Colour at a position along a ramp, as three channels in 0 to 1. */
export function sampleRamp(stops: Stop[], at: number): [number, number, number] {
  const out: [number, number, number] = [...stops[0].rgb];
  for (let i = 1; i < stops.length; i++) {
    const k = smooth(stops[i - 1].at, stops[i].at, at);
    for (let c = 0; c < 3; c++) out[c] = out[c] + (stops[i].rgb[c] - out[c]) * k;
  }
  return out;
}

const byte = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255);

/** One ramp colour as a CSS rgb string. */
export function rampColor(stops: Stop[], at: number): string {
  const c = sampleRamp(stops, at);
  return `rgb(${byte(c[0])}, ${byte(c[1])}, ${byte(c[2])})`;
}

/** The whole ramp as a CSS gradient for the legend bar. */
export function rampGradient(stops: Stop[]): string {
  const steps = 12;
  const parts: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    parts.push(`${rampColor(stops, t)} ${Math.round(t * 100)}%`);
  }
  return `linear-gradient(90deg, ${parts.join(", ")})`;
}

/** Index of a layer in the shader's uLayer uniform. */
export const layerIndex = (id: LayerId): number => LAYERS.findIndex((l) => l.id === id);
