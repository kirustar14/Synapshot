// Reports index. A report is a printable preview assembled from one record; the prototype has
// no report store, so the page says so rather than inventing a history.

import { FileText } from "lucide-react";
import { Link } from "react-router-dom";
import { useWorklist } from "@/dashboard/data";
import { RELATIVE_DAYS, reviewOf } from "@/dashboard/derive";
import { StatusPill } from "@/dashboard/components";
import { ErrorState } from "@/components/common";
import { WorkspaceSkeleton } from "@/components/WorkspaceSkeleton";

export default function Reports() {
  const { digests, isLoading, error, refetch } = useWorklist();

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-[26px] font-semibold tracking-[-0.025em]">Reports</h1>
        <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-[#6d675e]">
          A report preview is assembled from the live record: monitoring summary, latest assessment, findings and care
          team notes. It prints cleanly and can be saved as a PDF.
        </p>
      </header>

      {isLoading && <WorkspaceSkeleton label="Loading report options" />}
      {error && <ErrorState error={error} onRetry={refetch} />}

      {!isLoading && !error && (
        <section aria-label="Patient reports" className="dash-card overflow-hidden">
          <div className="dash-scroll overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-left">
              <thead>
                <tr className="border-b border-[#ece6dc] bg-[#fbf9f4]">
                  {["Patient", "Latest check-in", "Monitoring", "Review state", "Report"].map((h) => (
                    <th key={h} scope="col" className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#8b8375]">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {digests.map(({ row, patient }) => (
                  <tr key={row.id} className="group border-b border-[#f1ece4] last:border-0 hover:bg-[#fbf8f2]">
                    <td className="px-4 py-3">
                      <Link to={`/app/patients/${row.id}/reports`} className="text-[13px] font-medium group-hover:text-[#8a4222]">
                        {row.name}
                      </Link>
                      <span className="mt-0.5 block text-[10px] text-[#8b8375]">
                        {patient ? `${patient.age}y · ${patient.injury.mechanism}` : "Synthetic record"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[12px]">
                      {row.last_call
                        ? new Date(row.last_call).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
                        : "None"}
                      <span className="mt-0.5 block text-[10px] text-[#8b8375]">{RELATIVE_DAYS(row.last_call)}</span>
                    </td>
                    <td className="px-4 py-3 text-[12px]">Week {row.week} of 12</td>
                    <td className="px-4 py-3">
                      <StatusPill review={reviewOf(row, patient)} />
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        to={`/app/patients/${row.id}/reports`}
                        className="inline-flex items-center gap-1.5 text-[11px] text-[#8a4222] hover:underline"
                      >
                        <FileText className="h-3 w-3" aria-hidden /> Open preview
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <p className="px-1 text-[11px] leading-relaxed text-[#8b8375]">
        No report history is stored. A generated summary is not an independently verified clinical conclusion, and the
        forecast it may quote is experimental.
      </p>
    </div>
  );
}
