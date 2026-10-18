// C3 Brain twin. The holographic cortical viewer, its layer switcher, the week scrubber and
// every reading panel that goes with them.

import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { useAttribution, useForecast, useLoadings, useMesh, useReceptors, useShape, useTwin } from "@/api/client";
import type { Intervention } from "@/api/types";
import { Loading, ModelLabel, Panel, SyntheticBadge } from "@/components/common";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AttributionPanel,
  CounterfactualPanel,
  DamageTimeline,
  LayerSwitcher,
  PersonPanel,
  RegionPanel,
  ReplayControls,
  ShapeControls,
  TractPanel,
  WeekScrubber,
  WhatIfPanel,
  WhereItHurts,
  layerValues,
  receptorMap,
  useViewer,
  weightsFromAttribution,
  type LayerId,
} from "@/components/brain";
import { usePatientContext } from "./PatientLayout";

const BrainViewer = lazy(() => import("@/components/brain/BrainViewer"));

/** Min-max scales a receptor z map into 0 to 1, the way the backend scales it before using it. */
function scaleMap(values: number[] | null): number[] | null {
  if (!values || values.length === 0) return null;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  return values.map((v) => (v - lo) / span);
}

export default function PatientTwin() {
  const { patient } = usePatientContext();
  const v = useViewer();
  const mesh = useMesh();
  const shape = useShape(patient.id);
  const twin = useTwin(patient.id);
  const forecast = useForecast(patient.id);
  const attribution = useAttribution(patient.id);
  const loadings = useLoadings();
  const receptors = useReceptors();
  const [whatIf, setWhatIf] = useState<Intervention | null>(null);

  /** Opens on the week the patient is actually in, once per patient, then leaves it alone. */
  const opened = useRef<string | null>(null);
  const setWeek = v.setWeek;
  useEffect(() => {
    if (opened.current === patient.id) return;
    opened.current = patient.id;
    setWeek(patient.week);
  }, [patient.id, patient.week, setWeek]);

  const signals = useMemo(() => {
    if (loadings.data?.signals?.length) return loadings.data.signals;
    return (attribution.data ?? []).map((a) => a.signal);
  }, [loadings.data, attribution.data]);

  const signal = v.signal ?? signals[0] ?? null;

  const weights = useMemo(() => {
    if (!signal) return null;
    const fromLoadings = loadings.data?.weights?.[signal];
    if (fromLoadings) return fromLoadings;
    return weightsFromAttribution(twin.data, attribution.data, signal);
  }, [signal, loadings.data, attribution.data, twin.data]);

  const overlay = v.layer === "intervention" && v.showReceptorMap;
  const overlayWeights = useMemo(
    () => (overlay ? scaleMap(receptorMap(receptors.data?.maps, v.target)) : null),
    [overlay, receptors.data, v.target],
  );

  const measuredThrough = useMemo(() => {
    let last = -1;
    for (const s of forecast.data?.signals ?? []) {
      for (const o of s.obs) last = Math.max(last, o.week);
    }
    return last;
  }, [forecast.data]);

  const values = useMemo(
    () =>
      layerValues(v.layer, {
        twin: twin.data,
        week: v.week,
        effect: whatIf?.region_effect ?? null,
        weights,
        recoveryMult: v.cfOn ? v.recoveryMult : 1,
      }),
    [v.layer, twin.data, v.week, whatIf, weights, v.cfOn, v.recoveryMult],
  );

  const disabled: Partial<Record<LayerId, string>> = {};
  if (!whatIf) disabled.intervention = "Run the what-if tab below to light this layer.";
  if (!weights) disabled.drivers = "No signal to region loadings and no attribution yet.";

  return (
    <div className="space-y-5">
      <Panel
        title="Brain twin"
        subtitle={`Week ${Math.round(v.week)} of 12. One cortical surface, eight layers, twelve weeks of forecast.`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <SyntheticBadge />
            <ModelLabel />
          </div>
        }
      >
        <div className="grid gap-5 xl:grid-cols-[210px_minmax(0,1fr)_300px]">
          <div className="space-y-5">
            <LayerSwitcher
              layer={v.layer}
              onLayer={v.setLayer}
              hidden={["difference"]}
              disabled={disabled}
              signals={signals}
              signal={signal}
              onSignal={v.setSignal}
              values={values}
            />
            <ShapeControls />
          </div>

          <div className="min-w-0 space-y-4">
            <Suspense fallback={<Loading label="Loading the viewer" />}>
              <BrainViewer
                patientId={patient.id}
                layer={overlay ? "drivers" : undefined}
                weights={overlay ? overlayWeights : weights}
                effect={whatIf?.region_effect ?? null}
                recoveryMult={v.cfOn ? v.recoveryMult : 1}
                caption={overlay ? `${v.target} density` : undefined}
              />
            </Suspense>
            <WeekScrubber measuredThrough={measuredThrough} />
            <DamageTimeline twin={twin.data} measuredThrough={measuredThrough} />
            <ReplayControls />
          </div>

          <div className="min-w-0">
            <Tabs defaultValue="region">
              <TabsList className="grid h-auto w-full grid-cols-2 gap-1">
                <TabsTrigger value="region">Region</TabsTrigger>
                <TabsTrigger value="hurts">Where it hurts</TabsTrigger>
                <TabsTrigger value="tracts">Tracts</TabsTrigger>
                <TabsTrigger value="person">Person</TabsTrigger>
              </TabsList>
              <TabsContent value="region" className="mt-3">
                <RegionPanel mesh={mesh.data} twin={twin.data} week={v.week} layer={v.layer} values={values} />
              </TabsContent>
              <TabsContent value="hurts" className="mt-3 space-y-2">
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  The five regions carrying the most damage at week {Math.round(v.week)}, in plain language. Area tags
                  are approximate: these are network parcels, not anatomical ones.
                </p>
                <WhereItHurts mesh={mesh.data} twin={twin.data} week={v.week} onPick={v.setSelected} />
              </TabsContent>
              <TabsContent value="tracts" className="mt-3">
                <TractPanel twin={twin.data} week={v.week} />
              </TabsContent>
              <TabsContent value="person" className="mt-3">
                <PersonPanel
                  patient={patient}
                  shapeSource={`${mesh.data?.source ?? "unknown"} surface, ${shape.data?.source ?? "synthetic"} shape parameters`}
                />
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </Panel>

      <Tabs defaultValue="attribution">
        <TabsList className="flex h-auto w-full flex-wrap">
          <TabsTrigger value="attribution">Tract attribution</TabsTrigger>
          <TabsTrigger value="counterfactual">Counterfactual</TabsTrigger>
          <TabsTrigger value="whatif" className="no-print">
            Intervention what-if
          </TabsTrigger>
        </TabsList>
        <TabsContent value="attribution" className="mt-3">
          <Panel title="Which tracts drive which signal" subtitle="Ranked per signal from the model's own sensitivity.">
            <AttributionPanel patientId={patient.id} />
          </Panel>
        </TabsContent>
        <TabsContent value="counterfactual" className="mt-3">
          <Panel title="Counterfactual" subtitle="What the same twin would have done with a different recovery rate.">
            <CounterfactualPanel patientId={patient.id} baseline={forecast.data} />
          </Panel>
        </TabsContent>
        <TabsContent value="whatif" className="mt-3 no-print">
          <Panel title="Intervention what-if" subtitle="Clinician only. A visualization of receptor weighted gain changes.">
            <WhatIfPanel
              patientId={patient.id}
              result={whatIf}
              onResult={(r) => {
                setWhatIf(r);
                if (r) v.setLayer("intervention");
              }}
            />
          </Panel>
        </TabsContent>
      </Tabs>
    </div>
  );
}
