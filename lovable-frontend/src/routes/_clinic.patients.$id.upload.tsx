import { createFileRoute, Link } from "@tanstack/react-router";
import { Dna, Hammer, Trash2, Upload, Wand2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api, useAction, usePatient, useTwinInputs } from "@/api/client";
import type { InputFile, Patient } from "@/api/types";
import { ErrorState, Loading, Panel, RealBadge, StatusChip, SyntheticBadge } from "@/components/common";
import { PatientHeader } from "@/components/PatientHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_clinic/patients/$id/upload")({
  head: () => ({
    meta: [
      { title: "Data upload | UNNAMED" },
      { name: "description", content: "Upload MRI, genotype, biomarkers and injury details, then build the brain twin." },
      { property: "og:title", content: "Data upload | UNNAMED" },
      { property: "og:description", content: "Upload inputs and build a personal brain twin." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: UploadPage,
});

const ZONES: { kind: InputFile["kind"]; label: string; accept: string }[] = [
  { kind: "t1", label: "T1 MRI", accept: ".nii,.gz,.dcm,.zip" },
  { kind: "dwi", label: "Diffusion MRI", accept: ".nii,.gz,.zip" },
  { kind: "fmri", label: "Resting fMRI", accept: ".nii,.gz,.zip" },
  { kind: "vcf", label: "Genotype VCF", accept: ".vcf,.gz" },
  { kind: "labs", label: "Blood biomarkers CSV (GFAP and UCH-L1)", accept: ".csv" },
];

function UploadPage() {
  const { id } = Route.useParams();
  const p = usePatient(id);
  const ti = useTwinInputs(id);
  const [built, setBuilt] = useState<Patient | null>(null);
  const synth = useAction(() => api.uploadSynthetic(id), { onSuccess: () => toast.success("Synthetic inputs filled in all zones") });
  const build = useAction(() => api.buildTwin(id), { onSuccess: (pt) => { setBuilt(pt); toast.success("Twin built"); }, onError: (e) => toast.error(e.message) });

  if (p.isLoading || ti.isLoading) return <Loading />;
  if (p.error || !p.data) return <ErrorState error={p.error} onRetry={p.refetch} />;
  const inputs = ti.data?.inputs ?? p.data.inputs;

  return (
    <div>
      <PatientHeader patient={p.data} />
      <div className="mb-6 flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => synth.mutate(undefined)} disabled={synth.isPending}><Wand2 className="h-4 w-4" /> Use synthetic patient</Button>
        <Button onClick={() => build.mutate(undefined)} disabled={build.isPending}><Hammer className="h-4 w-4" /> {build.isPending ? "Building twin" : "Build twin"}</Button>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {ZONES.map((z) => <DropZone key={z.kind} pid={id} zone={z} file={inputs.find((f) => f.kind === z.kind)} />)}
        <InjuryForm pid={id} patient={p.data} file={inputs.find((f) => f.kind === "injury")} />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        {(built ?? (p.data.twin_built ? p.data : null)) && <BuildResult p={(built ?? p.data)!} />}
        <Panel title="What DNA changes" className="lg:col-span-1">
          <div className="flex gap-3 text-sm text-muted-foreground">
            <Dna className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
            <p>Genotype only shifts the priors on two recovery parameters: recovery rate k and permanent damage p. APOE e4 and BDNF Met are included because some studies link them to slower recovery, but the evidence is mixed. Each weekly call quickly outweighs the genetic prior.</p>
          </div>
        </Panel>
      </div>
    </div>
  );
}

function DropZone({ pid, zone, file }: { pid: string; zone: (typeof ZONES)[number]; file?: InputFile }) {
  const ref = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const up = useAction((f: File) => api.uploadFile(pid, zone.kind, f), { onSuccess: () => toast.success(`${zone.label} uploaded`), onError: (e) => toast.error(e.message) });
  const rm = useAction(() => api.removeFile(pid, zone.kind), { onSuccess: () => toast(`${zone.label} removed`) });
  const has = file && file.status !== "missing";
  return (
    <div
      className={cn("panel flex flex-col p-4 transition-colors", over && "border-primary bg-primary-soft")}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) up.mutate(f); }}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold">{zone.label}</h3>
        <div className="flex gap-1">{has && (file.synthetic ? <SyntheticBadge /> : <RealBadge />)}<StatusChip status={file?.status ?? "missing"} /></div>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{file?.sets}</p>
      <button
        type="button"
        onClick={() => ref.current?.click()}
        className="mt-3 flex flex-1 flex-col items-center justify-center gap-1 rounded-lg border border-dashed px-3 py-6 text-center text-xs text-muted-foreground hover:border-primary hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        aria-label={`Upload ${zone.label}`}
      >
        <Upload className="h-4 w-4" aria-hidden />
        {up.isPending ? "Uploading" : has ? <span className="font-mono text-foreground">{file.file}</span> : "Drop a file or click to browse"}
      </button>
      {file?.note && <p className="mt-2 text-xs text-synthetic-foreground">{file.note}</p>}
      <input ref={ref} type="file" accept={zone.accept} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) up.mutate(f); e.target.value = ""; }} />
      {has && <Button variant="ghost" size="sm" className="mt-2 self-start" onClick={() => rm.mutate(undefined)}><Trash2 className="h-3.5 w-3.5" /> Remove file</Button>}
    </div>
  );
}

function InjuryForm({ pid, patient, file }: { pid: string; patient: Patient; file?: InputFile }) {
  const [inj, setInj] = useState(patient.injury);
  useEffect(() => setInj(patient.injury), [patient.injury]);
  const save = useAction(() => api.uploadInjury(pid, inj), { onSuccess: () => toast.success("Injury form saved") });
  return (
    <div className="panel p-4">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold">Injury form</h3>
        <div className="flex gap-1">{file && file.status !== "missing" && (file.synthetic ? <SyntheticBadge /> : <RealBadge />)}<StatusChip status={file?.status ?? "missing"} /></div>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{file?.sets}</p>
      <div className="mt-3 grid gap-3 text-sm">
        <div className="grid gap-1"><Label htmlFor="mech" className="text-xs">Mechanism</Label><Input id="mech" value={inj.mechanism} onChange={(e) => setInj({ ...inj, mechanism: e.target.value })} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1"><Label className="text-xs">Helmet</Label>
            <Select value={inj.helmet} onValueChange={(v) => setInj({ ...inj, helmet: v })}><SelectTrigger aria-label="Helmet"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="A">A</SelectItem><SelectItem value="B">B</SelectItem><SelectItem value="None">None</SelectItem></SelectContent></Select>
          </div>
          <div className="grid gap-1"><Label htmlFor="idate" className="text-xs">Date</Label><Input id="idate" type="date" value={inj.date} onChange={(e) => setInj({ ...inj, date: e.target.value })} /></div>
        </div>
        <div className="grid gap-1"><Label htmlFor="iloc" className="text-xs">Location</Label><Input id="iloc" value={inj.location} onChange={(e) => setInj({ ...inj, location: e.target.value })} /></div>
        <div className="grid gap-2"><Label className="text-xs">Impact angle: {inj.angle_deg} deg</Label><Slider min={0} max={90} step={5} value={[inj.angle_deg]} onValueChange={([v]) => setInj({ ...inj, angle_deg: v })} aria-label="Impact angle" /></div>
        <label className="flex items-center justify-between text-xs">Loss of consciousness <Switch checked={inj.loc} onCheckedChange={(v) => setInj({ ...inj, loc: v })} aria-label="Loss of consciousness" /></label>
        <Button size="sm" variant="outline" onClick={() => save.mutate(undefined)} disabled={save.isPending}>Save injury form</Button>
      </div>
    </div>
  );
}

function BuildResult({ p }: { p: Patient }) {
  const fc = p.fc_fit ?? 0;
  const angle = Math.PI * (1 - fc);
  const x = 60 + 48 * Math.cos(angle), y = 60 - 48 * Math.sin(angle);
  return (
    <Panel title="Twin build result" className="lg:col-span-2" action={<SyntheticBadge />}>
      <div className="flex flex-wrap items-center gap-8">
        <div className="text-center">
          <svg viewBox="0 0 120 70" className="h-24 w-40" role="img" aria-label={`Functional connectivity fit ${fc.toFixed(2)}`}>
            <path d="M12 60 A48 48 0 0 1 108 60" fill="none" stroke="var(--color-muted)" strokeWidth="10" strokeLinecap="round" />
            <path d={`M12 60 A48 48 0 0 1 ${x.toFixed(1)} ${y.toFixed(1)}`} fill="none" stroke={p.low_fidelity ? "var(--color-synthetic)" : "var(--color-primary)"} strokeWidth="10" strokeLinecap="round" />
          </svg>
          <p className="-mt-6 font-mono text-4xl font-semibold tabular-nums">{fc.toFixed(2)}</p>
          <p className="text-xs text-muted-foreground">FC fit (correlation)</p>
        </div>
        <div className="flex-1 space-y-3 text-sm">
          <div className="flex flex-wrap gap-2">
            {p.low_fidelity && <span className="rounded-full border border-synthetic/50 bg-synthetic-soft px-2 py-0.5 text-[11px] font-medium text-synthetic-foreground">Low fidelity</span>}
            {p.template_only && <span className="rounded-full border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">Template only, no diffusion MRI</span>}
          </div>
          <ul className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-muted-foreground">
            {p.inputs.map((i) => <li key={i.kind}><span className="font-medium text-foreground">{i.kind.toUpperCase()}</span> {i.status === "missing" ? "not used" : i.synthetic ? "synthetic" : "real"}</li>)}
            <li><span className="font-medium text-foreground">k prior</span> {p.params.k}</li>
            <li><span className="font-medium text-foreground">G</span> {p.params.G}</li>
          </ul>
          <Button asChild size="sm" variant="outline"><Link to="/patients/$id/twin" params={{ id: p.id }}>Open twin viewer</Link></Button>
        </div>
      </div>
    </Panel>
  );
}
