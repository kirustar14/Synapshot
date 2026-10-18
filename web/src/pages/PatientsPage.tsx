// Patients worklist. The table is the cohort, the filters narrow it, and the status column
// explains itself. Search matches the display name; identifiers stay internal.

import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useWorklist } from "@/dashboard/data";
import { reviewOf } from "@/dashboard/derive";
import { Worklist } from "@/dashboard/Worklist";
import { AddPatient } from "@/dashboard/AddPatient";
import { ErrorState } from "@/components/common";
import { WorkspaceSkeleton } from "@/components/WorkspaceSkeleton";

type Filter = "all" | "review" | "overdue" | "quality" | "new" | "stable";

const FILTERS: { value: Filter; label: string; test: (r: ReturnType<typeof reviewOf>) => boolean }[] = [
  { value: "all", label: "All statuses", test: () => true },
  { value: "review", label: "Needs review", test: (r) => r.priority >= 3 },
  { value: "overdue", label: "Overdue", test: (r) => r.label === "Overdue" },
  { value: "quality", label: "Capture quality", test: (r) => r.label === "Capture quality" },
  { value: "new", label: "New check-in", test: (r) => r.label === "New check-in" },
  { value: "stable", label: "Stable", test: (r) => r.tone === "calm" },
];

export default function PatientsPage() {
  const { digests, isLoading, error, refetch } = useWorklist();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [activity, setActivity] = useState<"all" | "checked" | "none">("all");

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return digests.filter(({ row, patient }) => {
      if (q) {
        const haystack = `${row.name} ${patient?.injury.mechanism ?? ""}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      if (!FILTERS.find((f) => f.value === filter)!.test(reviewOf(row, patient))) return false;
      if (activity === "checked" && !row.last_call) return false;
      if (activity === "none" && row.last_call) return false;
      return true;
    });
  }, [digests, query, filter, activity]);

  const needingReview = digests.filter(({ row, patient }) => reviewOf(row, patient).priority >= 2).length;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-semibold tracking-[-0.025em] text-[#1c1a17]">Patients</h1>
          <p className="mt-1 text-[13px] text-[#6d675e]">
            Monitor and review the patient cohort. {needingReview > 0
              ? `${needingReview} ${needingReview === 1 ? "record needs" : "records need"} a clinician's review.`
              : "No record is currently flagged for review."}
          </p>
        </div>
        <AddPatient />
      </header>

      <div className="dash-card flex flex-wrap items-center gap-2 p-2">
        <div className="relative min-w-[220px] flex-1">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-[14px] w-[14px] -translate-y-1/2 text-[#9b9488]"
            aria-hidden
          />
          <label htmlFor="worklist-search" className="sr-only">
            Search patients
          </label>
          <input
            id="worklist-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search patients"
            className="h-8 w-full rounded-[6px] border border-transparent bg-transparent pl-8 pr-3 text-[12px] outline-none placeholder:text-[#9b9488] focus:border-[#dcd5c8] focus:bg-[#fffdfa]"
          />
        </div>
        <label className="sr-only" htmlFor="worklist-status">
          Filter by review status
        </label>
        <select
          id="worklist-status"
          value={filter}
          onChange={(e) => setFilter(e.target.value as Filter)}
          className="h-8 rounded-[6px] border border-[#e6e0d6] bg-[#fbf9f4] px-2 text-[12px] text-[#55504a] outline-none focus:border-[#c9c0b1]"
        >
          {FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="worklist-activity">
          Filter by check-in activity
        </label>
        <select
          id="worklist-activity"
          value={activity}
          onChange={(e) => setActivity(e.target.value as typeof activity)}
          className="h-8 rounded-[6px] border border-[#e6e0d6] bg-[#fbf9f4] px-2 text-[12px] text-[#55504a] outline-none focus:border-[#c9c0b1]"
        >
          <option value="all">Any activity</option>
          <option value="checked">Has check-ins</option>
          <option value="none">No check-ins</option>
        </select>
        <span className="pr-2 text-[11px] text-[#8b8375]">
          {rows.length} of {digests.length}
        </span>
      </div>

      {isLoading && <WorkspaceSkeleton label="Loading patients" />}
      {error && <ErrorState error={error} onRetry={refetch} />}

      {!isLoading && !error && (
        <section aria-label="Patients">
          <Worklist digests={rows} emptyLabel="No patient matches these filters." />
        </section>
      )}

      <p className="px-1 text-[11px] leading-relaxed text-[#8b8375]">
        Review priority is derived from the monitoring pipeline: a red flag, a drift outside the forecast band, a
        missed check-in, then capture quality. Trend traces show measured values only.
      </p>
    </div>
  );
}
