// C2 Patient overview. The one screen a clinician reads before a call, and the one that prints
// as a single page report.

import { Boxes, Eye, FileDown, GitCompare, ListChecks, PhoneCall, StickyNote } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { useForecast, useNote } from "@/api/client";
import type { Signal } from "@/api/types";
import {
  Empty,
  ErrorState,
  Loading,
  ModelLabel,
  Panel,
  RealBadge,
  StatusChip,
  SyntheticBadge,
  TierChip,
  fmtDate,
} from "@/components/common";
import { ChartKey, SignalChart } from "@/components/charts/SignalChart";
import { Sparkline } from "@/components/charts/Sparkline";
import { AlertCard } from "@/components/panels/AlertCard";
import { PipelinePanel } from "@/components/panels/PipelinePanel";
import { CompactTwin } from "@/components/panels/CompactTwin";
import { Gauge } from "@/components/panels/Gauge";
import { Transcript } from "@/components/panels/Transcript";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { usePatientContext } from "./PatientLayout";

const GROUPS: { key: Signal["group"]; label: string }[] = [
  { key: "eyes", label: "Eyes" },
  { key: "speech", label: "Speech" },
  { key: "memory", label: "Memory" },
  { key: "symptoms", label: "Symptoms" },
];

/** The add note dialog. Notes go to the patient record, never to the patient. */
function AddNote({ patientId }: { patientId: string }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const note = useNote();

  const save = () =>
    note.mutate(
      { id: patientId, text: text.trim() },
      {
        onSuccess: () => {
          setOpen(false);
          setText("");
          toast.success("Note added to the record");
        },
        onError: (err) => toast.error(err.message),
      },
    );

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <StickyNote aria-hidden /> Add note
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a note</DialogTitle>
            <DialogDescription>Free text for the care team. It is stored on the record and is not sent to the patient.</DialogDescription>
          </DialogHeader>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            aria-label="Note text"
            placeholder="What you want the next reader to know"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={text.trim().length < 2 || note.isPending}>
              {note.isPending ? "Saving" : "Save note"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function PatientOverview() {
  const { patient } = usePatientContext();
  const forecast = useForecast(patient.id);
  const note = useNote();

  const signals = forecast.data?.signals ?? [];
  const weeks = forecast.data?.weeks ?? [];
  const coverage = forecast.data?.coverage ?? [];

  const lastCall = patient.last_call;
  const flashOk = lastCall?.channel.flash_ok ?? false;
  const saccade = useMemo(() => signals.find((s) => s.key === "saccade_latency"), [signals]);
  const saccadeFeature = lastCall?.features.find((f) => f.name === "Saccade latency") ?? null;

  const requestCallback = () =>
    note.mutate(
      { id: patient.id, text: "Callback requested by the clinician from the overview screen." },
      {
        onSuccess: () => toast.success("Callback request recorded on the patient record"),
        onError: (err) => toast.error(err.message),
      },
    );

  return (
    <div className="space-y-5">
      <div className="no-print flex flex-wrap gap-2">
        <Button asChild variant="outline">
          <Link to={`/patients/${patient.id}/twin`}>
            <Boxes aria-hidden /> Open twin viewer
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link to={`/patients/${patient.id}/compare`}>
            <GitCompare aria-hidden /> Open scenario compare
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link to={`/patients/${patient.id}/calls`}>
            <ListChecks aria-hidden /> Open call log
          </Link>
        </Button>
        <Button variant="outline" onClick={requestCallback} disabled={note.isPending}>
          <PhoneCall aria-hidden /> Request callback
        </Button>
        <AddNote patientId={patient.id} />
        <Button variant="outline" onClick={() => window.print()}>
          <FileDown aria-hidden /> Export report
        </Button>
      </div>

      <div className="no-print">
        <PipelinePanel patientId={patient.id} />
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Injury summary" subtitle="From the injury form, not from any scan.">
          <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs text-muted-foreground">Mechanism</dt>
              <dd className="font-bold">{patient.injury.mechanism}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Helmet</dt>
              <dd className="font-bold">{patient.injury.helmet}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Impact angle</dt>
              <dd className="font-bold">{patient.injury.angle_deg} deg</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Location</dt>
              <dd className="font-bold">{patient.injury.location}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Date</dt>
              <dd className="font-bold">{patient.injury.date}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Loss of consciousness</dt>
              <dd className="font-bold">{patient.injury.loc ? "Yes, at the scene" : "No"}</dd>
            </div>
          </dl>
          <dl className="mt-4 grid grid-cols-2 gap-4 border-t pt-4 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs text-muted-foreground">GFAP</dt>
              <dd className="font-mono font-bold">{patient.biomarkers.gfap_z.toFixed(2)} z</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">UCH-L1</dt>
              <dd className="font-mono font-bold">{patient.biomarkers.uchl1_z.toFixed(2)} z</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">APOE e4 copies</dt>
              <dd className="font-mono font-bold">{patient.alleles.apoe_e4}</dd>
            </div>
          </dl>
        </Panel>

        <Panel
          title="Inputs used"
          subtitle="What the twin was built from. Amber means synthetic."
          action={<ModelLabel />}
        >
          <Gauge value={patient.fc_fit} label="Functional connectivity fit" className="mb-4" />
          <ul className="divide-y text-sm">
            {patient.inputs.map((f) => (
              <li key={f.kind} className="flex flex-wrap items-center gap-2 py-2">
                <span className="w-16 font-mono text-xs font-semibold uppercase">{f.kind}</span>
                <StatusChip status={f.status} />
                {f.status !== "missing" && (f.synthetic ? <SyntheticBadge /> : <RealBadge />)}
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{f.sets}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <Panel
        title="Twelve week forecast"
        subtitle="The shaded area is the 80% band, the line is the forecast mean, and the dots are what the weekly calls measured."
        action={<ModelLabel />}
      >
        {forecast.isLoading && <Loading label="Loading the forecast" />}
        {forecast.error && <ErrorState error={forecast.error} onRetry={() => forecast.refetch()} />}
        {forecast.data && (
          <>
            <ChartKey />
            <div className="mt-4 grid gap-6 lg:grid-cols-2">
              {GROUPS.map((g) => {
                const group = signals.filter((s) => s.group === g.key && s.tier === "A");
                return (
                  <section key={g.key} className="rounded-xl border p-4">
                    <h3 className="mb-2 text-sm font-extrabold">{g.label}</h3>
                    {group.length === 0 ? (
                      <Empty>Nothing in this group was measurable on the calls so far.</Empty>
                    ) : (
                      <div className="space-y-4">
                        {group.map((s) => (
                          <SignalChart key={s.key} signal={s} weeks={weeks} week={patient.week} height={140} />
                        ))}
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          </>
        )}
      </Panel>

      <div className="grid gap-5 xl:grid-cols-3">
        <Panel title="Calibration" subtitle="Is the band honest, and is the model getting surer?">
          <p className="text-3xl font-extrabold">{Math.round(patient.coverage * 100)}%</p>
          <p className="text-xs text-muted-foreground">
            of the measurements landed inside the 80% band. Near 80 is right. Much higher means the band is too wide,
            much lower means it is too narrow.
          </p>
          <div className="mt-3">
            <Sparkline
              points={coverage.map((c) => ({ x: c.week, y: c.cov }))}
              target={0.8}
              label="Coverage of the 80 percent band by week, with the 0.8 target"
            />
            <p className="text-[11px] text-muted-foreground">Coverage by week, dashed line is the 0.8 target.</p>
          </div>
          <div className="mt-4 border-t pt-4">
            <p className="text-xs font-bold">Posterior contraction, healing rate k</p>
            <div className="mt-2 flex items-center gap-3">
              <span className="h-3 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden>
                <span
                  className="block h-full rounded-full bg-primary"
                  style={{ width: `${Math.max(4, (1 - patient.contraction.k) * 100)}%` }}
                />
              </span>
              <span className="font-mono text-xs font-bold">{Math.round(patient.contraction.k * 100)}% narrower</span>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              The bar is what is left of the starting uncertainty in k. It shrinks as each call arrives.
            </p>
          </div>
        </Panel>

        <Panel
          title="Saccade latency"
          subtitle="A tier B signal. It needs the flash test to pass so the eye movement can be timed against the screen."
        >
          {flashOk && saccadeFeature ? (
            <>
              <p className="flex items-baseline gap-2">
                <span className="text-3xl font-extrabold">{saccadeFeature.value.toFixed(0)}</span>
                <span className="text-sm text-muted-foreground">{saccadeFeature.unit}</span>
                <TierChip tier="B" />
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Smallest change we can detect is {saccadeFeature.mdc.toFixed(0)} {saccadeFeature.unit}.
                {saccadeFeature.prev == null
                  ? " This is the first reading."
                  : ` Previous reading ${saccadeFeature.prev.toFixed(0)}.`}
              </p>
              {saccade && (
                <div className="mt-3">
                  <SignalChart signal={saccade} weeks={weeks} week={patient.week} height={130} />
                </div>
              )}
            </>
          ) : (
            <div className="rounded-xl border bg-muted p-4">
              <p className="flex items-center gap-2 text-sm font-bold text-muted-foreground">
                <Eye className="h-4 w-4" aria-hidden /> Not measured
                <TierChip tier="B" />
              </p>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                {lastCall
                  ? "The flash test did not pass on the last call, so the screen and the camera clocks could not be aligned. Saccade latency needs that alignment, so it was left unmeasured rather than reported badly."
                  : "There has been no call yet, so there is nothing to measure."}
              </p>
            </div>
          )}
        </Panel>

        <Panel title="Pupil light reflex" subtitle="Roadmap, not built.">
          <div className="rounded-xl border border-dashed bg-muted/50 p-4 opacity-70">
            <p className="text-sm font-bold text-muted-foreground">Roadmap tile</p>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              A pupil light reflex measure would need a controlled flash and a known screen brightness. The phone camera
              can do it in principle, but it is not built and nothing on this screen uses it.
            </p>
            <Button variant="outline" size="sm" className="mt-3" disabled>
              Not available
            </Button>
          </div>
        </Panel>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title={`Active alerts (${patient.alerts.length})`} subtitle="Open alerts on this patient.">
          {patient.alerts.length === 0 ? (
            <Empty>No open alerts.</Empty>
          ) : (
            <div className="space-y-3">
              {patient.alerts.map((a) => (
                <AlertCard key={a.id} alert={a} />
              ))}
            </div>
          )}
          <Button asChild variant="link" className="no-print mt-2 px-0">
            <Link to="/alerts">Go to the alerts screen</Link>
          </Button>
        </Panel>

        <Panel
          title="Last call"
          subtitle={lastCall ? `Week ${lastCall.week}, ${fmtDate(lastCall.date)}` : "No call yet."}
          action={
            <Button asChild variant="link" className="no-print px-0">
              <Link to={`/patients/${patient.id}/calls`}>Full call log</Link>
            </Button>
          }
        >
          {!lastCall ? (
            <Empty>Nothing yet. The first call link has not been opened.</Empty>
          ) : (
            <>
              <dl className="mb-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <div>
                  <dt className="text-xs text-muted-foreground">Duration</dt>
                  <dd className="font-bold">{Math.round(lastCall.duration_s / 60)} min</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Steps done</dt>
                  <dd className="font-bold">{lastCall.steps.length}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Frame rate</dt>
                  <dd className="font-bold">{lastCall.channel.fps} fps</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Flash test</dt>
                  <dd className="font-bold">{lastCall.channel.flash_ok ? "passed" : "failed"}</dd>
                </div>
              </dl>
              <div className="no-print">
                <Transcript lines={lastCall.transcript} height={220} />
              </div>
            </>
          )}
        </Panel>
      </div>

      <Panel
        className="no-print"
        title="Damage at this week"
        subtitle={`Where the model puts the damage at week ${patient.week}. A model output, not a scan.`}
      >
        <CompactTwin patientId={patient.id} week={patient.week} />
      </Panel>
    </div>
  );
}
