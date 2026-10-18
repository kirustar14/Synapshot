// One function per contract route, then a TanStack Query hook for each. Same origin by
// default: VITE_API_URL is empty in production because the backend serves dist at / and the
// API at /api. If the boot health probe fails and no explicit API URL was given, every call
// routes to the seeded mock layer instead and the shell shows a "Mock data" badge.

import { useMutation, useQuery, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { mock } from "@/mock/db";
import type {
  Alert,
  Attribution,
  CallScript,
  CallStart,
  CallStatus,
  Check,
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
export interface ConsentDoc {
  patient_name: string;
  text: string[];
}
export interface ConsentChoices {
  calls: boolean;
  ai: boolean;
  recording: boolean;
  genetic: boolean;
}
export interface StretchResult {
  gait?: { cadence: number; variability: number; steps: number };
  hearing?: { thresholds: Record<string, number> };
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
  callAlert: (aid: string) => call(`/alerts/${aid}/call`, { method: "POST" }, () => mock.callAlert(aid)),

  cohort: () => call<Cohort>("/cohort", undefined, mock.cohort),
  preflight: () => call<Check[]>("/rig/preflight", undefined, mock.preflight),

  demoReset: () => call("/demo/reset", { method: "POST" }, mock.reset),
  advanceWeek: (patientId: string) => call("/demo/advance-week", { body: { patient_id: patientId } }, () => mock.advanceWeek(patientId)),
  injectDrift: (patientId: string, size: number) =>
    call("/demo/inject-drift", { body: { patient_id: patientId, size } }, () => mock.injectDrift(patientId, size)),
  triggerCall: (patientId: string) => call("/demo/trigger-call", { body: { patient_id: patientId } }, () => mock.triggerCall(patientId)),

  consentDoc: (token: string) => call<ConsentDoc>(`/consent/${token}`, undefined, () => mock.consent(token)),
  consent: (token: string, b: ConsentChoices) => call(`/consent/${token}`, { body: b }, () => mock.submitConsent(token, b)),
  stretch: (token: string, b: StretchResult) => call(`/stretch/${token}`, { body: b }, () => mock.submitStretch(token, b)),

  mesh: () => call<Mesh>("/mesh", undefined, mock.mesh),
  shape: (id: string) => call<Shape>(`/patients/${id}/shape`, undefined, () => mock.shape(id)),
  receptors: () => call<Receptors>("/receptors", undefined, mock.receptors),
  intervention: (id: string, b: { target: string; gain: number }) =>
    call<Intervention>(`/patients/${id}/intervention`, { body: b }, () => mock.intervention(id, b)),
  loadings: () => call<Loadings>("/loadings", undefined, mock.loadings),

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

  voices: () => call<Voices>("/voices", undefined, mock.voices),
  regenerateVoice: (stepId: string) =>
    call<VoiceLine>(`/voices/${stepId}/regenerate`, { method: "POST" }, () => mock.regenerateVoice(stepId)),
};

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
export const usePreflight = () => useQuery({ queryKey: ["preflight"], queryFn: api.preflight, staleTime: Infinity });
export const useAttribution = (id: string) =>
  useQuery({ queryKey: ["attribution", id], queryFn: () => api.attribution(id), enabled: !!id });
export const useTwinInputs = (id: string) =>
  useQuery({ queryKey: ["twin-inputs", id], queryFn: () => api.twinInputs(id), enabled: !!id });
export const useVoices = () => useQuery({ queryKey: ["voices"], queryFn: api.voices });
export const useCallScript = (token: string) =>
  useQuery({ queryKey: ["call-script", token], queryFn: () => api.callScript(token), enabled: !!token, staleTime: Infinity });
export const useCallStatus = (token: string) =>
  useQuery({ queryKey: ["call-status", token], queryFn: () => api.callStatus(token), enabled: !!token, refetchInterval: 2000 });
export const useConsentDoc = (token: string) =>
  useQuery({ queryKey: ["consent-doc", token], queryFn: () => api.consentDoc(token), enabled: !!token });

/* ---------------------------------------------------------------- mutation hooks */

/** Every write invalidates the read caches, so a demo action visibly moves every screen. */
function useWrite<A, R>(fn: (arg: A) => Promise<R>): UseMutationResult<R, Error, A> {
  const qc = useQueryClient();
  return useMutation<R, Error, A>({
    mutationFn: fn,
    onSuccess: () =>
      qc.invalidateQueries({
        predicate: (q) => q.queryKey[0] !== "health" && q.queryKey[0] !== "preflight" && q.queryKey[0] !== "mesh",
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
export const useCallAlert = () => useWrite((aid: string) => api.callAlert(aid));
export const useNote = () => useWrite((a: { id: string; text: string }) => api.note(a.id, a.text));
export const useScenarios = () => useWrite((a: { id: string; a: Scenario; b: Scenario }) => api.scenarios(a.id, { a: a.a, b: a.b }));
export const useCounterfactual = () => useWrite((a: { id: string; k_mult: number; p_add: number }) => api.counterfactual(a.id, a));
export const useIntervention = () => useWrite((a: { id: string; target: string; gain: number }) => api.intervention(a.id, a));
export const useRescore = () => useWrite((a: { cid: string; task: string }) => api.rescore(a.cid, a.task));
export const useUnusable = () => useWrite((cid: string) => api.unusable(cid));
export const useCreateCall = () => useWrite((a: { patientId: string; send: boolean }) => api.createCall(a.patientId, a.send));
export const useDemoReset = () => useWrite(() => api.demoReset());
export const useAdvanceWeek = () => useWrite((patientId: string) => api.advanceWeek(patientId));
export const useInjectDrift = () => useWrite((a: { patientId: string; size: number }) => api.injectDrift(a.patientId, a.size));
export const useTriggerCall = () => useWrite((patientId: string) => api.triggerCall(patientId));
export const useRegenerateVoice = () => useWrite((stepId: string) => api.regenerateVoice(stepId));
export const useStretch = () => useWrite((a: { token: string; result: StretchResult }) => api.stretch(a.token, a.result));
export const useConsent = () => useWrite((a: { token: string; choices: ConsentChoices }) => api.consent(a.token, a.choices));
