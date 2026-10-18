import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { mock } from "@/mock/db";
import type {
  Alert, Attribution, Check, Checkin, Cohort, Forecast, InputFile, Message, Patient, PatientRow, Scenario, ScenarioResult, Twin,
} from "./types";

export const API: string = (import.meta.env.VITE_API_URL as string | undefined) ?? "";

let modePromise: Promise<"mock" | "live"> | null = null;
let liveBackendMode: "mock" | "live" = "live";

/** Resolves whether to use the real backend. Empty VITE_API_URL or a failed health call means mock. */
export function getMode(): Promise<"mock" | "live"> {
  if (typeof window === "undefined") return Promise.resolve(API ? "live" : "mock");
  if (!modePromise) {
    modePromise = (async () => {
      if (!API) return "mock";
      try {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), 2500);
        const r = await fetch(`${API}/api/health`, { signal: ctl.signal });
        clearTimeout(t);
        if (!r.ok) return "mock";
        const j = (await r.json()) as { ok: boolean; mode: "mock" | "live" };
        liveBackendMode = j.mode;
        return j.ok ? "live" : "mock";
      } catch {
        return "mock";
      }
    })();
  }
  return modePromise;
}

const delay = (ms = 120) => new Promise((r) => setTimeout(r, ms));

async function call<T>(path: string, init: { method?: string; body?: unknown; form?: FormData } | undefined, fallback: () => T): Promise<T> {
  const mode = await getMode();
  if (mode === "mock") {
    await delay();
    return fallback();
  }
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;
  if (init?.form) body = init.form;
  else if (init?.body !== undefined) { headers["Content-Type"] = "application/json"; body = JSON.stringify(init.body); }
  const r = await fetch(`${API}/api${path}`, { method: init?.method ?? (body ? "POST" : "GET"), headers, body });
  if (!r.ok) throw new Error(`${r.status} ${await r.text().catch(() => r.statusText)}`);
  const ct = r.headers.get("content-type") ?? "";
  return (ct.includes("json") ? r.json() : ({ ok: true } as unknown)) as Promise<T>;
}

/* ---------- route functions (one per contract route) ---------- */

export const api = {
  health: async () => {
    const m = await getMode();
    return m === "mock" ? mock.health() : { ok: true, mode: liveBackendMode };
  },
  patients: () => call<PatientRow[]>("/patients", undefined, mock.patients),
  createPatient: (b: { name: string; age: number; sex: "F" | "M" }) => call<Patient>("/patients", { body: { ...b, synthetic: true } }, () => mock.createPatient(b)),
  patient: (id: string) => call<Patient>(`/patients/${id}`, undefined, () => mock.patient(id)),
  forecast: (id: string) => call<Forecast>(`/patients/${id}/forecast`, undefined, () => mock.forecast(id)),
  twin: (id: string) => call<Twin>(`/patients/${id}/twin`, undefined, () => mock.twin(id)),
  scenarios: (id: string, b: { a: Scenario; b: Scenario }) => call<ScenarioResult>(`/patients/${id}/scenarios`, { body: b }, () => mock.scenarios(id, b)),
  counterfactual: (id: string, b: { k_mult: number; p_add: number }) => call<Forecast>(`/patients/${id}/counterfactual`, { body: b }, () => mock.counterfactual(id, b)),
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
  uploadSynthetic: (id: string) => call<InputFile[]>(`/patients/${id}/uploads`, { body: { synthetic: true } }, () => mock.upload(id, null)),
  /** Not in the contract: mock only, live mode re-uploads instead. */
  removeFile: (id: string, kind: InputFile["kind"]) => call<InputFile[]>(`/patients/${id}/uploads`, { body: { kind, remove: true } }, () => mock.upload(id, kind, undefined, true)),
  uploadInjury: (id: string, inj: Partial<Patient["injury"]>) => {
    const form = new FormData();
    form.append("kind", "injury");
    form.append("file", new Blob([JSON.stringify(inj)], { type: "application/json" }), "injury_form.json");
    return call<InputFile[]>(`/patients/${id}/uploads`, { form }, () => { mock.setInjury(id, inj); return mock.upload(id, "injury", "injury_form.json"); });
  },
  twinInputs: (id: string) => call<{ inputs: InputFile[]; fc_fit: number | null; low_fidelity: boolean }>(`/patients/${id}/twin-inputs`, undefined, () => mock.twinInputs(id)),
  buildTwin: (id: string) => call<Patient>(`/patients/${id}/build-twin`, { method: "POST" }, () => mock.buildTwin(id)),
  messages: (id: string) => call<Message[]>(`/patients/${id}/messages`, undefined, () => mock.messages(id)),
  note: (id: string, text: string) => call(`/patients/${id}/note`, { body: { text } }, () => mock.note(id, text)),
  alerts: (pid?: string) => call<Alert[]>(`/alerts${pid ? `?patient_id=${pid}` : ""}`, undefined, () => mock.alerts(pid)),
  ack: (aid: string) => call(`/alerts/${aid}/ack`, { method: "POST" }, () => mock.ack(aid)),
  callAlert: (aid: string) => call(`/alerts/${aid}/call`, { method: "POST" }, () => mock.call(aid)),
  cohort: () => call<Cohort>("/cohort", undefined, mock.cohort),
  preflight: () => call<Check[]>("/rig/preflight", undefined, mock.preflight),
  reset: () => call("/demo/reset", { method: "POST" }, mock.reset),
  advanceWeek: (patient_id: string) => call("/demo/advance-week", { body: { patient_id } }, () => mock.advanceWeek(patient_id)),
  injectDrift: (patient_id: string, size: number) => call("/demo/inject-drift", { body: { patient_id, size } }, () => mock.injectDrift(patient_id, size)),
  triggerCall: (patient_id: string) => call("/demo/trigger-call", { body: { patient_id } }, () => mock.triggerCall(patient_id)),
  consent: (token: string) => call<{ patient_name: string; text: string[] }>(`/consent/${token}`, undefined, () => mock.consent(token)),
  submitConsent: (token: string, b: { calls: boolean; ai: boolean; recording: boolean; genetic: boolean }) => call(`/consent/${token}`, { body: b }, () => mock.submitConsent(token, b)),
  stretch: (token: string, b: { gait?: { cadence: number; variability: number; steps: number }; hearing?: { thresholds: Record<string, number> } }) => call(`/stretch/${token}`, { body: b }, () => mock.submitStretch(token, b)),
};

/* ---------- query hooks ---------- */

export const useHealth = () => useQuery({ queryKey: ["health"], queryFn: api.health, staleTime: 60000 });
export const usePatients = () => useQuery({ queryKey: ["patients"], queryFn: api.patients, refetchInterval: 10000 });
export const usePatient = (id: string) => useQuery({ queryKey: ["patient", id], queryFn: () => api.patient(id) });
export const useForecast = (id: string) => useQuery({ queryKey: ["forecast", id], queryFn: () => api.forecast(id) });
export const useTwin = (id: string) => useQuery({ queryKey: ["twin", id], queryFn: () => api.twin(id), staleTime: 30000 });
export const useAttribution = (id: string) => useQuery({ queryKey: ["attribution", id], queryFn: () => api.attribution(id) });
export const useCheckins = (id: string) => useQuery({ queryKey: ["checkins", id], queryFn: () => api.checkins(id) });
export const useCheckin = (cid: string | null) => useQuery({ queryKey: ["checkin", cid], queryFn: () => api.checkin(cid!), enabled: !!cid });
export const useTwinInputs = (id: string) => useQuery({ queryKey: ["twin-inputs", id], queryFn: () => api.twinInputs(id) });
export const useMessages = (id: string) => useQuery({ queryKey: ["messages", id], queryFn: () => api.messages(id), refetchInterval: 2000 });
export const useAlerts = (pid?: string) => useQuery({ queryKey: ["alerts", pid ?? "all"], queryFn: () => api.alerts(pid), refetchInterval: 5000 });
export const useCohort = () => useQuery({ queryKey: ["cohort"], queryFn: api.cohort });
export const usePreflight = () => useQuery({ queryKey: ["preflight"], queryFn: api.preflight, staleTime: Infinity });
export const useConsent = (token: string) => useQuery({ queryKey: ["consent", token], queryFn: () => api.consent(token) });

/** Mutation that invalidates everything on success, so every screen reacts. */
export function useAction<A, R>(fn: (a: A) => Promise<R>, opts?: { onSuccess?: (r: R, a: A) => void; onError?: (e: Error) => void }) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (r, a) => { qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "preflight" && q.queryKey[0] !== "health" }); opts?.onSuccess?.(r, a); },
    onError: (e: Error) => opts?.onError?.(e),
  });
}
