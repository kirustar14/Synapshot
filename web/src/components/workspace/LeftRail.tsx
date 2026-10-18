// Zone two: the facts, the flags and the schedule.
//
// A flag here is a coloured chip, one line of why, and a click that opens the rule it
// fired on with its threshold and where this patient sits against it. That last part is
// the whole reason this rail exists rather than a badge in a table: a flag that cannot
// say what tripped it is an assertion, and a clinician is entitled to the rule.

import { AlertTriangle, CalendarClock, Check, ChevronRight, Dna, FlaskConical } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useAckAlert, useAlertRule, useTimeline } from "@/api/client";
import type { Alert, Patient } from "@/api/types";
import type { StreamState } from "@/api/stream";
import { FlagChip, fmtDate } from "@/components/common";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/** The one-line reason a flag shows before you open it.
 *
 * The week stays in. Stripping it as redundant made two flags of the same kind from two
 * different weeks render as identical rows, which reads as a duplicate rather than as a
 * pattern, and the pattern is the thing worth seeing.
 */
function reasonOf(alert: Alert): string {
  return alert.trigger;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-border/60 px-4 py-4 last:border-b-0">
      <h2 className="mb-2.5 text-[10px] font-black uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Row({ label, value, hint }: { label: ReactNode; value: ReactNode; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1" title={hint}>
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right text-xs font-bold">{value}</span>
    </div>
  );
}

/** The rule behind one flag, opened from the rail. */
function RuleDialog({ aid, onClose }: { aid: string | null; onClose: () => void }) {
  const rule = useAlertRule(aid);
  return (
    <Dialog open={aid !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Why this flag fired</DialogTitle>
          <DialogDescription>
            The rule as it is written in the code, not a description of it.
          </DialogDescription>
        </DialogHeader>
        {rule.isLoading && <p className="text-sm text-muted-foreground">Loading the rule.</p>}
        {rule.data?.ok && (
          <div className="space-y-4 text-sm">
            <div>
              <p className="text-[10px] font-black uppercase tracking-wide text-muted-foreground">
                The rule
              </p>
              <p className="mt-1 font-bold">{rule.data.rule}</p>
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-wide text-muted-foreground">
                Why it is the rule
              </p>
              <p className="mt-1 text-muted-foreground">{rule.data.detail}</p>
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-wide text-muted-foreground">
                What tripped it
              </p>
              <p className="mt-1 text-muted-foreground">{rule.data.trigger}</p>
            </div>
            <div className="rounded-lg bg-muted px-3 py-2 font-mono text-xs">
              <div className="flex justify-between">
                <span>threshold</span>
                <span className="font-bold">{rule.data.threshold}</span>
              </div>
              {rule.data.state.drift_z !== undefined && (
                <div className="flex justify-between">
                  <span>drift z now</span>
                  <span className="font-bold">{rule.data.state.drift_z}</span>
                </div>
              )}
              {rule.data.state.coverage !== undefined && (
                <div className="flex justify-between">
                  <span>band coverage</span>
                  <span className="font-bold">{rule.data.state.coverage}</span>
                </div>
              )}
              {rule.data.state.week !== undefined && (
                <div className="flex justify-between">
                  <span>week</span>
                  <span className="font-bold">{rule.data.state.week}</span>
                </div>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Raised at {fmtDate(rule.data.time)}. Nothing about this flag phoned anybody: it waits
              here to be read.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function LeftRail({ patient, stream }: { patient: Patient; stream: StreamState }) {
  const timeline = useTimeline(patient.id);
  const ack = useAckAlert();
  const [rule, setRule] = useState<string | null>(null);

  // Alerts pushed over the stream while this is open are merged in, so a flag raised by a
  // call that just landed appears without a refetch.
  const live = stream.alerts.map((a) => a.id);
  const alerts = [...patient.alerts].sort((a, b) => Number(a.acked) - Number(b.acked));
  const open = alerts.filter((a) => !a.acked);
  const next = timeline.data?.next_call;

  const genotype = [
    patient.alleles.apoe ? `APOE ${patient.alleles.apoe}` : null,
    patient.alleles.bdnf ? `BDNF ${patient.alleles.bdnf}` : null,
  ].filter(Boolean);

  return (
    <aside className="order-2 rounded-2xl border border-border/70 bg-card lg:order-1 lg:min-h-0 lg:overflow-y-auto">
      <Section title="Key facts">
        <Row label="Week" value={`${patient.week} of 12`} />
        {patient.injury.mri_finding && (
          <Row label="MRI" value={patient.injury.mri_finding} hint={patient.injury.mri_finding} />
        )}
        {patient.injury.ct_finding && (
          <Row label="CT" value={patient.injury.ct_finding} hint={patient.injury.ct_finding} />
        )}
        {patient.injury.swi_foci !== null && patient.injury.swi_foci !== undefined && (
          <Row label="SWI foci" value={String(patient.injury.swi_foci)} />
        )}
        {patient.biomarkers.gfap_pg_ml !== null && patient.biomarkers.gfap_pg_ml !== undefined && (
          <Row
            label="GFAP"
            value={`${patient.biomarkers.gfap_pg_ml} pg/mL`}
            hint="ALERT-TBI decision cutoff 22 pg/mL. Not a reference interval."
          />
        )}
        {genotype.length > 0 && (
          <Row
            label={
              <span className="inline-flex items-center gap-1">
                <Dna className="h-3 w-3" aria-hidden /> Genotype
              </span>
            }
            value={genotype.join(", ")}
            hint="A covariate on the recovery rate. It does not change brain shape."
          />
        )}
        {patient.template_only && (
          <p className="mt-2 rounded-lg bg-synthetic-soft px-2.5 py-1.5 text-[11px] text-synthetic-foreground">
            <FlaskConical className="mr-1 inline h-3 w-3" aria-hidden />
            Template twin. No personal imaging, so the network is the atlas one.
          </p>
        )}
      </Section>

      <Section title={`Flags${open.length ? ` (${open.length} open)` : ""}`}>
        {alerts.length === 0 && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Check className="h-3.5 w-3.5 text-success" aria-hidden /> Nothing flagged.
          </p>
        )}
        <ul className="space-y-2">
          {alerts.map((a) => (
            <li
              key={a.id}
              className={cn(
                "rounded-xl border px-2.5 py-2",
                a.acked ? "border-border/60 bg-muted/30 opacity-70" : "border-border bg-background",
                live.includes(a.id) && "ring-2 ring-destructive/40",
              )}
            >
              <div className="flex items-center gap-2">
                <FlagChip flag={a.type} />
                {a.acked && <span className="text-[10px] text-muted-foreground">acknowledged</span>}
              </div>
              <button
                type="button"
                onClick={() => setRule(a.id)}
                className="mt-1.5 flex w-full items-start gap-1 text-left text-[11px] leading-snug text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
              >
                <span className="flex-1">{reasonOf(a)}</span>
                <ChevronRight className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
              </button>
              {!a.acked && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-1 h-7 px-2 text-[11px]"
                  onClick={() => ack.mutate(a.id)}
                >
                  Acknowledge
                </Button>
              )}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Check-ins">
        <Row label="Last" value={fmtDate(patient.last_call?.date ?? null)} />
        {next && (
          <Row
            label="Next"
            value={
              <span className={cn("inline-flex items-center gap-1", next.overdue && "text-destructive")}>
                {next.overdue ? (
                  <AlertTriangle className="h-3 w-3" aria-hidden />
                ) : (
                  <CalendarClock className="h-3 w-3" aria-hidden />
                )}
                {next.say.replace(/^Due /, "")}
              </span>
            }
            hint={next.say}
          />
        )}
        <Row
          label="Band coverage"
          value={`${Math.round(patient.coverage * 100)}%`}
          hint="Share of weeks where the truth fell inside the 80% band. The target is 80%."
        />
        <Row
          label="Drift z"
          value={patient.drift_z.toFixed(2)}
          hint="Mean standardized residual of the last two weeks, signed so positive means worse than expected."
        />
      </Section>

      <RuleDialog aid={rule} onClose={() => setRule(null)} />
    </aside>
  );
}
