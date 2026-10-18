// The clinician only intervention what-if. A receptor weighted gain change run through the
// model and drawn on the mesh. It never touches the forecast, the alerts or anything a patient
// sees, and the banner on this panel says so permanently.

import { AlertOctagon, Play } from "lucide-react";
import { useIntervention, useReceptors } from "@/api/client";
import type { Intervention } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { receptorMap } from "./SidePanels";
import { RECEPTOR_TARGETS, useViewer, type ReceptorTarget } from "./viewerStore";

export function WhatIfBanner() {
  return (
    <p
      role="note"
      className="flex items-start gap-2 rounded-xl border-2 border-destructive bg-destructive-soft px-3 py-2 text-xs font-bold text-destructive"
    >
      <AlertOctagon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>Hypothetical what-if. Not a treatment recommendation. Not shown to patients.</span>
    </p>
  );
}

export function WhatIfPanel({
  patientId,
  result,
  onResult,
}: {
  patientId: string;
  result: Intervention | null;
  onResult: (r: Intervention | null) => void;
}) {
  const v = useViewer();
  const receptors = useReceptors();
  const run = useIntervention();

  const available = receptorMap(receptors.data?.maps, v.target) !== null;

  return (
    <div className="no-print space-y-4">
      <WhatIfBanner />

      <fieldset>
        <legend className="mb-2 text-xs font-bold">Receptor target</legend>
        <div className="flex flex-wrap gap-1.5">
          {RECEPTOR_TARGETS.map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={v.target === t}
              onClick={() => v.setWhatIf({ target: t as ReceptorTarget })}
              className={`rounded-full border px-3 py-1 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                v.target === t ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </fieldset>

      <label className="block">
        <span className="flex items-baseline justify-between text-xs font-bold">
          Gain change
          <span className="font-mono tabular-nums">
            {v.gain >= 0 ? "+" : ""}
            {Math.round(v.gain * 100)} percent
          </span>
        </span>
        <Slider
          className="mt-2"
          value={[Math.round(v.gain * 100)]}
          min={-50}
          max={50}
          step={5}
          onValueChange={([g]) => v.setWhatIf({ gain: g / 100 })}
          aria-label="Gain change in percent, from minus 50 to plus 50"
        />
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          onClick={() =>
            run.mutate(
              { id: patientId, target: v.target, gain: v.gain },
              { onSuccess: (r) => onResult(r) },
            )
          }
          disabled={run.isPending}
        >
          <Play aria-hidden /> {run.isPending ? "Running" : "Run what-if"}
        </Button>
        <label className="flex items-center gap-2 text-xs">
          <Switch checked={v.showReceptorMap} onCheckedChange={(c) => v.setWhatIf({ showReceptorMap: c })} aria-label="Show the receptor density map on the brain" />
          Show the {v.target} density map instead
        </label>
      </div>

      {!available && receptors.data && (
        <p className="text-[11px] text-synthetic-foreground">
          This atlas has no map named {v.target}, so the overlay falls back to the first map it does have.
        </p>
      )}

      {run.error && <p className="text-[11px] text-destructive">{run.error.message}</p>}

      {result && (
        <div className="space-y-2">
          <div className="grid grid-cols-3 gap-2">
            <Delta label="FC strength" value={result.summary_delta.fc_strength} />
            <Delta label="Mean rate" value={result.summary_delta.rate} />
            <Delta label="Metastability" value={result.summary_delta.metastability} />
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground">{result.note}</p>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            What you see on the brain is the modelled change in each region's firing rate, violet for down and teal for
            up. It is a visualization of a receptor weighted gain change, nothing more.
          </p>
          <button type="button" onClick={() => onResult(null)} className="text-[11px] text-primary underline-offset-4 hover:underline">
            Clear this result
          </button>
        </div>
      )}

      {receptors.data?.synthetic_template && (
        <p className="rounded-xl border border-synthetic/50 bg-synthetic-soft px-3 py-2 text-[11px] text-synthetic-foreground">
          The receptor maps are a smooth stand-in generated from a fixed seed, not real PET data.
        </p>
      )}
    </div>
  );
}

function Delta({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border p-2 text-center">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="font-mono text-sm font-bold tabular-nums">
        {value >= 0 ? "+" : ""}
        {value.toFixed(3)}
      </p>
    </div>
  );
}
