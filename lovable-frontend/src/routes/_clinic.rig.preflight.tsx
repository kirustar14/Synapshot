import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle2, RefreshCw, XCircle } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { usePreflight } from "@/api/client";
import { ErrorState, Loading, PageHeader } from "@/components/common";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_clinic/rig/preflight")({
  head: () => ({
    meta: [
      { title: "Rig preflight | UNNAMED" },
      { name: "description", content: "Checklist to confirm the call rig is ready before the demo." },
      { property: "og:title", content: "Rig preflight | UNNAMED" },
      { property: "og:description", content: "Preflight checks for the call rig." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Preflight,
});

function Preflight() {
  const { data, isLoading, isFetching, error } = usePreflight();
  const qc = useQueryClient();
  const allOk = data?.every((c) => c.ok);
  return (
    <>
      <PageHeader title="Rig preflight" actions={<Button onClick={() => qc.refetchQueries({ queryKey: ["preflight"] })} disabled={isFetching}><RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} /> Re-run</Button>} />
      {isLoading ? <Loading label="Running checks" /> : error || !data ? <ErrorState error={error} /> : (
        <>
          <div role="status" className={cn("mb-6 rounded-xl p-5 text-lg font-semibold", allOk ? "bg-success-soft text-success" : "bg-destructive-soft text-destructive")}>
            {allOk ? "All green" : "Do not start the demo"}
          </div>
          <ul className="panel divide-y">
            {data.map((c) => (
              <li key={c.name} className="flex items-start gap-3 p-4">
                {c.ok ? <CheckCircle2 className="mt-0.5 h-5 w-5 text-success" aria-label="Passed" /> : <XCircle className="mt-0.5 h-5 w-5 text-destructive" aria-label="Failed" />}
                <div><p className="font-medium">{c.name}</p><p className="text-sm text-muted-foreground">{c.detail}</p></div>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
