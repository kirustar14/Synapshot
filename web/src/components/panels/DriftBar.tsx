// Drift z as a coloured bar with the number and a word beside it, so the colour is never the
// only signal. Shared by the patient list and the demo console.

import { cn } from "@/lib/utils";

/** Colour and plain words for a drift z. Above 2 is the alert threshold. */
export function driftTone(z: number): { bar: string; word: string } {
  if (z > 2) return { bar: "bg-destructive", word: "outside the band" };
  if (z > 1.2) return { bar: "bg-synthetic", word: "near the edge" };
  return { bar: "bg-success", word: "inside the band" };
}

export function DriftBar({ z, width = "w-28" }: { z: number; width?: string }) {
  const { bar, word } = driftTone(z);
  const pct = Math.min(100, Math.max(3, (z / 4) * 100));

  return (
    <div className="flex items-center gap-2">
      <span className={cn("h-2 overflow-hidden rounded-full bg-muted", width)} aria-hidden>
        <span className={cn("block h-full rounded-full", bar)} style={{ width: `${pct}%` }} />
      </span>
      <span className="font-mono text-xs font-bold">{z.toFixed(2)}</span>
      <span className="text-[11px] text-muted-foreground">{word}</span>
    </div>
  );
}
