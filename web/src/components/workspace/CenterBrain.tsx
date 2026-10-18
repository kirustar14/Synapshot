// Zone three: the brain, which never leaves the screen.
//
// Around it, the controls that change what it shows and nothing else: which layer, which
// view, which region, which week. Anything that is a reading rather than a control lives
// in the right panel, so this column stays the thing you look at.
//
// The scrubber at the bottom is also the timeline. One control, because having a week
// slider here and a separate date picker in a tab means two sources of truth about which
// week you are looking at, and they will disagree.

import { ChevronDown, Crosshair, Search, X } from "lucide-react";
import { Suspense, lazy, useMemo, useState } from "react";
import { useBaseline, useLatestUpdate, useTwin, useVessels } from "@/api/client";
import type { Patient } from "@/api/types";
import { LAYERS, LAYER_BY_ID, REGIONS, rampGradient, regionLabel, useViewer, type LayerId } from "@/components/brain";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/pages/Workspace";

const BrainViewer = lazy(() => import("@/components/brain/BrainViewer"));

// Six presets. These are the views a clinician actually asks for, not every angle.
const PRESETS: { id: "left" | "right" | "top" | "front" | "back" | "bottom"; label: string }[] = [
  { id: "left", label: "Left" },
  { id: "right", label: "Right" },
  { id: "top", label: "Top" },
  { id: "front", label: "Front" },
  { id: "back", label: "Back" },
  { id: "bottom", label: "Under" },
];

const LOBES = ["Frontal", "Parietal", "Temporal", "Occipital", "Limbic", "Insular"];

export function CenterBrain({ patient }: { patient: Patient }) {
  const { week, setWeek, region, setRegion, overlay } = useWorkspace();
  const twin = useTwin(patient.id);
  // The brain as first built, and what each check-in moved since. The toggle below flips
  // between them: before this existed there was one copy of the brain, a call overwrote
  // it, and the state the patient was built from could not be got back.
  const history = useBaseline(patient.id);
  const update = useLatestUpdate(patient.id);
  const [showBaseline, setShowBaseline] = useState(false);
  const changed = update.data?.changed_regions ?? [];
  const vessels = useVessels();
  const viewer = useViewer();
  const [query, setQuery] = useState("");
  const [lobe, setLobe] = useState<string | null>(null);

  const weeks = twin.data?.weeks ?? [];
  const maxWeek = Math.max(0, weeks.length - 1);

  // Region search. Matches the plain name, so "superior frontal" finds it without
  // anybody having to learn that the atlas calls it 7Networks_LH_Cont_PFCl_1.
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const out: { index: number; label: string }[] = [];
    for (let i = 0; i < REGIONS; i++) {
      const got = regionLabel(undefined, twin.data, i);
      if (got.plain.toLowerCase().includes(q)) out.push({ index: i, label: got.plain });
      if (out.length >= 8) break;
    }
    return out;
  }, [query, twin.data]);

  const layer: LayerId = viewer.layer;

  return (
    <section className="order-1 flex min-w-0 flex-col gap-3 lg:order-2 lg:min-h-0">
      {/* One row of controls, all of it mono and quiet: what you are looking at, which
          brain, and the overlays. It used to be ten coloured pills and a vessel toggle
          wrapped across two lines, which is a lot of decisions to put above the thing
          they are about. The choices are the same, they are just inside a dropdown now. */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <label className="flex items-center gap-2">
          <span className="eyebrow text-muted-foreground">Showing</span>
          <span className="relative inline-flex items-center">
            <span
              className="pointer-events-none absolute left-2.5 h-2.5 w-2.5 rounded-full"
              style={{ background: rampGradient(LAYER_BY_ID[layer].stops) }}
              aria-hidden
            />
            <select
              value={layer}
              onChange={(e) => viewer.setLayer(e.target.value as LayerId)}
              aria-label="What the brain is showing"
              title={LAYER_BY_ID[layer].meaning}
              className="appearance-none rounded-full border border-foreground/25 bg-card py-1 pl-7 pr-7 text-[11px] font-bold focus-visible:outline-2 focus-visible:outline-ring"
            >
              {LAYERS.map((def) => (
                <option key={def.id} value={def.id}>
                  {def.label}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 h-3 w-3 text-muted-foreground" aria-hidden />
          </span>
        </label>

        {vessels.data && (
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={viewer.vessels}
              onChange={() => viewer.setFlag({ vessels: !viewer.vessels })}
              className="h-3.5 w-3.5 accent-foreground"
            />
            <span className="eyebrow text-muted-foreground" title={vessels.data.caption}>
              Vessels
            </span>
          </label>
        )}
      </div>

      {history.data?.baseline && (
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-full border border-border bg-card p-0.5" role="group" aria-label="Which brain to show">
            {[
              { id: "baseline", label: "Baseline" },
              { id: "latest", label: "Latest" },
            ].map((opt) => {
              const on = (opt.id === "baseline") === showBaseline;
              return (
                <button
                  key={opt.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setShowBaseline(opt.id === "baseline")}
                  className={cn(
                    "rounded-full px-3 py-1 text-xs font-bold",
                    on ? "bg-primary text-primary-foreground" : "text-muted-foreground",
                  )}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
          <span className="text-[11px] text-muted-foreground">
            {showBaseline
              ? "The brain as first built from the documents. Never rewritten."
              : changed.length
                ? `${changed.length} region${changed.length === 1 ? "" : "s"} moved at the last check-in`
                : `${history.data.count} check-in${history.data.count === 1 ? "" : "s"} on top of the baseline`}
          </span>
        </div>
      )}

      <div className="relative h-[52vh] min-h-[320px] lg:h-auto lg:min-h-0 lg:flex-1">
        <Suspense
          fallback={
            <div className="h-full min-h-[320px] rounded-xl border border-[#1e3a44] bg-[#070e12]" />
          }
        >
          <BrainViewer
            patientId={patient.id}
            week={week}
            layer={layer}
            fill
            presets={false}
            valuesOverride={null}
            baselineTwin={showBaseline ? history.data?.baseline ?? null : null}
            markRegions={showBaseline ? [] : changed.map((r) => r.id)}
            caption={overlay ? overlay.label : undefined}
          />
        </Suspense>

      </div>

      {/* Everything that is not the brain lives under the canvas.
          Overlaying these looked tidier and was not: the viewer draws its own badges top
          left, its own toggles top right and its own hint bottom left, and anything put
          over the canvas landed on one of them. The canvas is for the brain. */}
      <div className="flex items-center gap-3 rounded-lg border border-border/70 bg-muted/40 px-3 py-2">
        <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
          Week {week}
        </span>
        <Slider
          value={[week]}
          min={0}
          max={maxWeek || 12}
          step={1}
          onValueChange={([v]) => setWeek(v)}
          aria-label="Week shown on the brain"
          className="flex-1"
        />
        <span className="shrink-0 text-[10px] text-muted-foreground">
          {week <= patient.week ? "measured" : "forecast"}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a region"
            aria-label="Find a region by name"
            className="h-8 w-44 pl-7 text-xs"
          />
          {matches.length > 0 && (
            <ul className="absolute bottom-9 left-0 z-20 w-60 overflow-hidden rounded-lg border border-border bg-popover shadow-lg">
              {matches.map((m) => (
                <li key={m.index}>
                  <button
                    type="button"
                    onClick={() => {
                      setRegion(m.index);
                      setQuery("");
                    }}
                    className="block w-full px-2.5 py-1.5 text-left text-xs capitalize hover:bg-muted"
                  >
                    {m.label}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {region !== null && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-primary bg-primary-soft px-2.5 py-1 text-[11px] font-bold">
            <Crosshair className="h-3 w-3" aria-hidden />
            <span className="capitalize">{regionLabel(undefined, twin.data, region).plain}</span>
            <button
              type="button"
              onClick={() => setRegion(null)}
              aria-label="Clear the selected region"
              className="rounded p-0.5 hover:bg-background"
            >
              <X className="h-3 w-3" aria-hidden />
            </button>
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <div className="flex flex-wrap gap-1">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => viewer.setPreset(p.id)}
              className="rounded-full border border-border px-2 py-0.5 font-bold hover:bg-muted"
            >
              {p.label}
            </button>
          ))}
          <span className="mx-1 w-px self-stretch bg-border" aria-hidden />
          {LOBES.map((name) => (
            <button
              key={name}
              type="button"
              aria-pressed={lobe === name}
              onClick={() => setLobe(lobe === name ? null : name)}
              className={cn(
                "rounded-full border px-2 py-0.5 font-bold",
                lobe === name ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted",
              )}
            >
              {name}
            </button>
          ))}
        </div>
        <p>
          {week <= patient.week
            ? `Week ${week} is measured. The band around it is the filter's posterior.`
            : `Week ${week} is a forecast. Nothing has been measured there.`}
        </p>
      </div>

      {/* The vessel caption is shown, not hidden in a tooltip. A rendered vessel beside
          a rendered brain is exactly the thing that gets mistaken for an angiogram, and
          a label somebody has to hover for is a label most people never see. */}
      {viewer.vessels && vessels.data && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-blue-400/30 bg-blue-500/5 px-2.5 py-1.5 text-[10px] leading-snug">
          <span className="font-bold text-blue-700 dark:text-blue-300">
            {vessels.data.caption}
          </span>
          <button
            type="button"
            aria-pressed={viewer.arteries}
            onClick={() => viewer.setFlag({ arteries: !viewer.arteries })}
            className={cn(
              "rounded-full border px-2 py-0.5 font-bold",
              viewer.arteries ? "border-red-400 bg-red-500/15 text-red-700 dark:text-red-300" : "border-border",
            )}
          >
            Arteries
          </button>
          {(patient.injury.swi_foci ?? 0) > 0 && (
            <button
              type="button"
              aria-pressed={viewer.foci}
              onClick={() => viewer.setFlag({ foci: !viewer.foci })}
              className={cn(
                "rounded-full border px-2 py-0.5 font-bold",
                viewer.foci ? "border-orange-400 bg-orange-500/15 text-orange-700 dark:text-orange-300" : "border-border",
              )}
            >
              {patient.injury.swi_foci} SWI foci
            </button>
          )}
          <span className="text-muted-foreground">
            {(patient.injury.swi_foci ?? 0) > 0
              ? "The report counted the foci and named the lobe. It did not give coordinates, so the nodes are placed in that region rather than measured."
              : "No SWI foci were read for this patient."}
          </span>
        </div>
      )}
    </section>
  );
}
