// Cohort insights. Calibration and parameter recovery for the shared recovery model, which is
// the honest way to show that the model gets better as patients join.

import { Check, X } from "lucide-react";
import { useCohort } from "@/api/client";
import { ErrorState, Loading, ModelLabel, PageHeader, Panel } from "@/components/common";
import { CHART } from "@/components/charts/chartTheme";
import { LineTrace } from "@/components/charts/LineTrace";
import { ScatterDiagonal } from "@/components/charts/ScatterDiagonal";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default function Cohort() {
  const { data, isLoading, error, refetch } = useCohort();

  const coverage = (data?.coverage ?? []).map((c) => ({ week: c.week, cov: c.cov }));
  const points = (data?.k_true ?? []).map((k, i) => ({ x: k, y: data?.k_est[i] ?? k }));

  return (
    <>
      <PageHeader
        title="The shared model improves as patients join"
        subtitle="Every patient contributes to one population model, so the priors on recovery get tighter and the forecast bands get more honest for everyone."
        actions={<ModelLabel />}
      />

      {isLoading && <Loading label="Loading the cohort" />}
      {error && <ErrorState error={error} onRetry={() => refetch()} />}

      {data && (
        <div className="space-y-5">
          <div className="grid gap-5 sm:grid-cols-3">
            <Panel title="Patients">
              <p className="text-3xl font-extrabold">{data.size}</p>
              <p className="text-xs text-muted-foreground">synthetic records in the shared model</p>
            </Panel>
            <Panel title="Coverage at week 12">
              <p className="text-3xl font-extrabold">{data.coverage[data.coverage.length - 1]?.cov.toFixed(2)}</p>
              <p className="text-xs text-muted-foreground">share of measurements inside the 80% band, target 0.8</p>
            </Panel>
            <Panel title="Effects estimated">
              <p className="text-3xl font-extrabold">{data.effects.length}</p>
              <p className="text-xs text-muted-foreground">
                {data.effects.filter((e) => e.true >= e.lo && e.true <= e.hi).length} with the true value inside the 90% interval
              </p>
            </Panel>
          </div>

          <Panel
            title="Coverage by week"
            subtitle="Share of measurements that landed inside the 80% band, across the whole cohort. It should climb toward 0.8 and settle there."
          >
            <LineTrace
              data={coverage}
              x="week"
              xLabel="week"
              yDomain={[0.4, 1]}
              series={[{ key: "cov", label: "Coverage", color: CHART.mean }]}
              refLine={{ y: 0.8, label: "0.8 target" }}
              height={260}
            />
          </Panel>

          <Panel
            title="Recovery rate recovery"
            subtitle="The true healing rate k against the one the model estimated, one dot per patient. Dots on the diagonal mean the model got it right."
          >
            <ScatterDiagonal points={points} xLabel="true k" yLabel="estimated k" />
          </Panel>

          <Panel
            title="Parameter recovery"
            subtitle="The population effects, with the 90% interval the model returned. A green check means the true value is inside that interval."
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Effect</TableHead>
                  <TableHead className="text-right">True</TableHead>
                  <TableHead className="text-right">Estimated</TableHead>
                  <TableHead className="text-right">90% interval</TableHead>
                  <TableHead>Inside</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.effects.map((e) => {
                  const inside = e.true >= e.lo && e.true <= e.hi;
                  return (
                    <TableRow key={e.name}>
                      <TableCell className="font-mono font-bold">{e.name}</TableCell>
                      <TableCell className="text-right font-mono">{e.true.toFixed(3)}</TableCell>
                      <TableCell className="text-right font-mono">{e.est.toFixed(3)}</TableCell>
                      <TableCell className="text-right font-mono text-muted-foreground">
                        {e.lo.toFixed(3)} to {e.hi.toFixed(3)}
                      </TableCell>
                      <TableCell>
                        <span
                          className={
                            inside
                              ? "inline-flex items-center gap-1 rounded-full border border-success/30 bg-success-soft px-2 py-0.5 text-[11px] font-medium text-success"
                              : "inline-flex items-center gap-1 rounded-full border border-destructive/30 bg-destructive-soft px-2 py-0.5 text-[11px] font-medium text-destructive"
                          }
                        >
                          {inside ? <Check className="h-3 w-3" aria-hidden /> : <X className="h-3 w-3" aria-hidden />}
                          {inside ? "inside" : "outside"}
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              c_e4 and c_bio shift the healing rate, b_e4 and b_fe4 shift the share of damage that stays. These are
              population effects fitted on synthetic data, so they say something about the model and nothing about any
              real person.
            </p>
          </Panel>
        </div>
      )}
    </>
  );
}
