// The one reusable viewer. Everything three touches hangs off this file, so a page that
// imports it through React.lazy keeps three, drei and postprocessing out of the main chunk.

import { Canvas } from "@react-three/fiber";
import { Eye, Layers, Maximize2, Minimize2, Sparkles, Waves } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useFormulary, useMesh, usePathways, usePatient, useShape, useTwin, useVessels } from "@/api/client";
import type { Shape, Twin } from "@/api/types";
import { ErrorState, Loading } from "@/components/common";
import { cn } from "@/lib/utils";
import { Fallback2D } from "./Fallback2D";
import { Scene } from "./Scene";
import { detectCaps } from "./capabilities";
import { buildCortex } from "./geometry";
import { LAYER_BY_ID, layerIndex, rampColor, type LayerId } from "./layers";
import {
  REGIONS,
  layerValues,
  pickTracts,
  regionLabel,
  regionPoints,
  topLit,
  type LayerValues,
} from "./regionData";
import type { Focus } from "./Vessels";
import { useViewer, type HemiMode, type ViewPreset } from "./viewerStore";

export interface BrainViewerProps {
  patientId: string;
  /** Overrides the shared week. Left out on the twin screen so the scrubber owns it. */
  week?: number;
  layer?: LayerId;
  compact?: boolean;
  height?: number;
  /** Set on the compare screen so two canvases share one camera. */
  syncId?: string;
  /** Scenario overrides. */
  damageScale?: number;
  /** Turns the impact point this many degrees about the superior axis. */
  impactTurnDeg?: number;
  effect?: number[] | null;
  weights?: number[] | null;
  recoveryMult?: number;
  /** Replaces the computed layer values outright, which the difference toggle uses. */
  valuesOverride?: LayerValues | null;
  caption?: string;
  /** Slow automatic rotation. Used by the landing page.  */
  spin?: boolean;
  /** Drops every overlay except one honesty label, so the brain can be the whole frame. */
  bare?: boolean;
  /** Fill the parent instead of using a fixed height. The workspace column drives it. */
  fill?: boolean;
  /** Hide the viewer's own preset row when the page supplies its own. */
  presets?: boolean;
  /** Draw the brain as first built instead of the current one. The Baseline toggle. */
  baselineTwin?: Twin | null;
  /** Region ids the last check-in moved, marked so the change is visible on the mesh. */
  markRegions?: number[];
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Scales a damage style layer for a scenario that was run with a different helmet. */
function scaleValues(values: LayerValues, k: number): LayerValues {
  if (k === 1) return values;
  const out: LayerValues = {
    pos: new Float32Array(REGIONS),
    glow: new Float32Array(REGIONS),
    shimmer: new Float32Array(REGIONS),
    raw: new Float32Array(REGIONS),
    format: values.format,
    empty: values.empty,
  };
  for (let i = 0; i < REGIONS; i++) {
    out.raw[i] = values.raw[i] * k;
    out.pos[i] = clamp01(values.pos[i] * k);
    out.glow[i] = clamp01(values.glow[i] * k);
    out.shimmer[i] = clamp01(values.shimmer[i] * k);
  }
  return out;
}

/** Spins the impact point about the superior axis so a scenario angle lands somewhere else. */
function turnImpact(shape: Shape | undefined, turnDeg: number): Shape | undefined {
  if (!shape?.impact?.point) return shape;
  const turn = (turnDeg * Math.PI) / 180;
  if (Math.abs(turn) < 1e-6) return shape;
  const [x, y, z] = shape.impact.point;
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  return { ...shape, impact: { ...shape.impact, point: [x * cos - y * sin, x * sin + y * cos, z] } };
}

const PRESETS: { id: ViewPreset; label: string }[] = [
  { id: "left", label: "Left" },
  { id: "right", label: "Right" },
  { id: "top", label: "Top" },
  { id: "front", label: "Front" },
];

const HEMIS: { id: HemiMode; label: string }[] = [
  { id: "both", label: "Both" },
  { id: "split", label: "Split" },
  { id: "L", label: "Left" },
  { id: "R", label: "Right" },
];

export default function BrainViewer(props: BrainViewerProps) {
  const { patientId, compact = false, height, syncId, caption, spin = false, bare = false,
          fill = false, presets = true } = props;
  const mesh = useMesh();
  const shape = useShape(patientId);
  const live = useTwin(patientId);
  // One swap, here, so every layer, tract, callout and ranked list below reads whichever
  // brain the toggle is on without any of them needing to know the toggle exists.
  const twin = props.baselineTwin
    ? { ...live, data: props.baselineTwin }
    : live;
  const patient = usePatient(patientId);
  const v = useViewer();
  // Only fetched when the layer is on. It is 11 KB of polylines and most sessions never
  // turn it on, so there is no reason to pull it down on every workspace load.
  const vessels = useVessels(v.vessels);
  // The transmitter pathways for whichever medicines are lit in the Treatment tab. Only
  // fetched when something is lit, because with nothing on there is nothing to draw.
  const pathways = usePathways();
  const formulary = useFormulary();
  const pathwayGroups = useMemo(() => {
    const book = formulary.data?.drugs ?? [];
    const on = new Set(v.drugs);
    const out = new Set<string>();
    for (const d of book) {
      if (on.has(d.name)) for (const g of d.pathways) out.add(g);
    }
    return [...out];
  }, [formulary.data, v.drugs]);
  const caps = useMemo(() => detectCaps(), []);
  const [big, setBig] = useState(false);

  const week = props.week ?? v.week;
  const layer = props.layer ?? v.layer;
  const damageScale = props.damageScale ?? 1;

  const liveShape = useMemo(() => turnImpact(shape.data, props.impactTurnDeg ?? 0), [shape.data, props.impactTurnDeg]);

  const cortex = useMemo(() => (mesh.data ? buildCortex(mesh.data, liveShape) : null), [mesh.data, liveShape]);
  useEffect(() => {
    const geometry = cortex?.geometry;
    return () => {
      // The BVH holds its own typed arrays, so disposing the geometry alone leaks them.
      geometry?.disposeBoundsTree?.();
      geometry?.dispose();
    };
  }, [cortex]);

  const points = useMemo(() => regionPoints(mesh.data, twin.data), [mesh.data, twin.data]);

  const base = useMemo(
    () =>
      layerValues(layer, {
        twin: twin.data,
        week,
        effect: props.effect,
        weights: props.weights,
        recoveryMult: props.recoveryMult,
      }),
    [layer, twin.data, week, props.effect, props.weights, props.recoveryMult],
  );
  const scaled = useMemo(
    () => (layer === "damage" || layer === "uncertainty" ? scaleValues(base, damageScale) : base),
    [base, damageScale, layer],
  );
  const values = props.valuesOverride ?? scaled;

  const ghost = useMemo(
    () =>
      scaleValues(
        layerValues(layer, {
          twin: twin.data,
          week: 0,
          effect: props.effect,
          weights: props.weights,
          recoveryMult: props.recoveryMult,
        }),
        layer === "damage" || layer === "uncertainty" ? damageScale : 1,
      ),
    [layer, twin.data, props.effect, props.weights, props.recoveryMult, damageScale],
  );

  const tracts = useMemo(() => {
    const picked = pickTracts(twin.data, 200);
    if (damageScale === 1) return picked;
    return picked.map((t) => ({
      ...t,
      damage: t.damage.map((d) => clamp01(d * damageScale)),
      damageW0: clamp01(t.damageW0 * damageScale),
    }));
  }, [twin.data, damageScale]);

  const ranked = useMemo(() => topLit(values, 5), [values]);

  // SWI microhaemorrhage foci, placed inside the contusion the report localised.
  //
  // The report gives a count and a lobe, not coordinates, so the positions are spread
  // around the impact point rather than measured. That is why they are only drawn when
  // the vessel layer is on and why the layer's caption covers them: a node here says
  // "the report counted this many foci in this region", not "a focus is here".
  const foci = useMemo<Focus[]>(() => {
    const n = patient.data?.injury?.swi_foci ?? 0;
    const at = liveShape?.impact?.point;
    if (!n || !at) return [];
    const spread = (liveShape?.impact?.radius || 25) * 0.45;
    return Array.from({ length: Math.min(12, n) }, (_, i) => {
      // Deterministic from the index, so the same report draws the same nodes every time
      // rather than scattering them again on every render.
      const a = (i * 2.399963) % (Math.PI * 2);
      const r = spread * (0.35 + 0.5 * ((i * 0.618) % 1));
      return {
        at: [at[0] + r * Math.cos(a), at[1] + r * Math.sin(a), at[2] + r * 0.4 * Math.sin(a * 1.7)] as [number, number, number],
        mm: 2 + (i % 2),
      };
    });
  }, [patient.data, liveShape]);

  const readout = v.hovered ?? v.selected;
  const def = LAYER_BY_ID[layer];
  const placeholder = !!mesh.data && mesh.data.source !== "fsaverage6";
  const stageHeight = height ?? (compact ? 300 : 460);

  if (mesh.isLoading || twin.isLoading) return <Loading label="Loading the cortical surface" />;
  if (mesh.error || !mesh.data) return <ErrorState error={mesh.error} onRetry={() => mesh.refetch()} />;
  if (!cortex) return <ErrorState error={new Error("The mesh payload had no vertices.")} />;

  if (!caps.webgl || !caps.floatTex) {
    return (
      <Fallback2D
        mesh={mesh.data}
        twin={twin.data}
        layer={layer}
        values={values}
        reason={caps.reason}
        selected={v.selected}
        onSelect={v.setSelected}
      />
    );
  }

  return (
    <div
      className={cn(
        "workspace-visual relative overflow-hidden",
        bare ? "bg-transparent" : "bg-[#e4e4e0]",
        // `bare` is the landing page, where the canvas is the whole frame. A border and
        // a corner radius there draw a box around what is meant to be the background.
        !bare && "rounded-xl border border-[#c9c9c4]",
        big && "fixed inset-4 z-50",
      )}
      style={big ? undefined : bare || fill ? { height: "100%" } : { height: stageHeight }}
    >
      <Canvas
        dpr={[1, 1.75]}
        // The hero is transparent so the brain sits on the page rather than in a box.
        // Everywhere else keeps an opaque buffer, which is cheaper.
        gl={{ antialias: !compact, alpha: bare, powerPreference: "high-performance" }}
        camera={{ fov: 34, near: 1, far: 4000, position: [-240, 90, -160] }}
        style={{ touchAction: "pan-y", background: "transparent" }}
      >
        {!bare && <color attach="background" args={["#e4e4e0"]} />}
        <Scene
          cortex={cortex}
          mesh={mesh.data}
          twin={twin.data}
          shape={liveShape}
          points={points}
          tracts={tracts}
          values={values}
          ghost={ghost}
          layerIdx={layerIndex(layer)}
          week={week}
          ranked={ranked}
          compact={compact}
          syncId={syncId ?? null}
          spin={spin}
          vessels={vessels.data}
          pathways={pathways.data}
          pathwayGroups={pathwayGroups}
          foci={foci}
        />
      </Canvas>

      <div
        className="pointer-events-none absolute inset-0"
        style={{ boxShadow: "none" }}
        aria-hidden
      />

      {/* The surface space, the shape source and the "model output" line all used to sit
          here as permanent chips. They say the same thing on every frame of every
          patient, so they stopped being read; they live in the Evidence drawer now. What
          is left is the failure case, which is not permanent and does change what you
          should believe, plus any caption a layer asks for. */}
      {!bare && (placeholder || caption) && (
      <div className="pointer-events-none absolute left-3 top-3 flex max-w-[55%] flex-wrap items-center gap-1.5 text-[10px] font-bold">
        {placeholder && (
          <span className="rounded-full border border-synthetic/60 bg-synthetic-soft/90 px-2 py-0.5 text-synthetic-foreground">
            Placeholder mesh
          </span>
        )}
        {caption && <span className="rounded-full border border-white/20 bg-black/60 px-2 py-0.5 text-white">{caption}</span>}
      </div>
      )}

      {!bare && (
      <div className="absolute right-3 top-3 flex flex-col items-end gap-1.5">
        {presets && (!compact || syncId) && (
          <div className="flex gap-1 rounded-full border border-cyan-300/25 bg-black/60 p-1" role="group" aria-label="Preset views">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => v.setPreset(p.id)}
                className="rounded-full px-2 py-0.5 text-[10px] font-bold text-cyan-100 hover:bg-cyan-400/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
              >
                {p.label}
              </button>
            ))}
          </div>
        )}
        {!compact && (
          <>
            <div className="flex gap-1 rounded-full border border-cyan-300/25 bg-black/60 p-1" role="group" aria-label="Hemispheres">
              {HEMIS.map((h) => (
                <button
                  key={h.id}
                  type="button"
                  aria-pressed={v.hemi === h.id}
                  onClick={() => v.setHemi(h.id)}
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[10px] font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300",
                    v.hemi === h.id ? "bg-cyan-300 text-cyan-950" : "text-cyan-100 hover:bg-cyan-400/20",
                  )}
                >
                  {h.label}
                </button>
              ))}
            </div>
            <div className="flex gap-1 rounded-full border border-cyan-300/25 bg-black/60 p-1">
              <StageToggle
                on={v.hologram}
                label={v.hologram ? "Hologram on" : "Hologram off"}
                icon={<Sparkles className="h-3 w-3" aria-hidden />}
                onClick={() => v.setFlag({ hologram: !v.hologram })}
              />
              <StageToggle
                on={!v.reduceMotion}
                label={v.reduceMotion ? "Motion reduced" : "Motion on"}
                icon={<Waves className="h-3 w-3" aria-hidden />}
                onClick={() => v.setFlag({ reduceMotion: !v.reduceMotion })}
              />
              <StageToggle
                on={v.tracts}
                label={v.tracts ? "Tracts on" : "Tracts off"}
                icon={<Layers className="h-3 w-3" aria-hidden />}
                onClick={() => v.setFlag({ tracts: !v.tracts })}
              />
              <StageToggle
                on={v.borders}
                label={v.borders ? "Borders on" : "Borders off"}
                icon={<Eye className="h-3 w-3" aria-hidden />}
                onClick={() => v.setFlag({ borders: !v.borders })}
              />
              <StageToggle
                on={big}
                label={big ? "Shrink viewer" : "Expand viewer"}
                icon={big ? <Minimize2 className="h-3 w-3" aria-hidden /> : <Maximize2 className="h-3 w-3" aria-hidden />}
                onClick={() => setBig(!big)}
              />
            </div>
          </>
        )}
      </div>
      )}

      {!bare && (
      <div className="pointer-events-none absolute bottom-3 left-3 max-w-[60%] text-[11px] text-cyan-50">
        {readout !== null && readout !== undefined ? (
          <div className="rounded-lg border border-cyan-300/30 bg-black/70 px-2.5 py-1.5">
            <p className="font-bold capitalize">{regionLabel(mesh.data, twin.data, readout).plain}</p>
            <p className="font-mono text-[10px] text-cyan-200">
              <span
                className="mr-1 inline-block h-2 w-2 rounded-full align-middle"
                style={{ background: rampColor(def.stops, values.pos[readout]) }}
                aria-hidden
              />
              {def.label}: {values.format(values.raw[readout])}
            </p>
          </div>
        ) : (
          <p className="rounded-lg bg-black/50 px-2 py-1 text-cyan-200/80">Drag to rotate. Click a region to pin it.</p>
        )}
      </div>
      )}

      {shape.error && (
        <p className="pointer-events-none absolute bottom-10 right-3 text-[10px] text-synthetic">
          Shape parameters unavailable, showing the template surface.
        </p>
      )}
    </div>
  );
}

function StageToggle({ on, label, icon, onClick }: { on: boolean; label: string; icon: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      title={label}
      aria-label={label}
      className={cn(
        "flex h-6 w-6 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300",
        on ? "bg-cyan-300 text-cyan-950" : "text-cyan-100/70 hover:bg-cyan-400/20",
      )}
    >
      {icon}
    </button>
  );
}
