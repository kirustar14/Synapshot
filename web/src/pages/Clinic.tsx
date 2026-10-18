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
    <main className="mx-auto w-full max-w-[1100px] flex-1 px-5 py-16 lg:px-8">
      {/* Mono eyebrow, serif headline with one italic word, one line of grey subcopy.
          The same shape the reference uses on every screen. */}
      <header className="mb-10 text-center">
        <p className="eyebrow text-muted-foreground">Clinic</p>
        <h1 className="display mt-3 text-5xl sm:text-6xl">
          Everyone you are <span className="display-em">following</span>
        </h1>
        <p className="mt-4 text-sm text-foreground/70">
          {data ? `${data.length} patients, ${flagged} with an open flag.` : "Loading the list."}
        </p>

        <div className="mt-7 flex flex-wrap items-center justify-center gap-2">
          <div className="relative min-w-0">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name"
              aria-label="Search patients by name"
              className="w-full rounded-full border-foreground/15 bg-muted/50 pl-9 sm:w-64"
            />
          </div>
          <Button asChild>
            <Link to="/patients/new">
              <Plus aria-hidden /> Add patient
            </Link>
          </Button>
        </div>
      </header>

      {isLoading && <Loading label="Loading patients" />}
      {error && <ErrorState error={error} onRetry={() => refetch()} />}

      {data && data.length === 0 && <Empty>No patients yet. Add one to get started.</Empty>}
      {data && data.length > 0 && rows.length === 0 && <Empty>Nobody matches {`"${query}"`}.</Empty>}

      {rows.length > 0 && (
        // Flat rows, not a table in a box. Mono column heads, mono numbers, and the
        // first row, which is the highest drift, carries the one hard offset card on
        // this screen so the eye lands on it.
        <ul className="mx-auto max-w-[940px] space-y-3">
          <li className="grid grid-cols-[1fr_auto] gap-4 px-5 pb-1 sm:grid-cols-[minmax(0,1.6fr)_4.5rem_13rem_7.5rem_minmax(0,0.9fr)]">
            <span className="eyebrow text-muted-foreground">Patient</span>
            <span className="eyebrow hidden text-muted-foreground sm:block">Week</span>
            <span className="eyebrow hidden text-muted-foreground sm:block">Drift z</span>
            <span className="eyebrow hidden text-muted-foreground sm:block">Last check-in</span>
            <span className="eyebrow text-right text-muted-foreground sm:text-left">Flags</span>
          </li>

          {rows.map((p, i) => (
            <li key={p.id} className={i === 0 ? "featured" : "flat-card"}>
              <Link
                to={`/patients/${p.id}`}
                className="grid grid-cols-[1fr_auto] items-center gap-4 px-5 py-4 sm:grid-cols-[minmax(0,1.6fr)_4.5rem_13rem_7.5rem_minmax(0,0.9fr)]"
              >
                <span className="min-w-0">
                  <span className="block truncate text-lg font-medium">{p.name}</span>
                  <span className="eyebrow text-muted-foreground sm:hidden">
                    Week {p.week} of 12
                  </span>
                </span>
                <span className="hidden font-mono text-xs text-muted-foreground sm:block">
                  {p.week} / 12
                </span>
                <span className="hidden sm:block">
                  <DriftBar z={p.drift_z} />
                </span>
                <span className="hidden font-mono text-xs text-muted-foreground sm:block">
                  {fmtDate(p.last_call)}
                </span>
                <span className="flex flex-wrap justify-end gap-1.5 sm:justify-start">
                  {p.flags.length === 0 ? (
                    <span className="eyebrow text-muted-foreground">None</span>
                  ) : (
                    p.flags.map((f) => <FlagChip key={f} flag={f} />)
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

    </main>
  );
}
