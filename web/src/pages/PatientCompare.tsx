// C4 Scenario compare. Two brains side by side on one camera, one week and one layer, each with
// its own helmet and impact angle, plus the forecasts and the diff the scenario route returns.

import { ArrowLeftRight, Play } from "lucide-react";
import { Suspense, lazy, useMemo, useState } from "react";
import { useForecast, useMesh, useScenarios, useTwin } from "@/api/client";
import type { Scenario, ScenarioResult } from "@/api/types";
import { Empty, Loading, ModelLabel, Panel, SyntheticBadge } from "@/components/common";
import { SignalChart } from "@/components/charts/SignalChart";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  DamageTimeline,
  LayerSwitcher,
  REGIONS,
  WeekScrubber,
  atWeek,
  layerValues,
  useViewer,
  type LayerId,
} from "@/components/brain";
import { usePatientContext } from "./PatientLayout";

const BrainViewer = lazy(() => import("@/components/brain/BrainViewer"));

const HELMETS = ["A", "B", "None"];

/** Reads a damage scale out of the diff rows, whichever row carries one. */
function scaleFromDiff(result: ScenarioResult | null): [number, number] | null {
  if (!result) return null;
  for (const row of result.diff) {
    if (!/damage|scale|severity/i.test(row.param)) continue;
    const a = Number.parseFloat(row.a);
    const b = Number.parseFloat(row.b);
    if (Number.isNaN(a) || Number.isNaN(b)) continue;
    const top = Math.max(Math.abs(a), Math.abs(b)) || 1;
    return [a / top, b / top];
  }
  return null;
}

function ScenarioCard({
  title,
  scenario,
  onChange,
}: {
  title: string;
  scenario: Scenario;
  onChange: (s: Scenario) => void;
}) {
  return (
    <div className="space-y-3 rounded-xl border p-3">
      <p className="text-xs font-extrabold">{title}</p>
      <div className="flex gap-1.5" role="group" aria-label={`${title} helmet`}>
        {HELMETS.map((h) => (
          <button
            key={h}
            type="button"
            aria-pressed={scenario.helmet === h}
            onClick={() => onChange({ ...scenario, helmet: h })}
            className={`rounded-full border px-3 py-1 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              scenario.helmet === h ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted"
            }`}
          >
            Helmet {h}
          </button>
        ))}
      </div>
      <label className="block">
        <span className="flex items-baseline justify-between text-xs font-bold">
          Impact angle
          <span className="font-mono tabular-nums">{scenario.angle_deg} deg</span>
        </span>
        <Slider
          className="mt-2"
          value={[scenario.angle_deg]}
          min={0}
          max={180}
          step={5}
          onValueChange={([a]) => onChange({ ...scenario, angle_deg: a })}
          aria-label={`${title} impact angle in degrees`}
        />
      </label>
    </div>
  );
}

export default function PatientCompare() {
  const { patient } = usePatientContext();
  const v = useViewer();
  const mesh = useMesh();
  const twin = useTwin(patient.id);
  const forecast = useForecast(patient.id);
  const run = useScenarios();

  const [a, setA] = useState<Scenario>({ helmet: patient.injury.helmet || "A", angle_deg: patient.injury.angle_deg });
  const [b, setB] = useState<Scenario>({ helmet: "None", angle_deg: Math.min(180, patient.injury.angle_deg + 60) });
  const [result, setResult] = useState<ScenarioResult | null>(null);

  const scales = scaleFromDiff(result);
  const scaleA = scales ? scales[0] : 1;
  const scaleB = scales ? scales[1] : 1;

  const diffWeights = useMemo(() => {
    if (!twin.data) return null;
    const out = new Array<number>(REGIONS).fill(0);
    twin.data.regions.forEach((r) => {
      if (r.id < 0 || r.id >= REGIONS) return;
      const d = atWeek(r.damage, v.week);
      out[r.id] = d * scaleB - d * scaleA;
    });
    return out;
  }, [twin.data, v.week, scaleA, scaleB]);

  const diffValues = useMemo(
    () => layerValues("difference", { twin: twin.data, week: v.week, weights: diffWeights }),
    [twin.data, v.week, diffWeights],
  );

  const sideValues = useMemo(
    () => layerValues(v.diffMode && scales ? "difference" : v.layer, { twin: twin.data, week: v.week, weights: diffWeights }),
    [v.diffMode, scales, v.layer, twin.data, v.week, diffWeights],
  );

  const signals = forecast.data?.signals ?? [];
  const [signalKey, setSignalKey] = useState<string | null>(null);
  const key = signalKey ?? signals[0]?.key ?? null;
  const aSignal = result?.a.signals.find((s) => s.key === key);
  const bSignal = result?.b.signals.find((s) => s.key === key);

  const measured = -1;
  const hidden: LayerId[] = ["difference", "intervention", "drivers"];

  const swap = () => {
    setA(b);
    setB(a);
    setResult(null);
  };

  return (
    <div className="space-y-5">
      <Panel
        title="Scenarios"
        subtitle="Two counterfactual injuries through the same twin. One camera, one week, one layer, so the only thing that changes between the two brains is the scenario."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <SyntheticBadge />
            <ModelLabel />
          </div>
        }
      >
        <div className="grid gap-5 xl:grid-cols-[210px_minmax(0,1fr)]">
          <div className="space-y-4">
            <LayerSwitcher layer={v.layer} onLayer={v.setLayer} hidden={hidden} values={sideValues} />
            <ScenarioCard title="Scenario A" scenario={a} onChange={(s) => { setA(s); setResult(null); }} />
            <ScenarioCard title="Scenario B" scenario={b} onChange={(s) => { setB(s); setResult(null); }} />
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={() => run.mutate({ id: patient.id, a, b }, { onSuccess: setResult })}
                disabled={run.isPending}
              >
                <Play aria-hidden /> {run.isPending ? "Running" : "Run both"}
              </Button>
              <Button size="sm" variant="outline" onClick={swap}>
                <ArrowLeftRight aria-hidden /> Swap
              </Button>
            </div>
            <label className="flex items-start justify-between gap-3 text-xs">
              <span>
                <span className="font-bold">Difference on brain B</span>
                <span className="block text-[11px] text-muted-foreground">
                  Shows B minus A damage instead of B's own layer.
                </span>
              </span>
              <Switch
                checked={v.diffMode}
                onCheckedChange={v.setDiffMode}
                disabled={!scales}
                aria-label="Show the damage difference on brain B"
              />
            </label>
            {!scales && (
              <p className="text-[11px] text-muted-foreground">
                Run both scenarios to get a damage scale per side. Until then both brains show this patient's own
                damage, with only the impact angle differing.
              </p>
            )}
            {run.error && <p className="text-[11px] text-destructive">{run.error.message}</p>}
          </div>

          <div className="min-w-0 space-y-4">
            <div className="grid gap-3 lg:grid-cols-2">
              <Suspense fallback={<Loading label="Loading the viewer" />}>
                <BrainViewer
                  patientId={patient.id}
                  compact
                  syncId="compare-a"
                  damageScale={scaleA}
                  impactTurnDeg={a.angle_deg - patient.injury.angle_deg}
                  caption={`A: helmet ${a.helmet}, ${a.angle_deg} deg`}
                />
              </Suspense>
              <Suspense fallback={<Loading label="Loading the viewer" />}>
                <BrainViewer
                  patientId={patient.id}
                  compact
                  syncId="compare-b"
                  damageScale={scaleB}
                  impactTurnDeg={b.angle_deg - patient.injury.angle_deg}
                  layer={v.diffMode && scales ? "difference" : undefined}
                  valuesOverride={v.diffMode && scales ? diffValues : null}
                  caption={
                    v.diffMode && scales ? "B minus A damage" : `B: helmet ${b.helmet}, ${b.angle_deg} deg`
                  }
                />
              </Suspense>
            </div>
            <WeekScrubber measuredThrough={measured} />
            <DamageTimeline twin={twin.data} measuredThrough={measured} />
            <p className="text-[11px] text-muted-foreground">
              Dragging either brain turns both. Mesh source: {mesh.data?.source ?? "loading"}.
            </p>
          </div>
        </div>
      </Panel>

      <Panel title="Forecasts" subtitle="The same signal under both scenarios, each with its own 80 percent band.">
        {!result ? (
          <Empty>Run both scenarios to see their forecasts.</Empty>
        ) : (
          <div className="space-y-3">
            {signals.length > 1 && (
              <label className="block max-w-xs">
                <span className="text-[11px] font-bold">Signal</span>
                <select
                  value={key ?? ""}
                  onChange={(e) => setSignalKey(e.target.value)}
                  className="mt-1 h-9 w-full rounded-md border border-input bg-transparent px-2 text-xs"
                >
                  {signals.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="grid gap-4 lg:grid-cols-2">
              {aSignal && (
                <div>
                  <p className="mb-1 text-xs font-extrabold">
                    Scenario A, helmet {a.helmet}, {a.angle_deg} deg
                  </p>
                  <SignalChart signal={aSignal} weeks={result.a.weeks} week={Math.round(v.week)} />
                </div>
              )}
              {bSignal && (
                <div>
                  <p className="mb-1 text-xs font-extrabold">
                    Scenario B, helmet {b.helmet}, {b.angle_deg} deg
                  </p>
                  <SignalChart signal={bSignal} weeks={result.b.weeks} week={Math.round(v.week)} />
                </div>
              )}
            </div>
          </div>
        )}
      </Panel>

      <Panel title="What differs" subtitle="Only the parameters the two runs did not share.">
        {!result ? (
          <Empty>Run both scenarios to see the diff.</Empty>
        ) : result.diff.length === 0 ? (
          <Empty>Both scenarios came out identical.</Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Parameter</TableHead>
                <TableHead>Scenario A</TableHead>
                <TableHead>Scenario B</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.diff.map((row) => (
                <TableRow key={row.param}>
                  <TableCell className="font-bold">{row.param}</TableCell>
                  <TableCell className="font-mono">{row.a}</TableCell>
                  <TableCell className="font-mono">{row.b}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>
    </div>
  );
}
