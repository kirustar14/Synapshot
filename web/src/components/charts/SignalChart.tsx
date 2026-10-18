// One forecast signal: the 80% band as a shaded area, the mean line, and the observed points
// with their error bars. The band is drawn as a transparent floor at lo plus a stacked span, so
// it is a real shaded interval rather than two separate lines.

import {
  Area,
  CartesianGrid,
  ComposedChart,
  ErrorBar,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Signal } from "@/api/types";
import { CHART, axisProps, tooltipLabelStyle, tooltipStyle } from "./chartTheme";

interface Row {
  week: number;
  lo: number;
  span: number;
  mean: number;
  obs: number | null;
  sem: number;
}

/** One row per forecast week, with the observation for that week when there is one. */
function toRows(signal: Signal, weeks: number[]): Row[] {
  const byWeek = new Map(signal.obs.map((o) => [o.week, o]));
  return weeks.map((w, i) => {
    const o = byWeek.get(w);
    return {
      week: w,
      lo: signal.lo[i],
      span: Math.max(0, signal.hi[i] - signal.lo[i]),
      mean: signal.mean[i],
      obs: o ? o.value : null,
      sem: o ? o.sem : 0,
    };
  });
}

export function ChartKey() {
  return (
    <ul className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
      <li className="flex items-center gap-1.5">
        <span className="h-2.5 w-4 rounded-sm" style={{ background: CHART.band }} aria-hidden /> 80% band
      </li>
      <li className="flex items-center gap-1.5">
        <span className="h-0.5 w-4" style={{ background: CHART.mean }} aria-hidden /> Forecast mean
      </li>
      <li className="flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full" style={{ background: CHART.obs }} aria-hidden /> Measured, with error bar
      </li>
    </ul>
  );
}

export function SignalChart({
  signal,
  weeks,
  week,
  height = 150,
  caption = true,
}: {
  signal: Signal;
  weeks: number[];
  week: number;
  height?: number;
  caption?: boolean;
}) {
  const rows = toRows(signal, weeks);

  return (
    <figure className="m-0">
      <figcaption className={caption ? "mb-1 flex flex-wrap items-baseline justify-between gap-2" : "sr-only"}>
        <span className="text-sm font-bold">{signal.label}</span>
        <span className="text-[11px] text-muted-foreground">
          {signal.unit ? `${signal.unit}, ` : ""}
          {signal.obs.length} measured
        </span>
      </figcaption>
      <div style={{ height }} role="img" aria-label={`${signal.label} forecast in ${signal.unit} with an 80 percent band`}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 6, right: 8, bottom: 0, left: -6 }}>
            <CartesianGrid stroke={CHART.grid} vertical={false} />
            <XAxis dataKey="week" {...axisProps} />
            <YAxis {...axisProps} width={44} domain={["auto", "auto"]} tickFormatter={(v: number) => String(+v.toFixed(2))} />
            <Tooltip
              contentStyle={tooltipStyle}
              labelStyle={tooltipLabelStyle}
              labelFormatter={(v) => `Week ${v}`}
              formatter={(value, name) => {
                if (name === "span" || name === "lo") return [];
                const label = name === "mean" ? "Forecast mean" : "Measured";
                return [typeof value === "number" ? value.toFixed(2) : String(value), label];
              }}
            />
            <Area dataKey="lo" stackId="band" stroke="none" fill="none" isAnimationActive={false} />
            <Area dataKey="span" stackId="band" stroke="none" fill={CHART.band} isAnimationActive={false} />
            <Line dataKey="mean" stroke={CHART.mean} strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line
              dataKey="obs"
              stroke="none"
              connectNulls={false}
              isAnimationActive={false}
              dot={{ r: 3, fill: CHART.obs, stroke: "none" }}
              activeDot={{ r: 4 }}
            >
              <ErrorBar dataKey="sem" direction="y" width={4} strokeWidth={1.4} stroke={CHART.obs} />
            </Line>
            <ReferenceLine x={week} stroke={CHART.axis} strokeDasharray="3 3" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
