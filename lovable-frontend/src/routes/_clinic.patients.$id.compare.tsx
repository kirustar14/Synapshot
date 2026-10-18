import { createFileRoute } from "@tanstack/react-router";
import { ArrowLeftRight, Play, Plus, X } from "lucide-react";
import { Suspense, useState } from "react";
import { toast } from "sonner";
import { api, usePatient, useTwin } from "@/api/client";
import type { ScenarioResult } from "@/api/types";
import { Brain3D } from "@/components/Brain3D";
import { Empty, ErrorState, Loading, ModelLabel, Panel, SyntheticBadge } from "@/components/common";
import { ForecastGrid } from "@/components/ForecastChart";
import { PatientHeader } from "@/components/PatientHeader";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { useApp, type ScenarioSlot } from "@/store/app";

export const Route = createFileRoute("/_clinic/patients/$id/compare")({
  head: () => ({
    meta: [
      { title: "Scenario compare | Synapshot" },
      { name: "description", content: "Compare recovery forecasts under different helmet and impact scenarios." },
      { property: "og:title", content: "Scenario compare | Synapshot" },
      { property: "og:description", content: "Side by side recovery forecasts for two scenarios." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Compare,
});

function Compare() {
  const { id } = Route.useParams();
  const p = usePatient(id);
  const t = useTwin(id);
  const scenarios = useApp((s) => s.scenarios);
  const setScenarios = useApp((s) => s.setScenarios);
  const [left, setLeft] = useState(scenarios[0]?.id ?? "");
  const [right, setRight] = useState(scenarios[1]?.id ?? "");
  const [res, setRes] = useState<ScenarioResult | null>(null);
  const [busy, setBusy] = useState(false);

  if (p.isLoading) return <Loading />;
  if (p.error || !p.data) return <ErrorState error={p.error} onRetry={p.refetch} />;

  const A = scenarios.find((s) => s.id === left);
  const B = scenarios.find((s) => s.id === right);
  const update = (sid: string, patch: Partial<ScenarioSlot["scenario"]>) => setScenarios(scenarios.map((s) => (s.id === sid ? { ...s, scenario: { ...s.scenario, ...patch } } : s)));
  const run = async () => {
    if (!A || !B) return toast.error("Pick a scenario on both sides");
    setBusy(true);
    try { setRes(await api.scenarios(id, { a: A.scenario, b: B.scenario })); } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  const add = () => {
    const n = { id: `s${Date.now()}`, label: `Scenario ${scenarios.length + 1}`, scenario: { helmet: "A", angle_deg: 45 } };
    setScenarios([...scenarios, n]); toast.success(`${n.label} added`);
  };
  const remove = (sid: string) => {
    if (scenarios.length <= 2) return toast.error("Keep at least two scenarios");
    const rest = scenarios.filter((s) => s.id !== sid);
    setScenarios(rest);
    if (left === sid) setLeft(rest[0].id);
    if (right === sid) setRight(rest[rest.length - 1].id);
    setRes(null);
  };

  const Side = ({ slot, which, onPick }: { slot?: ScenarioSlot; which: "a" | "b"; onPick: (v: string) => void }) => (
    <div className="space-y-4">
      <Panel title={which === "a" ? "Side A" : "Side B"} action={slot && <Button size="sm" variant="ghost" onClick={() => remove(slot.id)} aria-label={`Remove ${slot.label}`}><X className="h-4 w-4" /> Remove</Button>}>
        <div className="grid gap-4">
          <Select value={slot?.id} onValueChange={onPick}>
            <SelectTrigger aria-label={`Scenario for side ${which.toUpperCase()}`}><SelectValue placeholder="Pick a scenario" /></SelectTrigger>
            <SelectContent>{scenarios.map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}</SelectContent>
          </Select>
          {slot && (
            <>
              <div className="grid gap-1.5"><p className="text-xs font-medium">Helmet</p>
                <Select value={slot.scenario.helmet} onValueChange={(v) => update(slot.id, { helmet: v })}><SelectTrigger aria-label="Helmet"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="A">Helmet A</SelectItem><SelectItem value="B">Helmet B</SelectItem><SelectItem value="None">No helmet</SelectItem></SelectContent></Select>
              </div>
              <div className="grid gap-2"><p className="text-xs font-medium">Impact angle: {slot.scenario.angle_deg} deg</p><Slider min={0} max={90} step={5} value={[slot.scenario.angle_deg]} onValueChange={([v]) => update(slot.id, { angle_deg: v })} aria-label="Impact angle" /></div>
            </>
          )}
        </div>
      </Panel>
      <div className="panel h-56 overflow-hidden p-0">
        {t.data ? <Suspense fallback={<Loading />}><Brain3D twin={t.data} week={0} layer="damage" compact /></Suspense> : <Loading />}
      </div>
      {res ? <ForecastGrid forecast={which === "a" ? res.a : res.b} compact /> : <Empty>Press Run to forecast this scenario.</Empty>}
    </div>
  );

  return (
    <div>
      <PatientHeader patient={p.data} />
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <Button onClick={run} disabled={busy}><Play className="h-4 w-4" /> {busy ? "Running" : "Run"}</Button>
        <Button variant="outline" onClick={add}><Plus className="h-4 w-4" /> Add scenario</Button>
        <Button variant="outline" onClick={() => { setLeft(right); setRight(left); if (res) setRes({ a: res.b, b: res.a, diff: res.diff.map((d) => ({ ...d, a: d.b, b: d.a })) }); }}><ArrowLeftRight className="h-4 w-4" /> Swap sides</Button>
        <span className="ml-auto flex gap-2"><ModelLabel /><SyntheticBadge /></span>
      </div>
      {res && (
        <Panel title="Parameters that differ" className="mb-6">
          {res.diff.length === 0 ? <Empty>Both scenarios are identical.</Empty> : (
            <table className="w-full text-sm"><thead className="text-left text-xs text-muted-foreground"><tr><th className="py-1 font-medium">Parameter</th><th className="font-medium">A</th><th className="font-medium">B</th></tr></thead>
              <tbody>{res.diff.map((d) => <tr key={d.param} className="border-t"><td className="py-2">{d.param}</td><td className="font-mono">{d.a}</td><td className="font-mono">{d.b}</td></tr>)}</tbody></table>
          )}
        </Panel>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <Side slot={A} which="a" onPick={setLeft} />
        <Side slot={B} which="b" onPick={setRight} />
      </div>
    </div>
  );
}
