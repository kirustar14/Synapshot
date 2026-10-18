// Counterfactual sliders. Debounced so dragging does not hammer the route, cached per setting
// so dragging back is instant, and overlaid on the baseline forecast as a dashed line. The same
// recovery multiplier tints the healing layer on the mesh.

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "@/api/client";
import type { Forecast } from "@/api/types";
import { CHART, axisProps, tooltipLabelStyle, tooltipStyle } from "@/components/charts/chartTheme";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { useViewer } from "./viewerStore";

export function CounterfactualPanel({ patientId, baseline }: { patientId: string; baseline: Forecast | undefined }) {
  const v = useViewer();
  const [debounced, setDebounced] = useState({ k: v.recoveryMult, p: v.permShift });
  const [signalKey, setSignalKey] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced({ k: v.recoveryMult, p: v.permShift }), 400);
    return () => clearTimeout(timer);
  }, [v.recoveryMult, v.permShift]);

  const cf = useQuery({
    queryKey: ["counterfactual", patientId, debounced.k, debounced.p],
    queryFn: () => api.counterfactual(patientId, { k_mult: debounced.k, p_add: debounced.p }),
    enabled: v.cfOn && !!patientId,
    staleTime: Infinity,
  });

  const signals = baseline?.signals ?? [];
  const key = signalKey ?? signals[0]?.key ?? null;
  const base = signals.find((s) => s.key === key);
  const alt = cf.data?.signals.find((s) => s.key === key);
  const weeks = baseline?.weeks ?? [];

  const rows = weeks.map((w, i) => ({
    week: w,
    baseline: base?.mean[i] ?? null,
    counterfactual: alt?.mean[i] ?? null,
  }));

  return (
    <div className="space-y-4">
      <label className="flex items-center justify-between gap-3 text-xs font-bold">
        Run a counterfactual
        <Switch checked={v.cfOn} onCheckedChange={(c) => v.setCf({ cfOn: c })} aria-label="Turn the counterfactual on" />
      </label>

      <label className="block">
        <span className="flex items-baseline justify-between text-xs font-bold">
          Recovery rate
          <span className="font-mono tabular-nums">{v.recoveryMult.toFixed(2)}x</span>
        </span>
        <Slider
          className="mt-2"
          value={[Math.round(v.recoveryMult * 100)]}
          min={50}
          max={200}
          step={5}
          onValueChange={([k]) => v.setCf({ recoveryMult: k / 100, cfOn: true })}
          aria-label="Recovery rate multiplier, from half to double"
        />
      </label>

      <label className="block">
        <span className="flex items-baseline justify-between text-xs font-bold">
          Permanent damage shift
          <span className="font-mono tabular-nums">
            {v.permShift >= 0 ? "+" : ""}
            {v.permShift.toFixed(2)}
          </span>
        </span>
        <Slider
          className="mt-2"
          value={[Math.round(v.permShift * 100)]}
          min={-20}
          max={30}
          step={2}
          onValueChange={([p]) => v.setCf({ permShift: p / 100, cfOn: true })}
          aria-label="Permanent damage shift"
        />
      </label>

      {signals.length > 1 && (
        <label className="block">
          <span className="text-[11px] font-bold">Signal</span>
          <select
            value={key ?? ""}
            onChange={(e) => setSignalKey(e.target.value)}
            className="mt-1 h-9 w-full rounded-md border border-input bg-transparent px-2 text-xs"
          >
            {signals.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      )}

      <div style={{ height: 170 }} role="img" aria-label={`${base?.label ?? "Signal"} baseline against the counterfactual`}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 6, right: 8, bottom: 0, left: -18 }}>
            <CartesianGrid stroke={CHART.grid} vertical={false} />
            <XAxis dataKey="week" {...axisProps} />
            <YAxis {...axisProps} width={46} domain={["auto", "auto"]} />
            <Tooltip
              contentStyle={tooltipStyle}
              labelStyle={tooltipLabelStyle}
              labelFormatter={(w) => `Week ${w}`}
              formatter={(value, name) => [
                typeof value === "number" ? value.toFixed(2) : String(value),
                name === "baseline" ? "Baseline" : "Counterfactual",
              ]}
            />
            <Line dataKey="baseline" stroke={CHART.mean} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
            <Line
              dataKey="counterfactual"
              stroke={CHART.third}
              strokeWidth={2}
              strokeDasharray="5 4"
              dot={false}
              isAnimationActive={false}
              connectNulls
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Solid is the current forecast. Dashed is the counterfactual. {v.cfOn ? "The healing layer on the brain is tinted by the same multiplier." : "Turn it on to tint the healing layer too."}{" "}
        {cf.isFetching && "Running."}
        {cf.error ? ` ${cf.error.message}` : ""}
      </p>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        A counterfactual asks what the same twin would have done with a different recovery rate. It is not a prediction
        about a treatment.
      </p>
    </div>
  );
}
