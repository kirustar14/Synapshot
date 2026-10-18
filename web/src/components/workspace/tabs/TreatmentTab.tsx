// Treatment: the drug what-if.
//
// Pick drugs, press Simulate, and the brain shows where that receptor profile would bite
// hardest. Three modes: baseline, with drug, and the difference, which is the one worth
// looking at and uses a diverging map.
//
// The banner is always on. Not a dismissible notice, not a tooltip: a line that is
// present whenever this tab is, because this is the screen most likely to be screenshotted
// out of context and the screenshot has to carry its own disclaimer.
//
// Dose is displayed and never sent. The request body has a drug name and a gain in it and
// nothing else, which is checked by a test.

import { AlertTriangle, Ban, Loader2, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useDrugImpact, useFormulary, useMesh, useTwin, type DrugEntry } from "@/api/client";
import type { Patient } from "@/api/types";
import { regionLabel, useViewer } from "@/components/brain";
import { Loading } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/pages/Workspace";

type Mode = "baseline" | "with" | "difference";

const MODES: { id: Mode; label: string }[] = [
  { id: "baseline", label: "Baseline" },
  { id: "with", label: "With drug" },
  { id: "difference", label: "Difference" },
];

/** One drug in the list. A drug the model cannot represent still appears, with why not. */
function DrugRow({
  drug,
  picked,
  onToggle,
}: {
  drug: DrugEntry;
  picked: boolean;
  onToggle: () => void;
}) {
  const body = (
    <button
      type="button"
      onClick={drug.modeled ? onToggle : undefined}
      aria-pressed={drug.modeled ? picked : undefined}
      disabled={!drug.modeled}
      className={cn(
        "flex w-full items-start gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors",
        picked ? "border-primary bg-primary-soft" : "border-border bg-background",
        drug.modeled ? "hover:bg-muted" : "cursor-default opacity-60",
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-xs font-bold capitalize">{drug.name}</span>
          {!drug.modeled && (
            <span className="inline-flex shrink-0 items-center gap-0.5 rounded bg-muted px-1 py-0.5 text-[9px] font-bold uppercase text-muted-foreground">
              <Ban className="h-2.5 w-2.5" aria-hidden /> not modelled
            </span>
          )}
          {drug.proxy_targets.length > 0 && (
            <span className="shrink-0 rounded bg-synthetic-soft px-1 py-0.5 text-[9px] font-bold uppercase text-synthetic-foreground">
              proxy map
            </span>
          )}
        </span>
        <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
          {drug.class}
          {drug.typical_dose ? ` · ${drug.typical_dose}` : ""}
        </span>
        {drug.targets.length > 0 && (
          <span className="mt-1 flex flex-wrap gap-1">
            {drug.targets.map((t) => (
              <span
                key={t.receptor}
                className="rounded-full bg-muted px-1.5 py-0.5 font-mono text-[9px]"
                title={t.why}
              >
                {t.direction > 0 ? "↑" : "↓"} {t.receptor}
              </span>
            ))}
          </span>
        )}
      </span>
    </button>
  );

  const reason = drug.modeled ? drug.note : drug.why_not;
  if (!reason) return body;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{body}</TooltipTrigger>
      <TooltipContent className="max-w-sm">{reason}</TooltipContent>
    </Tooltip>
  );
}

export function TreatmentTab({ patient }: { patient: Patient }) {
  const formulary = useFormulary();
  const viewer = useViewer();
  const { setRegion } = useWorkspace();

  const [picked, setPicked] = useState<string[]>([]);
  const [gain, setGain] = useState(0.2);
  const [mode, setMode] = useState<Mode>("difference");
  const [run, setRun] = useState(false);
  const [query, setQuery] = useState("");

  const drugs = formulary.data?.drugs ?? [];
  const chartMeds = (patient.chart?.medications ?? []).map((m) => m.name);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = q ? drugs.filter((d) => d.name.includes(q) || d.class.toLowerCase().includes(q)) : drugs;
    // The patient's own medication first. It is the list a clinician is actually asking
    // about, and making them search for it would be a strange thing to do.
    return [...base].sort((a, b) => {
      const am = chartMeds.includes(a.name) ? 0 : 1;
      const bm = chartMeds.includes(b.name) ? 0 : 1;
      return am - bm || Number(b.modeled) - Number(a.modeled);
    });
  }, [drugs, query, chartMeds]);

  const selection = picked.map((name) => ({ name }));
  const impact = useDrugImpact(patient.id, selection, gain, run && picked.length > 0);
  const got = impact.data;

  // Without the mesh, regionLabel has no lobe and no centroid and every region comes back
  // "left cortex". Both queries are already in the cache: the viewer on this same screen
  // fetched them, and the mesh one is parameterless and never goes stale.
  const mesh = useMesh();
  const twin = useTwin(patient.id);

  const top = useMemo(() => {
    if (!got?.modeled || !got.region_effect) return [];
    return (got.top_changed ?? []).map((i) => ({
      index: i,
      effect: got.region_effect![i],
      lo: got.lo?.[i] ?? 0,
      hi: got.hi?.[i] ?? 0,
      label: regionLabel(mesh.data, twin.data, i).plain,
    }));
  }, [got, mesh.data, twin.data]);

  return (
    <div className="text-sm">
      {/* Always on. Not dismissible. */}
      <p className="sticky top-0 z-10 -mx-3 mb-2 flex items-start gap-1.5 border-b border-synthetic/40 bg-synthetic-soft px-3 py-2 text-[11px] font-bold leading-snug text-synthetic-foreground">
        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
        {formulary.data?.banner ??
          "Hypothetical what-if on a network model. Not a treatment recommendation, not a prediction, and no dose is modelled."}
      </p>

      {formulary.isLoading && <Loading label="Loading the formulary" />}

      <div className="relative mb-2">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search the formulary"
          aria-label="Search the formulary"
          className="h-8 pl-8 text-xs"
        />
      </div>

      <ul className="space-y-1.5">
        {shown.map((d) => (
          <li key={d.name}>
            <DrugRow
              drug={d}
              picked={picked.includes(d.name)}
              onToggle={() =>
                setPicked((have) =>
                  have.includes(d.name) ? have.filter((n) => n !== d.name) : [...have, d.name],
                )
              }
            />
            {chartMeds.includes(d.name) && (
              <p className="mt-0.5 px-1 text-[10px] text-muted-foreground">On this patient's chart.</p>
            )}
          </li>
        ))}
      </ul>

      <div className="sticky bottom-0 mt-3 space-y-2 border-t border-border/60 bg-card pt-3">
        <div className="flex items-center gap-2">
          <span className="shrink-0 text-[10px] font-bold uppercase text-muted-foreground">Effect size</span>
          <Slider
            value={[gain]}
            min={0.05}
            max={0.5}
            step={0.05}
            onValueChange={([v]) => setGain(v)}
            aria-label="How strongly to perturb the local gain"
            className="flex-1"
          />
          <span className="w-8 shrink-0 text-right font-mono text-[11px]">{gain.toFixed(2)}</span>
        </div>
        <p className="text-[10px] leading-snug text-muted-foreground">
          At {gain.toFixed(2)} the most affected region's local gain moves by{" "}
          {Math.round(gain * 100)}%. This is a modelling knob, not a dose.
        </p>

        <div className="flex gap-2">
          <Button
            className="flex-1"
            disabled={picked.length === 0}
            onClick={() => setRun(true)}
          >
            {impact.isFetching ? <Loader2 className="animate-spin" aria-hidden /> : null}
            Simulate
          </Button>
          {picked.length > 0 && (
            <Button variant="outline" onClick={() => { setPicked([]); setRun(false); }}>
              Clear
            </Button>
          )}
        </div>

        {got?.modeled && (
          <div className="flex gap-1" role="group" aria-label="What the brain shows">
            {MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                aria-pressed={mode === m.id}
                onClick={() => {
                  setMode(m.id);
                  viewer.setLayer(m.id === "difference" ? "difference" : "activity");
                }}
                className={cn(
                  "flex-1 rounded-lg border px-2 py-1 text-[11px] font-bold",
                  mode === m.id ? "border-primary bg-primary text-primary-foreground" : "border-border",
                )}
              >
                {m.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {impact.isFetching && <Loading label="Simulating both sides" />}

      {got && !got.modeled && (
        <p className="mt-3 rounded-lg bg-muted px-2.5 py-2 text-xs text-muted-foreground">{got.say}</p>
      )}

      {got?.modeled && (
        <div className="mt-3 space-y-3">
          <p className="rounded-lg bg-muted/60 px-2.5 py-2 text-[11px] leading-snug">{got.say}</p>

          {got.warnings.length > 0 && (
            <ul className="space-y-1">
              {got.warnings.map((w) => (
                <li
                  key={w}
                  className="rounded-lg bg-synthetic-soft px-2.5 py-1.5 text-[10px] leading-snug text-synthetic-foreground"
                >
                  {w}
                </li>
              ))}
            </ul>
          )}

          <div>
            <p className="mb-1 text-[10px] font-black uppercase tracking-wide text-muted-foreground">
              Most changed regions
            </p>
            {top.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No region's effect holds its sign. Everything is shaded unclear.
              </p>
            ) : (
              <ul className="space-y-0.5">
                {top.map((r) => (
                  <li key={r.index}>
                    <button
                      type="button"
                      onClick={() => setRegion(r.index)}
                      className="flex w-full items-baseline justify-between gap-2 rounded px-1 py-0.5 text-left hover:bg-muted"
                    >
                      <span className="truncate text-[11px] capitalize">{r.label}</span>
                      <span className="shrink-0 font-mono text-[10px]">
                        {r.effect > 0 ? "+" : ""}
                        {r.effect.toFixed(4)}
                        <span className="ml-1 text-muted-foreground">
                          [{r.lo.toFixed(4)}, {r.hi.toFixed(4)}]
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {(got.unclear_count ?? 0) > 0 && (
              <p className="mt-1 text-[10px] text-muted-foreground">
                {got.unclear_count} of {got.region_effect?.length ?? 0} regions are shaded unclear:
                their 80% interval crosses zero, so the model does not agree on the sign.
              </p>
            )}
          </div>

          <details className="rounded-lg border border-border/60 px-2.5 py-2">
            <summary className="cursor-pointer text-[11px] font-bold">
              What this interval does and does not cover
            </summary>
            <div className="mt-2 space-y-2">
              <div>
                <p className="text-[10px] font-bold uppercase text-muted-foreground">Covers</p>
                <ul className="mt-0.5 list-disc space-y-0.5 pl-4">
                  {(got.interval_covers ?? []).map((t) => (
                    <li key={t} className="text-[10px] leading-snug">{t}</li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase text-destructive">Does not cover</p>
                <ul className="mt-0.5 list-disc space-y-0.5 pl-4">
                  {(got.interval_misses ?? []).map((t) => (
                    <li key={t} className="text-[10px] leading-snug">{t}</li>
                  ))}
                </ul>
              </div>
            </div>
          </details>
        </div>
      )}
    </div>
  );
}
