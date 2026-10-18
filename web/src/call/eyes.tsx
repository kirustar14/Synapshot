// The drawn tasks: the camera latency flashes, calibration, pursuit, saccades,
// antisaccades and fixation.
//
// Three rules hold across all of them. The stimulus surface is dark with a bright target,
// which is both the standard for oculomotor testing and the best contrast for the camera.
// Every position that is logged is the fraction of this canvas it was actually drawn at, so
// a different phone or a different layout still calibrates. And every flash is logged with
// the rAF timestamp of the frame that painted it, because that timestamp is what the camera
// latency estimate is subtracted from.

import { useEffect, useRef, useState } from "react";
import { useCanvas } from "./canvas";
import { useCall } from "./ctx";
import { gaps, sides, useMeasured } from "./measure";
import { StimSurface } from "./ui";
import { num } from "./types";
import type { TaskProps } from "./types";

const BACK = "#0b0f12";
const DOT = "#f4f8f9";
const RING = "#5cc9bd";
const FLASH = "#ffffff";

/** A small label in the corner so the patient always knows where they are. */
function Tag({ text }: { text: string }) {
  return (
    <p className="pointer-events-none absolute inset-x-0 bottom-6 text-center text-xs text-white/60">{text}</p>
  );
}

function fill(ctx: CanvasRenderingContext2D, w: number, h: number, colour: string) {
  ctx.fillStyle = colour;
  ctx.fillRect(0, 0, w, h);
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, colour = DOT) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = colour;
  ctx.fill();
}

/* ---------------------------------------------------------------- quality and flashes */

/** Ten white flashes, spaced about 1.5 s apart with jitter, never exactly regularly. */
export function QualityTask({ step, onDone }: TaskProps) {
  const { stim, setTarget } = useCall();
  const trials = Math.round(num(step.params, "flashes", 10));
  const { finish } = useMeasured("quality", step.params);
  const [shown, setShown] = useState(0);
  const state = useRef({ at: 0, nextAt: 0, flashing: false, over: false });

  const ref = useCanvas((ctx, t, w, h) => {
    const s = state.current;
    if (!s.nextAt) s.nextAt = t + 1600;
    if (s.flashing) {
      s.flashing = false;
      fill(ctx, w, h, BACK);
      dot(ctx, w / 2, h / 2, 9);
      return;
    }
    if (s.at < trials && t >= s.nextAt) {
      fill(ctx, w, h, FLASH);
      // Logged with the timestamp of this painted frame, which is the whole point.
      stim.flash(s.at, t);
      s.at += 1;
      s.flashing = true;
      s.nextAt = t + 1250 + Math.random() * 500;
      setShown(s.at);
      return;
    }
    fill(ctx, w, h, BACK);
    dot(ctx, w / 2, h / 2, 9);
    if (s.at >= trials && !s.over && t >= s.nextAt + 400) {
      s.over = true;
      finish();
      onDone();
    }
  }, true);

  useEffect(() => {
    setTarget({ x: 0.5, y: 0.5 });
  }, [setTarget]);

  return (
    <StimSurface canvasRef={ref}>
      <Tag text={`Keep looking at the centre dot. ${shown} of ${trials} light checks`} />
    </StimSurface>
  );
}

/* ---------------------------------------------------------------- calibration */

const COLS = [0.15, 0.5, 0.85];
const ROWS = [0.2, 0.5, 0.8];
const GRID = ROWS.flatMap((y) => COLS.map((x) => ({ x, y })));

/** Nine dots, one second each, every one logged at the fraction it was drawn at. */
export function CalibTask({ step, onDone }: TaskProps) {
  const { stim, setTarget } = useCall();
  const hold = num(step.params, "hold_ms", 1000);
  const { finish } = useMeasured("calib", step.params);
  const [at, setAt] = useState(0);
  const state = useRef({ at: -1, until: 0, over: false });

  const ref = useCanvas((ctx, t, w, h) => {
    const s = state.current;
    if (s.at < 0) {
      s.at = 0;
      s.until = t + hold;
      const first = GRID[0];
      stim.dot(first.x, first.y, t);
      setTarget(first);
      setAt(0);
    } else if (t >= s.until && s.at < GRID.length - 1) {
      s.at += 1;
      s.until = t + hold;
      const spot = GRID[s.at];
      stim.dot(spot.x, spot.y, t);
      setTarget(spot);
      setAt(s.at);
    }
    fill(ctx, w, h, BACK);
    const spot = GRID[s.at];
    const left = Math.max(0, (s.until - t) / hold);
    dot(ctx, spot.x * w, spot.y * h, 11);
    ctx.beginPath();
    ctx.arc(spot.x * w, spot.y * h, 11 + 16 * left, 0, Math.PI * 2);
    ctx.strokeStyle = RING;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    if (!s.over && s.at >= GRID.length - 1 && t >= s.until) {
      s.over = true;
      finish();
      onDone();
    }
  }, true);

  return (
    <StimSurface canvasRef={ref}>
      <Tag text={`Look straight at each dot. ${at + 1} of ${GRID.length}`} />
    </StimSurface>
  );
}

/* ---------------------------------------------------------------- pursuit */

/** A dot moving as a sine. The target is logged on every painted frame. */
export function PursuitTask({ step, onDone }: TaskProps) {
  const { stim, setTarget } = useCall();
  const vertical = step.task === "pursuit_v";
  const amp = num(step.params, "amp", num(step.params, "amplitude", 0.35));
  // The backend rebuilds this target as amp * sin(2 pi freq t) + 0.5, so the names match.
  const freq = num(step.params, "freq", num(step.params, "hz", vertical ? 0.3 : 0.4));
  const seconds = num(step.params, "seconds", 20);
  const { start, finish } = useMeasured(step.task, { amp, freq, seconds });
  const over = useRef(false);

  const ref = useCanvas((ctx, t, w, h) => {
    const secs = Math.max(0, (t - start.current) / 1000);
    const swing = amp * Math.sin(2 * Math.PI * freq * secs) + 0.5;
    const fx = vertical ? 0.5 : swing;
    const fy = vertical ? swing : 0.5;
    stim.target(vertical ? "pursuit_v_target" : "pursuit_h_target", fx, fy, t);
    setTarget({ x: fx, y: fy });
    fill(ctx, w, h, BACK);
    dot(ctx, fx * w, fy * h, 13);
    if (!over.current && secs >= seconds) {
      over.current = true;
      finish();
      onDone();
    }
  }, true);

  return (
    <StimSurface canvasRef={ref}>
      <Tag text="Follow the dot with your eyes. Keep your head still." />
    </StimSurface>
  );
}

/* ---------------------------------------------------------------- saccade and antisaccade */

interface JumpProps extends TaskProps {
  kind: "saccade_jump" | "antisaccade_jump";
  hint: string;
}

/** Shared trial engine: one white flash frame, then the target, then back to centre. */
function JumpTask({ step, onDone, kind, hint }: JumpProps) {
  const { stim, setTarget } = useCall();
  const trials = Math.round(num(step.params, "trials", kind === "saccade_jump" ? 10 : 20));
  const ecc = num(step.params, "amp", num(step.params, "ecc", 0.3));
  const hold = num(step.params, "hold_ms", 1200);
  const gap = num(step.params, "gap_ms", 2000);
  const { finish } = useMeasured(step.task, step.params);
  const plan = useRef({ order: sides(trials), waits: gaps(trials, gap) });
  const [at, setAt] = useState(0);
  const state = useRef({ at: 0, phase: "wait" as "wait" | "flash" | "target", until: 0, over: false });

  const ref = useCanvas((ctx, t, w, h) => {
    const s = state.current;
    if (!s.until) s.until = t + 1200;

    if (s.phase === "wait" && t >= s.until) {
      if (s.at >= trials) {
        if (!s.over) {
          s.over = true;
          finish();
          onDone();
        }
        fill(ctx, w, h, BACK);
        return;
      }
      // One frame of full screen white, logged at the timestamp of this very frame.
      fill(ctx, w, h, FLASH);
      const side = plan.current.order[s.at];
      const fx = side === "L" ? 0.5 - ecc : 0.5 + ecc;
      stim.jump(kind, s.at, side, fx, 0.5, t);
      setTarget({ x: fx, y: 0.5 });
      s.phase = "flash";
      s.until = t + hold;
      setAt(s.at + 1);
      return;
    }

    fill(ctx, w, h, BACK);
    if (s.phase === "flash" || s.phase === "target") {
      s.phase = "target";
      const side = plan.current.order[s.at];
      const fx = side === "L" ? 0.5 - ecc : 0.5 + ecc;
      dot(ctx, fx * w, h / 2, 13);
      if (t >= s.until) {
        s.at += 1;
        s.phase = "wait";
        s.until = t + plan.current.waits[Math.min(s.at, trials - 1)];
        setTarget({ x: 0.5, y: 0.5 });
      }
      return;
    }
    dot(ctx, w / 2, h / 2, 9, RING);
  }, true);

  return (
    <StimSurface canvasRef={ref}>
      <Tag text={`${hint} ${Math.min(at, trials)} of ${trials}`} />
    </StimSurface>
  );
}

/** Look at the dot as soon as it jumps. */
export function SaccadeTask(props: TaskProps) {
  return <JumpTask {...props} kind="saccade_jump" hint="Look at the dot the moment it moves." />;
}

/** The target appears on one side and the patient has to look the other way. */
export function AntisaccadeTask(props: TaskProps) {
  return <JumpTask {...props} kind="antisaccade_jump" hint="Look AWAY from the dot, to the opposite side." />;
}

/* ---------------------------------------------------------------- fixation */

/** Ten seconds on a centre dot. */
export function FixationTask({ step, onDone }: TaskProps) {
  const { setTarget } = useCall();
  const seconds = num(step.params, "seconds", 10);
  const { start, finish } = useMeasured("fixation", step.params);
  const over = useRef(false);
  const [left, setLeft] = useState(Math.round(seconds));

  const ref = useCanvas((ctx, t, w, h) => {
    const secs = Math.max(0, (t - start.current) / 1000);
    setTarget({ x: 0.5, y: 0.5 });
    fill(ctx, w, h, BACK);
    dot(ctx, w / 2, h / 2, 11);
    const secsLeft = Math.max(0, Math.ceil(seconds - secs));
    if (secsLeft !== left) setLeft(secsLeft);
    if (!over.current && secs >= seconds) {
      over.current = true;
      finish();
      onDone();
    }
  }, true);

  return (
    <StimSurface canvasRef={ref}>
      <Tag text={`Hold your eyes on the dot. ${left} seconds left`} />
    </StimSurface>
  );
}
