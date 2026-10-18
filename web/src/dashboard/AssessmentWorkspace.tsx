// Assessment workspace: a compact chronological timeline on the left, the selected session on
// the right. The selection lives in the URL, so a refresh, a back step or a shared link all
// reopen the same session.

import { Ban, ChevronLeft, Flag, RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { useCheckin, useCheckins, useNote, useRescore, useUnusable } from "@/api/client";
import type { Checkin } from "@/api/types";
import { ErrorState } from "@/components/common";
import { ChannelHealth, GazeTrace } from "@/components/panels/AssessmentEvidence";
import { Transcript } from "@/components/panels/Transcript";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { InlineEmpty } from "./components";
import { formatMeasure, humanizeMeasure, measureGroup } from "./derive";
import { cn } from "@/lib/utils";
import { usePatientContext } from "@/pages/PatientLayout";

type Tab = "tasks" | "video" | "eyes" | "speech" | "summary";

const TABS: { id: Tab; label: string }[] = [
  { id: "tasks", label: "Cognitive tasks" },
  { id: "video", label: "Video" },
  { id: "eyes", label: "Eye tracking" },
  { id: "speech", label: "Speech" },
  { id: "summary", label: "Summary" },
];

const QUALITY = (c: Checkin) => {
  if (c.unusable) return { label: "Unusable", tone: "bg-[#f8e6e2] text-[#96311f]" };
  if (c.channel.fps < 20 || c.channel.calib_err_deg > 1.5 || c.channel.face_share < 0.7)
    return { label: "Below capture limits", tone: "bg-[#f7efdb] text-[#7d5b17]" };
  return { label: "Within capture limits", tone: "bg-[#eaf0e8] text-[#3f6247]" };
};

const fmt = (v: number, unit: string) => formatMeasure(v, unit);

function Timeline({
  patientId,
  checkins,
  selected,
}: {
  patientId: string;
  checkins: Checkin[];
  selected: string | null;
}) {
  const ordered = useMemo(
    () => [...checkins].sort((a, b) => b.date.localeCompare(a.date)),
    [checkins],
  );
  return (
    <div className="dash-card overflow-hidden">
      <div className="border-b border-[#ece6dc] px-3 py-2.5">
        <h2 className="text-[12px] font-medium">Assessment timeline</h2>
        <p className="mt-0.5 text-[10px] text-[#8b8375]">{ordered.length} recorded sessions</p>
      </div>
      {ordered.length === 0 ? (
        <p className="px-3 py-6 text-[11px] leading-relaxed text-[#6d675e]">
          No check-in has been completed yet.
        </p>
      ) : (
        <ol className="dash-scroll max-h-[560px] overflow-y-auto">
          {ordered.map((c) => {
            const q = QUALITY(c);
            const active = c.id === selected;
            return (
              <li key={c.id} className="border-b border-[#f1ece4] last:border-0">
                <Link
                  to={`/app/patients/${patientId}/assessments/${c.id}`}
                  aria-current={active ? "true" : undefined}
                  className={cn(
                    "block border-l-2 px-3 py-2.5 transition-colors",
                    active
                      ? "border-[#b4552f] bg-[#fbf1e8]"
                      : "border-transparent hover:border-[#ded5c7] hover:bg-[#fbf8f2]",
                  )}
                >
                  <span className="flex items-baseline justify-between gap-2">
                    <span className={cn("text-[12px]", active ? "font-medium text-[#1c1a17]" : "text-[#55504a]")}>
                      {new Date(c.date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                    </span>
                    <span className="text-[10px] text-[#8b8375]">W{c.week}</span>
                  </span>
                  <span className="mt-0.5 flex items-center justify-between gap-2 text-[10px] text-[#8b8375]">
                    <span>{Math.round(c.duration_s / 60)} min · {c.steps.length} tasks</span>
                    <span className={cn("rounded-[3px] px-1 py-px", q.tone)}>{q.label === "Unusable" ? "Unusable" : q.label === "Below capture limits" ? "Low quality" : "OK"}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function TaskTable({ checkin }: { checkin: Checkin }) {
  if (checkin.features.length === 0)
    return <InlineEmpty>No scored measures were kept for this session.</InlineEmpty>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] border-collapse text-left">
        <thead>
          <tr className="border-b border-[#ece6dc]">
            <th scope="col" className="py-2 pr-3 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#8b8375]">Measure</th>
            <th scope="col" className="py-2 pr-3 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#8b8375]">Result</th>
            <th scope="col" className="py-2 pr-3 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#8b8375]">Previous</th>
            <th scope="col" className="py-2 pr-3 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#8b8375]">Change</th>
            <th scope="col" className="py-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#8b8375]">Noise threshold</th>
          </tr>
        </thead>
        <tbody>
          {checkin.features.map((f) => {
            const delta = f.prev === null ? null : f.value - f.prev;
            return (
              <tr key={f.name} className="border-b border-[#f1ece4] last:border-0">
                <td className="py-2.5 pr-3">
                  <span className="block text-[12px] font-medium text-[#1c1a17]">{humanizeMeasure(f.name)}</span>
                  <span className="block text-[10px] text-[#8b8375]">{measureGroup(f.name)} · tier {f.tier}</span>
                </td>
                <td className="py-2.5 pr-3 text-[12px] tabular-nums text-[#1c1a17]">{fmt(f.value, f.unit)}</td>
                <td className="py-2.5 pr-3 text-[12px] tabular-nums text-[#6d675e]">{f.prev === null ? "—" : fmt(f.prev, f.unit)}</td>
                <td className="py-2.5 pr-3 text-[12px] tabular-nums">
                  {delta === null ? (
                    <span className="text-[#8b8375]">First reading</span>
                  ) : Math.abs(delta) < 1e-9 ? (
                    <span className="text-[#6d675e]">No change</span>
                  ) : (
                    <span className={f.changed ? "text-[#8a4222]" : "text-[#6d675e]"}>
                      {delta > 0 ? "+" : "−"}
                      {fmt(Math.abs(delta), f.unit)}
                    </span>
                  )}
                </td>
                <td className="py-2.5 text-[11px] text-[#8b8375]">{fmt(f.mdc, f.unit)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-2 text-[10px] leading-relaxed text-[#8b8375]">
        A change is called measurable only when it exceeds the smallest detectable change for that method. Direction
        alone is not an interpretation of recovery.
      </p>
    </div>
  );
}

export function AssessmentWorkspace({ cid }: { cid?: string }) {
  const { patient } = usePatientContext();
  const list = useCheckins(patient.id);
  const ordered = useMemo(() => [...(list.data ?? [])].sort((a, b) => b.date.localeCompare(a.date)), [list.data]);
  const selected = cid ?? ordered[0]?.id ?? null;
  const detail = useCheckin(selected);
  const [tab, setTab] = useState<Tab>("tasks");
  const [task, setTask] = useState("");
  const rescore = useRescore();
  const unusable = useUnusable();
  const note = useNote();

  const call = detail.data;
  const quality = call ? QUALITY(call) : null;
  const speech = call?.features.filter((f) => measureGroup(f.name) === "Speech") ?? [];

  return (
    <div className="grid gap-4 xl:grid-cols-[214px_minmax(0,1fr)]">
      <div className="space-y-3">
        {list.isLoading ? (
          <div className="dash-card h-64 animate-pulse bg-[#faf7f1]" role="status" aria-label="Loading the assessment timeline" />
        ) : list.error ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : (
          <Timeline patientId={patient.id} checkins={ordered} selected={selected} />
        )}
        <Link
          to={`/app/patients/${patient.id}`}
          className="inline-flex items-center gap-1 px-1 text-[11px] text-[#8b8375] hover:text-[#8a4222]"
        >
          <ChevronLeft className="h-3 w-3" aria-hidden /> Patient overview
        </Link>
      </div>

      <div className="min-w-0 space-y-3">
        {!selected && !list.isLoading && (
          <div className="dash-card px-4 py-10 text-center text-[12px] text-[#6d675e]">
            No completed assessment is recorded for this patient yet.
          </div>
        )}

        {selected && detail.isLoading && (
          <div className="dash-card space-y-3 p-4" role="status" aria-label="Loading the assessment">
            <div className="h-4 w-56 animate-pulse rounded bg-[#f1ece4]" />
            <div className="h-3 w-80 animate-pulse rounded bg-[#f5f0e7]" />
            <div className="h-56 animate-pulse rounded-[7px] bg-[#faf7f1]" />
          </div>
        )}
        {detail.error && <ErrorState error={detail.error} onRetry={() => detail.refetch()} />}

        {call && (
          <>
            <div className="dash-card px-4 py-3.5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-[17px] font-semibold tracking-[-0.02em]">
                      {new Date(call.date).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}
                    </h2>
                    <span className="text-[11px] text-[#8b8375]">Week {call.week}</span>
                    {quality && <span className={cn("rounded-[4px] px-1.5 py-0.5 text-[10px]", quality.tone)}>{quality.label}</span>}
                  </div>
                  <p className="mt-1 text-[11px] text-[#6d675e]">
                    {Math.round(call.duration_s / 60)} min · {call.steps.length} tasks completed ·{" "}
                    {call.features.length} scored measures
                  </p>
                </div>
                <div className="no-print flex flex-wrap items-center gap-1.5">
                  <Select value={task} onValueChange={setTask}>
                    <SelectTrigger className="h-7 w-44 border-[#e6e0d6] bg-[#fffdfa] text-[11px]" aria-label="Task to re-score">
                      <SelectValue placeholder="Task to re-score" />
                    </SelectTrigger>
                    <SelectContent>
                      {(call.gaze.length > 0 ? call.gaze.map((g) => g.task) : call.steps).map((t) => (
                        <SelectItem key={t} value={t} className="text-[12px]">
                          {t.replace(/_/g, " ")}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1 border-[#e6e0d6] bg-[#fffdfa] px-2 text-[11px]"
                    disabled={!task || rescore.isPending}
                    onClick={() =>
                      rescore.mutate(
                        { cid: call.id, task },
                        {
                          onSuccess: () => toast.success(`${task} re-scored`),
                          onError: (err) => toast.error(err.message),
                        },
                      )
                    }
                  >
                    <RotateCcw className="h-3 w-3" aria-hidden /> Re-score
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1 border-[#e6e0d6] bg-[#fffdfa] px-2 text-[11px]"
                    disabled={unusable.isPending}
                    onClick={() =>
                      unusable.mutate(call.id, {
                        onSuccess: () => toast.success(call.unusable ? "Session marked usable" : "Session marked unusable"),
                        onError: (err) => toast.error(err.message),
                      })
                    }
                  >
                    <Ban className="h-3 w-3" aria-hidden /> {call.unusable ? "Mark usable" : "Mark unusable"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1 border-[#e6e0d6] bg-[#fffdfa] px-2 text-[11px]"
                    disabled={note.isPending}
                    onClick={() =>
                      note.mutate(
                        { id: patient.id, text: `Flagged for review: week ${call.week} assessment, ${call.id}.` },
                        {
                          onSuccess: () => toast.success("Flagged for review on the patient record"),
                          onError: (err) => toast.error(err.message),
                        },
                      )
                    }
                  >
                    <Flag className="h-3 w-3" aria-hidden /> Flag
                  </Button>
                </div>
              </div>

              {call.unusable && (
                <p role="alert" className="mt-2.5 rounded-[7px] border border-[#edd6cf] bg-[#fbf0ec] px-3 py-2 text-[11px] text-[#96311f]">
                  This session is marked unusable, so the recovery model ignores its measures.
                </p>
              )}

              <div className="mt-2.5">
                <ChannelHealth channel={call.channel} />
              </div>
            </div>

            <div className="dash-card overflow-hidden">
              <div role="tablist" aria-label="Assessment evidence" className="flex gap-4 overflow-x-auto border-b border-[#e6e0d6] px-4">
                {TABS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    role="tab"
                    id={`assess-tab-${t.id}`}
                    aria-selected={tab === t.id}
                    aria-controls={`assess-panel-${t.id}`}
                    onClick={() => setTab(t.id)}
                    className={cn(
                      "-mb-px h-9 whitespace-nowrap border-b-2 text-[12px] transition-colors",
                      tab === t.id
                        ? "border-[#b4552f] font-medium text-[#1c1a17]"
                        : "border-transparent text-[#6d675e] hover:text-[#1c1a17]",
                    )}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              <div className="p-4">
                <div role="tabpanel" id={`assess-panel-${tab}`} aria-labelledby={`assess-tab-${tab}`}>
                  {tab === "tasks" && (
                    <div className="space-y-4">
                      <TaskTable checkin={call} />
                      <div>
                        <h3 className="text-[12px] font-medium">Tasks in this session</h3>
                        <p className="mt-0.5 text-[11px] text-[#8b8375]">
                          {call.steps.length} scripted steps completed. Step order and scoring are fixed by the
                          assessment script.
                        </p>
                        <ul className="mt-2 flex flex-wrap gap-1.5">
                          {call.steps.map((s) => (
                            <li key={s} className="rounded-[4px] border border-[#e6e0d6] bg-[#fbf9f4] px-1.5 py-0.5 text-[10px] capitalize text-[#6d675e]">
                              {s.replace(/_/g, " ")}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}

                  {tab === "video" && (
                    <div className="space-y-3">
                      <InlineEmpty>
                        <span className="block font-medium text-[#55504a]">No video is stored for this check-in.</span>
                        <span className="mt-1 block">
                          The call runs in the patient's browser and only the measurements, gaze traces and transcript
                          are written to the record. This workspace will not show footage it does not have.
                        </span>
                      </InlineEmpty>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="rounded-[7px] border border-[#ece6dc] bg-[#fbf9f4] p-3">
                          <p className="text-[11px] font-medium">Capture evidence retained</p>
                          <p className="mt-1 text-[11px] leading-relaxed text-[#6d675e]">
                            Frame rate, calibration error, face share and the flash test result, shown above. These are
                            the only capture readings kept.
                          </p>
                        </div>
                        <div className="rounded-[7px] border border-[#ece6dc] bg-[#fbf9f4] p-3">
                          <p className="text-[11px] font-medium">What would make a video available</p>
                          <p className="mt-1 text-[11px] leading-relaxed text-[#6d675e]">
                            A recording pipeline and an explicit consent flag are not implemented in this prototype, so
                            no session can produce footage yet.
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  {tab === "eyes" && (
                    <div className="space-y-4">
                      {call.gaze.length === 0 ? (
                        <InlineEmpty>No gaze traces were kept for this session.</InlineEmpty>
                      ) : (
                        <>
                          <p className="text-[11px] leading-relaxed text-[#8b8375]">
                            Where the target was against where the eyes went. Calibration error for this session was{" "}
                            {call.channel.calib_err_deg} deg.
                          </p>
                          <div className="grid gap-5 lg:grid-cols-2">
                            {call.gaze.map((g) => (
                              <GazeTrace key={g.task} trace={g} />
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  {tab === "speech" && (
                    <div className="space-y-4">
                      {speech.length > 0 ? (
                        <div className="grid gap-3 sm:grid-cols-2">
                          {speech.map((f) => (
                            <div key={f.name} className="rounded-[7px] border border-[#ece6dc] bg-[#fbf9f4] px-3 py-2.5">
                              <p className="text-[11px] text-[#6d675e]">{humanizeMeasure(f.name)}</p>
                              <p className="mt-0.5 text-[16px] font-medium tabular-nums">
                                {fmt(f.value, f.unit)}
                                {f.prev !== null && (
                                  <span className="ml-2 text-[10px] font-normal text-[#8b8375]">
                                    previous {fmt(f.prev, f.unit)}
                                  </span>
                                )}
                              </p>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <InlineEmpty>No speech measures were scored for this session.</InlineEmpty>
                      )}
                      <div>
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <h3 className="text-[12px] font-medium">Transcript</h3>
                          <span className="text-[10px] text-[#8b8375]">
                            Audio is not retained for check-ins; the transcript is.
                          </span>
                        </div>
                        <div className="mt-2">
                          <Transcript lines={call.transcript} height={280} />
                        </div>
                      </div>
                    </div>
                  )}

                  {tab === "summary" && (
                    <div className="space-y-4">
                      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
                        {[
                          ["Assessment date", new Date(call.date).toLocaleDateString()],
                          ["Session duration", `${Math.round(call.duration_s / 60)} min`],
                          ["Tasks completed", String(call.steps.length)],
                          ["Scored measures", String(call.features.length)],
                          ["Video", "Not stored"],
                          ["Audio", "Not stored"],
                          ["Transcript", "Available"],
                          ["Gaze traces", call.gaze.length ? `${call.gaze.length} tasks` : "None"],
                        ].map(([k, v]) => (
                          <div key={k}>
                            <dt className="text-[11px] text-[#8b8375]">{k}</dt>
                            <dd className="mt-0.5 text-[12px] font-medium">{v}</dd>
                          </div>
                        ))}
                      </dl>
                      <div className="rounded-[7px] border border-[#ece6dc] bg-[#fbf9f4] p-3">
                        <p className="text-[11px] font-medium">Data quality</p>
                        <div className="mt-1.5">
                          <ChannelHealth channel={call.channel} />
                        </div>
                        <p className="mt-2 text-[11px] leading-relaxed text-[#6d675e]">
                          A failed flash test stops saccade latency from being scored rather than reporting an
                          unaligned timing. Low frame rate or calibration error lowers the reliability of the eye
                          measures.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
