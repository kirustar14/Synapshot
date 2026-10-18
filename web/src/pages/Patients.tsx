// C1 Patients, the clinic worklist. Sorted by drift z descending so the patient whose
// measurements sit furthest from the forecast is always the first row.

import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useCreatePatient, usePatients } from "@/api/client";
import {
  Empty,
  ErrorState,
  FlagChip,
  Loading,
  PageHeader,
  Panel,
  SyntheticBadge,
  fmtDate,
} from "@/components/common";
import { DriftBar } from "@/components/panels/DriftBar";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

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
          navigate(`/patients/${patient.id}/upload`);
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

export default function Patients() {
  const { data, isLoading, error, refetch } = usePatients();
  const [alertsOnly, setAlertsOnly] = useState(false);

  const rows = useMemo(() => {
    const all = [...(data ?? [])].sort((a, b) => b.drift_z - a.drift_z);
    return alertsOnly ? all.filter((p) => p.flags.length > 0) : all;
  }, [data, alertsOnly]);

  return (
    <>
      <PageHeader
        title="Patient workspace"
        subtitle="Everyone on weekly video check-ins, sorted by how far this week's measurements sit from the forecast."
        actions={
          <>
            <SyntheticBadge label="Synthetic cohort" className="self-center" />
            <AddPatient />
          </>
        }
      />

      {isLoading && <Loading label="Loading patients" />}
      {error && <ErrorState error={error} onRetry={() => refetch()} />}

      {data && (
        <>
          <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">
              {data.length} patients loaded from the data layer, {data.filter((p) => p.flags.length > 0).length} with an
              open flag.
            </p>
            <span className="flex items-center gap-2">
              <Switch id="alerts-only" checked={alertsOnly} onCheckedChange={setAlertsOnly} />
              <Label htmlFor="alerts-only" className="text-sm">
                Alerts only
              </Label>
            </span>
          </div>

          {data.length === 0 && <Empty>No patients yet. Add one to get started.</Empty>}
          {data.length > 0 && rows.length === 0 && <Empty>No patient has an open flag right now.</Empty>}

          {rows.length > 0 && (
            <Panel className="p-0 sm:p-2">
              <Table className="patient-table">
                <TableHeader>
                  <TableRow>
                    <TableHead>Patient</TableHead>
                    <TableHead>Week</TableHead>
                    <TableHead>Drift z, highest first</TableHead>
                    <TableHead>Last call</TableHead>
                    <TableHead>Flags</TableHead>
                    <TableHead>Data</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>
                        <Link to={`/patients/${p.id}`} className="font-bold hover:underline">
                          {p.name}
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{p.week} of 12</TableCell>
                      <TableCell>
                        <DriftBar z={p.drift_z} />
                      </TableCell>
                      <TableCell className="text-muted-foreground">{fmtDate(p.last_call)}</TableCell>
                      <TableCell>
                        {p.flags.length === 0 ? (
                          <span className="text-xs text-muted-foreground">none</span>
                        ) : (
                          <span className="flex flex-wrap gap-1.5">
                            {p.flags.map((f) => (
                              <FlagChip key={f} flag={f} />
                            ))}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>{p.synthetic && <SyntheticBadge />}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Panel>
          )}
        </>
      )}
    </>
  );
}
