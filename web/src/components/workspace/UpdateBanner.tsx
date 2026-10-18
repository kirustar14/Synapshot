// What the last check-in changed, said in one line above the brain.
//
// It exists because the opposite was true for a long time: a call landed, every chart
// moved, and the brain sat exactly where it was, with nothing on screen to say whether
// that was because nothing had changed or because nothing had been refetched. It was the
// second one.
//
// The sentence comes from the backend, through the same banned phrase filter as every
// patient facing line, and it says plainly when the change was small rather than
// dressing it up. A banner that always sounds like something happened is one nobody
// reads by the third week.

import { X } from "lucide-react";
import type { ChangedRegion, DoneEvent } from "@/api/stream";
import { cn } from "@/lib/utils";

/** The date the check-in happened, written the way a person says it. */
function when(iso: string | undefined): string {
  if (!iso) return "the last check-in";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "the last check-in";
  return at.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** The regions that moved most, named in full with their network. */
function Moved({ regions }: { regions: ChangedRegion[] }) {
  if (regions.length === 0) return null;
  return (
    <ul className="mt-2 flex flex-wrap gap-1.5">
      {regions.slice(0, 5).map((r) => {
        const size = r.after - r.before;
        return (
          <li
            key={r.id}
            className="rounded-full border border-border bg-card px-2 py-0.5 text-[11px]"
            title={`${r.name}, ${r.network}: ${r.before.toFixed(3)} to ${r.after.toFixed(3)}`}
          >
            <span className="font-bold">{r.name}</span>
            <span className="ml-1 text-muted-foreground">{r.network}</span>
            <span className={cn("ml-1.5 font-mono", size > 0 ? "text-destructive" : "text-success")}>
              {size > 0 ? "+" : ""}
              {size.toFixed(3)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function UpdateBanner({
  update,
  onClose,
}: {
  update: DoneEvent | null | undefined;
  onClose: () => void;
}) {
  if (!update || !update.summary) return null;
  const regions = update.changed_regions ?? [];
  return (
    <div className="mx-4 mb-3 rounded-xl border border-primary/30 bg-primary-soft px-4 py-3 lg:mx-6">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm">
            <span className="font-bold">Updated from check-in on {when(update.date)}: </span>
            {update.summary}
          </p>
          <Moved regions={regions} />
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Dismiss this update"
          className="shrink-0 rounded-full p-1 text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}
