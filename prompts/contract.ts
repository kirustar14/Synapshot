// The complete UNNAMED API contract. This file is the source of truth shared by the
// backend and web/. Field names are frozen: never rename one on either side alone.
// Assembled from spec file 4 (base), spec file 1 (mesh, shape, receptors, intervention)
// and spec file 2 (the web call), plus the master prompt header section 3a.
//
// Copy this verbatim into web/src/api/types.ts. Everything under /api, JSON.

// ---------------------------------------------------------------- patients and alerts

export type Flag = "red_flag" | "missed_call" | "low_quality" | "drift";

export interface PatientRow {
  id: string;
  name: string;
  week: number;
  drift_z: number;
  last_call: string | null;
  flags: Flag[];
  synthetic: boolean;
}

export interface InputFile {
  kind: "t1" | "dwi" | "fmri" | "vcf" | "labs" | "injury";
  file: string;
  synthetic: boolean;
  status: "ok" | "warn" | "error" | "missing";
  sets: string;
  note?: string;
}

export interface Alert {
  id: string;
  patient_id: string;
  type: Flag;
  trigger: string;
  time: string;
  called: boolean;
  acked: boolean;
}

export interface Patient {
  id: string;
  name: string;
  age: number;
  sex: "F" | "M";
  week: number;
  injury: { mechanism: string; helmet: string; angle_deg: number; location: string; date: string; loc: boolean };
  inputs: InputFile[];
  alleles: { apoe_e4: 0 | 1 | 2; bdnf_met: boolean; comt: "Val/Val" | "Val/Met" | "Met/Met" };
  biomarkers: { gfap_z: number; uchl1_z: number };
  fc_fit: number | null;
  coverage: number;
  contraction: { k: number };
  params: { G: number; k: number; p: number; eps: number };
  alerts: Alert[];
  last_call: Checkin | null;
  twin_built: boolean;
  template_only: boolean;
  low_fidelity: boolean;
}

// ---------------------------------------------------------------- forecast

export interface Signal {
  key: string;
  label: string;
  unit: string;
  group: "eyes" | "speech" | "memory" | "symptoms";
  tier: "A" | "B";
  mean: number[];
  lo: number[];
  hi: number[];
  obs: { week: number; value: number; sem: number }[];
}

export interface Forecast {
  weeks: number[];
  signals: Signal[];
  coverage: { week: number; cov: number }[];
}

// ---------------------------------------------------------------- twin

export interface Region {
  id: number;
  name: string;
  hemi: "L" | "R";
  x: number;
  y: number;
  z: number;
  ei: number;
  template_ei: number;
  damage: number[];
  activity: number[];
  // Added by spec file 1 step 3. One array per week for the band, two scalars per region.
  damage_lo: number[];
  damage_hi: number[];
  recovery: number;
  network: string;
}

export interface Edge {
  a: number;
  b: number;
  damage: number[];
  template_w: number;
  personal_w: number;
}

export interface Twin {
  weeks: number[];
  regions: Region[];
  edges: Edge[];
  top_tracts: { name: string; damage_w0: number; damage_now: number }[];
}

// ---------------------------------------------------------------- mesh, shape, receptors, what-if

export interface Mesh {
  space: "fsaverage6";
  pial: number[];        // flat [x,y,z,...] in mm, centred on the origin
  inflated: number[];    // same length and order as pial
  faces: number[];       // flat [a,b,c,...] into the vertex arrays
  labels: number[];      // Schaefer-100 region index 0 to 99 per vertex, -1 for medial wall
  region_names: string[];  // 100 entries, left hemisphere first
  networks: string[];      // 100 entries: Vis, SomMot, DorsAttn, SalVentAttn, Limbic, Cont, Default
  border: number[];        // per vertex, 1 when a neighbour has a different label, else 0
  lobes: string[];         // 100 entries, plain-English area tag per region, approximate
  source: "fsaverage6" | "procedural";
}

export interface Shape {
  scale: [number, number, number];
  atrophy: number;
  thick_z: number[];     // 100 entries, per-region thickness z score
  impact: {
    vertex: number;
    point: [number, number, number];
    radius: number;
    amp: number[];       // 13 entries, weeks 0 to 12, swelling in mm
  };
  template_diff: number[];  // per vertex, displacement magnitude against the template
  source: "synthetic" | "freesurfer";
}

export interface Receptors {
  names: string[];
  maps: Record<string, number[]>;   // name -> 100 z scored region values
  synthetic_template: boolean;
}

export interface Intervention {
  target: string;
  region_effect: number[];          // 100 entries, change in firing rate per region
  summary_delta: { fc_strength: number; rate: number; metastability: number };
  note: string;                     // always the hypothetical what-if disclaimer
}

// Reach, behind REGIONAL_LOADINGS=1. Signal key -> 100 non-negative weights summing to 1.
export interface Loadings {
  signals: string[];
  weights: Record<string, number[]>;
  note: string;
}

// ---------------------------------------------------------------- check-ins

export interface Feature {
  name: string;
  tier: "A" | "B";
  value: number;
  prev: number | null;
  mdc: number;
  unit: string;
  changed: boolean;
}

export interface Checkin {
  id: string;
  patient_id: string;
  week: number;
  date: string;
  duration_s: number;
  steps: string[];
  channel: { fps: number; calib_err_deg: number; face_share: number; flash_ok: boolean };
  features: Feature[];
  gaze: { task: string; t: number[]; x: number[]; y: number[]; tx: number[]; ty: number[] }[];
  traces?: { blink: { t: number[]; v: number[] }; smile: { t: number[]; v: number[] }; brow: { t: number[]; v: number[] } };
  transcript: { who: "agent" | "patient"; text: string; t: number }[];
  unusable: boolean;
}

// ---------------------------------------------------------------- scenarios and cohort

export interface Scenario {
  helmet: string;
  angle_deg: number;
}

export interface ScenarioResult {
  a: Forecast;
  b: Forecast;
  diff: { param: string; a: string; b: string }[];
}

export interface Message {
  dir: "out" | "in";
  body: string;
  time: string;
  // Added by spec file 2 step 5. Which transport actually delivered it. Never label an
  // SMS as iMessage.
  channel: "imessage" | "sms" | "mock";
}

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

export interface Cohort {
  weeks: number[];
  coverage: { week: number; cov: number }[];
  k_true: number[];
  k_est: number[];
  effects: { name: string; true: number; est: number; lo: number; hi: number }[];
  size: number;
}

export interface Attribution {
  signal: string;
  tracts: { name: string; score: number }[];
  note: string;   // always says hypothesis
}

export type RigEvent = {
  type: "frame";
  gaze: { x: number; y: number };
  target: { x: number; y: number };
  quality: { face: boolean; dist: boolean; light: boolean; fps: number };
  pursuit_gain: number | null;
  step: string;
  line: { who: "agent" | "patient"; text: string } | null;
  frame?: string;   // base64 jpeg
};

// ---------------------------------------------------------------- the web call

export interface CallStart {
  token: string;
  url: string;
  expires: string;
}

export type CallTask =
  | "none" | "redflags" | "quality" | "calib" | "symptoms" | "encode"
  | "pursuit_h" | "pursuit_v" | "saccade" | "antisaccade" | "fixation" | "npc"
  | "speech_ah" | "speech_pataka" | "speech_passage" | "picture" | "fluency"
  | "recall" | "wrap";

export interface ScriptStep {
  id: string;
  say: string;
  audio?: string;          // file name under voice_base, absent means use speechSynthesis
  task: CallTask;
  minutes: number;
  tier: "A" | "B" | "safety" | "gate" | "none";
  block?: "A" | "B";
  params: Record<string, unknown>;
}

export interface CallScript {
  consent: string[];
  steps: ScriptStep[];
  voice_base: string;      // prefix to join with step.audio, normally "/voice/"
  symptom_items: string[];
  redflag_items: string[];
  words: string[];
  passage: string;
  picture: "kitchen";
  fluency_seconds: number;
}

// What the browser sends per video frame. t and cap are ms on the browser clock.
export interface FrameRec {
  t: number;
  cap?: number;
  face: boolean;
  ratio: { h: number; v: number };
  iris: { lx: number; ly: number; rx: number; ry: number };
  iris_px: number;
  head: { yaw: number; pitch: number; roll: number };
  ear: { l: number; r: number };
  bright: number;
  blend: { smile: number; brow_down: number; jaw_open: number };
}

// What the page logs about what it drew. x and y in 0..1 of the canvas.
export interface StimEvent {
  t: number;
  kind: string;
  x?: number;
  y?: number;
  flash?: boolean;
  trial?: number;
  side?: "L" | "R";
}

export interface CallStatus {
  state: "waiting" | "in_call" | "stopped" | "processing" | "done" | "failed";
  call_id?: string;
  summary?: string;
}

export interface RedflagResult {
  stop: boolean;
  say: string;
  audio?: string;
}

export interface SymptomResult {
  jump: boolean;
  short: boolean;
  skip: string[];   // step ids the page must not run
}

// ---------------------------------------------------------------- voices panel (D1)

export interface VoiceLine {
  id: string;
  text: string;
  hash: string;
  file: string;
  exists: boolean;
  duration_s: number | null;
}

export interface Voices {
  base: string;
  live: boolean;          // true when a real ElevenLabs key generated these
  model: string;
  lines: VoiceLine[];
}

// ---------------------------------------------------------------- routes
//
// GET  /api/health                               -> { ok: boolean; mode: "mock" | "live" }
// GET  /api/patients                             -> PatientRow[]
// POST /api/patients {name, age, sex, synthetic}  -> Patient
// GET  /api/patients/{id}                        -> Patient
// GET  /api/patients/{id}/forecast               -> Forecast
// GET  /api/patients/{id}/twin                   -> Twin
// POST /api/patients/{id}/scenarios {a, b}        -> ScenarioResult
// POST /api/patients/{id}/counterfactual {k_mult, p_add} -> Forecast
// GET  /api/patients/{id}/attribution            -> Attribution[]
// GET  /api/patients/{id}/checkins               -> Checkin[]  (no gaze arrays)
// GET  /api/checkins/{cid}                       -> Checkin    (full)
// POST /api/checkins/{cid}/rescore {task}
// POST /api/checkins/{cid}/unusable
// POST /api/patients/{id}/uploads                -> InputFile[]
// GET  /api/patients/{id}/twin-inputs            -> {inputs, fc_fit, low_fidelity}
// POST /api/patients/{id}/build-twin             -> Patient
// GET  /api/patients/{id}/messages               -> Message[]
// POST /api/patients/{id}/note {text}
// GET  /api/alerts?patient_id=                   -> Alert[]
// POST /api/alerts/{id}/ack
// POST /api/alerts/{id}/call
// GET  /api/cohort                               -> Cohort
// GET  /api/rig/preflight                        -> Check[]
// POST /api/demo/reset
// POST /api/demo/advance-week {patient_id}
// POST /api/demo/inject-drift {patient_id, size}
// POST /api/demo/trigger-call {patient_id}
// GET  /api/consent/{token}                      -> {patient_name, text}
// POST /api/consent/{token} {calls, ai, recording, genetic}
// POST /api/stretch/{token} {gait?, hearing?}
//
// spec file 1:
// GET  /api/mesh                                 -> Mesh
// GET  /api/patients/{id}/shape                  -> Shape
// GET  /api/receptors                            -> Receptors
// POST /api/patients/{id}/intervention {target, gain} -> Intervention
// GET  /api/loadings                             -> Loadings      (REGIONAL_LOADINGS=1)
//
// spec file 2:
// POST /api/calls {patient_id, send}             -> CallStart
// GET  /api/call/{token}/script                  -> CallScript
// POST /api/call/{token}/consent {calls, ai, recording, genetic}
// POST /api/call/{token}/redflags {answers}      -> RedflagResult
// POST /api/call/{token}/symptoms {scores, phase} -> SymptomResult
// POST /api/call/{token}/live {t, gaze, target, quality, step, line?}
// POST /api/call/{token}/frames {task, meta, frames, stim}
// POST /api/call/{token}/audio/{task}            multipart
// POST /api/call/{token}/finish {aborted}        -> {ok, call_id}
// GET  /api/call/{token}/status                  -> CallStatus
// GET  /api/voices                               -> Voices
// POST /api/voices/{step_id}/regenerate          -> VoiceLine
//
// WS /ws/rig       RigEvent out
// WS /ws/stimulus  backend only, the frontend never opens it
