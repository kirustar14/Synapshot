// R1 Live call console, the presenter view. This is no longer a FaceTime rig: it watches the
// patient's web call through the same /ws/rig stream and shows only the measurements.

import { Radio } from "lucide-react";
import { Link } from "react-router-dom";
import { useRig, type RigStatus } from "@/api/ws";
import { ModelLabel, PageHeader, Panel } from "@/components/common";
import { PhoneStage } from "@/components/panels/PhoneStage";
import { QualityLights } from "@/components/panels/QualityLights";
import { Transcript } from "@/components/panels/Transcript";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const PILL: Record<RigStatus, { label: string; cls: string; pulse: boolean }> = {
  Idle: { label: "Idle", cls: "border-border bg-muted text-muted-foreground", pulse: false },
  Ringing: {
    label: "Waiting for the patient to open the link",
    cls: "border-synthetic/40 bg-synthetic-soft text-synthetic-foreground",
    pulse: true,
  },
  "In call": { label: "In call", cls: "border-success/30 bg-success-soft text-success", pulse: true },
  Failed: { label: "Failed", cls: "border-destructive/40 bg-destructive-soft text-destructive", pulse: false },
};

export default function Rig() {
  const rig = useRig();
  const pill = PILL[rig.status];
  const quality = rig.last?.quality;
  const gain = rig.last?.pursuit_gain ?? null;

  return (
    <>
      <PageHeader
        title="Live call"
        subtitle="What the patient's web call is doing right now. The video never leaves the patient's phone, so this console shows the measurements the phone sends and nothing else."
        actions={
          <Button variant="outline" asChild>
            <Link to="/rig/preflight">Preflight</Link>
          </Button>
        }
      />

      <div
        className={cn(
          "mb-5 flex flex-wrap items-center gap-3 rounded-xl border px-5 py-4 text-lg font-extrabold",
          pill.cls,
        )}
        role="status"
      >
        <span className={cn("relative flex h-3 w-3", pill.pulse && "ring-pulse")} aria-hidden>
          <span className="h-3 w-3 rounded-full bg-current" />
        </span>
        {pill.label}
        <span className="ml-auto flex flex-wrap items-center gap-3 text-xs font-bold">
          <span>{rig.connected ? "stream connected" : "stream not connected"}</span>
          <span>{rig.eventsPerSec} events per second</span>
        </span>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <Panel title="Stage" subtitle="The target dot and the measured gaze, drawn on a phone because that is what the patient is holding.">
          <PhoneStage event={rig.last} idle={rig.status !== "In call"} />
        </Panel>

        <div className="space-y-5">
          <Panel title="Channel quality" subtitle="Live from the call page. Any red light means the step will be re-run.">
            {quality ? (
              <QualityLights face={quality.face} dist={quality.dist} light={quality.light} fps={quality.fps} />
            ) : (
              <p className="text-sm text-muted-foreground">No frames yet. Nothing has been measured.</p>
            )}
            <dl className="mt-4 grid grid-cols-2 gap-4 border-t pt-4 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-xs text-muted-foreground">Current step</dt>
                <dd className="font-mono font-bold">{rig.last?.step ?? "none"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Frame rate</dt>
                <dd className="font-mono font-bold">{quality ? `${Math.round(quality.fps)} fps` : "none"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Transcript lines</dt>
                <dd className="font-mono font-bold">{rig.transcript.length}</dd>
              </div>
            </dl>
          </Panel>

          <Panel
            title="Pursuit gain"
            subtitle="How far the eyes travel for every degree the dot travels. Around 0.9 is typical, lower means the eyes are lagging."
            action={<ModelLabel />}
          >
            {gain == null ? (
              <p className="text-sm text-muted-foreground">Not in a pursuit task right now.</p>
            ) : (
              <>
                <p className="text-4xl font-extrabold">{gain.toFixed(2)}</p>
                <div className="mt-3 flex items-center gap-3">
                  <span className="h-3 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden>
                    <span
                      className="block h-full rounded-full bg-primary"
                      style={{ width: `${Math.min(100, gain * 100)}%` }}
                    />
                  </span>
                  <span className="text-xs text-muted-foreground">of 1.00</span>
                </div>
              </>
            )}
          </Panel>

          <Panel
            title="Transcript"
            subtitle="Scrolls as the call runs."
            action={
              <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Radio className="h-3 w-3" aria-hidden /> live
              </span>
            }
          >
            <Transcript lines={rig.transcript} follow height={280} />
          </Panel>
        </div>
      </div>
    </>
  );
}
