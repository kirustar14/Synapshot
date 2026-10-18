"use client";

import React, { useEffect, useRef } from "react";

type BrainTraceProps = {
  className?: string;
  totalDurationMs?: number;
  pauseMs?: number;
};

const PATHS = [
  "M74 164 C52 134, 66 92, 110 82 C115 52, 162 36, 196 56 C228 35, 278 42, 296 78 C336 82, 362 119, 352 154 C366 178, 362 211, 338 228 C334 254, 309 273, 276 273 C258 292, 228 300, 198 289 C166 304, 130 297, 106 274 C76 270, 54 247, 52 216 C28 198, 20 178, 31 152 C39 135, 55 127, 74 129",
  "M116 84 C92 106, 84 130, 92 155 C100 182, 119 200, 149 214",
  "M154 63 C126 88, 120 118, 128 144 C138 174, 166 190, 197 202",
  "M196 56 C176 80, 171 111, 180 138 C192 173, 224 189, 258 196",
  "M242 58 C232 84, 236 115, 252 138 C270 164, 299 176, 329 176",
  "M298 79 C279 96, 270 122, 276 146 C285 179, 312 198, 338 206",
  "M111 246 C146 233, 177 229, 213 235 C257 241, 284 253, 313 272",
  "M163 214 C159 240, 164 262, 177 280",
  "M214 206 C211 232, 217 259, 232 287",
  "M264 197 C264 227, 271 252, 292 276",
  "M188 235 C181 253, 183 272, 195 292",
  "M214 236 C229 250, 244 260, 263 267",
  "M183 203 C142 191, 111 174, 86 147",
  "M258 198 C293 195, 322 186, 347 163",
] as const;

const NODES = [
  [110,82],[196,56],[296,78],[92,155],[128,144],[180,138],[252,138],[276,146],
  [149,214],[197,202],[258,196],[338,206],[213,235],[292,276],[195,292]
] as const;

export default function BrainTrace({ className = "", totalDurationMs = 15000, pauseMs = 2500 }: BrainTraceProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const activePaths = Array.from(svg.querySelectorAll<SVGPathElement>(".brain-active"));
    const basePaths = Array.from(svg.querySelectorAll<SVGPathElement>(".brain-base"));
    const nodes = Array.from(svg.querySelectorAll<SVGCircleElement>(".brain-node"));
    const spark = svg.querySelector<SVGCircleElement>(".brain-spark");
    const glint = svg.querySelector<SVGCircleElement>(".brain-spark-glow");
    const lengths = activePaths.map((p) => p.getTotalLength());
    const totalLength = lengths.reduce((a, b) => a + b, 0);
    const cycleMs = totalDurationMs + pauseMs;

    activePaths.forEach((p, i) => {
      const len = lengths[i];
      p.style.strokeDasharray = `${len}`;
      p.style.strokeDashoffset = `${len}`;
      p.style.opacity = "0";
    });

    if (reduce) {
      activePaths.forEach((p) => {
        p.style.strokeDashoffset = "0";
        p.style.opacity = "0.25";
      });
      if (spark) spark.style.opacity = "0";
      if (glint) glint.style.opacity = "0";
      nodes.forEach((n) => (n.style.opacity = "0.5"));
      return;
    }

    let frame = 0;
    const step = (now: number) => {
      const t = now % cycleMs;
      const animating = t < totalDurationMs;
      if (!animating) {
        activePaths.forEach((p) => {
          p.style.opacity = "0";
          p.style.strokeDashoffset = p.style.strokeDasharray;
        });
        nodes.forEach((n) => (n.style.opacity = "0.42"));
        if (spark) spark.style.opacity = "0";
        if (glint) glint.style.opacity = "0";
      } else {
        const overall = t / totalDurationMs;
        const traversed = overall * totalLength;
        let remaining = traversed;
        let activeIndex = 0;
        for (let i = 0; i < lengths.length; i++) {
          if (remaining <= lengths[i]) { activeIndex = i; break; }
          remaining -= lengths[i];
          activeIndex = i + 1;
        }

        activePaths.forEach((p, i) => {
          const len = lengths[i];
          if (i < activeIndex) {
            p.style.opacity = "0.36";
            p.style.strokeDashoffset = "0";
          } else if (i === activeIndex && activeIndex < activePaths.length) {
            p.style.opacity = "0.95";
            p.style.strokeDashoffset = `${Math.max(0, len - remaining)}`;
          } else {
            p.style.opacity = "0";
            p.style.strokeDashoffset = `${len}`;
          }
        });

        const currentPath = activePaths[Math.min(activeIndex, activePaths.length - 1)];
        const currentLen = lengths[Math.min(activeIndex, activePaths.length - 1)];
        const point = currentPath.getPointAtLength(Math.max(0.001, Math.min(currentLen, remaining)));
        if (spark && glint) {
          spark.setAttribute("cx", `${point.x}`);
          spark.setAttribute("cy", `${point.y}`);
          glint.setAttribute("cx", `${point.x}`);
          glint.setAttribute("cy", `${point.y}`);
          spark.style.opacity = "1";
          glint.style.opacity = "0.85";
        }

        nodes.forEach((n) => {
          const x = parseFloat(n.getAttribute("cx") || "0");
          const y = parseFloat(n.getAttribute("cy") || "0");
          const d = Math.hypot(point.x - x, point.y - y);
          const o = d < 16 ? 0.95 : d < 30 ? 0.68 : 0.42;
          n.style.opacity = String(o);
        });
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [pauseMs, totalDurationMs]);

  return (
    <svg ref={svgRef} className={className} viewBox="0 0 420 320" fill="none" aria-hidden="true">
      <defs>
        <filter id="brain-glow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="2.8" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <g filter="url(#brain-glow)">
        {PATHS.map((d, i) => (
          <path key={`base-${i}`} d={d} className="brain-base" stroke="#F6D7AE" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" opacity="0.28" />
        ))}
        {PATHS.map((d, i) => (
          <path key={`active-${i}`} d={d} className="brain-active" stroke="#FFDFA6" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
        ))}
        {NODES.map(([x, y], i) => (
          <circle key={`node-${i}`} className="brain-node" cx={x} cy={y} r={4.2} fill="#FFDFA6" opacity="0.42" />
        ))}
        <circle className="brain-spark-glow" cx="0" cy="0" r="10" fill="#FFE9C5" opacity="0" />
        <circle className="brain-spark" cx="0" cy="0" r="4.3" fill="#FFF6E6" opacity="0" />
      </g>
    </svg>
  );
}
