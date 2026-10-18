// Shared Recharts tokens. Every chart reads its colours from the theme variables, so light and
// dark mode both work with no per chart overrides.

export const CHART = {
  grid: "var(--border)",
  axis: "var(--muted-foreground)",
  band: "var(--band)",
  mean: "var(--chart-1)",
  obs: "var(--foreground)",
  target: "var(--chart-3)",
  gaze: "var(--chart-1)",
  second: "var(--chart-2)",
  third: "var(--chart-4)",
  alarm: "var(--chart-5)",
  ok: "var(--success)",
} as const;

/** Axis defaults: no tick lines, no axis line, small muted labels. */
export const axisProps = {
  stroke: CHART.axis,
  tick: { fill: CHART.axis, fontSize: 11 },
  tickLine: false,
  axisLine: false,
} as const;

export const tooltipStyle = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  color: "var(--popover-foreground)",
  fontSize: 12,
  padding: "6px 10px",
};

export const tooltipLabelStyle = { color: "var(--muted-foreground)", fontSize: 11 };
