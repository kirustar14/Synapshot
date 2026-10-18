// A tiny axis free line, used for coverage by week on the calibration card.

import { Line, LineChart, ReferenceLine, ResponsiveContainer, YAxis } from "recharts";
import { CHART } from "./chartTheme";

export function Sparkline({
  points,
  target,
  height = 44,
  label,
}: {
  points: { x: number; y: number }[];
  target?: number;
  height?: number;
  label: string;
}) {
  return (
    <div style={{ height }} role="img" aria-label={label}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 4, right: 2, bottom: 0, left: 2 }}>
          <YAxis hide domain={[0, 1]} />
          {target !== undefined && <ReferenceLine y={target} stroke={CHART.axis} strokeDasharray="2 3" />}
          <Line dataKey="y" stroke={CHART.mean} strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
