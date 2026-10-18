// The parts of the call page that are not a task: the bar that is always on screen, the
// captions, the setup lights, the self view, the big tap targets and the number picker.
//
// Every tappable thing here is at least 48 px tall. Nothing animates when reduce motion is
// on. Nothing shifts when a caption grows, because the caption area has a fixed minimum.

import { Check, Eye, Minus, Pause, Play, Settings2, Volume2, X } from "lucide-react";
import type { CSSProperties, ReactNode, RefObject } from "react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useCallStore } from "./callStore";
import type { Lights } from "./types";

/** The high contrast palette, applied as variable overrides so the theme still drives it. */
export function contrastVars(on: boolean): CSSProperties | undefined {
  if (!on) return undefined;
  return {
    "--background": "oklch(1 0 0)",
    "--foreground": "oklch(0.12 0 0)",
    "--card": "oklch(1 0 0)",
    "--card-foreground": "oklch(0.12 0 0)",
    "--muted": "oklch(0.95 0 0)",
    "--muted-foreground": "oklch(0.26 0 0)",
    "--border": "oklch(0.45 0 0)",
    "--primary": "oklch(0.3 0.06 172)",
    "--primary-foreground": "oklch(1 0 0)",
    "--primary-soft": "oklch(0.93 0.02 172)",
    "--accent": "oklch(0.93 0.02 172)",
    "--accent-foreground": "oklch(0.2 0.04 172)",
  } as CSSProperties;
}

/** The bar that never leaves the screen: progress, pause, stop, and the access panel. */
export function Chrome({
  progress,
  minutes,
  paused,
  onPause,
  onResume,
  onStop,
}: {
  progress: number;
  minutes: number;
  paused: boolean;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="fixed inset-x-0 top-0 z-50 border-b border-border bg-background/95 backdrop-blur">
        <div
          className="h-1.5 bg-muted"
          role="progressbar"
          aria-label="How far through the check-in you are"
          aria-valuenow={Math.round(progress * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="h-full bg-primary" style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
        <div className="mx-auto flex w-full max-w-[520px] items-center gap-2 px-3 py-2">
          <button
            type="button"
            onClick={paused ? onResume : onPause}
            className="inline-flex h-12 min-w-[92px] items-center justify-center gap-2 rounded-full border border-border bg-card px-4 text-sm font-bold"
          >
            {paused ? <Play className="h-4 w-4" aria-hidden /> : <Pause className="h-4 w-4" aria-hidden />}
            {paused ? "Resume" : "Pause"}
          </button>
          <span className="min-w-0 flex-1 truncate text-center text-[11px] text-muted-foreground">
            about {minutes} min left
          </span>
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Text size and contrast"
            className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-border bg-card"
          >
            <Settings2 className="h-5 w-5" aria-hidden />
          </button>
          <button
            type="button"
            onClick={onStop}
            className="inline-flex h-12 shrink-0 items-center justify-center rounded-full border border-destructive/40 bg-destructive-soft px-4 text-sm font-bold text-destructive"
          >
            Stop
          </button>
        </div>
      </div>
      {open && <AccessPanel onClose={() => setOpen(false)} />}
    </>
  );
}

type PrefKey = "bigText" | "contrast" | "captions" | "reduceMotion" | "muted";

const PREF_ROWS: Array<[string, PrefKey, string]> = [
  ["Larger text", "bigText", "Makes every word on the page bigger."],
  ["High contrast", "contrast", "Black text on white, with stronger outlines."],
  ["Show captions", "captions", "Every spoken line also appears as text."],
  ["Reduce motion", "reduceMotion", "Stops anything moving that does not have to."],
  ["Mute the voice", "muted", "The lines stay on screen as captions."],
];

/** Large text, high contrast, captions, reduce motion and mute, all in one sheet. */
export function AccessPanel({ onClose }: { onClose: () => void }) {
  const prefs = useCallStore();
  const values: Record<PrefKey, boolean> = {
    bigText: prefs.bigText,
    contrast: prefs.contrast,
    captions: prefs.captions,
    reduceMotion: prefs.reduceMotion,
    muted: prefs.muted,
  };
  return (
    <div className="fixed inset-0 z-[70] flex items-end bg-black/40" role="dialog" aria-label="Display and sound options">
      <div className="max-h-[80vh] w-full overflow-y-auto rounded-t-[1.25rem] border-t border-border bg-card p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-extrabold">Make this easier to use</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-border"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>
        <ul className="space-y-2">
          {PREF_ROWS.map(([label, key, note]) => (
            <li key={key}>
              <button
                type="button"
                aria-pressed={values[key]}
                onClick={() => prefs.set({ [key]: !values[key] } as Record<string, boolean>)}
                className={cn(
                  "flex min-h-[56px] w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left",
                  values[key] ? "border-primary bg-primary-soft" : "border-border bg-background",
                )}
              >
                <span
                  className={cn(
                    "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border",
                    values[key] ? "border-primary bg-primary text-primary-foreground" : "border-border",
                  )}
                >
                  {values[key] ? <Check className="h-4 w-4" aria-hidden /> : null}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-bold">{label}</span>
                  <span className="block text-xs text-muted-foreground">{note}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={onClose}
          className="mt-4 inline-flex h-12 w-full items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground"
        >
          Done
        </button>
      </div>
    </div>
  );
}

/** The spoken line, always shown as text. */
export function Captions({ text }: { text: string }) {
  const show = useCallStore((s) => s.captions);
  if (!show) return null;
  return (
    <p aria-live="polite" className="min-h-[72px] text-[15px] leading-relaxed text-foreground">
      {text}
    </p>
  );
}

/** A calm banner for a slow or dropped connection. Never red, never a dialog. */
export function Banner({ text }: { text: string }) {
  if (!text) return null;
  return (
    <div className="fixed inset-x-0 top-[62px] z-40 mx-auto w-full max-w-[520px] px-3">
      <p className="rounded-full border border-border bg-muted px-4 py-2 text-center text-[11px] text-muted-foreground">
        {text}
      </p>
    </div>
  );
}

/** One of the four setup checks. */
function Light({ ok, label, hint }: { ok: boolean; label: string; hint: string }) {
  return (
    <li className="flex items-center gap-3">
      <span
        className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border",
          ok ? "border-success/40 bg-success-soft text-success" : "border-border bg-muted text-muted-foreground",
        )}
      >
        {ok ? <Check className="h-4 w-4" aria-hidden /> : <Minus className="h-4 w-4" aria-hidden />}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-bold">{label}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
    </li>
  );
}

/** The four green ticks, with the plain language version of what each one wants. */
export function LightRow({ lights }: { lights: Lights }) {
  return (
    <ul className="space-y-3">
      <Light ok={lights.face} label="I can see your face" hint="Hold the phone so your whole face is in the oval." />
      <Light
        ok={lights.dist}
        label="You are the right distance away"
        hint={lights.iris_px > 0 && lights.iris_px < 8 ? "Come a little closer." : "About an arm's length, at eye level."}
      />
      <Light
        ok={lights.light}
        label="The light is good"
        hint={lights.bright < 0.16 ? "Turn a light on or face a window." : "Keep the light on your face, not behind you."}
      />
      <Light ok={lights.steady} label="You are holding still" hint="Prop the phone against something if you can." />
    </ul>
  );
}

/** The small self view with a face guide. The video is never recorded or sent. */
export function SelfView({ stream, lights }: { stream: MediaStream | null; lights: Lights }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !stream) return;
    el.srcObject = stream;
    void el.play().catch(() => {});
  }, [stream]);
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border bg-muted",
        "aspect-[3/4] w-full",
        lights.face ? "border-success/50" : "border-border",
      )}
    >
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        className="h-full w-full scale-x-[-1] object-cover"
        aria-label="Your camera, shown only on this phone"
      />
      <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 133" aria-hidden>
        <ellipse
          cx="50"
          cy="62"
          rx="30"
          ry="40"
          fill="none"
          stroke={lights.face ? "oklch(0.58 0.13 155)" : "oklch(0.7 0.015 220)"}
          strokeWidth="1.5"
          strokeDasharray="4 3"
        />
      </svg>
      <span className="absolute bottom-2 left-2 rounded-full bg-background/85 px-2 py-0.5 text-[10px] font-medium">
        <Eye className="mr-1 inline h-3 w-3" aria-hidden />
        stays on this phone
      </span>
    </div>
  );
}

/** A full width tap target, the only button shape the task screens use. */
export function Big({
  children,
  onClick,
  tone = "primary",
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  tone?: "primary" | "outline" | "danger";
  disabled?: boolean;
}) {
  const skin =
    tone === "primary"
      ? "bg-foreground text-background border-transparent"
      : tone === "danger"
        ? "bg-destructive-soft text-destructive border-destructive/40"
        : "bg-card text-foreground border-foreground/25";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex min-h-[56px] w-full items-center justify-center rounded-full border px-6 text-base font-bold disabled:opacity-50",
        skin,
      )}
    >
      {children}
    </button>
  );
}

/** Says the current line again. Styled like the consent page's Read this to me.
 *
 * Disabled while the line is still playing, which is the whole point: pressing it twice
 * used to start a second line over the first.
 */
export function Replay({ onClick, speaking }: { onClick: () => void; speaking: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={speaking}
      className="mb-3 inline-flex h-12 w-full items-center justify-center gap-2 rounded-full border border-border bg-card px-4 text-sm font-bold disabled:opacity-50"
    >
      <Volume2 className="h-4 w-4" aria-hidden /> {speaking ? "Playing" : "Say that again"}
    </button>
  );
}

/** Zero to ten, big enough to tap without looking. */
export function NumberPicker({
  value,
  onChange,
  label,
}: {
  value: number | null;
  onChange: (v: number) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="grid grid-cols-6 gap-2">
      {Array.from({ length: 11 }, (_, i) => i).map((n) => (
        <button
          key={n}
          type="button"
          aria-pressed={value === n}
          onClick={() => onChange(n)}
          className={cn(
            "inline-flex h-12 items-center justify-center rounded-xl border font-mono text-base font-semibold",
            value === n ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card",
          )}
        >
          {n}
        </button>
      ))}
    </div>
  );
}

/** The standard task screen: a title, the caption, the body, then the buttons. */
export function Stage({
  title,
  caption,
  children,
  footer,
}: {
  title?: string;
  caption?: string;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-[calc(100vh-88px)] w-full max-w-[520px] flex-col px-5 pb-10 pt-[88px]">
      {title && <h1 className="mb-2 text-xl font-extrabold">{title}</h1>}
      {caption !== undefined && <Captions text={caption} />}
      <div className="min-w-0 flex-1">{children}</div>
      {footer && <div className="mt-5 space-y-3">{footer}</div>}
    </div>
  );
}

/** The overlay that takes over when the call is paused. */
export function PausedOverlay({
  reason,
  onResume,
  onStop,
}: {
  reason: "patient" | "face" | "hidden";
  onResume: () => void;
  onStop: () => void;
}) {
  const copy = {
    patient: { title: "Paused", body: "Take as long as you need. Tap resume when you are ready." },
    face: { title: "Move back into frame", body: "I lost sight of your face. Line your face up in the oval and we will try that part again." },
    hidden: { title: "Paused", body: "The check-in paused when you left this page. Tap resume to carry on from here." },
  }[reason];
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-background/96 px-5">
      <div className="w-full max-w-[420px] text-center">
        <h2 className="text-xl font-extrabold">{copy.title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{copy.body}</p>
        <div className="mt-6 space-y-3">
          <Big onClick={onResume}>Resume</Big>
          <Big tone="outline" onClick={onStop}>
            Stop and contact my clinic
          </Big>
        </div>
      </div>
    </div>
  );
}

/** The full screen stimulus surface. Tasks draw into the canvas this returns. */
export function StimSurface({ canvasRef, children }: { canvasRef: RefObject<HTMLCanvasElement | null>; children?: ReactNode }) {
  return (
    <div className="fixed inset-0 z-30 bg-background">
      <canvas ref={canvasRef} className="block h-full w-full touch-none" />
      {children}
    </div>
  );
}
