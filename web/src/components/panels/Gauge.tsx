// A big number with a half circle gauge. Used for the functional connectivity fit on the
// upload and overview screens.

import { cn } from "@/lib/utils";

const SIZE = 132;
const R = 54;
const CIRC = Math.PI * R;

/** Where the needle sits, and the word that goes with the colour. */
function band(value: number): { tone: string; word: string } {
  if (value >= 0.55) return { tone: "var(--success)", word: "good fit" };
  if (value >= 0.45) return { tone: "var(--chart-3)", word: "workable fit" };
  return { tone: "var(--destructive)", word: "weak fit" };
}

export function Gauge({
  value,
  label,
  max = 1,
  missing = "not fitted",
  className,
}: {
  value: number | null;
  label: string;
  max?: number;
  missing?: string;
  className?: string;
}) {
  const ratio = value == null ? 0 : Math.max(0, Math.min(1, value / max));
  const tone = value == null ? "var(--muted-foreground)" : band(value).tone;

  return (
    <div className={cn("flex items-center gap-4", className)}>
      <svg width={SIZE} height={SIZE / 2 + 10} viewBox={`0 0 ${SIZE} ${SIZE / 2 + 10}`} aria-hidden>
        <path
          d={`M 12 ${SIZE / 2} A ${R} ${R} 0 0 1 ${SIZE - 12} ${SIZE / 2}`}
          fill="none"
          stroke="var(--muted)"
          strokeWidth={12}
          strokeLinecap="round"
        />
        <path
          d={`M 12 ${SIZE / 2} A ${R} ${R} 0 0 1 ${SIZE - 12} ${SIZE / 2}`}
          fill="none"
          stroke={tone}
          strokeWidth={12}
          strokeLinecap="round"
          strokeDasharray={`${CIRC * ratio} ${CIRC}`}
        />
      </svg>
      <div>
        <p className="text-3xl font-extrabold leading-none" style={{ color: tone }}>
          {value == null ? "n/a" : value.toFixed(2)}
        </p>
        <p className="mt-1 text-xs font-bold">{label}</p>
        <p className="text-[11px] text-muted-foreground">{value == null ? missing : band(value).word}</p>
      </div>
    </div>
  );
}
