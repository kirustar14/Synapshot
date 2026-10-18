// C5 Check-in log. The list of calls, and the full detail for the one that is open.

import { ChevronRight, Flag, RotateCcw, Ban } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useCheckin, useCheckins, useNote, useRescore, useUnusable } from "@/api/client";
import type { Checkin } from "@/api/types";
import {
  Empty,
  ErrorState,
  Loading,
  ModelLabel,
  Panel,
  fmtDate,
} from "@/components/common";
import { CHART } from "@/components/charts/chartTheme";
import { LineTrace } from "@/components/charts/LineTrace";
import { FeatureTable } from "@/components/panels/FeatureTable";
import { Transcript } from "@/components/panels/Transcript";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChannelHealth, GazeTrace } from "@/components/panels/AssessmentEvidence";
import { usePatientContext } from "./PatientLayout";

/** The exploratory face traces. Labelled exploratory because nothing scores on them. */
function FaceTraces({ traces }: { traces: NonNullable<Checkin["traces"]> }) {
  const data = traces.blink.t.map((t, i) => ({
    t: Number(t.toFixed(2)),
    blink: traces.blink.v[i],
    smile: traces.smile.v[i],
    brow: traces.brow.v[i],
  }));
  return (
    <LineTrace
      data={data}
      x="t"
      xLabel="seconds"
      series={[
        { key: "blink", label: "Blink", color: CHART.second },
        { key: "smile", label: "Smile", color: CHART.third },
        { key: "brow", label: "Brow", color: CHART.target },
      ]}
      height={170}
    />
  );
}

function CallDetail({ cid, patientId }: { cid: string; patientId: string }) {
  const { data, isLoading, error, refetch } = useCheckin(cid);
  const rescore = useRescore();
  const unusable = useUnusable();
  const note = useNote();
  const [task, setTask] = useState("");

  if (isLoading) return <Loading label="Loading the call" />;
  if (error || !data) return <ErrorState error={error} onRetry={() => refetch()} />;

  const tasks = data.gaze.length > 0 ? data.gaze.map((g) => g.task) : data.steps;

  return (
    <div className="space-y-5">
      <Panel
        title={`Week ${data.week}, ${fmtDate(data.date)}`}
        subtitle={`${Math.round(data.duration_s / 60)} minutes, ${data.steps.length} steps completed.`}
        action={<ModelLabel />}
      >
        <ChannelHealth channel={data.channel} />
        {data.unusable && (
          <p role="alert" className="mt-3 rounded-xl border border-destructive/30 bg-destructive-soft p-3 text-sm">
            This call is marked unusable, so the twin ignores it.
          </p>
        )}
        <div className="no-print mt-4 flex flex-wrap items-center gap-2">
          <Select value={task} onValueChange={setTask}>
            <SelectTrigger className="w-56" aria-label="Task to re-score">
              <SelectValue placeholder="Pick a task to re-score" />
            </SelectTrigger>
            <SelectContent>
              {tasks.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            disabled={!task || rescore.isPending}
            onClick={() =>
              rescore.mutate(
                { cid, task },
                {
                  onSuccess: () => toast.success(`${task} re-scored`),
                  onError: (err) => toast.error(err.message),
                },
              )
            }
          >
            <RotateCcw aria-hidden /> Re-score a task
          </Button>
          <Button
            variant="outline"
            disabled={unusable.isPending}
            onClick={() =>
              unusable.mutate(cid, {
                onSuccess: () => toast.success(data.unusable ? "Call marked usable again" : "Call marked unusable"),
                onError: (err) => toast.error(err.message),
              })
            }
          >
            <Ban aria-hidden /> {data.unusable ? "Mark data usable" : "Mark data unusable"}
          </Button>
          <Button
            variant="outline"
            disabled={note.isPending}
            onClick={() =>
              note.mutate(
                { id: patientId, text: `Flagged for review: week ${data.week} check-in, ${data.id}.` },
                {
                  onSuccess: () => toast.success("Flagged for review on the patient record"),
                  onError: (err) => toast.error(err.message),
                },
              )
            }
          >
            <Flag aria-hidden /> Flag for review
          </Button>
        </div>
      </Panel>

      <Panel title="Measures" subtitle="Each change is read against the smallest change this method can detect.">
        <FeatureTable features={data.features} />
      </Panel>

      <Panel title="Eye tracking" subtitle="Where the dot was against where the eyes went.">
        {data.gaze.length === 0 ? (
          <Empty>No gaze traces were kept for this call.</Empty>
        ) : (
          <div className="grid gap-6 lg:grid-cols-2">
            {data.gaze.map((g) => (
              <GazeTrace key={g.task} trace={g} />
            ))}
          </div>
        )}
      </Panel>

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Transcript">
          <Transcript lines={data.transcript} height={320} />
        </Panel>
        <Panel
          title="Blink, smile and brow"
          subtitle="Exploratory. Nothing on any other screen is scored from these traces."
          action={
            <span className="rounded-full border border-chart-2/40 bg-accent px-2 py-0.5 text-[11px] font-medium text-accent-foreground">
              Exploratory
            </span>
          }
        >
          {data.traces ? <FaceTraces traces={data.traces} /> : <Empty>No face traces were kept for this call.</Empty>}
        </Panel>
      </div>
    </div>
  );
}

export default function PatientCalls() {
  const { patient } = usePatientContext();
  const { data, isLoading, error, refetch } = useCheckins(patient.id);
  const [open, setOpen] = useState<string | null>(null);

  return (
    <div className="space-y-5">
      <Panel title="Check-ins" subtitle="Every completed weekly call, newest first. Open one for the full detail.">
        {isLoading && <Loading label="Loading check-ins" />}
        {error && <ErrorState error={error} onRetry={() => refetch()} />}
        {data && data.length === 0 && <Empty>No check-ins yet. The first call link has not been opened.</Empty>}
        {data && data.length > 0 && (
          <ul className="divide-y">
            {data.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3 py-4 text-sm">
                <span className="w-24 font-bold">Week {c.week}</span>
                <span className="w-32 text-muted-foreground">{fmtDate(c.date)}</span>
                <span className="w-16 text-muted-foreground">{Math.round(c.duration_s / 60)} min</span>
                <span className="w-24 text-muted-foreground">{c.steps.length} steps</span>
                <span className="min-w-0 flex-1">
                  <ChannelHealth channel={c.channel} />
                </span>
                {c.unusable && (
                  <span className="rounded-full border border-destructive/30 bg-destructive-soft px-2 py-0.5 text-[11px] text-destructive">
                    unusable
                  </span>
                )}
                <Button
                  size="sm"
                  variant={open === c.id ? "default" : "outline"}
                  onClick={() => setOpen(open === c.id ? null : c.id)}
                  aria-expanded={open === c.id}
                >
                  {open === c.id ? "Close" : "Open"} <ChevronRight aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {open && <CallDetail cid={open} patientId={patient.id} />}
    </div>
  );
}
