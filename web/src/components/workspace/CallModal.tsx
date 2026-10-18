// The call modal: start a check-in and watch it happen.
//
// Three things, in order:
//
//   the channel, honestly   which transport the link actually went out on
//   the link and a QR       so a phone in the room can open it without typing
//   the live strip          the gaze dot and the quality lights while the call runs
//
// On the channel: this never says iMessage unless a real iMessage transport reported
// success. A blue bubble a clinician did not get is worse than an SMS they did, and the
// backend labels the message by what carried it, not by what was hoped for.
//
// The strip is the old R1 live console, reduced to the part that was worth having. A
// clinician watching a call wants to know it is working: a dot following a target and
// four quality lights say that in a glance.

import { Check, Copy, Laptop, Loader2, MessageSquare, Smartphone, X } from "lucide-react";
import { toString } from "qrcode";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/api/client";
import type { StreamState } from "@/api/stream";
import type { Patient } from "@/api/types";
import { queryClient } from "@/App";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useApp } from "@/store/app";

/**
 * A real, scannable QR of the link.
 *
 * Generated as an SVG locally, with no network call: the link contains a call token and
 * sending it to a QR service would hand that token to a third party. Always rendered on
 * white regardless of theme, because a dark-mode QR with inverted modules does not scan.
 */
function QR({ text, size = 148 }: { text: string; size?: number }) {
  const [svg, setSvg] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    setFailed(false);
    toString(text, { type: "svg", margin: 1, width: size, errorCorrectionLevel: "M" })
      .then((out) => live && setSvg(out))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [text, size]);

  if (failed || !svg) {
    return (
      <div
        className="flex flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border bg-muted/40 text-center"
        style={{ width: size, height: size }}
      >
        <Smartphone className="h-6 w-6 text-muted-foreground" aria-hidden />
        <p className="px-3 text-[10px] leading-snug text-muted-foreground">
          {failed ? "Could not draw a code. Copy the link instead." : "Drawing the code"}
        </p>
      </div>
    );
  }

  return (
    <div
      className="shrink-0 overflow-hidden rounded-xl bg-white p-1"
      style={{ width: size, height: size }}
      role="img"
      aria-label="QR code for the check-in link"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

/** The gaze dot following its target, plus the quality lights. */
function LiveStrip({ stream }: { stream: StreamState }) {
  const frame = stream.frame;
  const quality = frame?.quality;

  return (
    <div className="rounded-xl border border-[#1e3a44] bg-[#070e12] p-3">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wide text-cyan-200">
          {frame ? frame.step.replace(/_/g, " ") : "waiting for the phone"}
        </span>
        <span className="ml-auto font-mono text-[10px] text-cyan-200/70">
          {stream.rate > 0 ? `${stream.rate}/s` : "no frames"}
        </span>
      </div>

      <div className="relative mt-2 h-24 overflow-hidden rounded-lg bg-black/60">
        {frame ? (
          <>
            <span
              className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-cyan-300/70"
              style={{ left: `${frame.target.x * 100}%`, top: `${frame.target.y * 100}%` }}
              aria-label="target"
            />
            <span
              className="absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-300 transition-[left,top] duration-150"
              style={{ left: `${frame.gaze.x * 100}%`, top: `${frame.gaze.y * 100}%` }}
              aria-label="gaze"
            />
          </>
        ) : (
          <p className="flex h-full items-center justify-center text-[11px] text-cyan-200/50">
            The strip fills when the patient opens the link.
          </p>
        )}
      </div>

      <div className="mt-2 flex gap-3">
        {[
          ["face", quality?.face],
          ["distance", quality?.dist],
          ["light", quality?.light],
        ].map(([label, on]) => (
          <span key={String(label)} className="flex items-center gap-1 text-[10px] text-cyan-100">
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                on === undefined ? "bg-cyan-200/30" : on ? "bg-emerald-400" : "bg-red-400",
              )}
              aria-hidden
            />
            {label}
          </span>
        ))}
        <span className="ml-auto font-mono text-[10px] text-cyan-200/70">
          {quality ? `${quality.fps.toFixed(0)} fps` : ""}
          {frame?.pursuit_gain != null ? ` · gain ${frame.pursuit_gain.toFixed(2)}` : ""}
        </span>
      </div>
      <p className="mt-1.5 text-[10px] leading-snug text-cyan-200/60">
        Numbers only. The video never leaves the phone, and nothing on this strip is stored or
        scored: the measurements arrive in whole chunks when each task ends.
      </p>
    </div>
  );
}

export function CallModal({
  patient,
  open,
  onClose,
  stream,
}: {
  patient: Patient;
  open: boolean;
  onClose: () => void;
  stream: StreamState;
}) {
  const demo = useApp((s) => s.demoMode);
  const [starting, setStarting] = useState(false);
  const [call, setCall] = useState<{ url: string; channel?: string; token: string } | null>(null);
  const [copied, setCopied] = useState(false);

  // When the pipeline lands, everything on the screen behind this is stale.
  useEffect(() => {
    if (!stream.done) return;
    queryClient.invalidateQueries({
      predicate: (q) => q.queryKey[0] !== "health" && q.queryKey[0] !== "mesh",
    });
  }, [stream.done]);

  const start = async (send: boolean) => {
    setStarting(true);
    try {
      const got = await api.createCall(patient.id, send);
      setCall({ url: got.url, channel: (got as { channel?: string }).channel, token: got.token });
      if (send) {
        const how = (got as { channel?: string }).channel ?? "mock";
        toast.success(
          how === "imessage"
            ? "Sent as iMessage."
            : how === "sms"
              ? "Sent as SMS. iMessage could not deliver it."
              : "Written to the message thread. Nothing was sent: no transport is live.",
        );
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  };

  const done = stream.done;
  const stage = stream.stage;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Check-in for {patient.name}</DialogTitle>
          <DialogDescription>
            {demo
              ? "Demo mode is on. The check-in runs on this laptop's webcam, through the same measurement code a phone runs."
              : "The patient gets a text with a link and does the check-in on their own phone."}
          </DialogDescription>
        </DialogHeader>

        {!call && (
          <div className="space-y-2">
            <Button className="w-full" disabled={starting} onClick={() => start(true)}>
              {starting ? <Loader2 className="animate-spin" aria-hidden /> : <MessageSquare aria-hidden />}
              Text the link
            </Button>
            <Button variant="outline" className="w-full" disabled={starting} onClick={() => start(false)}>
              {demo ? <Laptop aria-hidden /> : <Smartphone aria-hidden />}
              Just make a link
            </Button>
            <p className="text-[11px] leading-snug text-muted-foreground">
              Only numbers on the DEMO_PHONES allow list can be texted, and the message says which
              transport actually carried it. Nothing here places a phone call.
            </p>
          </div>
        )}

        {call && (
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <QR text={call.url} />
              <div className="min-w-0 flex-1 space-y-2">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                    Channel
                  </p>
                  <p className="text-xs font-bold">
                    {call.channel === "imessage"
                      ? "iMessage"
                      : call.channel === "sms"
                        ? "SMS"
                        : call.channel
                          ? "written to the thread, not sent"
                          : "no message sent"}
                  </p>
                  {call.channel === "sms" && (
                    <p className="text-[10px] leading-snug text-muted-foreground">
                      iMessage could not deliver, so this went by SMS. It is a real text and the
                      link works the same.
                    </p>
                  )}
                  {call.channel === "mock" && (
                    <p className="text-[10px] leading-snug text-muted-foreground">
                      No transport is live, so it was written to the message thread instead of
                      being sent. The link below still works.
                    </p>
                  )}
                </div>

                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                    Link
                  </p>
                  <div className="flex items-center gap-1">
                    <code className="min-w-0 flex-1 truncate rounded bg-muted px-1.5 py-1 text-[10px]">
                      {call.url}
                    </code>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 shrink-0"
                      aria-label="Copy the link"
                      onClick={() => {
                        navigator.clipboard?.writeText(call.url);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1500);
                      }}
                    >
                      {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            <LiveStrip stream={stream} />

            {stage && !done && (
              <p className="flex items-center gap-2 rounded-lg bg-muted px-2.5 py-2 text-xs">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                {stage.say}
              </p>
            )}

            {done && (
              <div className="rounded-lg border border-success/40 bg-success-soft px-3 py-2.5">
                <p className="flex items-center gap-1.5 text-xs font-bold text-success">
                  <Check className="h-3.5 w-3.5" aria-hidden /> Week {done.week} landed
                </p>
                <p className="mt-1 text-[11px] leading-snug">
                  Drift z {done.drift_z.toFixed(2)}
                  {done.alerts.length
                    ? `, ${done.alerts.length} flag${done.alerts.length === 1 ? "" : "s"} raised: ${done.alerts.map((a) => a.replace(/_/g, " ")).join(", ")}`
                    : ", no flags"}
                  {done.quality_ok ? "" : ". The video channel failed its gates, so the eye measures were dropped."}
                </p>
                <Button size="sm" className="mt-2" onClick={onClose}>
                  See the brain
                </Button>
              </div>
            )}

            {stream.failed && (
              <p className="flex items-start gap-1.5 rounded-lg bg-destructive-soft px-2.5 py-2 text-[11px] text-destructive">
                <X className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                The check-in failed to process: {stream.failed.error}
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
