// The worklist answers one question before any chart does: who needs review, and why.
// Every column is measurement or monitoring state; the status pill carries its reason.

import { ArrowDown, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { Digest } from "./data";
import { RELATIVE_DAYS, initialsOf, reviewOf, trendSignal } from "./derive";
import { StatusPill, TrendSpark } from "./components";
import { cn } from "@/lib/utils";

type SortKey = "status" | "name" | "recent" | "week";

const COLUMNS: { key: SortKey | null; label: string; className: string }[] = [
  { key: "name", label: "Patient", className: "min-w-[220px]" },
  { key: "recent", label: "Last check-in", className: "w-[132px]" },
  { key: "week", label: "Monitoring", className: "w-[128px]" },
  { key: null, label: "Trend", className: "w-[118px]" },
  { key: "status", label: "Review status", className: "min-w-[190px]" },
  { key: null, label: "", className: "w-8" },
];

export function Worklist({
  digests,
  emptyLabel = "No patients match these filters.",
}: {
  digests: Digest[];
  emptyLabel?: string;
}) {
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "status", dir: "desc" });

  const rows = useMemo(() => {
    const value = (d: Digest): number | string => {
      const review = reviewOf(d.row);
      switch (sort.key) {
        case "name":
          return d.row.name;
        case "recent":
          return d.row.last_call ? -new Date(d.row.last_call).getTime() : Number.POSITIVE_INFINITY;
        case "week":
          return d.row.week;
        case "status":
        default:
          return review.priority * 100 + Math.abs(d.row.drift_z);
      }
    };
    const sorted = [...digests].sort((a, b) => {
      const av = value(a);
      const bv = value(b);
      const cmp = typeof av === "string" || typeof bv === "string" ? String(av).localeCompare(String(bv)) : av - bv;
      return sort.dir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [digests, sort]);

  const cycle = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "name" ? "asc" : "desc" }));

  return (
    <div className="dash-card overflow-hidden">
      <div className="dash-scroll overflow-x-auto">
        <table className="w-full min-w-[900px] border-collapse text-left">
          <thead>
            <tr className="border-b border-[#ece6dc] bg-[#fbf9f4]">
              {COLUMNS.map((col) => (
                <th
                  key={col.label}
                  scope="col"
                  aria-sort={col.key === sort.key ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}
                  className={cn(
                    "px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#8b8375]",
                    col.className,
                  )}
                >
                  {col.key ? (
                    <button
                      type="button"
                      onClick={() => cycle(col.key as SortKey)}
                      className="inline-flex items-center gap-1 rounded text-[10px] font-semibold uppercase tracking-[0.1em] hover:text-[#1c1a17] focus-visible:text-[#1c1a17]"
                    >
                      {col.label}
                      {col.key === sort.key && (
                        <ArrowDown
                          className={cn("h-3 w-3 transition-transform", sort.dir === "asc" && "rotate-180")}
                          aria-hidden
                        />
                      )}
                    </button>
                  ) : (
                    col.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={COLUMNS.length} className="px-4 py-10 text-center text-[12px] text-[#6d675e]">
                  {emptyLabel}
                </td>
              </tr>
            )}
            {rows.map(({ row, patient, forecast }) => {
              const review = reviewOf(row, patient);
              const trend = trendSignal(forecast);
              const flagged = review.priority >= 2;
              return (
                <tr
                  key={row.id}
                  className={cn(
                    "group border-b border-[#f1ece4] last:border-0 transition-colors",
                    flagged ? "bg-[#fdf8f3] hover:bg-[#fbf1e8]" : "hover:bg-[#fbf8f2]",
                  )}
                >
                  <td className="px-4 py-3">
                    <Link
                      to={`/app/patients/${row.id}`}
                      className="flex min-w-0 items-center gap-2.5 rounded focus-visible:outline-2"
                    >
                      <span
                        className={cn(
                          "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-medium",
                          flagged ? "bg-[#f6e7dc] text-[#8a4a26]" : "bg-[#f1ece4] text-[#6b6155]",
                        )}
                        aria-hidden
                      >
                        {initialsOf(row.name)}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-medium text-[#1c1a17] group-hover:text-[#8a4222]">
                          {row.name}
                        </span>
                        <span className="mt-0.5 block truncate text-[11px] text-[#8b8375]">
                          {patient ? `${patient.age}y · ${patient.injury.mechanism}` : `Week ${row.week} of monitoring`}
                        </span>
                      </span>
                    </Link>
                  </td>
                  <td className="px-4 py-3 align-middle">
                    <span className="block text-[12px] text-[#1c1a17]">
                      {row.last_call
                        ? new Date(row.last_call).toLocaleDateString(undefined, { month: "short", day: "numeric" })
                        : "—"}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-[#8b8375]">{RELATIVE_DAYS(row.last_call)}</span>
                  </td>
                  <td className="px-4 py-3 align-middle">
                    <span className="block text-[12px] text-[#1c1a17]">Week {row.week}</span>
                    <span className="mt-1.5 flex h-1 w-[72px] overflow-hidden rounded-full bg-[#ece6dc]" aria-hidden>
                      <span
                        className="block h-full rounded-full bg-[#c6a58d]"
                        style={{ width: `${Math.max(4, Math.min(100, (row.week / 12) * 100))}%` }}
                      />
                    </span>
                  </td>
                  <td className="px-4 py-3 align-middle">
                    {trend ? (
                      <TrendSpark
                        points={trend.obs.map((o) => ({ week: o.week, value: o.value }))}
                        label={`${trend.label} observed at ${trend.obs.length} check-ins`}
                        tone={flagged ? "attention" : "calm"}
                      />
                    ) : (
                      <span className="text-[11px] text-[#9b9488]">No reads yet</span>
                    )}
                  </td>
                  <td className="px-4 py-3 align-middle">
                    <StatusPill review={review} />
                    <span className="mt-1 block max-w-[250px] text-[11px] leading-snug text-[#8b8375]">
                      {review.reason}
                    </span>
                  </td>
                  <td className="pr-3 align-middle">
                    <ChevronRight
                      className="h-3.5 w-3.5 text-[#b3ab9d] transition-colors group-hover:text-[#8a4222]"
                      aria-hidden
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
