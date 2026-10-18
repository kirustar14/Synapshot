// Zone three: the brain, which never leaves the screen.
//
// Around it, the controls that change what it shows and nothing else: which layer, which
// view, which region, which week. Anything that is a reading rather than a control lives
// in the right panel, so this column stays the thing you look at.
//
// The scrubber at the bottom is also the timeline. One control, because having a week
// slider here and a separate date picker in a tab means two sources of truth about which
// week you are looking at, and they will disagree.

import { Crosshair, Search, X } from "lucide-react";
import { Suspense, lazy, useMemo, useState } from "react";
import { useTwin, useVessels } from "@/api/client";
import type { Patient } from "@/api/types";
import { LAYERS, REGIONS, rampGradient, regionLabel, useViewer, type LayerId } from "@/components/brain";
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
      {/* Layer chips. One row, every layer named, with the ramp beside the name so the
          colour on the brain and the word in the chip are the same thing. */}
      <div className="flex flex-wrap items-center gap-1.5">
        {LAYERS.map((def) => (
          <button
            key={def.id}
            type="button"
            aria-pressed={layer === def.id}
            onClick={() => viewer.setLayer(def.id)}
            title={def.meaning}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold transition-colors focus-visible:outline-2 focus-visible:outline-ring",
              layer === def.id
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-background hover:bg-muted",
            )}
          >
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ background: rampGradient(def.stops) }}
              aria-hidden
            />
            {def.label}
          </button>
        ))}

        {vessels.data && (
          <button
            type="button"
            aria-pressed={viewer.vessels}
            onClick={() => viewer.setFlag({ vessels: !viewer.vessels })}
            title={vessels.data.caption}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold",
              viewer.vessels
                ? "border-blue-400 bg-blue-500/15 text-blue-700 dark:text-blue-300"
                : "border-border bg-background hover:bg-muted",
            )}
          >
            <span className="h-2.5 w-2.5 rounded-full bg-blue-500" aria-hidden />
            Vessels
          </button>
        )}
      </div>

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
                      viewer.setSelected(m.index);
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
              onClick={() => {
                setRegion(null);
                viewer.setSelected(null);
              }}
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
    </section>
  );
}
