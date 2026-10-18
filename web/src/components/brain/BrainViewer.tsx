// The one reusable viewer. Everything three touches hangs off this file, so a page that
// imports it through React.lazy keeps three, drei and postprocessing out of the main chunk.

import { Canvas } from "@react-three/fiber";
import { Eye, FlaskConical, Info, Layers, Maximize2, Minimize2, Sparkles, Waves } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMesh, useShape, useTwin } from "@/api/client";
import type { Shape } from "@/api/types";
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
  const { patientId, compact = false, height, syncId, caption } = props;
  const mesh = useMesh();
  const shape = useShape(patientId);
  const twin = useTwin(patientId);
  const v = useViewer();
  const caps = useMemo(() => detectCaps(), []);
  const [big, setBig] = useState(false);

  const week = props.week ?? v.week;
  const layer = props.layer ?? v.layer;
  const damageScale = props.damageScale ?? 1;

  const liveShape = useMemo(() => turnImpact(shape.data, props.impactTurnDeg ?? 0), [shape.data, props.impactTurnDeg]);

  const cortex = useMemo(() => (mesh.data ? buildCortex(mesh.data, liveShape) : null), [mesh.data, liveShape]);
  useEffect(() => {
    const geometry = cortex?.geometry;
    return () => geometry?.dispose();
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
        "workspace-visual relative overflow-hidden rounded-xl border border-[#c9c9c4] bg-[#e4e4e0]",
        big && "fixed inset-4 z-50",
      )}
      style={big ? undefined : { height: stageHeight }}
    >
      <Canvas
        dpr={[1, 1.75]}
        gl={{ antialias: !compact, alpha: false, powerPreference: "high-performance" }}
        camera={{ fov: 34, near: 1, far: 4000, position: [-240, 90, -160] }}
        style={{ touchAction: "pan-y" }}
      >
        <color attach="background" args={["#e4e4e0"]} />
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
        />
      </Canvas>

      <div
        className="pointer-events-none absolute inset-0"
        style={{ boxShadow: "none" }}
        aria-hidden
      />

      <div className="pointer-events-none absolute left-3 top-3 flex max-w-[55%] flex-wrap items-center gap-1.5 text-[10px] font-bold">
        <span
          className={cn(
            "rounded-full border px-2 py-0.5",
            placeholder
              ? "border-synthetic/60 bg-synthetic-soft/90 text-synthetic-foreground"
              : "border-cyan-300/40 bg-cyan-950/70 text-cyan-100",
          )}
        >
          {placeholder ? "Placeholder mesh" : "fsaverage6 surface"}
        </span>
        <span className="rounded-full border border-synthetic/50 bg-synthetic-soft/90 px-2 py-0.5 text-synthetic-foreground">
          <FlaskConical className="mr-1 inline h-2.5 w-2.5" aria-hidden />
          {liveShape?.source === "freesurfer" ? "Own surface" : "Synthetic shape"}
        </span>
        {caption && <span className="rounded-full border border-white/20 bg-black/60 px-2 py-0.5 text-white">{caption}</span>}
      </div>

      <div className="absolute right-3 top-3 flex flex-col items-end gap-1.5">
        {(!compact || syncId) && (
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

      <p className="pointer-events-none absolute bottom-3 right-3 flex items-center gap-1 text-[10px] text-cyan-200/80">
        <Info className="h-3 w-3" aria-hidden /> Model output, not a scan
      </p>

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
