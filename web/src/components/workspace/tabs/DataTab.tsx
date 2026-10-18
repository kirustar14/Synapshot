// Data: what is known about this patient, and where each fact came from.
//
// Every extracted value carries its provenance on hover: the file it was read from and
// the sentence it was read out of, copied exactly. A value below the confidence line is
// greyed and says "needs review", and the twin is not using it.
//
// This is the tab that makes the rest of the screen checkable. A forecast is only worth
// arguing with if you can get back to the sentence in the referral letter that it
// ultimately rests on, and that is two hovers from here.

import { AlertTriangle, ChevronDown, FileText, Sigma } from "lucide-react";
import { useState } from "react";
import { useProvenance, type FieldSource } from "@/api/client";
import type { Patient } from "@/api/types";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** One accordion section. Open by default for the ones a clinician reads first. */
function Accordion({
  title,
  count,
  children,
  start = false,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
  start?: boolean;
}) {
  const [open, setOpen] = useState(start);
  return (
    <section className="border-b border-border/60 last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 py-2.5 text-left focus-visible:outline-2 focus-visible:outline-ring"
      >
        <ChevronDown
          className={cn("h-3.5 w-3.5 shrink-0 transition-transform", !open && "-rotate-90")}
          aria-hidden
        />
        <span className="flex-1 text-xs font-black uppercase tracking-wide">{title}</span>
        {count !== undefined && (
          <span className="text-[10px] text-muted-foreground">{count}</span>
        )}
      </button>
      {open && <div className="pb-3">{children}</div>}
    </section>
  );
}

/** A value with its provenance behind a hover. */
function Value({
  label,
  value,
  source,
  threshold,
  unit,
}: {
  label: string;
  value: React.ReactNode;
  source?: FieldSource;
  threshold: number;
  unit?: string;
}) {
  const weak = source !== undefined && source.confidence < threshold;
  const derived = (source?.derived_from?.length ?? 0) > 0;

  const row = (
    <div
      className={cn(
        "flex items-baseline justify-between gap-3 rounded px-1.5 py-1",
        source && "cursor-help hover:bg-muted/60",
        weak && "opacity-60",
      )}
    >
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="flex min-w-0 items-baseline gap-1.5">
        <span className={cn("truncate text-right text-xs font-bold", weak && "italic")}>
          {value}
          {unit ? <span className="ml-0.5 font-normal text-muted-foreground">{unit}</span> : null}
        </span>
        {weak && (
          <span className="shrink-0 rounded bg-synthetic-soft px-1 py-0.5 text-[9px] font-bold text-synthetic-foreground">
            needs review
          </span>
        )}
        {derived && !weak && (
          <Sigma className="h-3 w-3 shrink-0 text-muted-foreground" aria-label="derived" />
        )}
      </span>
    </div>
  );

  if (!source) return row;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{row}</TooltipTrigger>
      <TooltipContent className="max-w-sm">
        {derived ? (
          <>
            <p className="font-bold">Worked out, not read.</p>
            <p className="mt-1">
              From {source.derived_from.join(" and ")}. {source.source_quote}
            </p>
          </>
        ) : (
          <>
            <p className="flex items-center gap-1 font-bold">
              <FileText className="h-3 w-3" aria-hidden />
              {source.source_file || "no file"}
            </p>
            <p className="mt-1 whitespace-pre-line font-mono text-[11px] leading-snug">
              {source.source_quote || "no quote recorded"}
            </p>
          </>
        )}
        <p className="mt-1.5 text-[10px] opacity-80">
          Confidence {Math.round(source.confidence * 100)}%
          {weak ? `, below the ${Math.round(threshold * 100)}% line, so the twin is not using it.` : "."}
        </p>
      </TooltipContent>
    </Tooltip>
  );
}

export function DataTab({ patient }: { patient: Patient }) {
  const prov = useProvenance(patient.id);
  const fields = prov.data?.fields ?? {};
  const threshold = prov.data?.threshold ?? 0.6;
  const src = (key: string) => fields[key];

  const injury = patient.injury;
  const bio = patient.biomarkers;
  const chart = patient.chart ?? { medications: [], reported_symptoms: [] };

  return (
    <div className="text-sm">
      {prov.data && !prov.data.ingested && (
        <p className="mb-2 rounded-lg bg-muted px-2.5 py-2 text-[11px] text-muted-foreground">
          {prov.data.note}
        </p>
      )}
      {prov.data?.ingested && prov.data.needs_review.length > 0 && (
        <p className="mb-2 flex items-start gap-1.5 rounded-lg bg-synthetic-soft px-2.5 py-2 text-[11px] text-synthetic-foreground">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
          <span>
            {prov.data.needs_review.length} field
            {prov.data.needs_review.length === 1 ? "" : "s"} need review:{" "}
            {prov.data.needs_review.join(", ")}. The twin is not using{" "}
            {prov.data.needs_review.length === 1 ? "it" : "them"}.
          </span>
        </p>
      )}

      <Accordion title="Injury" start>
        <Value label="Mechanism" value={injury.mechanism} source={src("injury_mechanism")} threshold={threshold} />
        <Value label="Date" value={injury.date} source={src("injury_date")} threshold={threshold} />
        {injury.days_ago !== null && injury.days_ago !== undefined && (
          <Value label="Days since" value={injury.days_ago} source={src("injury_days_ago")} threshold={threshold} />
        )}
        {injury.gcs !== null && injury.gcs !== undefined && (
          <Value label="GCS" value={injury.gcs} source={src("gcs")} threshold={threshold} />
        )}
        {injury.loc_seconds !== null && injury.loc_seconds !== undefined && (
          <Value label="Loss of consciousness" value={injury.loc_seconds} unit=" s" source={src("loc_seconds")} threshold={threshold} />
        )}
        <Value label="Impact site used" value={injury.location} threshold={threshold} />
      </Accordion>

      <Accordion title="Imaging" start>
        {injury.ct_finding && (
          <Value label="CT" value={injury.ct_finding} source={src("ct_finding")} threshold={threshold} />
        )}
        {injury.mri_finding && (
          <Value label="MRI" value={injury.mri_finding} source={src("mri_finding")} threshold={threshold} />
        )}
        {injury.contusion && (
          <Value label="Contusion" value={injury.contusion} source={src("contusion_side")} threshold={threshold} />
        )}
        {injury.swi_foci !== null && injury.swi_foci !== undefined && (
          <Value label="SWI foci" value={injury.swi_foci} source={src("swi_foci")} threshold={threshold} />
        )}
        {!injury.ct_finding && !injury.mri_finding && (
          <p className="px-1.5 text-xs text-muted-foreground">No imaging report was read.</p>
        )}
      </Accordion>

      <Accordion title="Bloods" start>
        {bio.gfap_pg_ml !== null && bio.gfap_pg_ml !== undefined ? (
          <Value label="GFAP" value={bio.gfap_pg_ml} unit=" pg/mL" source={src("gfap_pg_ml")} threshold={threshold} />
        ) : null}
        {bio.uchl1_pg_ml !== null && bio.uchl1_pg_ml !== undefined ? (
          <Value label="UCH-L1" value={bio.uchl1_pg_ml} unit=" pg/mL" source={src("uch_l1_pg_ml")} threshold={threshold} />
        ) : null}
        {bio.nfl_pg_ml !== null && bio.nfl_pg_ml !== undefined ? (
          <Value label="NfL" value={bio.nfl_pg_ml} unit=" pg/mL" source={src("nfl_pg_ml")} threshold={threshold} />
        ) : null}
        <div className="mt-1.5 border-t border-border/50 pt-1.5">
          <Value label="GFAP, as the model uses it" value={bio.gfap_z.toFixed(2)} unit=" z" threshold={threshold} />
          <Value label="UCH-L1, as the model uses it" value={bio.uchl1_z.toFixed(2)} unit=" z" threshold={threshold} />
        </div>
        <p className="mt-1.5 px-1.5 text-[10px] leading-snug text-muted-foreground">
          The ALERT-TBI decision cutoffs are 22 pg/mL for GFAP and 327 for UCH-L1. Those are cutoffs
          for ruling out injury on CT, not reference intervals. The z is this model's own axis and
          says nothing about whether a scan is needed. NfL is shown and not modelled.
        </p>
      </Accordion>

      <Accordion title="Genotype">
        <Value label="APOE" value={patient.alleles.apoe ?? `${patient.alleles.apoe_e4} e4 allele(s)`} source={src("apoe")} threshold={threshold} />
        <Value label="BDNF Val66Met" value={patient.alleles.bdnf ?? (patient.alleles.bdnf_met ? "Met carrier" : "Val/Val")} source={src("bdnf")} threshold={threshold} />
        <p className="mt-1.5 px-1.5 text-[10px] leading-snug text-muted-foreground">
          Both are covariates on the recovery rate with wide priors, and both are contested in the
          TBI literature. Neither changes brain shape: DNA never reaches the geometry.
        </p>
      </Accordion>

      <Accordion title="Medication" count={chart.medications?.length ?? 0}>
        {(chart.medications ?? []).length === 0 && (
          <p className="px-1.5 text-xs text-muted-foreground">No medication was read from the documents.</p>
        )}
        <ul className="space-y-1">
          {(chart.medications ?? []).map((m) => (
            <li key={m.name} className="flex items-baseline justify-between gap-2 px-1.5 py-0.5">
              <span className="text-xs font-bold capitalize">{m.name}</span>
              <span className="text-xs text-muted-foreground">
                {m.dose}
                {m.status !== "current" && (
                  <span className="ml-1.5 rounded bg-muted px-1 py-0.5 text-[9px] font-bold uppercase">
                    {m.status}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
        {(chart.medications ?? []).length > 0 && (
          <p className="mt-1.5 px-1.5 text-[10px] text-muted-foreground">
            Doses are shown exactly as the chart wrote them. Nothing parses them and no dose reaches
            the model.
          </p>
        )}
      </Accordion>

      <Accordion title="Reported symptoms" count={chart.reported_symptoms?.length ?? 0}>
        {(chart.reported_symptoms ?? []).length === 0 ? (
          <p className="px-1.5 text-xs text-muted-foreground">None named in the documents.</p>
        ) : (
          <div className="flex flex-wrap gap-1 px-1.5">
            {(chart.reported_symptoms ?? []).map((s) => (
              <span key={s} className="rounded-full bg-muted px-2 py-0.5 text-[11px] capitalize">
                {s}
              </span>
            ))}
          </div>
        )}
      </Accordion>

      <Accordion title="Model inputs" count={patient.inputs.length}>
        <ul className="space-y-1">
          {patient.inputs.map((f) => (
            <li key={f.kind} className="flex items-baseline justify-between gap-2 px-1.5 py-0.5">
              <span className="text-xs font-bold uppercase">{f.kind}</span>
              <span
                className="truncate text-[11px] text-muted-foreground"
                title={f.note ?? f.sets}
              >
                {f.status === "missing" ? "not provided" : f.note || f.sets}
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-2 px-1.5">
          <Value label="FC fit" value={patient.fc_fit === null ? "no personal fMRI" : patient.fc_fit.toFixed(3)} threshold={threshold} />
          <Value label="Twin" value={patient.template_only ? "template only" : "personal"} threshold={threshold} />
        </div>
      </Accordion>
    </div>
  );
}
