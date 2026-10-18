import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { useMessages, usePatient } from "@/api/client";
import { ErrorState } from "@/components/common";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/phone/$id")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Phone view | Synapshot" },
      { name: "description", content: "Stage view of the patient's text message thread." },
      { property: "og:title", content: "Phone view | Synapshot" },
      { property: "og:description", content: "Patient text message thread." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Phone,
});

function Phone() {
  const { id } = Route.useParams();
  const m = useMessages(id);
  const p = usePatient(id);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth" }); }, [m.data?.length]);
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted p-4">
      <div className="relative flex h-[min(820px,92vh)] w-full max-w-[390px] flex-col overflow-hidden rounded-[3rem] border-[10px] border-foreground bg-card shadow-2xl">
        <div className="absolute left-1/2 top-2 z-10 h-7 w-28 -translate-x-1/2 rounded-full bg-foreground" aria-hidden />
        <header className="border-b bg-muted/60 px-4 pb-2 pt-12 text-center">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">CL</div>
          <p className="mt-1 text-xs font-medium">Care line</p>
          <p className="text-[10px] text-muted-foreground">to {p.data?.name ?? "patient"}</p>
        </header>
        <div className="flex-1 space-y-2 overflow-y-auto px-3 py-4" aria-live="polite">
          {m.error && <ErrorState error={m.error} />}
          {m.data?.map((msg, i) => (
            <div key={i} className={cn("flex flex-col", msg.dir === "out" ? "items-start" : "items-end")}>
              <p className={cn("max-w-[78%] rounded-2xl px-3 py-2 text-[15px] leading-snug", msg.dir === "out" ? "bg-bubble-in text-bubble-in-foreground" : "bg-bubble-out text-primary-foreground")}>{msg.body}</p>
              <span className="mt-0.5 px-1 text-[10px] text-muted-foreground">{new Date(msg.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
            </div>
          ))}
          <div ref={end} />
        </div>
        <div className="border-t p-3"><div className="rounded-full border px-4 py-2 text-sm text-muted-foreground">iMessage</div></div>
      </div>
    </main>
  );
}
