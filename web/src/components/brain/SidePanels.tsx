// The reading panels beside the stage. None of these import three, so a page can show them
// while the viewer chunk is still loading.

import { Crosshair, Dna, Pin, Ruler, UserRound, Zap } from "lucide-react";
import { useReceptors } from "@/api/client";
import type { Mesh, Patient, Twin } from "@/api/types";
import { Empty } from "@/components/common";
import { LAYER_BY_ID, rampColor, type LayerId } from "./layers";
import { atWeek, regionLabel, topDamaged, type LayerValues } from "./regionData";
import { RECEPTOR_TARGETS, useViewer } from "./viewerStore";

/** Receptor map keys differ between the real atlas and the mock stand-in, so try both. */
const RECEPTOR_KEYS: Record<string, string[]> = {
  "GABA-A": ["GABA-A", "GABAa", "gabaa"],
  NMDA: ["NMDA", "nmda"],
  D2: ["D2", "d2"],
  "5-HT2A": ["5-HT2A", "5HT2a", "5ht2a"],
  "mu-opioid": ["mu-opioid", "MU", "mu"],
};

/** The map for one canonical target, whichever spelling the backend used. */
export function receptorMap(maps: Record<string, number[]> | undefined, target: string): number[] | null {
  if (!maps) return null;
  for (const key of RECEPTOR_KEYS[target] ?? [target]) {
    if (maps[key]) return maps[key];
  }
  return null;
}

export function WhereItHurts({
  mesh,
  twin,
  week,
  onPick,
}: {
  mesh: Mesh | undefined;
  twin: Twin | undefined;
  week: number;
  onPick: (id: number) => void;
}) {
  const selected = useViewer((s) => s.selected);
  const rows = topDamaged(twin, week, 5);
  const def = LAYER_BY_ID.damage;

  if (rows.length === 0) return <Empty>No twin yet, so there is nothing to point at.</Empty>;

  return (
    <ol className="space-y-2">
      {rows.map((r, i) => {
        const label = regionLabel(mesh, twin, r.id);
        const region = twin?.regions[r.id];
        const lo = atWeek(region?.damage_lo, week);
        const hi = atWeek(region?.damage_hi, week);
        return (
          <li key={r.id}>
            <button
              type="button"
              onClick={() => onPick(r.id)}
              className={`w-full rounded-xl border px-3 py-2 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                selected === r.id ? "border-primary/50 bg-primary-soft" : ""
              }`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs font-bold capitalize">
                  <span className="mr-1 font-mono text-[10px] text-muted-foreground">{i + 1}</span>
                  {label.plain}
                </span>
                <span className="font-mono text-[11px] tabular-nums">{r.value.toFixed(2)}</span>
              </div>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${Math.min(100, r.value * 100)}%`, background: rampColor(def.stops, r.value) }}
                />
              </div>
              <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                {label.code} &middot; {label.network} &middot; range {lo.toFixed(2)} to {hi.toFixed(2)}
              </p>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

export function RegionPanel({
  mesh,
  twin,
  week,
  layer,
  values,
}: {
  mesh: Mesh | undefined;
  twin: Twin | undefined;
  week: number;
  layer: LayerId;
  values: LayerValues;
}) {
  const v = useViewer();
  const receptors = useReceptors();
  const id = v.selected ?? v.hovered;

  if (id === null || id === undefined) {
    return <Empty>Click a region on the brain, or a name in the list, to read its numbers here.</Empty>;
  }

  const label = regionLabel(mesh, twin, id);
  const region = twin?.regions[id];
  const def = LAYER_BY_ID[layer];

  return (
    <div className="space-y-3 text-xs">
      <div>
        <p className="text-sm font-extrabold capitalize">{label.plain}</p>
        <p className="font-mono text-[10px] text-muted-foreground">{label.code}</p>
      </div>
      <dl className="grid grid-cols-2 gap-2">
        <Row term="Network" value={label.network} />
        <Row term="Area" value={label.lobe} />
        <Row
          term="Damage"
          value={`${atWeek(region?.damage, week).toFixed(2)} (${atWeek(region?.damage_lo, week).toFixed(2)} to ${atWeek(region?.damage_hi, week).toFixed(2)})`}
        />
        <Row term="Activity" value={`${atWeek(region?.activity, week).toFixed(2)} z against healthy`} />
        <Row term="Recovery" value={`${(region?.recovery ?? 1).toFixed(2)}x typical`} />
        <Row term="Excitation and inhibition" value={`${(region?.ei ?? 0).toFixed(3)} against ${(region?.template_ei ?? 0).toFixed(3)}`} />
        <Row
          term={def.label}
          value={values.format(values.raw[id])}
          swatch={rampColor(def.stops, values.pos[id])}
        />
      </dl>
      <div>
        <p className="mb-1 flex items-center gap-1 font-bold">
          <Zap className="h-3 w-3" aria-hidden /> Receptor density here
        </p>
        {receptors.data ? (
          <ul className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[11px]">
            {RECEPTOR_TARGETS.map((t) => {
              const map = receptorMap(receptors.data?.maps, t);
              return (
                <li key={t} className="flex justify-between gap-2">
                  <span className="text-muted-foreground">{t}</span>
                  <span>{map ? map[id].toFixed(2) : "none"}</span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-[11px] text-muted-foreground">Receptor maps not loaded.</p>
        )}
        {receptors.data?.synthetic_template && (
          <p className="mt-1 text-[10px] text-synthetic-foreground">
            These maps are a smooth stand-in, not real PET data.
          </p>
        )}
      </div>
      {v.selected !== null && (
        <button type="button" onClick={() => v.setSelected(null)} className="inline-flex items-center gap-1 text-[11px] text-primary underline-offset-4 hover:underline">
          <Pin className="h-3 w-3" aria-hidden /> Unpin this region
        </button>
      )}
    </div>
  );
}

function Row({ term, value, swatch }: { term: string; value: string; swatch?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{term}</dt>
      <dd className="flex items-center gap-1.5 font-mono text-[11px] capitalize">
        {swatch && <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: swatch }} aria-hidden />}
        {value}
      </dd>
    </div>
  );
}

export function TractPanel({ twin, week }: { twin: Twin | undefined; week: number }) {
  const v = useViewer();
  const rows = twin?.top_tracts ?? [];
  const edge = v.selectedTract !== null ? twin?.edges[v.selectedTract] : undefined;

  return (
    <div className="space-y-3">
      {edge && (
        <div className="rounded-xl border border-primary/40 bg-primary-soft p-3 text-xs">
          <p className="font-bold">
            {twin?.regions[edge.a]?.name} to {twin?.regions[edge.b]?.name}
          </p>
          <p className="mt-1 font-mono text-[11px]">
            Week 0 {edge.damage[0].toFixed(2)} &middot; now {atWeek(edge.damage, week).toFixed(2)} &middot; weight{" "}
            {edge.personal_w.toFixed(2)} against template {edge.template_w.toFixed(2)}
          </p>
          <button type="button" onClick={() => v.setSelectedTract(null)} className="mt-1 text-[11px] text-primary underline-offset-4 hover:underline">
            Clear
          </button>
        </div>
      )}
      {rows.length === 0 ? (
        <Empty>No tracts yet.</Empty>
      ) : (
        <ul className="space-y-1.5 text-xs">
          {rows.map((t) => (
            <li key={t.name} className="flex items-baseline justify-between gap-3 border-b pb-1.5 last:border-0">
              <span className="min-w-0 flex-1 truncate" title={t.name}>
                {t.name}
              </span>
              <span className="shrink-0 font-mono text-[11px] tabular-nums">
                <span className="text-muted-foreground">{t.damage_w0.toFixed(2)}</span> to {t.damage_now.toFixed(2)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[11px] text-muted-foreground">
        Damage at week 0 and now. Click a tract on the brain to pin it. Broken looking tracts are drawn with gaps in
        proportion to their damage.
      </p>
    </div>
  );
}

interface PersonRow {
  key: string;
  icon: typeof UserRound;
  label: string;
  value: string;
  effect: string;
  real: boolean;
}

export function PersonPanel({ patient, shapeSource }: { patient: Patient; shapeSource: string }) {
  const v = useViewer();
  const real = (kind: string) => patient.inputs.some((f) => f.kind === kind && !f.synthetic && f.status === "ok");

  const rows: PersonRow[] = [
    {
      key: "age",
      icon: UserRound,
      label: "Age",
      value: `${patient.age} years`,
      effect: "Sulcal widening. The surface blends toward the inflated one.",
      real: true,
    },
    {
      key: "sex",
      icon: Ruler,
      label: "Sex",
      value: patient.sex === "M" ? "Male" : "Female",
      effect: "Overall size, through the three scale factors.",
      real: true,
    },
    {
      key: "t1",
      icon: Ruler,
      label: "T1 regional volumes",
      value: real("t1") ? "From the upload" : "Synthetic",
      effect: "Local thickness. Each region moves along its own normal.",
      real: real("t1"),
    },
    {
      key: "injury",
      icon: Crosshair,
      label: "Injury",
      value: `${patient.injury.mechanism}, ${patient.injury.location}, ${patient.injury.angle_deg} deg, helmet ${patient.injury.helmet}`,
      effect: "Impact swelling at the marker, and the tract damage pattern.",
      real: real("injury"),
    },
    {
      key: "dna",
      icon: Dna,
      label: "Genotype and biomarkers",
      value: `APOE e4 ${patient.alleles.apoe_e4}, BDNF ${patient.alleles.bdnf_met ? "Met" : "Val"}, COMT ${patient.alleles.comt}, GFAP ${patient.biomarkers.gfap_z.toFixed(1)} z`,
      effect: "The healing layer and the uncertainty. Not the shape.",
      real: real("vcf"),
    },
  ];

  return (
    <div className="space-y-2">
      <ul className="space-y-1.5">
        {rows.map((r) => {
          const Icon = r.icon;
          const on = v.highlight === r.key;
          return (
            <li key={r.key}>
              <button
                type="button"
                onMouseEnter={() => v.setHighlight(r.key)}
                onMouseLeave={() => v.setHighlight(null)}
                onFocus={() => v.setHighlight(r.key)}
                onBlur={() => v.setHighlight(null)}
                aria-describedby={`shape-${r.key}`}
                className={`w-full rounded-xl border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  on ? "border-primary/50 bg-primary-soft" : "hover:bg-muted"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-xs font-bold">
                    <Icon className="h-3.5 w-3.5 text-primary" aria-hidden /> {r.label}
                  </span>
                  <span
                    className={`rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${
                      r.real
                        ? "border-primary/30 bg-primary-soft text-accent-foreground"
                        : "border-synthetic/50 bg-synthetic-soft text-synthetic-foreground"
                    }`}
                  >
                    {r.real ? "Real" : "Synthetic"}
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] text-muted-foreground">{r.value}</p>
                <p id={`shape-${r.key}`} className="mt-0.5 text-[11px]">
                  {r.effect}
                </p>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="rounded-xl border border-primary/30 bg-primary-soft px-3 py-2 text-[11px] font-bold text-accent-foreground">
        DNA changes the recovery forecast, not the anatomy.
      </p>
      <p className="text-[11px] text-muted-foreground">
        Mesh source: {shapeSource}. Hovering a row exaggerates that one input on the mesh so you can see what it does.
        The exaggeration is for clarity, the underlying numbers are the model's.
      </p>
    </div>
  );
}
