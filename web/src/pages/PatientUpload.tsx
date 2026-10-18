// C0 Model inputs and twin build. Six zones, one per input the twin can use, then the build
// step and the result card. Nothing here is a real scan: every file is synthetic unless a real
// one is dropped in.

import { FileUp, Trash2, Wand2 } from "lucide-react";
import { useRef, useState, type DragEvent } from "react";
import { toast } from "sonner";
import { useBuildTwin, useTwinInputs, useUpload } from "@/api/client";
import type { InputFile, Patient } from "@/api/types";
import {
  ErrorState,
  Loading,
  ModelLabel,
  Panel,
  RealBadge,
  StatusChip,
  SyntheticBadge,
} from "@/components/common";
import { CompactTwin } from "@/components/panels/CompactTwin";
import { Gauge } from "@/components/panels/Gauge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useApp } from "@/store/app";
import { usePatientContext } from "./PatientLayout";

interface Zone {
  kind: InputFile["kind"];
  title: string;
  hint: string;
  accept: string;
}

const ZONES: Zone[] = [
  { kind: "t1", title: "T1 MRI", hint: "Structural scan, NIfTI or DICOM zip", accept: ".nii,.nii.gz,.dcm,.zip" },
  { kind: "dwi", title: "Diffusion MRI", hint: "Needed for a personal connectome", accept: ".nii,.nii.gz,.zip" },
  { kind: "fmri", title: "Resting fMRI", hint: "Target for the functional connectivity fit", accept: ".nii,.nii.gz,.zip" },
  { kind: "vcf", title: "Genotype VCF", hint: "APOE, BDNF and COMT only", accept: ".vcf,.vcf.gz" },
  { kind: "labs", title: "Blood biomarkers CSV", hint: "GFAP and UCH-L1", accept: ".csv" },
  { kind: "injury", title: "Injury form", hint: "Filled in below, not uploaded", accept: ".json" },
];

/** One drop zone. Click or drop, both end in the same upload call. */
function DropZone({ zone, file, patientId }: { zone: Zone; file: InputFile; patientId: string }) {
  const upload = useUpload();
  const [over, setOver] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const inputId = `drop-${zone.kind}`;

  const send = (chosen: File | undefined) => {
    if (!chosen) return;
    upload.mutate(
      { id: patientId, kind: zone.kind, file: chosen },
      {
        onSuccess: () => toast.success(`${zone.title} attached`),
        onError: (err) => toast.error(err.message),
      },
    );
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setOver(false);
    send(e.dataTransfer.files[0]);
  };

  const present = file.status !== "missing";

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={cn(
        "flex flex-col gap-2 rounded-xl border border-dashed p-4 transition-colors",
        over ? "border-primary bg-primary-soft" : "border-border",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-extrabold">{zone.title}</h3>
        <StatusChip status={file.status} />
        {present && (file.synthetic ? <SyntheticBadge /> : <RealBadge />)}
      </div>
      <p className="text-[11px] text-muted-foreground">{zone.hint}</p>
      <p className="truncate font-mono text-xs">{file.file || "no file yet"}</p>
      <p className="text-xs text-muted-foreground">
        What it changes: {file.sets}
        {file.note ? `. ${file.note}` : ""}
      </p>
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
        <input
          ref={picker}
          id={inputId}
          type="file"
          accept={zone.accept}
          className="sr-only"
          onChange={(e) => send(e.target.files?.[0])}
        />
        <Button size="sm" variant="outline" onClick={() => picker.current?.click()} disabled={upload.isPending}>
          <FileUp aria-hidden /> Choose file
        </Button>
        {present && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => upload.mutate({ id: patientId, kind: zone.kind, remove: true })}
            disabled={upload.isPending}
          >
            <Trash2 aria-hidden /> Remove file
          </Button>
        )}
        <span className="text-[11px] text-muted-foreground">or drop a file here</span>
      </div>
    </div>
  );
}

/** The injury form. It writes the same input row as a dropped file would. */
function InjuryForm({ patient }: { patient: Patient }) {
  const upload = useUpload();
  const [form, setForm] = useState(patient.injury);

  const save = () =>
    upload.mutate(
      { id: patient.id, injury: form },
      {
        onSuccess: () => toast.success("Injury form saved"),
        onError: (err) => toast.error(err.message),
      },
    );

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-1.5">
        <Label htmlFor="injury-mech">Mechanism</Label>
        <Input
          id="injury-mech"
          value={form.mechanism}
          onChange={(e) => setForm({ ...form, mechanism: e.target.value })}
          placeholder="Cycling fall, tackle, fall from height"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="injury-loc">Location</Label>
        <Input
          id="injury-loc"
          value={form.location}
          onChange={(e) => setForm({ ...form, location: e.target.value })}
          placeholder="Left frontal"
        />
      </div>
      <fieldset className="space-y-1.5">
        <legend className="text-sm font-medium">Helmet</legend>
        <RadioGroup
          value={form.helmet}
          onValueChange={(v) => setForm({ ...form, helmet: v })}
          className="flex flex-wrap gap-4"
        >
          {["A", "B", "None"].map((h) => (
            <span key={h} className="flex items-center gap-2">
              <RadioGroupItem value={h} id={`helmet-${h}`} />
              <Label htmlFor={`helmet-${h}`}>{h === "None" ? "No helmet" : `Helmet ${h}`}</Label>
            </span>
          ))}
        </RadioGroup>
      </fieldset>
      <div className="space-y-1.5">
        <Label htmlFor="injury-date">Date of injury</Label>
        <Input
          id="injury-date"
          type="date"
          value={form.date.slice(0, 10)}
          onChange={(e) => setForm({ ...form, date: e.target.value })}
        />
      </div>
      <div className="space-y-2 sm:col-span-2">
        <Label htmlFor="injury-angle">Impact angle, {form.angle_deg} degrees</Label>
        <Slider
          id="injury-angle"
          value={[form.angle_deg]}
          min={0}
          max={90}
          step={5}
          onValueChange={([v]) => setForm({ ...form, angle_deg: v })}
          aria-label="Impact angle in degrees"
        />
        <p className="text-[11px] text-muted-foreground">
          Zero is a straight on impact, ninety is fully glancing. The angle sets how widely the initial damage spreads.
        </p>
      </div>
      <div className="flex items-center gap-3 sm:col-span-2">
        <Switch
          id="injury-loc-flag"
          checked={form.loc}
          onCheckedChange={(v) => setForm({ ...form, loc: v })}
        />
        <Label htmlFor="injury-loc-flag">Loss of consciousness at the scene</Label>
      </div>
      <div className="sm:col-span-2">
        <Button onClick={save} disabled={upload.isPending}>
          {upload.isPending ? "Saving" : "Save injury form"}
        </Button>
      </div>
    </div>
  );
}

export default function PatientUpload() {
  const { patient } = usePatientContext();
  const inputs = useTwinInputs(patient.id);
  const upload = useUpload();
  const build = useBuildTwin();
  const personalization = useApp((s) => s.viewer.personalization);
  const setViewer = useApp((s) => s.setViewer);
  const [built, setBuilt] = useState(false);

  const files = inputs.data?.inputs ?? patient.inputs;
  const byKind = new Map(files.map((f) => [f.kind, f]));
  const counts = {
    ok: files.filter((f) => f.status === "ok").length,
    warn: files.filter((f) => f.status === "warn").length,
    missing: files.filter((f) => f.status === "missing" || f.status === "error").length,
  };

  const fillSynthetic = () =>
    upload.mutate(
      { id: patient.id, synthetic: true },
      {
        onSuccess: () => toast.success("Every zone filled with synthetic inputs"),
        onError: (err) => toast.error(err.message),
      },
    );

  const buildTwin = () =>
    build.mutate(patient.id, {
      onSuccess: () => {
        setBuilt(true);
        toast.success("Twin built from the inputs above");
      },
      onError: (err) => toast.error(err.message),
    });

  return (
    <div className="space-y-5">
      <Panel
        title="Model inputs"
        subtitle="What the twin has to work with. Each zone says what that file changes in the model."
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={fillSynthetic} disabled={upload.isPending}>
              <Wand2 aria-hidden /> Use synthetic patient
            </Button>
            <Button onClick={buildTwin} disabled={build.isPending}>
              {build.isPending ? "Building" : "Build twin"}
            </Button>
          </div>
        }
      >
        {inputs.isLoading && <Loading label="Loading inputs" />}
        {inputs.error && <ErrorState error={inputs.error} onRetry={() => inputs.refetch()} />}
        {build.error && (
          <p role="alert" className="mb-4 rounded-xl border border-destructive/30 bg-destructive-soft p-3 text-sm">
            {build.error.message}
          </p>
        )}
        <div className="grid items-start gap-3 md:grid-cols-2 xl:grid-cols-3">
          {ZONES.filter((z) => z.kind !== "injury").map((z) => {
            const file = byKind.get(z.kind);
            return file ? <DropZone key={z.kind} zone={z} file={file} patientId={patient.id} /> : null;
          })}
          {byKind.get("injury") && (
            <div className="rounded-xl border border-dashed p-4 md:col-span-2 xl:col-span-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-extrabold">Injury form</h3>
                <StatusChip status={byKind.get("injury")!.status} />
                <SyntheticBadge />
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                What it changes: {byKind.get("injury")!.sets}
              </p>
              <div className="mt-4">
                <InjuryForm patient={patient} />
              </div>
            </div>
          )}
        </div>
      </Panel>

      {(built || patient.twin_built) && (
        <Panel
          title="Build result"
          subtitle="The fit between the simulated and the measured functional connectivity. Higher is better."
          action={<ModelLabel />}
        >
          <div className="grid gap-6 lg:grid-cols-[auto_1fr]">
            <div>
              <Gauge value={inputs.data?.fc_fit ?? patient.fc_fit} label="Functional connectivity fit" />
              <div className="mt-3 flex flex-wrap gap-2">
                {(inputs.data?.low_fidelity ?? patient.low_fidelity) && (
                  <span className="rounded-full border border-synthetic/40 bg-synthetic-soft px-2 py-0.5 text-[11px] font-medium text-synthetic-foreground">
                    Low fidelity, read the bands widely
                  </span>
                )}
                {patient.template_only && (
                  <span className="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground">
                    Template only, no diffusion MRI
                  </span>
                )}
              </div>
            </div>
            <div>
              <h3 className="text-sm font-extrabold">Input summary</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                {counts.ok} ready, {counts.warn} with a warning, {counts.missing} missing.
              </p>
              <ul className="mt-3 divide-y text-sm">
                {files.map((f) => (
                  <li key={f.kind} className="flex flex-wrap items-center gap-2 py-2">
                    <span className="w-16 font-mono text-xs font-semibold uppercase">{f.kind}</span>
                    <StatusChip status={f.status} />
                    {f.status !== "missing" && (f.synthetic ? <SyntheticBadge /> : <RealBadge />)}
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">{f.file || "no file"}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Panel>
      )}

      {(built || patient.twin_built) && (
        <Panel
          title="Template to this patient"
          subtitle="Slide from the shared template anatomy to this patient's own. The model shape comes from age, sex, the T1 volumes and the injury."
        >
          <CompactTwin patientId={patient.id} week={patient.week} />
          <div className="mt-4 max-w-md space-y-2">
            <Label htmlFor="personalization">
              Personalization, {Math.round(personalization * 100)} percent of the way to this patient
            </Label>
            <Slider
              id="personalization"
              value={[personalization]}
              min={0}
              max={1}
              step={0.02}
              onValueChange={([v]) => setViewer({ personalization: v })}
              aria-label="Personalization, template to patient"
            />
          </div>
        </Panel>
      )}

      <Panel title="About the genotype file">
        <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
          DNA does not change the shape of the brain here. The genotype file only shifts the priors on two recovery
          parameters, the healing rate and the share of damage that stays, and the published evidence for those effects
          is mixed. Shape comes from age, sex, the T1 volumes and the injury itself. The genotype file is optional and
          the patient consents to it separately.
        </p>
      </Panel>
    </div>
  );
}
