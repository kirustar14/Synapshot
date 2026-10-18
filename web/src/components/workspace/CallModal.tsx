// The call modal: start a check-in, and say honestly whether the message got there.
//
// Two rules shape this card.
//
// The first is that accepted is not delivered. The chip reads Delivered via iMessage
// only when the provider has confirmed it. Until then it reads Sent, delivery not
// confirmed, which is the truth about a message that an API took and nothing has
// acknowledged. A failure says Not sent and gives the reason.
//
// The second is that the demo must work when the message does not. The QR code and the
// copyable link are always there, the most prominent thing on the card, labelled Open on
// phone. If every transport is broken you scan the code and the call page opens.
//
// The earlier version of this card had the link running off the right edge and the live
// strip hanging out of both sides. Everything here is width-constrained and wraps, and
// the strip lives in a collapsed section that opens itself when the patient arrives.

import {
  Check,
  ChevronDown,
  Copy,
  Laptop,
  Loader2,
  MessageSquare,
  Smartphone,
  TriangleAlert,
} from "lucide-react";
import { toString as qrString } from "qrcode";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/api/client";
import type { StreamState } from "@/api/stream";
import type { CallStart, Patient } from "@/api/types";
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

/** How long to keep asking the provider whether it arrived. */
const POLL_MS = 2000;
const POLL_FOR_MS = 30000;

type Status = "sent" | "delivered" | "failed" | "mock" | "none";

/** The one line the chip shows. Never claims more than is known. */
function chipFor(status: Status, channel: string) {
  if (status === "delivered") {
    return { text: "Delivered via iMessage", tone: "ok" as const };
  }
  if (status === "sent") {
    return { text: "Sent via iMessage, delivery not confirmed", tone: "wait" as const };
  }
  if (status === "failed") {
    return { text: "Not sent", tone: "bad" as const };
  }
  if (status === "mock") {
    return { text: "Mock, written to the thread", tone: "mute" as const };
  }
  return { text: channel ? `Channel ${channel}` : "No message sent", tone: "mute" as const };
}

/** A real, scannable QR of the link, drawn locally so the token stays here. */
function QR({ text, size = 160 }: { text: string; size?: number }) {
  const [svg, setSvg] = useState("");
  useEffect(() => {
    let live = true;
    qrString(text, { type: "svg", margin: 1, width: size, errorCorrectionLevel: "M" })
      .then((out) => live && setSvg(out))
      .catch(() => live && setSvg(""));
    return () => {
      live = false;
    };
  }, [text, size]);

  return (
    <div
      // Always white, whatever the theme. A dark-mode QR with inverted modules does not
      // scan, and a code that does not scan is worse than no code.
      className="shrink-0 overflow-hidden rounded-lg bg-white p-1.5"
      style={{ width: size, height: size }}
      role="img"
      aria-label="QR code for the check-in link"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

/** A section that is closed until it has something to say. */
function Fold({
  title,
  open,
  onToggle,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border/70">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-bold outline-none"
      >
        <ChevronDown
          className={cn("h-3.5 w-3.5 shrink-0 transition-transform", !open && "-rotate-90")}
          aria-hidden
        />
        {title}
      </button>
      {open && <div className="border-t border-border/60 px-3 py-2.5">{children}</div>}
    </div>
  );
}

/** The gaze dot following its target, plus the quality lights. */
function LiveStrip({ stream }: { stream: StreamState }) {
  const frame = stream.frame;
  const quality = frame?.quality;

  return (
    <div>
      <div className="flex items-center gap-2 text-[10px]">
        <span className="font-bold uppercase tracking-wide text-muted-foreground">
          {frame ? frame.step.replace(/_/g, " ") : "waiting for the phone"}
        </span>
        <span className="ml-auto font-mono text-muted-foreground">
          {stream.rate > 0 ? `${stream.rate}/s` : "no frames"}
        </span>
      </div>

      <div className="relative mt-1.5 h-20 overflow-hidden rounded-md bg-[#070e12]">
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
          <p className="flex h-full items-center justify-center px-3 text-center text-[11px] text-cyan-200/50">
            This fills when the patient opens the link.
          </p>
        )}
      </div>

      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[10px]">
        {([["face", quality?.face], ["distance", quality?.dist], ["light", quality?.light]] as const).map(
          ([label, on]) => (
            <span key={label} className="flex items-center gap-1">
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  on === undefined ? "bg-muted-foreground/40" : on ? "bg-emerald-500" : "bg-red-500",
                )}
                aria-hidden
              />
              {label}
            </span>
          ),
        )}
        <span className="ml-auto font-mono text-muted-foreground">
          {quality ? `${quality.fps.toFixed(0)} fps` : ""}
          {frame?.pursuit_gain != null ? ` gain ${frame.pursuit_gain.toFixed(2)}` : ""}
        </span>
      </div>
      <p className="mt-1.5 text-[10px] leading-snug text-muted-foreground">
        Numbers only. The video never leaves the phone, and nothing here is stored or scored.
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
  const [call, setCall] = useState<CallStart | null>(null);
  const [status, setStatus] = useState<Status>("none");
  const [detail, setDetail] = useState("");
  const [copied, setCopied] = useState(false);
  const [showLive, setShowLive] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const pollUntil = useRef(0);

  // The strip opens itself the moment the patient arrives, because that is the one
  // moment somebody actually wants to watch it.
  useEffect(() => {
    if (stream.rate > 0 || stream.frame) setShowLive(true);
  }, [stream.rate, stream.frame]);

  // When the pipeline lands, everything behind this card is stale.
  useEffect(() => {
    if (!stream.done) return;
    queryClient.invalidateQueries({
      predicate: (q) => q.queryKey[0] !== "health" && q.queryKey[0] !== "mesh",
    });
  }, [stream.done]);

  /** Ask the provider whether it arrived, for up to half a minute. */
  const poll = useCallback((mid: string) => {
    pollUntil.current = Date.now() + POLL_FOR_MS;
    const tick = async () => {
      if (Date.now() > pollUntil.current) return;
      try {
        const got = await api.messageStatus(mid);
        setStatus(got.status as Status);
        if (got.detail) setDetail(got.detail);
        // Only sent is still in flight. The other three are final.
        if (got.status === "sent") setTimeout(tick, POLL_MS);
      } catch {
        // A failed poll is not a failed message. Leave the chip where it is.
      }
    };
    setTimeout(tick, POLL_MS);
  }, []);

  const start = async (send: boolean) => {
    setStarting(true);
    setDetail("");
    try {
      const got = await api.createCall(patient.id, send);
      setCall(got);
      if (!send) {
        setStatus("none");
        return;
      }
      const next = (got.status ?? "mock") as Status;
      setStatus(next);
      setDetail(got.why || got.error || "");
      if (next === "sent" && got.message_id) poll(got.message_id);
      if (next === "failed") setShowDetails(true);
    } catch (err) {
      setStatus("failed");
      setDetail(err instanceof Error ? err.message : String(err));
      setShowDetails(true);
    } finally {
      setStarting(false);
    }
  };

  const chip = chipFor(status, call?.channel ?? "");
  const link = call?.url ?? "";
  const done = stream.done;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      {/* One ring, on the dialog. Nothing inside draws its own, which is what stacked
          the blue outlines on top of each other. */}
      <DialogContent className="max-w-[560px] gap-3 overflow-hidden outline-none [&_*]:outline-none">
        <DialogHeader>
          <DialogTitle>Check-in for {patient.name}</DialogTitle>
          <DialogDescription>
            {demo
              ? "Demo mode is on. The check-in runs on this laptop's webcam, through the same measurement code a phone runs."
              : "The patient gets a link and does the check-in on their own phone."}
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
              Only numbers on the allow list can be texted. Nothing here places a phone call.
            </p>
          </div>
        )}

        {call && (
          <div className="min-w-0 space-y-3">
            {status !== "none" && (
              <p
                className={cn(
                  "flex items-start gap-1.5 rounded-lg px-2.5 py-2 text-xs font-bold leading-snug",
                  chip.tone === "ok" && "bg-success-soft text-success",
                  chip.tone === "wait" && "bg-muted text-foreground",
                  chip.tone === "bad" && "bg-destructive-soft text-destructive",
                  chip.tone === "mute" && "bg-muted text-muted-foreground",
                )}
              >
                {chip.tone === "ok" && <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />}
                {chip.tone === "wait" && <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />}
                {chip.tone === "bad" && <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />}
                <span className="min-w-0">
                  {chip.text}
                  {status === "failed" && ". Open on phone with the QR code."}
                </span>
              </p>
            )}

            {/* Side by side when there is room. On a phone they stack, because a 160px
                code next to a URL leaves the URL about four characters wide. */}
            <div className="flex min-w-0 flex-col items-start gap-3 sm:flex-row">
              <QR text={link} />
              <div className="w-full min-w-0 flex-1 space-y-2">
                <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                  Open on phone
                </p>
                <p className="text-[11px] leading-snug text-muted-foreground">
                  Point the phone camera at the code, or copy the link.
                </p>
                <div className="flex min-w-0 items-center gap-1">
                  <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1.5 text-[11px]">
                    {link}
                  </code>
                  <Button
                    size="icon"
                    variant="outline"
                    className="h-8 w-8 shrink-0"
                    aria-label="Copy the link"
                    onClick={() => {
                      navigator.clipboard?.writeText(link);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    }}
                  >
                    {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
                  </Button>
                </div>
              </div>
            </div>

            {detail && (
              <Fold title="Details" open={showDetails} onToggle={() => setShowDetails(!showDetails)}>
                <p className="break-words text-[11px] leading-snug text-muted-foreground">{detail}</p>
                {(call.tried ?? []).length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {(call.tried ?? []).map((t: NonNullable<CallStart["tried"]>[number], i: number) => (
                      <li key={i} className="break-words font-mono text-[10px] leading-snug text-muted-foreground">
                        {String(t.how)}: {String(t.why || t.error || "")}
                      </li>
                    ))}
                  </ul>
                )}
              </Fold>
            )}

            <Fold title="Live call" open={showLive} onToggle={() => setShowLive(!showLive)}>
              <LiveStrip stream={stream} />
            </Fold>

            {stream.stage && !done && (
              <p className="flex items-center gap-2 rounded-lg bg-muted px-2.5 py-2 text-xs">
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
                {stream.stage.say}
              </p>
            )}

            {done && (
              <div className="rounded-lg border border-success/40 bg-success-soft px-3 py-2.5">
                <p className="flex items-center gap-1.5 text-xs font-bold text-success">
                  <Check className="h-3.5 w-3.5 shrink-0" aria-hidden /> Week {done.week} landed
                </p>
                <p className="mt-1 text-[11px] leading-snug">
                  Drift z {done.drift_z.toFixed(2)}
                  {done.alerts.length
                    ? `, ${done.alerts.length} flag${done.alerts.length === 1 ? "" : "s"}: ${done.alerts
                        .map((a) => a.replace(/_/g, " "))
                        .join(", ")}`
                    : ", no flags"}
                  {done.quality_ok ? "" : ". The video channel failed its gates, so the eye measures were dropped."}
                </p>
                <Button size="sm" className="mt-2" onClick={onClose}>
                  See the brain
                </Button>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
