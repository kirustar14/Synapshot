// Derivations the dashboard applies to real measurement data. Everything here is a rule over
// existing fields, never a generated alarm and never a clinical claim.

import type { Checkin, Forecast, Patient, PatientRow, Signal } from "@/api/types";

/* ---------------------------------------------------------------- review priority */

export type ReviewTone = "urgent" | "attention" | "caution" | "info" | "calm" | "neutral";

export interface Review {
  label: string;
  tone: ReviewTone;
  /** 3 is the top of the worklist, 0 is settled. */
  priority: number;
  reason: string;
}

const hoursSince = (iso: string) => (Date.now() - new Date(iso).getTime()) / 36e5;

/**
 * Which patients need review, and why. Ordered rules over the flags the monitoring pipeline
 * already raised, the recorded check-in time and the drift z score. No random statuses.
 *
 * When the patient detail is available, a flag whose alert has been acknowledged counts as
 * reviewed: acknowledgement is the persistence the record actually offers.
 */
export function reviewOf(row: PatientRow, patient?: Patient): Review {
  const flags = new Set(row.flags);
  const alerts = patient?.alerts ?? [];
  if (flags.size > 0 && alerts.length > 0 && alerts.every((a) => a.acked))
    return {
      label: "Reviewed",
      tone: "calm",
      priority: 0,
      reason: "The latest monitoring flag has been acknowledged by a clinician.",
    };
  if (flags.has("red_flag"))
    return {
      label: "Needs review",
      tone: "urgent",
      priority: 3,
      reason: "A safety question was answered yes during the latest check-in.",
    };
  if (flags.has("drift"))
    return {
      label: "Needs review",
      tone: "attention",
      priority: 3,
      reason: row.drift_z
        ? `Measurements sit outside the forecast band (drift z ${row.drift_z.toFixed(1)}).`
        : "Measurements sit outside the forecast band.",
    };
  if (flags.has("missed_call"))
    return {
      label: "Overdue",
      tone: "attention",
      priority: 2,
      reason: "The scheduled weekly check-in has not been completed.",
    };
  if (flags.has("low_quality"))
    return {
      label: "Capture quality",
      tone: "caution",
      priority: 1,
      reason: "The last check-in fell below the capture limits, so its measures are less reliable.",
    };
  if (!row.last_call)
    return {
      label: "No check-in",
      tone: "neutral",
      priority: 0,
      reason: "No completed assessment has been recorded yet.",
    };
  if (hoursSince(row.last_call) <= 72)
    return {
      label: "New check-in",
      tone: "info",
      priority: 1,
      reason: "A check-in completed within the last 72 hours.",
    };
  return {
    label: "Stable",
    tone: "calm",
    priority: 0,
    reason: "No open monitoring flag; the latest measures stayed inside the forecast band.",
  };
}

/** Highest priority first, then the furthest drift. */
export function rankRows(rows: PatientRow[]): PatientRow[] {
  return [...rows].sort(
    (a, b) =>
      reviewOf(b).priority - reviewOf(a).priority ||
      Math.abs(b.drift_z) - Math.abs(a.drift_z) ||
      a.name.localeCompare(b.name),
  );
}

/** Same ranking, with each row's detail so a reviewed flag is respected. */
export function rankDigests<T extends { row: PatientRow; patient?: Patient }>(items: T[]): T[] {
  return [...items].sort(
    (a, b) =>
      reviewOf(b.row, b.patient).priority - reviewOf(a.row, a.patient).priority ||
      Math.abs(b.row.drift_z) - Math.abs(a.row.drift_z) ||
      a.row.name.localeCompare(b.row.name),
  );
}

export const needsReview = (row: PatientRow, patient?: Patient) => reviewOf(row, patient).priority >= 2;

/* ---------------------------------------------------------------- trends and completion */

const MEMORY_KEYS = ["recall_delayed", "word_recall"];

/** The signal a worklist sparkline should show: the measured memory score when present. */
export function trendSignal(forecast?: Forecast): Signal | null {
  if (!forecast) return null;
  const withObs = forecast.signals.filter((s) => s.tier === "A" && s.obs.length > 0);
  if (withObs.length === 0) return null;
  return withObs.find((s) => MEMORY_KEYS.includes(s.key)) ?? withObs[0];
}

export interface Completion {
  completed: number;
  overdue: number;
  upcoming: number;
  total: number;
  rate: number;
}

/**
 * Recorded check-ins versus the ones the pipeline still expects. Overdue is counted from the
 * monitoring pipeline's own missed_call flag rather than a second, invented cadence rule, so
 * the donut and the "Overdue check-ins" counter can never disagree.
 */
export function completionOf(rows: PatientRow[], byPatient: Map<string, Checkin[]>): Completion {
  let completed = 0;
  let overdue = 0;
  rows.forEach((row) => {
    completed += (byPatient.get(row.id) ?? []).filter((c) => !c.unusable).length;
    if (row.flags.includes("missed_call")) overdue += 1;
  });
  const total = completed + overdue;
  return {
    completed,
    overdue,
    upcoming: 0,
    total,
    rate: total === 0 ? 0 : completed / total,
  };
}

/* ---------------------------------------------------------------- findings */

export type FindingTone = "attention" | "watch" | "clear";

export interface Finding {
  key: string;
  title: string;
  detail: string;
  tone: FindingTone;
  signal: Signal;
  week: number;
  value: number | null;
  previous: number | null;
  expected: { lo: number; hi: number } | null;
  /** Share of this record's observations inside the 80 percent band. */
  coverage: number;
  next: string;
  evidence: string;
}

const fmt = (v: number, unit: string) => {
  const digits = Math.abs(v) >= 10 ? 0 : Math.abs(v) >= 1 ? 1 : 2;
  return `${v.toFixed(digits)}${unit ? ` ${unit}` : ""}`;
};

/**
 * The measurements that most deserve a look, each explained against its baseline, its band
 * and the smallest change the method can detect. Findings are observations, not diagnoses.
 */
export function findingsOf(forecast: Forecast | undefined, patient: Patient): Finding[] {
  if (!forecast) return [];
  const week = patient.week;
  const out: Finding[] = [];

  for (const signal of forecast.signals) {
    if (signal.tier !== "A" || signal.obs.length === 0) continue;
    const latest = signal.obs[signal.obs.length - 1];
    const first = signal.obs[0];
    const i = forecast.weeks.indexOf(latest.week);
    if (i < 0) continue;
    const lo = signal.lo[i];
    const hi = signal.hi[i];
    const outside = latest.value > hi ? "above" : latest.value < lo ? "below" : null;
    const half = Math.max(1e-6, (hi - lo) / 2);
    const mid = (hi + lo) / 2;
    const distance = Math.abs(latest.value - mid) / half;
    const feature = patient.last_call?.features.find((f) => f.name === signal.label);
    const mdc = feature?.mdc ?? null;
    const change = latest.value - first.value;

    if (!outside && (mdc === null || Math.abs(change) <= mdc)) continue;

    const tone: FindingTone = outside ? "attention" : "watch";
    const measure = humanizeMeasure(signal.label);
    const detail = outside
      ? `The week ${latest.week} measure of ${fmt(latest.value, signal.unit)} sits ${outside} the 80 percent band of ${fmt(lo, signal.unit)} to ${fmt(hi, signal.unit)}. Baseline at week ${first.week} was ${fmt(first.value, signal.unit)}.`
      : `The measure moved from ${fmt(first.value, signal.unit)} at week ${first.week} to ${fmt(latest.value, signal.unit)} at week ${latest.week}, a change larger than the smallest detectable change for this method (${mdc === null ? "not reported" : fmt(mdc, signal.unit)}). It remains inside its forecast band.`;

    out.push({
      key: signal.key,
      title: outside ? `${measure} outside its expected range` : `${measure} changed since baseline`,
      detail,
      tone,
      signal,
      week: latest.week,
      value: latest.value,
      previous: first.value,
      expected: { lo, hi },
      coverage: patient.coverage,
      next: `Repeat ${measure.toLowerCase()} at the next check-in to see whether the change holds.`,
      evidence: `${signal.obs.length} measured week${signal.obs.length === 1 ? "" : "s"} · ${outside ? `drift ${distance.toFixed(1)} band widths` : `change ${fmt(change, signal.unit)}`}${mdc === null ? "" : ` · smallest detectable change ${fmt(mdc, signal.unit)}`}`,
    });
  }

  out.sort((a, b) => Number(b.tone === "attention") - Number(a.tone === "attention"));
  const ranked = out.slice(0, 3);
  if (ranked.length === 0) {
    const signal = trendSignal(forecast);
    if (!signal) return [];
    const latest = signal.obs[signal.obs.length - 1];
    const i = forecast.weeks.indexOf(latest.week);
    ranked.push({
      key: signal.key,
      title: "No measurement sits outside its forecast band",
      detail: `Every tier A measure recorded up to week ${week} stayed inside its 80 percent band. The record has ${signal.obs.length} measured weeks, so a quiet week should not be read as proof of recovery.`,
      tone: "clear",
      signal,
      week: latest.week,
      value: latest.value,
      previous: signal.obs[0]?.value ?? null,
      expected: i >= 0 ? { lo: signal.lo[i], hi: signal.hi[i] } : null,
      coverage: patient.coverage,
      next: `Keep the weekly cadence; the next check-in extends the observed series.`,
      evidence: `Coverage ${Math.round(patient.coverage * 100)}% of observations inside the 80 percent band.`,
    });
  }
  return ranked;
}

/* ---------------------------------------------------------------- assessment metrics */

export interface Metric {
  key: string;
  label: string;
  group: string;
  value: number;
  previous: number | null;
  unit: string;
  mdc: number;
  changed: boolean;
  week: number;
}

/** Readable labels for the measures either data layer can return. */
const LABELS: Record<string, string> = {
  recall_delayed: "Delayed recall",
  recall_immediate: "Immediate recall",
  word_recall: "Delayed word recall",
  pursuit_gain: "Pursuit gain",
  pursuit_gain_v: "Vertical pursuit gain",
  pursuit_rms: "Pursuit error",
  saccade_latency: "Saccade latency",
  antisaccade_err: "Antisaccade error",
  antisaccade_latency: "Antisaccade latency",
  bcea: "BCEA",
  npc_cm: "Near point of convergence",
  speech_rate: "Speech rate",
  ptk_rate: "Patáka rate",
  ah_duration: "Sustained phonation",
  rapid_naming: "Rapid naming",
  fluency_animals: "Animal fluency",
  intrusions: "Intrusions",
  pause_ratio: "Pause ratio",
  symptom_total: "Symptom total",
  blink_rate: "Blink rate",
  blink_dur: "Blink duration",
  smile_mean: "Smile trace",
  brow_mean: "Brow trace",
};

/** "0 to 80" is a scale rather than a unit, so it is shortened wherever it is printed. */
export const unitLabel = (unit: string) => (unit === "0 to 80" ? "0–80" : unit);

/** Value with its unit, formatted the same way on every screen. */
export function formatMeasure(value: number, unit: string): string {
  const digits = Math.abs(value) >= 10 ? 0 : 2;
  const label = unitLabel(unit);
  return label ? `${value.toFixed(digits)} ${label}` : value.toFixed(digits);
}

/** Mock features are already labelled; backend features are keys. Handle both. */
export function humanizeMeasure(name: string): string {
  if (LABELS[name]) return LABELS[name];
  if (/\s/.test(name)) return name;
  const words = name.split("_");
  return words[0].charAt(0).toUpperCase() + words[0].slice(1) + (words.length > 1 ? ` ${words.slice(1).join(" ")}` : "");
}

/** Which part of the assessment a measure belongs to. */
export function measureGroup(name: string): "Memory" | "Eye tracking" | "Speech" | "Symptoms" | "Facial" | "Other" {
  const n = name.toLowerCase();
  if (n.includes("recall") || n.includes("memory")) return "Memory";
  if (n.includes("pursuit") || n.includes("saccade") || n.includes("bcea") || n.includes("npc") || n.includes("gaze"))
    return "Eye tracking";
  if (n.includes("speech") || n.includes("ptk") || n.includes("naming") || n.includes("fluency") || n.includes("intrusion") || n.includes("pause") || n.includes("phonation") || n.includes("ah_duration"))
    return "Speech";
  if (n.includes("symptom")) return "Symptoms";
  if (n.includes("blink") || n.includes("smile") || n.includes("brow")) return "Facial";
  return "Other";
}

const PREFERRED = [
  ["recall_delayed", "Delayed word recall", "recall_immediate", "Immediate recall"],
  ["pursuit_gain", "Pursuit gain"],
  ["speech_rate", "Speech rate", "pause_ratio", "Pause ratio"],
  ["symptom_total", "Symptom total"],
];

/** One headline measure per domain, each with its previous session for context. */
export function metricsOf(patient: Patient): Metric[] {
  const call = patient.last_call;
  if (!call) return [];
  return PREFERRED.flatMap((names) => {
    const feature = names.map((n) => call.features.find((f) => f.name === n)).find(Boolean);
    if (!feature) return [];
    return [{
      key: feature.name,
      label: humanizeMeasure(feature.name),
      group: measureGroup(feature.name),
      value: feature.value,
      previous: feature.prev,
      unit: feature.unit,
      mdc: feature.mdc,
      changed: feature.changed,
      week: call.week,
    }];
  });
}

/* ---------------------------------------------------------------- labels and dates */

export const RELATIVE_DAYS = (iso: string | null) => {
  if (!iso) return "None";
  const days = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 864e5));
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

export const ENROLLED = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

export const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

/** "Week 5 of 12", the monitoring frame the model uses. */
export const WEEK_MAX = 12;
