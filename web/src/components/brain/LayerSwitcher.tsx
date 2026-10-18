// The layer list down the left of the stage. Every layer carries a legend with real numbers and
// a one line meaning, so colour is never the only thing telling you what you are looking at.

import { FlaskConical, Info, Lock } from "lucide-react";
import { LAYERS, LAYER_BY_ID, rampGradient, type LayerId } from "./layers";
import type { LayerValues } from "./regionData";

interface Props {
  layer: LayerId;
  onLayer: (id: LayerId) => void;
  /** Layers that have no data yet, shown greyed with the reason. */
  disabled?: Partial<Record<LayerId, string>>;
  /** Hidden entirely, which is how print and export drop the what-if. */
  hidden?: LayerId[];
  signals?: string[];
  signal?: string | null;
  onSignal?: (s: string) => void;
  /** Lets the legend print the real numbers for a layer that scales to this patient. */
  values?: LayerValues;
}

/** Tick labels for a layer that scales to the patient, so the bright end names a real number. */
function scaledTicks(layer: LayerId, top: number): string[] {
  if (layer === "damage") return ["0", (top / 2).toFixed(2), `${top.toFixed(2)} peak`];
  if (layer === "uncertainty") return ["tight", `${top.toFixed(2)} wide`];
  return [`-${top.toFixed(2)}`, "same", `+${top.toFixed(2)}`];
}

export function Legend({ layer, values }: { layer: LayerId; values?: LayerValues }) {
  const def = LAYER_BY_ID[layer];
  const top = values?.scaleTop;
  const labels = top ? scaledTicks(layer, top) : def.ticks.map((t) => t.label);
  return (
    <div>
      <div
        className="h-2 w-full rounded-full border border-border"
        style={{ background: rampGradient(def.stops) }}
        role="img"
        aria-label={`${def.label} colour scale from ${labels[0]} to ${labels[labels.length - 1]}`}
      />
      <div className="mt-1 flex justify-between font-mono text-[10px] text-muted-foreground">
        {labels.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
      {top !== undefined && (
        <p className="mt-1 text-[10px] text-muted-foreground">Scaled to this patient's own range, not a fixed 0 to 1.</p>
      )}
      <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{def.meaning}</p>
      {def.note && (
        <p className="mt-1.5 flex gap-1 text-[11px] leading-relaxed text-muted-foreground">
          <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
          <span>{def.note}</span>
        </p>
      )}
      {def.hypothesis && (
        <span className="mt-2 inline-flex items-center gap-1 rounded-full border border-synthetic/50 bg-synthetic-soft px-2 py-0.5 text-[10px] font-bold text-synthetic-foreground">
          <FlaskConical className="h-2.5 w-2.5" aria-hidden /> Hypothesis
        </span>
      )}
    </div>
  );
}

export function LayerSwitcher({ layer, onLayer, disabled = {}, hidden = [], signals = [], signal, onSignal, values }: Props) {
  const list = LAYERS.filter((l) => !hidden.includes(l.id));

  return (
    <div className="space-y-3">
      <ul className="space-y-1" role="radiogroup" aria-label="Brain layer">
        {list.map((l, i) => {
          const off = disabled[l.id];
          const on = layer === l.id;
          return (
            <li key={l.id}>
              <button
                type="button"
                role="radio"
                aria-checked={on}
                disabled={!!off}
                title={off ?? l.meaning}
                onClick={() => onLayer(l.id)}
                className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-45 ${
                  on ? "bg-primary-soft text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <span className="w-3 shrink-0 font-mono text-[10px] opacity-60">{i + 1}</span>
                <span className="min-w-0 flex-1">{l.label}</span>
                {off && <Lock className="h-3 w-3 shrink-0" aria-hidden />}
              </button>
              {on && off && <p className="px-3 pb-1 pt-0.5 text-[10px] text-muted-foreground">{off}</p>}
            </li>
          );
        })}
      </ul>

      {layer === "drivers" && signals.length > 0 && (
        <label className="block">
          <span className="text-[11px] font-bold">Signal</span>
          <select
            value={signal ?? signals[0]}
            onChange={(e) => onSignal?.(e.target.value)}
            className="mt-1 h-9 w-full rounded-md border border-input bg-transparent px-2 text-xs"
          >
            {signals.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="rounded-xl border p-3">
        <Legend layer={layer} values={values} />
      </div>
    </div>
  );
}
