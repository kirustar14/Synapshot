// Shared header for the five patient routes: facts, badges, and the tab strip.

import { ChevronLeft } from "lucide-react";
import { Link, NavLink } from "react-router-dom";
import type { Patient } from "@/api/types";
import { FlagChip, SyntheticBadge } from "./common";
import { cn } from "@/lib/utils";

const TABS = [
  { path: "", label: "Overview", end: true },
  { path: "upload", label: "Model inputs" },
  { path: "twin", label: "Brain twin" },
  { path: "compare", label: "Scenarios" },
  { path: "calls", label: "Check-ins" },
];

export function PatientHeader({ patient }: { patient: Patient }) {
  const flags = Array.from(new Set(patient.alerts.map((a) => a.type)));
  return (
    <div className="mb-6">
      <Link
        to="/"
        className="no-print mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-3 w-3" aria-hidden /> Patients
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-extrabold">{patient.name}</h1>
        <SyntheticBadge />
        {patient.template_only && (
          <span className="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground">Template only</span>
        )}
        {patient.low_fidelity && (
          <span className="rounded-full border border-synthetic/40 bg-synthetic-soft px-2 py-0.5 text-[11px] text-synthetic-foreground">
            Low fidelity
          </span>
        )}
        {flags.map((f) => (
          <FlagChip key={f} flag={f} />
        ))}
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        {patient.age} y, {patient.sex} &middot; Week {patient.week} of 12 &middot; Injured {patient.injury.date} &middot;{" "}
        {patient.injury.mechanism}
      </p>
      <nav aria-label="Patient sections" className="no-print mt-5 flex gap-2 overflow-x-auto border-b pb-3">
        {TABS.map((t) => (
          <NavLink
            key={t.label}
            to={t.path ? `/patients/${patient.id}/${t.path}` : `/patients/${patient.id}`}
            end={t.end}
            className={({ isActive }) =>
              cn(
                "whitespace-nowrap rounded-full px-4 py-2 text-sm font-bold transition-colors",
                isActive
                  ? "bg-primary-soft text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )
            }
          >
            {t.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
