// One function per contract route, then a TanStack Query hook for each. Same origin by
// default: VITE_API_URL is empty in production because the backend serves dist at / and the
// API at /api. If the boot health probe fails and no explicit API URL was given, every call
// routes to the seeded mock layer instead and the shell shows a "Mock data" badge.

import { useMutation, useQuery, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { mock } from "@/mock/db";
import type {
  Alert,
  Attribution,
  AgentPipeline,
  CallScript,
  CallStart,
  CallStatus,
  Checkin,
  Cohort,
  Forecast,
  FrameRec,
  InputFile,
  Intervention,
  Loadings,
  Mesh,
  Message,
  Patient,
  PatientRow,
  Receptors,
  RedflagResult,
  Scenario,
  ScenarioResult,
  Shape,
  StimEvent,
  SymptomResult,
  Twin,
  VoiceLine,
  Voices,
} from "./types";

export const API: string = (import.meta.env.VITE_API_URL as string | undefined) ?? "";

/** Shapes the contract describes inline in its route list rather than as named interfaces. */
export interface Health {
  ok: boolean;
  mode: "mock" | "live";
}
export interface TwinInputs {
  inputs: InputFile[];
  fc_fit: number | null;
  low_fidelity: boolean;
}
/** What a flag fired on, with its threshold and where this patient sits against it. */
export interface AlertRule {
  ok: boolean;
  id: string;
  type: Alert["type"];
  trigger: string;
  time: string;
  rule: string;
  detail: string;
  threshold: number;
  state: { drift_z?: number; coverage?: number; week?: number };
}

export interface ConsentChoices {
  calls: boolean;
  ai: boolean;
  recording: boolean;
  genetic: boolean;
}
let useMock = false;
let backendMode: Health["mode"] = "live";
let probe: Promise<void> | null = null;

/** True once the boot probe failed and the app switched to the local mock layer. */
export const isMock = () => useMock;

/** The mode the live backend reported, which is its own idea of mock or live data. */
export const liveMode = () => backendMode;

/**
 * Boot probe. An explicit VITE_API_URL means trust the backend and surface its errors. An empty
 * one means same origin, where a failed health call means no backend is running.
 */
export function ready(): Promise<void> {
  if (!probe) {
    probe = (async () => {
      if (typeof window === "undefined") {
        useMock = !API;
        return;
      }
      try {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 2500);
        const res = await fetch(`${API}/api/health`, { signal: ctl.signal });
        clearTimeout(timer);
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as Health;
        backendMode = body.mode;
        useMock = !body.ok && !API;
      } catch {
        useMock = !API;
      }
    })();
  }
  return probe;
}

const pause = (ms = 110) => new Promise((r) => setTimeout(r, ms));

interface CallInit {
  method?: string;
  body?: unknown;
  form?: FormData;
}

/** Runs a route against the backend, or against its mock fallback when mock mode is on. */
async function call<T>(path: string, init: CallInit | undefined, fallback: () => T): Promise<T> {
  await ready();
  if (useMock) {
    await pause();
    return fallback();
  }
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;
  if (init?.form) {
    body = init.form;
  } else if (init?.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(init.body);
  }
  const res = await fetch(`${API}/api${path}`, { method: init?.method ?? (body ? "POST" : "GET"), headers, body });
  if (!res.ok) throw new Error(`${res.status} ${await res.text().catch(() => res.statusText)}`);
  const type = res.headers.get("content-type") ?? "";
  if (!type.includes("json")) return { ok: true } as unknown as T;
  return (await res.json()) as T;
}

/* ---------------------------------------------------------------- routes */

export const api = {
  health: async (): Promise<Health> => {
    await ready();
    return useMock ? mock.health() : { ok: true, mode: backendMode };
  },

  patients: () => call<PatientRow[]>("/patients", undefined, mock.patients),
  createPatient: (b: { name: string; age: number; sex: "F" | "M" }) =>
    call<Patient>("/patients", { body: { ...b, synthetic: true } }, () => mock.createPatient(b)),
  patient: (id: string) => call<Patient>(`/patients/${id}`, undefined, () => mock.patient(id)),

  forecast: (id: string) => call<Forecast>(`/patients/${id}/forecast`, undefined, () => mock.forecast(id)),
  twin: (id: string) => call<Twin>(`/patients/${id}/twin`, undefined, () => mock.twin(id)),
  scenarios: (id: string, b: { a: Scenario; b: Scenario }) =>
    call<ScenarioResult>(`/patients/${id}/scenarios`, { body: b }, () => mock.scenarios(id, b)),
  counterfactual: (id: string, b: { k_mult: number; p_add: number }) =>
    call<Forecast>(`/patients/${id}/counterfactual`, { body: b }, () => mock.counterfactual(id, b)),
  attribution: (id: string) => call<Attribution[]>(`/patients/${id}/attribution`, undefined, () => mock.attribution(id)),

  checkins: (id: string) => call<Checkin[]>(`/patients/${id}/checkins`, undefined, () => mock.checkins(id)),
  checkin: (cid: string) => call<Checkin>(`/checkins/${cid}`, undefined, () => mock.checkin(cid)),
  rescore: (cid: string, task: string) => call(`/checkins/${cid}/rescore`, { body: { task } }, () => mock.rescore(cid, task)),
  unusable: (cid: string) => call(`/checkins/${cid}/unusable`, { method: "POST" }, () => mock.unusable(cid)),

  uploadFile: (id: string, kind: InputFile["kind"], file: File) => {
    const form = new FormData();
    form.append("kind", kind);
    form.append("file", file);
    return call<InputFile[]>(`/patients/${id}/uploads`, { form }, () => mock.upload(id, kind, file.name));
  },
  uploadSynthetic: (id: string) =>
    call<InputFile[]>(`/patients/${id}/uploads`, { body: { synthetic: true } }, () => mock.upload(id, null)),
  removeFile: (id: string, kind: InputFile["kind"]) =>
    call<InputFile[]>(`/patients/${id}/uploads`, { body: { kind, remove: true } }, () => mock.upload(id, kind, undefined, true)),
  uploadInjury: (id: string, injury: Partial<Patient["injury"]>) => {
    const form = new FormData();
    form.append("kind", "injury");
    form.append("file", new Blob([JSON.stringify(injury)], { type: "application/json" }), "injury_form.json");
    return call<InputFile[]>(`/patients/${id}/uploads`, { form }, () => {
      mock.setInjury(id, injury);
      return mock.upload(id, "injury", "injury_form.json");
    });
  },

  twinInputs: (id: string) => call<TwinInputs>(`/patients/${id}/twin-inputs`, undefined, () => mock.twinInputs(id)),
  buildTwin: (id: string) => call<Patient>(`/patients/${id}/build-twin`, { method: "POST" }, () => mock.buildTwin(id)),

  messages: (id: string) => call<Message[]>(`/patients/${id}/messages`, undefined, () => mock.messages(id)),
  note: (id: string, text: string) => call(`/patients/${id}/note`, { body: { text } }, () => mock.note(id, text)),

  alerts: (patientId?: string) =>
    call<Alert[]>(`/alerts${patientId ? `?patient_id=${patientId}` : ""}`, undefined, () => mock.alerts(patientId)),
  ackAlert: (aid: string) => call(`/alerts/${aid}/ack`, { method: "POST" }, () => mock.ack(aid)),
  explainAlert: (aid: string) =>
    call<AlertRule>(`/alerts/${aid}/explain`, undefined, () => mock.explainAlert(aid)),

  cohort: () => call<Cohort>("/cohort", undefined, mock.cohort),

  demoReset: () => call("/demo/reset", { method: "POST" }, mock.reset),
  advanceWeek: (patientId: string) => call("/demo/advance-week", { body: { patient_id: patientId } }, () => mock.advanceWeek(patientId)),
  injectDrift: (patientId: string, size: number) =>
    call("/demo/inject-drift", { body: { patient_id: patientId, size } }, () => mock.injectDrift(patientId, size)),
  triggerCall: (patientId: string) => call("/demo/trigger-call", { body: { patient_id: patientId } }, () => mock.triggerCall(patientId)),


  mesh: () => call<Mesh>("/mesh", undefined, mock.mesh),
  shape: (id: string) => call<Shape>(`/patients/${id}/shape`, undefined, () => mock.shape(id)),
  receptors: () => call<Receptors>("/receptors", undefined, mock.receptors),
  intervention: (id: string, b: { target: string; gain: number }) =>
    call<Intervention>(`/patients/${id}/intervention`, { body: b }, () => mock.intervention(id, b)),
  loadings: () => call<Loadings>("/loadings", undefined, mock.loadings),

  messageStatus: (mid: string) =>
    call<MessageStatus>(`/messages/${mid}/status`, undefined, () => mock.messageStatus(mid)),
  createCall: (patientId: string, send: boolean) =>
    call<CallStart>("/calls", { body: { patient_id: patientId, send } }, () => mock.createCall(patientId, send)),
  callScript: (token: string) => call<CallScript>(`/call/${token}/script`, undefined, mock.callScript),
  callConsent: (token: string, b: ConsentChoices) => call(`/call/${token}/consent`, { body: b }, () => mock.callConsent(token, b)),
  // Both of these are keyed objects, not arrays: the backend reads answers by red flag
  // key and scores by symptom name, so position would be the wrong thing to send.
  callRedflags: (token: string, answers: Record<string, boolean>) =>
    call<RedflagResult>(`/call/${token}/redflags`, { body: { answers } }, () => mock.callRedflags(token, answers)),
  callSymptoms: (token: string, scores: Record<string, number>, phase: "baseline" | "rerate") =>
    call<SymptomResult>(`/call/${token}/symptoms`, { body: { scores, phase } }, () => mock.callSymptoms(token, scores, phase)),
  callAnswer: (token: string, task: string, value: number | string[]) =>
    call(`/call/${token}/answer`, { body: { task, value } }, () => mock.callAnswer(token, task, value)),
  callLive: (token: string, ev: { t: number; gaze: { x: number; y: number }; target: { x: number; y: number }; quality: unknown; step: string; line?: unknown }) =>
    call(`/call/${token}/live`, { body: ev }, mock.callLive),
  callFrames: (token: string, task: string, meta: unknown, frames: FrameRec[], stim: StimEvent[]) =>
    call(`/call/${token}/frames`, { body: { task, meta, frames, stim } }, () => mock.callFrames(token, frames.length)),
  callAudio: (token: string, task: string, blob: Blob, name: string) => {
    const form = new FormData();
    form.append("file", blob, name);
    return call(`/call/${token}/audio/${task}`, { form }, mock.callAudio);
  },
  callFinish: (token: string, aborted: boolean) =>
    call<{ ok: boolean; call_id: string }>(`/call/${token}/finish`, { body: { aborted } }, () => mock.callFinish(token, aborted)),
  callStatus: (token: string) => call<CallStatus>(`/call/${token}/status`, undefined, () => mock.callStatus(token)),

  pipeline: (id: string) => call<AgentPipeline | null>(`/patients/${id}/pipeline`, undefined, () => null),
  startPipeline: (id: string) =>
    call<AgentPipeline>(`/patients/${id}/pipeline`, { method: "POST" }, () => ({
      id: "mock-pipeline",
      week: 0,
      status: "completed",
      level: "watch",
      reasons: ["The backend is not running, so this is a canned example."],
      escalated: false,
      stages: (["triage", "briefing", "outreach"] as const).map((role) => ({
        role,
        label: role[0].toUpperCase() + role.slice(1),
        status: "completed",
        mock: true,
        agent_id: null,
        creao_run_id: null,
        error: null,
      })),
      briefing: "Template briefing, no CREAO agent was called. The backend is not running.",
      follow_ups: [],
      patient_message: null,
      next_steps: [],
      created: "",
      updated: "",
    })),

  voices: () => call<Voices>("/voices", undefined, mock.voices),
  regenerateVoice: (stepId: string) =>
    call<VoiceLine>(`/voices/${stepId}/regenerate`, { method: "POST" }, () => mock.regenerateVoice(stepId)),

  provenance: (id: string) =>
    call<Provenance>(`/patients/${id}/provenance`, undefined, () => mock.provenance(id)),

  vessels: () => call<Vessels>("/vessels", undefined, mock.vessels),
  formulary: () => call<Formulary>("/formulary", undefined, mock.formulary),
  evidence: () => call<Evidence>("/evidence", undefined, mock.evidence),
  timeline: (id: string) =>
    call<Timeline>(`/patients/${id}/timeline`, undefined, () => mock.timeline(id)),
  percentile: (id: string) =>
    call<Percentile>(`/patients/${id}/percentile`, undefined, () => mock.percentile(id)),
  drugImpact: (id: string, drugs: { name: string }[], gain: number) =>
    call<DrugImpact>(`/patients/${id}/intervention`, { body: { drugs, gain } },
      () => mock.drugImpact(id, drugs, gain)),
};

/* ---------------------------------------------------------------- v2 shapes */

/** What really happened to one outbound message. */
export interface MessageStatus {
  ok: boolean;
  id: string;
  channel: string;
  /** sent, delivered, failed or mock. Only the provider can produce delivered. */
  status: string;
  detail: string;
  note: string;
}

export interface Vessel {
  name: string;
  group: string;
  about: string;
  radius_mm: number;
  points: number[][];
}

export interface Vessels {
  vessels: Vessel[];
  groups: Record<string, { label: string; colour: string; about: string }>;
  space: string;
  caption: string;
  note: string;
}

export interface DrugTarget {
  receptor: string;
  affinity: number;
  direction: number;
  proxy?: boolean;
  why?: string;
}

export interface DrugEntry {
  name: string;
  class: string;
  typical_dose: string;
  modeled: boolean;
  targets: DrugTarget[];
  note: string;
  why_not: string;
  proxy_targets: string[];
  stand_in_targets: string[];
}

export interface Formulary {
  drugs: DrugEntry[];
  receptors: string[];
  tracers: Record<string, string>;
  stand_in: string[];
  synthetic_template: boolean;
  banner: string;
  note: string;
}

export interface DrugImpact {
  kind: "drugs";
  ok: boolean;
  modeled: boolean;
  banner: string;
  drugs: string[];
  gain: number;
  members?: number;
  receptors?: string[];
  weight?: number[];
  region_effect?: number[];
  lo?: number[];
  hi?: number[];
  unclear?: boolean[];
  unclear_count?: number;
  top_changed?: number[];
  baseline_rate?: number[];
  summary_delta?: { rate: number; fc_strength: number; metastability: number };
  warnings: string[];
  interval_covers?: string[];
  interval_misses?: string[];
  synthetic_template?: boolean;
  note: string;
  say: string;
}

export interface TimelineEvent {
  time: string;
  day: string;
  kind: string;
  label: string;
  band: string;
  id: string;
  week?: number;
  detail: Record<string, unknown>;
}

export interface Timeline {
  events: TimelineEvent[];
  days: { day: string; bands: string[]; count: number; labels: string[] }[];
  next_call: { due: string | null; last?: string | null; overdue: boolean; days_late?: number; say: string };
  bands: Record<string, string>;
}

export interface Percentile {
  ok: boolean;
  k?: number;
  percentile?: number;
  outside?: string;
  size?: number;
  quartiles?: number[];
  range?: number[];
  histogram?: { from: number; to: number; count: number }[];
  say: string;
  limits?: string[];
}

export interface EvidenceClaim {
  section: string;
  claim: string;
  source: string;
  tag: "verified" | "check this" | "";
  detail: string;
}

export interface EvidenceNumber {
  name: string;
  value: number;
  target: number | null;
  ok: boolean;
  unit: string;
  say: string;
  caveat: string;
  interval?: number[];
  detail?: string;
}

export interface Evidence {
  ok: boolean;
  claims: EvidenceClaim[];
  sections: string[];
  counts: { verified: number; check_this: number };
  numbers: EvidenceNumber[];
  weak: string[];
  limits: string[];
  doc: string;
  note: string;
}

/* ---------------------------------------------------------------- the ingest stream */

export interface FieldSource {
  confidence: number;
  source_file: string;
  source_quote: string;
  derived_from: string[];
}

export interface Provenance {
  ok: boolean;
  ingested: boolean;
  threshold: number;
  fields: Record<string, FieldSource>;
  needs_review: string[];
  note: string;
}

export interface IngestStep {
  kind: "step";
  step: string;
  state: "running" | "done";
  say: string;
  detail?: string;
  items?: { name: string; kind: string; why?: string }[];
  needs_review?: string[];
}

export interface IngestDone {
  kind: "done";
  patient_id: string;
  name: string;
  fields: number;
  needs_review: string[];
  threshold: number;
  how: string;
  sources: Record<string, FieldSource>;
  conflicts: { fields: string[]; say: string }[];
  documents: { name: string; kind: string; why?: string }[];
}

export interface IngestFailed {
  kind: "failed";
  step: string;
  say: string;
  error: string;
}

export type IngestEvent = IngestStep | IngestDone | IngestFailed;

/**
 * Build a patient from their documents, yielding each step as the server finishes it.
 *
 * The response is an event stream on the POST itself, so this reads the body rather than
 * opening a second EventSource connection. Parsing is deliberately simple: the server
 * writes one `event:`/`data:` pair per message and this only needs the data line.
 */
export async function* ingest(files: File[], sample: boolean): AsyncGenerator<IngestEvent> {
  await ready();
  if (useMock) {
    yield* mock.ingest(sample ? [] : files);
    return;
  }

  const form = new FormData();
  for (const file of files) form.append("files", file, file.name);
  if (sample) form.append("sample", "1");

  const res = await fetch(`${API}/api/patients/ingest`, { method: "POST", body: form });
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => res.statusText);
    throw new Error(detail.slice(0, 300));
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // Messages are separated by a blank line. Anything after the last one is a partial
    // message and stays in the buffer until the rest of it arrives.
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      for (const line of part.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        try {
          yield JSON.parse(line.slice(6)) as IngestEvent;
        } catch {
          // A malformed message is skipped rather than killing the stream: the steps
          // after it are still worth showing.
        }
      }
    }
  }
}

/* ---------------------------------------------------------------- query hooks */

export const useHealth = () => useQuery({ queryKey: ["health"], queryFn: api.health, staleTime: 60000 });
export const usePatients = () => useQuery({ queryKey: ["patients"], queryFn: api.patients, refetchInterval: 10000 });
export const usePatient = (id: string) => useQuery({ queryKey: ["patient", id], queryFn: () => api.patient(id), enabled: !!id });
export const useForecast = (id: string) => useQuery({ queryKey: ["forecast", id], queryFn: () => api.forecast(id), enabled: !!id });
export const useTwin = (id: string) => useQuery({ queryKey: ["twin", id], queryFn: () => api.twin(id), enabled: !!id, staleTime: 30000 });
export const useMesh = () => useQuery({ queryKey: ["mesh"], queryFn: api.mesh, staleTime: Infinity, gcTime: Infinity });
export const useShape = (id: string) => useQuery({ queryKey: ["shape", id], queryFn: () => api.shape(id), enabled: !!id, staleTime: 30000 });
export const useReceptors = () => useQuery({ queryKey: ["receptors"], queryFn: api.receptors, staleTime: Infinity });
export const useLoadings = () => useQuery({ queryKey: ["loadings"], queryFn: api.loadings, staleTime: Infinity });
export const useCheckins = (id: string) => useQuery({ queryKey: ["checkins", id], queryFn: () => api.checkins(id), enabled: !!id });
export const useCheckin = (cid: string | null) =>
  useQuery({ queryKey: ["checkin", cid], queryFn: () => api.checkin(cid as string), enabled: !!cid });
export const useAlerts = (patientId?: string) =>
  useQuery({ queryKey: ["alerts", patientId ?? "all"], queryFn: () => api.alerts(patientId), refetchInterval: 5000 });
export const useCohort = () => useQuery({ queryKey: ["cohort"], queryFn: api.cohort });
export const useMessages = (id: string) =>
  useQuery({ queryKey: ["messages", id], queryFn: () => api.messages(id), enabled: !!id, refetchInterval: 2000 });
export const usePipeline = (id: string) =>
  useQuery({
    queryKey: ["pipeline", id],
    queryFn: () => api.pipeline(id),
    enabled: !!id,
    // Runs take minutes, so keep asking while the pipeline is going and stop once it has ended.
    refetchInterval: (q) => (q.state.data?.status === "running" ? 3000 : false),
  });
export const useAttribution = (id: string) =>
  useQuery({ queryKey: ["attribution", id], queryFn: () => api.attribution(id), enabled: !!id });
export const useTwinInputs = (id: string) =>
  useQuery({ queryKey: ["twin-inputs", id], queryFn: () => api.twinInputs(id), enabled: !!id });
export const useVoices = () => useQuery({ queryKey: ["voices"], queryFn: api.voices });
export const useProvenance = (id: string) =>
  useQuery({ queryKey: ["provenance", id], queryFn: () => api.provenance(id), enabled: !!id });
export const useVessels = (on = true) =>
  useQuery({ queryKey: ["vessels"], queryFn: api.vessels, staleTime: Infinity, enabled: on });
export const useFormulary = () =>
  useQuery({ queryKey: ["formulary"], queryFn: api.formulary, staleTime: Infinity });
export const useEvidence = () =>
  useQuery({ queryKey: ["evidence"], queryFn: api.evidence, staleTime: 60000 });
export const useTimeline = (id: string) =>
  useQuery({ queryKey: ["timeline", id], queryFn: () => api.timeline(id), enabled: !!id });
export const usePercentile = (id: string) =>
  useQuery({ queryKey: ["percentile", id], queryFn: () => api.percentile(id), enabled: !!id });
export const useCallScript = (token: string) =>
  useQuery({ queryKey: ["call-script", token], queryFn: () => api.callScript(token), enabled: !!token, staleTime: Infinity });
export const useCallStatus = (token: string) =>
  useQuery({ queryKey: ["call-status", token], queryFn: () => api.callStatus(token), enabled: !!token, refetchInterval: 2000 });
export const useAlertRule = (aid: string | null) =>
  useQuery({ queryKey: ["alert-rule", aid], queryFn: () => api.explainAlert(aid as string), enabled: !!aid });

/* ---------------------------------------------------------------- mutation hooks */

/** Every write invalidates the read caches, so a demo action visibly moves every screen. */
function useWrite<A, R>(fn: (arg: A) => Promise<R>): UseMutationResult<R, Error, A> {
  const qc = useQueryClient();
  return useMutation<R, Error, A>({
    mutationFn: fn,
    onSuccess: () =>
      qc.invalidateQueries({
        predicate: (q) => q.queryKey[0] !== "health" && q.queryKey[0] !== "mesh",
      }),
  });
}

export const useCreatePatient = () => useWrite((b: { name: string; age: number; sex: "F" | "M" }) => api.createPatient(b));
export const useBuildTwin = () => useWrite((id: string) => api.buildTwin(id));
export const useUpload = () =>
  useWrite((a: { id: string; kind?: InputFile["kind"]; file?: File; injury?: Partial<Patient["injury"]>; synthetic?: boolean; remove?: boolean }) => {
    if (a.synthetic) return api.uploadSynthetic(a.id);
    if (a.injury) return api.uploadInjury(a.id, a.injury);
    if (a.remove && a.kind) return api.removeFile(a.id, a.kind);
    if (a.kind && a.file) return api.uploadFile(a.id, a.kind, a.file);
    throw new Error("Upload needs a file, an injury form, a removal, or the synthetic flag");
  });
export const useAckAlert = () => useWrite((aid: string) => api.ackAlert(aid));
export const useNote = () => useWrite((a: { id: string; text: string }) => api.note(a.id, a.text));
export const useScenarios = () => useWrite((a: { id: string; a: Scenario; b: Scenario }) => api.scenarios(a.id, { a: a.a, b: a.b }));
export const useCounterfactual = () => useWrite((a: { id: string; k_mult: number; p_add: number }) => api.counterfactual(a.id, a));
export const useIntervention = () => useWrite((a: { id: string; target: string; gain: number }) => api.intervention(a.id, a));
/** The drug viewer. Not a useWrite: it changes nothing, so it must not invalidate anything. */
export const useDrugImpact = (id: string, drugs: { name: string }[], gain: number, on: boolean) =>
  useQuery({
    queryKey: ["drug-impact", id, drugs.map((d) => d.name).sort().join(","), gain],
    queryFn: () => api.drugImpact(id, drugs, gain),
    enabled: on && !!id && drugs.length > 0,
    staleTime: Infinity,
  });
export const useRescore = () => useWrite((a: { cid: string; task: string }) => api.rescore(a.cid, a.task));
export const useUnusable = () => useWrite((cid: string) => api.unusable(cid));
export const useCreateCall = () => useWrite((a: { patientId: string; send: boolean }) => api.createCall(a.patientId, a.send));
export const useDemoReset = () => useWrite(() => api.demoReset());
export const useAdvanceWeek = () => useWrite((patientId: string) => api.advanceWeek(patientId));
export const useInjectDrift = () => useWrite((a: { patientId: string; size: number }) => api.injectDrift(a.patientId, a.size));
export const useTriggerCall = () => useWrite((patientId: string) => api.triggerCall(patientId));
export const useRegenerateVoice = () => useWrite((stepId: string) => api.regenerateVoice(stepId));

export const useStartPipeline = () => useWrite((id: string) => api.startPipeline(id));
