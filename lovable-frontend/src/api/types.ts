export type Flag = "red_flag" | "missed_call" | "low_quality" | "drift";
export interface PatientRow { id: string; name: string; week: number; drift_z: number; last_call: string | null; flags: Flag[]; synthetic: boolean }
export interface InputFile { kind: "t1" | "dwi" | "fmri" | "vcf" | "labs" | "injury"; file: string; synthetic: boolean; status: "ok" | "warn" | "error" | "missing"; sets: string; note?: string }
export interface Alert { id: string; patient_id: string; type: Flag; trigger: string; time: string; called: boolean; acked: boolean }
export interface Patient { id: string; name: string; age: number; sex: "F" | "M"; week: number;
  injury: { mechanism: string; helmet: string; angle_deg: number; location: string; date: string; loc: boolean };
  inputs: InputFile[];
  alleles: { apoe_e4: 0 | 1 | 2; bdnf_met: boolean; comt: "Val/Val" | "Val/Met" | "Met/Met" };
  biomarkers: { gfap_z: number; uchl1_z: number };
  fc_fit: number | null; coverage: number; contraction: { k: number };
  params: { G: number; k: number; p: number; eps: number };
  alerts: Alert[]; last_call: Checkin | null; twin_built: boolean; template_only: boolean; low_fidelity: boolean }
export interface Signal { key: string; label: string; unit: string; group: "eyes" | "speech" | "memory" | "symptoms"; tier: "A" | "B";
  mean: number[]; lo: number[]; hi: number[]; obs: { week: number; value: number; sem: number }[] }
export interface Forecast { weeks: number[]; signals: Signal[]; coverage: { week: number; cov: number }[] }
export interface Twin { weeks: number[];
  regions: { id: number; name: string; hemi: "L" | "R"; x: number; y: number; z: number; ei: number; template_ei: number; damage: number[]; activity: number[] }[];
  edges: { a: number; b: number; damage: number[]; template_w: number; personal_w: number }[];
  top_tracts: { name: string; damage_w0: number; damage_now: number }[] }
export interface Feature { name: string; tier: "A" | "B"; value: number; prev: number | null; mdc: number; unit: string; changed: boolean }
export interface Checkin { id: string; patient_id: string; week: number; date: string; duration_s: number; steps: string[];
  channel: { fps: number; calib_err_deg: number; face_share: number; flash_ok: boolean };
  features: Feature[];
  gaze: { task: string; t: number[]; x: number[]; y: number[]; tx: number[]; ty: number[] }[];
  traces?: { blink: { t: number[]; v: number[] }; smile: { t: number[]; v: number[] }; brow: { t: number[]; v: number[] } };
  transcript: { who: "agent" | "patient"; text: string; t: number }[]; unusable: boolean }
export interface Scenario { helmet: string; angle_deg: number }
export interface ScenarioResult { a: Forecast; b: Forecast; diff: { param: string; a: string; b: string }[] }
export interface Message { dir: "out" | "in"; body: string; time: string }
export interface Check { name: string; ok: boolean; detail: string }
export interface Cohort { weeks: number[]; coverage: { week: number; cov: number }[]; k_true: number[]; k_est: number[];
  effects: { name: string; true: number; est: number; lo: number; hi: number }[]; size: number }
export interface Attribution { signal: string; tracts: { name: string; score: number }[]; note: string } // note always says "hypothesis"
export type RigEvent = { type: "frame"; gaze: { x: number; y: number }; target: { x: number; y: number };
  quality: { face: boolean; dist: boolean; light: boolean; fps: number };
  pursuit_gain: number | null; step: string; line: { who: "agent" | "patient"; text: string } | null; frame?: string /* base64 jpeg */ }
