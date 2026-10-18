import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { Plus, Search, ArrowUpRight, Activity, Users, CircleDot, ArrowRight, Brain } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { api, useAction, usePatients, useTwin } from "@/api/client";
import { Empty, ErrorState, FlagChip, fmtDate, Loading, PageHeader } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { Brain3D } from "@/components/Brain3D";

export const Route = createFileRoute("/_clinic/")({
  head: () => ({
    meta: [
      { title: "Patients | UNNAMED" },
      { name: "description", content: "Patients ranked by forecast drift, with flags for red flags, missed calls and low quality." },
      { property: "og:title", content: "Patients | UNNAMED" },
      { property: "og:description", content: "Patients ranked by forecast drift in the UNNAMED brain twin dashboard." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Patients,
});

function DriftBar({ z }: { z: number }) {
  const pct = Math.min(100, (z / 4) * 100);
  const tone = z > 2 ? "bg-destructive" : z > 1.2 ? "bg-synthetic" : "bg-primary";
  return (
    <div className="flex items-center gap-2" aria-label={`Drift z ${z.toFixed(2)}`}>
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted"><div className={cn("h-full rounded-full", tone)} style={{ width: `${pct}%` }} /></div>
      <span className="w-10 text-sm font-bold tabular-nums">{z.toFixed(2)}</span>
    </div>
  );
}

function Patients() {
  const { data, isLoading, error, refetch } = usePatients();
  const [alertsOnly, setAlertsOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const rows = useMemo(() => (data ?? []).filter((r) => (!alertsOnly || r.flags.length) && r.name.toLowerCase().includes(search.toLowerCase())).sort((a, b) => b.drift_z - a.drift_z), [data, alertsOnly, search]);
  const navigate = useNavigate();

  return (
    <>
      <p className="mb-3 flex items-center gap-2 text-xs font-bold text-primary"><span className="h-1.5 w-1.5 rounded-full bg-primary" /> RECOVERY OBSERVATORY</p>
      <PageHeader
        title="A clearer picture of recovery."
        subtitle="Your patients, their progress, and the signals that need a closer look."
        actions={<Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Add patient</Button>}
      />
      <div className="mb-9 grid min-w-0 gap-5 border-b border-border/80 pb-8 xl:grid-cols-[1fr_1.1fr]">
        <div className="grid grid-cols-3 gap-4 self-center py-3">
          <WorkspaceStat icon={Users} label="Patients followed" value={data ? String(data.length).padStart(2, "0") : "—"} tone="bg-lab-lilac" />
          <WorkspaceStat icon={Activity} label="With active flags" value={data ? String(data.filter((p) => p.flags.length > 0).length).padStart(2, "0") : "—"} tone="bg-lab-peach" />
          <WorkspaceStat icon={CircleDot} label="Forecast horizon" value="12" unit="weeks" tone="bg-primary-soft" />
        </div>
        {data?.[0] && <TwinPreview id={data[0].id} name={data[0].name} week={data[0].week} />}
      </div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
        <div><h2 className="text-xl font-extrabold">Patient workspace <span className="ml-2 text-sm font-semibold text-muted-foreground">{rows.length}</span></h2><p className="mt-1 text-xs text-muted-foreground">Largest forecast deviation first</p></div>
        <div className="flex flex-wrap items-center gap-4">
          <div className="relative"><Search className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-muted-foreground" /><Input className="h-10 w-52 rounded-full border-transparent bg-muted pl-10 shadow-none" aria-label="Search patients" placeholder="Find a patient…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
          <label className="flex items-center gap-2 text-xs font-bold"><Switch checked={alertsOnly} onCheckedChange={setAlertsOnly} aria-label="Show alerts only" /> Flagged only</label>
        </div>
      </div>
      <div className="relative w-full min-w-0 overflow-hidden rounded-2xl border border-border/80 bg-card">
        {isLoading ? <Loading /> : error ? <div className="p-5"><ErrorState error={error} onRetry={refetch} /></div> : rows.length === 0 ? <div className="p-5"><Empty>No patients match this filter.</Empty></div> : (
          <div className="overflow-x-auto">
            <table className="patient-table w-full text-sm">
              <thead className="bg-lab-surface text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-5 py-3.5">Patient</th><th className="px-3 py-3.5">Recovery week</th><th className="px-3 py-3.5" title="Standardized distance from the model forecast">Deviation · z</th>
                  <th className="px-3 py-3.5">Last check-in</th><th className="px-3 py-3.5">Clinical flags</th><th className="px-3 py-3.5"><span className="sr-only">Open record</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.id} className="cursor-pointer border-t transition-colors hover:bg-accent/40" onClick={() => navigate({ to: "/patients/$id", params: { id: r.id } })}>
                    <td className="px-5 py-3"><div className="flex items-center gap-3"><span aria-hidden className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl text-xs font-extrabold", ["bg-lab-lilac", "bg-primary-soft", "bg-lab-peach"][i % 3])}>{r.name.split(" ").map((n) => n[0]).slice(0, 2).join("")}</span><div><Link to="/patients/$id" params={{ id: r.id }} className="whitespace-nowrap font-extrabold hover:text-primary focus-visible:underline" onClick={(e) => e.stopPropagation()}>{r.name}</Link><p className="mt-0.5 text-[10px] text-muted-foreground">{r.synthetic ? "Synthetic participant" : "Patient record"}</p></div></div></td>
                    <td className="px-3 py-3 tabular-nums"><span className="font-extrabold">{String(r.week).padStart(2, "0")}</span><span className="text-xs text-muted-foreground"> / 12</span></td>
                    <td className="px-3 py-3"><DriftBar z={r.drift_z} /></td>
                    <td className="px-3 py-3 text-muted-foreground">{fmtDate(r.last_call)}</td>
                    <td className="px-3 py-3"><div className="flex flex-wrap gap-1">{r.flags.length ? r.flags.map((f) => <FlagChip key={f} flag={f} />) : <span className="inline-flex items-center gap-1.5 text-xs text-primary"><span className="h-1.5 w-1.5 rounded-full bg-primary" />No flags</span>}</div></td>
                    <td className="px-3 py-3"><Button asChild size="icon" variant="ghost"><Link to="/patients/$id" params={{ id: r.id }} aria-label={`Open ${r.name}'s record`} onClick={(e) => e.stopPropagation()}><ArrowUpRight className="h-4 w-4 text-muted-foreground" /></Link></Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div className="mt-4 flex flex-wrap justify-between gap-2 text-[11px] text-muted-foreground"><span className="inline-flex items-center gap-1.5"><Brain className="h-3.5 w-3.5" /> Personal brain twins · Weekly observations</span><span>Forecasts are model outputs, not clinical diagnoses.</span></div>
      <AddPatient open={open} onOpenChange={setOpen} />
    </>
  );
}

function WorkspaceStat({ icon: Icon, label, value, unit, tone }: { icon: typeof Users; label: string; value: string; unit?: string; tone: string }) {
  return <div className="min-w-0"><span className={cn("mb-4 flex h-10 w-10 items-center justify-center rounded-2xl", tone)}><Icon className="h-5 w-5" strokeWidth={1.6} /></span><p className="text-4xl font-extrabold tabular-nums">{value}<span className="ml-1 text-xs font-semibold text-muted-foreground">{unit}</span></p><p className="mt-2 text-xs font-semibold leading-relaxed text-muted-foreground">{label}</p></div>;
}

function TwinPreview({ id, name, week }: { id: string; name: string; week: number }) {
  const twin = useTwin(id);
  return <div className="workspace-visual relative grid min-h-52 grid-cols-[1fr_1fr] overflow-hidden rounded-3xl bg-lab-surface">
    <div className="z-10 flex flex-col items-start justify-center py-5 pl-6"><span className="mb-3 text-[10px] font-bold text-muted-foreground">IN SILICO · PERSONAL MODEL</span><h3 className="text-lg font-extrabold">The living connectome</h3><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{name}<br />Week {week} · Regional damage layer</p><Button asChild variant="link" className="mt-3 h-auto p-0 text-xs"><Link to="/patients/$id/twin" params={{ id }}>Explore brain twin <ArrowRight /></Link></Button></div>
    <div className="relative h-56 min-w-0">{twin.data ? <Brain3D twin={twin.data} week={week} layer="damage" compact /> : <div className="flex h-full items-center justify-center"><Brain className="h-16 w-16 text-primary/30" strokeWidth={0.8} /></div>}<span className="absolute bottom-4 right-4 text-[9px] text-muted-foreground">Model output, not a scan</span></div>
  </div>;
}

function AddPatient({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [name, setName] = useState("");
  const [age, setAge] = useState("30");
  const [sex, setSex] = useState<"F" | "M">("F");
  const navigate = useNavigate();
  const m = useAction((b: { name: string; age: number; sex: "F" | "M" }) => api.createPatient(b), {
    onSuccess: (p) => { toast.success(`Synthetic patient ${p.name} created`); onOpenChange(false); navigate({ to: "/patients/$id/upload", params: { id: p.id } }); },
    onError: (e) => toast.error(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add patient</DialogTitle>
          <DialogDescription>Creates a synthetic patient. You will upload or generate inputs next.</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); if (!name.trim()) return toast.error("Enter a name"); m.mutate({ name: name.trim(), age: Number(age) || 30, sex }); }}>
          <div className="grid gap-1.5"><Label htmlFor="pname">Name</Label><Input id="pname" value={name} onChange={(e) => setName(e.target.value)} placeholder="Alex Morgan" autoFocus /></div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-1.5"><Label htmlFor="page">Age</Label><Input id="page" type="number" min={1} max={110} value={age} onChange={(e) => setAge(e.target.value)} /></div>
            <div className="grid gap-1.5"><Label>Sex</Label>
              <Select value={sex} onValueChange={(v) => setSex(v as "F" | "M")}><SelectTrigger aria-label="Sex"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="F">F</SelectItem><SelectItem value="M">M</SelectItem></SelectContent></Select>
            </div>
          </div>
          <DialogFooter><Button type="submit" disabled={m.isPending}>{m.isPending ? "Creating" : "Create synthetic patient"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
