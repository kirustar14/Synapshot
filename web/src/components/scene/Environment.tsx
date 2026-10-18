import { useEffect, useRef } from "react";
import { environmentAt, leafAt, LEAF_STARTS, smooth } from "./motion";
import { CURTAIN, PLANT, ROOM } from "./geometry";

const WIDTH = ROOM.width;
const HEIGHT = 910;

/** A small 2D strip mesh: fabric is pinned at its top; branch flexibility falls to zero at the pot. */
export default function Environment() {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    let disposed = false;
    let frame = 0;
    let elapsed = 0;
    let last = 0;
    let painted = -Infinity;
    let visible = true;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)");
    const mobile = matchMedia("(max-width: 600px)");
    const load = (name: string) =>
      new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = `/scene/v6/${name}.webp`;
      });
    const observer =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(([entry]) => {
            visible = entry.isIntersecting;
            resume();
          });
    observer?.observe(el);

    let draw: (time: number) => void = () => {};
    function tick(now: number) {
      if (disposed || reduce.matches || document.hidden || !visible) {
        last = 0;
        return;
      }
      if (last) elapsed += Math.min(now - last, 100) / 1000;
      last = now;
      if (now - painted >= (mobile.matches ? 50 : 1000 / 30)) {
        draw(elapsed);
        painted = now;
      }
      frame = requestAnimationFrame(tick);
    }
    function resume() {
      cancelAnimationFrame(frame);
      last = 0;
      if (reduce.matches) draw(0);
      else if (!document.hidden && visible && !disposed)
        frame = requestAnimationFrame(tick);
    }
    Promise.all([
      load("curtain"),
      load("plant"),
      load("leaf-1"),
      load("leaf-2"),
      load("leaf-3"),
    ])
      .then(([fabric, plant, ...leaves]) => {
        if (disposed) return;
        // The shadow is precomputed once; the frame loop only transforms its small strips.
        const shadow = document.createElement("canvas");
        shadow.width = plant.width;
        shadow.height = plant.height;
        const sc = shadow.getContext("2d")!;
        sc.drawImage(plant, 0, 0);
        sc.globalCompositeOperation = "source-in";
        sc.fillStyle = "#51422f";
        sc.fillRect(0, 0, shadow.width, shadow.height);
        const softShadow = document.createElement("canvas");
        softShadow.width = shadow.width;
        softShadow.height = shadow.height;
        const shadowContext = softShadow.getContext("2d")!;
        shadowContext.filter = "blur(11px)";
        shadowContext.drawImage(shadow, 0, 0);

        draw = (seconds) => {
          const still = reduce.matches;
          const env = environmentAt(still ? 0 : seconds);
          const strength = still ? 0 : mobile.matches ? 0.45 : 1;
          ctx.clearRect(0, 0, WIDTH, HEIGHT);
          // Feathered transmission and fabric shadows. No clipped polygon edges or new grid.
          const wash = (
            x: number,
            y: number,
            rx: number,
            ry: number,
            angle: number,
            color: string,
          ) => {
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(angle);
            ctx.scale(rx, ry);
            const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
            gradient.addColorStop(0, color);
            gradient.addColorStop(1, "rgba(0,0,0,0)");
            ctx.fillStyle = gradient;
            ctx.fillRect(-1, -1, 2, 2);
            ctx.restore();
          };
          wash(
            620 + env.light * strength,
            390,
            500,
            255,
            0.2,
            `rgba(255,246,213,${0.24 + env.wind * strength * 0.12})`,
          );
          for (let fold = 0; fold < 3; fold++) {
            wash(
              420 + fold * 135 + env.light * strength * 0.8,
              340 + fold * 35,
              50 + fold * 9,
              175,
              -0.25,
              `rgba(92,71,43,${0.08 - env.wind * strength * 0.04})`,
            );
          }
          wash(
            520 + env.light * strength * 1.4,
            820,
            560,
            76,
            0,
            `rgba(255,246,218,${0.15 + env.wind * strength * 0.075})`,
          );

          const meshPlant = (source: CanvasImageSource, isShadow = false) => {
            ctx.save();
            ctx.globalAlpha = isShadow ? 0.19 : 0.94;
            for (let row = 0; row < PLANT.height * PLANT.scale; row += 4) {
              const y = row / PLANT.scale;
              // Three smoothly joined flexibility zones: pot, lower branch, flexible leaf tips.
              const flex = 1 - smooth((y - 150) / 1080);
              const branch =
                env.foliage * 24 + env.tips * Math.sin(y / 175) * 10;
              const dx = strength * flex * branch * (isShadow ? 1.2 : 1);
              const h = Math.min(4, PLANT.height * PLANT.scale - row);
              ctx.drawImage(
                source,
                0,
                y,
                PLANT.width,
                h / PLANT.scale,
                PLANT.x + dx + (isShadow ? -32 : 0),
                PLANT.y + row + (isShadow ? 18 : 0),
                PLANT.width * PLANT.scale,
                h,
              );
            }
            ctx.restore();
          };
          meshPlant(softShadow, true);
          // Each strip retains its texture dimensions. Only its displacement changes with height.
          ctx.globalAlpha = 0.73;
          for (let row = 0; row < 1672 * CURTAIN.scale; row += 4) {
            const y = row / CURTAIN.scale;
            const p = y / 1672;
            const dx =
              strength *
              p *
              p *
              (env.wind * 48 + Math.sin(p * 7) * env.foliage * 14);
            const h = Math.min(4, 1672 * CURTAIN.scale - row);
            const lift = (progress: number) =>
              strength *
              progress *
              progress *
              env.tips *
              Math.sin(progress * 4) *
              4;
            const top = CURTAIN.y + row + lift(p);
            const bottom =
              CURTAIN.y + row + h + lift((row + h) / (1672 * CURTAIN.scale));
            if (h > 0)
              ctx.drawImage(
                fabric,
                0,
                y,
                941,
                h / CURTAIN.scale,
                CURTAIN.x + dx,
                top,
                941 * CURTAIN.scale,
                bottom - top,
              );
          }
          ctx.globalAlpha = 1;
          meshPlant(plant);
          if (!still && !mobile.matches)
            LEAF_STARTS.forEach((_, i) => {
              const leaf = leaves[i % leaves.length];
              const state = leafAt(seconds, i);
              if (!state.opacity) return;
              ctx.save();
              ctx.globalAlpha = state.opacity;
              ctx.translate(state.x + env.wind * 9, state.y);
              ctx.rotate(state.angle);
              ctx.scale(0.65 + 0.35 * Math.abs(Math.cos(state.angle * 1.5)), 1);
              const w = [19, 29, 23][i % 3];
              ctx.drawImage(
                leaf,
                -w / 2,
                -w / 2,
                w,
                (w * leaf.height) / leaf.width,
              );
              ctx.restore();
            });
        };
        draw(0);
        resume();
      })
      .catch(() => {
        /* The room photograph and SVG remain usable if an overlay cannot load. */
      });
    reduce.addEventListener("change", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer?.disconnect();
      reduce.removeEventListener("change", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, []);
  return (
    <canvas
      ref={canvas}
      className="scene__environment"
      width={WIDTH}
      height={HEIGHT}
      aria-hidden="true"
    />
  );
}
