import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle2 } from "lucide-react";
import { useState } from "react";
import { api, useConsent } from "@/api/client";
import { ErrorState, Loading } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

export const Route = createFileRoute("/consent/$token")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Weekly check-in consent | Synapshot" },
      { name: "description", content: "Review and agree to weekly FaceTime check-ins with your care team." },
      { property: "og:title", content: "Weekly check-in consent | Synapshot" },
      { property: "og:description", content: "Consent for weekly FaceTime check-ins." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Consent,
});

function Consent() {
  const { token } = Route.useParams();
  const q = useConsent(token);
  const [c, setC] = useState({ calls: true, ai: true, recording: true, genetic: false });
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <div className="p-4"><ErrorState error={q.error} onRetry={q.refetch} /></div>;
  if (done)
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center p-6 text-center">
        <CheckCircle2 className="h-12 w-12 text-success" aria-hidden />
        <h1 className="mt-4 text-2xl font-semibold">Thank you</h1>
        <p className="mt-2 text-muted-foreground">Your choices are saved. You can change them any time by replying STOP or calling your clinic.</p>
      </main>
    );
  const Row = ({ k, label, desc }: { k: keyof typeof c; label: string; desc: string }) => (
    <label className="flex items-start justify-between gap-4 rounded-xl border bg-card p-4">
      <span><span className="block font-medium">{label}</span><span className="mt-0.5 block text-sm text-muted-foreground">{desc}</span></span>
      <Switch checked={c[k]} onCheckedChange={(v) => setC({ ...c, [k]: v })} aria-label={label} />
    </label>
  );
  return (
    <main className="mx-auto max-w-md p-5 pb-10">
      <p className="text-xs font-semibold tracking-[0.18em] text-primary">Synapshot</p>
      <h1 className="mt-2 text-2xl font-semibold">Hi {q.data.patient_name.split(" ")[0]}</h1>
      <div className="mt-4 space-y-3 text-[15px] leading-relaxed">{q.data.text.map((t, i) => <p key={i}>{t}</p>)}</div>
      <div className="mt-6 space-y-3">
        <Row k="calls" label="Weekly calls" desc="A 10 minute FaceTime call once a week." />
        <Row k="ai" label="AI runs the call" desc="I understand an AI system asks the questions and measures my answers." />
        <Row k="recording" label="Recording" desc="The call video and audio are recorded so they can be checked." />
        <Row k="genetic" label="Genetic data (optional)" desc="Off by default. If on, a DNA sample may slightly adjust the starting guess for how fast you recover. Saying no does not change your care." />
      </div>
      <Button className="mt-6 h-12 w-full text-base" disabled={busy || !c.calls} onClick={async () => { setBusy(true); try { await api.submitConsent(token, c); setDone(true); } finally { setBusy(false); } }}>Accept</Button>
      {!c.calls && <p className="mt-2 text-center text-sm text-muted-foreground">Weekly calls must be on to continue.</p>}
    </main>
  );
}
