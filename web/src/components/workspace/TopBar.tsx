// Zone one: who this is, and the two things you can do about it.
//
// Facts on the left, actions on the right, nothing in between. The facts are the ones a
// clinician says out loud when they pick up a chart: name, age, what happened, how long
// ago, which week of follow-up.

import { BookOpenCheck, Phone, Printer, Radio } from "lucide-react";
import type { Patient } from "@/api/types";
import type { StreamState } from "@/api/stream";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useApp } from "@/store/app";

/** One fact, label above value, so a row of them reads as a header not a table.
 *
 * `wide` is for the mechanism, which is a sentence rather than a value: a real one runs
 * to eighty characters and without a ceiling it pushes the actions onto a second row.
 * The full text is in the title and in the Data tab.
 */
function Fact({
  label,
  value,
  title,
  wide = false,
}: {
  label: string;
  value: string;
  title?: string;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "min-w-0 max-w-[22ch] xl:max-w-[34ch]" : "min-w-0"} title={title ?? value}>
      <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="truncate text-sm font-bold">{value}</p>
    </div>
  );
}

/** How long ago the injury was, in the unit that reads best at that distance. */
export function sinceInjury(patient: Patient): string {
  const days = patient.injury.days_ago;
  if (days === null || days === undefined) {
    return patient.injury.date ? `since ${patient.injury.date}` : "unknown";
  }
  if (days < 21) return `${days} day${days === 1 ? "" : "s"} ago`;
  const weeks = Math.round(days / 7);
  if (weeks < 12) return `${weeks} weeks ago`;
  return `${Math.round(days / 30.4)} months ago`;
}

export function TopBar({
  patient,
  onCall,
  onEvidence,
  stream,
}: {
  patient: Patient;
  onCall: () => void;
  onEvidence: () => void;
  stream: StreamState;
}) {
  const demo = useApp((s) => s.demoMode);
  const injury = patient.injury;
  const mechanism = injury.mechanism || "mechanism not recorded";

  return (
    <header className="no-print flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-border/70 px-4 py-3 lg:px-6">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h1 className="truncate text-xl font-black">{patient.name}</h1>
          {stream.connected && stream.rate > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-destructive-soft px-2 py-0.5 text-[10px] font-bold text-destructive">
              <Radio className="h-3 w-3 animate-pulse" aria-hidden /> Live, {stream.rate}/s
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {patient.age}, {patient.sex === "F" ? "female" : "male"}
          {patient.chart?.occupation ? `, ${patient.chart.occupation}` : ""}
        </p>
      </div>

      <div className="flex min-w-0 flex-wrap items-center gap-x-6 gap-y-2">
        <Fact label="Injury" value={mechanism} title={mechanism} wide />
        <Fact label="When" value={sinceInjury(patient)} title={injury.date ?? ""} />
        <Fact label="Week" value={`${patient.week} of 12`} />
        {injury.contusion && <Fact label="Contusion" value={injury.contusion} />}
        {injury.gcs !== null && injury.gcs !== undefined && (
          <Fact label="GCS" value={String(injury.gcs)} />
        )}
      </div>

      <div className="ml-auto flex items-center gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button onClick={onCall}>
              <Phone aria-hidden />
              Call patient
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {demo
              ? "Demo mode is on: the check-in runs here on this laptop."
              : "Texts a link. The patient does the check-in on their own phone."}
          </TooltipContent>
        </Tooltip>

        <Button variant="outline" onClick={() => window.print()}>
          <Printer aria-hidden />
          <span className="hidden sm:inline">Print summary</span>
        </Button>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="outline" onClick={onEvidence}>
              <BookOpenCheck aria-hidden />
              <span className="hidden sm:inline">Evidence</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            What every number on this screen rests on, and which claims nobody has checked.
          </TooltipContent>
        </Tooltip>
      </div>
    </header>
  );
}
