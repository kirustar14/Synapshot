// Report preview for one patient. It is assembled from the live record, prints cleanly, and
// says plainly that it is a research summary rather than a verified clinical conclusion.

import { FileDown, Printer } from "lucide-react";
import { Link } from "react-router-dom";
import { useForecast } from "@/api/client";
import { SectionCard } from "@/dashboard/components";
import { findingsOf, formatMeasure, humanizeMeasure, reviewOf } from "@/dashboard/derive";
import { formatNoteTime, notesFor } from "@/dashboard/notes";
import { usePatientContext } from "./PatientLayout";

const fmt = (v: number, unit: string) => formatMeasure(v, unit);

export default function PatientReports() {
  const { patient } = usePatientContext();
  const forecast = useForecast(patient.id);
  const findings = forecast.data ? findingsOf(forecast.data, patient) : [];
  const notes = notesFor(patient.id);
  const call = patient.last_call;
  const review = reviewOf({
    id: patient.id,
    name: patient.name,
    week: patient.week,
    drift_z: 0,
    last_call: call?.date ?? null,
    flags: Array.from(new Set(patient.alerts.filter((a) => !a.acked).map((a) => a.type))),
    synthetic: true,
  });

  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[18px] font-semibold tracking-[-0.02em]">Report preview</h1>
          <p className="mt-0.5 text-[11px] text-[#8b8375]">
            Built from the current record. No generated report is stored by this prototype.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex h-8 items-center gap-1.5 rounded-[7px] bg-[#b4552f] px-3 text-[12px] font-medium text-[#fff8f3] hover:bg-[#a04a27]"
          >
            <Printer className="h-3.5 w-3.5" aria-hidden /> Print or save as PDF
          </button>
          {call && (
            <Link
              to={`/app/patients/${patient.id}/assessments/${call.id}`}
              className="inline-flex h-8 items-center gap-1.5 rounded-[7px] border border-[#e6e0d6] bg-[#fffdfa] px-3 text-[12px] text-[#55504a] hover:bg-[#fbf8f2]"
            >
              <FileDown className="h-3.5 w-3.5" aria-hidden /> Latest evidence
            </Link>
          )}
        </div>
      </div>

      <article className="dash-card print-page px-6 py-6">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-[#e6e0d6] pb-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#8b8375]">Synapshot · research summary</p>
            <h2 className="mt-1 text-[22px] font-semibold tracking-[-0.02em]">{patient.name}</h2>
            <p className="mt-1 text-[11px] text-[#6d675e]">
              {patient.age}y · {patient.injury.mechanism} · week {patient.week} of 12 · injured{" "}
              {new Date(`${patient.injury.date}T12:00:00`).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}
            </p>
          </div>
          <div className="text-right text-[10px] leading-relaxed text-[#8b8375]">
            <p>Generated {new Date().toLocaleString()}</p>
            <p>Synthetic record · not a medical device</p>
          </div>
        </header>

        <section className="mt-4">
          <h3 className="text-[12px] font-medium">Monitoring summary</h3>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
            {[
              ["Review state", review.label],
              ["Last check-in", call ? new Date(call.date).toLocaleDateString() : "None"],
              ["Scored measures", String(call?.features.length ?? 0)],
              ["Band coverage", `${Math.round(patient.coverage * 100)}%`],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-[10px] text-[#8b8375]">{k}</dt>
                <dd className="mt-0.5 text-[12px] font-medium">{v}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="mt-5">
          <h3 className="text-[12px] font-medium">Latest assessment</h3>
          {!call ? (
            <p className="mt-1 text-[11px] text-[#6d675e]">No completed assessment.</p>
          ) : (
            <div className="mt-2">
              <p className="text-[11px] text-[#6d675e]">
                Week {call.week}, {new Date(call.date).toLocaleDateString()} · {Math.round(call.duration_s / 60)} min ·{" "}
                {call.steps.length} tasks · {call.channel.fps} fps · calibration error {call.channel.calib_err_deg} deg
              </p>
              <table className="mt-2 w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-[#ece6dc]">
                    <th scope="col" className="py-1.5 pr-3 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#8b8375]">Measure</th>
                    <th scope="col" className="py-1.5 pr-3 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#8b8375]">Result</th>
                    <th scope="col" className="py-1.5 pr-3 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#8b8375]">Previous</th>
                    <th scope="col" className="py-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#8b8375]">Noise threshold</th>
                  </tr>
                </thead>
                <tbody>
                  {call.features.map((f) => (
                    <tr key={f.name} className="border-b border-[#f1ece4] last:border-0">
                      <td className="py-1.5 pr-3 text-[11px]">{humanizeMeasure(f.name)}</td>
                      <td className="py-1.5 pr-3 text-[11px] tabular-nums">{fmt(f.value, f.unit)}</td>
                      <td className="py-1.5 pr-3 text-[11px] tabular-nums text-[#6d675e]">
                        {f.prev === null ? "—" : fmt(f.prev, f.unit)}
                      </td>
                      <td className="py-1.5 text-[11px] tabular-nums text-[#6d675e]">{fmt(f.mdc, f.unit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="mt-5">
          <h3 className="text-[12px] font-medium">Findings under review</h3>
          {findings.length === 0 ? (
            <p className="mt-1 text-[11px] text-[#6d675e]">No measurement currently warrants a finding.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {findings.map((f) => (
                <li key={f.key} className="rounded-[7px] border border-[#ece6dc] bg-[#fbf9f4] px-3 py-2">
                  <p className="text-[11px] font-medium">{f.title}</p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-[#6d675e]">{f.detail}</p>
                  <p className="mt-1 text-[10px] text-[#8b8375]">{f.next}</p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="mt-5">
          <h3 className="text-[12px] font-medium">Care team notes</h3>
          {notes.length === 0 ? (
            <p className="mt-1 text-[11px] text-[#6d675e]">No notes saved in this workspace.</p>
          ) : (
            <ul className="mt-1.5 space-y-1.5">
              {notes.slice(0, 4).map((n) => (
                <li key={n.id} className="text-[11px] leading-relaxed text-[#55504a]">
                  <span className="text-[#8b8375]">{formatNoteTime(n.createdAt)} · </span>
                  {n.text}
                </li>
              ))}
            </ul>
          )}
        </section>

        <footer className="mt-6 border-t border-[#e6e0d6] pt-3 text-[10px] leading-relaxed text-[#8b8375]">
          This summary is assembled automatically from a synthetic research record. Model output is experimental, is
          not a diagnosis, and does not establish a treatment effect. It has not been independently verified.
        </footer>
      </article>

      <SectionCard className="no-print" title="Stored reports" subtitle="Report generation is not connected to a backend in this prototype.">
        <p className="text-[12px] leading-relaxed text-[#6d675e]">
          No report history is available, so none is shown. Use the printable preview above for a shareable summary;
          it reflects the record at the moment it is printed.
        </p>
      </SectionCard>
    </div>
  );
}
