// Patient workspace header: who this is, the monitoring context, the review action and the five
// contextual tabs. The header stays mounted while the tabs change underneath it.

import { CheckCheck, ChevronLeft, FileDown, GitCompare, MoreHorizontal, PhoneCall, Upload } from "lucide-react";
import { useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useAckAlert, useNote, useTriggerCall } from "@/api/client";
import type { Patient } from "@/api/types";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ENROLLED, reviewOf } from "@/dashboard/derive";
import { StatusPill } from "@/dashboard/components";
import { cn } from "@/lib/utils";

const TABS = [
  { path: "", label: "Overview", end: true },
  { path: "assessments", label: "Assessments" },
  { path: "recovery", label: "Recovery model" },
  { path: "notes", label: "Notes" },
  { path: "reports", label: "Reports" },
];

/** What POST /api/demo/trigger-call says happened. The mock layer only returns `ok`. */
type CallStart = {
  ok: boolean;
  mode?: "web" | "facetime";
  url?: string;
  waiting?: boolean;
  channel?: string;
  error?: string | null;
};

export function PatientHeader({ patient }: { patient: Patient }) {
  const [working, setWorking] = useState(false);
  const trigger = useTriggerCall();
  const ack = useAckAlert();
  const note = useNote();
  const navigate = useNavigate();

  const open = patient.alerts.filter((a) => !a.acked);
  // Only unacknowledged flags count as review work; the monitoring flag itself stays on the
  // worklist until the record is read.
  const review = reviewOf({
    id: patient.id,
    name: patient.name,
    week: patient.week,
    drift_z: 0,
    last_call: patient.last_call?.date ?? null,
    flags: Array.from(new Set(open.map((a) => a.type))),
    synthetic: true,
  });

  // The existing persistence path: acknowledge every open alert, then note that a clinician
  // read the record. With nothing open the action is disabled rather than a no-op.
  const markReviewed = async () => {
    if (open.length === 0) return;
    setWorking(true);
    try {
      await Promise.all(open.map((a) => ack.mutateAsync(a.id)));
      await note.mutateAsync({
        id: patient.id,
        text: `Record reviewed after the week ${patient.week} check-in. ${open.length} open alert${open.length === 1 ? "" : "s"} acknowledged.`,
      });
      toast.success("Record marked as reviewed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not mark the record reviewed");
    } finally {
      setWorking(false);
    }
  };

  // Starts this week's check-in. With a real texting transport the patient gets a link and the
  // call waits for them; without one, a generated session runs through the real pipeline and
  // lands under Assessments. FaceTime mode rings the rig.
  const callPatient = () => {
    const first = patient.name.split(" ")[0];
    trigger.mutate(patient.id, {
      onSuccess: (raw) => {
        const got = raw as CallStart;
        if (!got.ok) {
          toast.error(got.error || `Could not start a call with ${first}`);
        } else if (got.mode === "facetime") {
          toast.success(`Calling ${first} on FaceTime`);
        } else if (got.waiting && got.url) {
          toast.success(`Check-in link sent to ${first}`, {
            description: `By ${got.channel ?? "text"}. The call starts when they open it.`,
            action: { label: "Open link", onClick: () => window.open(got.url, "_blank", "noreferrer") },
          });
        } else {
          toast.success(`Check-in started for ${first}`, {
            description: "A practice session is running through the real pipeline. Results appear under Assessments in about a minute.",
            action: { label: "Assessments", onClick: () => navigate(`/app/patients/${patient.id}/assessments`) },
          });
        }
      },
      onError: (err) => toast.error(err.message.replace(/^\d+\s*/, "")),
    });
  };

  return (
    <div className="mb-5">
      <Link
        to="/app/patients"
        className="no-print mb-2 inline-flex items-center gap-1 rounded text-[11px] text-[#8b8375] hover:text-[#8a4222]"
      >
        <ChevronLeft className="h-3.5 w-3.5" aria-hidden /> Back to patients
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-[27px] font-semibold leading-8 tracking-[-0.03em]">{patient.name}</h1>
            <span className="inline-flex h-5 items-center rounded-[5px] border border-[#e6e0d6] px-1.5 text-[10px] font-medium uppercase tracking-[0.06em] text-[#8b8375]">
              Synthetic
            </span>
            {review.priority >= 2 && <StatusPill review={review} />}
          </div>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-[#6d675e]">
            <span>{patient.age}y</span>
            <span aria-hidden>·</span>
            <span>{patient.injury.mechanism}</span>
            <span aria-hidden>·</span>
            <span>Week {patient.week} of 12</span>
            <span aria-hidden>·</span>
            <span>Injured {ENROLLED(patient.injury.date)}</span>
            {patient.low_fidelity && (
              <span className="rounded-[4px] bg-[#f7efdb] px-1.5 py-0.5 text-[10px] text-[#7d5b17]">Low fidelity</span>
            )}
            {patient.template_only && (
              <span className="rounded-[4px] bg-[#f1ece4] px-1.5 py-0.5 text-[10px] text-[#6d675e]">Template only</span>
            )}
          </p>
        </div>

        <div className="no-print flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={callPatient}
            disabled={trigger.isPending}
            className="h-8 gap-1.5 rounded-[7px] border-[#e6e0d6] bg-[#fffdfa] px-3 text-[12px] font-medium text-[#1c1a17] hover:bg-[#f6f1e8]"
          >
            <PhoneCall className="h-3.5 w-3.5" aria-hidden />
            {trigger.isPending ? "Calling" : "Call patient"}
          </Button>
          <Button
            size="sm"
            onClick={() => void markReviewed()}
            disabled={working || open.length === 0}
            className="h-8 gap-1.5 rounded-[7px] bg-[#b4552f] px-3 text-[12px] font-medium text-[#fff8f3] hover:bg-[#a04a27] disabled:bg-[#e7ded2] disabled:text-[#9b9488]"
            title={open.length === 0 ? "No open review item on this record" : undefined}
          >
            <CheckCheck className="h-3.5 w-3.5" aria-hidden />
            {working ? "Saving" : "Mark as reviewed"}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8 rounded-[7px] border-[#e6e0d6] bg-[#fffdfa] hover:bg-[#fbf8f2]"
                aria-label="More patient actions"
              >
                <MoreHorizontal className="h-3.5 w-3.5" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52 rounded-[9px] border-[#e3ddd2] bg-[#fffdfa] p-1">
              <DropdownMenuItem asChild className="rounded-[6px] text-[12px] focus:bg-[#f7f2ea]">
                <Link to={`/app/patients/${patient.id}/compare`}>
                  <GitCompare aria-hidden /> Scenario comparison
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild className="rounded-[6px] text-[12px] focus:bg-[#f7f2ea]">
                <Link to={`/app/patients/${patient.id}/upload`}>
                  <Upload aria-hidden /> Model inputs
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem className="rounded-[6px] text-[12px] focus:bg-[#f7f2ea]" onSelect={() => navigate(`/app/patients/${patient.id}/reports`)}>
                <FileDown aria-hidden /> Report
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <nav
        aria-label="Patient sections"
        className="no-print mt-4 flex max-w-full gap-5 overflow-x-auto overflow-y-hidden border-b border-[#e6e0d6]"
      >
        {TABS.map((t) => (
          <NavLink
            key={t.label}
            to={t.path ? `/app/patients/${patient.id}/${t.path}` : `/app/patients/${patient.id}`}
            end={t.end}
            className={({ isActive }) =>
              cn(
                "-mb-px flex h-9 items-center whitespace-nowrap border-b-2 text-[12px] transition-colors",
                isActive
                  ? "border-[#b4552f] font-medium text-[#1c1a17]"
                  : "border-transparent text-[#6d675e] hover:border-[#d8cfc0] hover:text-[#1c1a17]",
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
