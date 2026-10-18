import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { FastForward, Phone, RotateCcw, TrendingUp, UserPlus } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, useAction, useAlerts, usePatients } from "@/api/client";
import { useRig } from "@/api/ws";
import { FlagChip, PageHeader, Panel } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { useApp } from "@/store/app";

export const Route = createFileRoute("/_clinic/demo")({
  head: () => ({
    meta: [
      { title: "Demo console | UNNAMED" },
      { name: "description", content: "Presenter controls to advance weeks, inject drift and trigger calls." },
      { property: "og:title", content: "Demo console | UNNAMED" },
      { property: "og:description", content: "Presenter controls for the live demo." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Demo,
});

function Demo() {
  const { data: patients } = usePatients();
  const sel = useApp((s) => s.selectedPatient);
  const setSel = useApp((s) => s.setSelectedPatient);
  const demo = useApp((s) => s.demo);
  const setDemo = useApp((s) => s.setDemo);
  const { data: alerts } = useAlerts(sel ?? undefined);
  const rig = useRig();
  const navigate = useNavigate();
  const [ringing, setRinging] = useState(false);

  useEffect(() => { if (!sel && patients?.length) setSel(patients.find((p) => p.week > 0)?.id ?? patients[0].id); }, [patients, sel, setSel]);
  useEffect(() => { if (ringing && rig.status === "In call") { setRinging(false); toast.success("Patient picked up. In call."); } }, [rig.status, ringing]);

  const p = patients?.find((x) => x.id === sel);
  const err = (e: Error) => toast.error(e.message);
  const advance = useAction(() => api.advanceWeek(sel!), { onSuccess: () => { setDemo({ lastAction: "Advanced one week" }); toast.success("Advanced one week"); }, onError: err });
  const drift = useAction(() => api.injectDrift(sel!, demo.driftSize), { onSuccess: () => { setDemo({ lastAction: `Injected drift ${demo.driftSize}` }); toast.success("Drift injected"); }, onError: err });
  const trigger = useAction(() => api.triggerCall(sel!), { onSuccess: () => { setRinging(true); setDemo({ lastAction: "Triggered call" }); }, onError: err });
  const reset = useAction(() => api.reset(), { onSuccess: () => { setSel(null); setDemo({ lastAction: "Cohort reset" }); toast.success("Cohort reset"); }, onError: err });
  const load = useAction(() => api.createPatient({ name: "Sam Rivera", age: 28, sex: "M" }), { onSuccess: (pt) => { setSel(pt.id); setDemo({ lastAction: "Loaded synthetic patient" }); navigate({ to: "/patients/$id/upload", params: { id: pt.id } }); }, onError: err });

  const actions = [
    { key: "1", label: "Advance week", icon: FastForward, run: () => advance.mutate(undefined) },
    { key: "2", label: "Inject drift", icon: TrendingUp, run: () => drift.mutate(undefined) },
    { key: "3", label: "Trigger call", icon: Phone, run: () => trigger.mutate(undefined) },
    { key: "4", label: "Reset cohort", icon: RotateCcw, run: () => reset.mutate(undefined) },
    { key: "5", label: "Load synthetic patient", icon: UserPlus, run: () => load.mutate(undefined) },
  ];

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input,textarea,[role=slider]")) return;
      const a = actions.find((x) => x.key === e.key);
      if (a && sel) { e.preventDefault(); a.run(); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });

  const lastAlert = alerts?.[0];

  return (
    <>
      <PageHeader title="Demo console" subtitle="Keyboard: 1 to 5 trigger the buttons in order." />
      {ringing && (
        <div className="fixed inset-x-0 top-0 z-50 flex h-40 items-center justify-center gap-6 bg-primary text-primary-foreground shadow-2xl" role="alert" aria-live="assertive">
          <div className="relative flex h-16 w-16 items-center justify-center">
            <span className="ring-wave absolute inset-0 rounded-full bg-primary-foreground/40" />
            <span className="ring-pulse relative flex h-16 w-16 items-center justify-center rounded-full bg-primary-foreground text-primary"><Phone className="h-7 w-7" /></span>
          </div>
          <div><p className="text-3xl font-semibold">Phone ringing</p><p className="opacity-80">Calling {p?.name} on FaceTime</p></div>
          <Button variant="secondary" onClick={() => setRinging(false)}>Dismiss</Button>
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <Panel title="Patient">
            <Select value={sel ?? undefined} onValueChange={setSel}>
              <SelectTrigger aria-label="Pick patient"><SelectValue placeholder="Pick a patient" /></SelectTrigger>
              <SelectContent>{patients?.map((x) => <SelectItem key={x.id} value={x.id}>{x.name} (week {x.week})</SelectItem>)}</SelectContent>
            </Select>
          </Panel>
          <div className="grid gap-4 sm:grid-cols-2">
            {actions.map((a) => (
              <Button key={a.key} size="lg" variant={a.key === "3" ? "default" : "outline"} className="h-24 justify-start gap-4 text-lg" onClick={a.run} disabled={!sel}>
                <a.icon className="h-6 w-6" /> {a.label}
                <kbd className="ml-auto rounded border px-2 py-0.5 font-mono text-xs opacity-70">{a.key}</kbd>
              </Button>
            ))}
          </div>
          <Panel title={`Drift size: ${demo.driftSize.toFixed(1)} SD`}>
            <Slider min={0.5} max={4} step={0.1} value={[demo.driftSize]} onValueChange={([v]) => setDemo({ driftSize: v })} aria-label="Drift size" />
          </Panel>
        </div>
        <Panel title="Live state">
          <dl className="space-y-4">
            <div><dt className="text-xs text-muted-foreground">Week</dt><dd className="font-mono text-4xl font-semibold">{p?.week ?? "n/a"}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Drift z</dt><dd className="font-mono text-4xl font-semibold">{p?.drift_z.toFixed(2) ?? "n/a"}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Rig</dt><dd className="font-medium">{rig.status}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Last alert</dt><dd className="mt-1 text-sm">{lastAlert ? <><FlagChip flag={lastAlert.type} /><p className="mt-1 text-muted-foreground">{lastAlert.trigger}</p></> : "None"}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Last action</dt><dd className="text-sm">{demo.lastAction ?? "None"}</dd></div>
          </dl>
        </Panel>
      </div>
    </>
  );
}
