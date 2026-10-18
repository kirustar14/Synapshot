// Shared header for the five patient routes: who this is, any open flags, and the section tabs
// as one segmented control.

import { ChevronLeft } from "lucide-react";
import { Link, NavLink } from "react-router-dom";
import type { Patient } from "@/api/types";
import { FlagChip, SyntheticBadge } from "./common";
import { cn } from "@/lib/utils";

const TABS = [
  { path: "", label: "Overview", end: true },
  { path: "twin", label: "Brain twin" },
  { path: "calls", label: "Check-ins" },
  { path: "compare", label: "Scenarios" },
  { path: "upload", label: "Model inputs" },
];

const injuredOn = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { month: "long", day: "numeric" });

export function PatientHeader({ patient }: { patient: Patient }) {
  const flags = Array.from(new Set(patient.alerts.map((a) => a.type)));
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
      <div className="min-w-0">
        <Link
          to="/"
          className="no-print mb-2 inline-flex items-center gap-1 text-sm font-bold text-primary hover:underline"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden /> Patients
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-[34px] font-extrabold leading-10">{patient.name}</h1>
          <SyntheticBadge />
          {patient.template_only && (
            <span className="flex h-6 items-center rounded-full bg-muted px-2.5 text-xs font-bold text-muted-foreground">
              Template only
            </span>
          )}
          {patient.low_fidelity && (
            <span className="flex h-6 items-center rounded-full bg-synthetic-soft px-2.5 text-xs font-bold text-synthetic-foreground">
              Low fidelity
            </span>
          )}
          {flags.map((f) => (
            <FlagChip key={f} flag={f} />
          ))}
        </div>
        <p className="mt-1.5 text-[15px] font-semibold text-muted-foreground">
          {patient.age} years old, {patient.sex === "F" ? "female" : "male"}, injured {injuredOn(patient.injury.date)},{" "}
          {patient.injury.mechanism}
        </p>
      </div>
      <nav
        aria-label="Patient sections"
        className="no-print flex max-w-full gap-0.5 overflow-x-auto rounded-full bg-secondary p-1"
      >
        {TABS.map((t) => (
          <NavLink
            key={t.label}
            to={t.path ? `/patients/${patient.id}/${t.path}` : `/patients/${patient.id}`}
            end={t.end}
            className={({ isActive }) =>
              cn(
                "flex h-9 items-center whitespace-nowrap rounded-full px-4 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-ring",
                isActive
                  ? "bg-card font-extrabold text-foreground shadow-soft"
                  : "font-bold text-muted-foreground hover:text-foreground",
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
