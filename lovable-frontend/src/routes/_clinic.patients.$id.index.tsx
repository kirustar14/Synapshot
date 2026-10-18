import { createFileRoute, Link } from "@tanstack/react-router";
import { Area, AreaChart, ResponsiveContainer, YAxis } from "recharts";
import { Box, Columns2, Eye, FileDown, MessageSquarePlus, Phone, PhoneCall } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api, useAction, useForecast, usePatient } from "@/api/client";
import { Empty, ErrorState, FlagChip, fmtDate, fmtTime, Loading, ModelLabel, Panel, RealBadge, StatusChip, SyntheticBadge } from "@/components/common";
import { ForecastGrid, SignalChart } from "@/components/ForecastChart";
import { PatientHeader } from "@/components/PatientHeader";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_clinic/patients/$id/")({
  head: () => ({
    meta: [
      { title: "Patient overview | Synapshot" },
      { name: "description", content: "Recovery forecast, calibration, alerts and last call for one patient." },
      { property: "og:title", content: "Patient overview | Synapshot" },
      { property: "og:description", content: "Recovery forecast with 80% bands and calibration for one patient." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Overview,
});

const KIND_LABEL: Record<string, string> = { t1: "T1 MRI", dwi: "Diffusion MRI", fmri: "Resting fMRI", vcf: "Genotype", labs: "Blood biomarkers", injury: "Injury form" };

function Overview() {
  const { id } = Route.useParams();
  const p = usePatient(id);
  const f = useForecast(id);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");
  const callback = useAction(async () => { const a = p.data?.alerts[0]; if (a) await api.callAlert(a.id); else await api.triggerCall(id); }, { onSuccess: () => toast.success("Callback requested. The patient will get a text first."), onError: (e) => toast.error(e.message) });
  const addNote = useAction((t: string) => api.note(id, t), { onSuccess: () => { toast.success("Note saved"); setNote(""); setNoteOpen(false); } });

  if (p.isLoading) return <Loading />;
  if (p.error || !p.data) return <ErrorState error={p.error} onRetry={p.refetch} />;
  const pt = p.data;
  const lc = pt.last_call;
  const saccade = f.data?.signals.find((s) => s.tier === "B");

  return (
    <div>
      <PatientHeader patient={pt} />
      <div className="no-print mb-6 flex flex-wrap gap-2">
        <Button asChild variant="outline" size="sm"><Link to="/patients/$id/twin" params={{ id }}><Box className="h-4 w-4" /> Open twin viewer</Link></Button>
        <Button asChild variant="outline" size="sm"><Link to="/patients/$id/compare" params={{ id }}><Columns2 className="h-4 w-4" /> Open scenario compare</Link></Button>
        <Button asChild variant="outline" size="sm"><Link to="/patients/$id/calls" params={{ id }}><PhoneCall className="h-4 w-4" /> Open call log</Link></Button>
        <Button variant="outline" size="sm" onClick={() => callback.mutate(undefined)} disabled={callback.isPending}><Phone className="h-4 w-4" /> Request callback to patient</Button>
        <Button variant="outline" size="sm" onClick={() => setNoteOpen(true)}><MessageSquarePlus className="h-4 w-4" /> Add note</Button>
        <Button size="sm" onClick={() => window.print()}><FileDown className="h-4 w-4" /> Export report</Button>
      </div>

      {!pt.twin_built && (
        <div className="panel mb-6 flex flex-wrap items-center justify-between gap-3 p-5">
          <p className="text-sm">No twin yet. Add inputs and build the twin to see a forecast.</p>
          <Button asChild size="sm"><Link to="/patients/$id/upload" params={{ id }}>Go to data upload</Link></Button>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Panel title="Recovery forecast, 12 weeks" subtitle="Shaded area is the 80% band. Dots are observed values from weekly calls." action={<ModelLabel />}>
            {f.isLoading ? <Loading /> : f.error || !f.data ? <ErrorState error={f.error} onRetry={f.refetch} /> : <ForecastGrid forecast={f.data} />}
          </Panel>
          <div className="grid gap-6 md:grid-cols-2">
            <Panel title="Saccade latency" subtitle="Tier B, needs a passing flash test">
              {lc?.channel.flash_ok && saccade ? (
                <><SignalChart signal={saccade} height={140} color="var(--color-chart-2)" /><ModelLabel /></>
              ) : (
                <div className="flex h-36 flex-col items-center justify-center rounded-lg bg-muted text-sm text-muted-foreground"><Eye className="mb-2 h-5 w-5" aria-hidden />Not measured<span className="text-xs">Last flash test did not pass</span></div>
              )}
            </Panel>
            <Panel title="Pupil light reflex" subtitle="Roadmap">
              <div aria-disabled className="flex h-36 flex-col items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground opacity-70">
                <span className="rounded-full border px-2 py-0.5 text-[11px] font-medium">Roadmap</span>
                <span className="mt-2 text-xs">Needs controlled lighting on the rig</span>
              </div>
            </Panel>
          </div>
          <Panel title="Last call summary" action={lc && <Link to="/patients/$id/calls" params={{ id }} className="text-xs text-primary hover:underline">Open</Link>}>
            {!lc ? <Empty>No calls yet.</Empty> : (
              <div className="grid gap-4 sm:grid-cols-4">
                <Stat label="Date" value={fmtDate(lc.date)} />
                <Stat label="Duration" value={`${Math.round(lc.duration_s / 60)} min`} />
                <Stat label="Steps" value={`${lc.steps.length} of 10`} />
                <Stat label="Frame rate" value={`${lc.channel.fps} fps`} />
                <div className="sm:col-span-4 flex flex-wrap gap-1.5">
                  {lc.features.filter((x) => x.changed).map((x) => <span key={x.name} className="rounded-full border border-synthetic/40 bg-synthetic-soft px-2 py-0.5 text-[11px] text-synthetic-foreground">Changed: {x.name}</span>)}
                  {!lc.features.some((x) => x.changed) && <span className="text-xs text-muted-foreground">All features within measurement noise of the previous call.</span>}
                </div>
              </div>
            )}
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel title="Injury summary">
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <Stat label="Mechanism" value={pt.injury.mechanism} /><Stat label="Helmet" value={pt.injury.helmet} />
              <Stat label="Impact angle" value={`${pt.injury.angle_deg} deg`} /><Stat label="Location" value={pt.injury.location} />
              <Stat label="Loss of consciousness" value={pt.injury.loc ? "Yes" : "No"} /><Stat label="Date" value={pt.injury.date} />
              <Stat label="GFAP z" value={pt.biomarkers.gfap_z.toFixed(2)} /><Stat label="UCH-L1 z" value={pt.biomarkers.uchl1_z.toFixed(2)} />
            </dl>
          </Panel>
          <Panel title="Inputs used" action={<span className="text-xs text-muted-foreground">FC fit <b className="font-mono text-foreground">{pt.fc_fit?.toFixed(2) ?? "n/a"}</b></span>}>
            <ul className="space-y-2">
              {pt.inputs.map((i) => (
                <li key={i.kind} className="flex items-center justify-between gap-2 text-sm">
                  <span>{KIND_LABEL[i.kind]}</span>
                  <span className="flex gap-1">{i.status !== "missing" && (i.synthetic ? <SyntheticBadge /> : <RealBadge />)}<StatusChip status={i.status} /></span>
                </li>
              ))}
            </ul>
          </Panel>
          <Calibration coverage={f.data?.coverage ?? []} cov={pt.coverage} contraction={pt.contraction.k} />
          <Panel title="Active alerts" action={<Link to="/alerts" className="text-xs text-primary hover:underline">All alerts</Link>}>
            {pt.alerts.length === 0 ? <Empty>No active alerts.</Empty> : (
              <ul className="space-y-3">{pt.alerts.map((a) => (
                <li key={a.id} className="text-sm"><div className="flex items-center gap-2"><FlagChip flag={a.type} /><span className="text-xs text-muted-foreground">{fmtTime(a.time)}</span></div><p className="mt-1 text-muted-foreground">{a.trigger}</p></li>
              ))}</ul>
            )}
          </Panel>
        </div>
      </div>

      <Dialog open={noteOpen} onOpenChange={setNoteOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add note</DialogTitle></DialogHeader>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={5} aria-label="Note text" placeholder="Observations, plans, follow ups" />
          <DialogFooter><Button disabled={!note.trim() || addNote.isPending} onClick={() => addNote.mutate(note.trim())}>Save note</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt><dd className="mt-0.5 font-medium">{value}</dd></div>;
}

function Calibration({ coverage, cov, contraction }: { coverage: { week: number; cov: number }[]; cov: number; contraction: number }) {
  return (
    <Panel title="Calibration" subtitle="How often reality lands inside the 80% band" action={<SyntheticBadge />}>
      <div className="flex items-end justify-between gap-3">
        <div><p className="font-mono text-3xl font-semibold tabular-nums">{Math.round(cov * 100)}%</p><p className="text-xs text-muted-foreground">coverage, target 80%</p></div>
        <div className="h-12 w-32" role="img" aria-label="Coverage by week sparkline">
          <ResponsiveContainer><AreaChart data={coverage}><YAxis domain={[0, 1]} hide /><Area dataKey="cov" stroke="var(--color-primary)" fill="var(--color-primary)" fillOpacity={0.15} isAnimationActive={false} /></AreaChart></ResponsiveContainer>
        </div>
      </div>
      <div className="mt-5">
        <p className="text-xs font-medium">Posterior contraction for recovery rate k</p>
        <div className="mt-2 space-y-1.5" aria-label={`Contraction ${Math.round(contraction * 100)} percent`}>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground"><span className="w-12">Prior</span><div className="h-2 flex-1 rounded-full bg-muted-foreground/30" /></div>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground"><span className="w-12">Now</span><div className="h-2 flex-1"><div className="h-2 rounded-full bg-primary transition-all" style={{ width: `${(1 - contraction) * 100}%` }} /></div></div>
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">Uncertainty reduced by {Math.round(contraction * 100)}% since week 0.</p>
      </div>
    </Panel>
  );
}
