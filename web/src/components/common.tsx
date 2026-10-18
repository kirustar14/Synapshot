// Shared chips, panels and states. Every screen uses these, so the theme stays in one place.

import { AlertTriangle, CheckCircle2, CircleDashed, Loader2, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import type { Flag, InputFile } from "@/api/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

// The Synthetic, Real and Model output badges used to live here and were on nearly every
// surface. They are gone. The framing they carried now sits in the three places somebody
// actually reads it: the Honest limits block in the Evidence drawer, the footer of a
// printed summary, and the footer of every page of the sample PDFs. Repeating it on every
// chip taught people to stop seeing it, which is the opposite of the point.

const FLAG: Record<Flag, { label: string; cls: string }> = {
  red_flag: { label: "Red flag", cls: "border-destructive/40 bg-destructive-soft text-destructive" },
  missed_call: { label: "Missed call", cls: "border-border bg-muted text-muted-foreground" },
  low_quality: { label: "Low quality", cls: "border-synthetic/40 bg-synthetic-soft text-synthetic-foreground" },
  drift: { label: "Drift", cls: "border-chart-2/40 bg-accent text-accent-foreground" },
};

export const flagLabel = (f: Flag) => FLAG[f].label;

export function FlagChip({ flag }: { flag: Flag }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium", FLAG[flag].cls)}>
      {flag === "red_flag" && <AlertTriangle className="h-3 w-3" aria-hidden />}
      {FLAG[flag].label}
    </span>
  );
}

const STATUS: Record<InputFile["status"], { icon: typeof CheckCircle2; cls: string; label: string }> = {
  ok: { icon: CheckCircle2, cls: "text-success bg-success-soft border-success/30", label: "ok" },
  warn: { icon: AlertTriangle, cls: "text-synthetic-foreground bg-synthetic-soft border-synthetic/40", label: "warn" },
  error: { icon: XCircle, cls: "text-destructive bg-destructive-soft border-destructive/30", label: "error" },
  missing: { icon: CircleDashed, cls: "text-muted-foreground bg-muted border-border", label: "missing" },
};

export function StatusChip({ status }: { status: InputFile["status"] }) {
  const s = STATUS[status];
  const Icon = s.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium", s.cls)}>
      <Icon className="h-3 w-3" aria-hidden />
      {s.label}
    </span>
  );
}

export function TierChip({ tier }: { tier: "A" | "B" }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded border px-1 font-mono text-[10px] font-semibold",
        tier === "A" ? "border-primary/40 text-primary" : "border-chart-2/40 text-chart-2",
      )}
      aria-label={`Tier ${tier}`}
    >
      {tier}
    </span>
  );
}

export function Panel({
  title,
  subtitle,
  action,
  children,
  className,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("panel p-5", className)}>
      {(title || action) && (
        <header className="mb-4 flex items-start justify-between gap-3">
          <div>
            {title && <h2 className="text-base font-extrabold">{title}</h2>}
            {subtitle && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <div role="status" className="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {label}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="flex min-h-40 flex-col items-center justify-center gap-3 rounded-lg border border-destructive/30 bg-destructive-soft p-6 text-center text-sm"
    >
      <XCircle className="h-5 w-5 text-destructive" aria-hidden />
      <p>Could not load this. {error instanceof Error ? error.message : ""}</p>
      {onRetry && (
        <Button size="sm" variant="outline" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-32 items-center justify-center rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0 max-w-2xl">
        <h1 className="text-3xl font-extrabold">{title}</h1>
        {subtitle && <div className="mt-2 text-sm leading-relaxed text-muted-foreground">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export const fmtDate = (s: string | null) =>
  s ? new Date(s).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "None yet";

export const fmtTime = (s: string) =>
  new Date(s).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
