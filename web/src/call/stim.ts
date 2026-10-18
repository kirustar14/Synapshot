// The stimulus log: exactly what the page drew, timed on the same clock as the frames.
//
// The names here are part of the contract. The backend finds each task's gaze window from
// "task", builds the camera latency estimate from "test_flash", fits the calibration on
// "calib_dot", and reads reaction times from "saccade_jump" and "antisaccade_jump". Rename
// one and that measurement quietly stops working.

import { now } from "./clock";
import type { Stim } from "./types";

export class StimLog {
  private rows: Stim[] = [];

  /** Every task that produces frames logs this first. Returns the marker time. */
  mark(task: string, params: Record<string, unknown> = {}): number {
    const t = now();
    this.rows.push({ t, kind: "task", task, params });
    return t;
  }

  /** One of the ten camera latency flashes, at the timestamp of the frame that painted it. */
  flash(trial: number, t: number): void {
    this.rows.push({ t, kind: "test_flash", flash: true, trial });
  }

  /** One calibration dot, at the exact canvas fractions it was drawn at. */
  dot(x: number, y: number, t?: number): void {
    this.rows.push({ t: t ?? now(), kind: "calib_dot", x, y });
  }

  /** One saccade or antisaccade trial, at the timestamp of its white flash frame. */
  jump(
    kind: "saccade_jump" | "antisaccade_jump",
    trial: number,
    side: "L" | "R",
    x: number,
    y: number,
    t: number,
  ): void {
    this.rows.push({ t, kind, flash: true, trial, side, x, y });
  }

  /** Where a moving target sat on one painted frame. */
  target(kind: string, x: number, y: number, t: number): void {
    this.rows.push({ t, kind, x, y });
  }

  /** Anything else worth recording, such as the near point break the patient tapped. */
  note(kind: string, x?: number): void {
    this.rows.push(x === undefined ? { t: now(), kind } : { t: now(), kind, x });
  }

  /** Everything logged so far, oldest first, leaving the log empty. */
  drain(): Stim[] {
    const out = this.rows;
    this.rows = [];
    out.sort((a, b) => a.t - b.t);
    return out;
  }

  /** Throws away the current log, used when a task is retried after a pause. */
  clear(): void {
    this.rows = [];
  }
}
