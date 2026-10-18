// The clinic. One table of everybody, a search box, and the button that adds a patient.
//
// This used to be three screens: a worklist, an Alerts page and a Cohort insights page.
// The flags are in the table now and the cohort numbers are in the workspace, where they
// are next to the patient they are about.

import { Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { usePatients } from "@/api/client";
import {
  Empty,
  ErrorState,
  FlagChip,
  Loading,
  fmtDate,
} from "@/components/common";
import { DriftBar } from "@/components/panels/DriftBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default function Clinic() {
  const { data, isLoading, error, refetch } = usePatients();
  const [query, setQuery] = useState("");

  const rows = useMemo(() => {
    // Highest drift first, so the patient whose week came back furthest from what the
    // twin expected is the first row without anybody having to sort.
    const all = [...(data ?? [])].sort((a, b) => b.drift_z - a.drift_z);
    const q = query.trim().toLowerCase();
    return q ? all.filter((p) => p.name.toLowerCase().includes(q)) : all;
  }, [data, query]);

  const flagged = (data ?? []).filter((p) => p.flags.length > 0).length;

  return (
    <main className="mx-auto w-full max-w-[1200px] flex-1 px-5 py-8 lg:px-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black tracking-tight">Clinic</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {data ? `${data.length} patients, ${flagged} with an open flag.` : "Loading the list."}
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <div className="relative min-w-0 flex-1 sm:flex-none">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name"
              aria-label="Search patients by name"
              className="w-full pl-8 sm:w-56"
            />
          </div>
          <Button asChild>
            <Link to="/patients/new">
              <Plus aria-hidden /> Add patient
            </Link>
          </Button>
        </div>
      </div>

      {isLoading && <Loading label="Loading patients" />}
      {error && <ErrorState error={error} onRetry={() => refetch()} />}

      {data && data.length === 0 && <Empty>No patients yet. Add one to get started.</Empty>}
      {data && data.length > 0 && rows.length === 0 && <Empty>Nobody matches {`"${query}"`}.</Empty>}

      {rows.length > 0 && (
        // The table scrolls inside the panel rather than taking the page sideways with
        // it. A page that scrolls horizontally on a phone is a layout bug; a table that
        // does is a table.
        <div className="panel overflow-x-auto p-0 sm:p-2">
          <Table className="patient-table">
            <TableHeader>
              <TableRow>
                <TableHead>Patient</TableHead>
                <TableHead>Week</TableHead>
                <TableHead>Drift z, highest first</TableHead>
                <TableHead className="hidden md:table-cell">Last check-in</TableHead>
                <TableHead>Flags</TableHead>
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
                  <TableCell className="hidden text-muted-foreground md:table-cell">
                    {fmtDate(p.last_call)}
                  </TableCell>
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
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </main>
  );
}
