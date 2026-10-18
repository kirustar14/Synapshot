// Where this week's measurement sits against the forecast, as a dot on a track. The pale
// capsule is the 80% band (|z| < 1.28); the dot turns red past the alert threshold of z > 2.
// The number sits beside it, so colour is never the only signal.

import { cn } from "@/lib/utils";

const SPAN = 3; // the track runs from -3 to +3 z
const BAND = 1.28;

export function driftState(z: number): { tone: "alert" | "watch" | "ok"; word: string } {
  if (z > 2) return { tone: "alert", word: "Outside the forecast" };
  if (z > BAND) return { tone: "watch", word: "Near the edge" };
  return { tone: "ok", word: "On track" };
}

const pos = (z: number) => `${((Math.max(-SPAN, Math.min(SPAN, z)) + SPAN) / (2 * SPAN)) * 100}%`;

export function DriftTrack({ z, className }: { z: number; className?: string }) {
  const { tone, word } = driftState(z);
  const sign = z > 0 ? "+" : z < 0 ? "−" : "";
  return (
    <div className={cn("flex items-center gap-4", className)}>
      <div className="relative h-5 w-full max-w-60 shrink-0" role="img" aria-label={`Drift ${z.toFixed(2)} z, ${word.toLowerCase()}`}>
        <span className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-muted" />
        <span
          className="absolute top-1/2 h-3 -translate-y-1/2 rounded-full bg-primary-soft"
          style={{ left: pos(-BAND), right: `calc(100% - ${pos(BAND)})` }}
        />
        <span className="absolute left-1/2 top-1/2 h-4 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/25" />
        <span
          className={cn(
            "absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full",
            tone === "alert" && "bg-destructive ring-4 ring-destructive/20",
            tone === "watch" && "bg-synthetic ring-4 ring-synthetic/20",
            tone === "ok" && "bg-primary",
          )}
          style={{ left: pos(z) }}
        />
      </div>
      <span
        className={cn(
          "whitespace-nowrap font-mono text-[13px] font-semibold",
          tone === "alert" ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {sign}
        {Math.abs(z).toFixed(1)} z
      </span>
    </div>
  );
}
