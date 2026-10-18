import { useEffect, useId, useRef, type CSSProperties } from "react";
import { smooth } from "./motion";

// Traced from the supplied artwork. Each branch has explicit shared junctions.
export const JUNCTIONS: Record<string, [number, number]> = {
  a: [66, 180],
  b: [116, 100],
  c: [218, 62],
  d: [316, 110],
  e: [365, 190],
  f: [304, 270],
  g: [194, 290],
  h: [92, 258],
  i: [147, 176],
  j: [249, 178],
  k: [223, 245],
  l: [269, 366],
};
export const NEURAL_PATHS = [
  { from: "a", to: "b", d: "M66 180 C53 145 72 105 116 100" },
  { from: "b", to: "c", d: "M116 100 C129 48 180 39 218 62" },
  { from: "c", to: "d", d: "M218 62 C260 37 310 61 316 110" },
  { from: "d", to: "e", d: "M316 110 C362 103 390 153 365 190" },
  { from: "e", to: "f", d: "M365 190 C390 235 350 289 304 270" },
  {
    from: "b",
    to: "i",
    d: "M116 100 C160 87 164 135 201 124 C228 116 239 122 249 143 C263 167 195 205 147 176",
  },
  {
    from: "c",
    to: "j",
    d: "M218 62 C181 93 224 112 255 110 C283 109 309 141 285 163 C274 175 261 178 249 178",
  },
  {
    from: "i",
    to: "h",
    d: "M147 176 C114 162 75 192 66 216 C57 242 68 256 92 258",
  },
  { from: "i", to: "j", d: "M147 176 C176 140 205 146 249 178" },
  { from: "j", to: "e", d: "M249 178 C287 134 324 161 365 190" },
  { from: "h", to: "g", d: "M92 258 C125 290 155 269 194 290" },
  { from: "j", to: "k", d: "M249 178 C271 222 249 231 223 245" },
  { from: "k", to: "g", d: "M223 245 C184 214 171 273 194 290" },
  { from: "k", to: "f", d: "M223 245 C259 207 295 224 304 270" },
  { from: "g", to: "l", d: "M194 290 C218 300 241 329 269 366" },
  { from: "f", to: "l", d: "M304 270 C265 284 250 320 269 366" },
  { from: "a", to: "h", d: "M66 180 C42 214 54 250 92 258" },
  {
    from: "d",
    to: "j",
    d: "M316 110 C292 80 264 104 238 93 C208 76 172 93 181 122 C190 151 225 147 249 178",
  },
];

export default function BrainTrace({
  className = "",
  style,
}: {
  className?: string;
  style?: CSSProperties;
}) {
  const root = useRef<SVGSVGElement>(null);
  const glow = useId().replace(/:/g, "");
  const projection = `${glow}-projection`;
  const haze = `${glow}-haze`;
  useEffect(() => {
    const svg = root.current;
    if (!svg || !svg.querySelector("path")?.getTotalLength) return;
    const paths = [...svg.querySelectorAll<SVGPathElement>(".brain-lit")];
    const sparks = [...svg.querySelectorAll<SVGCircleElement>(".brain-spark")];
    const nodes = [...svg.querySelectorAll<SVGCircleElement>(".brain-node")];
    const lengths = paths.map((p) => p.getTotalLength());
    const arrival: Record<string, number> = { a: 0 };
    for (let pass = 0; pass < NEURAL_PATHS.length; pass++)
      NEURAL_PATHS.forEach((edge, i) => {
        if (arrival[edge.from] !== undefined)
          arrival[edge.to] = Math.min(
            arrival[edge.to] ?? Infinity,
            arrival[edge.from] + lengths[i],
          );
      });
    const distance = Math.max(
      ...NEURAL_PATHS.map((edge, i) => arrival[edge.from] + lengths[i]),
    );
    const speed = distance / 15;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let elapsed = 0;
    let previous = 0;
    let visible = true;
    const render = (seconds: number, still = false) => {
      const t = seconds % 18;
      const activity = nodes.map(() => 0);
      paths.forEach((path, i) => {
        const travel = (t - arrival[NEURAL_PATHS[i].from] / speed) * speed;
        const length = lengths[i];
        const tail = Math.min(length * 0.7, speed * 1.5);
        path.style.strokeDasharray = `${tail} ${length + tail + 1}`;
        path.style.strokeDashoffset = String(tail - travel);
        path.style.opacity =
          still || travel < 0 || travel > length + tail
            ? "0"
            : String(
                0.82 *
                  smooth(travel / 8) *
                  smooth((length + tail - travel) / tail),
              );
        const moving = !still && travel >= 0 && travel <= length;
        const point = path.getPointAtLength(
          Math.max(0, Math.min(length, travel)),
        );
        sparks[i].setAttribute("cx", String(point.x));
        sparks[i].setAttribute("cy", String(point.y));
        sparks[i].style.opacity = moving
          ? String(smooth(travel / 7) * smooth((length - travel) / 7) * 0.9)
          : "0";
        if (moving)
          nodes.forEach((node, n) => {
            const d = Math.hypot(
              point.x - Number(node.getAttribute("cx")),
              point.y - Number(node.getAttribute("cy")),
            );
            activity[n] = Math.max(activity[n], smooth(1 - d / 24));
          });
      });
      nodes.forEach(
        (node, i) => (node.style.opacity = String(0.22 + activity[i] * 0.5)),
      );
    };
    const tick = (now: number) => {
      if (document.hidden || reduce.matches || !visible) {
        previous = 0;
        return;
      }
      if (previous) elapsed += Math.min(100, now - previous) / 1000;
      previous = now;
      render(elapsed);
      frame = requestAnimationFrame(tick);
    };
    const resume = () => {
      cancelAnimationFrame(frame);
      previous = 0;
      render(elapsed, reduce.matches);
      if (!document.hidden && !reduce.matches && visible)
        frame = requestAnimationFrame(tick);
    };
    const observer =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(([entry]) => {
            visible = entry.isIntersecting;
            resume();
          });
    observer?.observe(svg);
    reduce.addEventListener("change", resume);
    document.addEventListener("visibilitychange", resume);
    resume();
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      reduce.removeEventListener("change", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, []);
  return (
    <svg
      ref={root}
      className={className}
      style={style}
      viewBox="0 0 420 420"
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <filter id={projection} x="-20%" y="-20%" width="140%" height="140%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.065"
            numOctaves="2"
            seed="7"
            result="wall"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="wall"
            scale="1.4"
            xChannelSelector="R"
            yChannelSelector="G"
            result="textured"
          />
          <feGaussianBlur in="textured" stdDeviation="1" />
        </filter>
        <filter id={haze} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="3.5" />
        </filter>
        <filter id={glow} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="2.2" result="soft" />
          <feMerge>
            <feMergeNode in="soft" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <g filter={`url(#${projection})`}>
        <g
          stroke="#f8e7bd"
          strokeWidth="4"
          opacity="0.2"
          filter={`url(#${haze})`}
          strokeLinecap="round"
        >
          {NEURAL_PATHS.map((edge, i) => (
            <path key={i} d={edge.d} />
          ))}
        </g>
        <g
          stroke="#fff4d6"
          strokeWidth="2.1"
          opacity="0.82"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {NEURAL_PATHS.map((edge, i) => (
            <path key={i} d={edge.d} />
          ))}
        </g>
        <g
          filter={`url(#${glow})`}
          stroke="#ffe5a7"
          strokeWidth="3"
          strokeLinecap="round"
        >
          {NEURAL_PATHS.map((edge, i) => (
            <path key={i} className="brain-lit" d={edge.d} opacity="0" />
          ))}
        </g>
        <g fill="#fff2cf" filter={`url(#${glow})`}>
          {Object.entries(JUNCTIONS).map(([id, [x, y]]) => (
            <circle
              key={id}
              className="brain-node"
              cx={x}
              cy={y}
              r="2.7"
              opacity="0.22"
            />
          ))}
          {NEURAL_PATHS.map((_, i) => (
            <circle key={i} className="brain-spark" r="3.1" opacity="0" />
          ))}
        </g>
      </g>
    </svg>
  );
}
