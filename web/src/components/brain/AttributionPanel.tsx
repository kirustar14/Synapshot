// Tract attribution. Which tracts the model leans on per signal, always labelled a hypothesis
// because nothing here was measured on this patient.

import { FlaskConical } from "lucide-react";
import { useAttribution } from "@/api/client";
import { Empty, ErrorState, Loading } from "@/components/common";
import { useViewer } from "./viewerStore";

export function HypothesisBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-synthetic/50 bg-synthetic-soft px-2 py-0.5 text-[10px] font-bold text-synthetic-foreground">
      <FlaskConical className="h-2.5 w-2.5" aria-hidden /> Hypothesis
    </span>
  );
}

export function AttributionPanel({ patientId }: { patientId: string }) {
  const rows = useAttribution(patientId);
  const v = useViewer();

  if (rows.isLoading) return <Loading label="Ranking tracts" />;
  if (rows.error) return <ErrorState error={rows.error} onRetry={() => rows.refetch()} />;
  if (!rows.data || rows.data.length === 0) return <Empty>No attribution for this patient yet.</Empty>;

  return (
    <div className="space-y-4">
      <p className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <HypothesisBadge />
        {rows.data[0].note}
      </p>
      <ul className="grid gap-3 sm:grid-cols-2">
        {rows.data.map((row) => (
          <li key={row.signal} className="rounded-xl border p-3">
            <p className="text-xs font-extrabold">{row.signal}</p>
            <ol className="mt-1.5 space-y-1">
              {row.tracts.map((t, i) => (
                <li key={t.name} className="flex items-baseline justify-between gap-2 text-[11px]">
                  <span className="min-w-0 flex-1 truncate" title={t.name}>
                    <span className="mr-1 font-mono text-muted-foreground">{i + 1}</span>
                    {t.name}
                  </span>
                  <span className="shrink-0 font-mono tabular-nums">{t.score.toFixed(2)}</span>
                </li>
              ))}
            </ol>
            <button
              type="button"
              onClick={() => {
                v.setLayer("drivers");
                v.setSignal(row.signal);
              }}
              className="mt-2 text-[11px] text-primary underline-offset-4 hover:underline"
            >
              Light the regions behind {row.signal}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
