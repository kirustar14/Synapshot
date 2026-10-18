// The call transcript with speaker colours. The live console scrolls it, the call log does not.

import { useEffect, useRef } from "react";
import { Empty } from "@/components/common";
import { cn } from "@/lib/utils";

export interface Line {
  who: "agent" | "patient";
  text: string;
  t?: number;
}

const WHO = {
  agent: { label: "Assistant", cls: "border-primary/30 bg-primary-soft text-accent-foreground" },
  patient: { label: "Patient", cls: "border-border bg-muted text-foreground" },
};

/** Seconds into the call as m:ss. */
const stamp = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

export function Transcript({ lines, follow = false, height = 260 }: { lines: Line[]; follow?: boolean; height?: number }) {
  const box = useRef<HTMLOListElement>(null);

  useEffect(() => {
    if (follow && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [follow, lines.length]);

  if (lines.length === 0) return <Empty>Nothing said yet.</Empty>;

  return (
    <ol
      ref={box}
      style={{ maxHeight: height }}
      className="space-y-2 overflow-y-auto pr-1"
      aria-label="Call transcript"
      aria-live={follow ? "polite" : undefined}
    >
      {lines.map((l, i) => (
        <li key={i} className="flex gap-2 text-sm">
          <span
            className={cn(
              "mt-0.5 h-fit shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold",
              WHO[l.who].cls,
            )}
          >
            {WHO[l.who].label}
          </span>
          <span className="min-w-0 flex-1 leading-relaxed">{l.text}</span>
          {l.t !== undefined && <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{stamp(l.t)}</span>}
        </li>
      ))}
    </ol>
  );
}
