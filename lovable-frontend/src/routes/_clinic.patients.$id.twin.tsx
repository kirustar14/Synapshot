import { createFileRoute } from "@tanstack/react-router";
import { Pause, Play } from "lucide-react";
import { Suspense, useEffect, useRef, useState } from "react";
import { api, useAttribution, useForecast, usePatient, useTwin } from "@/api/client";
import type { Forecast } from "@/api/types";
import { Brain3D, type Layer } from "@/components/Brain3D";
import { ErrorState, Loading, ModelLabel, Panel, SyntheticBadge } from "@/components/common";
import { ForecastGrid } from "@/components/ForecastChart";
import { PatientHeader } from "@/components/PatientHeader";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export const Route = createFileRoute("/_clinic/patients/$id/twin")({
  head: () => ({
    meta: [
      { title: "Twin viewer | UNNAMED" },
      { name: "description", content: "3D brain twin with tract damage, activity and recovery over 12 weeks." },
      { property: "og:title", content: "Twin viewer | UNNAMED" },
      { property: "og:description", content: "Explore the 3D brain twin and counterfactual recovery." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: TwinPage,
});

const LAYERS: { v: Layer; label: string }[] = [
  { v: "damage", label: "Tract damage" }, { v: "activity", label: "Simulated activity" },
  { v: "ei", label: "Regional E/I map" }, { v: "diff", label: "Template vs personal" },
];

function TwinPage() {
  const { id } = Route.useParams();
  const p = usePatient(id);
  const t = useTwin(id);
  const f = useForecast(id);
  const attr = useAttribution(id);
  const [layer, setLayer] = useState<Layer>("damage");
  const [week, setWeek] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [sel, setSel] = useState<number | null>(null);
  const [kMult, setKMult] = useState(1);
  const [pAdd, setPAdd] = useState(0);
  const [cf, setCf] = useState<Forecast | null>(null);
  const raf = useRef<number>(0);

  useEffect(() => { if (p.data) setWeek(p.data.week); }, [p.data?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05); last = now;
      setWeek((w) => { const n = w + dt * 1.5; return n >= 12 ? 0 : n; });
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [playing]);

  useEffect(() => {
    if (kMult === 1 && pAdd === 0) { setCf(null); return; }
    const h = setTimeout(() => { api.counterfactual(id, { k_mult: kMult, p_add: pAdd }).then(setCf).catch(() => setCf(null)); }, 300);
    return () => clearTimeout(h);
  }, [id, kMult, pAdd]);

  if (p.isLoading || t.isLoading) return <Loading label="Loading twin" />;
  if (p.error || !p.data) return <ErrorState error={p.error} onRetry={p.refetch} />;
  if (t.error || !t.data) return <ErrorState error={t.error} onRetry={t.refetch} />;
  const twin = t.data;
  const wi = Math.round(week);
  const region = sel != null && sel >= 0 ? twin.regions[sel] : null;

  return (
    <div>
      <PatientHeader patient={p.data} />
      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          <div className="panel relative overflow-hidden p-0">
            <div className="absolute left-4 top-4 z-10 flex flex-wrap gap-2">
              <span className="rounded-full bg-card/90 px-2.5 py-1 shadow-sm"><ModelLabel /></span>
              <SyntheticBadge className="bg-card/90" />
            </div>
            <div className="h-[520px] bg-gradient-to-b from-card to-muted">
              <Suspense fallback={<Loading label="Rendering" />}>
                <Brain3D twin={twin} week={week} layer={layer} selected={sel} onSelect={(i) => setSel(i < 0 ? null : i)} />
              </Suspense>
            </div>
            {region && (
              <div className="absolute bottom-4 left-4 z-10 rounded-lg border bg-card/95 p-3 text-xs shadow-lg" role="status">
                <p className="font-semibold">{region.name}</p>
                <p className="text-muted-foreground">Damage week 0: {region.damage[0].toFixed(2)}, week {wi}: {region.damage[wi].toFixed(2)}</p>
                <p className="text-muted-foreground">Activity {region.activity[wi].toFixed(2)} &middot; E/I {region.ei.toFixed(2)} (template {region.template_ei.toFixed(2)})</p>
              </div>
            )}
          </div>
          <div className="panel flex flex-wrap items-center gap-4 p-4">
            <ToggleGroup type="single" value={layer} onValueChange={(v) => v && setLayer(v as Layer)} aria-label="Layer" className="flex-wrap">
              {LAYERS.map((l) => <ToggleGroupItem key={l.v} value={l.v} className="text-xs">{l.label}</ToggleGroupItem>)}
            </ToggleGroup>
            <div className="flex min-w-64 flex-1 items-center gap-3">
              <Button size="icon" variant="outline" onClick={() => setPlaying(!playing)} aria-label={playing ? "Pause" : "Play"}>{playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}</Button>
              <Slider min={0} max={12} step={0.01} value={[week]} onValueChange={([v]) => { setPlaying(false); setWeek(v); }} aria-label="Week" className="flex-1" />
              <span className="w-16 font-mono text-sm tabular-nums">Wk {week.toFixed(1)}</span>
            </div>
          </div>
        </div>

        <Tabs defaultValue="tracts">
          <TabsList className="w-full"><TabsTrigger value="tracts" className="flex-1">Affected tracts</TabsTrigger><TabsTrigger value="attr" className="flex-1">Tract attribution</TabsTrigger></TabsList>
          <TabsContent value="tracts">
            <Panel title="Most affected tracts" subtitle={`Damage at week 0 and week ${wi}`}>
              <ul className="space-y-3">
                {twin.top_tracts.map((tr, i) => {
                  const e = [...twin.edges].sort((a, b) => b.damage[0] - a.damage[0])[i];
                  const now = e ? e.damage[wi] : tr.damage_now;
                  return (
                    <li key={tr.name} className="text-xs">
                      <p className="font-medium leading-snug">{tr.name}</p>
                      <div className="mt-1 flex items-center gap-2">
                        <div className="relative h-1.5 flex-1 rounded-full bg-muted">
                          <div className="absolute h-1.5 rounded-full bg-destructive/30" style={{ width: `${tr.damage_w0 * 100}%` }} />
                          <div className="absolute h-1.5 rounded-full bg-destructive" style={{ width: `${now * 100}%` }} />
                        </div>
                        <span className="w-20 text-right font-mono tabular-nums">{tr.damage_w0.toFixed(2)} to {now.toFixed(2)}</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Panel>
          </TabsContent>
          <TabsContent value="attr">
            <Panel title="Tract attribution" action={<span className="rounded-full border border-chart-2/40 bg-accent px-2 py-0.5 text-[11px] font-medium text-accent-foreground">Hypothesis</span>}>
              {attr.isLoading ? <Loading /> : attr.error ? <ErrorState error={attr.error} /> : (
                <ul className="space-y-4">
                  {attr.data?.map((a) => (
                    <li key={a.signal} className="text-xs">
                      <p className="font-semibold">{a.signal}</p>
                      {a.tracts.map((tr) => <p key={tr.name} className="flex justify-between gap-2 text-muted-foreground"><span className="truncate">{tr.name}</span><span className="font-mono">{tr.score.toFixed(2)}</span></p>)}
                    </li>
                  ))}
                  <li className="text-[11px] text-muted-foreground">{attr.data?.[0]?.note}</li>
                </ul>
              )}
            </Panel>
          </TabsContent>
        </Tabs>
      </div>

      <Panel className="mt-6" title="Counterfactual" subtitle="What if recovery were faster or slower? The dashed line shows the new forecast." action={<Button variant="ghost" size="sm" onClick={() => { setKMult(1); setPAdd(0); }}>Reset</Button>}>
        <div className="mb-5 grid gap-6 md:grid-cols-2">
          <div className="grid gap-2"><p className="text-sm">Recovery rate multiplier: <b className="font-mono">{kMult.toFixed(2)}x</b></p><Slider min={0.5} max={2} step={0.05} value={[kMult]} onValueChange={([v]) => setKMult(v)} aria-label="Recovery rate multiplier" /></div>
          <div className="grid gap-2"><p className="text-sm">Permanent damage shift: <b className="font-mono">{pAdd >= 0 ? "+" : ""}{pAdd.toFixed(2)}</b></p><Slider min={-0.1} max={0.3} step={0.01} value={[pAdd]} onValueChange={([v]) => setPAdd(v)} aria-label="Permanent damage shift" /></div>
        </div>
        {f.data ? <ForecastGrid forecast={f.data} overlay={cf ?? undefined} compact /> : <Loading />}
      </Panel>
    </div>
  );
}
