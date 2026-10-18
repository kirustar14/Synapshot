// A scatter of two values that should agree, with the identity diagonal drawn so a reader can
// see the bias at a glance. Used for true against estimated recovery rate on the cohort page.

import { CartesianGrid, ResponsiveContainer, Scatter, ScatterChart, ReferenceLine, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { CHART, axisProps, tooltipLabelStyle, tooltipStyle } from "./chartTheme";

export function ScatterDiagonal({
  points,
  xLabel,
  yLabel,
  height = 280,
}: {
  points: { x: number; y: number }[];
  xLabel: string;
  yLabel: string;
  height?: number;
}) {
  const values = points.flatMap((p) => [p.x, p.y]);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = (hi - lo) * 0.08 || 0.01;
  const domain: [number, number] = [Number((lo - pad).toFixed(3)), Number((hi + pad).toFixed(3))];

  return (
    <div>
      <ul className="mb-1 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
        <li className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: CHART.mean }} aria-hidden /> One patient
        </li>
        <li className="flex items-center gap-1.5">
          <span className="h-0.5 w-5" style={{ borderTop: `2px dashed ${CHART.axis}` }} aria-hidden /> Perfect agreement
        </li>
      </ul>
      <div style={{ height }} role="img" aria-label={`${yLabel} against ${xLabel}, with the perfect agreement diagonal`}>
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 8, right: 12, bottom: 18, left: -8 }}>
            <CartesianGrid stroke={CHART.grid} />
            <XAxis
              type="number"
              dataKey="x"
              domain={domain}
              {...axisProps}
              label={{ value: xLabel, position: "insideBottom", offset: -10, fill: CHART.axis, fontSize: 11 }}
            />
            <YAxis type="number" dataKey="y" domain={domain} width={52} {...axisProps} />
            <ZAxis range={[36, 36]} />
            <Tooltip
              contentStyle={tooltipStyle}
              labelStyle={tooltipLabelStyle}
              formatter={(value, name) => [
                typeof value === "number" ? value.toFixed(3) : String(value),
                name === "x" ? xLabel : yLabel,
              ]}
            />
            <ReferenceLine
              segment={[
                { x: domain[0], y: domain[0] },
                { x: domain[1], y: domain[1] },
              ]}
              stroke={CHART.axis}
              strokeDasharray="4 4"
            />
            <Scatter data={points} fill={CHART.mean} fillOpacity={0.7} isAnimationActive={false} />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">Vertical axis, {yLabel}. Horizontal axis, {xLabel}.</p>
    </div>
  );
}
