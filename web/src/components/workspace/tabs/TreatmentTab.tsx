// Treatment: where each medicine's known targets and pathways are in the brain.
//
// What this is not, and used to be. It used to pick medicines, press a button to run the
// model, and show a baseline, a treated version and the gap between them, with an effect
// size slider and a ranked list of the regions that moved most. All of that came from
// perturbing the dynamic mean field model with a receptor-weighted gain. It looked like a
// prediction of what a medicine would do to this patient, and nothing in this system has
// the standing to make one.
//
// So the simulation is gone, and what is left is a reference. Toggle a medicine and the
// brain lights up where its targets actually are, from the PET and SPECT atlas, plus the
// schematic pathway its transmitter runs along. Everything else about the medicine is in
// a dropdown, closed by default, so the page stays readable with twelve of them on it.
//
// Nothing here is instant-on by accident: the toggles light the brain immediately because
// there is nothing to compute, which is the whole point of it against a version that
// had to run a model first.

import { ChevronRight, Info, Search } from "lucide-react";
import { useMemo, useState } from "react";
import {
  useDrug,
  useDrugOverlap,
  useFormulary,
  usePathways,
  useSuggestedDrugs,
  type Drug,
  type SuggestedDrug,
} from "@/api/client";
import type { Patient } from "@/api/types";
import { Loading } from "@/components/common";
import { Fold } from "@/components/fold";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/pages/Workspace";
import { useViewer } from "@/components/brain";

/** The one sentence this tab is allowed to make about itself. */
const ABOUT =
  "Shows where each medicine's known targets and pathways are in the brain. " +
  "It does not predict whether it will help.";

/** Targets with no single tract to draw, which say so rather than drawing one. */
const NO_TRACT = new Set(["GABA-A", "NMDA", "mGluR5", "SV2A"]);

function Tag({ tag }: { tag: "verified" | "check this" }) {
  return (
    <span
      className={cn(
        "ml-1.5 rounded-full border px-1.5 py-px text-[9px] font-bold uppercase tracking-wide",
        tag === "verified"
          ? "border-success/40 bg-success-soft text-success"
          : "border-synthetic/40 bg-synthetic-soft text-synthetic-foreground",
      )}
    >
      {tag}
    </span>
  );
}

/** One closed sub-section inside a medicine's row. */
function Part({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <Fold id={id} title={title} summary="">
      <div className="text-xs leading-relaxed">{children}</div>
    </Fold>
  );
}

/** Where a medicine's targets land in this patient's damaged regions. */
function Overlap({ patientId, name, week }: { patientId: string; name: string; week: number }) {
  const got = useDrugOverlap(patientId, name, week, true);
  if (got.isLoading) return <Loading label="Reading the overlap" />;
  const rows = got.data?.regions ?? [];
  if (!rows.length) {
    return <p className="text-muted-foreground">{got.data?.note || "No regions meet both conditions."}</p>;
  }
  return (
    <>
      <p className="mb-2 text-muted-foreground">
        Damage above {got.data?.damage_floor} and target density above {got.data?.target_z} standard
        deviations. An overlap of two maps, not a prediction.
      </p>
      <ul className="space-y-1.5">
        {rows.map((r) => (
          <li key={r.id} className="flex items-baseline justify-between gap-2">
            <span className="min-w-0">
              <span className="font-bold">{r.name}</span>
              <span className="ml-1.5 text-muted-foreground">{r.network}</span>
            </span>
            <span className="shrink-0 font-mono text-[11px]">
              {r.damage.toFixed(2)}
              <span className="text-muted-foreground">
                {" "}
                [{r.damage_lo.toFixed(2)}, {r.damage_hi.toFixed(2)}]
              </span>
              <span className="ml-2 text-muted-foreground">z {r.target_z.toFixed(1)}</span>
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

/** Everything about one medicine, in closed sub-sections. */
function Detail({ name, patientId, week }: { name: string; patientId: string; week: number }) {
  const got = useDrug(name);
  const paths = usePathways();
  const flash = useViewer((s) => s.flashPathway);
  if (got.isLoading || !got.data) return <Loading label="Reading the record" />;
  const d: Drug = got.data;
  const mine = (paths.data?.pathways ?? []).filter((p) => d.pathways.includes(p.group));

  return (
    <div className="mt-2 space-y-1 border-l-2 border-border pl-3">
      <Part id={`drug.${name}.what`} title="What it does">
        <p>{d.what_it_does}</p>
        <p className="mt-1.5 text-muted-foreground">{d.mechanism}</p>
      </Part>

      <Part id={`drug.${name}.where`} title="Where it acts in the brain">
        {d.targets.length === 0 ? (
          <p className="text-muted-foreground">{d.no_mapped_target}</p>
        ) : (
          <ul className="space-y-2">
            {d.targets.map((t) => (
              <li key={t.target}>
                <span className="font-bold">{t.target}</span>
                <span className="ml-1 text-muted-foreground">{t.full_name}</span>
                <Tag tag={t.evidence_tag} />
                <p className="mt-0.5 text-muted-foreground">{t.plain}</p>
                {t.atlas_key && NO_TRACT.has(t.atlas_key) && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="mt-0.5 inline-block cursor-help text-[11px] underline decoration-dotted">
                        no single tract
                      </span>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      This target is spread across the cortex rather than carried along one
                      pathway, so the density map is shown and no tube is drawn.
                    </TooltipContent>
                  </Tooltip>
                )}
              </li>
            ))}
          </ul>
        )}
      </Part>

      <Part id={`drug.${name}.paths`} title="Pathways it touches">
        {mine.length === 0 ? (
          <p className="text-muted-foreground">No single tract for this medicine's targets.</p>
        ) : (
          <ul className="space-y-1.5">
            {mine.map((p) => (
              <li key={p.key}>
                <button
                  type="button"
                  onClick={() => flash(p.key)}
                  className="text-left font-bold underline decoration-dotted underline-offset-2"
                >
                  {p.name}
                </button>
                <p className="text-muted-foreground">{p.about}</p>
              </li>
            ))}
          </ul>
        )}
        {paths.data?.caption && (
          <p className="mt-2 text-[11px] text-muted-foreground">{paths.data.caption}</p>
        )}
      </Part>

      <Part id={`drug.${name}.uses`} title="Usually used for">
        <p>{d.usual_uses.join(", ") || "Not listed."}</p>
      </Part>

      <Part id={`drug.${name}.tbi`} title="In brain injury">
        <p>
          {d.in_tbi}
          <Tag tag={d.in_tbi_evidence_tag} />
        </p>
      </Part>

      <Part id={`drug.${name}.overlap`} title="Regions that carry this target within the injured area">
        {d.has_map ? (
          <Overlap patientId={patientId} name={name} week={week} />
        ) : (
          <p className="text-muted-foreground">{d.no_mapped_target}</p>
        )}
      </Part>

      <Part id={`drug.${name}.refs`} title="Sources">
        <ul className="space-y-1">
          {d.refs.map((r) => (
            <li key={r.text}>
              {r.text}
              <Tag tag={r.evidence_tag} />
            </li>
          ))}
        </ul>
      </Part>
    </div>
  );
}

/** One medicine: the toggle, the name, the class, the target chips, and the dropdown. */
function Row({
  drug,
  on,
  onToggle,
  patientId,
  week,
  open,
  setOpen,
}: {
  drug: Drug;
  on: boolean;
  onToggle: () => void;
  patientId: string;
  week: number;
  open: boolean;
  setOpen: (v: boolean) => void;
}) {
  return (
    <li id={`drug-row-${drug.name}`} className="border-b border-border py-2 last:border-0">
      <div className="flex items-start gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              role="switch"
              aria-checked={on}
              aria-label={`Light up ${drug.name} on the brain`}
              disabled={!drug.has_map}
              onClick={onToggle}
              className={cn(
                "mt-0.5 h-4 w-7 shrink-0 rounded-full border transition-colors disabled:opacity-40",
                on ? "border-transparent" : "border-border bg-muted",
              )}
              style={on ? { background: drug.color } : undefined}
            >
              <span
                className={cn(
                  "block h-3 w-3 rounded-full bg-card transition-transform",
                  on ? "translate-x-3.5" : "translate-x-0.5",
                )}
              />
            </button>
          </TooltipTrigger>
          <TooltipContent>
            {drug.has_map ? "Light up its target density on the brain" : "No mapped brain target"}
          </TooltipContent>
        </Tooltip>

        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="min-w-0 flex-1 text-left"
          aria-expanded={open}
        >
          <span className="flex items-center gap-1.5">
            <ChevronRight
              className={cn("h-3 w-3 shrink-0 transition-transform", open && "rotate-90")}
              aria-hidden
            />
            <span className="text-sm font-bold capitalize">{drug.name}</span>
            {on && (
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: drug.color }}
                aria-hidden
              />
            )}
          </span>
          <span className="ml-4.5 block text-[11px] text-muted-foreground">{drug.class}</span>
          <span className="ml-4.5 mt-1 flex flex-wrap gap-1">
            {drug.targets.map((t) => (
              <span
                key={t.target}
                className={cn(
                  "rounded-full border px-1.5 py-px text-[10px]",
                  t.atlas_key ? "border-border bg-card" : "border-dashed border-border text-muted-foreground",
                )}
                title={t.atlas_key ? t.full_name : `${t.full_name}, no map available`}
              >
                {t.target}
              </span>
            ))}
            {!drug.targets.length && (
              <span className="text-[10px] text-muted-foreground">No mapped brain target</span>
            )}
          </span>
        </button>
      </div>

      {open && <Detail name={drug.name} patientId={patientId} week={week} />}
    </li>
  );
}

/** The medicines commonly used for the symptoms this patient reported. */
function Suggested({
  patientId,
  onPick,
}: {
  patientId: string;
  onPick: (name: string) => void;
}) {
  const got = useSuggestedDrugs(patientId);
  if (got.isLoading) return <Loading label="Matching the symptoms" />;
  const rows: SuggestedDrug[] = got.data?.drugs ?? [];

  return (
    <section className="mb-4">
      <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
        Commonly considered for the symptoms this patient reports
        <Tooltip>
          <TooltipTrigger asChild>
            <Info className="h-3 w-3 cursor-help" aria-hidden />
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">{got.data?.note}</TooltipContent>
        </Tooltip>
      </h3>

      {rows.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">{got.data?.message}</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {rows.map((r) => (
            <li key={r.name}>
              <button
                type="button"
                onClick={() => onPick(r.name)}
                className="flex w-full items-baseline justify-between gap-2 rounded-lg border border-border bg-card px-2.5 py-1.5 text-left"
              >
                <span className="min-w-0">
                  <span className="text-sm font-bold capitalize">{r.name}</span>
                  {r.current && (
                    <span className="ml-1.5 rounded-full border border-primary/40 bg-primary-soft px-1.5 py-px text-[9px] font-bold uppercase text-primary">
                      current
                    </span>
                  )}
                  <span className="block text-[11px] text-muted-foreground">{r.reason}</span>
                </span>
                <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function TreatmentTab({ patient }: { patient: Patient }) {
  const { week } = useWorkspace();
  const formulary = useFormulary();
  const lit = useViewer((s) => s.drugs);
  const toggleDrug = useViewer((s) => s.toggleDrug);
  const [find, setFind] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [about, setAbout] = useState(false);

  const all: Drug[] = useMemo(() => formulary.data?.drugs ?? [], [formulary.data]);
  const shown = useMemo(() => {
    const want = find.trim().toLowerCase();
    if (!want) return all;
    return all.filter(
      (d) =>
        d.name.includes(want) ||
        d.class.toLowerCase().includes(want) ||
        d.targets.some((t) => t.target.toLowerCase().includes(want)),
    );
  }, [all, find]);

  function reveal(name: string) {
    setOpen((prev) => ({ ...prev, [name]: true }));
    // Scrolled rather than jumped, so it is clear the list moved under you.
    window.requestAnimationFrame(() => {
      document.getElementById(`drug-row-${name}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  if (formulary.isLoading) return <Loading label="Reading the formulary" />;

  const onNow = all.filter((d) => lit.includes(d.name));

  return (
    <div className="pt-3">
      <h2 className="flex items-center gap-1.5 text-sm font-bold">
        Treatment
        <button
          type="button"
          onClick={() => setAbout(!about)}
          aria-label="What this tab shows"
          aria-expanded={about}
          className="text-muted-foreground"
        >
          <Info className="h-3.5 w-3.5" aria-hidden />
        </button>
      </h2>
      {about && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{ABOUT}</p>}

      <div className="mt-3">
        <Suggested patientId={patient.id} onPick={reveal} />
      </div>

      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          value={find}
          onChange={(e) => setFind(e.target.value)}
          placeholder="Search the formulary"
          aria-label="Search the formulary"
          className="h-9 pl-8 text-sm"
        />
      </div>

      <ul className="mt-1">
        {shown.map((d) => (
          <Row
            key={d.name}
            drug={d}
            on={lit.includes(d.name)}
            onToggle={() => toggleDrug(d.name)}
            patientId={patient.id}
            week={week}
            open={!!open[d.name]}
            setOpen={(v) => setOpen((prev) => ({ ...prev, [d.name]: v }))}
          />
        ))}
        {shown.length === 0 && (
          <li className="py-3 text-xs text-muted-foreground">Nothing in the formulary matches that.</li>
        )}
      </ul>

      {onNow.length > 0 && (
        <div className="mt-3 rounded-lg border border-border bg-card px-3 py-2">
          <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
            On the brain now
          </p>
          <ul className="mt-1.5 flex flex-wrap gap-2">
            {onNow.map((d) => (
              <li key={d.name} className="flex items-center gap-1.5 text-xs">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: d.color }} aria-hidden />
                <span className="capitalize">{d.name}</span>
                <span className="text-muted-foreground">{d.mapped_targets.join(", ")}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default TreatmentTab;
