// Add a patient by giving it their documents.
//
// Drop files, or press the sample button, and watch five steps go by. Each line reports
// what the backend actually did with the files: how many were readable, which extractor
// ran, how many fields came back and how many of them need a human.
//
// The build log is the point of this screen. Anyone can write an upload box that spins
// and then shows a finished record; this says what happened in between, including the
// parts that did not work.

import {
  AlertTriangle,
  ArrowRight,
  Check,
  FileText,
  Image as ImageIcon,
  Loader2,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ingest, type IngestDone, type IngestEvent } from "@/api/client";
import { queryClient } from "@/App";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const STEP_IDS = ["read", "extract", "check", "twin", "forecast"] as const;
const STEP_LABEL: Record<string, string> = {
  read: "Reading the files",
  extract: "Pulling out the facts",
  check: "Checking them against the schema",
  twin: "Building the twin",
  forecast: "Fitting the first forecast",
};

interface StepState {
  state: "waiting" | "running" | "done" | "failed";
  detail?: string;
  items?: { name: string; kind: string; why?: string }[];
}

const BLANK: Record<string, StepState> = Object.fromEntries(
  STEP_IDS.map((id) => [id, { state: "waiting" as const }]),
);

const MB = 1024 * 1024;

function FileRow({ file, onRemove }: { file: File; onRemove: () => void }) {
  const isImage = /\.(png|jpe?g|webp|gif)$/i.test(file.name);
  return (
    <li className="flex items-center gap-2 rounded-lg border border-border/70 bg-muted/40 px-3 py-2 text-sm">
      {isImage ? (
        <ImageIcon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      ) : (
        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      )}
      <span className="min-w-0 flex-1 truncate">{file.name}</span>
      <span className="shrink-0 text-xs text-muted-foreground">
        {file.size > MB ? `${(file.size / MB).toFixed(1)} MB` : `${Math.max(1, Math.round(file.size / 1024))} KB`}
      </span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${file.name}`}
        className="rounded p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" aria-hidden />
      </button>
    </li>
  );
}

/** One line of the build log. The dot on the left is the state. */
function StepLine({ id, step, last }: { id: string; step: StepState; last: boolean }) {
  return (
    <li className="relative flex gap-3 pb-5 last:pb-0">
      {!last && <span className="absolute left-[11px] top-6 h-full w-px bg-border" aria-hidden />}
      <span
        className={cn(
          "relative z-10 mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 bg-background",
          step.state === "done" && "border-success text-success",
          step.state === "running" && "border-primary text-primary",
          step.state === "failed" && "border-destructive text-destructive",
          step.state === "waiting" && "border-border text-muted-foreground",
        )}
      >
        {step.state === "done" && <Check className="h-3.5 w-3.5" aria-hidden />}
        {step.state === "running" && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
        {step.state === "failed" && <AlertTriangle className="h-3.5 w-3.5" aria-hidden />}
      </span>
      <div className="min-w-0 flex-1">
        <p className={cn("text-sm font-bold", step.state === "waiting" && "text-muted-foreground")}>
          {STEP_LABEL[id] ?? id}
        </p>
        {step.detail && <p className="mt-0.5 text-xs text-muted-foreground">{step.detail}</p>}
        {step.items && (
          <ul className="mt-2 space-y-0.5">
            {step.items.map((item) => (
              <li key={item.name} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                {item.kind === "none" ? (
                  <X className="h-3 w-3 text-destructive" aria-hidden />
                ) : item.kind === "image" ? (
                  <ImageIcon className="h-3 w-3" aria-hidden />
                ) : (
                  <FileText className="h-3 w-3" aria-hidden />
                )}
                <span className="truncate font-mono">{item.name}</span>
                {item.why && <span className="truncate italic">— {item.why}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

export default function PatientNew() {
  const [files, setFiles] = useState<File[]>([]);
  const [steps, setSteps] = useState<Record<string, StepState>>(BLANK);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState<IngestDone | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const add = useCallback((list: FileList | null) => {
    if (!list) return;
    setFiles((have) => {
      const names = new Set(have.map((f) => f.name));
      return [...have, ...Array.from(list).filter((f) => !names.has(f.name))];
    });
  }, []);

  const run = useCallback(
    async (sample: boolean) => {
      setRunning(true);
      setError(null);
      setDone(null);
      setSteps(BLANK);
      try {
        for await (const event of ingest(sample ? [] : files, sample)) {
          apply(event);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        toast.error(message.slice(0, 160));
      } finally {
        setRunning(false);
      }

      function apply(event: IngestEvent) {
        if (event.kind === "step") {
          setSteps((have) => ({
            ...have,
            [event.step]: {
              state: event.state,
              // A running step carries what it is about to do; the done event replaces
              // it with what it did. Keeping the old one on `undefined` means a step
              // that reports nothing does not blank out the line above it.
              detail: event.detail ?? have[event.step]?.detail,
              items: event.items ?? have[event.step]?.items,
            },
          }));
          return;
        }
        if (event.kind === "failed") {
          setSteps((have) => ({ ...have, [event.step]: { state: "failed", detail: event.error } }));
          setError(event.error);
          return;
        }
        setDone(event);
        // The new patient has to appear in the clinic list behind this screen.
        queryClient.invalidateQueries({ queryKey: ["patients"] });
      }
    },
    [files],
  );

  const started = running || done !== null || error !== null;

  return (
    <main className="mx-auto w-full max-w-[920px] flex-1 px-5 py-8 lg:px-8">
      <h1 className="text-3xl font-black tracking-tight">Add a patient</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Give it their documents and it builds the record and the twin. Reports, notes, labs, genetics. PDFs and
        scans both.
      </p>

      <div className="mt-7 grid gap-7 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              add(e.dataTransfer.files);
            }}
            className={cn(
              "rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-colors",
              over ? "border-primary bg-primary-soft" : "border-border bg-muted/30",
            )}
          >
            <Upload className="mx-auto h-7 w-7 text-muted-foreground" aria-hidden />
            <p className="mt-3 text-sm font-bold">Drop the documents here</p>
            <p className="mt-1 text-xs text-muted-foreground">PDF, PNG, JPEG, text, VCF. Up to 12 MB each.</p>
            <Button variant="outline" className="mt-4" onClick={() => picker.current?.click()} disabled={running}>
              Choose files
            </Button>
            <input
              ref={picker}
              type="file"
              multiple
              className="sr-only"
              aria-label="Choose patient documents"
              onChange={(e) => {
                add(e.target.files);
                e.target.value = "";
              }}
            />
          </div>

          {files.length > 0 && (
            <ul className="mt-4 space-y-1.5">
              {files.map((file) => (
                <FileRow
                  key={file.name}
                  file={file}
                  onRemove={() => setFiles((have) => have.filter((f) => f.name !== file.name))}
                />
              ))}
            </ul>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <Button onClick={() => run(false)} disabled={running || files.length === 0}>
              {running ? <Loader2 className="animate-spin" aria-hidden /> : <ArrowRight aria-hidden />}
              Build the patient
            </Button>
            <Button variant="outline" onClick={() => run(true)} disabled={running}>
              <Sparkles aria-hidden />
              Use sample patient files
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            The sample is a synthetic ten document pack that ships with the app. Run <code>make sample</code> if it is
            not on disk yet.
          </p>
        </section>

        <aside className="rounded-2xl border border-border/70 bg-card p-5">
          <h2 className="text-sm font-black uppercase tracking-wide text-muted-foreground">Build log</h2>
          <ol className="mt-4">
            {STEP_IDS.map((id, i) => (
              <StepLine key={id} id={id} step={steps[id]} last={i === STEP_IDS.length - 1} />
            ))}
          </ol>

          {!started && (
            <p className="mt-2 text-xs text-muted-foreground">
              Each step says what it actually did, including anything it could not read.
            </p>
          )}

          {error && (
            <p role="alert" className="mt-3 rounded-lg bg-destructive-soft px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}

          {done && (
            <div className="mt-4 border-t pt-4">
              <p className="text-sm font-bold">{done.name}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {done.fields} fields read by {done.how === "model" ? "Claude" : "the built-in extractor"}.
              </p>

              {done.needs_review.length > 0 && (
                <div className="mt-3 rounded-lg border border-synthetic/40 bg-synthetic-soft px-3 py-2">
                  <p className="text-xs font-bold text-synthetic-foreground">
                    {done.needs_review.length} needs review
                  </p>
                  <p className="mt-0.5 text-[11px] text-synthetic-foreground/90">
                    {done.needs_review.join(", ")}. Below {Math.round(done.threshold * 100)}% confidence, so the twin
                    is not using {done.needs_review.length === 1 ? "it" : "them"}.
                  </p>
                </div>
              )}

              {done.conflicts.map((c) => (
                <div
                  key={c.fields.join("-")}
                  className="mt-2 rounded-lg border border-border bg-muted px-3 py-2 text-[11px] text-muted-foreground"
                >
                  {c.say}
                </div>
              ))}

              <Button className="mt-4 w-full" onClick={() => navigate(`/patients/${done.patient_id}`)}>
                Open the workspace
                <ArrowRight aria-hidden />
              </Button>
            </div>
          )}
        </aside>
      </div>

      <p className="mt-8 text-xs text-muted-foreground">
        Every patient here is synthetic. Not a real person, and not a medical device.
      </p>
    </main>
  );
}
