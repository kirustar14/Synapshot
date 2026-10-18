// The bookkeeping every measured task shares.
//
// A task marker goes into the stimulus log before the first frame is buffered, because the
// backend finds a task's gaze trace by looking between that marker and the next one. When a
// task ends it posts its own frames and its own slice of the stimulus log. When a task is
// abandoned, because the face went missing or the patient paused, its frames are thrown away
// and a new marker is written on the retry, so the backend sees one clean window.

import { useCallback, useEffect, useRef } from "react";
import { useCall } from "./ctx";

export interface Measured {
  /** Page clock time of the task marker, which is the zero of the task's own timeline. */
  start: React.RefObject<number>;
  /** Posts the frames and the stimulus log, then nothing more is kept. */
  finish: () => void;
}

/** Starts buffering frames for one task and posts them when it finishes. */
export function useMeasured(task: string, params: Record<string, unknown>): Measured {
  const { stim, post, tracker } = useCall();
  const start = useRef(0);
  const posted = useRef(false);
  const keep = useRef({ task, params });
  keep.current = { task, params };

  useEffect(() => {
    tracker.record(true);
    start.current = stim.mark(keep.current.task, keep.current.params);
    return () => {
      tracker.record(false);
      if (!posted.current) {
        tracker.drop();
        stim.clear();
      }
    };
  }, [stim, tracker]);

  const finish = useCallback(() => {
    if (posted.current) return;
    posted.current = true;
    tracker.record(false);
    post.frames(task, tracker.take(), stim.drain());
  }, [post, stim, task, tracker]);

  return { start, finish };
}

/** A balanced left and right order for a trial based task, shuffled once. */
export function sides(trials: number): Array<"L" | "R"> {
  const out: Array<"L" | "R"> = [];
  for (let i = 0; i < trials; i += 1) out.push(i % 2 === 0 ? "L" : "R");
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const swap = out[i];
    out[i] = out[j];
    out[j] = swap;
  }
  return out;
}

/** Gaps between trials, jittered so the patient cannot learn the rhythm. */
export function gaps(trials: number, base: number): number[] {
  return Array.from({ length: trials }, () => base * (0.75 + Math.random() * 0.5));
}
