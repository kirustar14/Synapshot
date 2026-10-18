// Every patient as a dot on one shared forecast track, so the whole clinic reads at a glance
// before the table. Same encoding as DriftTrack: pale band is where the twin expected this
// week, a dot past the alert line turns coral. Dots glide in once on load.

import { Link } from "react-router-dom";
import type { PatientRow } from "@/api/types";
import { cn } from "@/lib/utils";
import { driftState } from "./DriftTrack";

const SPAN = 3;
const BAND = 1.28;
const ALERT = 2;
const pct = (z: number) => ((Math.max(-SPAN, Math.min(SPAN, z)) + SPAN) / (2 * SPAN)) * 100;

export function CohortRadar({ rows }: { rows: PatientRow[] }) {
  // Patients inside the band share one quiet label (a flag from the check-in can still apply); only the ones outside it are named, so
  // the eye goes straight to who needs a look and names never collide in the crowded middle.
  const inside = rows.filter((p) => Math.abs(p.drift_z) <= BAND);
  const outside = [...rows.filter((p) => Math.abs(p.drift_z) > BAND)].sort((a, b) => a.drift_z - b.drift_z);

  return (
    <div className="relative h-[132px] w-full" role="img" aria-label="Every patient's drift from the forecast on one track">
      <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-[var(--on-instrument)]/20" />
      <span
        className="absolute top-1/2 h-9 -translate-y-1/2 rounded-full border border-[var(--signal)]/25 bg-[var(--signal-soft)]"
        style={{ left: `${pct(-BAND)}%`, right: `${100 - pct(BAND)}%` }}
      />
      <span className="absolute left-1/2 top-1/2 h-12 w-px -translate-y-1/2 bg-[var(--signal)]/40" />
      <span
        className="absolute top-1/2 h-16 w-px -translate-y-1/2 border-l border-dashed border-[var(--alarm)]/60"
        style={{ left: `${pct(ALERT)}%` }}
      />
      <span
        className="absolute bottom-0 -translate-x-1/2 font-mono text-[11px] font-semibold text-[var(--alarm-text)]/80"
        style={{ left: `${pct(ALERT)}%` }}
      >
        alert
      </span>
      <span className="absolute bottom-0 left-1/2 -translate-x-1/2 font-mono text-[11px] font-semibold text-[var(--signal)]/80">
        forecast
      </span>
      {inside.length > 0 && (
        <span className="absolute left-1/2 top-2 -translate-x-1/2 whitespace-nowrap text-xs font-extrabold text-[var(--signal)]">
          {inside.length} inside the band
        </span>
      )}

      {[...inside, ...outside].map((p, i) => {
        const { tone } = driftState(p.drift_z);
        const named = Math.abs(p.drift_z) > BAND;
        const idx = outside.indexOf(p);
        return (
          <Link
            key={p.id}
            to={`/patients/${p.id}`}
            className="group absolute top-1/2 z-10 focus-visible:outline-none"
            style={{ left: `${pct(p.drift_z)}%` }}
            aria-label={`${p.name}, drift ${p.drift_z.toFixed(1)} z`}
            title={p.name}
          >
            <span
              className={cn(
                "dot-in absolute block h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full ring-4 transition-[scale] group-hover:scale-125 group-focus-visible:scale-125",
                tone === "alert" && "breathe bg-[var(--alarm)] ring-[var(--alarm)]/25",
                tone === "watch" && "bg-[#f3c76b] ring-[#f3c76b]/20",
                tone === "ok" && "bg-[var(--signal)] opacity-90 ring-[var(--signal)]/10",
              )}
              style={{ animationDelay: `${120 + i * 70}ms` }}
            />
            {named && (
              <span
                className={cn(
                  "absolute -translate-x-1/2 whitespace-nowrap text-xs font-extrabold text-white/90",
                  idx % 2 === 0 ? "-top-9" : "top-5",
                )}
              >
                {p.name.split(" ")[0]}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
