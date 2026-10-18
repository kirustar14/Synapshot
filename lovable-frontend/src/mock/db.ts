import type {
  Alert, Attribution, Check, Checkin, Cohort, Feature, Flag, Forecast, InputFile, Message,
  Patient, PatientRow, Scenario, ScenarioResult, Signal, Twin,
} from "@/api/types";
import { hashStr, rng, round } from "./rng";

type Kind = "fresh" | "stable" | "drifting" | "redflag" | "lowq" | "template" | "new";

interface PState {
  patient: Patient;
  kind: Kind;
  drift: number;
  severity: number;
  checkins: Checkin[];
  messages: Message[];
  notes: string[];
}

interface RigState { status: "idle" | "ringing" | "in_call" | "failed"; since: number; patient_id: string | null }

const WEEKS = Array.from({ length: 13 }, (_, i) => i);
const DAY = 86400000;

const SIGNALS: { key: string; label: string; unit: string; group: Signal["group"]; tier: "A" | "B"; healthy: number; deficit: number; sd: number }[] = [
  { key: "pursuit_gain", label: "Pursuit gain", unit: "ratio", group: "eyes", tier: "A", healthy: 0.92, deficit: -0.3, sd: 0.06 },
  { key: "saccade_latency", label: "Saccade latency", unit: "ms", group: "eyes", tier: "B", healthy: 190, deficit: 90, sd: 18 },
  { key: "speech_rate", label: "Speech rate", unit: "syll/s", group: "speech", tier: "A", healthy: 4.6, deficit: -1.4, sd: 0.3 },
  { key: "pause_ratio", label: "Pause ratio", unit: "%", group: "speech", tier: "A", healthy: 18, deficit: 16, sd: 3 },
  { key: "word_recall", label: "Delayed word recall", unit: "words", group: "memory", tier: "A", healthy: 9, deficit: -4, sd: 0.9 },
  { key: "digit_span", label: "Digit span", unit: "digits", group: "memory", tier: "A", healthy: 7, deficit: -2.2, sd: 0.6 },
  { key: "headache", label: "Headache score", unit: "0-6", group: "symptoms", tier: "A", healthy: 0.5, deficit: 4, sd: 0.5 },
  { key: "fatigue", label: "Fatigue score", unit: "0-6", group: "symptoms", tier: "A", healthy: 0.8, deficit: 3.6, sd: 0.5 },
];

const AREAS = [
  "Superior frontal", "Middle frontal", "Inferior frontal", "Orbitofrontal", "Precentral", "Postcentral",
  "Superior parietal", "Inferior parietal", "Precuneus", "Cuneus", "Lingual", "Lateral occipital",
  "Fusiform", "Superior temporal", "Middle temporal", "Inferior temporal", "Parahippocampal", "Entorhinal",
  "Insula", "Cingulate anterior", "Cingulate posterior", "Thalamus", "Caudate", "Putamen", "Hippocampus",
];

function regionName(i: number) {
  const hemi = i < 50 ? "L" : "R";
  const j = i % 50;
  return `${hemi} ${AREAS[j % 25]}${j >= 25 ? " (post)" : " (ant)"}`;
}

/* ---------- forecast ---------- */

function makeForecast(s: PState, opts: { kMult?: number; pAdd?: number; severity?: number; withObs?: boolean } = {}): Forecast {
  const p = s.patient;
  const k = p.params.k * (opts.kMult ?? 1);
  const perm = Math.min(0.9, Math.max(0, p.params.p + (opts.pAdd ?? 0)));
  const sev = opts.severity ?? s.severity;
  const r = rng(hashStr(p.id + "obs"));
  const signals: Signal[] = SIGNALS.map((d) => {
    const mean: number[] = [], lo: number[] = [], hi: number[] = [];
    WEEKS.forEach((w) => {
      const rem = (1 - perm) * Math.exp(-k * w) + perm;
      const m = d.healthy + d.deficit * sev * rem;
      const sd = d.sd * (1.6 - 0.9 * Math.min(w, p.week + 1) / 12) * (p.template_only ? 1.25 : 1) * (s.kind === "lowq" ? 1.2 : 1);
      mean.push(round(m, 3)); lo.push(round(m - 1.28 * sd, 3)); hi.push(round(m + 1.28 * sd, 3));
    });
    const obs: Signal["obs"] = [];
    if (opts.withObs !== false) {
      for (const c of s.checkins) {
        const w = c.week;
        const sd = (hi[w] - lo[w]) / 2.56;
        let v = mean[w] + r.normal() * sd * 0.7;
        if (s.drift > 0 && w >= p.week - 1) v += Math.sign(d.deficit) * s.drift * sd * (w === p.week ? 1 : 0.6);
        if (d.tier === "B" && !c.channel.flash_ok) continue;
        obs.push({ week: w, value: round(v, 3), sem: round(sd * 0.35, 3) });
      }
    }
    return { key: d.key, label: d.label, unit: d.unit, group: d.group, tier: d.tier, mean, lo, hi, obs };
  });
  const coverage: Forecast["coverage"] = [];
  let inside = 0, total = 0;
  WEEKS.filter((w) => w <= p.week).forEach((w) => {
    signals.forEach((sg) => sg.obs.filter((o) => o.week === w).forEach((o) => {
      total++; if (o.value >= sg.lo[w] && o.value <= sg.hi[w]) inside++;
    }));
    coverage.push({ week: w, cov: total ? round(inside / total, 3) : 0.8 });
  });
  return { weeks: WEEKS, signals, coverage };
}

function driftZ(s: PState) {
  const f = makeForecast(s);
  const w = s.patient.week;
  let sum = 0, n = 0;
  f.signals.forEach((sg) => {
    const o = sg.obs.find((x) => x.week === w);
    if (!o) return;
    const sd = (sg.hi[w] - sg.lo[w]) / 2.56;
    sum += Math.abs(o.value - sg.mean[w]) / sd; n++;
  });
  return n ? round(sum / n, 2) : 0;
}

/* ---------- checkins ---------- */

const STEPS = ["Greeting", "Calibration", "Smooth pursuit", "Saccades", "Flash test", "Reading passage", "Word list", "Digit span", "Symptom check", "Goodbye"];

function makeCheckin(s: PState, week: number, base: number): Checkin {
  const p = s.patient;
  const r = rng(hashStr(p.id + "call" + week));
  const lowq = s.kind === "lowq";
  const flash_ok = !lowq && r.next() > 0.2;
  const t = Array.from({ length: 120 }, (_, i) => round(i / 30, 3));
  const gain = 0.6 + Math.min(week, 12) * 0.025;
  const pursuit = {
    task: "Smooth pursuit",
    t,
    tx: t.map((x) => round(Math.sin(x * 2.4) * 10, 2)),
    ty: t.map(() => 0),
    x: t.map((x) => round(Math.sin(x * 2.4 - 0.15) * 10 * gain + r.normal() * (lowq ? 1.6 : 0.6), 2)),
    y: t.map(() => round(r.normal() * 0.5, 2)),
  };
  const sacc = {
    task: "Saccades",
    t,
    tx: t.map((x) => (Math.floor(x / 0.8) % 2 ? 12 : -12)),
    ty: t.map(() => 0),
    x: t.map((x) => { const ph = x % 0.8; const tgt = Math.floor(x / 0.8) % 2 ? 12 : -12; return round(ph < 0.22 ? -tgt : tgt + r.normal() * 0.6, 2); }),
    y: t.map(() => round(r.normal() * 0.4, 2)),
  };
  const tr = (f: (x: number) => number) => ({ t, v: t.map((x) => round(f(x) + r.normal() * 0.04, 3)) });
  const steps = lowq && r.next() > 0.5 ? STEPS.slice(0, 7) : STEPS;
  const date = new Date(base + week * 7 * DAY).toISOString();
  return {
    id: `${p.id}-c${week}`, patient_id: p.id, week, date, duration_s: Math.round(560 + r.next() * 200), steps,
    channel: { fps: lowq ? round(17 + r.next() * 6, 1) : round(29 + r.next(), 1), calib_err_deg: lowq ? round(1.8 + r.next(), 2) : round(0.5 + r.next() * 0.4, 2), face_share: lowq ? round(0.62 + r.next() * 0.1, 2) : round(0.9 + r.next() * 0.08, 2), flash_ok },
    features: [], gaze: [pursuit, sacc],
    traces: { blink: tr((x) => (x % 3.1 < 0.12 ? 1 : 0)), smile: tr((x) => 0.3 + 0.2 * Math.sin(x)), brow: tr((x) => 0.2 + 0.1 * Math.sin(x * 1.7)) },
    transcript: [
      { who: "agent", text: `Hi ${p.name.split(" ")[0]}, this is your weekly check-in. Is now still a good time?`, t: 2 },
      { who: "patient", text: "Yes, I am ready.", t: 6 },
      { who: "agent", text: "Please follow the dot with your eyes, keeping your head still.", t: 20 },
      { who: "patient", text: "Okay.", t: 23 },
      { who: "agent", text: "Now I will read five words. Please repeat them back.", t: 180 },
      { who: "patient", text: "Apple, river, candle, ... garden, and I forget the last one.", t: 196 },
      { who: "agent", text: "Thank you. How has your headache been this week, from zero to six?", t: 400 },
      { who: "patient", text: week > 4 ? "Maybe a one. Much better." : "About a three, mostly in the afternoon.", t: 406 },
      { who: "agent", text: "Thanks. Your care team will see today's results. Talk next week.", t: 540 },
    ],
    unusable: false,
  };
}

function fillFeatures(s: PState) {
  const f = makeForecast(s);
  s.checkins.forEach((c, i) => {
    c.features = f.signals.flatMap((sg) => {
      const o = sg.obs.find((x) => x.week === c.week);
      if (!o) return [];
      const prevO = i > 0 ? sg.obs.find((x) => x.week === s.checkins[i - 1].week) : undefined;
      const d = SIGNALS.find((x) => x.key === sg.key)!;
      const mdc = round(d.sd * 1.5, 3);
      const prev = prevO ? prevO.value : null;
      const feat: Feature = { name: sg.label, tier: sg.tier, value: o.value, prev, mdc, unit: sg.unit, changed: prev != null && Math.abs(o.value - prev) > mdc };
      return [feat];
    });
  });
}

/* ---------- patients ---------- */

const INPUT_SETS: Record<InputFile["kind"], string> = {
  t1: "sets brain anatomy and region boundaries",
  dwi: "sets structural connectivity",
  fmri: "sets the target for functional connectivity fit",
  vcf: "sets priors on recovery rate",
  labs: "sets injury severity prior",
  injury: "sets the impact location and initial damage",
};

const FILE_NAMES: Record<InputFile["kind"], string> = {
  t1: "t1_mprage.nii.gz", dwi: "dwi_64dir.nii.gz", fmri: "rest_bold.nii.gz", vcf: "genotype.vcf.gz", labs: "biomarkers.csv", injury: "injury_form.json",
};

function makeInputs(kind: Kind): InputFile[] {
  return (Object.keys(INPUT_SETS) as InputFile["kind"][]).map((k) => {
    if (kind === "new") return { kind: k, file: "", synthetic: true, status: "missing", sets: INPUT_SETS[k] };
    if (kind === "template" && (k === "dwi" || k === "fmri")) return { kind: k, file: "", synthetic: true, status: "missing", sets: INPUT_SETS[k], note: "Template connectome used" };
    const status: InputFile["status"] = kind === "lowq" && k === "fmri" ? "warn" : "ok";
    return { kind: k, file: `synthetic_${FILE_NAMES[k]}`, synthetic: true, status, sets: INPUT_SETS[k], note: status === "warn" ? "High head motion in 18% of volumes" : undefined };
  });
}

const SEEDS: { name: string; age: number; sex: "F" | "M"; week: number; kind: Kind; helmet: string; angle: number; mech: string; loc: string }[] = [
  { name: "Avery Lindqvist", age: 24, sex: "F", week: 0, kind: "fresh", helmet: "A", angle: 30, mech: "Cycling fall", loc: "Left frontal" },
  { name: "Jonah Mercer", age: 19, sex: "M", week: 4, kind: "stable", helmet: "B", angle: 15, mech: "Football tackle", loc: "Right temporal" },
  { name: "Priya Nandakumar", age: 31, sex: "F", week: 6, kind: "drifting", helmet: "A", angle: 60, mech: "Ski collision", loc: "Left parietal" },
  { name: "Tomas Reyes", age: 42, sex: "M", week: 3, kind: "redflag", helmet: "None", angle: 75, mech: "Motor vehicle", loc: "Frontal" },
  { name: "Mei Okafor", age: 27, sex: "F", week: 5, kind: "lowq", helmet: "B", angle: 40, mech: "Rugby ruck", loc: "Right frontal" },
  { name: "Dana Whitfield", age: 36, sex: "M", week: 2, kind: "template", helmet: "A", angle: 20, mech: "Fall from ladder", loc: "Occipital" },
];

function makePatient(id: string, seed: (typeof SEEDS)[number], now: number): PState {
  const r = rng(hashStr(id));
  const apoe = (r.next() > 0.75 ? 1 : 0) as 0 | 1 | 2;
  const bdnf = r.next() > 0.6;
  const k = round(0.28 - apoe * 0.05 - (bdnf ? 0.02 : 0) + r.normal() * 0.02, 3);
  const template_only = seed.kind === "template";
  const built = seed.kind !== "new";
  const fc = built ? (template_only ? 0.41 : seed.kind === "lowq" ? 0.44 : round(0.58 + r.next() * 0.1, 2)) : null;
  const base = now - seed.week * 7 * DAY - 2 * DAY;
  const patient: Patient = {
    id, name: seed.name, age: seed.age, sex: seed.sex, week: seed.week,
    injury: { mechanism: seed.mech, helmet: seed.helmet, angle_deg: seed.angle, location: seed.loc, date: new Date(base - DAY).toISOString().slice(0, 10), loc: seed.kind === "redflag" },
    inputs: makeInputs(seed.kind),
    alleles: { apoe_e4: apoe, bdnf_met: bdnf, comt: r.pick(["Val/Val", "Val/Met", "Met/Met"] as const) },
    biomarkers: { gfap_z: round(1 + r.next() * 1.8, 2), uchl1_z: round(0.6 + r.next() * 1.5, 2) },
    fc_fit: fc, coverage: 0.8, contraction: { k: 0 },
    params: { G: round(1.8 + r.next() * 0.6, 2), k, p: round(0.08 + r.next() * 0.08, 3), eps: round(0.04 + r.next() * 0.03, 3) },
    alerts: [], last_call: null, twin_built: built, template_only, low_fidelity: fc != null && fc < 0.45,
  };
  const s: PState = { patient, kind: seed.kind, drift: seed.kind === "drifting" ? 2.4 : 0, severity: 0.8 + r.next() * 0.3, checkins: [], messages: [], notes: [] };
  if (built) for (let w = 0; w <= seed.week; w++) {
    if (seed.kind === "template" && w === 1) continue; // missed call
    s.checkins.push(makeCheckin(s, w, base));
  }
  s.messages = [
    { dir: "out", body: `Hi ${seed.name.split(" ")[0]}, this is the UNNAMED care line. Your clinic set up weekly FaceTime check-ins. Reply YES to review the consent page.`, time: new Date(base - DAY / 2).toISOString() },
    { dir: "in", body: "YES", time: new Date(base - DAY / 2 + 120000).toISOString() },
    { dir: "out", body: "Thank you. Your first call is tomorrow at 10:00. It takes about 10 minutes.", time: new Date(base - DAY / 2 + 180000).toISOString() },
  ];
  refresh(s);
  return s;
}

function refresh(s: PState) {
  fillFeatures(s);
  const p = s.patient;
  const f = makeForecast(s);
  p.coverage = f.coverage.length ? f.coverage[f.coverage.length - 1].cov : 0.8;
  p.contraction = { k: round(1 - 1 / Math.sqrt(1 + s.checkins.length * 0.6), 3) };
  p.last_call = s.checkins.length ? { ...s.checkins[s.checkins.length - 1] } : null;
}

function flagsOf(s: PState): Flag[] {
  const f: Flag[] = [];
  if (s.kind === "redflag") f.push("red_flag");
  const expected = s.patient.week + 1;
  if (s.patient.twin_built && s.checkins.length < expected) f.push("missed_call");
  if (s.kind === "lowq") f.push("low_quality");
  if (driftZ(s) > 2) f.push("drift");
  return f;
}

const TRIGGERS: Record<Flag, string> = {
  red_flag: "Patient reported worsening headache and repeated vomiting during call",
  missed_call: "No answer to scheduled call, 2 retries",
  low_quality: "Frame rate under 20 fps, calibration error above 1.5 deg",
  drift: "Observed values outside the 80% band on 3 signals",
};

/* ---------- db ---------- */

interface DB {
  patients: PState[];
  alerts: Alert[];
  rig: RigState;
  preflightRuns: number;
  consents: Record<string, unknown>;
  stretch: Record<string, unknown>;
}

let _db: DB | null = null;

function build(): DB {
  const now = Date.now();
  const patients = SEEDS.map((s, i) => makePatient(`p${i + 1}`, s, now));
  const d: DB = { patients, alerts: [], rig: { status: "idle", since: now, patient_id: null }, preflightRuns: 0, consents: {}, stretch: {} };
  patients.forEach((s) => syncAlerts(d, s));
  return d;
}

export function db(): DB {
  if (!_db) _db = build();
  return _db;
}

function syncAlerts(d: DB, s: PState) {
  const flags = flagsOf(s);
  flags.forEach((fl) => {
    if (!d.alerts.some((a) => a.patient_id === s.patient.id && a.type === fl && !a.acked)) {
      d.alerts.unshift({ id: `a${Math.floor(Math.random() * 1e9).toString(36)}`, patient_id: s.patient.id, type: fl, trigger: fl === "drift" ? `${TRIGGERS.drift}, drift z ${driftZ(s)}` : TRIGGERS[fl], time: new Date().toISOString(), called: false, acked: false });
    }
  });
  s.patient.alerts = d.alerts.filter((a) => a.patient_id === s.patient.id && !a.acked);
}

function get(id: string): PState {
  const s = db().patients.find((x) => x.patient.id === id);
  if (!s) throw new Error("Patient not found");
  return s;
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

/* ---------- twin ---------- */

const twinCache = new Map<string, Twin>();

function makeTwin(s: PState): Twin {
  const key = `${s.patient.id}:${s.patient.params.k}:${s.patient.template_only}:${s.severity}`;
  const c = twinCache.get(key);
  if (c) return c;
  const r = rng(hashStr(s.patient.id + "twin"));
  const geo = rng(42);
  const { k, p } = s.patient.params;
  const ang = (s.patient.injury.angle_deg * Math.PI) / 180;
  const impact = { x: Math.cos(ang) * 0.7 * (s.patient.injury.location.startsWith("Right") ? 1 : -1), y: 0.35, z: 0.6 + Math.sin(ang) * 0.2 };
  if (s.patient.injury.location.startsWith("Occipital")) impact.z = -0.8;
  const regions: Twin["regions"] = Array.from({ length: 100 }, (_, i) => {
    const hemiSign = i < 50 ? -1 : 1;
    let x = 0, y = 0, z = 0;
    for (;;) { x = geo.next() * 2 - 1; y = geo.next() * 2 - 1; z = geo.next() * 2 - 1; const d = x * x + y * y + z * z; if (d < 1 && d > 0.25) break; }
    const pos = { x: hemiSign * (0.06 + Math.abs(x) * 0.62), y: y * 0.62, z: z * 0.92 };
    const dist2 = (pos.x - impact.x) ** 2 + (pos.y - impact.y) ** 2 + (pos.z - impact.z) ** 2;
    const d0 = Math.min(1, s.severity * Math.exp(-dist2 / 0.35) + r.next() * 0.05);
    const template_ei = round(1 + geo.normal() * 0.15, 3);
    return {
      id: i, name: regionName(i), hemi: i < 50 ? "L" : "R", x: round(pos.x, 3), y: round(pos.y, 3), z: round(pos.z, 3),
      ei: round(template_ei + r.normal() * 0.08, 3), template_ei,
      damage: WEEKS.map((w) => round(d0 * ((1 - p) * Math.exp(-k * w) + p), 3)),
      activity: WEEKS.map((w) => round(0.5 + 0.4 * Math.sin(i * 0.7 + w * 0.5) - d0 * 0.3 * Math.exp(-k * w), 3)),
    };
  });
  const edges: Twin["edges"] = [];
  const seen = new Set<string>();
  while (edges.length < 200) {
    const a = Math.floor(geo.next() * 100);
    let b = Math.floor(geo.next() * 100);
    if (geo.next() < 0.7) {
      // prefer near neighbours
      let best = -1, bd = 9;
      for (let t = 0; t < 8; t++) { const c2 = Math.floor(geo.next() * 100); const ra = regions[a], rc = regions[c2]; const dd = (ra.x - rc.x) ** 2 + (ra.y - rc.y) ** 2 + (ra.z - rc.z) ** 2; if (c2 !== a && dd < bd) { bd = dd; best = c2; } }
      b = best;
    }
    if (a === b || b < 0) continue;
    const key2 = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (seen.has(key2)) continue;
    seen.add(key2);
    const tw = round(0.3 + geo.next() * 0.7, 3);
    const d0 = Math.min(1, Math.max(regions[a].damage[0], regions[b].damage[0]) * (0.7 + r.next() * 0.5));
    edges.push({
      a, b, template_w: tw, personal_w: s.patient.template_only ? tw : round(Math.max(0.05, tw + r.normal() * 0.18), 3),
      damage: WEEKS.map((w) => round(d0 * ((1 - p) * Math.exp(-k * w) + p), 3)),
    });
  }
  const now = s.patient.week;
  const top_tracts = [...edges].sort((x, y) => y.damage[0] - x.damage[0]).slice(0, 8)
    .map((e) => ({ name: `${regions[e.a].name} to ${regions[e.b].name}`, damage_w0: e.damage[0], damage_now: e.damage[now] }));
  const t: Twin = { weeks: WEEKS, regions, edges, top_tracts };
  twinCache.set(key, t);
  return t;
}

/* ---------- public mock API ---------- */

export const mock = {
  health: () => ({ ok: true, mode: "mock" as const }),
  patients: (): PatientRow[] => db().patients.map((s) => ({
    id: s.patient.id, name: s.patient.name, week: s.patient.week, drift_z: driftZ(s),
    last_call: s.checkins.length ? s.checkins[s.checkins.length - 1].date : null, flags: flagsOf(s), synthetic: true,
  })),
  createPatient: (b: { name: string; age: number; sex: "F" | "M" }): Patient => {
    const d = db();
    const id = `p${d.patients.length + 1}${Math.floor(Math.random() * 1000)}`;
    const s = makePatient(id, { name: b.name, age: b.age, sex: b.sex, week: 0, kind: "new", helmet: "A", angle: 30, mech: "Not set", loc: "Left frontal" }, Date.now());
    d.patients.push(s);
    return clone(s.patient);
  },
  patient: (id: string): Patient => { const s = get(id); syncAlerts(db(), s); return clone(s.patient); },
  forecast: (id: string) => clone(makeForecast(get(id))),
  twin: (id: string) => makeTwin(get(id)),
  scenarios: (id: string, b: { a: Scenario; b: Scenario }): ScenarioResult => {
    const s = get(id);
    const sev = (sc: Scenario) => s.severity * (sc.helmet === "B" ? 0.8 : sc.helmet === "None" ? 1.25 : 1) * (0.8 + 0.4 * Math.sin((sc.angle_deg * Math.PI) / 180));
    const sa = sev(b.a), sb = sev(b.b);
    const diff: ScenarioResult["diff"] = [];
    if (b.a.helmet !== b.b.helmet) diff.push({ param: "Helmet", a: b.a.helmet, b: b.b.helmet });
    if (b.a.angle_deg !== b.b.angle_deg) diff.push({ param: "Impact angle", a: `${b.a.angle_deg} deg`, b: `${b.b.angle_deg} deg` });
    if (Math.abs(sa - sb) > 1e-6) {
      diff.push({ param: "Initial damage scale", a: sa.toFixed(2), b: sb.toFixed(2) });
      diff.push({ param: "Peak tract damage", a: (sa * 0.92).toFixed(2), b: (sb * 0.92).toFixed(2) });
    }
    return { a: makeForecast(s, { severity: sa, withObs: false }), b: makeForecast(s, { severity: sb, withObs: false }), diff };
  },
  counterfactual: (id: string, b: { k_mult: number; p_add: number }) => makeForecast(get(id), { kMult: b.k_mult, pAdd: b.p_add, withObs: false }),
  attribution: (id: string): Attribution[] => {
    const s = get(id);
    const t = makeTwin(s);
    const r = rng(hashStr(id + "attr"));
    return SIGNALS.map((sg, i) => ({
      signal: sg.label,
      tracts: [0, 1, 2].map((j) => ({ name: t.top_tracts[(i + j * 3) % t.top_tracts.length].name, score: round(0.7 - j * 0.18 + r.next() * 0.1, 2) })),
      note: "hypothesis: attribution from model sensitivity, not a measured cause",
    }));
  },
  checkins: (id: string): Checkin[] => clone(get(id).checkins).reverse().map((c) => ({ ...c, gaze: [] })),
  checkin: (cid: string): Checkin => {
    for (const s of db().patients) { const c = s.checkins.find((x) => x.id === cid); if (c) return clone(c); }
    throw new Error("Call not found");
  },
  rescore: (cid: string, _task: string) => { mock.checkin(cid); return { ok: true }; },
  unusable: (cid: string) => {
    for (const s of db().patients) { const c = s.checkins.find((x) => x.id === cid); if (c) { c.unusable = !c.unusable; return { ok: true }; } }
    throw new Error("Call not found");
  },
  upload: (id: string, kind: InputFile["kind"] | null, fileName?: string, remove?: boolean): InputFile[] => {
    const s = get(id);
    s.patient.inputs = s.patient.inputs.map((f) => {
      if (kind === null) return { ...f, file: `synthetic_${FILE_NAMES[f.kind]}`, synthetic: true, status: "ok", note: undefined };
      if (f.kind !== kind) return f;
      if (remove) return { ...f, file: "", status: "missing", synthetic: true, note: undefined };
      const lower = (fileName ?? "").toLowerCase();
      const okExt: Record<InputFile["kind"], string[]> = { t1: [".nii", ".nii.gz", ".dcm", ".zip"], dwi: [".nii", ".nii.gz", ".zip"], fmri: [".nii", ".nii.gz", ".zip"], vcf: [".vcf", ".vcf.gz"], labs: [".csv"], injury: [".json", "form"] };
      const ok = okExt[f.kind].some((e) => lower.endsWith(e) || lower.includes(e));
      return { ...f, file: fileName ?? "file", synthetic: false, status: ok ? "ok" : "warn", note: ok ? undefined : "Unexpected file type, will try to read it" };
    });
    return clone(s.patient.inputs);
  },
  setInjury: (id: string, inj: Partial<Patient["injury"]>) => { const s = get(id); s.patient.injury = { ...s.patient.injury, ...inj }; },
  twinInputs: (id: string) => { const p = get(id).patient; return { inputs: clone(p.inputs), fc_fit: p.fc_fit, low_fidelity: p.low_fidelity }; },
  buildTwin: (id: string): Patient => {
    const s = get(id);
    const p = s.patient;
    const has = (k: InputFile["kind"]) => p.inputs.some((f) => f.kind === k && f.status !== "missing" && f.status !== "error");
    if (!has("t1") && !has("injury")) throw new Error("Need at least a T1 MRI or an injury form to build the twin");
    p.template_only = !has("dwi");
    const r = rng(hashStr(id + "fc" + Date.now()));
    p.fc_fit = p.template_only ? round(0.38 + r.next() * 0.06, 2) : round(0.55 + r.next() * 0.12, 2);
    p.low_fidelity = p.fc_fit < 0.45;
    if (has("labs")) s.severity = 0.7 + p.biomarkers.gfap_z * 0.12;
    if (!p.twin_built) { p.twin_built = true; s.kind = s.kind === "new" ? "fresh" : s.kind; s.checkins = [makeCheckin(s, 0, Date.now() - DAY)]; }
    refresh(s); twinCache.clear();
    return clone(p);
  },
  messages: (id: string) => clone(get(id).messages),
  note: (id: string, text: string) => { get(id).notes.push(text); return { ok: true }; },
  alerts: (pid?: string) => clone(db().alerts.filter((a) => !pid || a.patient_id === pid))
    .sort((a, b) => Number(b.type === "red_flag") - Number(a.type === "red_flag") || Number(a.acked) - Number(b.acked) || b.time.localeCompare(a.time)),
  ack: (aid: string) => { const d = db(); const a = d.alerts.find((x) => x.id === aid); if (a) a.acked = true; d.patients.forEach((s) => (s.patient.alerts = d.alerts.filter((x) => x.patient_id === s.patient.id && !x.acked))); return { ok: true }; },
  call: (aid: string) => {
    const a = db().alerts.find((x) => x.id === aid);
    if (a) { a.called = true; const s = get(a.patient_id); s.messages.push({ dir: "out", body: "Your clinic is calling you now from a 555 number. Please pick up if you can.", time: new Date().toISOString() }); }
    return { ok: true };
  },
  cohort: (): Cohort => {
    const r = rng(77);
    const k_true = Array.from({ length: 50 }, () => round(0.25 + r.normal() * 0.07, 3));
    const k_est = k_true.map((k) => round(k + r.normal() * 0.025, 3));
    return {
      weeks: WEEKS, size: 50 + db().patients.length,
      coverage: WEEKS.map((w) => ({ week: w, cov: round(0.55 + 0.25 * (1 - Math.exp(-w / 4)) / (1 - Math.exp(-3)) + r.normal() * 0.015, 3) })),
      k_true, k_est,
      effects: [
        { name: "c_e4", true: -0.05, est: -0.046, lo: -0.08, hi: -0.012 },
        { name: "c_bio", true: 0.12, est: 0.109, lo: 0.07, hi: 0.15 },
        { name: "b_e4", true: 0.03, est: 0.041, lo: -0.01, hi: 0.09 },
        { name: "b_fe4", true: -0.02, est: 0.018, lo: -0.015, hi: 0.06 },
      ],
    };
  },
  preflight: (): Check[] => {
    const d = db();
    d.preflightRuns++;
    const r = rng(d.preflightRuns * 13);
    const fail = d.preflightRuns % 3 === 2 ? Math.floor(r.next() * 6) : -1;
    const checks = [
      ["Camera", "1080p capture at 30 fps"], ["FaceTime session", "Signed in, outbound calling enabled"], ["Stimulus display", "Second screen at 60 Hz, gamma calibrated"],
      ["Gaze model", "Loaded, calibration RMS 0.6 deg on test video"], ["Audio", "Mic and speaker routed, echo cancel on"], ["Backend link", "WebSocket round trip 38 ms"],
    ];
    return checks.map(([name, detail], i) => (i === fail ? { name, ok: false, detail: `${detail.split(",")[0]} not responding. Check the cable and re-run.` } : { name, ok: true, detail }));
  },
  reset: () => { _db = build(); twinCache.clear(); return { ok: true }; },
  advanceWeek: (pid: string) => {
    const s = get(pid);
    const p = s.patient;
    if (!p.twin_built) throw new Error("Build the twin first");
    if (p.week >= 12) throw new Error("Already at week 12");
    p.week++;
    const base = new Date(s.checkins[0]?.date ?? Date.now()).getTime();
    s.checkins.push(makeCheckin(s, p.week, base));
    refresh(s); twinCache.clear();
    s.messages.push({ dir: "out", body: `Week ${p.week} summary: thanks for your call. Your care team has your results. No action needed from you.`, time: new Date().toISOString() });
    syncAlerts(db(), s);
    return { ok: true };
  },
  injectDrift: (pid: string, size: number) => {
    const s = get(pid);
    s.drift += size;
    refresh(s);
    s.messages.push({ dir: "out", body: "Quick midweek check: how are you feeling today compared with last week? Reply BETTER, SAME, or WORSE.", time: new Date().toISOString() });
    syncAlerts(db(), s);
    return { ok: true };
  },
  triggerCall: (pid: string) => {
    const d = db();
    const s = get(pid);
    d.rig = { status: "ringing", since: Date.now(), patient_id: pid };
    s.messages.push({ dir: "out", body: "Heads up: your weekly FaceTime check-in is starting in a moment.", time: new Date().toISOString() });
    return { ok: true };
  },
  rigStatus: (): RigState => {
    const d = db();
    const el = Date.now() - d.rig.since;
    if (d.rig.status === "ringing" && el > 3500) d.rig = { ...d.rig, status: "in_call", since: Date.now() };
    else if (d.rig.status === "in_call" && el > 90000) d.rig = { status: "idle", since: Date.now(), patient_id: null };
    return d.rig;
  },
  consent: (token: string) => ({
    patient_name: db().patients.find((s) => s.patient.id === token)?.patient.name ?? "Avery Lindqvist",
    text: [
      "Your clinic would like to check in with you once a week by FaceTime video call. Each call takes about 10 minutes.",
      "During the call, a computer asks you to follow a dot with your eyes, read a short passage, remember a few words, and answer some questions about how you feel.",
      "An AI system runs the call and measures your eye movements, speech, memory answers, and facial movement. A person on your care team reviews the results.",
      "This is not a diagnosis and does not replace your doctor. If you feel worse at any time, call your clinic or emergency services.",
    ],
  }),
  submitConsent: (token: string, body: unknown) => { db().consents[token] = body; return { ok: true }; },
  submitStretch: (token: string, body: unknown) => { db().stretch[token] = body; return { ok: true }; },
};
