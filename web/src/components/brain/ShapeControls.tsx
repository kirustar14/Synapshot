// The two sliders that morph the mesh, plus the small display toggles that are not worth a
// place on the stage toolbar.

import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { useViewer } from "./viewerStore";

export function ShapeControls() {
  const v = useViewer();

  return (
    <div className="space-y-4">
      <label className="block">
        <span className="flex items-baseline justify-between text-xs font-bold">
          Personalization
          <span className="font-mono tabular-nums">{Math.round(v.personal * 100)} percent</span>
        </span>
        <Slider
          className="mt-2"
          value={[Math.round(v.personal * 100)]}
          min={0}
          max={100}
          step={1}
          onValueChange={([p]) => v.setPersonal(p / 100)}
          aria-label="Personalization, template at 0 and this patient at 100"
        />
        <span className="mt-1 block text-[11px] text-muted-foreground">Template at 0, this patient at 100.</span>
      </label>

      <label className="block">
        <span className="flex items-baseline justify-between text-xs font-bold">
          Inflate
          <span className="font-mono tabular-nums">{Math.round(v.inflate * 100)} percent</span>
        </span>
        <Slider
          className="mt-2"
          value={[Math.round(v.inflate * 100)]}
          min={0}
          max={100}
          step={1}
          onValueChange={([i]) => v.setInflate(i / 100)}
          aria-label="Inflate the surface, folded at 0 and smooth at 100"
        />
        <span className="mt-1 block text-[11px] text-muted-foreground">
          Smooths the folds out so regions buried in a sulcus become visible.
        </span>
      </label>

      <ul className="space-y-2 text-xs">
        <Toggle
          label="Week 0 ghost"
          hint="A faint under glow where the damage was at week 0."
          on={v.ghost}
          set={(ghost) => v.setFlag({ ghost })}
        />
        <Toggle
          label="Floating callouts"
          hint="Names the five regions the layer lights most."
          on={v.callouts}
          set={(callouts) => v.setFlag({ callouts })}
        />
        <Toggle
          label="Region borders"
          hint="Thin glowing seams between parcels."
          on={v.borders}
          set={(borders) => v.setFlag({ borders })}
        />
        <Toggle
          label="Hologram"
          hint="Off gives flat anatomical shading for print and export."
          on={v.hologram}
          set={(hologram) => v.setFlag({ hologram })}
        />
        <Toggle
          label="Reduce motion"
          hint="Stops the scan sweep, the pulses, the particles and the tract flow."
          on={v.reduceMotion}
          set={(reduceMotion) => v.setFlag({ reduceMotion })}
        />
      </ul>
    </div>
  );
}

function Toggle({ label, hint, on, set }: { label: string; hint: string; on: boolean; set: (v: boolean) => void }) {
  return (
    <li className="flex items-start justify-between gap-3">
      <span className="min-w-0">
        <span className="font-bold">{label}</span>
        <span className="block text-[11px] text-muted-foreground">{hint}</span>
      </span>
      <Switch checked={on} onCheckedChange={set} aria-label={label} />
    </li>
  );
}
