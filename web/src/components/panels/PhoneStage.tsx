// The live call stage, drawn as a phone because that is what the patient is holding. The base64
// frame is shown when the stream carries one, otherwise an abstract face stands in for it. Only
// the measured dots are real data either way.

import type { RigEvent } from "@/api/types";
import { cn } from "@/lib/utils";

/** An abstract face, so the stage never implies a real video feed is present. */
function AbstractFace({ pupilX, pupilY }: { pupilX: number; pupilY: number }) {
  return (
    <svg viewBox="0 0 100 180" className="h-full w-full" aria-hidden>
      <defs>
        <radialGradient id="stage-glow" cx="50%" cy="40%" r="60%">
          <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.22" />
          <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="100" height="180" fill="url(#stage-glow)" />
      <ellipse cx="50" cy="88" rx="31" ry="40" fill="none" stroke="var(--primary)" strokeOpacity="0.4" strokeWidth="0.8" />
      <ellipse cx="38" cy="78" rx="7" ry="4.2" fill="none" stroke="var(--primary)" strokeOpacity="0.5" strokeWidth="0.7" />
      <ellipse cx="62" cy="78" rx="7" ry="4.2" fill="none" stroke="var(--primary)" strokeOpacity="0.5" strokeWidth="0.7" />
      <circle cx={38 + pupilX * 4.5} cy={78 + pupilY * 2.5} r="2" fill="var(--primary)" fillOpacity="0.55" />
      <circle cx={62 + pupilX * 4.5} cy={78 + pupilY * 2.5} r="2" fill="var(--primary)" fillOpacity="0.55" />
      <path d="M 43 104 Q 50 109 57 104" fill="none" stroke="var(--primary)" strokeOpacity="0.35" strokeWidth="0.7" />
      <path d="M 50 84 L 50 95" stroke="var(--primary)" strokeOpacity="0.2" strokeWidth="0.6" />
    </svg>
  );
}

export function PhoneStage({ event, idle }: { event: RigEvent | null; idle: boolean }) {
  const gaze = event?.gaze ?? { x: 0.5, y: 0.5 };
  const target = event?.target ?? { x: 0.5, y: 0.5 };
  const pct = (v: number) => `${Math.max(2, Math.min(98, v * 100))}%`;

  return (
    <div className="flex flex-col items-center">
      <div className="relative w-full max-w-[280px] rounded-[2.6rem] border-[10px] border-foreground/80 bg-lab-surface shadow-lift">
        <span className="absolute left-1/2 top-2 h-1.5 w-16 -translate-x-1/2 rounded-full bg-foreground/30" aria-hidden />
        <div className="relative aspect-[9/17] overflow-hidden rounded-[2rem]">
          {event?.frame ? (
            <img src={`data:image/jpeg;base64,${event.frame}`} alt="Frame sent by the call page" className="h-full w-full object-cover" />
          ) : (
            <AbstractFace pupilX={(gaze.x - 0.5) * 2} pupilY={(gaze.y - 0.5) * 2} />
          )}

          <span
            className="absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-dashed"
            style={{ left: pct(target.x), top: pct(target.y), borderColor: "var(--chart-3)" }}
            aria-hidden
          />
          <span
            className={cn("absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full", idle && "opacity-40")}
            style={{ left: pct(gaze.x), top: pct(gaze.y), background: "var(--primary)" }}
            aria-hidden
          />
        </div>
      </div>

      <ul className="mt-3 flex flex-wrap justify-center gap-3 text-[11px] text-muted-foreground">
        <li className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-full border-2 border-dashed" style={{ borderColor: "var(--chart-3)" }} aria-hidden /> Target dot
        </li>
        <li className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: "var(--primary)" }} aria-hidden /> Where the eyes are looking
        </li>
      </ul>
      <p className="mt-2 max-w-sm text-center text-[11px] leading-relaxed text-muted-foreground">
        The video stays on the patient's phone. This console shows only the measurements the phone sends, so the picture
        above is a stand-in unless the call page chooses to send a frame.
      </p>
    </div>
  );
}
