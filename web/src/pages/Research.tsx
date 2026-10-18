// Research workspace: population level model performance only. Individual records stay on the
// patient screens; nothing here identifies a participant.

import { Check, X } from "lucide-react";
import { useCohort } from "@/api/client";
import { ErrorState } from "@/components/common";
import { CHART } from "@/components/charts/chartTheme";
import { LineTrace } from "@/components/charts/LineTrace";
import { ScatterDiagonal } from "@/components/charts/ScatterDiagonal";
import { SectionCard } from "@/dashboard/components";

export default function Research() {
  const { data, isLoading, error, refetch } = useCohort();

  const coverage = (data?.coverage ?? []).map((c) => ({ week: c.week, cov: c.cov }));
  const points = (data?.k_true ?? []).map((k, i) => ({ x: k, y: data?.k_est[i] ?? k }));
  const inside = (data?.effects ?? []).filter((e) => e.true >= e.lo && e.true <= e.hi).length;

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-[26px] font-semibold tracking-[-0.025em]">Research</h1>
        <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-[#6d675e]">
          Population level calibration and parameter recovery for the shared recovery model. Aggregates only: no
          individual trajectory is shown here, and every record is synthetic.
        </p>
      </header>

      {isLoading && (
        <div role="status" aria-label="Loading the cohort model" className="grid gap-3 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="dash-card h-[86px] animate-pulse bg-[#faf7f1]" />
          ))}
        </div>
      )}
      {error && <ErrorState error={error} onRetry={() => refetch()} />}

      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="dash-card px-4 py-3.5">
              <p className="text-[11px] text-[#6d675e]">Cohort size</p>
              <p className="mt-1 text-[24px] font-semibold leading-none">{data.size}</p>
              <p className="mt-1.5 text-[11px] text-[#8b8375]">synthetic records in the shared model</p>
            </div>
            <div className="dash-card px-4 py-3.5">
              <p className="text-[11px] text-[#6d675e]">Coverage at week 12</p>
              <p className="mt-1 text-[24px] font-semibold leading-none">
                {data.coverage[data.coverage.length - 1]?.cov.toFixed(2)}
              </p>
              <p className="mt-1.5 text-[11px] text-[#8b8375]">observations inside the 80% band · target 0.80</p>
            </div>
            <div className="dash-card px-4 py-3.5">
              <p className="text-[11px] text-[#6d675e]">Effects estimated</p>
              <p className="mt-1 text-[24px] font-semibold leading-none">{data.effects.length}</p>
              <p className="mt-1.5 text-[11px] text-[#8b8375]">
                {inside} with the true value inside the 90% interval
              </p>
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <SectionCard
              title="Band coverage by week"
              subtitle="Share of measurements inside the 80% band. Near 0.8 is honest; much higher means the band is too wide."
              bodyClassName="px-3 pb-3 pt-4"
            >
              <LineTrace
                data={coverage}
                x="week"
                xLabel="week"
                yDomain={[0.4, 1]}
                series={[{ key: "cov", label: "Coverage", color: CHART.mean }]}
                refLine={{ y: 0.8, label: "0.8 target" }}
                height={240}
              />
            </SectionCard>

            <SectionCard
              title="Recovery rate recovery"
              subtitle="True healing rate against the model estimate, one dot per patient. Dots on the diagonal mean the model got it right."
              bodyClassName="px-3 pb-3 pt-4"
            >
              <ScatterDiagonal points={points} xLabel="true k" yLabel="estimated k" />
            </SectionCard>
          </div>

          <SectionCard
            title="Parameter recovery"
            subtitle="Population effects with the model's 90% interval. A check means the true value sits inside that interval."
            bodyClassName="p-0"
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-[#ece6dc] bg-[#fbf9f4]">
                    {["Effect", "True", "Estimated", "90% interval", "Inside"].map((h) => (
                      <th key={h} scope="col" className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#8b8375]">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.effects.map((e) => {
                    const ok = e.true >= e.lo && e.true <= e.hi;
                    return (
                      <tr key={e.name} className="border-b border-[#f1ece4] last:border-0">
                        <td className="px-4 py-2.5 font-mono text-[12px]">{e.name}</td>
                        <td className="px-4 py-2.5 text-[12px] tabular-nums">{e.true.toFixed(3)}</td>
                        <td className="px-4 py-2.5 text-[12px] tabular-nums">{e.est.toFixed(3)}</td>
                        <td className="px-4 py-2.5 text-[12px] tabular-nums text-[#6d675e]">
                          {e.lo.toFixed(3)} to {e.hi.toFixed(3)}
                        </td>
                        <td className="px-4 py-2.5">
                          <span className="inline-flex items-center gap-1 rounded-[4px] bg-[#f1ece4] px-1.5 py-0.5 text-[10px] text-[#55504a]">
                            {ok ? <Check className="h-3 w-3" aria-hidden /> : <X className="h-3 w-3" aria-hidden />}
                            {ok ? "inside" : "outside"}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="border-t border-[#f1ece4] px-4 py-3 text-[11px] leading-relaxed text-[#8b8375]">
              c_e4 and c_bio shift the healing rate; b_e4 and b_fe4 shift the share of damage that remains. These are
              population effects fitted on synthetic data. They describe the model, not any person.
            </p>
          </SectionCard>

          <SectionCard title="What this workspace does not do" subtitle="Explicit limits of the prototype.">
            <ul className="grid gap-2 text-[11px] leading-relaxed text-[#6d675e] sm:grid-cols-2">
              <li className="rounded-[7px] border border-[#ece6dc] bg-[#fbf9f4] px-3 py-2">
                No cohort export. Aggregates can be read here, but there is no server route that packages them.
              </li>
              <li className="rounded-[7px] border border-[#ece6dc] bg-[#fbf9f4] px-3 py-2">
                No custom cohort selection. The shared model is the only aggregate the backend serves.
              </li>
              <li className="rounded-[7px] border border-[#ece6dc] bg-[#fbf9f4] px-3 py-2">
                No per-patient comparison inside this screen. Use a patient's scenario comparison for that.
              </li>
              <li className="rounded-[7px] border border-[#ece6dc] bg-[#fbf9f4] px-3 py-2">
                No inferential claim. Intervals describe parameter recovery on synthetic records.
              </li>
            </ul>
          </SectionCard>
        </>
      )}
    </div>
  );
}
