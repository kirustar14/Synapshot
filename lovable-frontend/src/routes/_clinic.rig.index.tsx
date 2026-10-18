import { createFileRoute, Link } from "@tanstack/react-router";
import { ClipboardCheck } from "lucide-react";
import { useEffect, useRef } from "react";
import { useRig, type RigStatus } from "@/api/ws";
import { PageHeader, Panel } from "@/components/common";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_clinic/rig/")({
  head: () => ({
    meta: [
      { title: "Rig console | UNNAMED" },
      { name: "description", content: "Live presenter view of the FaceTime rig: gaze, quality and transcript." },
      { property: "og:title", content: "Rig console | UNNAMED" },
      { property: "og:description", content: "Live presenter view of the call rig." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Rig,
});

const STATUS_CLS: Record<RigStatus, string> = {
  Idle: "bg-muted text-muted-foreground",
  Ringing: "bg-synthetic-soft text-synthetic-foreground ring-pulse",
  "In call": "bg-success-soft text-success",
  Failed: "bg-destructive-soft text-destructive",
};

function Rig() {
  const rig = useRig();
  const ev = rig.last;
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" }); }, [rig.transcript.length]);

  const q = ev?.quality;
  const lights: { k: string; ok: boolean; detail: string }[] = [
    { k: "Face", ok: !!q?.face, detail: q?.face ? "found" : "lost" },
    { k: "Distance", ok: !!q?.dist, detail: q?.dist ? "good" : "adjust" },
    { k: "Light", ok: !!q?.light, detail: q?.light ? "good" : "low" },
    { k: "FPS", ok: (q?.fps ?? 0) >= 24, detail: `${q?.fps ?? 0}` },
  ];

  return (
    <>
      <PageHeader title="Rig console" subtitle="Presenter view of the live call"
        actions={<>
          <span className={cn("rounded-full px-4 py-1.5 text-sm font-semibold", STATUS_CLS[rig.status])} role="status" aria-live="polite">{rig.status}</span>
          <Button asChild variant="outline"><Link to="/rig/preflight"><ClipboardCheck className="h-4 w-4" /> Preflight</Link></Button>
        </>} />
      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <div className="panel relative aspect-video overflow-hidden bg-foreground p-0">
            {ev?.frame ? (
              <img src={`data:image/jpeg;base64,${ev.frame}`} alt="Live rig camera frame" className="absolute inset-0 h-full w-full object-cover" />
            ) : (
              <svg viewBox="0 0 160 90" className="absolute inset-0 h-full w-full" aria-label="Abstract face placeholder">
                <rect width="160" height="90" fill="var(--color-secondary)" />
                <ellipse cx="80" cy="48" rx="26" ry="33" fill="var(--color-muted)" stroke="var(--color-border)" />
                <ellipse cx="70" cy="42" rx="5" ry="3" fill="var(--color-card)" /><ellipse cx="90" cy="42" rx="5" ry="3" fill="var(--color-card)" />
                <circle cx={70 + ((ev?.gaze.x ?? 0.5) - 0.5) * 6} cy={42 + ((ev?.gaze.y ?? 0.5) - 0.5) * 3} r="1.6" fill="var(--color-foreground)" />
                <circle cx={90 + ((ev?.gaze.x ?? 0.5) - 0.5) * 6} cy={42 + ((ev?.gaze.y ?? 0.5) - 0.5) * 3} r="1.6" fill="var(--color-foreground)" />
                <path d="M72 62 Q80 67 88 62" stroke="var(--color-muted-foreground)" fill="none" strokeWidth="1" />
              </svg>
            )}
            {ev && (
              <>
                <div className="absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-destructive bg-destructive/40" style={{ left: `${ev.target.x * 100}%`, top: `${ev.target.y * 100}%` }} aria-label="Target dot" />
                <div className="absolute h-8 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-primary" style={{ left: `${ev.gaze.x * 100}%`, top: `${ev.gaze.y * 100}%` }} aria-label="Gaze estimate" />
              </>
            )}
            <div className="absolute bottom-3 left-3 rounded-md bg-card/90 px-2 py-1 text-xs"><span className="text-muted-foreground">Step</span> <b>{ev?.step ?? "Waiting"}</b></div>
          </div>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {lights.map((l) => (
              <div key={l.k} className="panel flex items-center gap-3 p-4">
                <span className={cn("h-3.5 w-3.5 rounded-full", l.ok ? "bg-success" : "bg-destructive")} aria-hidden />
                <div><p className="text-xs text-muted-foreground">{l.k}</p><p className="text-sm font-semibold">{l.ok ? "OK" : "Check"} <span className="font-normal text-muted-foreground">{l.detail}</span></p></div>
              </div>
            ))}
          </div>
        </div>
        <div className="space-y-4">
          <Panel title="Pursuit gain" subtitle="Eye speed divided by target speed">
            <p className="font-mono text-5xl font-semibold tabular-nums">{ev?.pursuit_gain?.toFixed(2) ?? "n/a"}</p>
          </Panel>
          <Panel title="Channel health">
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <dt className="text-muted-foreground">Connected</dt><dd>{rig.connected ? "Yes" : "No"}</dd>
              <dt className="text-muted-foreground">Events per second</dt><dd className="font-mono">{rig.eventsPerSec}</dd>
              <dt className="text-muted-foreground">Camera fps</dt><dd className="font-mono">{q?.fps ?? 0}</dd>
            </dl>
          </Panel>
          <Panel title="Transcript">
            <div ref={scroller} className="h-72 space-y-2 overflow-y-auto pr-1 text-sm" aria-live="polite">
              {rig.transcript.length === 0 && <p className="text-muted-foreground">Waiting for speech.</p>}
              {rig.transcript.map((l, i) => (
                <p key={i}><span className={cn("mr-2 text-xs font-semibold uppercase", l.who === "agent" ? "text-primary" : "text-chart-2")}>{l.who}</span>{l.text}</p>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}
