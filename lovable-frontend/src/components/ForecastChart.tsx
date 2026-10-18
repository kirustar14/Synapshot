import { Area, CartesianGrid, ComposedChart, ErrorBar, Line, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from "recharts";
import type { Forecast, Signal } from "@/api/types";
import { ModelLabel, SyntheticBadge } from "./common";

const GROUPS: { key: Signal["group"]; label: string }[] = [
  { key: "eyes", label: "Eyes" }, { key: "speech", label: "Speech" }, { key: "memory", label: "Memory" }, { key: "symptoms", label: "Symptoms" },
];

export function SignalChart({ signal, overlay, height = 150, color = "var(--color-primary)" }: { signal: Signal; overlay?: Signal; height?: number; color?: string }) {
  const data = signal.mean.map((m, w) => {
    const o = signal.obs.find((x) => x.week === w);
    return { week: w, band: [signal.lo[w], signal.hi[w]], mean: m, obs: o?.value, err: o?.sem, cf: overlay?.mean[w] };
  });
  return (
    <div style={{ height }} aria-label={`${signal.label} forecast chart`} role="img">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 6, right: 6, bottom: 0, left: -18 }}>
          <CartesianGrid stroke="var(--color-border)" vertical={false} />
          <XAxis dataKey="week" tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }} tickLine={false} axisLine={false} domain={["auto", "auto"]} width={46} />
          <Tooltip contentStyle={{ background: "var(--color-popover)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 }}
            formatter={(v: unknown, n: string) => [Array.isArray(v) ? `${(v[0] as number).toFixed(2)} to ${(v[1] as number).toFixed(2)}` : typeof v === "number" ? v.toFixed(2) : String(v), n === "band" ? "80% band" : n === "cf" ? "Counterfactual" : n]} labelFormatter={(l) => `Week ${l}`} />
          <Area dataKey="band" stroke="none" fill={color} fillOpacity={0.15} isAnimationActive={false} />
          <Line dataKey="mean" stroke={color} strokeWidth={2} dot={false} isAnimationActive={false} />
          {overlay && <Line dataKey="cf" stroke="var(--color-chart-3)" strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} />}
          <Scatter dataKey="obs" fill="var(--color-foreground)" isAnimationActive={false}>
            <ErrorBar dataKey="err" width={3} stroke="var(--color-foreground)" strokeWidth={1} direction="y" />
          </Scatter>
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ForecastGrid({ forecast, overlay, synthetic = true, compact }: { forecast: Forecast; overlay?: Forecast; synthetic?: boolean; compact?: boolean }) {
  return (
    <div className={compact ? "grid gap-3 sm:grid-cols-2" : "grid gap-4 md:grid-cols-2"}>
      {GROUPS.map((g) => {
        const sigs = forecast.signals.filter((s) => s.group === g.key && s.tier === "A");
        if (!sigs.length) return null;
        return (
          <div key={g.key} className="min-w-0 border-b border-border/60 py-3">
            <div className="mb-1 flex items-center justify-between gap-2">
              <h3 className="text-sm font-extrabold text-foreground">{g.label}</h3>
              {synthetic && <SyntheticBadge />}
            </div>
            {sigs.map((s) => (
              <div key={s.key}>
                <p className="text-xs font-medium">{s.label} <span className="text-muted-foreground">({s.unit})</span></p>
                <SignalChart signal={s} overlay={overlay?.signals.find((o) => o.key === s.key)} height={compact ? 110 : 130} />
              </div>
            ))}
          </div>
        );
      })}
      <div className="col-span-full flex flex-wrap items-center gap-4 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-5 rounded-sm bg-band" aria-hidden /> 80% band</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-5 bg-primary" aria-hidden /> Forecast mean</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-foreground" aria-hidden /> Observed with error</span>
        {overlay && <span className="inline-flex items-center gap-1.5"><span className="w-5 border-t-2 border-dashed border-chart-3" aria-hidden /> Counterfactual</span>}
        <ModelLabel />
      </div>
    </div>
  );
}
