// D1 Demo console. Drives the synthetic cohort on stage. Every action mutates the data layer,
// so the other screens react. Reached by visiting the URL once, which unlocks it in the sidebar.

import {
  CalendarPlus,
  Link2,
  PhoneOutgoing,
  Play,
  RefreshCw,
  RotateCcw,
  Send,
  TrendingUp,
  UserPlus,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import QRCode from "qrcode";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
  API,
  api,
  useAdvanceWeek,
  useAlerts,
  useCreateCall,
  useDemoReset,
  useInjectDrift,
  useMessages,
  usePatients,
  useRegenerateVoice,
  useTriggerCall,
  useVoices,
} from "@/api/client";
import type { Message, VoiceLine } from "@/api/types";
import { useRig } from "@/api/ws";
import { Empty, ErrorState, Loading, PageHeader, Panel, SyntheticBadge, fmtTime } from "@/components/common";
import { DriftBar } from "@/components/panels/DriftBar";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { useApp } from "@/store/app";

const CHANNEL: Record<Message["channel"], string> = {
  imessage: "iMessage",
  sms: "SMS",
  mock: "Mock, nothing left the machine",
};

const NEW_NAMES = ["Rowan Vale", "Imani Castellanos", "Nils Eriksson", "Saoirse Hale", "Theo Abara"];

/** Full width wait animation, isolated so the 30 fps rig stream only re-renders this card. */
function WaitForPatient({ onInCall }: { onInCall: () => void }) {
  const rig = useRig();

  useEffect(() => {
    if (rig.status === "In call") onInCall();
  }, [rig.status, onInCall]);

  return (
    <div className="relative overflow-hidden rounded-xl border border-synthetic/40 bg-synthetic-soft px-6 py-8 text-center">
      <span className="pointer-events-none absolute left-1/2 top-1/2 h-24 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full bg-synthetic/30 ring-wave" aria-hidden />
      <p className="relative text-xl font-extrabold text-synthetic-foreground" role="status">
        Waiting for the patient to open the link
      </p>
      <p className="relative mt-2 text-xs text-synthetic-foreground">
        Stream says {rig.status === "Ringing" ? "waiting" : rig.status.toLowerCase()}. The live call console follows the
        same stream.
      </p>
      <Button asChild variant="outline" size="sm" className="relative mt-4">
        <Link to="/rig">Open the live call console</Link>
      </Button>
    </div>
  );
}

/** The voice line inventory, with a play button that falls back to browser speech. */
function Voices() {
  const { data, isLoading, error, refetch } = useVoices();
  const regenerate = useRegenerateVoice();

  const play = (line: VoiceLine, base: string) => {
    if (line.exists) {
      const audio = new Audio(`${API}${base}${line.file}`);
      audio.play().catch(() => toast.error(`Could not play ${line.file}`));
      return;
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(line.text));
      toast.info("No mp3 on disk, played through the browser voice instead");
      return;
    }
    toast.error("No mp3 on disk and this browser has no speech fallback");
  };

  if (isLoading) return <Loading label="Loading voice lines" />;
  if (error || !data || data.lines.length === 0) {
    return (
      <Empty>
        No voice lines are registered. Run <code className="mx-1 font-mono">make voices</code> to generate them, then
        re-open this panel.
      </Empty>
    );
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
        <span
          className={cn(
            "rounded-full border px-2 py-0.5 font-medium",
            data.live
              ? "border-success/30 bg-success-soft text-success"
              : "border-synthetic/40 bg-synthetic-soft text-synthetic-foreground",
          )}
        >
          {data.live ? "Real ElevenLabs audio" : "Browser speech fallback"}
        </span>
        <span className="text-muted-foreground">model {data.model}</span>
        <span className="text-muted-foreground">
          {data.lines.filter((l) => l.exists).length} of {data.lines.length} mp3 files on disk
        </span>
        <Button size="sm" variant="ghost" onClick={() => refetch()}>
          <RefreshCw aria-hidden /> Refresh
        </Button>
      </div>
      <ul className="divide-y">
        {data.lines.map((l) => (
          <li key={l.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
            <Button size="sm" variant="outline" onClick={() => play(l, data.base)} aria-label={`Play ${l.id}`}>
              <Play aria-hidden /> Play
            </Button>
            <span className="w-32 font-mono text-xs font-bold">{l.id}</span>
            <span
              className={cn(
                "rounded-full border px-2 py-0.5 text-[11px] font-medium",
                l.exists
                  ? "border-success/30 bg-success-soft text-success"
                  : "border-border bg-muted text-muted-foreground",
              )}
            >
              {l.exists ? "mp3 on disk" : "no mp3"}
            </span>
            <span className="font-mono text-[11px] text-muted-foreground">{l.hash}</span>
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{l.text}</span>
            <Button
              size="sm"
              variant="ghost"
              disabled={regenerate.isPending}
              onClick={() =>
                regenerate.mutate(l.id, {
                  onSuccess: () => toast.success(`${l.id} regenerated`),
                  onError: (err) => toast.error(err.message),
                })
              }
            >
              <RotateCcw aria-hidden /> Regenerate
            </Button>
          </li>
        ))}
      </ul>
    </>
  );
}

export default function Demo() {
  const queries = useQueryClient();
  const { data: patients, isLoading, error, refetch } = usePatients();
  const { data: alerts } = useAlerts();
  const selected = useApp((s) => s.selectedPatient);
  const setSelected = useApp((s) => s.setSelectedPatient);
  const driftSize = useApp((s) => s.demo.driftSize);
  const setDemo = useApp((s) => s.setDemo);

  const advance = useAdvanceWeek();
  const inject = useInjectDrift();
  const trigger = useTriggerCall();
  const reset = useDemoReset();
  const createCall = useCreateCall();

  const [waiting, setWaiting] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const patientId = selected ?? patients?.[0]?.id ?? "";
  const row = patients?.find((p) => p.id === patientId);
  const { data: messages } = useMessages(patientId);
  const lastOut = useMemo(() => [...(messages ?? [])].reverse().find((m) => m.dir === "out"), [messages]);
  const lastAlert = useMemo(
    () => (alerts ?? []).filter((a) => a.patient_id === patientId)[0] ?? null,
    [alerts, patientId],
  );

  useEffect(() => {
    if (!link) {
      setQr(null);
      return;
    }
    let live = true;
    // Canvas first. Where canvas is unavailable the SVG string becomes the data URL instead.
    QRCode.toDataURL(link, { width: 220, margin: 1 })
      .catch(async () => {
        const svg = await QRCode.toString(link, { type: "svg", margin: 1 });
        return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
      })
      .then((url) => {
        if (live) setQr(url);
      })
      .catch(() => setQr(null));
    return () => {
      live = false;
    };
  }, [link]);

  const makeLink = useCallback(
    (send: boolean) => {
      if (!patientId) return;
      createCall.mutate(
        { patientId, send },
        {
          onSuccess: (start) => {
            setLink(start.url);
            toast.success(send ? "Link created and sent to the patient" : "Link created, not sent");
          },
          onError: (err) => toast.error(err.message),
        },
      );
    },
    [createCall, patientId],
  );

  const advanceWeek = useCallback(() => {
    if (!patientId) return;
    advance.mutate(patientId, {
      onSuccess: () => {
        setDemo({ lastAction: "Advanced one week" });
        toast.success("Week advanced, a new check-in landed");
      },
      onError: (err) => toast.error(err.message),
    });
  }, [advance, patientId, setDemo]);

  const injectDrift = useCallback(() => {
    if (!patientId) return;
    inject.mutate(
      { patientId, size: driftSize },
      {
        onSuccess: () => {
          setDemo({ lastAction: `Injected drift of ${driftSize.toFixed(1)}` });
          toast.success("Drift injected, watch the patient list reorder");
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }, [inject, patientId, driftSize, setDemo]);

  const triggerCall = useCallback(() => {
    if (!patientId) return;
    trigger.mutate(patientId, {
      onSuccess: () => {
        setWaiting(true);
        setDemo({ lastAction: "Triggered a call", ringing: true });
      },
      onError: (err) => toast.error(err.message),
    });
  }, [trigger, patientId, setDemo]);

  const resetCohort = useCallback(() => {
    reset.mutate(undefined, {
      onSuccess: () => {
        setWaiting(false);
        setLink(null);
        setDemo({ lastAction: "Reset the cohort", ringing: false });
        toast.success("Cohort reset to its seeded state");
      },
      onError: (err) => toast.error(err.message),
    });
  }, [reset, setDemo]);

  /** Creates a synthetic patient, fills every input, and builds the twin in one go. */
  const loadSynthetic = useCallback(async () => {
    setLoading(true);
    try {
      const name = NEW_NAMES[(patients?.length ?? 0) % NEW_NAMES.length];
      const created = await api.createPatient({ name, age: 29, sex: "F" });
      await api.uploadSynthetic(created.id);
      await api.buildTwin(created.id);
      setSelected(created.id);
      setDemo({ lastAction: `Loaded ${name}` });
      await queries.invalidateQueries();
      toast.success(`${name} loaded with synthetic inputs and a built twin`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not load a synthetic patient");
    } finally {
      setLoading(false);
    }
  }, [patients, queries, setDemo, setSelected]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName ?? "";
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable) return;
      const actions: Record<string, () => void> = {
        w: advanceWeek,
        d: injectDrift,
        c: triggerCall,
        r: resetCohort,
        l: () => void loadSynthetic(),
        k: () => makeLink(false),
        t: () => makeLink(true),
      };
      const run = actions[e.key.toLowerCase()];
      if (!run) return;
      e.preventDefault();
      run();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [advanceWeek, injectDrift, triggerCall, resetCohort, loadSynthetic, makeLink]);

  const keys: { key: string; label: string }[] = [
    { key: "W", label: "Advance week" },
    { key: "D", label: "Inject drift" },
    { key: "C", label: "Trigger call" },
    { key: "R", label: "Reset cohort" },
    { key: "L", label: "Load synthetic patient" },
    { key: "K", label: "Create call link" },
    { key: "T", label: "Send text" },
  ];

  return (
    <>
      <PageHeader
        title="Demo console"
        subtitle="Drives the synthetic cohort on stage. Every action here mutates the data layer, so the other screens react."
        actions={<SyntheticBadge label="Synthetic only" className="self-center" />}
      />

      {isLoading && <Loading label="Loading the cohort" />}
      {error && <ErrorState error={error} onRetry={() => refetch()} />}

      <div className="space-y-5">
        {waiting && <WaitForPatient onInCall={() => setWaiting(false)} />}

        <Panel title="Patient" subtitle="Every button below acts on this patient.">
          <div className="flex flex-wrap items-end gap-6">
            <div className="space-y-1.5">
              <Label htmlFor="demo-patient">Patient</Label>
              <Select value={patientId} onValueChange={setSelected}>
                <SelectTrigger id="demo-patient" className="w-64">
                  <SelectValue placeholder="Pick a patient" />
                </SelectTrigger>
                <SelectContent>
                  {(patients ?? []).map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}, week {p.week}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <dl className="flex flex-wrap gap-6 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Week</dt>
                <dd className="text-2xl font-extrabold">{row ? `${row.week} of 12` : "none"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Drift z</dt>
                <dd className="mt-2">{row ? <DriftBar z={row.drift_z} /> : "none"}</dd>
              </div>
              <div className="max-w-xs">
                <dt className="text-xs text-muted-foreground">Last alert</dt>
                <dd className="text-sm font-bold">
                  {lastAlert ? `${lastAlert.type.replace("_", " ")}, ${fmtTime(lastAlert.time)}` : "none"}
                </dd>
              </div>
            </dl>
            {row && (
              <Button asChild variant="outline">
                <Link to={`/patients/${row.id}`}>Open the record</Link>
              </Button>
            )}
          </div>
        </Panel>

        <Panel title="Actions" subtitle="Each one has a keyboard shortcut, listed at the bottom of this screen.">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <Button size="lg" className="h-16 justify-start text-base" onClick={advanceWeek} disabled={advance.isPending || !patientId}>
              <CalendarPlus aria-hidden /> Advance week <kbd className="ml-auto font-mono text-xs">W</kbd>
            </Button>
            <Button size="lg" className="h-16 justify-start text-base" onClick={injectDrift} disabled={inject.isPending || !patientId}>
              <TrendingUp aria-hidden /> Inject drift <kbd className="ml-auto font-mono text-xs">D</kbd>
            </Button>
            <Button size="lg" className="h-16 justify-start text-base" onClick={triggerCall} disabled={trigger.isPending || !patientId}>
              <PhoneOutgoing aria-hidden /> Trigger call <kbd className="ml-auto font-mono text-xs">C</kbd>
            </Button>
            <Button size="lg" variant="outline" className="h-16 justify-start text-base" onClick={resetCohort} disabled={reset.isPending}>
              <RefreshCw aria-hidden /> Reset cohort <kbd className="ml-auto font-mono text-xs">R</kbd>
            </Button>
            <Button size="lg" variant="outline" className="h-16 justify-start text-base" onClick={() => void loadSynthetic()} disabled={loading}>
              <UserPlus aria-hidden /> {loading ? "Loading" : "Load synthetic patient"}{" "}
              <kbd className="ml-auto font-mono text-xs">L</kbd>
            </Button>
            <div className="rounded-xl border p-4">
              <Label htmlFor="drift-size">Drift size, {driftSize.toFixed(1)} z</Label>
              <Slider
                id="drift-size"
                className="mt-3"
                value={[driftSize]}
                min={0.5}
                max={4}
                step={0.1}
                onValueChange={([v]) => setDemo({ driftSize: v })}
                aria-label="Drift size in z units"
              />
              <p className="mt-2 text-[11px] text-muted-foreground">Above 2 crosses the alert threshold.</p>
            </div>
          </div>
        </Panel>

        <Panel
          title="Call link"
          subtitle="The link the patient opens on a phone. Scan the code off the screen, or send it as a text."
        >
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => makeLink(false)} disabled={createCall.isPending || !patientId}>
              <Link2 aria-hidden /> Create call link <kbd className="ml-1 font-mono text-xs">K</kbd>
            </Button>
            <Button variant="outline" onClick={() => makeLink(true)} disabled={createCall.isPending || !patientId}>
              <Send aria-hidden /> Send text <kbd className="ml-1 font-mono text-xs">T</kbd>
            </Button>
          </div>

          {!link && <p className="mt-4 text-sm text-muted-foreground">No link yet. Create one and a QR code appears here.</p>}

          {link && (
            <div className="mt-4 grid gap-5 sm:grid-cols-[auto_1fr]">
              <div>
                {qr ? (
                  <img src={qr} alt={`QR code for the call link ${link}`} className="rounded-xl border bg-white p-2" width={220} height={220} />
                ) : (
                  <div className="flex h-[220px] w-[220px] items-center justify-center rounded-xl border border-dashed text-xs text-muted-foreground">
                    Drawing the code
                  </div>
                )}
              </div>
              <div className="min-w-0 space-y-3">
                <div>
                  <p className="text-xs text-muted-foreground">Link</p>
                  <p className="break-all font-mono text-sm">{link}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => void navigator.clipboard?.writeText(link)}>
                    Copy link
                  </Button>
                  <Button size="sm" variant="outline" asChild>
                    <a href={link} target="_blank" rel="noreferrer">
                      Open in a new tab
                    </a>
                  </Button>
                  {row && (
                    <Button size="sm" variant="outline" asChild>
                      <Link to={`/phone/${row.id}`}>Open the phone mock</Link>
                    </Button>
                  )}
                </div>
                <div className="rounded-xl border bg-muted/50 p-3">
                  <p className="text-xs font-bold">Delivery</p>
                  {lastOut ? (
                    <>
                      <p className="mt-1 text-sm">
                        Last outbound message went over <span className="font-bold">{CHANNEL[lastOut.channel]}</span> at{" "}
                        {fmtTime(lastOut.time)}.
                      </p>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        This is read from the channel the message row recorded, so an SMS is never labelled as iMessage.
                      </p>
                    </>
                  ) : (
                    <p className="mt-1 text-sm text-muted-foreground">Nothing has been sent to this patient yet.</p>
                  )}
                </div>
              </div>
            </div>
          )}
        </Panel>

        <Panel
          title="Voices"
          subtitle="Every script line, its hash, and whether the mp3 exists. Regenerate one line without touching the rest."
        >
          <Voices />
        </Panel>

        <Panel title="Keyboard shortcuts" subtitle="They work anywhere on this screen except inside a text field.">
          <ul className="flex flex-wrap gap-3 text-sm">
            {keys.map((k) => (
              <li key={k.key} className="flex items-center gap-2 rounded-full border px-3 py-1.5">
                <kbd className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs font-bold">{k.key}</kbd>
                {k.label}
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </>
  );
}
