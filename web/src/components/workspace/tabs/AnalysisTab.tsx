// Analysis: what the model makes of the data, with its bands.
//
// Four things, in the order a clinician asks them:
//
//   recovery forecast        where is this going, and how sure is the model
//   drift and alerts         is reality tracking it, and what fired if not
//   population context       where does this patient sit among people the model has seen
//   what drives it           which tracts and signals the forecast is resting on
//
// Every number here comes with its interval. A point estimate with no band is the thing
// this tab exists to not do.

import { AlertTriangle, BookOpenCheck, TrendingUp } from "lucide-react";
import { useMemo } from "react";
import { useAttribution, useForecast, useMesh, usePercentile, useTwin } from "@/api/client";
import type { Mesh, Patient, Signal, Twin } from "@/api/types";
import { regionLabel } from "@/components/brain";
import { ChartKey, SignalChart } from "@/components/charts/SignalChart";
import { Loading } from "@/components/common";
import { Fold } from "@/components/fold";
import { DriftBar } from "@/components/panels/DriftBar";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/pages/Workspace";

/**
 * A tract written the way somebody says it, rather than as two Schaefer codes.
 *
 * The mesh has to be passed in. Without it `regionLabel` has no lobe and no centroid and
 * every region comes back "left cortex", which is how this read before: "led by left
 * cortex to left cortex". The mesh query is parameterless and cached forever, and the
 * viewer on this same screen has already fetched it, so asking for it here costs nothing.
 */
function tractName(
  t: { a?: number | null; b?: number | null; name: string },
  mesh: Mesh | undefined,
  twin: Twin | undefined,
) {
  const ends = [t.a, t.b]
    .filter((i): i is number => typeof i === "number")
    .map((i) => regionLabel(mesh, twin, i).plain);
  if (ends.length !== 2) return ends[0] ?? t.name;
  // Two different Schaefer parcels can share one plain name, and "left back parietal to
  // left back parietal" reads as a bug even though it is not one.
  return ends[0] === ends[1] ? `within ${ends[0]}` : `${ends[0]} to ${ends[1]}`;
}

/** The Evidence link that used to sit in each section header, now inside the section. */
function Why({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-2 inline-flex items-center gap-1 text-[10px] font-bold text-muted-foreground hover:text-foreground"
    >
      <BookOpenCheck className="h-3 w-3" aria-hidden /> Evidence for this
    </button>
  );
}

/** The cohort ribbon with this patient's marker on it. */
function PercentileRibbon({ pct }: { pct: ReturnType<typeof usePercentile> }) {
  const data = pct.data;

  const bars = useMemo(() => {
    const hist = data?.histogram ?? [];
    const peak = Math.max(1, ...hist.map((h) => h.count));
    return hist.map((h) => ({ ...h, height: h.count / peak }));
  }, [data]);

  if (pct.isLoading) return <Loading label="Placing this patient" />;
  if (!data?.ok) {
    return <p className="text-xs text-muted-foreground">{data?.say ?? "No population fit yet."}</p>;
  }

  const lo = data.range?.[0] ?? 0;
  const hi = data.range?.[1] ?? 1;
  const at = hi > lo ? ((data.k ?? 0) - lo) / (hi - lo) : 0.5;
  const outside = data.outside;

  return (
    <div>
      <div className="relative h-14">
        <div className="flex h-10 items-end gap-px">
          {bars.map((b) => (
            <div
              key={b.from}
              className="flex-1 rounded-t-sm bg-primary/25"
              style={{ height: `${Math.max(3, b.height * 100)}%` }}
              title={`${b.count} patients between ${b.from} and ${b.to}`}
            />
          ))}
        </div>
        {/* The marker is clamped into the strip when the patient is off the end of it,
            and the label says "off the scale" rather than pinning them to 0th. */}
        <div
          className="absolute top-0 h-12 w-0.5 bg-destructive"
          style={{ left: `${Math.min(99, Math.max(0, at * 100))}%` }}
          aria-hidden
        />
        <span
          className="absolute top-12 -translate-x-1/2 whitespace-nowrap text-[10px] font-bold text-destructive"
          style={{ left: `${Math.min(92, Math.max(8, at * 100))}%` }}
        >
          {outside ? `${outside} the cohort` : `${Math.round(data.percentile ?? 0)}th`}
        </span>
      </div>
      <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{data.say}</p>
      <ul className="mt-1.5 space-y-0.5">
        {(data.limits ?? []).map((l) => (
          <li key={l} className="text-[10px] leading-snug text-muted-foreground">
            {l}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AnalysisTab({ patient }: { patient: Patient }) {
  const forecast = useForecast(patient.id);
  const attribution = useAttribution(patient.id);
  const pct = usePercentile(patient.id);
  const mesh = useMesh();
  const twin = useTwin(patient.id);
  const { openEvidence, setRegion, week } = useWorkspace();

  const signals: Signal[] = forecast.data?.signals ?? [];
  const drift = patient.drift_z;
  const drifting = drift > 2.0;
  const openFlags = patient.alerts.filter((a) => !a.acked).length;
  const lead = attribution.data?.[0]?.tracts?.[0];

  // Each closed section says the thing it is about, so the tab reads as four answers
  // before anybody opens a chart.
  const forecastSummary = signals.length
    ? `${signals.length} signals, 80% bands`
    : "no forecast until the first check-in";
  const driftSummary = `drift z ${drift.toFixed(2)}, ${drifting ? "above the threshold" : "inside the band"}`
    + `, ${openFlags} flag${openFlags === 1 ? "" : "s"}`;
  const cohortSummary = pct.data?.ok
    ? (pct.data.outside ? `${pct.data.outside} the cohort` : `${Math.round(pct.data.percentile ?? 0)}th percentile`)
    : "no population fit yet";
  // No "led by" prefix: the section is already called What drives it, and the prefix
  // read as "led by within left back parietal" for a tract with both ends in one parcel.
  const driverSummary = lead ? tractName(lead, mesh.data, twin.data) : "nothing scored yet";

  return (
    <div className="text-sm">
      <Fold id="analysis.forecast" title="Recovery forecast" summary={forecastSummary}>
        {forecast.isLoading && <Loading label="Loading the forecast" />}
        {forecast.data && signals.length > 0 && (
          <>
            <ChartKey />
            <div className="mt-2 space-y-3">
              {signals.slice(0, 3).map((s) => (
                <SignalChart
                  key={s.key}
                  signal={s}
                  weeks={forecast.data?.weeks ?? []}
                  week={week}
                  height={120}
                />
              ))}
            </div>
            <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
              The shaded band is the 80% interval. Across the cohort it contains the truth about
              84% of the time, which is measured on synthetic patients generated by the same model
              family that fits them.
            </p>
          </>
        )}
        {forecast.data && signals.length === 0 && (
          <p className="text-xs text-muted-foreground">
            No forecast yet. The first check-in sets the baseline.
          </p>
        )}
        <Why onClick={() => openEvidence("Filtering and forecasting")} />
      </Fold>

      <Fold id="analysis.drift" title="Drift and flags" summary={driftSummary}>
        <div className="flex items-center gap-3">
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="cursor-help">
                <DriftBar z={drift} width="w-32" />
              </div>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              Drift z is the mean standardized residual of the last two weeks, signed so positive
              means reality is worse than the twin expected. The rule fires above 2.0 for two weeks
              in a row: one bad week is noise.
            </TooltipContent>
          </Tooltip>
          {drifting && (
            <span className="inline-flex items-center gap-1 text-[11px] text-destructive">
              <AlertTriangle className="h-3 w-3" aria-hidden /> above the threshold
            </span>
          )}
        </div>

        <div className="mt-2 grid grid-cols-2 gap-2">
          <div className="rounded-lg bg-muted/50 px-2.5 py-2">
            <p className="text-[10px] font-bold uppercase text-muted-foreground">Band coverage</p>
            <p className="text-sm font-black">{Math.round(patient.coverage * 100)}%</p>
            <p className="text-[10px] text-muted-foreground">target 80%</p>
          </div>
          <div className="rounded-lg bg-muted/50 px-2.5 py-2">
            <p className="text-[10px] font-bold uppercase text-muted-foreground">Open flags</p>
            <p className="text-sm font-black">{openFlags}</p>
            <p className="text-[10px] text-muted-foreground">click one in the rail for its rule</p>
          </div>
        </div>
      </Fold>

      <Fold id="analysis.cohort" title="Population context" summary={cohortSummary}>
        <PercentileRibbon pct={pct} />
        <Why onClick={() => openEvidence("Filtering and forecasting")} />
      </Fold>

      <Fold id="analysis.drivers" title="What drives it" summary={driverSummary}>
        {attribution.isLoading && <Loading label="Scoring the tracts" />}
        {attribution.data && attribution.data.length === 0 && (
          <p className="text-xs text-muted-foreground">Nothing scored yet.</p>
        )}
        <div className="space-y-2.5">
          {(attribution.data ?? []).slice(0, 4).map((row) => (
            <div key={row.signal}>
              <p className="text-[11px] font-bold">{row.signal.replace(/_/g, " ")}</p>
              <ul className="mt-0.5 space-y-0.5">
                {row.tracts.slice(0, 3).map((t) => (
                  <li key={`${t.a ?? "x"}-${t.b ?? "y"}-${t.name}`}>
                    <button
                      type="button"
                      onClick={() => setRegion(t.a ?? null)}
                      className="flex w-full items-baseline justify-between gap-2 rounded px-1 py-0.5 text-left hover:bg-muted"
                    >
                      <span className="truncate text-[11px] capitalize text-muted-foreground">
                        {tractName(t, mesh.data, twin.data)}
                      </span>
                      <span className="shrink-0 font-mono text-[10px]">
                        {t.score > 0 ? "+" : ""}
                        {t.score.toFixed(3)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="mt-2 flex items-start gap-1 text-[10px] leading-snug text-muted-foreground">
          <TrendingUp className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
          Each score is how much that signal would move if this tract were healed, in the signal's
          own units. It is the model's own arithmetic, not a measured contribution.
        </p>
      </Fold>
    </div>
  );
}
