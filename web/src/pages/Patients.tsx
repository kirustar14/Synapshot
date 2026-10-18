// C1 Patients, the clinic worklist. Sorted by drift z descending so the patient whose
// measurements sit furthest from the forecast is always the first row.

import { ChevronRight, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useCreatePatient, usePatients } from "@/api/client";
import { Empty, ErrorState, FlagChip, Loading, fmtDate } from "@/components/common";
import { WorkspaceSkeleton } from "@/components/WorkspaceSkeleton";
import { DriftTrack, driftState } from "@/components/panels/DriftTrack";
import type { PatientRow } from "@/api/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

/** The add patient dialog. Creates a synthetic patient, then opens its model inputs screen. */
function AddPatient() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [age, setAge] = useState("28");
  const [sex, setSex] = useState<"F" | "M">("F");
  const create = useCreatePatient();
  const navigate = useNavigate();

  const ageNumber = Number(age);
  const valid = name.trim().length > 1 && Number.isFinite(ageNumber) && ageNumber > 0 && ageNumber < 120;

  const submit = () => {
    if (!valid) return;
    create.mutate(
      { name: name.trim(), age: Math.round(ageNumber), sex },
      {
        onSuccess: (patient) => {
          setOpen(false);
          setName("");
          toast.success(`${patient.name} created as a synthetic patient`);
          navigate(`/app/patients/${patient.id}/upload`);
        },
        onError: (err) => toast.error(err.message),
      },
    );
  };

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus aria-hidden /> Add patient
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a synthetic patient</DialogTitle>
            <DialogDescription>
              Every patient in this environment is synthetic. The new record starts with no model inputs, so the next
              screen is the upload step.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="add-name">Name</Label>
              <Input id="add-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="add-age">Age</Label>
              <Input id="add-age" inputMode="numeric" value={age} onChange={(e) => setAge(e.target.value)} className="w-24" />
            </div>
            <fieldset className="space-y-1.5">
              <legend className="text-sm font-medium">Sex</legend>
              <RadioGroup value={sex} onValueChange={(v) => setSex(v as "F" | "M")} className="flex gap-4">
                <span className="flex items-center gap-2">
                  <RadioGroupItem value="F" id="add-sex-f" />
                  <Label htmlFor="add-sex-f">Female</Label>
                </span>
                <span className="flex items-center gap-2">
                  <RadioGroupItem value="M" id="add-sex-m" />
                  <Label htmlFor="add-sex-m">Male</Label>
                </span>
              </RadioGroup>
            </fieldset>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={!valid || create.isPending}>
              {create.isPending ? "Creating" : "Create and add inputs"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

const needsLook = (p: PatientRow) => p.drift_z > 2 || p.flags.length > 0;

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

const NUMBER_WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"];

/** The page headline says who needs attention, in words, before any table. */
function headline(rows: PatientRow[]): { title: string; detail: string } {
  const flagged = rows.filter(needsLook);
  if (flagged.length === 0)
    return { title: "Everyone is on track", detail: "Every check-in this week landed where the twin expected it." };
  const n = flagged.length;
  const count = NUMBER_WORDS[n] ?? String(n);
  const title = `${count} patient${n === 1 ? " needs" : "s need"} a look`;
  const drifting = flagged.filter((p) => p.drift_z > 2).sort((a, b) => b.drift_z - a.drift_z);
  const first = drifting[0]?.name.split(" ")[0];
  const rest = n - (first ? 1 : 0);
  const restLine = rest > 0 ? `${(NUMBER_WORDS[rest] ?? String(rest)).toLowerCase()} more ${rest === 1 ? "has" : "have"} an open flag from the check-in` : "";
  const detail = first
    ? `${first}'s measurements have left the forecast band${restLine ? `, and ${restLine}` : ""}. Everyone else is tracking where the twin expected.`
    : `${restLine.charAt(0).toUpperCase()}${restLine.slice(1)}. Everyone else is tracking where the twin expected.`;
  return { title, detail };
}

function Status({ p }: { p: PatientRow }) {
  if (p.flags.length > 0)
    return (
      <span className="flex flex-wrap gap-1.5">
        {p.flags.map((f) => (
          <FlagChip key={f} flag={f} />
        ))}
      </span>
    );
  const { tone, word } = driftState(p.drift_z);
  return (
    <span className="flex items-center gap-2 text-sm font-bold text-foreground/80">
      <span className={cn("h-2 w-2 rounded-full", tone === "ok" ? "bg-success" : "bg-synthetic")} aria-hidden />
      {tone === "ok" ? "On track" : word}
    </span>
  );
}

/** "today", "yesterday", "3 days ago", then a date. */
function relDay(iso: string): string {
  const days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(iso).setHours(0, 0, 0, 0)) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return `on ${fmtDate(iso)}`;
}

const GRID = "grid grid-cols-[minmax(220px,1.3fr)_150px_minmax(240px,1.6fr)_150px_20px] items-center gap-4";

export default function Patients() {
  const { data, isLoading, error, refetch } = usePatients();
  const [alertsOnly, setAlertsOnly] = useState(false);

  const rows = useMemo(() => {
    const all = [...(data ?? [])].sort((a, b) => Number(needsLook(b)) - Number(needsLook(a)) || b.drift_z - a.drift_z);
    return alertsOnly ? all.filter(needsLook) : all;
  }, [data, alertsOnly]);

  const today = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  const { title, detail } = headline(data ?? []);

  return (
    <>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-6">
        <div className="min-w-0 max-w-2xl">
          <p className="text-sm font-bold text-muted-foreground">{today}</p>
          <h1 className="mt-2 text-[34px] font-extrabold leading-10">{data ? title : "Patients"}</h1>
          {data && <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">{detail}</p>}
        </div>
        <div className="flex items-center gap-3">
          <label
            htmlFor="alerts-only"
            className="flex h-11 cursor-pointer items-center gap-3 rounded-full bg-card px-4 text-sm font-bold shadow-soft"
          >
            <Switch id="alerts-only" checked={alertsOnly} onCheckedChange={setAlertsOnly} />
            Needs a look only
          </label>
          <AddPatient />
        </div>
      </div>

      {isLoading && <WorkspaceSkeleton />}
      {error && <ErrorState error={error} onRetry={() => refetch()} />}

      {data && (
        <>
          {data.length === 0 && <Empty>No patients yet. Add one to get started.</Empty>}
          {data.length > 0 && rows.length === 0 && <Empty>Nobody needs a look right now.</Empty>}

          {rows.length > 0 && (
            <section className="panel overflow-x-auto p-2" aria-label="Patients">
              <div className={cn(GRID, "h-11 min-w-[860px] px-5 text-[13px] font-bold text-muted-foreground")}>
                <span>Patient</span>
                <span>Progress</span>
                <span>This week against the forecast</span>
                <span>Status</span>
                <span />
              </div>
              <ul className="min-w-[860px] space-y-1">
                {rows.map((p) => {
                  const alert = p.drift_z > 2;
                  return (
                    <li key={p.id}>
                      <Link
                        to={`/app/patients/${p.id}`}
                        className={cn(
                          GRID,
                          "group min-h-[76px] rounded-[18px] px-5 py-3 transition-colors focus-visible:outline-2 focus-visible:outline-ring",
                          alert ? "bg-destructive-soft/70 hover:bg-destructive-soft" : "hover:bg-muted/70",
                        )}
                      >
                        <span className="flex min-w-0 items-center gap-3.5">
                          <span
                            className={cn(
                              "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-extrabold text-foreground/75",
                              alert ? "bg-card" : "bg-muted",
                            )}
                            aria-hidden
                          >
                            {initials(p.name)}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-base font-extrabold">{p.name}</span>
                            <span className="block text-[13px] font-semibold text-muted-foreground">
                              {p.last_call ? `Checked in ${relDay(p.last_call)}` : "No check-in yet"}
                            </span>
                          </span>
                        </span>
                        <span className="space-y-1.5">
                          <span className="block text-sm font-bold">Week {p.week} of 12</span>
                          <span className="block h-1.5 w-28 overflow-hidden rounded-full bg-muted" aria-hidden>
                            <span
                              className="block h-full rounded-full bg-primary"
                              style={{ width: `${Math.max(4, (p.week / 12) * 100)}%` }}
                            />
                          </span>
                        </span>
                        <DriftTrack z={p.drift_z} />
                        <Status p={p} />
                        <ChevronRight
                          className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                          aria-hidden
                        />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 px-7 text-[13px] font-semibold text-muted-foreground">
            <span className="flex items-center gap-2">
              <span className="h-2.5 w-7 rounded-full bg-primary-soft" aria-hidden /> Where the twin expected this week
            </span>
            <span className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-primary" aria-hidden /> What the check-in measured
            </span>
            {data.every((p) => p.synthetic) && <span>Every patient here is synthetic.</span>}
          </div>
        </>
      )}
    </>
  );
}
