import { createFileRoute } from "@tanstack/react-router";
import { Footprints, Ear, AlertTriangle } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/stretch/$token")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Walk and hearing check | UNNAMED" },
      { name: "description", content: "A short walking test and hearing tone check on your phone." },
      { property: "og:title", content: "Walk and hearing check | UNNAMED" },
      { property: "og:description", content: "Short walking and hearing checks." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Stretch,
});

function Stretch() {
  const { token } = Route.useParams();
  return (
    <main className="mx-auto max-w-md p-5 pb-10">
      <p className="text-xs font-semibold tracking-[0.18em] text-primary">UNNAMED</p>
      <h1 className="mt-2 text-2xl font-semibold">Two quick checks</h1>
      <div className="mt-4 flex gap-3 rounded-xl border border-synthetic/40 bg-synthetic-soft p-4 text-sm text-synthetic-foreground">
        <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden /> Stop right away if you feel dizzy or unsteady. Walk somewhere flat and clear, with someone nearby if possible.
      </div>
      <Tabs defaultValue="gait" className="mt-6">
        <TabsList className="w-full"><TabsTrigger value="gait" className="flex-1">Walk</TabsTrigger><TabsTrigger value="hear" className="flex-1">Hearing</TabsTrigger></TabsList>
        <TabsContent value="gait"><Gait token={token} /></TabsContent>
        <TabsContent value="hear"><Hearing token={token} /></TabsContent>
      </Tabs>
    </main>
  );
}

function Gait({ token }: { token: string }) {
  const [phase, setPhase] = useState<"idle" | "run" | "done">("idle");
  const [left, setLeft] = useState(20);
  const [res, setRes] = useState<{ steps: number; cadence: number; variability: number } | null>(null);
  const [manual, setManual] = useState("");

  const finish = async (r: { steps: number; cadence: number; variability: number }) => {
    setRes(r); setPhase("done");
    try { await api.stretch(token, { gait: r }); toast.success("Walk result sent"); } catch { toast.error("Could not send, please try again"); }
  };

  const start = async () => {
    const DM = (window as unknown as { DeviceMotionEvent?: { requestPermission?: () => Promise<string> } }).DeviceMotionEvent;
    if (!DM) { toast("No motion sensor found. Use manual entry below."); return; }
    try { if (DM.requestPermission && (await DM.requestPermission()) !== "granted") { toast("Motion permission denied. Use manual entry."); return; } } catch { /* ignore */ }
    const times: number[] = [];
    let above = false, got = false;
    const h = (e: DeviceMotionEvent) => {
      const a = e.accelerationIncludingGravity; if (!a) return; got = true;
      const mag = Math.sqrt((a.x ?? 0) ** 2 + (a.y ?? 0) ** 2 + (a.z ?? 0) ** 2);
      if (!above && mag > 11.5) { above = true; const now = performance.now(); if (!times.length || now - times[times.length - 1] > 250) times.push(now); }
      if (above && mag < 10) above = false;
    };
    window.addEventListener("devicemotion", h);
    setPhase("run"); setLeft(20);
    const iv = setInterval(() => setLeft((l) => l - 1), 1000);
    setTimeout(() => {
      clearInterval(iv); window.removeEventListener("devicemotion", h);
      if (!got) { setPhase("idle"); toast("No motion data. Use manual entry below."); return; }
      const iv2 = times.slice(1).map((t, i) => t - times[i]);
      const mean = iv2.reduce((s, x) => s + x, 0) / (iv2.length || 1);
      const sd = Math.sqrt(iv2.reduce((s, x) => s + (x - mean) ** 2, 0) / (iv2.length || 1));
      finish({ steps: times.length, cadence: Math.round((times.length / 20) * 60), variability: Math.round((sd / (mean || 1)) * 1000) / 10 });
    }, 20000);
  };

  return (
    <div className="mt-4 space-y-4">
      <p className="text-[15px]">Hold your phone against your chest or put it in a front pocket. Tap start and walk at your normal pace for 20 seconds.</p>
      {phase === "run" ? (
        <div className="rounded-2xl bg-primary-soft p-8 text-center" role="status"><p className="font-mono text-6xl font-semibold">{left}</p><p className="text-sm text-muted-foreground">seconds left, keep walking</p></div>
      ) : (
        <Button className="h-12 w-full text-base" onClick={start}><Footprints className="h-5 w-5" /> Start 20 second walk</Button>
      )}
      {res && (
        <div className="grid grid-cols-3 gap-2 rounded-xl border bg-card p-4 text-center">
          <div><p className="font-mono text-2xl font-semibold">{res.steps}</p><p className="text-xs text-muted-foreground">steps</p></div>
          <div><p className="font-mono text-2xl font-semibold">{res.cadence}</p><p className="text-xs text-muted-foreground">steps per min</p></div>
          <div><p className="font-mono text-2xl font-semibold">{res.variability}%</p><p className="text-xs text-muted-foreground">variability</p></div>
        </div>
      )}
      <details className="rounded-xl border p-4 text-sm">
        <summary className="cursor-pointer font-medium">No sensor? Enter steps by hand</summary>
        <p className="mt-2 text-muted-foreground">Count your steps while walking for 20 seconds.</p>
        <div className="mt-2 flex gap-2">
          <Input type="number" inputMode="numeric" value={manual} onChange={(e) => setManual(e.target.value)} aria-label="Steps counted" placeholder="Steps" />
          <Button variant="outline" onClick={() => { const n = Number(manual); if (n > 0) finish({ steps: n, cadence: Math.round(n * 3), variability: 0 }); }}>Save</Button>
        </div>
      </details>
    </div>
  );
}

const FREQS = [500, 1000, 2000, 4000];
const LEVELS = [-10, -20, -30, -40, -50, -60, -70];

function Hearing({ token }: { token: string }) {
  const ctx = useRef<AudioContext | null>(null);
  const [fi, setFi] = useState(0);
  const [li, setLi] = useState(0);
  const [running, setRunning] = useState(false);
  const [th, setTh] = useState<Record<string, number>>({});
  const [done, setDone] = useState(false);

  const play = (f: number, db: number) => {
    const c = (ctx.current ??= new AudioContext());
    const o = c.createOscillator(), g = c.createGain();
    o.frequency.value = f; const amp = Math.pow(10, db / 20);
    g.gain.setValueAtTime(0, c.currentTime); g.gain.linearRampToValueAtTime(amp, c.currentTime + 0.05); g.gain.setValueAtTime(amp, c.currentTime + 0.9); g.gain.linearRampToValueAtTime(0, c.currentTime + 1);
    o.connect(g).connect(c.destination); o.start(); o.stop(c.currentTime + 1.05);
  };
  const begin = () => { setRunning(true); setFi(0); setLi(0); setTh({}); setDone(false); play(FREQS[0], LEVELS[0]); };
  const next = async (heard: boolean) => {
    let nf = fi, nl = li; const t = { ...th };
    if (heard && li < LEVELS.length - 1) nl = li + 1;
    else { t[String(FREQS[fi])] = heard ? LEVELS[li] : li === 0 ? 0 : LEVELS[li - 1]; nf = fi + 1; nl = 0; }
    setTh(t);
    if (nf >= FREQS.length) {
      setRunning(false); setDone(true);
      try { await api.stretch(token, { hearing: { thresholds: t } }); toast.success("Hearing result sent"); } catch { toast.error("Could not send"); }
      return;
    }
    setFi(nf); setLi(nl); setTimeout(() => play(FREQS[nf], LEVELS[nl]), 400);
  };

  return (
    <div className="mt-4 space-y-4">
      <p className="text-[15px]">Use headphones in a quiet room. Set your volume to about half. You will hear tones that get quieter. Tap "I hear it" each time you hear one.</p>
      {!running ? <Button className="h-12 w-full text-base" onClick={begin}><Ear className="h-5 w-5" /> {done ? "Start again" : "Start hearing check"}</Button> : (
        <div className="space-y-3 rounded-2xl bg-primary-soft p-5 text-center" role="status">
          <p className="text-sm text-muted-foreground">Tone {fi + 1} of 4, step {li + 1}</p>
          <Button className="h-16 w-full text-lg" onClick={() => next(true)}>I hear it</Button>
          <div className="flex gap-2"><Button variant="outline" className="flex-1" onClick={() => next(false)}>I do not hear it</Button><Button variant="ghost" className="flex-1" onClick={() => play(FREQS[fi], LEVELS[li])}>Play again</Button></div>
        </div>
      )}
      {Object.keys(th).length > 0 && (
        <ul className="grid grid-cols-4 gap-2 text-center">{FREQS.map((f) => <li key={f} className="rounded-lg border bg-card p-2"><p className="text-xs text-muted-foreground">{f} Hz</p><p className="font-mono font-semibold">{th[f] ?? "..."}</p></li>)}</ul>
      )}
      {done && <p className="text-sm text-muted-foreground">Thank you. Numbers are quietest level heard, in dB relative to full volume.</p>}
    </div>
  );
}
