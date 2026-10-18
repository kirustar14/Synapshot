// The Sentry demo, on the Settings page. Each button makes Sentry do one real thing and
// links straight to where it landed, so the integration can be shown live in a minute:
// an error with a stack trace, a trace that runs from this browser through FastAPI, the
// logs written on the way, this tab's masked session replay, and the feedback form.
//
// Nothing here touches patient data. The backend buttons need the real backend.

import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Bug, MessageSquareWarning, PlayCircle, Route, ScrollText } from "lucide-react";
import { useState, type ReactNode } from "react";
import { api } from "@/api/client";
import { SectionCard } from "@/dashboard/components";
import { Sentry, currentReplayId, openFeedback, sentryLinks, sentryOn } from "@/lib/sentry";

type Result = { ok: boolean; text: string; href?: string; label?: string };

function Dot({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={`inline-block h-2 w-2 rounded-full ${on ? "bg-[#5f8a55] shadow-[0_0_0_3px_rgba(95,138,85,0.15)]" : "bg-[#c9c0b3]"}`}
    />
  );
}

function Out({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 font-medium text-[#8a4222] underline-offset-2 hover:underline"
    >
      {children} <ArrowUpRight className="h-3 w-3" aria-hidden />
    </a>
  );
}

function Action({
  icon,
  title,
  detail,
  button,
  run,
  disabled,
}: {
  icon: ReactNode;
  title: string;
  detail: string;
  button: string;
  run: () => Promise<Result>;
  disabled?: string | false;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const go = async () => {
    setBusy(true);
    try {
      setResult(await run());
    } catch (e) {
      setResult({ ok: false, text: e instanceof Error ? e.message.replace(/^\d+\s*/, "") : String(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="py-3">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-[#8b8375]">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-[12px] font-medium text-[#1c1a17]">{title}</span>
          <span className="block text-[11px] leading-relaxed text-[#8b8375]">{detail}</span>
        </span>
        <button
          type="button"
          onClick={() => void go()}
          disabled={busy || !!disabled}
          title={disabled || undefined}
          className="inline-flex h-8 shrink-0 items-center rounded-[7px] border border-[#e6e0d6] bg-[#fffdfa] px-3 text-[11px] font-medium text-[#1c1a17] transition hover:border-[#d9cfc0] hover:bg-[#f6f1e8] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "Sending…" : button}
        </button>
      </div>
      {result && (
        <p
          role="status"
          className={`ml-7 mt-2 rounded-[7px] px-2.5 py-1.5 text-[11px] leading-relaxed ${
            result.ok ? "bg-[#eef3ea] text-[#3f5d37]" : "bg-[#fbf0ec] text-[#96311f]"
          }`}
        >
          {result.text} {result.href && <Out href={result.href}>{result.label ?? "Open in Sentry"}</Out>}
        </p>
      )}
    </li>
  );
}

export function SentryPanel() {
  const backend = useQuery({ queryKey: ["observability"], queryFn: api.observability, staleTime: 30000 });
  const backendOn = !!backend.data?.on;
  const replayId = currentReplayId();
  const needsBackend = !backendOn && "Backend Sentry is off: set SENTRY_DSN in .env and restart make dev";
  const needsBrowser = !sentryOn && "Browser Sentry is off: set VITE_SENTRY_DSN in web/.env.local and restart npm run dev";

  return (
    <SectionCard
      title="Observability · Sentry"
      subtitle="Every part of the app reports here. Each button makes Sentry do one real thing and links to it."
      className="xl:col-span-2"
    >
      <div id="sentry" className="grid gap-3 sm:grid-cols-3">
        {[
          { on: backendOn, label: "Backend (FastAPI)", note: backendOn ? backend.data?.environment ?? "on" : "off" },
          { on: sentryOn, label: "Browser (React)", note: sentryOn ? "errors, traces, logs" : "off" },
          { on: !!replayId, label: "Session replay", note: replayId ? "recording, text masked" : "off" },
        ].map((s) => (
          <div key={s.label} className="flex items-center gap-2.5 rounded-[8px] border border-[#ece6dc] bg-[#fbf8f3] px-3 py-2">
            <Dot on={s.on} />
            <span className="min-w-0">
              <span className="block text-[11px] font-medium">{s.label}</span>
              <span className="block truncate text-[10px] text-[#8b8375]">{s.note}</span>
            </span>
          </div>
        ))}
      </div>

      <ul className="mt-2 divide-y divide-[#f1ece4]">
        <Action
          icon={<Route className="h-4 w-4" />}
          title="Run a traced check-in"
          detail="One trace from this button, through FastAPI, across five pipeline steps (audio, speech, features, twin, store), with a log line from each."
          button="Run trace"
          disabled={needsBackend}
          run={async () => {
            const got = await Sentry.startSpan({ name: "Sentry demo: traced check-in", op: "ui.action" }, () =>
              api.sentryDemoTrace(),
            );
            return got.trace_id
              ? { ok: true, text: `Traced ${got.steps.length} steps.`, href: sentryLinks.trace(got.trace_id), label: "Open trace" }
              : { ok: true, text: "Ran, but no trace id came back." };
          }}
        />
        <Action
          icon={<Bug className="h-4 w-4" />}
          title="Send a backend error"
          detail="A deliberate, handled error from the server, with its stack trace, tags and the span it happened in."
          button="Send error"
          disabled={needsBackend}
          run={async () => {
            const got = await api.sentryDemoError();
            return got.event_id
              ? { ok: true, text: `Captured event ${got.event_id.slice(0, 8)}.`, href: sentryLinks.event(got.event_id), label: "Open issue" }
              : { ok: false, text: "The backend did not return an event id." };
          }}
        />
        <Action
          icon={<Bug className="h-4 w-4" />}
          title="Send a browser error"
          detail="An error from this page, with the session replay attached so you can watch what led up to it."
          button="Send error"
          disabled={needsBrowser}
          run={async () => {
            const id = Sentry.captureException(new Error("Synapshot demo: browser error from Settings (deliberate)"), {
              tags: { demo: "sentry-button" },
            });
            console.warn("Sentry demo: browser error sent", id);
            return { ok: true, text: `Captured event ${id.slice(0, 8)}.`, href: sentryLinks.event(id), label: "Open issue" };
          }}
        />
        <Action
          icon={<PlayCircle className="h-4 w-4" />}
          title="Watch this session"
          detail="Session replay records this tab with all text and inputs masked and the camera blocked."
          button="Get replay"
          disabled={needsBrowser}
          run={async () => {
            const id = currentReplayId();
            return id
              ? { ok: true, text: "Replay is recording. It shows up a minute after you stop clicking.", href: sentryLinks.replay(id), label: "Open replay" }
              : { ok: false, text: "No replay is recording in this tab." };
          }}
        />
        <Action
          icon={<ScrollText className="h-4 w-4" />}
          title="See the logs"
          detail="Backend INFO logs and browser warnings, searchable and linked to their traces. Call tokens are masked."
          button="Open logs"
          disabled={!backendOn && !sentryOn && "Sentry is off"}
          run={async () => {
            window.open(sentryLinks.logs(), "_blank", "noreferrer");
            return { ok: true, text: "Opened the Logs explorer." };
          }}
        />
        <Action
          icon={<MessageSquareWarning className="h-4 w-4" />}
          title="Report a problem"
          detail="Sentry's feedback form. A clinician's report arrives with the replay and the trace of what they were doing."
          button="Open form"
          disabled={needsBrowser}
          run={async () => {
            const opened = await openFeedback();
            return opened
              ? { ok: true, text: "Form opened. Submitted reports appear under User Feedback." }
              : { ok: false, text: "Feedback is not available in this build." };
          }}
        />
      </ul>
    </SectionCard>
  );
}
