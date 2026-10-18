// The seeded mock backend. Every contract shape is produced here with believable values so a
// screen can be built with no backend running. Nothing in this file calls Math.random, so the
// cohort, the charts and the brain are identical on every reload.

import type {
  Alert,
  Attribution,
  CallScript,
  CallSend,
  CallStart,
  CallStatus,
  Check,
  Checkin,
  Cohort,
  Edge,
  Feature,
  Flag,
  Forecast,
  InputFile,
  Intervention,
  Loadings,
  Mesh,
  Message,
  Patient,
  PatientRow,
  Receptors,
  RedflagResult,
  Region,
  Scenario,
  ScenarioResult,
  Shape,
  Signal,
  SymptomResult,
  Twin,
  VoiceLine,
  Voices,
} from "@/api/types";
import { ATLAS, NETWORKS, REGION_NAMES } from "./atlas";
import { callScript, voices as voiceInventory } from "./call";
import { nearestVertex, proceduralMesh } from "./mesh";
import { clamp, hashStr, rng, round } from "./rng";

export type Kind = "fresh" | "stable" | "drifting" | "redflag" | "lowq" | "template" | "new";

const WEEKS = Array.from({ length: 13 }, (_, i) => i);
// The population mean weekly recovery rate the backend divides by for Region.recovery.
// It is exp(mu_k) from the priors, 0.25 per week, about a 2.8 week damage half life.
const POP_K = 0.25;
const DAY = 86400000;

/* ---------------------------------------------------------------- signals */

interface SignalSeed {
  key: string;
  label: string;
  unit: string;
  group: Signal["group"];
  tier: "A" | "B";
  healthy: number;
  deficit: number;
  sd: number;
}

// Six observables is the full set. The low quality profile reports only three of them.
const SIGNALS: SignalSeed[] = [
  { key: "pursuit_gain", label: "Pursuit gain", unit: "ratio", group: "eyes", tier: "A", healthy: 0.92, deficit: -0.3, sd: 0.06 },
  { key: "saccade_latency", label: "Saccade latency", unit: "ms", group: "eyes", tier: "B", healthy: 190, deficit: 90, sd: 18 },
  { key: "speech_rate", label: "Speech rate", unit: "syll/s", group: "speech", tier: "A", healthy: 4.6, deficit: -1.4, sd: 0.3 },
  { key: "pause_ratio", label: "Pause ratio", unit: "%", group: "speech", tier: "A", healthy: 18, deficit: 16, sd: 3 },
  { key: "word_recall", label: "Delayed word recall", unit: "words", group: "memory", tier: "A", healthy: 11, deficit: -5, sd: 1 },
  { key: "symptom_total", label: "Symptom total", unit: "0-80", group: "symptoms", tier: "A", healthy: 4, deficit: 34, sd: 4 },
];

// The three the low quality profile still manages to measure.
const LOWQ_KEYS = new Set(["pursuit_gain", "word_recall", "symptom_total"]);

/* ---------------------------------------------------------------- state */

interface PState {
  patient: Patient;
  kind: Kind;
  drift: number;
  severity: number;
  checkins: Checkin[];
  messages: Message[];
  notes: string[];
  lastIntervention: Intervention | null;
}

interface RigState {
  status: "idle" | "ringing" | "in_call" | "failed";
  since: number;
  patient_id: string | null;
}

interface CallRecord {
  token: string;
  patient_id: string;
  created: number;
  state: CallStatus["state"];
  finishedAt: number | null;
  call_id?: string;
  consent?: unknown;
  frames: number;
  skipped: string[];
  baselineTotal?: number;
  answers?: Record<string, number | string[]>;
}

interface DB {
  patients: PState[];
  alerts: Alert[];
  rig: RigState;
  preflightRuns: number;
  consents: Record<string, unknown>;
  stretch: Record<string, unknown>;
  calls: Record<string, CallRecord>;
  voices: Voices;
}

/* ---------------------------------------------------------------- forecast */

interface ForecastOpts {
  kMult?: number;
  pAdd?: number;
  severity?: number;
  withObs?: boolean;
}

/** Signals a profile can actually measure. Low quality loses the speech pair and all tier B. */
function usableSignals(s: PState): SignalSeed[] {
  if (s.kind === "lowq") return SIGNALS.filter((d) => LOWQ_KEYS.has(d.key));
  return SIGNALS;
}

function makeForecast(s: PState, opts: ForecastOpts = {}): Forecast {
  const p = s.patient;
  const k = p.params.k * (opts.kMult ?? 1);
  const perm = clamp(p.params.p + (opts.pAdd ?? 0), 0, 0.9);
  const sev = opts.severity ?? s.severity;
  const r = rng(hashStr(`${p.id}:obs`));
  const keys = new Set(usableSignals(s).map((d) => d.key));

  const signals: Signal[] = SIGNALS.map((d) => {
    const mean: number[] = [];
    const lo: number[] = [];
    const hi: number[] = [];
    for (const w of WEEKS) {
      const left = (1 - perm) * Math.exp(-k * w) + perm;
      const m = d.healthy + d.deficit * sev * left;
      // The band narrows as the weeks pass and the twin sees more data.
      const widen = 1.6 - (0.9 * Math.min(w, 12)) / 12;
      const sd = d.sd * widen * (p.template_only ? 1.3 : 1) * (s.kind === "lowq" ? 1.2 : 1);
      mean.push(round(m, 3));
      lo.push(round(m - 1.28 * sd, 3));
      hi.push(round(m + 1.28 * sd, 3));
    }

    const obs: Signal["obs"] = [];
    if (opts.withObs !== false && keys.has(d.key)) {
      for (const c of s.checkins) {
        if (c.unusable) continue;
        if (d.tier === "B" && !c.channel.flash_ok) continue;
        const w = c.week;
        const sd = (hi[w] - lo[w]) / 2.56;
        let v = mean[w] + r.normal() * sd * 0.6;
        if (s.drift > 0 && w >= p.week - 1) {
          v += Math.sign(d.deficit) * s.drift * sd * (w === p.week ? 1 : 0.55);
        }
        obs.push({ week: w, value: round(v, 3), sem: round(sd * 0.35, 3) });
      }
    }
    return { key: d.key, label: d.label, unit: d.unit, group: d.group, tier: d.tier, mean, lo, hi, obs };
  });

  const coverage: Forecast["coverage"] = [];
  let inside = 0;
  let total = 0;
  for (const w of WEEKS.filter((x) => x <= p.week)) {
    for (const sg of signals) {
      for (const o of sg.obs.filter((x) => x.week === w)) {
        total++;
        if (o.value >= sg.lo[w] && o.value <= sg.hi[w]) inside++;
      }
    }
    coverage.push({ week: w, cov: total ? round(inside / total, 3) : 0.8 });
  }
  return { weeks: WEEKS, signals, coverage };
}

/** Mean absolute z of this week's observations against the forecast mean. */
function driftZ(s: PState): number {
  const f = makeForecast(s);
  const w = s.patient.week;
  let sum = 0;
  let count = 0;
  for (const sg of f.signals) {
    const o = sg.obs.find((x) => x.week === w);
    if (!o) continue;
    const sd = (sg.hi[w] - sg.lo[w]) / 2.56;
    sum += Math.abs(o.value - sg.mean[w]) / sd;
    count++;
  }
  return count ? round(sum / count, 2) : 0;
}

/* ---------------------------------------------------------------- check-ins */

const STEP_IDS = callScript().steps.map((x) => x.id);

function makeCheckin(s: PState, week: number, base: number): Checkin {
  const p = s.patient;
  const r = rng(hashStr(`${p.id}:call:${week}`));
  const lowq = s.kind === "lowq";
  const flashOk = !lowq;
  const t = Array.from({ length: 150 }, (_, i) => round(i / 30, 3));
  const gain = 0.6 + Math.min(week, 12) * 0.024;
  const jitter = lowq ? 1.7 : 0.55;

  const pursuit = {
    task: "pursuit_h",
    t,
    tx: t.map((x) => round(Math.sin(x * 2.4) * 10, 2)),
    ty: t.map(() => 0),
    x: t.map((x) => round(Math.sin(x * 2.4 - 0.15) * 10 * gain + r.normal() * jitter, 2)),
    y: t.map(() => round(r.normal() * 0.5, 2)),
  };
  const saccade = {
    task: "saccade",
    t,
    tx: t.map((x) => (Math.floor(x / 0.8) % 2 ? 12 : -12)),
    ty: t.map(() => 0),
    x: t.map((x) => {
      const phase = x % 0.8;
      const target = Math.floor(x / 0.8) % 2 ? 12 : -12;
      return round(phase < 0.22 ? -target : target + r.normal() * 0.6, 2);
    }),
    y: t.map(() => round(r.normal() * 0.4, 2)),
  };
  const trace = (f: (x: number) => number) => ({ t, v: t.map((x) => round(f(x) + r.normal() * 0.04, 3)) });

  const steps = lowq ? STEP_IDS.slice(0, 8) : STEP_IDS;
  const first = p.name.split(" ")[0];
  return {
    id: `${p.id}-c${week}`,
    patient_id: p.id,
    week,
    date: new Date(base + week * 7 * DAY).toISOString(),
    duration_s: Math.round(540 + r.next() * 220),
    steps,
    channel: {
      fps: lowq ? round(16 + r.next() * 5, 1) : round(29 + r.next(), 1),
      calib_err_deg: lowq ? round(1.9 + r.next(), 2) : round(0.5 + r.next() * 0.4, 2),
      face_share: lowq ? round(0.58 + r.next() * 0.1, 2) : round(0.9 + r.next() * 0.08, 2),
      flash_ok: flashOk,
    },
    features: [],
    gaze: [pursuit, saccade],
    traces: {
      blink: trace((x) => (x % 3.1 < 0.12 ? 1 : 0)),
      smile: trace((x) => 0.3 + 0.2 * Math.sin(x)),
      brow: trace((x) => 0.2 + 0.1 * Math.sin(x * 1.7)),
    },
    transcript: [
      { who: "agent", text: `Hello ${first}. This is your weekly check-in. I am software, not a person.`, t: 2 },
      { who: "patient", text: "Yes, I am ready.", t: 8 },
      { who: "agent", text: "Follow the dot with your eyes and keep your head still.", t: 26 },
      { who: "patient", text: "Okay, following it.", t: 30 },
      { who: "agent", text: "Now tell me all the words you remember from the list earlier.", t: 300 },
      { who: "patient", text: "Apple, river, candle, garden, and I think copper.", t: 312 },
      { who: "agent", text: "Thank you. How has your headache been this week, from zero to ten?", t: 430 },
      { who: "patient", text: week > 4 ? "About a two. Much better than it was." : "About a five, worst in the afternoon.", t: 438 },
      { who: "agent", text: "That is everything. Your care team will see today's results.", t: 540 },
    ],
    unusable: false,
  };
}

/** Rewrites the feature table on every check-in from the current forecast. */
function fillFeatures(s: PState) {
  const f = makeForecast(s);
  s.checkins.forEach((c, i) => {
    c.features = f.signals.flatMap<Feature>((sg) => {
      const o = sg.obs.find((x) => x.week === c.week);
      if (!o) return [];
      const seed = SIGNALS.find((x) => x.key === sg.key);
      if (!seed) return [];
      const prevObs = i > 0 ? sg.obs.find((x) => x.week === s.checkins[i - 1].week) : undefined;
      const mdc = round(seed.sd * 1.5, 3);
      const prev = prevObs ? prevObs.value : null;
      return [{
        name: sg.label,
        tier: sg.tier,
        value: o.value,
        prev,
        mdc,
        unit: sg.unit,
        changed: prev != null && Math.abs(o.value - prev) > mdc,
      }];
    });
  });
}

/* ---------------------------------------------------------------- inputs */

const INPUT_SETS: Record<InputFile["kind"], string> = {
  t1: "sets brain anatomy and region boundaries",
  dwi: "sets structural connectivity",
  fmri: "sets the target for functional connectivity fit",
  vcf: "sets priors on recovery rate",
  labs: "sets injury severity prior",
  injury: "sets the impact location and initial damage",
};

const FILE_NAMES: Record<InputFile["kind"], string> = {
  t1: "t1_mprage.nii.gz",
  dwi: "dwi_64dir.nii.gz",
  fmri: "rest_bold.nii.gz",
  vcf: "genotype.vcf.gz",
  labs: "biomarkers.csv",
  injury: "injury_form.json",
};

const KINDS = Object.keys(INPUT_SETS) as InputFile["kind"][];

function makeInputs(kind: Kind): InputFile[] {
  return KINDS.map((k) => {
    const sets = INPUT_SETS[k];
    if (kind === "new") return { kind: k, file: "", synthetic: true, status: "missing", sets };
    if (kind === "template" && k !== "injury" && k !== "labs") {
      return { kind: k, file: "", synthetic: true, status: "missing", sets, note: "Template anatomy and connectome used" };
    }
    if (kind === "lowq" && k === "fmri") {
      return { kind: k, file: `synthetic_${FILE_NAMES[k]}`, synthetic: true, status: "warn", sets, note: "High head motion in 18% of volumes" };
    }
    return { kind: k, file: `synthetic_${FILE_NAMES[k]}`, synthetic: true, status: "ok", sets };
  });
}

/* ---------------------------------------------------------------- patients */

interface Seed {
  name: string;
  age: number;
  sex: "F" | "M";
  week: number;
  kind: Kind;
  helmet: string;
  angle: number;
  mech: string;
  loc: string;
}

const SEEDS: Seed[] = [
  { name: "Avery Lindqvist", age: 24, sex: "F", week: 0, kind: "fresh", helmet: "A", angle: 30, mech: "Cycling fall", loc: "Left frontal" },
  { name: "Jonah Mercer", age: 19, sex: "M", week: 4, kind: "stable", helmet: "B", angle: 15, mech: "Football tackle", loc: "Right temporal" },
  { name: "Priya Nandakumar", age: 31, sex: "F", week: 6, kind: "drifting", helmet: "A", angle: 60, mech: "Ski collision", loc: "Left parietal" },
  { name: "Tomas Reyes", age: 42, sex: "M", week: 3, kind: "redflag", helmet: "None", angle: 75, mech: "Motor vehicle", loc: "Frontal" },
  { name: "Mei Okafor", age: 27, sex: "F", week: 5, kind: "lowq", helmet: "B", angle: 40, mech: "Rugby ruck", loc: "Right frontal" },
  { name: "Dana Whitfield", age: 36, sex: "M", week: 2, kind: "template", helmet: "A", angle: 20, mech: "Fall from ladder", loc: "Occipital" },
];

function makePatient(id: string, seed: Seed, now: number): PState {
  const r = rng(hashStr(id));
  const apoe = (r.next() > 0.72 ? 1 : 0) as 0 | 1 | 2;
  const bdnf = r.next() > 0.6;
  const k = round(0.28 - apoe * 0.05 - (bdnf ? 0.02 : 0) + r.normal() * 0.02, 3);
  const templateOnly = seed.kind === "template";
  const built = seed.kind !== "new";
  const base = now - seed.week * 7 * DAY - 2 * DAY;

  let fcFit: number | null = null;
  if (built && !templateOnly) fcFit = seed.kind === "lowq" ? 0.43 : round(0.58 + r.next() * 0.1, 2);

  const patient: Patient = {
    id,
    name: seed.name,
    age: seed.age,
    sex: seed.sex,
    week: seed.week,
    injury: {
      mechanism: seed.mech,
      helmet: seed.helmet,
      angle_deg: seed.angle,
      location: seed.loc,
      date: new Date(base - DAY).toISOString().slice(0, 10),
      loc: seed.kind === "redflag",
    },
    inputs: makeInputs(seed.kind),
    alleles: { apoe_e4: apoe, bdnf_met: bdnf, comt: r.pick(["Val/Val", "Val/Met", "Met/Met"] as const) },
    biomarkers: { gfap_z: round(1 + r.next() * 1.8, 2), uchl1_z: round(0.6 + r.next() * 1.5, 2) },
    fc_fit: fcFit,
    coverage: 0.8,
    contraction: { k: 0 },
    params: { G: round(1.8 + r.next() * 0.6, 2), k, p: round(0.08 + r.next() * 0.08, 3), eps: round(0.04 + r.next() * 0.03, 3) },
    alerts: [],
    last_call: null,
    twin_built: built,
    template_only: templateOnly,
    low_fidelity: fcFit == null ? built : fcFit < 0.45,
  };

  const s: PState = {
    patient,
    kind: seed.kind,
    drift: seed.kind === "drifting" ? 2.6 : 0,
    severity: round(0.8 + r.next() * 0.3, 3),
    checkins: [],
    messages: [],
    notes: [],
    lastIntervention: null,
  };

  if (built) {
    for (let w = 0; w <= seed.week; w++) {
      if (seed.kind === "template" && w === 1) continue; // one missed call
      s.checkins.push(makeCheckin(s, w, base));
    }
  }

  const first = seed.name.split(" ")[0];
  const t0 = base - DAY / 2;
  s.messages = [
    { dir: "out", body: `Hello ${first}, this is the Synapshot care line. Your clinic set up weekly video check-ins. Reply YES to open the consent page.`, time: new Date(t0).toISOString(), channel: "mock" },
    { dir: "in", body: "YES", time: new Date(t0 + 120000).toISOString(), channel: "mock" },
    { dir: "out", body: "Thank you. Your first call link arrives tomorrow at 10:00. It takes about ten minutes.", time: new Date(t0 + 180000).toISOString(), channel: "mock" },
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
  p.last_call = s.checkins.length ? clone(s.checkins[s.checkins.length - 1]) : null;
}

function flagsOf(s: PState): Flag[] {
  const flags: Flag[] = [];
  if (s.kind === "redflag") flags.push("red_flag");
  if (s.patient.twin_built && s.checkins.length < s.patient.week + 1) flags.push("missed_call");
  if (s.kind === "lowq") flags.push("low_quality");
  if (driftZ(s) > 2) flags.push("drift");
  return flags;
}

const TRIGGERS: Record<Flag, string> = {
  red_flag: "Patient reported worsening headache and repeated vomiting during the call",
  missed_call: "No answer to the scheduled call, two retries",
  low_quality: "Frame rate under 20 fps, calibration error above 1.5 deg, flash test failed",
  drift: "Observed values outside the 80% band on three signals",
  agent_review: "The triage agent escalated this week for review",
};

/* ---------------------------------------------------------------- the store */

let store: DB | null = null;
let alertCounter = 0;

function build(): DB {
  const now = Date.now();
  const patients = SEEDS.map((s, i) => makePatient(`p${i + 1}`, s, now));
  const d: DB = {
    patients,
    alerts: [],
    rig: { status: "idle", since: now, patient_id: null },
    preflightRuns: 0,
    consents: {},
    stretch: {},
    calls: {},
    voices: voiceInventory(),
  };
  for (const s of patients) syncAlerts(d, s);
  return d;
}

function db(): DB {
  if (!store) store = build();
  return store;
}

function syncAlerts(d: DB, s: PState) {
  for (const flag of flagsOf(s)) {
    const open = d.alerts.some((a) => a.patient_id === s.patient.id && a.type === flag && !a.acked);
    if (open) continue;
    alertCounter++;
    d.alerts.unshift({
      id: `a${alertCounter.toString(36)}`,
      patient_id: s.patient.id,
      type: flag,
      trigger: flag === "drift" ? `${TRIGGERS.drift}, drift z ${driftZ(s)}` : TRIGGERS[flag],
      time: new Date().toISOString(),
      called: false,
      acked: false,
    });
  }
  s.patient.alerts = d.alerts.filter((a) => a.patient_id === s.patient.id && !a.acked);
}

function get(id: string): PState {
  const s = db().patients.find((x) => x.patient.id === id);
  if (!s) throw new Error(`No patient ${id}`);
  return s;
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/* ---------------------------------------------------------------- twin */

const twinCache = new Map<string, Twin>();

/** Impact centre in mm for the free-text injury location. */
function impactPoint(loc: string): [number, number, number] {
  const side = loc.startsWith("Right") ? 1 : -1;
  const table: Record<string, [number, number, number]> = {
    frontal: [side * 34, 54, 16],
    temporal: [side * 50, 6, -24],
    parietal: [side * 36, -24, 40],
    occipital: [side * 20, -62, 6],
  };
  const key = Object.keys(table).find((k) => loc.toLowerCase().includes(k)) ?? "frontal";
  return table[key];
}

function makeTwin(s: PState): Twin {
  const p = s.patient;
  const key = `${p.id}:${p.params.k}:${p.params.p}:${p.template_only}:${s.severity}`;
  const hit = twinCache.get(key);
  if (hit) return hit;

  const r = rng(hashStr(`${p.id}:twin`));
  const geo = rng(hashStr("twin-geometry"));
  const impact = impactPoint(p.injury.location);
  const spread = 900 + p.injury.angle_deg * 14;
  const { k, p: perm } = p.params;

  const regions: Region[] = ATLAS.map((a) => {
    const [x, y, z] = a.mm;
    const d2 = (x - impact[0]) ** 2 + (y - impact[1]) ** 2 + (z - impact[2]) ** 2;
    const d0 = clamp(s.severity * Math.exp(-d2 / spread) + r.next() * 0.04, 0, 1);
    const templateEi = round(1 + geo.normal() * 0.15, 3);
    // retain is the weekly retained-damage factor, exp(-k), which drives the decay.
    // recovery is a different thing: this patient's k over the population mean k, so
    // above 1 means healing faster than typical. The backend has one global k, so this
    // value is the same for every region of a patient and the healing layer is flat.
    // That is an honest limit of the model, not a gap in the mock. See web/DECISIONS.md.
    const retain = Math.exp(-k);
    const recovery = round(k / POP_K, 3);
    const damage = WEEKS.map((w) => round(d0 * (perm + (1 - perm) * retain ** w), 3));
    const width = (0.06 + 0.1 * d0) * (p.template_only ? 1.5 : 1);
    return {
      id: a.id,
      name: a.name,
      hemi: a.hemi,
      x: round(x, 2),
      y: round(y, 2),
      z: round(z, 2),
      ei: round(templateEi + r.normal() * 0.08, 3),
      template_ei: templateEi,
      damage,
      // Activity matches the backend scale: a standardized deviation from the healthy
      // firing rate, so 0 is healthy and negative is firing below normal.
      activity: WEEKS.map((w) => round(-4.0 * d0 * retain ** w + geo.normal() * 0.15, 3)),
      damage_lo: damage.map((v) => round(clamp(v - width, 0, 1), 3)),
      damage_hi: damage.map((v) => round(clamp(v + width, 0, 1), 3)),
      recovery,
      network: a.network,
    };
  });

  const edges: Edge[] = [];
  const seen = new Set<string>();
  let guard = 0;
  while (edges.length < 200 && guard < 20000) {
    guard++;
    const a = Math.floor(geo.next() * 100);
    let b = Math.floor(geo.next() * 100);
    if (geo.next() < 0.7) {
      // Prefer a near neighbour so the edge set looks like a connectome, not a hairball.
      let best = -1;
      let bestD = Infinity;
      for (let tries = 0; tries < 8; tries++) {
        const c = Math.floor(geo.next() * 100);
        if (c === a) continue;
        const d = (regions[a].x - regions[c].x) ** 2 + (regions[a].y - regions[c].y) ** 2 + (regions[a].z - regions[c].z) ** 2;
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      b = best;
    }
    if (a === b || b < 0) continue;
    const pair = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (seen.has(pair)) continue;
    seen.add(pair);
    const templateW = round(0.3 + geo.next() * 0.7, 3);
    const d0 = clamp(Math.max(regions[a].damage[0], regions[b].damage[0]) * (0.7 + r.next() * 0.5), 0, 1);
    const retain = Math.exp(-k);
    edges.push({
      a,
      b,
      template_w: templateW,
      personal_w: p.template_only ? templateW : round(Math.max(0.05, templateW + r.normal() * 0.18), 3),
      damage: WEEKS.map((w) => round(d0 * (perm + (1 - perm) * retain ** w), 3)),
    });
  }

  const now = clamp(p.week, 0, 12);
  const topTracts = [...edges]
    .sort((x, y) => y.damage[0] - x.damage[0])
    .slice(0, 8)
    .map((e) => ({ name: `${regions[e.a].name} to ${regions[e.b].name}`, damage_w0: e.damage[0], damage_now: e.damage[now] }));

  const twin: Twin = { weeks: WEEKS, regions, edges, top_tracts: topTracts };
  twinCache.set(key, twin);
  return twin;
}

/* ---------------------------------------------------------------- shape, receptors, what-if */

const shapeCache = new Map<string, Shape>();

function makeShape(s: PState): Shape {
  const p = s.patient;
  const key = `${p.id}:${s.severity}:${p.week}`;
  const hit = shapeCache.get(key);
  if (hit) return hit;

  const r = rng(hashStr(`${p.id}:shape`));
  const mesh = proceduralMesh();
  const point = impactPoint(p.injury.location);
  const vertexCount = mesh.labels.length;
  const atrophy = round(0.012 + s.severity * 0.03 + (p.age / 100) * 0.02, 4);
  const radius = round(16 + p.injury.angle_deg * 0.18, 2);
  const peak = round(2.2 + s.severity * 2.6, 2);

  const templateDiff = new Array<number>(vertexCount);
  for (let v = 0; v < vertexCount; v++) {
    const dx = mesh.pial[v * 3] - point[0];
    const dy = mesh.pial[v * 3 + 1] - point[1];
    const dz = mesh.pial[v * 3 + 2] - point[2];
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    templateDiff[v] = round(peak * Math.exp(-(d * d) / (2 * radius * radius)) + Math.abs(r.normal()) * 0.12, 3);
  }

  const shape: Shape = {
    scale: [round(1 - atrophy * 0.6, 4), round(1 - atrophy, 4), round(1 - atrophy * 0.8, 4)],
    atrophy,
    thick_z: ATLAS.map((a) => {
      const d2 = (a.mm[0] - point[0]) ** 2 + (a.mm[1] - point[1]) ** 2 + (a.mm[2] - point[2]) ** 2;
      return round(-2.2 * Math.exp(-d2 / 2600) * s.severity + r.normal() * 0.35, 2);
    }),
    impact: {
      vertex: nearestVertex(point),
      point,
      radius,
      // Swelling peaks in the first week, then settles.
      amp: WEEKS.map((w) => round(peak * Math.exp(-((w - 0.6) ** 2) / 4.5), 3)),
    },
    template_diff: templateDiff,
    source: "synthetic",
  };
  shapeCache.set(key, shape);
  return shape;
}

// Exactly the five the backend serves, spelled the way it spells them, so the what-if
// target picker sends a name the intervention route recognises.
const RECEPTOR_NAMES = ["GABA-A", "NMDA", "D2", "5-HT2A", "mu-opioid"];

function makeReceptors(): Receptors {
  const maps: Record<string, number[]> = {};
  RECEPTOR_NAMES.forEach((name, i) => {
    const r = rng(hashStr(`receptor:${name}`));
    maps[name] = ATLAS.map((a) => {
      const gradient = Math.sin(a.mm[1] / 70 + i) * 0.8 + Math.cos(a.mm[2] / 50) * 0.4;
      return round(gradient + r.normal() * 0.5, 3);
    });
  });
  return { names: RECEPTOR_NAMES, maps, synthetic_template: true };
}

const WHATIF_NOTE =
  "Hypothetical what-if from the model only. This is not a treatment plan, not a prescription, and not advice about any medicine.";

function makeIntervention(s: PState, target: string, gain: number): Intervention {
  const receptors = makeReceptors();
  const map = receptors.maps[target] ?? receptors.maps[RECEPTOR_NAMES[0]];
  const twin = makeTwin(s);
  const week = clamp(s.patient.week, 0, 12);
  const effect = map.map((z, i) => round(z * gain * (1 - twin.regions[i].damage[week] * 0.5), 4));
  const mean = effect.reduce((a, b) => a + b, 0) / effect.length;
  const result: Intervention = {
    target,
    region_effect: effect,
    summary_delta: {
      fc_strength: round(mean * 0.42, 4),
      rate: round(mean * 1.1, 4),
      metastability: round(-mean * 0.18, 4),
    },
    note: WHATIF_NOTE,
  };
  s.lastIntervention = result;
  return result;
}

function makeLoadings(): Loadings {
  const weights: Record<string, number[]> = {};
  for (const d of SIGNALS) {
    const r = rng(hashStr(`loading:${d.key}`));
    const raw = ATLAS.map((a) => {
      const affinity = d.group === "eyes" && a.network === "DorsAttn" ? 2.4
        : d.group === "speech" && a.lobe === "Temporal lobe" ? 2.2
        : d.group === "memory" && a.lobe === "Medial temporal" ? 2.6
        : d.group === "symptoms" && a.network === "SalVentAttn" ? 2.1
        : 0.4;
      return Math.max(0, affinity + r.normal() * 0.3);
    });
    const total = raw.reduce((a, b) => a + b, 0);
    weights[d.key] = raw.map((v) => round(v / total, 5));
  }
  return {
    signals: SIGNALS.map((d) => d.key),
    note: "Hypothesis from model sensitivity, behind the REGIONAL_LOADINGS flag. Not a measured cause.",
    weights,
  };
}

/* ---------------------------------------------------------------- the web call */

function tokenFor(patientId: string): string {
  const r = rng(hashStr(`${patientId}:${Object.keys(db().calls).length}`));
  return Array.from({ length: 10 }, () => "abcdefghjkmnpqrstuvwxyz23456789"[Math.floor(r.next() * 31)]).join("");
}

function callOf(token: string): CallRecord {
  const d = db();
  let rec = d.calls[token];
  if (!rec) {
    // Any token resolves in mock mode so a pasted link always opens.
    rec = { token, patient_id: d.patients[0].patient.id, created: Date.now(), state: "waiting", finishedAt: null, frames: 0, skipped: [] };
    d.calls[token] = rec;
  }
  return rec;
}

/* ---------------------------------------------------------------- public mock api */

export const mock = {
  health: () => ({ ok: true, mode: "mock" as const }),

  patients: (): PatientRow[] =>
    db().patients.map((s) => ({
      id: s.patient.id,
      name: s.patient.name,
      week: s.patient.week,
      drift_z: driftZ(s),
      last_call: s.checkins.length ? s.checkins[s.checkins.length - 1].date : null,
      flags: flagsOf(s),
      synthetic: true,
    })),

  createPatient: (b: { name: string; age: number; sex: "F" | "M" }): Patient => {
    const d = db();
    const id = `p${d.patients.length + 1}`;
    const s = makePatient(id, { ...b, week: 0, kind: "new", helmet: "A", angle: 30, mech: "Not set", loc: "Left frontal" }, Date.now());
    d.patients.push(s);
    return clone(s.patient);
  },

  patient: (id: string): Patient => {
    const s = get(id);
    syncAlerts(db(), s);
    return clone(s.patient);
  },

  forecast: (id: string) => makeForecast(get(id)),
  twin: (id: string) => clone(makeTwin(get(id))),
  mesh: (): Mesh => proceduralMesh(),
  shape: (id: string) => makeShape(get(id)),
  receptors: () => makeReceptors(),
  loadings: () => makeLoadings(),
  intervention: (id: string, b: { target: string; gain: number }) => makeIntervention(get(id), b.target, b.gain),

  scenarios: (id: string, b: { a: Scenario; b: Scenario }): ScenarioResult => {
    const s = get(id);
    const sevOf = (sc: Scenario) =>
      s.severity *
      (sc.helmet === "B" ? 0.8 : sc.helmet === "None" ? 1.25 : 1) *
      (0.8 + 0.4 * Math.sin((sc.angle_deg * Math.PI) / 180));
    const sa = sevOf(b.a);
    const sb = sevOf(b.b);
    const diff: ScenarioResult["diff"] = [];
    if (b.a.helmet !== b.b.helmet) diff.push({ param: "Helmet", a: b.a.helmet, b: b.b.helmet });
    if (b.a.angle_deg !== b.b.angle_deg) diff.push({ param: "Impact angle", a: `${b.a.angle_deg} deg`, b: `${b.b.angle_deg} deg` });
    if (Math.abs(sa - sb) > 1e-6) {
      diff.push({ param: "Initial damage scale", a: sa.toFixed(2), b: sb.toFixed(2) });
      diff.push({ param: "Peak tract damage", a: (sa * 0.92).toFixed(2), b: (sb * 0.92).toFixed(2) });
    }
    return { a: makeForecast(s, { severity: sa, withObs: false }), b: makeForecast(s, { severity: sb, withObs: false }), diff };
  },

  counterfactual: (id: string, b: { k_mult: number; p_add: number }) =>
    makeForecast(get(id), { kMult: b.k_mult, pAdd: b.p_add, withObs: false }),

  attribution: (id: string): Attribution[] => {
    const s = get(id);
    const twin = makeTwin(s);
    const r = rng(hashStr(`${id}:attr`));
    return SIGNALS.map((sg, i) => ({
      signal: sg.label,
      tracts: [0, 1, 2].map((j) => ({
        name: twin.top_tracts[(i + j * 3) % twin.top_tracts.length].name,
        score: round(0.72 - j * 0.18 + r.next() * 0.08, 2),
      })),
      note: "Hypothesis from model sensitivity, not a measured cause.",
    }));
  },

  checkins: (id: string): Checkin[] =>
    clone(get(id).checkins)
      .reverse()
      .map((c) => ({ ...c, gaze: [], traces: undefined })),

  checkin: (cid: string): Checkin => {
    for (const s of db().patients) {
      const c = s.checkins.find((x) => x.id === cid);
      if (c) return clone(c);
    }
    throw new Error(`No check-in ${cid}`);
  },

  rescore: (cid: string, task: string) => {
    for (const s of db().patients) {
      const c = s.checkins.find((x) => x.id === cid);
      if (!c) continue;
      if (!c.steps.includes(task)) c.steps = [...c.steps, task];
      refresh(s);
      return { ok: true };
    }
    throw new Error(`No check-in ${cid}`);
  },

  unusable: (cid: string) => {
    for (const s of db().patients) {
      const c = s.checkins.find((x) => x.id === cid);
      if (!c) continue;
      c.unusable = !c.unusable;
      refresh(s);
      syncAlerts(db(), s);
      return { ok: true };
    }
    throw new Error(`No check-in ${cid}`);
  },

  upload: (id: string, kind: InputFile["kind"] | null, fileName?: string, remove?: boolean): InputFile[] => {
    const s = get(id);
    s.patient.inputs = s.patient.inputs.map((f) => {
      if (kind === null) {
        return { kind: f.kind, file: `synthetic_${FILE_NAMES[f.kind]}`, synthetic: true, status: "ok", sets: f.sets };
      }
      if (f.kind !== kind) return f;
      if (remove) return { kind: f.kind, file: "", synthetic: true, status: "missing", sets: f.sets };
      const lower = (fileName ?? "").toLowerCase();
      const allowed: Record<InputFile["kind"], string[]> = {
        t1: [".nii", ".nii.gz", ".dcm", ".zip"],
        dwi: [".nii", ".nii.gz", ".zip"],
        fmri: [".nii", ".nii.gz", ".zip"],
        vcf: [".vcf", ".vcf.gz"],
        labs: [".csv"],
        injury: [".json"],
      };
      const ok = allowed[f.kind].some((ext) => lower.endsWith(ext));
      return {
        kind: f.kind,
        file: fileName ?? "upload",
        synthetic: false,
        status: ok ? "ok" : "warn",
        sets: f.sets,
        ...(ok ? {} : { note: "Unexpected file type, the backend will still try to read it" }),
      };
    });
    return clone(s.patient.inputs);
  },

  setInjury: (id: string, injury: Partial<Patient["injury"]>) => {
    const s = get(id);
    s.patient.injury = { ...s.patient.injury, ...injury };
    twinCache.clear();
    shapeCache.clear();
  },

  twinInputs: (id: string) => {
    const p = get(id).patient;
    return { inputs: clone(p.inputs), fc_fit: p.fc_fit, low_fidelity: p.low_fidelity };
  },

  buildTwin: (id: string): Patient => {
    const s = get(id);
    const p = s.patient;
    const present = (k: InputFile["kind"]) => p.inputs.some((f) => f.kind === k && f.status !== "missing" && f.status !== "error");
    if (!present("t1") && !present("injury")) {
      throw new Error("Need at least a T1 MRI or an injury form before the twin can be built");
    }
    p.template_only = !present("t1") || !present("dwi");
    const r = rng(hashStr(`${id}:fc:${s.checkins.length}`));
    if (!present("fmri")) {
      p.fc_fit = null;
      p.low_fidelity = true;
    } else {
      p.fc_fit = p.template_only ? round(0.38 + r.next() * 0.06, 2) : round(0.55 + r.next() * 0.12, 2);
      p.low_fidelity = p.fc_fit < 0.45;
    }
    if (present("labs")) s.severity = round(0.7 + p.biomarkers.gfap_z * 0.12, 3);
    if (!p.twin_built) {
      p.twin_built = true;
      if (s.kind === "new") s.kind = "fresh";
      s.checkins = [makeCheckin(s, 0, Date.now() - DAY)];
    }
    refresh(s);
    twinCache.clear();
    shapeCache.clear();
    syncAlerts(db(), s);
    return clone(p);
  },

  messages: (id: string) => clone(get(id).messages),

  note: (id: string, text: string) => {
    get(id).notes.push(text);
    return { ok: true };
  },

  alerts: (patientId?: string) =>
    clone(db().alerts.filter((a) => !patientId || a.patient_id === patientId)).sort(
      (a, b) =>
        Number(b.type === "red_flag") - Number(a.type === "red_flag") ||
        Number(a.acked) - Number(b.acked) ||
        b.time.localeCompare(a.time),
    ),

  ack: (aid: string) => {
    const d = db();
    const a = d.alerts.find((x) => x.id === aid);
    if (a) a.acked = true;
    for (const s of d.patients) s.patient.alerts = d.alerts.filter((x) => x.patient_id === s.patient.id && !x.acked);
    return { ok: true };
  },

  callAlert: (aid: string) => {
    const a = db().alerts.find((x) => x.id === aid);
    if (!a) return { ok: true };
    a.called = true;
    get(a.patient_id).messages.push({
      dir: "out",
      body: "Your clinic is calling you now. Please pick up if you can.",
      time: new Date().toISOString(),
      channel: "mock",
    });
    return { ok: true };
  },

  cohort: (): Cohort => {
    const r = rng(hashStr("cohort"));
    const kTrue = Array.from({ length: 50 }, () => round(0.25 + r.normal() * 0.07, 3));
    return {
      weeks: WEEKS,
      size: 50,
      // Coverage climbs from 0.55 toward the 0.8 target as patients join.
      coverage: WEEKS.map((w) => ({ week: w, cov: round(0.55 + 0.25 * (w / 12) + r.normal() * 0.012, 3) })),
      k_true: kTrue,
      k_est: kTrue.map((k) => round(k + r.normal() * 0.025, 3)),
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
    // Every third run fails one check, so the Re-run button visibly does something.
    const failIndex = d.preflightRuns % 3 === 2 ? r.int(0, 5) : -1;
    const checks: [string, string][] = [
      ["Camera", "1080p capture at 30 fps"],
      ["Call link", "Token signing key loaded, link expiry 24 h"],
      ["Stimulus display", "Second screen at 60 Hz, gamma calibrated"],
      ["Gaze model", "Face landmarker loaded, calibration RMS 0.6 deg on the test video"],
      ["Audio", "Mic and speaker routed, echo cancel on"],
      ["Backend link", "WebSocket round trip 38 ms"],
    ];
    return checks.map(([name, detail], i) =>
      i === failIndex
        ? { name, ok: false, detail: `${detail.split(",")[0]} is not responding. Check the connection and re-run.` }
        : { name, ok: true, detail },
    );
  },

  reset: () => {
    store = build();
    twinCache.clear();
    shapeCache.clear();
    return { ok: true };
  },

  advanceWeek: (patientId: string) => {
    const s = get(patientId);
    const p = s.patient;
    if (!p.twin_built) throw new Error("Build the twin before advancing the week");
    if (p.week >= 12) throw new Error("Already at week 12");
    p.week++;
    const base = new Date(s.checkins[0]?.date ?? Date.now()).getTime();
    s.checkins.push(makeCheckin(s, p.week, base));
    refresh(s);
    twinCache.clear();
    shapeCache.clear();
    s.messages.push({
      dir: "out",
      body: `Week ${p.week} check-in done. Thank you. Your care team has the results and will be in touch if anything needs attention.`,
      time: new Date().toISOString(),
      channel: "mock",
    });
    syncAlerts(db(), s);
    return { ok: true };
  },

  injectDrift: (patientId: string, size: number) => {
    const s = get(patientId);
    s.drift += size;
    refresh(s);
    s.messages.push({
      dir: "out",
      body: "Quick midweek check. How are you feeling today compared with last week? Reply BETTER, SAME, or WORSE.",
      time: new Date().toISOString(),
      channel: "mock",
    });
    syncAlerts(db(), s);
    return { ok: true };
  },

  triggerCall: (patientId: string) => {
    const d = db();
    const s = get(patientId);
    d.rig = { status: "ringing", since: Date.now(), patient_id: patientId };
    s.messages.push({
      dir: "out",
      body: "Heads up, your weekly video check-in starts in a moment.",
      time: new Date().toISOString(),
      channel: "mock",
    });
    return { ok: true };
  },

  rigStatus: (): RigState => {
    const d = db();
    const elapsed = Date.now() - d.rig.since;
    if (d.rig.status === "ringing" && elapsed > 3500) d.rig = { ...d.rig, status: "in_call", since: Date.now() };
    else if (d.rig.status === "in_call" && elapsed > 120000) d.rig = { status: "idle", since: Date.now(), patient_id: null };
    return d.rig;
  },

  consent: (token: string) => {
    const found = db().patients.find((s) => s.patient.id === token);
    return { patient_name: found?.patient.name ?? db().patients[0].patient.name, text: callScript().consent };
  },

  submitConsent: (token: string, body: unknown) => {
    db().consents[token] = body;
    return { ok: true };
  },

  submitStretch: (token: string, body: unknown) => {
    db().stretch[token] = body;
    return { ok: true };
  },

  /* ---- the web call ---- */

  createCall: (patientId: string, send: boolean): CallStart => {
    const d = db();
    const s = get(patientId);
    const token = tokenFor(patientId);
    d.calls[token] = { token, patient_id: patientId, created: Date.now(), state: "waiting", finishedAt: null, frames: 0, skipped: [] };
    const url = `${typeof window === "undefined" ? "" : window.location.origin}/call/${token}`;
    if (send) {
      s.messages.push({
        dir: "out",
        body: `Time for your weekly check-in. Open this link on your phone: ${url}. It takes about ten minutes and you can stop at any point.`,
        time: new Date().toISOString(),
        channel: "mock",
      });
    }
    return { token, url, expires: new Date(Date.now() + DAY).toISOString() };
  },

  /** Nothing left the machine in mock mode, and the reply says so. */
  sendCall: (token: string): CallSend => {
    const d = db();
    const rec = d.calls[token];
    if (!rec) throw new Error("unknown link");
    const url = `${typeof window === "undefined" ? "" : window.location.origin}/call/${token}`;
    const body = `Time for your weekly check-in. Open this link on your phone: ${url}. It takes about ten minutes and you can stop at any point.`;
    get(rec.patient_id).messages.push({ dir: "out", body, time: new Date().toISOString(), channel: "mock" });
    return { ok: true, channel: "mock", to: "", body, error: "" };
  },

  callScript: (): CallScript => callScript(),

  callConsent: (token: string, body: unknown) => {
    const rec = callOf(token);
    rec.consent = body;
    rec.state = "in_call";
    return { ok: true };
  },

  // Keyed by red flag key, the same shape the backend reads. Any yes stops the call.
  callRedflags: (token: string, answers: Record<string, boolean>): RedflagResult => {
    const rec = callOf(token);
    const stop = Object.values(answers).some(Boolean);
    if (stop) {
      rec.state = "stopped";
      return {
        stop: true,
        say: "Thank you for telling me. Please stop here and contact your clinic now, or your local emergency number if you feel unsafe. I have let your care team know.",
        audio: "redflag_stop.mp3",
      };
    }
    return { stop: false, say: "Thank you. Those all sound fine. Let us carry on.", audio: "redflag_ok.mp3" };
  },

  // Keyed by symptom name. The short version rule matches the backend: headache or
  // fatigue at 8 or above, or a 10 point jump on the rerate.
  callSymptoms: (token: string, scores: Record<string, number>, phase: "baseline" | "rerate"): SymptomResult => {
    const rec = callOf(token);
    const total = Object.values(scores).reduce((a, b) => a + b, 0);
    const jump = phase === "rerate" && total - (rec.baselineTotal ?? total) >= 10;
    if (phase === "baseline") rec.baselineTotal = total;
    const bad = (scores.headache ?? 0) >= 8 || (scores.fatigue ?? 0) >= 8;
    const short = bad || jump;
    rec.skipped = short ? ["antisaccade", "fixation", "npc", "fluency"] : [];
    return { jump, short, skip: rec.skipped };
  },

  callAnswer: (token: string, task: string, value: number | string[]) => {
    const rec = callOf(token);
    rec.answers = { ...(rec.answers ?? {}), [task]: value };
    return { ok: true, task, stored: Object.keys(rec.answers) };
  },

  callLive: () => ({ ok: true }),

  callFrames: (token: string, count: number) => {
    const rec = callOf(token);
    rec.frames += count;
    return { ok: true, frames: rec.frames };
  },

  callAudio: () => ({ ok: true }),

  callFinish: (token: string, aborted: boolean) => {
    const rec = callOf(token);
    rec.state = aborted ? "stopped" : "processing";
    rec.finishedAt = Date.now();
    rec.call_id = `${rec.patient_id}-live${Object.keys(db().calls).length}`;
    return { ok: true, call_id: rec.call_id };
  },

  callStatus: (token: string): CallStatus => {
    const rec = callOf(token);
    if (rec.state === "processing" && rec.finishedAt && Date.now() - rec.finishedAt > 4000) rec.state = "done";
    if (rec.state !== "done") return { state: rec.state, ...(rec.call_id ? { call_id: rec.call_id } : {}) };
    return {
      state: "done",
      call_id: rec.call_id,
      summary:
        "Thank you, your check-in is complete. Your care team has the results and will contact you if anything needs attention. If you feel worse at any time, call your clinic or your local emergency number.",
    };
  },

  voices: (): Voices => clone(db().voices),

  regenerateVoice: (stepId: string): VoiceLine => {
    const d = db();
    const line = d.voices.lines.find((l) => l.id === stepId);
    if (!line) throw new Error(`No voice line ${stepId}`);
    line.exists = true;
    line.duration_s = round((line.duration_s ?? 2) + 0.05, 2);
    return clone(line);
  },
};

export { NETWORKS, REGION_NAMES, SIGNALS, WEEKS };
