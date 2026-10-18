// The Evidence drawer: what every number on this screen rests on.
//
// Two halves. The live validation numbers, read from the fit as it is right now, and the
// claims from docs/RESEARCH.md, each tagged verified or check this.
//
// Never hide a weak number. A number below its target is shown with a red mark and sorted
// to the top, not buried under the ones that pass. The tag filter defaults to showing
// everything, and the "check this" count is in the header where it cannot be missed. If a
// sceptical reader cannot find the weak parts of this system faster here than by reading
// the code, this drawer is not doing its job.

import { AlertTriangle, BookOpenCheck, Check, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useEvidence, type EvidenceNumber } from "@/api/client";
import { Loading } from "@/components/common";
import { Fold } from "@/components/fold";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

/**
 * The limits come straight out of docs/RESEARCH.md, where each one opens with a bold
 * headline sentence. Rendered raw that reads as `**Every patient is synthetic.**`, and
 * this is one of the three places the framing is kept, so it has to read like prose.
 * Only bold, because only bold is used.
 */
function Markdown({ text }: { text: string }) {
  return (
    <>
      {text.split("**").map((part, i) =>
        i % 2 ? <strong key={i}>{part}</strong> : <span key={i}>{part}</span>,
      )}
    </>
  );
}

function NumberRow({ row }: { row: EvidenceNumber }) {
  return (
    <li
      className={cn(
        "rounded-xl border px-3 py-2.5",
        row.ok ? "border-border bg-background" : "border-destructive/40 bg-destructive-soft",
      )}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs font-bold">{row.name}</span>
        <span className="flex shrink-0 items-center gap-1.5">
          <span className="font-mono text-sm font-black">
            {typeof row.value === "number" && row.value < 1 && row.value > 0
              ? row.value.toFixed(3)
              : row.value}
          </span>
          {row.ok ? (
            <Check className="h-3.5 w-3.5 text-success" aria-label="at target" />
          ) : (
            <AlertTriangle className="h-3.5 w-3.5 text-destructive" aria-label="below target" />
          )}
        </span>
      </div>
      <p className="mt-0.5 text-[10px] text-muted-foreground">{row.unit}</p>
      <p className="mt-1 text-[11px] leading-snug">{row.say}</p>
      {row.caveat && (
        <p className="mt-1 text-[10px] leading-snug text-muted-foreground">{row.caveat}</p>
      )}
      {row.detail && (
        <p className="mt-1 text-[10px] leading-snug text-muted-foreground">{row.detail}</p>
      )}
    </li>
  );
}

export function EvidenceDrawer({
  open,
  section,
  onClose,
}: {
  open: boolean;
  section: string;
  onClose: () => void;
}) {
  const evidence = useEvidence();
  const [tag, setTag] = useState<"all" | "verified" | "check this">("all");
  const [focus, setFocus] = useState<string>("");

  const active = focus || section;

  const claims = useMemo(() => {
    const all = evidence.data?.claims ?? [];
    return all
      .filter((c) => (tag === "all" ? true : c.tag === tag))
      .filter((c) => (active ? c.section === active : true));
  }, [evidence.data, tag, active]);

  // Weak numbers first. A panel that sorts its passes to the top is a panel that is
  // trying to look good.
  const numbers = useMemo(() => {
    const all = evidence.data?.numbers ?? [];
    return [...all].sort((a, b) => Number(a.ok) - Number(b.ok));
  }, [evidence.data]);

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
        <SheetTitle className="sr-only">Evidence</SheetTitle>

        <header className="flex items-start gap-3 border-b border-border/70 px-5 py-4">
          <BookOpenCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-black">Evidence</h2>
            <p className="text-xs text-muted-foreground">
              {evidence.data
                ? `${evidence.data.counts.verified} claims checked, ${evidence.data.counts.check_this} not. ${evidence.data.numbers.length} live numbers.`
                : "What this rests on."}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 hover:bg-muted">
            <X className="h-4 w-4" aria-hidden />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {evidence.isLoading && <Loading label="Reading the research file" />}

          {evidence.data && (
            <>
              {evidence.data.weak.length > 0 && (
                <p className="mb-4 rounded-xl border border-destructive/40 bg-destructive-soft px-3 py-2 text-[11px] leading-snug">
                  <AlertTriangle className="mr-1 inline h-3 w-3" aria-hidden />
                  {evidence.data.weak.length} number
                  {evidence.data.weak.length === 1 ? " is" : "s are"} below target right now:{" "}
                  {evidence.data.weak.join(", ")}.
                </p>
              )}

              <Fold
                id="evidence.numbers"
                title="The numbers, as they are right now"
                summary={`${numbers.length} live, ${evidence.data.weak.length} below target`}
              >
                <ul className="space-y-2">
                  {numbers.map((n) => (
                    <NumberRow key={n.name} row={n} />
                  ))}
                </ul>
              </Fold>

              <Fold
                id="evidence.claims"
                title="The claims"
                summary={`${evidence.data.claims.length} across ${evidence.data.sections.length} sections`}
              >
              <div className="mb-3 flex flex-wrap gap-1">
                {(["all", "verified", "check this"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={tag === t}
                    onClick={() => setTag(t)}
                    className={cn(
                      "rounded-full border px-2.5 py-0.5 text-[11px] font-bold capitalize",
                      tag === t ? "border-primary bg-primary text-primary-foreground" : "border-border",
                    )}
                  >
                    {t}
                  </button>
                ))}
                <span className="mx-1 w-px bg-border" aria-hidden />
                <button
                  type="button"
                  aria-pressed={!active}
                  onClick={() => setFocus("")}
                  className={cn(
                    "rounded-full border px-2.5 py-0.5 text-[11px] font-bold",
                    !active ? "border-primary bg-primary text-primary-foreground" : "border-border",
                  )}
                >
                  All sections
                </button>
                {evidence.data.sections.map((s) => (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={active === s}
                    onClick={() => setFocus(active === s ? "" : s)}
                    className={cn(
                      "rounded-full border px-2.5 py-0.5 text-[11px]",
                      active === s ? "border-primary bg-primary-soft font-bold" : "border-border",
                    )}
                  >
                    {s}
                  </button>
                ))}
              </div>

              <ul className="space-y-3">
                {claims.map((c, i) => (
                  <li key={`${c.section}-${i}`} className="rounded-xl border border-border px-3 py-2.5">
                    <div className="flex items-start gap-2">
                      <span
                        className={cn(
                          "mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[9px] font-black uppercase",
                          c.tag === "verified"
                            ? "bg-success-soft text-success"
                            : "bg-synthetic-soft text-synthetic-foreground",
                        )}
                      >
                        {c.tag || "untagged"}
                      </span>
                      <span className="text-[10px] text-muted-foreground">{c.section}</span>
                    </div>
                    <p className="mt-1.5 text-xs font-bold leading-snug">{c.claim}</p>
                    {c.source && (
                      <p className="mt-1 text-[10px] leading-snug text-muted-foreground">{c.source}</p>
                    )}
                    {c.detail && (
                      <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{c.detail}</p>
                    )}
                  </li>
                ))}
                {claims.length === 0 && (
                  <li className="text-xs text-muted-foreground">Nothing matches that filter.</li>
                )}
              </ul>
              </Fold>

              {/* Not a fold. This is one of the three places the framing is kept, and a
                  disclosure somebody has to open is a disclosure most people never read.
                  With the two lists above it closed, it is the first thing in the drawer. */}
              <h3 className="mb-2 mt-5 text-[10px] font-black uppercase tracking-wide text-destructive">
                Honest limits
              </h3>
              <ol className="list-decimal space-y-2 pl-4">
                {evidence.data.limits.map((l) => (
                  <li key={l} className="text-[11px] leading-snug">
                    <Markdown text={l} />
                  </li>
                ))}
              </ol>

              <p className="mt-5 text-[10px] text-muted-foreground">
                {evidence.data.note} Read in full at <code>{evidence.data.doc}</code>.
              </p>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
