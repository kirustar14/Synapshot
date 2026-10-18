// The four channel quality lights from the live call stream. Each tile carries a word and an
// icon as well as a colour.

import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface Light {
  name: string;
  ok: boolean;
  detail: string;
}

export function QualityLights({
  face,
  dist,
  light,
  fps,
}: {
  face: boolean;
  dist: boolean;
  light: boolean;
  fps: number;
}) {
  const lights: Light[] = [
    { name: "Face", ok: face, detail: face ? "face found" : "no face" },
    { name: "Distance", ok: dist, detail: dist ? "arm's length" : "too close or far" },
    { name: "Light", ok: light, detail: light ? "enough light" : "too dark" },
    { name: "Frame rate", ok: fps >= 20, detail: `${Math.round(fps)} fps` },
  ];

  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {lights.map((l) => (
        <li
          key={l.name}
          className={cn(
            "rounded-xl border p-3",
            l.ok ? "border-success/30 bg-success-soft" : "border-destructive/40 bg-destructive-soft",
          )}
        >
          <span className="flex items-center gap-1.5 text-xs font-bold">
            {l.ok ? (
              <Check className="h-3.5 w-3.5 text-success" aria-hidden />
            ) : (
              <X className="h-3.5 w-3.5 text-destructive" aria-hidden />
            )}
            {l.name}
          </span>
          <span className="mt-0.5 block text-[11px] text-muted-foreground">{l.detail}</span>
        </li>
      ))}
    </ul>
  );
}
