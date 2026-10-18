// Types the call page needs on top of the shared contract in src/api/types.ts. Nothing here
// is sent to the backend unchanged except Stim and Meta, which match the contract exactly
// plus the two extra fields the task marker carries.

import type { ScriptStep, StimEvent } from "@/api/types";

/** A stimulus event. `task` and `params` ride on the task marker only. */
export interface Stim extends StimEvent {
  task?: string;
  params?: Record<string, unknown>;
}

/** What the page is running on. Sent with every frame chunk. */
export interface Meta {
  w_px: number;
  h_px: number;
  dpr: number;
  ua: string;
  fps: number;
}

/** The four setup checks plus the raw numbers behind them. */
export interface Lights {
  face: boolean;
  dist: boolean;
  light: boolean;
  steady: boolean;
  fps: number;
  iris_px: number;
  bright: number;
}

export const NO_LIGHTS: Lights = {
  face: false,
  dist: false,
  light: false,
  steady: false,
  fps: 0,
  iris_px: 0,
  bright: 0,
};

/** Where the stimulus is right now, in fractions of the stimulus canvas. */
export interface Point {
  x: number;
  y: number;
}

/** Every task component takes the step it is running and says when it is finished. */
export interface TaskProps {
  step: ScriptStep;
  onDone: () => void;
}

/** Reads a number out of a step's params, with a default when the backend omitted it. */
export function num(params: Record<string, unknown>, key: string, fallback: number): number {
  const v = params[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/** Reads a list of strings out of a step's params. */
export function strings(params: Record<string, unknown>, key: string): string[] {
  const v = params[key];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}
