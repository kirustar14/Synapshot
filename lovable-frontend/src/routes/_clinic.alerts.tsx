import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, CheckCheck, ExternalLink, Phone } from "lucide-react";
import { toast } from "sonner";
import { api, useAction, useAlerts, usePatients } from "@/api/client";
import { Empty, ErrorState, FlagChip, fmtTime, Loading, PageHeader, SyntheticBadge } from "@/components/common";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_clinic/alerts")({
  head: () => ({
    meta: [
      { title: "Alerts | UNNAMED" },
      { name: "description", content: "Red flags, drift, missed calls and low quality alerts across patients." },
      { property: "og:title", content: "Alerts | UNNAMED" },
      { property: "og:description", content: "Clinical alerts from weekly check-ins." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Alerts,
});

function Alerts() {
  const { data, isLoading, error, refetch } = useAlerts();
  const { data: patients } = usePatients();
  const ack = useAction((id: string) => api.ack(id), { onSuccess: () => toast.success("Alert acknowledged") });
  const call = useAction((id: string) => api.callAlert(id), { onSuccess: () => toast.success("Clinic call placed. Patient got a text.") });
  const name = (pid: string) => patients?.find((p) => p.id === pid)?.name ?? pid;

  return (
    <>
      <PageHeader title="Alerts" subtitle="Red flags are pinned to the top. Refreshes every 5 seconds." actions={<SyntheticBadge />} />
      {isLoading ? <Loading /> : error ? <ErrorState error={error} onRetry={refetch} /> : !data?.length ? <Empty>No alerts. Everything looks within expected ranges.</Empty> : (
        <ul className="space-y-3">
          {data.map((a) => (
            <li key={a.id} className={cn("panel flex flex-wrap items-center gap-4 p-4", a.type === "red_flag" && "border-l-4 border-l-destructive", a.acked && "opacity-60")}>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <FlagChip flag={a.type} />
                  <span className="text-sm font-semibold">{name(a.patient_id)}</span>
                  <span className="text-xs text-muted-foreground">{fmtTime(a.time)}</span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{a.trigger}</p>
                <div className="mt-2 flex gap-3 text-xs">
                  <span className={a.called ? "text-success" : "text-muted-foreground"}>{a.called ? "Clinic call made" : "Clinic call not made"}</span>
                  <span className={a.acked ? "text-success" : "text-muted-foreground"}>{a.acked ? "Confirmed" : "Not confirmed"}</span>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" disabled={a.acked} onClick={() => ack.mutate(a.id)}><Check className="h-4 w-4" /> Acknowledge</Button>
                <Button size="sm" variant="outline" onClick={() => call.mutate(a.id)}><Phone className="h-4 w-4" /> Call patient</Button>
                <Button size="sm" variant="outline" disabled={a.acked} onClick={() => { call.mutate(a.id); ack.mutate(a.id); toast("Resolved"); }}><CheckCheck className="h-4 w-4" /> Resolve</Button>
                <Button size="sm" asChild><Link to="/patients/$id" params={{ id: a.patient_id }}><ExternalLink className="h-4 w-4" /> Open patient</Link></Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
