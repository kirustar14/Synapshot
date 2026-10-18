// The care pipeline: three CREAO agents, triage then briefing and outreach. Starting it is always
// a click, because every run spends credits. Triage decides what happens next, and when it
// escalates the app adds an alert. Nothing here is sent to the patient or rings anyone: the text
// is a draft for the clinician.

import { ArrowRight, Bot, CheckCircle2, CircleDashed, Loader2, MinusCircle, Sparkles, XCircle } from "lucide-react";
import { toast } from "sonner";
import { usePipeline, useStartPipeline } from "@/api/client";
import type { AgentStage } from "@/api/types";
import { Panel } from "@/components/common";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const LEVEL: Record<string, string> = {
  routine: "border-success/30 bg-success-soft text-success",
  watch: "border-synthetic/40 bg-synthetic-soft text-synthetic-foreground",
  escalate: "border-destructive/40 bg-destructive-soft text-destructive",
};

function StageChip({ stage }: { stage: AgentStage }) {
  const running = stage.status === "pending" || stage.status === "running";
  const Icon = running ? Loader2 : stage.status === "completed" ? CheckCircle2 : stage.status === "skipped" ? MinusCircle : stage.status === "failed" || stage.status === "cancelled" ? XCircle : CircleDashed;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
        stage.status === "completed" ? "border-success/30 bg-success-soft text-success" : "border-border bg-muted text-muted-foreground",
      )}
      title={stage.mock ? "Template, no CREAO agent was called" : `CREAO agent ${stage.agent_id}`}
    >
      <Icon className={cn("h-3.5 w-3.5", running && "animate-spin")} aria-hidden />
      {stage.label}
      <span className="font-normal opacity-70">{stage.status === "skipped" ? "skipped" : stage.mock ? "template" : "agent"}</span>
    </span>
  );
}

export function PipelinePanel({ patientId }: { patientId: string }) {
  const run = usePipeline(patientId);
  const start = useStartPipeline();
  const data = run.data;
  const going = data?.status === "running";

  const ask = () =>
    start.mutate(patientId, {
      onSuccess: () => toast.success("Pipeline started"),
      onError: (err) => toast.error(err.message),
    });

  return (
    <Panel
      title="Care pipeline"
      subtitle="Three agents on CREAO. Triage rates the week, then briefing and outreach work from that rating. Drafts for you, nothing is sent to the patient."
      action={
        <Button variant="outline" onClick={ask} disabled={start.isPending || going}>
          {going ? <Loader2 className="animate-spin" aria-hidden /> : <Sparkles aria-hidden />}
          {going ? "Agents are working" : data ? "Run again" : "Run the agents"}
        </Button>
      }
    >
      {!data && <p className="text-sm text-muted-foreground">Not run yet. It takes a few minutes, and each agent run uses credits.</p>}

      {data && (
        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap items-center gap-1.5">
            <Bot className="mr-1 h-4 w-4 text-muted-foreground" aria-hidden />
            {data.stages.map((s, i) => (
              <span key={s.role} className="inline-flex items-center gap-1.5">
                <StageChip stage={s} />
                {i < data.stages.length - 1 && <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />}
              </span>
            ))}
          </div>

          {data.stages.some((s) => s.error) && (
            <p className="text-destructive">{data.stages.find((s) => s.error)?.error}</p>
          )}

          {data.level && (
            <div className="space-y-1">
              <p className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Triage</span>
                <span className={cn("rounded-full border px-2 py-0.5 text-xs font-bold", LEVEL[data.level] ?? "border-border")}>{data.level}</span>
                {data.escalated && <span className="text-xs text-muted-foreground">An alert was added to the clinician list. No call was made.</span>}
              </p>
              {data.reasons.length > 0 && (
                <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
                  {data.reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {!data.briefing && data.status === "completed" && (
            <p className="text-muted-foreground">
              The briefing agent did not return a readable briefing. Update its instructions from docs/CREAO.md and run again.
            </p>
          )}
          {data.briefing && (
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Briefing</p>
              <p className="mt-1 whitespace-pre-line leading-relaxed">{data.briefing}</p>
            </div>
          )}
          {data.follow_ups.length > 0 && (
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Questions to ask</p>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                {data.follow_ups.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </div>
          )}
          {(data.patient_message || data.next_steps.length > 0) && (
            <div className="rounded-lg border border-dashed p-3">
              <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Outreach draft, not sent</p>
              {data.patient_message && <p className="mt-1 leading-relaxed">{data.patient_message}</p>}
              {data.next_steps.length > 0 && (
                <ul className="mt-2 list-disc space-y-0.5 pl-5 text-muted-foreground">
                  {data.next_steps.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}
