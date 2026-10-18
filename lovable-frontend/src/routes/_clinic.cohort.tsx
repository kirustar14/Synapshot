import { createFileRoute } from "@tanstack/react-router";
import { Check, X } from "lucide-react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from "recharts";
import { useCohort } from "@/api/client";
import { ErrorState, Loading, ModelLabel, PageHeader, Panel, SyntheticBadge } from "@/components/common";

export const Route = createFileRoute("/_clinic/cohort")({
  head: () => ({
    meta: [
      { title: "Cohort | UNNAMED" },
      { name: "description", content: "The shared model improves as patients join: coverage and parameter recovery." },
      { property: "og:title", content: "Cohort | UNNAMED" },
      { property: "og:description", content: "Population calibration and parameter recovery for the shared model." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CohortPage,
});

const tip = { background: "var(--color-popover)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 };

function CohortPage() {
  const { data, isLoading, error, refetch } = useCohort();
  if (isLoading) return <Loading />;
  if (error || !data) return <ErrorState error={error} onRetry={refetch} />;
  const pts = data.k_true.map((t, i) => ({ t, e: data.k_est[i] }));
  const min = Math.min(...data.k_true, ...data.k_est), max = Math.max(...data.k_true, ...data.k_est);
  return (
    <>
      <PageHeader title="The shared model improves as patients join" subtitle={`${data.size} patients in the cohort`} actions={<><ModelLabel /><SyntheticBadge /></>} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Coverage of the 80% band by week" subtitle="Dashed line is the 0.8 target">
          <div className="h-72" role="img" aria-label="Cohort coverage by week">
            <ResponsiveContainer>
              <LineChart data={data.coverage} margin={{ left: -10, right: 10 }}>
                <CartesianGrid stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey="week" tick={{ fontSize: 11 }} label={{ value: "Week", position: "insideBottom", offset: -2, fontSize: 11 }} />
                <YAxis domain={[0.4, 1]} tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={tip} />
                <ReferenceLine y={0.8} stroke="var(--color-chart-3)" strokeDasharray="5 4" label={{ value: "Target 0.8", fontSize: 10, position: "right" }} />
                <Line dataKey="cov" stroke="var(--color-primary)" strokeWidth={2.5} dot={{ r: 3 }} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="True versus estimated recovery rate k" subtitle="Points near the diagonal mean the model recovers each patient's k">
          <div className="h-72" role="img" aria-label="Scatter of true versus estimated k">
            <ResponsiveContainer>
              <ScatterChart margin={{ left: -10, right: 10 }}>
                <CartesianGrid stroke="var(--color-border)" />
                <XAxis type="number" dataKey="t" name="True k" domain={[min, max]} tick={{ fontSize: 11 }} tickFormatter={(v) => v.toFixed(2)} />
                <YAxis type="number" dataKey="e" name="Estimated k" domain={[min, max]} tick={{ fontSize: 11 }} tickFormatter={(v) => v.toFixed(2)} />
                <Tooltip contentStyle={tip} />
                <ReferenceLine segment={[{ x: min, y: min }, { x: max, y: max }]} stroke="var(--color-muted-foreground)" strokeDasharray="4 4" />
                <Scatter data={pts} fill="var(--color-primary)" isAnimationActive={false} />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="Parameter recovery" className="lg:col-span-2">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-1.5 font-medium">Effect</th><th className="font-medium">True</th><th className="font-medium">Estimated</th><th className="font-medium">90% interval</th><th className="font-medium">Recovered</th></tr></thead>
            <tbody>{data.effects.map((e) => {
              const ok = e.true >= e.lo && e.true <= e.hi;
              return (
                <tr key={e.name} className="border-t">
                  <td className="py-2 font-mono">{e.name}</td><td className="font-mono">{e.true.toFixed(3)}</td><td className="font-mono">{e.est.toFixed(3)}</td>
                  <td className="font-mono">{e.lo.toFixed(3)} to {e.hi.toFixed(3)}</td>
                  <td>{ok ? <span className="inline-flex items-center gap-1 text-success"><Check className="h-4 w-4" aria-hidden /> Inside</span> : <span className="inline-flex items-center gap-1 text-destructive"><X className="h-4 w-4" aria-hidden /> Outside</span>}</td>
                </tr>
              );
            })}</tbody>
          </table>
        </Panel>
      </div>
    </>
  );
}
