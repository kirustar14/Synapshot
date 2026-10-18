// Every completed check-in across the cohort. This is the review queue for assessments:
// newest first, filterable by the states that actually change the read.

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useCheckinFeed, useWorklist } from "@/dashboard/data";
import { RELATIVE_DAYS, reviewOf } from "@/dashboard/derive";
import { StatusPill } from "@/dashboard/components";
import { ErrorState } from "@/components/common";
import { WorkspaceSkeleton } from "@/components/WorkspaceSkeleton";
import { cn } from "@/lib/utils";

type Filter = "all" | "review" | "quality" | "unusable";

const qualityOf = (c: { unusable: boolean; channel: { fps: number; calib_err_deg: number; face_share: number } }) => {
  if (c.unusable) return { label: "Unusable", tone: "bg-[#f8e6e2] text-[#96311f]" };
  if (c.channel.fps < 20 || c.channel.calib_err_deg > 1.5 || c.channel.face_share < 0.7)
    return { label: "Below limits", tone: "bg-[#f7efdb] text-[#7d5b17]" };
  return { label: "Within limits", tone: "bg-[#eaf0e8] text-[#3f6247]" };
};

export default function Assessments() {
  const worklist = useWorklist();
  const rows = worklist.digests.map((d) => d.row);
  const feed = useCheckinFeed(rows);
  const detailById = new Map(worklist.digests.map((d) => [d.row.id, d.patient]));
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  const entries = useMemo(() => {
    const q = query.trim().toLowerCase();
    return feed.recent.filter(({ patient, checkin }) => {
      if (q && !patient.name.toLowerCase().includes(q)) return false;
      if (filter === "unusable") return checkin.unusable;
      if (filter === "quality") return qualityOf(checkin).label !== "Within limits";
      if (filter === "review") return reviewOf(patient, detailById.get(patient.id)).priority >= 2;
      return true;
    });
  }, [feed.recent, filter, query, worklist.digests]);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-semibold tracking-[-0.025em]">Assessments</h1>
          <p className="mt-1 text-[13px] text-[#6d675e]">
            Completed video check-ins across the cohort, newest first. Open one for tasks, eye tracking, speech and
            capture quality.
          </p>
        </div>
        <p className="text-[11px] text-[#8b8375]">
          {feed.isLoading ? "Loading" : `${entries.length} of ${feed.recent.length} sessions`}
        </p>
      </header>

      <div className="dash-card flex flex-wrap items-center gap-2 p-2">
        <label htmlFor="assessment-search" className="sr-only">
          Search by patient
        </label>
        <input
          id="assessment-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by patient"
          className="h-8 min-w-[200px] flex-1 rounded-[6px] border border-transparent bg-transparent px-2.5 text-[12px] outline-none placeholder:text-[#9b9488] focus:border-[#dcd5c8] focus:bg-[#fffdfa]"
        />
        <label htmlFor="assessment-filter" className="sr-only">
          Filter assessments
        </label>
        <select
          id="assessment-filter"
          value={filter}
          onChange={(e) => setFilter(e.target.value as Filter)}
          className="h-8 rounded-[6px] border border-[#e6e0d6] bg-[#fbf9f4] px-2 text-[12px] text-[#55504a] outline-none focus:border-[#c9c0b1]"
        >
          <option value="all">All sessions</option>
          <option value="review">Patient flagged for review</option>
          <option value="quality">Capture below limits</option>
          <option value="unusable">Marked unusable</option>
        </select>
      </div>

      {worklist.isLoading || feed.isLoading ? (
        <WorkspaceSkeleton label="Loading assessments" />
      ) : worklist.error ? (
        <ErrorState error={worklist.error} onRetry={worklist.refetch} />
      ) : feed.error ? (
        <ErrorState error={feed.error} />
      ) : (
        <section aria-label="Assessments" className="dash-card overflow-hidden">
          <div className="dash-scroll overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse text-left">
              <thead>
                <tr className="border-b border-[#ece6dc] bg-[#fbf9f4]">
                  {["Patient", "Week", "Date", "Duration", "Tasks", "Capture", "Patient review"].map((h) => (
                    <th
                      key={h}
                      scope="col"
                      className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#8b8375]"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {entries.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-[12px] text-[#6d675e]">
                      No assessment matches this filter.
                    </td>
                  </tr>
                )}
                {entries.map(({ patient, checkin }) => {
                  const q = qualityOf(checkin);
                  const review = reviewOf(patient, detailById.get(patient.id));
                  return (
                    <tr key={checkin.id} className="group border-b border-[#f1ece4] last:border-0 hover:bg-[#fbf8f2]">
                      <td className="px-4 py-2.5">
                        <Link
                          to={`/app/patients/${patient.id}/assessments/${checkin.id}`}
                          className="text-[13px] font-medium group-hover:text-[#8a4222]"
                        >
                          {patient.name}
                        </Link>
                        <span className="mt-0.5 block text-[10px] text-[#8b8375]">{checkin.unusable ? "Excluded from the model" : "Included in the model"}</span>
                      </td>
                      <td className="px-4 py-2.5 text-[12px]">W{checkin.week}</td>
                      <td className="px-4 py-2.5 text-[12px]">
                        {new Date(checkin.date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                        <span className="mt-0.5 block text-[10px] text-[#8b8375]">{RELATIVE_DAYS(checkin.date)}</span>
                      </td>
                      <td className="px-4 py-2.5 text-[12px]">{Math.round(checkin.duration_s / 60)} min</td>
                      <td className="px-4 py-2.5 text-[12px]">{checkin.steps.length}</td>
                      <td className="px-4 py-2.5">
                        <span className={cn("rounded-[4px] px-1.5 py-0.5 text-[10px]", q.tone)}>{q.label}</span>
                      </td>
                      <td className="px-4 py-2.5">
                        <StatusPill review={review} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
