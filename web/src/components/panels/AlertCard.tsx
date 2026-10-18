// One alert row. The alerts screen passes the full action set, the patient overview passes
// none. Red flags carry a red left border as well as the chip.

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
  const red = alert.type === "red_flag";
  return (
    <article
      className={cn(
        "rounded-xl border bg-card p-4",
        red ? "border-l-4 border-l-destructive bg-destructive-soft/40" : "border-l-4 border-l-transparent",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <FlagChip flag={alert.type} />
        {patientName && <span className="text-sm font-bold">{patientName}</span>}
        <span className="text-[11px] text-muted-foreground">{fmtTime(alert.time)}</span>
        <span
          className={cn(
            "rounded-full border px-2 py-0.5 text-[11px] font-medium",
            alert.called
              ? "border-success/30 bg-success-soft text-success"
              : "border-border bg-muted text-muted-foreground",
          )}
        >
          {alert.called ? "clinic call made and confirmed" : "clinic call not made"}
        </span>
        {alert.acked && (
          <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
            acknowledged
          </span>
        )}
      </div>
      <p className="mt-2 text-sm leading-relaxed">{alert.trigger}</p>
      {actions && <div className="no-print mt-3 flex flex-wrap gap-2">{actions}</div>}
    </article>
  );
}
