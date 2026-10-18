// One animation frame loop for every drawn task.
//
// The timestamp handed to the draw function is the rAF timestamp, which is the same clock as
// performance.now() and therefore the same clock as the frame records. That is what makes it
// honest to log "the target was here when this frame painted".

import { useEffect, useRef } from "react";

export type Draw = (ctx: CanvasRenderingContext2D, t: number, w: number, h: number) => void;

/** Attaches a resizing, device pixel aware rAF loop to a canvas while `active` is true. */
export function useCanvas(draw: Draw, active: boolean): React.RefObject<HTMLCanvasElement | null> {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const fn = useRef(draw);
  fn.current = draw;

  useEffect(() => {
    const el = ref.current;
    if (!el || !active) return;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let live = true;
    let box = { w: 0, h: 0 };

    const size = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = el.getBoundingClientRect();
      box = { w: Math.max(1, rect.width), h: Math.max(1, rect.height) };
      el.width = Math.round(box.w * dpr);
      el.height = Math.round(box.h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const tick = (t: number) => {
      if (!live) return;
      fn.current(ctx, t, box.w, box.h);
      raf = requestAnimationFrame(tick);
    };

    size();
    window.addEventListener("resize", size);
    window.addEventListener("orientationchange", size);
    raf = requestAnimationFrame(tick);
    return () => {
      live = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", size);
      window.removeEventListener("orientationchange", size);
    };
  }, [active]);

  return ref;
}
