// A general purpose multi series line chart. Used for gaze traces, the exploratory face traces
// and cohort coverage, so those three screens share one set of axis and legend rules.

import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CHART, axisProps, tooltipLabelStyle, tooltipStyle } from "./chartTheme";

export interface TraceSeries {
  key: string;
  label: string;
  color: string;
  dashed?: boolean;
  width?: number;
}

export function LineTrace({
  data,
  x,
  series,
  height = 170,
  xLabel,
  yLabel,
  refLine,
  yDomain,
  digits = 2,
}: {
  data: Record<string, number>[];
  x: string;
  series: TraceSeries[];
  height?: number;
  xLabel?: string;
  yLabel?: string;
  refLine?: { y: number; label: string };
  yDomain?: [number | "auto", number | "auto"];
  digits?: number;
}) {
  return (
    <div>
      <ul className="mb-1 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
        {series.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <span
              className="h-0.5 w-5"
              style={{ background: s.dashed ? "none" : s.color, borderTop: s.dashed ? `2px dashed ${s.color}` : undefined }}
              aria-hidden
            />
            {s.label}
          </li>
        ))}
        {refLine && (
          <li className="flex items-center gap-1.5">
            <span className="h-0.5 w-5" style={{ borderTop: `2px dashed ${CHART.axis}` }} aria-hidden /> {refLine.label}
          </li>
        )}
      </ul>
      <div
        style={{ height }}
        role="img"
        aria-label={`${series.map((s) => s.label).join(" and ")}${yLabel ? ` in ${yLabel}` : ""}${xLabel ? ` against ${xLabel}` : ""}`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 6, right: 10, bottom: xLabel ? 16 : 0, left: -14 }}>
            <CartesianGrid stroke={CHART.grid} vertical={false} />
            <XAxis
              dataKey={x}
              {...axisProps}
              minTickGap={40}
              label={xLabel ? { value: xLabel, position: "insideBottom", offset: -8, fill: CHART.axis, fontSize: 11 } : undefined}
            />
            <YAxis {...axisProps} width={46} domain={yDomain ?? ["auto", "auto"]} />
            <Tooltip
              contentStyle={tooltipStyle}
              labelStyle={tooltipLabelStyle}
              formatter={(value, name) => {
                const match = series.find((s) => s.key === name);
                return [typeof value === "number" ? value.toFixed(digits) : String(value), match ? match.label : String(name)];
              }}
            />
            {refLine && <ReferenceLine y={refLine.y} stroke={CHART.axis} strokeDasharray="4 4" />}
            {series.map((s) => (
              <Line
                key={s.key}
                dataKey={s.key}
                stroke={s.color}
                strokeWidth={s.width ?? 2}
                strokeDasharray={s.dashed ? "5 4" : undefined}
                dot={false}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
