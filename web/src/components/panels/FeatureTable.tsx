// The per call feature table: tier, value, previous value, and the change read against the
// minimal detectable change, so a reader can tell real movement from measurement noise.

import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import type { Feature } from "@/api/types";
import { Empty, TierChip } from "@/components/common";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

/** The change against the minimal detectable change, with a word for every colour. */
function verdict(f: Feature): { word: string; cls: string } {
  if (f.prev == null) return { word: "first reading", cls: "border-border bg-muted text-muted-foreground" };
  if (!f.changed) return { word: "within noise", cls: "border-success/30 bg-success-soft text-success" };
  return { word: "changed", cls: "border-synthetic/40 bg-synthetic-soft text-synthetic-foreground" };
}

export function FeatureTable({ features }: { features: Feature[] }) {
  if (features.length === 0) return <Empty>No features were scored on this call.</Empty>;

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Measure</TableHead>
          <TableHead>Tier</TableHead>
          <TableHead className="text-right">Value</TableHead>
          <TableHead className="text-right">Previous</TableHead>
          <TableHead className="text-right">Change</TableHead>
          <TableHead className="text-right">Smallest change we can detect</TableHead>
          <TableHead>Read</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {features.map((f) => {
          const delta = f.prev == null ? null : f.value - f.prev;
          const v = verdict(f);
          const Arrow = delta == null || Math.abs(delta) < 1e-9 ? Minus : delta > 0 ? ArrowUp : ArrowDown;
          return (
            <TableRow key={f.name}>
              <TableCell className="font-bold">
                {f.name}
                <span className="block text-[11px] font-medium text-muted-foreground">{f.unit}</span>
              </TableCell>
              <TableCell>
                <TierChip tier={f.tier} />
              </TableCell>
              <TableCell className="text-right font-mono">{f.value.toFixed(2)}</TableCell>
              <TableCell className="text-right font-mono text-muted-foreground">
                {f.prev == null ? "none" : f.prev.toFixed(2)}
              </TableCell>
              <TableCell className="text-right font-mono">
                <span className="inline-flex items-center gap-1">
                  <Arrow className="h-3 w-3" aria-hidden />
                  {delta == null ? "none" : `${delta > 0 ? "+" : ""}${delta.toFixed(2)}`}
                </span>
              </TableCell>
              <TableCell className="text-right font-mono text-muted-foreground">{f.mdc.toFixed(2)}</TableCell>
              <TableCell>
                <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium", v.cls)}>{v.word}</span>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
