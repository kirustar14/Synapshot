import { Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import type { Patient } from "@/api/types";
import { FlagChip, SyntheticBadge } from "./common";

const TABS = [
  { to: "/patients/$id", label: "Overview", exact: true },
  { to: "/patients/$id/upload", label: "Model inputs" },
  { to: "/patients/$id/twin", label: "Brain twin" },
  { to: "/patients/$id/compare", label: "Scenarios" },
  { to: "/patients/$id/calls", label: "Check-ins" },
] as const;

export function PatientHeader({ patient }: { patient: Patient }) {
  const flags = Array.from(new Set(patient.alerts.map((a) => a.type)));
  return (
    <div className="mb-6">
      <Link to="/" className="no-print mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ChevronLeft className="h-3 w-3" /> Patients</Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-extrabold">{patient.name}</h1>
        <SyntheticBadge />
        {patient.template_only && <span className="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground">Template only</span>}
        {flags.map((f) => <FlagChip key={f} flag={f} />)}
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        {patient.age} y, {patient.sex} &middot; Week {patient.week} of 12 &middot; Injured {patient.injury.date} &middot; {patient.injury.mechanism}
      </p>
      <nav aria-label="Patient sections" className="no-print mt-5 flex gap-2 overflow-x-auto border-b pb-3">
        {TABS.map((t) => (
          <Link key={t.to} to={t.to} params={{ id: patient.id }} activeOptions={{ exact: "exact" in t && t.exact }}
            className="whitespace-nowrap rounded-full px-4 py-2 text-sm font-bold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground data-[status=active]:bg-primary-soft data-[status=active]:text-primary">
            {t.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
