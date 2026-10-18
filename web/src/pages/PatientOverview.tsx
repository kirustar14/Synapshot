// Patient overview: the recovery trajectory first, then the measurements that deserve a look,
// then the latest assessment and the care team's notes. Observations and model output are kept
// visually and verbally separate.

import { AlertTriangle, ArrowRight, Info, Minus } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useForecast } from "@/api/client";
import { ErrorState } from "@/components/common";
import { SectionCard } from "@/dashboard/components";
import { findingsOf, metricsOf, reviewOf, unitLabel } from "@/dashboard/derive";
import { formatNoteTime, notesFor } from "@/dashboard/notes";
import { TrajectoryChart } from "@/dashboard/TrajectoryChart";
import { cn } from "@/lib/utils";
import { usePatientContext } from "./PatientLayout";

const fmtValue = (v: number) => {
  const digits = Math.abs(v) >= 10 ? 0 : Math.abs(v) >= 1 ? 1 : 2;
  return v.toFixed(digits);
};

function MetricTile({
  label,
  group,
  value,
  unit,
  previous,
  mdc,
  changed,
  week,
}: {
  label: string;
  group: string;
  value: number;
  unit: string;
  previous: number | null;
  mdc: number;
  changed: boolean;
  week: number;
}) {
  const delta = previous === null ? null : value - previous;
  const mdcText = mdc >= 100 ? mdc.toFixed(0) : mdc >= 1 ? mdc.toFixed(2) : mdc.toFixed(2);
  return (
    <div className="dash-card px-4 py-3.5">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-[11px] text-[#6d675e]">{label}</p>
        <span className="shrink-0 text-[10px] uppercase tracking-[0.08em] text-[#a49c8f]">{group}</span>
      </div>
      <p className="mt-1.5 flex items-baseline gap-1">
        <span className="text-[22px] font-semibold leading-none tracking-[-0.02em]">{fmtValue(value)}</span>
        <span className="text-[11px] text-[#8b8375]">{unitLabel(unit)}</span>
      </p>
      <div className="mt-1.5 flex items-center gap-1.5 text-[11px]">
        {delta === null ? (
          <span className="text-[#8b8375]">First reading</span>
        ) : (
          <>
            <span className="text-[#55504a]">
              {delta === 0 ? "No change" : `${delta > 0 ? "Higher" : "Lower"} by ${fmtValue(Math.abs(delta))}`}
            </span>
            <span className="text-[#a49c8f]">vs previous</span>
          </>
        )}
      </div>
      <p className="mt-1 text-[10px] leading-snug text-[#a49c8f]">
        Week {week} · {changed ? `beyond the ${mdcText} ${unitLabel(unit)} noise threshold` : `within the ${mdcText} ${unitLabel(unit)} noise threshold`}
      </p>
    </div>
  );
}

export default function PatientOverview() {
  const { patient } = usePatientContext();
  const forecast = useForecast(patient.id);
  const notes = notesFor(patient.id);
  // No charted measure is chosen yet, so the chart opens on the memory signal: it is the one
  // the findings below are usually about, and it keeps the card and the findings in step.
  const [signalKey, setSignalKey] = useState<string | null>(null);

  const signals = useMemo(
    () => (forecast.data?.signals ?? []).filter((s) => s.tier === "A" && s.obs.length > 0),
    [forecast.data],
  );
  const preferred = useMemo(
    () => signals.find((s) => s.key === "recall_delayed") ?? signals.find((s) => s.key === "word_recall") ?? signals[0],
    [signals],
  );
  const signal = signals.find((s) => s.key === signalKey) ?? preferred;

  const findings = useMemo(
    () => (forecast.data ? findingsOf(forecast.data, patient) : []),
    [forecast.data, patient],
  );
  const metrics = useMemo(() => metricsOf(patient).slice(0, 4), [patient]);
  const openAlerts = patient.alerts.filter((a) => !a.acked);
  const review = reviewOf({
    id: patient.id,
    name: patient.name,
    week: patient.week,
    drift_z: 0,
    last_call: patient.last_call?.date ?? null,
    flags: Array.from(new Set(openAlerts.map((a) => a.type))),
    synthetic: true,
  });
  const call = patient.last_call;

  return (
    <div className="space-y-4">
      {openAlerts.some((a) => a.type === "red_flag") && (
        <div role="alert" className="flex items-start gap-2.5 rounded-[9px] border border-[#edd6cf] bg-[#fbf0ec] px-3.5 py-2.5">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#a83327]" aria-hidden />
          <div className="min-w-0 text-[12px]">
            <p className="font-medium text-[#96311f]">Safety question answered yes</p>
            <p className="mt-0.5 text-[#7c4a3e]">
              {openAlerts.find((a) => a.type === "red_flag")?.trigger}. Review the week {patient.week} check-in before
              anything else.
            </p>
          </div>
          <Link
            to={`/app/patients/${patient.id}/assessments${call ? `/${call.id}` : ""}`}
            className="ml-auto shrink-0 whitespace-nowrap text-[11px] font-medium text-[#96311f] hover:underline"
          >
            Open assessment
          </Link>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
        <SectionCard
          title="Recovery trajectory"
          subtitle="Measured points with their error bars, then the model's forecast and 80 percent band."
          action={
            <div className="flex items-center gap-2">
              {signals.length > 0 && (
                <>
                  <label htmlFor="signal-select" className="sr-only">
                    Measure to chart
                  </label>
                  <select
                    id="signal-select"
                    value={signal?.key ?? ""}
                    onChange={(e) => setSignalKey(e.target.value)}
                    className="h-7 max-w-[190px] rounded-[6px] border border-[#e6e0d6] bg-[#fbf9f4] px-2 text-[11px] text-[#55504a] outline-none focus:border-[#c9c0b1]"
                  >
                    {signals.map((s) => (
                      <option key={s.key} value={s.key}>
                        {s.label} ({s.unit})
                      </option>
                    ))}
                  </select>
                </>
              )}
              <Link
                to={`/app/patients/${patient.id}/recovery`}
                className="inline-flex items-center gap-1 text-[11px] text-[#8a4222] hover:underline"
              >
                Model <ArrowRight className="h-3 w-3" aria-hidden />
              </Link>
            </div>
          }
          bodyClassName="px-3 pb-3 pt-3"
        >
          {forecast.isLoading && (
            <div role="status" aria-label="Loading the trajectory" className="space-y-3 py-6">
              <div className="h-3 w-48 animate-pulse rounded bg-[#f1ece4]" />
              <div className="h-[220px] animate-pulse rounded-[7px] bg-[#faf7f1]" />
            </div>
          )}
          {forecast.error && <ErrorState error={forecast.error} onRetry={() => forecast.refetch()} />}
          {signal && forecast.data && (
            <TrajectoryChart signal={signal} weeks={forecast.data.weeks} week={patient.week} height={252} />
          )}
        </SectionCard>

        <SectionCard
          title="Key findings"
          subtitle="Observations that deserve a look, each tied to its baseline and evidence."
          bodyClassName="p-0"
        >
          {findings.length === 0 ? (
            <p className="px-4 py-6 text-[12px] text-[#6d675e]">No measurements are available to compare yet.</p>
          ) : (
            <ul className="divide-y divide-[#f1ece4]">
              {findings.slice(0, 2).map((f) => (
                <li key={f.key} className="px-4 py-3.5">
                  <div className="flex items-start gap-2">
                    {f.tone === "attention" ? (
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#a8492a]" aria-hidden />
                    ) : f.tone === "watch" ? (
                      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#a9762b]" aria-hidden />
                    ) : (
                      <Minus className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#4f7a56]" aria-hidden />
                    )}
                    <div className="min-w-0">
                      <p className="text-[12px] font-medium leading-snug text-[#1c1a17]">{f.title}</p>
                      <p className="mt-1 text-[11px] leading-relaxed text-[#6d675e]">{f.detail}</p>
                    </div>
                  </div>

                  <div className="mt-2.5">
                    <div className="flex items-center justify-between text-[10px] text-[#8b8375]">
                      <span>Observations inside the 80% band</span>
                      <span className="font-medium text-[#55504a]">{Math.round(f.coverage * 100)}%</span>
                    </div>
                    <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-[#ece6dc]" aria-hidden>
                      <div className="h-full rounded-full bg-[#c6a58d]" style={{ width: `${Math.round(f.coverage * 100)}%` }} />
                    </div>
                  </div>

                  <p className="mt-2 text-[10px] leading-relaxed text-[#8b8375]">{f.evidence}</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-[#55504a]">
                    <span className="text-[#8b8375]">Suggested next measurement: </span>
                    {f.next}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <div className="border-t border-[#f1ece4] px-4 py-2.5">
            <p className="text-[10px] leading-relaxed text-[#8b8375]">
              These are observations from the recorded measurements, not clinical conclusions. The forecast is a model
              output and is experimental.
            </p>
          </div>
        </SectionCard>
      </div>

      {metrics.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {metrics.map(({ key, ...metric }) => (
            <MetricTile key={key} {...metric} />
          ))}
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[1.25fr_1fr]">
        <SectionCard
          title="Latest assessment"
          subtitle={call ? `Week ${call.week} · ${new Date(call.date).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}` : "No completed assessment"}
          action={
            call ? (
              <Link
                to={`/app/patients/${patient.id}/assessments/${call.id}`}
                className="inline-flex items-center gap-1 text-[11px] text-[#8a4222] hover:underline"
              >
                View assessment <ArrowRight className="h-3 w-3" aria-hidden />
              </Link>
            ) : undefined
          }
        >
          {!call ? (
            <p className="text-[12px] text-[#6d675e]">
              No check-in has been completed. The first call link has not been opened.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
              <div>
                <p className="text-[11px] text-[#8b8375]">Duration</p>
                <p className="mt-0.5 text-[13px] font-medium">{Math.round(call.duration_s / 60)} min</p>
              </div>
              <div>
                <p className="text-[11px] text-[#8b8375]">Tasks completed</p>
                <p className="mt-0.5 text-[13px] font-medium">{call.steps.length}</p>
              </div>
              <div>
                <p className="text-[11px] text-[#8b8375]">Capture rate</p>
                <p className="mt-0.5 text-[13px] font-medium">{call.channel.fps} fps</p>
              </div>
              <div>
                <p className="text-[11px] text-[#8b8375]">Data quality</p>
                <p className="mt-0.5 text-[13px] font-medium">
                  {call.unusable
                    ? "Unusable"
                    : call.channel.fps < 20 || call.channel.calib_err_deg > 1.5
                      ? "Below limits"
                      : "Within limits"}
                </p>
              </div>
              <div className="col-span-2 sm:col-span-4">
                <p className="text-[11px] leading-relaxed text-[#8b8375]">
                  {review.reason} Video and audio are not retained for check-ins; measured evidence and the transcript
                  are available in the assessment.
                </p>
              </div>
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Recent notes"
          subtitle="Kept in this workspace. Notes are written to the patient record when saved."
          action={
            <Link
              to={`/app/patients/${patient.id}/notes`}
              className="inline-flex items-center gap-1 text-[11px] text-[#8a4222] hover:underline"
            >
              All notes <ArrowRight className="h-3 w-3" aria-hidden />
            </Link>
          }
          bodyClassName="p-0"
        >
          {notes.length === 0 ? (
            <div className="px-4 py-5">
              <p className="text-[12px] text-[#6d675e]">No clinician notes saved on this device yet.</p>
              <Link
                to={`/app/patients/${patient.id}/notes`}
                className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-[#8a4222] hover:underline"
              >
                Write the first note <ArrowRight className="h-3 w-3" aria-hidden />
              </Link>
            </div>
          ) : (
            <ul className="divide-y divide-[#f1ece4]">
              {notes.slice(0, 3).map((n) => (
                <li key={n.id} className="px-4 py-2.5">
                  <p className="text-[11px] text-[#8b8375]">{formatNoteTime(n.createdAt)}</p>
                  <p className={cn("mt-0.5 line-clamp-2 text-[12px] leading-relaxed text-[#55504a]")}>{n.text}</p>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
