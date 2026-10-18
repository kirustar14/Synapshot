// Timeline: what happened, on a calendar.
//
// A month grid with a coloured dot per day, a day summary when you click one, and one
// chart underneath with toggleable series. Clicking "Show brain at this date" moves the
// week scrubber, which is why the scrubber and this tab are the same piece of state: two
// controls over one week would drift apart within a minute of use.

import { CalendarClock, ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { useCheckins, useTimeline, type TimelineEvent } from "@/api/client";
import type { Patient } from "@/api/types";
import { LineTrace } from "@/components/charts/LineTrace";
import { Loading, fmtDate } from "@/components/common";
import { Fold } from "@/components/fold";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/pages/Workspace";

const BAND_COLOUR: Record<string, string> = {
  call: "bg-primary",
  flag: "bg-destructive",
  warn: "bg-synthetic",
  note: "bg-muted-foreground/50",
  message: "bg-chart-2",
};

const DAY_NAMES = ["M", "T", "W", "T", "F", "S", "S"];

/** Days of a month, padded so the first falls on the right weekday. Monday first. */
function monthGrid(year: number, month: number): (string | null)[] {
  const first = new Date(Date.UTC(year, month, 1));
  const lead = (first.getUTCDay() + 6) % 7;
  const count = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const out: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= count; d++) {
    out.push(`${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  }
  return out;
}

export function TimelineTab({ patient }: { patient: Patient }) {
  const timeline = useTimeline(patient.id);
  const checkins = useCheckins(patient.id);
  const { setWeek, setTab } = useWorkspace();

  const events = timeline.data?.events ?? [];
  const days = timeline.data?.days ?? [];

  // Open on the month of the most recent event, which is the one worth looking at.
  const latest = events.length ? events[events.length - 1].day : new Date().toISOString().slice(0, 10);
  const [cursor, setCursor] = useState(() => {
    const [y, m] = latest.split("-").map(Number);
    return { year: y, month: m - 1 };
  });
  const [picked, setPicked] = useState<string | null>(null);
  const [series, setSeries] = useState<string[]>([]);

  const byDay = useMemo(() => {
    const out = new Map<string, { bands: string[]; count: number; labels: string[] }>();
    for (const d of days) out.set(d.day, d);
    return out;
  }, [days]);

  const grid = monthGrid(cursor.year, cursor.month);
  const monthLabel = new Date(Date.UTC(cursor.year, cursor.month, 1)).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  const onDay: TimelineEvent[] = picked ? events.filter((e) => e.day === picked) : [];
  const weekOfPicked = onDay.find((e) => e.week !== undefined)?.week;

  // One chart, every measured feature, toggled on by name. Default to the first two: all
  // of them at once is a thicket, and the point is to compare a couple of lines.
  //
  // LineTrace wants one row per x with a column per series, which is also the shape that
  // lets a week with a missing feature simply have no point rather than a zero.
  const traces = useMemo(() => {
    const rows = checkins.data ?? [];
    const names = [...new Set(rows.flatMap((c) => c.features.map((f) => f.name)))];
    const shown = series.length ? series : names.slice(0, 2);
    const data = rows.map((c) => {
      const row: Record<string, number> = { week: c.week };
      for (const name of shown) {
        const hit = c.features.find((f) => f.name === name);
        if (hit) row[name] = hit.value;
      }
      return row;
    });
    const palette = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];
    return {
      names,
      shown,
      data,
      series: shown.map((name, i) => ({
        key: name,
        label: name.replace(/_/g, " "),
        color: palette[i % palette.length],
      })),
      enough: data.filter((r) => shown.some((n) => r[n] !== undefined)).length > 1,
    };
  }, [checkins.data, series]);

  if (timeline.isLoading) return <Loading label="Loading the timeline" />;

  return (
    <div className="text-sm">
      {timeline.data?.next_call && (
        <div className="mb-3 flex items-center gap-2 rounded-lg bg-muted/60 px-2.5 py-2">
          <CalendarClock
            className={cn("h-4 w-4 shrink-0", timeline.data.next_call.overdue && "text-destructive")}
            aria-hidden
          />
          <span className="flex-1 text-xs">{timeline.data.next_call.say}</span>
          <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => setTab("data")}>
            Schedule
          </Button>
        </div>
      )}

      <div className="mb-1.5 flex items-center justify-between">
        <button
          type="button"
          aria-label="Previous month"
          onClick={() =>
            setCursor((c) => (c.month === 0 ? { year: c.year - 1, month: 11 } : { ...c, month: c.month - 1 }))
          }
          className="rounded p-1 hover:bg-muted"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </button>
        <span className="text-xs font-bold">{monthLabel}</span>
        <button
          type="button"
          aria-label="Next month"
          onClick={() =>
            setCursor((c) => (c.month === 11 ? { year: c.year + 1, month: 0 } : { ...c, month: c.month + 1 }))
          }
          className="rounded p-1 hover:bg-muted"
        >
          <ChevronRight className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center">
        {DAY_NAMES.map((d, i) => (
          <span key={i} className="text-[9px] font-bold uppercase text-muted-foreground">
            {d}
          </span>
        ))}
        {grid.map((day, i) => {
          if (!day) return <span key={`pad-${i}`} />;
          const got = byDay.get(day);
          return (
            <button
              key={day}
              type="button"
              onClick={() => setPicked(picked === day ? null : day)}
              aria-label={got ? `${day}, ${got.count} events` : day}
              aria-pressed={picked === day}
              className={cn(
                "flex aspect-square flex-col items-center justify-center rounded-lg border text-[10px]",
                picked === day ? "border-primary bg-primary-soft" : "border-transparent",
                got ? "font-bold hover:bg-muted" : "text-muted-foreground/50",
              )}
            >
              <span>{Number(day.slice(8))}</span>
              {got && (
                <span className="mt-0.5 flex gap-0.5">
                  {got.bands.slice(0, 3).map((b) => (
                    <span key={b} className={cn("h-1 w-1 rounded-full", BAND_COLOUR[b] ?? "bg-muted-foreground")} />
                  ))}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {picked && (
        <div className="mt-3 rounded-lg border border-border/60 px-2.5 py-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-bold">{fmtDate(picked)}</p>
            {weekOfPicked !== undefined && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-[11px]"
                onClick={() => setWeek(weekOfPicked)}
              >
                Show brain at this date
              </Button>
            )}
          </div>
          {onDay.length === 0 ? (
            <p className="mt-1 text-[11px] text-muted-foreground">Nothing on this day.</p>
          ) : (
            <ul className="mt-1.5 space-y-1.5">
              {onDay.map((e) => (
                <li key={e.id} className="flex items-start gap-2">
                  <span
                    className={cn("mt-1 h-1.5 w-1.5 shrink-0 rounded-full", BAND_COLOUR[e.band] ?? "bg-muted-foreground")}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[11px] font-bold">{e.label}</span>
                    <span className="block truncate text-[10px] text-muted-foreground">
                      {e.time.slice(11, 16)}
                      {e.kind === "message" && typeof e.detail.body === "string"
                        ? ` · ${e.detail.body.slice(0, 80)}`
                        : ""}
                      {e.kind === "checkin" && typeof e.detail.duration_s === "number"
                        ? ` · ${Math.round(e.detail.duration_s / 60)} min`
                        : ""}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <Fold
        id="timeline.traces"
        title="Measured over time"
        summary={traces.enough ? `${traces.shown.length} of ${traces.names.length} series` : "not enough check-ins yet"}
        className="mt-4 border-t border-border/60"
      >
        <div className="mb-2 flex flex-wrap gap-1">
          {traces.names.map((name) => (
            <button
              key={name}
              type="button"
              aria-pressed={traces.shown.includes(name)}
              onClick={() =>
                setSeries((have) => {
                  const base = have.length ? have : traces.shown;
                  return base.includes(name) ? base.filter((n) => n !== name) : [...base, name];
                })
              }
              className={cn(
                "rounded-full border px-2 py-0.5 text-[10px] font-bold",
                traces.shown.includes(name) ? "border-primary bg-primary-soft" : "border-border",
              )}
            >
              {name.replace(/_/g, " ")}
            </button>
          ))}
        </div>
        {traces.enough ? (
          <LineTrace
            data={traces.data}
            x="week"
            series={traces.series}
            height={160}
            xLabel="week"
          />
        ) : (
          <p className="text-xs text-muted-foreground">
            Not enough check-ins yet to draw a line. Two weeks makes a trend.
          </p>
        )}
      </Fold>
    </div>
  );
}
