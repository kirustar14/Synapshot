// Overview: what needs a clinician today. The four counters are work, not vanity metrics, and
// both lists lead straight into the patient record.
//
// Layout: two independent columns rather than grid rows, so a short review queue never leaves a
// hole beside the check-in feed. Left is triage (queue, then cohort trace); right is activity
// (feed, then how much of the schedule landed).

import { ArrowUpRight, CalendarCheck2, ClipboardList, Clock3, Users } from "lucide-react";
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CHART, axisProps, tooltipLabelStyle, tooltipStyle } from "@/components/charts/chartTheme";
import { useCheckinFeed, useWorklist } from "@/dashboard/data";
import { RELATIVE_DAYS, completionOf, humanizeMeasure, initialsOf, rankDigests, reviewOf, trendSignal } from "@/dashboard/derive";
import { InlineEmpty, SectionCard, StatusPill } from "@/dashboard/components";
import { WorkspaceSkeleton } from "@/components/WorkspaceSkeleton";
import { ErrorState } from "@/components/common";
import { cn } from "@/lib/utils";

const DAY = 864e5;

function Stat({
  label,
  value,
  note,
  icon: Icon,
  accent,
  to,
}: {
  label: string;
  value: number | string;
  note: string;
  icon: typeof Users;
  accent?: boolean;
  to?: string;
}) {
  const body = (
    <>
      <div className="min-w-0">
        <p className="text-[11px] text-[#6d675e]">{label}</p>
        <p className={cn("mt-1 text-[28px] font-semibold leading-none tracking-[-0.03em]", accent ? "text-[#a8492a]" : "text-[#1c1a17]")}>
          {value}
        </p>
        <p className="mt-1.5 text-[11px] leading-snug text-[#8b8375]">{note}</p>
      </div>
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] bg-[#f5f0e7] text-[#a9762b]">
        <Icon className="h-[14px] w-[14px]" strokeWidth={1.7} aria-hidden />
      </span>
    </>
  );

  const shell = "dash-card flex h-full items-start justify-between gap-3 px-4 py-3.5";
  if (!to) return <div className={shell}>{body}</div>;
  return (
    <Link
      to={to}
      className={cn(shell, "transition-colors hover:border-[#dcd2c2] hover:bg-[#fffdfa]")}
      aria-label={`${label}: ${value}. ${note}`}
    >
      {body}
    </Link>
  );
}

export default function Overview() {
  const worklist = useWorklist();
  const rows = worklist.digests.map((d) => d.row);
  const feed = useCheckinFeed(rows);

  const ranked = useMemo(() => rankDigests(worklist.digests), [worklist.digests]);
  const flagged = ranked.filter(({ row, patient }) => reviewOf(row, patient).priority >= 2);
  const needs = flagged.slice(0, 5).map((d) => d.row);
  const overdue = rows.filter((r) => r.flags.includes("missed_call")).length;
  const weekCheckins = feed.recent.filter((c) => Date.now() - new Date(c.checkin.date).getTime() <= 7 * DAY);
  const completion = completionOf(rows, feed.byPatient);
  const completionPct = Math.round(completion.rate * 100);

  // Population observed trajectory, all patients, one measure with one unit. The measure is
  // whichever memory signal this backend serves, so mock and live contracts both work.
  const cohortTrend = useMemo(() => {
    const first = worklist.digests.find((d) => d.forecast)?.forecast;
    const chosen = trendSignal(first);
    if (!chosen) return { label: "", unit: "", points: [] as { week: number; mean: number; n: number }[] };
    const byWeek = new Map<number, number[]>();
    worklist.digests.forEach(({ forecast }) => {
      forecast?.signals.find((s) => s.key === chosen.key)?.obs.forEach((o) =>
        byWeek.set(o.week, [...(byWeek.get(o.week) ?? []), o.value]),
      );
    });
    const points = [...byWeek.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([week, values]) => ({ week, mean: values.reduce((a, b) => a + b, 0) / values.length, n: values.length }));
    return { label: humanizeMeasure(chosen.label), unit: chosen.unit, points };
  }, [worklist.digests]);

  // One row per patient in the recent feed: the newest check-in, not every check-in.
  const latestPerPatient = useMemo(() => {
    const seen = new Set<string>();
    return feed.recent.filter(({ patient }) => {
      if (seen.has(patient.id)) return false;
      seen.add(patient.id);
      return true;
    });
  }, [feed.recent]);

  const date = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const byId = new Map(worklist.digests.map((d) => [d.row.id, d]));

  // The page header stays put while the cohort loads, so the frame never blanks out.
  const pageHeader = (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-[26px] font-semibold tracking-[-0.025em]">Overview</h1>
        <p className="mt-1 text-[13px] text-[#6d675e]">Stay on top of your patients and recent activity.</p>
      </div>
      <p className="text-[11px] text-[#8b8375]">{date}</p>
    </header>
  );

  if (worklist.error)
    return (
      <div className="space-y-5">
        {pageHeader}
        <ErrorState error={worklist.error} onRetry={worklist.refetch} />
      </div>
    );
  if (worklist.isLoading)
    return (
      <div className="space-y-5">
        {pageHeader}
        <WorkspaceSkeleton label="Loading the cohort" />
      </div>
    );

  return (
    <div className="space-y-5">
      {pageHeader}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Monitored patients"
          value={rows.length}
          note="Synthetic records in this workspace"
          icon={Users}
          to="/app/patients"
        />
        <Stat
          label="Check-ins in the last 7 days"
          value={feed.isLoading ? "—" : weekCheckins.length}
          note="Completed video assessments"
          icon={CalendarCheck2}
          to="/app/assessments"
        />
        <Stat
          label="Need review"
          value={flagged.length}
          note={flagged.length ? "Red flag, drift outside the band, or missed call" : "Nothing is waiting on a read"}
          icon={ClipboardList}
          accent={flagged.length > 0}
          to="/app/patients"
        />
        <Stat
          label="Overdue check-ins"
          value={overdue}
          note="Scheduled but not completed"
          icon={Clock3}
          to="/app/patients"
        />
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[1.15fr_1fr]">
        <div className="space-y-4">
          <SectionCard
            title="Needs review"
            subtitle="Ordered by monitoring priority. The reason is the pipeline's own trigger."
            action={
              <Link to="/app/patients" className="inline-flex items-center gap-1 text-[11px] text-[#8a4222] hover:underline">
                View all <ArrowUpRight className="h-3 w-3" aria-hidden />
              </Link>
            }
            bodyClassName="p-0"
          >
            {needs.length === 0 ? (
              <div className="p-4">
                <InlineEmpty>No record is currently flagged. Check-ins are being recorded inside their forecast bands.</InlineEmpty>
              </div>
            ) : (
              <ul className="divide-y divide-[#f1ece4]">
                {needs.map((row) => {
                  const digest = byId.get(row.id);
                  const review = reviewOf(row, digest?.patient);
                  return (
                    <li key={row.id}>
                      <Link
                        to={`/app/patients/${row.id}`}
                        className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-[#fbf8f2]"
                      >
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#f6e7dc] text-[10px] font-medium text-[#8a4a26]">
                          {initialsOf(row.name)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-baseline gap-x-2">
                            <span className="text-[13px] font-medium group-hover:text-[#8a4222]">{row.name}</span>
                            <span className="text-[11px] text-[#8b8375]">
                              {digest?.patient ? `${digest.patient.age}y · ${digest.patient.injury.mechanism}` : `Week ${row.week}`}
                            </span>
                          </span>
                          <span className="mt-0.5 block truncate text-[11px] text-[#8b8375]">{review.reason}</span>
                        </span>
                        <span className="shrink-0 text-right">
                          <StatusPill review={review} />
                          <span className="mt-1 block text-[10px] text-[#9b9488]">{RELATIVE_DAYS(row.last_call)}</span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </SectionCard>

          <SectionCard
            title={`Cohort ${cohortTrend.label.toLowerCase()}`}
            subtitle="Observed mean across every patient at each monitoring week. No forecast is drawn across the cohort."
            bodyClassName="px-3 pb-3 pt-4"
          >
            {cohortTrend.points.length === 0 ? (
              <InlineEmpty>No observed memory data across the cohort yet.</InlineEmpty>
            ) : (
              <figure className="m-0">
                <div className="h-[170px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={cohortTrend.points} margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
                      <CartesianGrid stroke={CHART.grid} vertical={false} />
                      <XAxis dataKey="week" {...axisProps} tickFormatter={(v: number) => `W${v}`} />
                      <YAxis
                        {...axisProps}
                        width={40}
                        domain={["auto", "auto"]}
                        tickFormatter={(v: number) => (Math.abs(v) >= 10 ? v.toFixed(0) : String(+v.toFixed(1)))}
                      />
                      <Tooltip
                        contentStyle={tooltipStyle}
                        labelStyle={tooltipLabelStyle}
                        labelFormatter={(v) => `Week ${v}`}
                        formatter={(value, name) => [
                          typeof value === "number" ? value.toFixed(2) : String(value),
                          name === "mean" ? "Observed mean" : String(name),
                        ]}
                      />
                      <Line type="monotone" dataKey="mean" stroke={CHART.mean} strokeWidth={2} dot={{ r: 3, fill: CHART.mean }} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <figcaption className="mt-1 px-1 text-[11px] text-[#8b8375]">
                  Weeks since baseline · {cohortTrend.unit || "measured units"} ·{" "}
                  {cohortTrend.points.reduce((a, b) => a + b.n, 0)} observations across {worklist.digests.length} patients.
                </figcaption>
              </figure>
            )}
          </SectionCard>
        </div>

        <div className="space-y-4">
          <SectionCard
            title="Recent check-ins"
            subtitle="The newest completed assessments across the cohort."
            action={
              <Link to="/app/assessments" className="inline-flex items-center gap-1 text-[11px] text-[#8a4222] hover:underline">
                View all <ArrowUpRight className="h-3 w-3" aria-hidden />
              </Link>
            }
            bodyClassName="p-0"
          >
            {feed.isLoading ? (
              <div className="space-y-3 p-4" role="status" aria-label="Loading recent check-ins">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="flex items-center gap-3">
                    <span className="h-6 w-6 animate-pulse rounded-full bg-[#f1ece4]" />
                    <span className="h-3 w-40 animate-pulse rounded bg-[#f1ece4]" />
                  </div>
                ))}
              </div>
            ) : feed.error ? (
              <div className="p-4">
                <ErrorState error={feed.error} />
              </div>
            ) : feed.recent.length === 0 ? (
              <div className="p-4">
                <InlineEmpty>No completed check-ins yet.</InlineEmpty>
              </div>
            ) : (
              <ul className="divide-y divide-[#f1ece4]">
                {latestPerPatient.slice(0, 6).map(({ patient, checkin }) => (
                  <li key={checkin.id}>
                    <Link
                      to={`/app/patients/${patient.id}/assessments/${checkin.id}`}
                      className="group flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-[#fbf8f2]"
                    >
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#b4552f]" aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium group-hover:text-[#8a4222]">{patient.name}</span>
                        <span className="block truncate text-[11px] text-[#8b8375]">
                          Completed check-in · {checkin.steps.length} tasks · {Math.round(checkin.duration_s / 60)} min
                        </span>
                      </span>
                      <span className="shrink-0 text-[11px] text-[#8b8375]">{RELATIVE_DAYS(checkin.date)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <SectionCard title="Assessment completion" subtitle="Expected weekly check-ins versus the ones recorded.">
            <div className="flex items-center gap-5">
              <div
                className="relative flex h-[92px] w-[92px] shrink-0 items-center justify-center rounded-full"
                style={{
                  background: `conic-gradient(#b4552f 0 ${completionPct}%, #ece6dc ${completionPct}% 100%)`,
                }}
                role="img"
                aria-label={`${completionPct} percent of expected check-ins completed`}
              >
                <div className="flex h-[70px] w-[70px] flex-col items-center justify-center rounded-full bg-[#fffdfa]">
                  <span className="text-[18px] font-semibold">{completionPct}%</span>
                  <span className="text-[10px] text-[#8b8375]">complete</span>
                </div>
              </div>
              <dl className="flex-1 space-y-1.5 text-[12px]">
                <div className="flex items-center justify-between gap-2">
                  <dt className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-[#b4552f]" aria-hidden /> Completed
                  </dt>
                  <dd className="font-medium">{completion.completed}</dd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-[#d8cfc0]" aria-hidden /> Overdue
                  </dt>
                  <dd className="font-medium">{completion.overdue}</dd>
                </div>
                <div className="flex items-center justify-between gap-2 text-[#8b8375]">
                  <dt>Expected check-ins</dt>
                  <dd>{completion.total}</dd>
                </div>
              </dl>
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-[#8b8375]">
              Completion counts a check-in once it lands on the record, whatever its capture quality. Overdue comes
              from the monitoring pipeline's own missed-call flag, so this total matches the counter above.
            </p>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
