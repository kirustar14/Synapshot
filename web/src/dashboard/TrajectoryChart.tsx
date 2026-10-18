// One signal over time: measured points with their error bars, then the model forecast as a
// dashed mean and an 80 percent band. The shading and the rule at the current week make the
// boundary between observation and forecast explicit.

import {
  Area,
  CartesianGrid,
  ComposedChart,
  ErrorBar,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Signal } from "@/api/types";
import { CHART, axisProps, tooltipLabelStyle, tooltipStyle } from "@/components/charts/chartTheme";

export function TrajectoryChart({
  signal,
  weeks,
  week,
  height = 260,
}: {
  signal: Signal;
  weeks: number[];
  week: number;
  height?: number;
}) {
  const byWeek = new Map(signal.obs.map((o) => [o.week, o]));
  // The forecast is drawn from the current week forward. Before it, only measurements exist,
  // so the dashed line never sits underneath the observed points.
  const rows = weeks.map((w, i) => {
    const o = byWeek.get(w);
    const forecastFrom = w >= week;
    return {
      week: w,
      lo: forecastFrom ? signal.lo[i] : null,
      span: forecastFrom ? Math.max(0, signal.hi[i] - signal.lo[i]) : null,
      mean: forecastFrom ? signal.mean[i] : null,
      obs: o ? o.value : null,
      sem: o ? o.sem : 0,
    };
  });

  return (
    <div>
      <ul className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[#6d675e]">
        <li className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-[#1c1a17]" aria-hidden /> Measured
        </li>
        <li className="flex items-center gap-1.5">
          <span className="h-0 w-5 border-t border-dashed border-[#b4552f]" aria-hidden /> Model forecast (experimental)
        </li>
        <li className="flex items-center gap-1.5">
          <span className="h-2.5 w-4 rounded-[2px] bg-[#f0ddd1]" aria-hidden /> 80% uncertainty band
        </li>
      </ul>
      <div
        style={{ height }}
        role="img"
        aria-label={`${signal.label} in ${signal.unit || "index units"} by monitoring week. Measured values up to week ${week}, then the experimental forecast mean with an 80 percent band.`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 8, right: 10, bottom: 0, left: -8 }}>
            <CartesianGrid stroke={CHART.grid} vertical={false} />
            <XAxis dataKey="week" {...axisProps} tickFormatter={(v: number) => `W${v}`} />
            <YAxis
              {...axisProps}
              width={44}
              domain={["auto", "auto"]}
              tickFormatter={(v: number) => String(+v.toFixed(2))}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              labelStyle={tooltipLabelStyle}
              labelFormatter={(v) => `Week ${v}`}
              formatter={(value, name) => {
                if (name === "span" || name === "lo") return [];
                const label = name === "mean" ? "Forecast mean" : "Measured";
                return [
                  typeof value === "number" ? `${+value.toFixed(2)}${signal.unit ? ` ${signal.unit}` : ""}` : String(value),
                  label,
                ];
              }}
            />
            <ReferenceArea x1={week} x2={weeks[weeks.length - 1]} fill="#fdf8f2" fillOpacity={0.7} />
            <Area dataKey="lo" stackId="band" stroke="none" fill="none" isAnimationActive={false} />
            <Area dataKey="span" stackId="band" stroke="none" fill={CHART.band} isAnimationActive={false} />
            <Line dataKey="mean" stroke={CHART.mean} strokeWidth={1.6} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
            <Line
              dataKey="obs"
              stroke="none"
              connectNulls={false}
              isAnimationActive={false}
              dot={{ r: 3, fill: CHART.obs, stroke: "#fffdfa", strokeWidth: 1.5 }}
              activeDot={{ r: 4 }}
            >
              <ErrorBar dataKey="sem" direction="y" width={3} strokeWidth={1.2} stroke={CHART.obs} />
            </Line>
            <ReferenceLine
              x={week}
              stroke="#b4552f"
              strokeDasharray="3 3"
              label={{ value: "last check-in", position: "insideTopLeft", fill: "#a8492a", fontSize: 10 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-1.5 text-[11px] leading-relaxed text-[#8b8375]">
        Forecast from week {week} to 12 is experimental and not a diagnosis. Shaded weeks have not been measured yet.
      </p>
    </div>
  );
}
