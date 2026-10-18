// One signal at a glance: this week's value, whether it sits inside the forecast band, and a
// small chart of every check-in so far against that band. The full chart lives further down.

import type { Signal } from "@/api/types";

const W = 240;
const H = 56;

export type BandState = "in" | "above" | "below" | "none";

/** Where the latest observation sits relative to the band at its own week. */
export function bandState(signal: Signal, weeks: number[]): { state: BandState; value: number | null } {
  const last = signal.obs[signal.obs.length - 1];
  if (!last) return { state: "none", value: null };
  const i = weeks.indexOf(last.week);
  if (i < 0) return { state: "none", value: last.value };
  if (last.value > signal.hi[i]) return { state: "above", value: last.value };
  if (last.value < signal.lo[i]) return { state: "below", value: last.value };
  return { state: "in", value: last.value };
}

const fmt = (v: number) => (Math.abs(v) >= 10 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(1) : v.toFixed(2));

export function SignalTile({ title, signal, weeks }: { title: string; signal: Signal; weeks: number[] }) {
  const { state, value } = bandState(signal, weeks);
  const off = state === "above" || state === "below";

  const all = [...signal.lo, ...signal.hi, ...signal.obs.map((o) => o.value)];
  const min = Math.min(...all);
  const max = Math.max(...all);
  const pad = (max - min) * 0.12 || 1;
  const y = (v: number) => H - ((v - (min - pad)) / (max - min + 2 * pad)) * H;
  // Only the weeks measured so far, so the line reaches the right edge at this week.
  const upTo = Math.max(1, signal.obs[signal.obs.length - 1]?.week ?? 1);
  const shown = weeks.filter((w) => w <= upTo);
  const x = (w: number) => (w / upTo) * W;

  const band = [
    ...shown.map((w) => `${x(w)},${y(signal.hi[weeks.indexOf(w)])}`),
    ...[...shown].reverse().map((w) => `${x(w)},${y(signal.lo[weeks.indexOf(w)])}`),
  ].join(" ");
  const line = signal.obs.map((o) => `${x(o.week)},${y(o.value)}`).join(" ");
  const last = signal.obs[signal.obs.length - 1];

  return (
    <section className="panel flex flex-col gap-3 p-[22px]">
      <header className="flex h-6 items-center justify-between gap-2">
        <h3 className="text-[15px] font-extrabold">{title}</h3>
        {state === "none" ? (
          <span className="text-[13px] font-bold text-muted-foreground">Not measured yet</span>
        ) : off ? (
          <span className="flex h-6 items-center rounded-full bg-destructive-soft px-2.5 text-xs font-extrabold text-destructive">
            {state === "above" ? "Above band" : "Below band"}
          </span>
        ) : (
          <span className="text-[13px] font-bold text-success">In band</span>
        )}
      </header>
      <p className="flex min-w-0 items-baseline gap-1.5">
        <span className="text-[30px] font-extrabold leading-9 tracking-tight">{value == null ? "None" : fmt(value)}</span>
        <span className="truncate text-sm font-semibold text-muted-foreground">{signal.label.toLowerCase()}</span>
      </p>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-14 w-full" aria-hidden>
        <polygon points={band} fill="var(--color-primary-soft)" />
        {line && (
          <polyline
            points={line}
            fill="none"
            stroke={off ? "var(--color-destructive)" : "var(--color-primary)"}
            strokeWidth={2.5}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      {last && (
        <span className="sr-only">{`Week ${last.week}: ${fmt(last.value)}, ${state === "in" ? "inside" : "outside"} the forecast band.`}</span>
      )}
    </section>
  );
}
