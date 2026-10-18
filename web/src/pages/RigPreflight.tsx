// R2 Preflight. Run it before every demo. One red check is enough to stop.

import { CheckCircle2, RefreshCw, XCircle } from "lucide-react";
import { usePreflight } from "@/api/client";
import { ErrorState, Loading, PageHeader, Panel } from "@/components/common";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function RigPreflight() {
  const { data, isLoading, error, refetch, isFetching } = usePreflight();
  const failed = data?.filter((c) => !c.ok) ?? [];
  const allGreen = !!data && failed.length === 0;

  return (
    <>
      <PageHeader
        title="Preflight"
        subtitle="Run this before every demo and before every scheduled call block."
        actions={
          <Button onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw aria-hidden /> {isFetching ? "Re-running" : "Re-run"}
          </Button>
        }
      />

      {isLoading && <Loading label="Running checks" />}
      {error && <ErrorState error={error} onRetry={() => refetch()} />}

      {data && (
        <>
          <div
            role="status"
            className={cn(
              "mb-5 flex flex-wrap items-center gap-3 rounded-xl border px-5 py-4 text-lg font-extrabold",
              allGreen
                ? "border-success/30 bg-success-soft text-success"
                : "border-destructive/40 bg-destructive-soft text-destructive",
            )}
          >
            {allGreen ? <CheckCircle2 className="h-5 w-5" aria-hidden /> : <XCircle className="h-5 w-5" aria-hidden />}
            {allGreen ? "All green" : "Do not start the demo"}
            {!allGreen && (
              <span className="text-sm font-bold">
                {failed.length === 1 ? `${failed[0].name} failed` : `${failed.map((c) => c.name).join(", ")} failed`}
              </span>
            )}
          </div>

          <Panel title={`Checks (${data.filter((c) => c.ok).length} of ${data.length} green)`}>
            <ul className="divide-y">
              {data.map((c) => (
                <li key={c.name} className="flex flex-wrap items-start gap-3 py-4 text-sm">
                  {c.ok ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
                  ) : (
                    <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
                  )}
                  <span className="w-44 shrink-0 font-bold">{c.name}</span>
                  <span className="min-w-0 flex-1 text-muted-foreground">{c.detail}</span>
                  <span
                    className={cn(
                      "rounded-full border px-2 py-0.5 text-[11px] font-medium",
                      c.ok
                        ? "border-success/30 bg-success-soft text-success"
                        : "border-destructive/30 bg-destructive-soft text-destructive",
                    )}
                  >
                    {c.ok ? "passed" : "failed"}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        </>
      )}
    </>
  );
}
