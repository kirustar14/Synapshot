import { createFileRoute } from "@tanstack/react-router";
import { Ban, Flag, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { api, useAction, useCheckin, useCheckins, usePatient } from "@/api/client";
import type { Checkin } from "@/api/types";
import { Empty, ErrorState, fmtDate, Loading, Panel, SyntheticBadge, TierChip } from "@/components/common";
import { PatientHeader } from "@/components/PatientHeader";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_clinic/patients/$id/calls")({
  head: () => ({
    meta: [
      { title: "Call log | Synapshot" },
      { name: "description", content: "Weekly call history with features, gaze traces and transcripts." },
      { property: "og:title", content: "Call log | Synapshot" },
      { property: "og:description", content: "Weekly FaceTime check-in history for one patient." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Calls,
});

function Calls() {
  const { id } = Route.useParams();
  const p = usePatient(id);
  const list = useCheckins(id);
  const [sel, setSel] = useState<string | null>(null);
  useEffect(() => { if (!sel && list.data?.length) setSel(list.data[0].id); }, [list.data, sel]);

  if (p.isLoading) return <Loading />;
  if (p.error || !p.data) return <ErrorState error={p.error} onRetry={p.refetch} />;

  return (
    <div>
      <PatientHeader patient={p.data} />
      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <Panel title="Calls">
          {list.isLoading ? <Loading /> : list.error ? <ErrorState error={list.error} onRetry={list.refetch} /> : !list.data?.length ? <Empty>No calls yet.</Empty> : (
            <ul className="space-y-2" role="listbox" aria-label="Calls">
              {list.data.map((c) => (
                <li key={c.id}>
                  <button role="option" aria-selected={sel === c.id} onClick={() => setSel(c.id)}
                    className={cn("w-full rounded-lg border p-3 text-left text-sm transition-colors hover:bg-accent/50", sel === c.id && "border-primary bg-primary-soft")}>
                    <div className="flex items-center justify-between"><span className="font-medium">Week {c.week}</span><span className="text-xs text-muted-foreground">{fmtDate(c.date)}</span></div>
                    <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                      <span>{Math.round(c.duration_s / 60)} min</span><span>{c.steps.length}/10 steps</span>
                      <span className={c.channel.fps < 24 ? "text-destructive" : ""}>{c.channel.fps} fps</span>
                      <span>calib {c.channel.calib_err_deg} deg</span><span>face {Math.round(c.channel.face_share * 100)}%</span>
                      <span>flash {c.channel.flash_ok ? "pass" : "fail"}</span>
                    </div>
                    {c.unusable && <span className="mt-1 inline-block rounded-full bg-destructive-soft px-2 py-0.5 text-[10px] font-medium text-destructive">Marked unusable</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        {sel ? <CallDetail cid={sel} /> : <Empty>Select a call.</Empty>}
      </div>
    </div>
  );
}

function CallDetail({ cid }: { cid: string }) {
  const c = useCheckin(cid);
  const rescore = useAction((task: string) => api.rescore(cid, task), { onSuccess: (_r, t) => toast.success(`${t} re-scored`) });
  const unusable = useAction(() => api.unusable(cid), { onSuccess: () => toast("Call usability updated") });
  if (c.isLoading) return <Loading />;
  if (c.error || !c.data) return <ErrorState error={c.error} onRetry={c.refetch} />;
  const d = c.data;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="outline" size="sm"><RotateCcw className="h-4 w-4" /> Re-score a task</Button></DropdownMenuTrigger>
          <DropdownMenuContent>{d.steps.map((s) => <DropdownMenuItem key={s} onSelect={() => rescore.mutate(s)}>{s}</DropdownMenuItem>)}</DropdownMenuContent>
        </DropdownMenu>
        <Button variant="outline" size="sm" onClick={() => unusable.mutate(undefined)}><Ban className="h-4 w-4" /> {d.unusable ? "Mark data usable" : "Mark data unusable"}</Button>
        <Button variant="outline" size="sm" onClick={() => toast.success("Flagged for clinical review")}><Flag className="h-4 w-4" /> Flag for review</Button>
        <SyntheticBadge className="ml-auto self-center" />
      </div>
      <Panel title={`Features, week ${d.week}`} subtitle="Change is compared with the minimal detectable change (MDC)">
        {d.features.length === 0 ? <Empty>No features scored.</Empty> : (
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-1.5 font-medium">Feature</th><th className="font-medium">Tier</th><th className="font-medium">Value</th><th className="font-medium">Previous</th><th className="font-medium">Change vs MDC</th></tr></thead>
            <tbody>{d.features.map((f) => {
              const delta = f.prev == null ? null : f.value - f.prev;
              return (
                <tr key={f.name} className="border-t">
                  <td className="py-2">{f.name}</td><td><TierChip tier={f.tier} /></td>
                  <td className="font-mono tabular-nums">{f.value.toFixed(2)} <span className="text-xs text-muted-foreground">{f.unit}</span></td>
                  <td className="font-mono tabular-nums text-muted-foreground">{f.prev?.toFixed(2) ?? "n/a"}</td>
                  <td>{delta == null ? <span className="text-xs text-muted-foreground">Baseline</span> : (
                    <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium", f.changed ? "bg-synthetic-soft text-synthetic-foreground" : "bg-success-soft text-success")}>
                      {f.changed ? "Changed" : "Within noise"} ({delta >= 0 ? "+" : ""}{delta.toFixed(2)}, MDC {f.mdc})
                    </span>
                  )}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
      </Panel>
      <div className="grid gap-6 md:grid-cols-2">
        {d.gaze.map((g) => (
          <Panel key={g.task} title={`${g.task}, gaze trace`} subtitle="Horizontal position in degrees">
            <Trace data={g.t.map((t, i) => ({ t, target: g.tx[i], gaze: g.x[i] }))} lines={[{ k: "target", c: "var(--color-muted-foreground)", dash: true }, { k: "gaze", c: "var(--color-primary)" }]} />
          </Panel>
        ))}
      </div>
      {d.traces && (
        <Panel title="Facial movement" action={<span className="rounded-full border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">Exploratory</span>}>
          <Trace data={d.traces.blink.t.map((t, i) => ({ t, blink: d.traces!.blink.v[i], smile: d.traces!.smile.v[i], brow: d.traces!.brow.v[i] }))}
            lines={[{ k: "blink", c: "var(--color-chart-2)" }, { k: "smile", c: "var(--color-chart-3)" }, { k: "brow", c: "var(--color-chart-4)" }]} />
        </Panel>
      )}
      <Panel title="Transcript">
        <Transcript items={d.transcript} />
      </Panel>
    </div>
  );
}

function Trace({ data, lines }: { data: Record<string, number>[]; lines: { k: string; c: string; dash?: boolean }[] }) {
  return (
    <div className="h-44" role="img" aria-label={`Trace of ${lines.map((l) => l.k).join(", ")}`}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ left: -20, right: 6 }}>
          <CartesianGrid stroke="var(--color-border)" vertical={false} />
          <XAxis dataKey="t" tick={{ fontSize: 10 }} tickFormatter={(v) => `${Number(v).toFixed(1)}s`} />
          <YAxis tick={{ fontSize: 10 }} />
          <Tooltip contentStyle={{ background: "var(--color-popover)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 }} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {lines.map((l) => <Line key={l.k} dataKey={l.k} stroke={l.c} dot={false} strokeWidth={1.5} strokeDasharray={l.dash ? "4 3" : undefined} isAnimationActive={false} />)}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function Transcript({ items }: { items: Checkin["transcript"] }) {
  return (
    <ul className="space-y-2 text-sm">
      {items.map((l, i) => (
        <li key={i} className="flex gap-3">
          <span className="w-12 shrink-0 font-mono text-xs text-muted-foreground">{Math.floor(l.t / 60)}:{String(Math.round(l.t % 60)).padStart(2, "0")}</span>
          <span className={cn("w-16 shrink-0 text-xs font-semibold uppercase", l.who === "agent" ? "text-primary" : "text-chart-2")}>{l.who === "agent" ? "Agent" : "Patient"}</span>
          <span>{l.text}</span>
        </li>
      ))}
    </ul>
  );
}
