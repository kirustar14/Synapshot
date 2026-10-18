// P2 Phone mock, the stage view. The message thread on the left, and the call page itself in a
// phone sized frame on the right, so an audience sees the text arrive and the call open.

import { Brain, ExternalLink, Smartphone } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { api, useMessages, usePatient } from "@/api/client";
import type { Message } from "@/api/types";
import { Empty, ErrorState, Loading, SyntheticBadge, fmtTime } from "@/components/common";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const CHANNEL: Record<Message["channel"], string> = {
  imessage: "iMessage",
  sms: "SMS",
  mock: "Mock",
};

/** An iPhone shaped frame. Fixed aspect so the thread and the call page match on stage. */
function PhoneFrame({ label, children }: { label: string; children: ReactNode }) {
  return (
    <figure className="m-0 w-full max-w-[380px]">
      <div className="relative rounded-[3rem] border-[12px] border-foreground/85 bg-background shadow-lift">
        <span className="absolute left-1/2 top-2.5 z-10 h-1.5 w-20 -translate-x-1/2 rounded-full bg-foreground/30" aria-hidden />
        <div className="h-[660px] overflow-hidden rounded-[2.2rem]">{children}</div>
      </div>
      <figcaption className="mt-3 text-center text-xs font-bold text-muted-foreground">{label}</figcaption>
    </figure>
  );
}

function Thread({ patientId }: { patientId: string }) {
  const { data, isLoading, error, refetch } = useMessages(patientId);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [data?.length]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b bg-muted/60 px-4 py-3">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary-soft text-primary">
          <Brain className="h-4 w-4" strokeWidth={1.6} aria-hidden />
        </span>
        <span className="text-sm font-bold">UNNAMED care line</span>
      </div>
      <div ref={box} className="flex-1 space-y-3 overflow-y-auto px-3 py-4" aria-live="polite" aria-label="Message thread">
        {isLoading && <Loading label="Loading messages" />}
        {error && <ErrorState error={error} onRetry={() => refetch()} />}
        {data && data.length === 0 && <Empty>No messages yet.</Empty>}
        {(data ?? []).map((m, i) => (
          <div key={i} className={cn("flex", m.dir === "out" ? "justify-end" : "justify-start")}>
            <div
              className={cn(
                "max-w-[82%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed",
                m.dir === "out" ? "bg-bubble-out text-white" : "bg-bubble-in text-bubble-in-foreground",
              )}
            >
              <p className="break-words">{m.body}</p>
              <p className={cn("mt-1 text-[10px]", m.dir === "out" ? "text-white/75" : "text-muted-foreground")}>
                {fmtTime(m.time)} &middot; {CHANNEL[m.channel]}
              </p>
            </div>
          </div>
        ))}
      </div>
      <p className="border-t px-4 py-2 text-[10px] text-muted-foreground">
        Polled every two seconds. Each bubble shows the channel that actually delivered it, so an SMS is never passed
        off as an iMessage.
      </p>
    </div>
  );
}

export default function Phone() {
  const { id = "" } = useParams();
  const patient = usePatient(id);
  const [token, setToken] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  const openCallPage = async () => {
    setOpening(true);
    try {
      const start = await api.createCall(id, false);
      setToken(start.token);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create a call link");
    } finally {
      setOpening(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="flex flex-wrap items-center gap-3 border-b border-border/70 px-5 py-4">
        <span className="flex h-9 w-9 items-center justify-center rounded-2xl border border-primary/15 bg-primary-soft text-primary">
          <Smartphone className="h-5 w-5" strokeWidth={1.5} aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-lg font-black leading-tight">unnamed.</p>
          <p className="truncate text-[11px] text-muted-foreground">
            Phone mock{patient.data ? ` for ${patient.data.name}` : ""}
          </p>
        </div>
        <SyntheticBadge className="ml-1" />
        <div className="ml-auto flex flex-wrap gap-2">
          <Button onClick={() => void openCallPage()} disabled={opening || !id}>
            <ExternalLink aria-hidden /> {opening ? "Creating a link" : "Open call page"}
          </Button>
          <Button variant="outline" asChild>
            <Link to={`/patients/${id}`}>Patient record</Link>
          </Button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1100px] px-5 py-8">
        {patient.isLoading && <Loading label="Loading the patient" />}
        {patient.error && <ErrorState error={patient.error} onRetry={() => patient.refetch()} />}

        <div className="flex flex-wrap items-start justify-center gap-10">
          <PhoneFrame label="The message thread">
            <Thread patientId={id} />
          </PhoneFrame>

          <PhoneFrame label={token ? "The call page the link opens" : "Call page, not opened yet"}>
            {token ? (
              <iframe
                src={`/call/${token}`}
                title="The patient call page"
                className="h-full w-full border-0"
                allow="camera; microphone"
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-sm text-muted-foreground">
                <Smartphone className="h-8 w-8" aria-hidden />
                <p>Press open call page to create a link and load it here, next to the thread.</p>
              </div>
            )}
          </PhoneFrame>
        </div>

        <p className="mx-auto mt-8 max-w-xl text-center text-[11px] leading-relaxed text-muted-foreground">
          This is research software with synthetic patients. Nothing here is a diagnosis and nothing here replaces a
          doctor. The call page asks for camera access, which a browser only grants over HTTPS.
        </p>
      </main>
    </div>
  );
}
