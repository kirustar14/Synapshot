// One alert row. The alerts screen passes the full action set, the patient overview passes
// none. Rows sit flat on their panel: red flags get a tinted ground as well as the chip, so
// colour is never the only signal.

import { CheckCircle2 } from "lucide-react";
import type { ReactNode } from "react";
import type { Alert } from "@/api/types";
import { FlagChip, fmtTime } from "@/components/common";
import { cn } from "@/lib/utils";

export function AlertCard({
  alert,
  patientName,
  actions,
}: {
  alert: Alert;
  patientName?: string;
  actions?: ReactNode;
}) {
  const urgent = alert.type === "red_flag" || alert.type === "drift";
  return (
    <article className={cn("rounded-[20px] p-5", urgent ? "bg-destructive-soft/60" : "bg-lab-surface")}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <FlagChip flag={alert.type} />
        {patientName && <span className="text-base font-extrabold">{patientName}</span>}
        <span className="text-[13px] font-semibold text-muted-foreground">{fmtTime(alert.time)}</span>
        <span className="ml-auto flex items-center gap-3 text-[13px] font-bold">
          {alert.called ? (
            <span className="flex items-center gap-1.5 text-success">
              <CheckCircle2 className="h-4 w-4" aria-hidden /> Clinic called
            </span>
          ) : (
            <span className="text-muted-foreground">Clinic not called yet</span>
          )}
          {alert.acked && <span className="text-muted-foreground">Acknowledged</span>}
        </span>
      </div>
      <p className="mt-2.5 max-w-3xl text-[15px] leading-relaxed">{alert.trigger}</p>
      {actions && <div className="no-print mt-4 flex flex-wrap gap-2">{actions}</div>}
    </article>
  );
}
