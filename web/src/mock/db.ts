// The seeded mock backend. Every contract shape is produced here with believable values so a
// screen can be built with no backend running. Nothing in this file calls Math.random, so the
// cohort, the charts and the brain are identical on every reload.

import type {
  Alert,
  Attribution,
  CallScript,
  CallStart,
  CallStatus,
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
// Type-only, so there is no runtime cycle with the client that imports this file. The
// annotations matter: without them the mock layer's shapes are inferred and can drift
// away from the contract without anybody noticing until a screen renders undefined.
import type {
  AlertRule,
  DrugEntry,
  DrugImpact,
  Evidence,
  Formulary,
  Percentile,
  Timeline,
  Vessels,
} from "@/api/client";
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
  /** Patients built by the ingest, so a mock-mode Add patient run lands somewhere. */
  ingested: string[];
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
      loc_seconds: seed.kind === "redflag" ? 45 : 0,
      gcs: seed.kind === "redflag" ? 13 : 15,
      days_ago: seed.week * 7 + 2,
      contusion: seed.loc.startsWith("temporal") ? "left temporal" : "right frontal",
      ct_finding: "No acute intracranial haemorrhage, mass effect or midline shift.",
      mri_finding:
        "Small cortical contusion with mild surrounding oedema. Two small foci of susceptibility on SWI.",
      swi_foci: 2,
    },
    chart: {
      occupation: null,
      medications: [
        { name: "ondansetron", dose: "4 mg", status: "current" },
        { name: "acetaminophen", dose: "500 mg", status: "current" },
        { name: "amitriptyline", dose: "10 mg", status: "proposed" },
      ],
      reported_symptoms: ["headache", "fatigue", "light sensitivity"],
    },
    inputs: makeInputs(seed.kind),
    alleles: {
      apoe_e4: apoe,
      bdnf_met: bdnf,
      comt: r.pick(["Val/Val", "Val/Met", "Met/Met"] as const),
      apoe: apoe === 2 ? "e4/e4" : apoe === 1 ? "e3/e4" : "e3/e3",
      bdnf: bdnf ? "Val/Met" : "Val/Val",
    },
    biomarkers: {
      gfap_z: round(1 + r.next() * 1.8, 2),
      uchl1_z: round(0.6 + r.next() * 1.5, 2),
      gfap_pg_ml: round(120 + (1 + r.next() * 1.8) * 60, 1),
      uchl1_pg_ml: round(290 + (0.6 + r.next() * 1.5) * 140, 1),
      nfl_pg_ml: round(12 + r.next() * 6, 1),
    },
    fc_fit: fcFit,
    coverage: 0.8,
    drift_z: seed.kind === "drifting" ? 2.6 : round(r.normal() * 0.5, 2),
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
    ingested: [],
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

  // The rules behind each flag, matching backend/alerts.py so the mock layer cannot
  // show a different threshold from the one the real backend enforces.
  explainAlert: (aid: string): AlertRule => {
    const a = db().alerts.find((x) => x.id === aid);
    const rules: Record<string, { rule: string; detail: string; threshold: number }> = {
      drift: {
        rule: "drift z above 2.0 for two consecutive weeks",
        detail:
          "drift z is the mean standardized residual of the last two weeks, signed so positive means reality is worse than the twin expected. One bad week is noise, two in a row is a trend.",
        threshold: 2.0,
      },
      low_quality: {
        rule: "a face in under 70% of frames, or calibration error above 3 degrees, or the flash timing test failed",
        detail: "the eye measures are deleted rather than reported through a channel that cannot support them.",
        threshold: 0.7,
      },
      red_flag: {
        rule: "any yes on the seven item safety screen",
        detail:
          "the check-in stops before anything is measured and the patient is told to get medical help now. A clinician must confirm this question list before any use outside the team.",
        threshold: 1,
      },
      missed_call: {
        rule: "no completed check-in for the week",
        detail: "no measurements, so the filter has nothing to assimilate and the band widens.",
        threshold: 0,
      },
    };
    if (!a) return { ok: false, id: aid, type: "drift", trigger: "", time: "", ...rules.drift, state: {} };
    const s = get(a.patient_id);
    return {
      ok: true,
      id: a.id,
      type: a.type,
      trigger: a.trigger,
      time: a.time,
      ...(rules[a.type] ?? rules.drift),
      state: { drift_z: s.patient.drift_z, coverage: s.patient.coverage, week: s.patient.week },
    };
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
    const s = get(patientId);
    s.messages.push({
      dir: "out",
      body: "Heads up, your weekly video check-in starts in a moment.",
      time: new Date().toISOString(),
      channel: "mock",
    });
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

  /* ---- v2: vessels, formulary, evidence, timeline, percentile ---- */

  // A handful of vessels so the layer draws something without a backend. The real list
  // is 35; this is the subset that reads as a venous system at a glance, and the caption
  // is the same one, because a schematic is a schematic either way.
  vessels: (): Vessels => ({
    vessels: [
      { name: "Superior sagittal sinus", group: "dural_sinus", radius_mm: 5,
        about: "Midline, along the attached margin of the falx.",
        points: [[0, 72, 18], [0, 54, 52], [0, 14, 76], [0, -34, 72], [0, -80, 12], [0, -84, -4]] },
      { name: "Straight sinus", group: "dural_sinus", radius_mm: 3.5,
        about: "From the great cerebral vein back to the confluence.",
        points: [[0, -32, 28], [0, -48, 16], [0, -66, 4], [0, -84, -4]] },
      { name: "Transverse sinus, right", group: "dural_sinus", radius_mm: 5,
        about: "Usually the larger of the two.",
        points: [[0, -84, -4], [18, -82, -4], [36, -74, -6], [58, -44, -12]] },
      { name: "Transverse sinus, left", group: "dural_sinus", radius_mm: 4.5,
        about: "Laterally in the margin of the tentorium.",
        points: [[0, -84, -4], [-18, -82, -4], [-36, -74, -6], [-58, -44, -12]] },
      { name: "Great cerebral vein of Galen", group: "deep_vein", radius_mm: 2.5,
        about: "Short midline trunk under the splenium.",
        points: [[0, -26, 20], [0, -30, 25], [0, -32, 28]] },
      { name: "Internal cerebral vein, left", group: "deep_vein", radius_mm: 1.6,
        about: "In the roof of the third ventricle.",
        points: [[-4, 6, 18], [-4, -6, 20], [-1, -24, 20]] },
      { name: "Internal cerebral vein, right", group: "deep_vein", radius_mm: 1.6,
        about: "Paired with the left.",
        points: [[4, 6, 18], [4, -6, 20], [1, -24, 20]] },
      { name: "Vein of Trolard, right", group: "cortical_vein", radius_mm: 1.8,
        about: "Superior anastomotic vein, Sylvian fissure up to the sagittal sinus.",
        points: [[56, -22, 12], [42, -26, 48], [10, -24, 72], [0, -22, 76]] },
      { name: "Vein of Labbe, right", group: "cortical_vein", radius_mm: 1.8,
        about: "Inferior anastomotic vein, across the temporal lobe.",
        points: [[56, -20, 8], [56, -48, -2], [50, -58, -6], [56, -46, -11]] },
      { name: "Middle cerebral artery, right", group: "artery", radius_mm: 2,
        about: "Into the Sylvian fissure and over the convexity.",
        points: [[22, 8, -8], [42, 2, 2], [56, -20, 14], [52, -36, 20]] },
    ],
    groups: {
      dural_sinus: { label: "Dural sinuses", colour: "#3b82f6", about: "Venous channels between the layers of the dura." },
      deep_vein: { label: "Deep veins", colour: "#60a5fa", about: "Draining the deep white matter and basal ganglia." },
      cortical_vein: { label: "Cortical veins", colour: "#93c5fd", about: "Surface veins, including the bridging veins that tear in an acceleration injury." },
      artery: { label: "Arteries", colour: "#ef4444", about: "Carotid and vertebrobasilar trunks. Off by default." },
    },
    space: "MNI152 millimetres, same frame as /api/mesh",
    caption: "Schematic vessel layout from anatomical atlases. Not patient-specific.",
    note: "Polylines through anatomical landmarks, at atlas scale. No angiogram went into this.",
  }),

  formulary: (): Formulary => ({
    drugs: [
      { name: "sertraline", class: "SSRI", typical_dose: "25 to 200 mg daily", modeled: true,
        targets: [{ receptor: "5-HTT", affinity: 1, direction: 1, why: "blocks the serotonin transporter" },
                  { receptor: "DAT", affinity: 0.15, direction: 1, why: "weak at higher doses" }],
        note: "Onset over weeks, which this model does not represent.", why_not: "",
        proxy_targets: [], stand_in_targets: [] },
      { name: "amitriptyline", class: "tricyclic antidepressant", typical_dose: "10 to 50 mg at night", modeled: true,
        targets: [{ receptor: "5-HTT", affinity: 0.8, direction: 1, why: "serotonin reuptake inhibition" },
                  { receptor: "NET", affinity: 0.7, direction: 1, why: "noradrenaline reuptake inhibition" },
                  { receptor: "5-HT2A", affinity: 0.6, direction: -1, why: "5-HT2A antagonist" }],
        note: "Its antihistamine and antimuscarinic actions have no map here.", why_not: "",
        proxy_targets: [], stand_in_targets: [] },
      { name: "methylphenidate", class: "stimulant", typical_dose: "5 to 20 mg twice daily", modeled: true,
        targets: [{ receptor: "DAT", affinity: 1, direction: 1, why: "blocks the dopamine transporter" },
                  { receptor: "NET", affinity: 0.6, direction: 1, why: "blocks the noradrenaline transporter" }],
        note: "The striatum is outside this cortical parcellation.", why_not: "",
        proxy_targets: [], stand_in_targets: [] },
      { name: "amantadine", class: "NMDA antagonist and dopaminergic", typical_dose: "100 mg twice daily", modeled: true,
        targets: [{ receptor: "NMDA", affinity: 0.8, direction: -1, why: "weak NMDA antagonist" },
                  { receptor: "DAT", affinity: 0.4, direction: 1, why: "increases dopamine release" }],
        note: "Best studied after severe TBI. Thinner evidence in mild TBI.", why_not: "",
        proxy_targets: [], stand_in_targets: [] },
      { name: "propranolol", class: "beta blocker", typical_dose: "20 to 80 mg twice daily", modeled: true,
        targets: [{ receptor: "NET", affinity: 0.5, direction: -1, proxy: true,
                    why: "no beta-adrenoceptor map exists. NET shows where noradrenergic terminals are." }],
        note: "Shown against a proxy map: treat the location as indicative, the size as uninformative.",
        why_not: "", proxy_targets: ["NET"], stand_in_targets: [] },
      { name: "levetiracetam", class: "antiseizure", typical_dose: "250 to 1000 mg twice daily", modeled: true,
        targets: [{ receptor: "SV2A", affinity: 1, direction: -1, why: "binds SV2A, reducing vesicular release" }],
        note: "SV2A is close to a synaptic density marker.", why_not: "",
        proxy_targets: [], stand_in_targets: [] },
      { name: "ondansetron", class: "antiemetic", typical_dose: "4 to 8 mg as needed", modeled: false, targets: [],
        note: "", why_not: "5-HT3 is its target and there is no 5-HT3 map in this atlas set.",
        proxy_targets: [], stand_in_targets: [] },
      { name: "gabapentin", class: "alpha-2-delta ligand", typical_dose: "300 to 900 mg three times daily", modeled: false, targets: [],
        note: "", why_not: "Its target is a calcium channel subunit. There is no PET map of it.",
        proxy_targets: [], stand_in_targets: [] },
      { name: "melatonin", class: "hormone", typical_dose: "2 to 5 mg at night", modeled: false, targets: [],
        note: "", why_not: "MT1 and MT2 have no map, and the effect that matters is on sleep timing.",
        proxy_targets: [], stand_in_targets: [] },
      { name: "acetaminophen", class: "analgesic", typical_dose: "500 to 1000 mg every 6 hours", modeled: false, targets: [],
        note: "", why_not: "Its mechanism is still argued over and none of the candidates has a receptor map.",
        proxy_targets: [], stand_in_targets: [] },
    ],
    receptors: ["GABA-A", "NMDA", "D1", "D2", "DAT", "NET", "5-HT1A", "5-HT2A", "5-HTT", "SV2A", "mGluR5", "mu-opioid"],
    tracers: {
      "GABA-A": "[11C]flumazenil", NMDA: "[18F]GE-179", D1: "[11C]SCH23390", D2: "[11C]FLB457",
      DAT: "[123I]FP-CIT", NET: "[18F]MeNER", "5-HT1A": "[11C]CUMI-101", "5-HT2A": "[11C]Cimbi-36",
      "5-HTT": "[11C]DASB", SV2A: "[11C]UCB-J", mGluR5: "[11C]ABP688", "mu-opioid": "[11C]carfentanil",
    },
    stand_in: [],
    synthetic_template: false,
    banner: "Hypothetical what-if on a network model. Not a treatment recommendation, not a prediction, and no dose is modelled.",
    note: "Group average PET and SPECT maps from healthy volunteers, parcellated onto Schaefer-100 and z scored.",
  }),

  evidence: (): Evidence => ({
    ok: true,
    claims: [
      { section: "Parcellation and surface", tag: "verified" as const,
        claim: "The cortex is divided into 100 regions using the Schaefer 7-network parcellation.",
        source: "Schaefer et al., Cerebral Cortex 2018;28(9):3095-3114.",
        detail: "The loader refuses the annotation files unless the region names match the connectome's own order." },
      { section: "Network model", tag: "check this" as const,
        claim: "Regional activity is simulated with a dynamic mean field reduction with feedback inhibition control.",
        source: "Deco et al., J Neurosci 2014;34(23):7886-7898.",
        detail: "The constants were written from memory and should be checked against the paper." },
      { section: "Receptor maps and the drug viewer", tag: "verified" as const,
        claim: "The twelve receptor and transporter maps are group-average PET and SPECT images.",
        source: "Hansen et al., Nature Neuroscience 2022;25(11):1569-1581, and the individual tracer studies.",
        detail: "All twelve load from real data." },
      { section: "Biomarkers", tag: "verified" as const,
        claim: "GFAP and UCH-L1 decision cutoffs are 22 and 327 pg/mL.",
        source: "Bazarian et al., Lancet Neurology 2018;17(9):782-789.",
        detail: "These are cutoffs for ruling out injury on CT, not reference intervals." },
      { section: "What the call measures", tag: "verified" as const,
        claim: "Near point of convergence of 5 cm or more discriminates concussed from control.",
        source: "Mucha et al., Am J Sports Med 2014;42(10):2479-2486.",
        detail: "64 concussed patients, preliminary findings, adolescents." },
      { section: "What the call measures", tag: "check this" as const,
        claim: "The seven red flag questions are in the style of the CDC HEADS UP materials.",
        source: "CDC HEADS UP.",
        detail: "This one needs a clinician. Nobody has reviewed this list." },
    ],
    sections: ["Parcellation and surface", "Network model", "Receptor maps and the drug viewer",
               "Biomarkers", "What the call measures"],
    counts: { verified: 4, check_this: 2 },
    numbers: [
      { name: "Forecast band coverage", value: 0.84, target: 0.8, ok: true,
        unit: "share of weeks inside the 80% band",
        say: "The 80% band should contain the truth about 80% of the time. It contains it 84% of the time.",
        caveat: "Measured on synthetic patients generated by the same model family that is fitting them." },
      { name: "Recovery rate recovery", value: 0.72, target: 0.7, ok: true,
        unit: "correlation of true and fitted k over 50 patients",
        say: "Fitted recovery rate correlates 0.72 with the true one.",
        caveat: "Measures whether the filter can invert the simulator." },
      { name: "Population effect: b_e4", value: 0.154, interval: [-0.092, 0.367], target: null, ok: false,
        unit: "posterior mean with 90% interval",
        say: "Estimated +0.154, interval [-0.092, +0.367], which includes zero.",
        caveat: "An interval that includes zero means this covariate is not distinguishable from nothing." },
      { name: "Receptor maps loaded from real data", value: 12, target: 12, ok: true,
        unit: "of 12 targets",
        say: "12 of 12 receptor and transporter maps are real PET or SPECT group averages.",
        caveat: "Group averages from healthy volunteers, not this patient's receptors." },
      { name: "Document extraction accuracy", value: 0.952, target: 0.9, ok: true,
        unit: "20 of 21 fields on the sample pack",
        say: "The built-in extractor reads 20 of 21 fields correctly with no API key.",
        caveat: "Missed: occupation" },
    ],
    weak: ["Population effect: b_e4"],
    limits: [
      "Every patient in this system is synthetic. No real person's data has been used anywhere.",
      "The validation is circular: the population layer recovers parameters from patients generated by the same model that is fitting them.",
      "Nothing here has been shown to predict anything about a person. There is no held-out clinical data.",
      "The drug viewer is a what-if, not advice. No dose and no time course is modelled.",
      "A rendered brain looks like a scan. It is not one.",
      "The measurements come from a phone camera held by a patient, and the quality gates are there because they are often not met.",
      "The brief script trades accuracy for four minutes. Several tasks are absent, not estimated badly.",
      "No clinician has reviewed any of this.",
    ],
    doc: "docs/RESEARCH.md",
    note: "Every claim carries whether anybody checked it. There is no state of this panel that hides a weak result.",
  }),

  timeline: (id: string): Timeline => {
    const s = get(id);
    const events: ReturnType<typeof makeEvent>[] = [];
    function makeEvent(time: string, kind: string, labelText: string, band: string, detail: Record<string, unknown>) {
      return { time, day: time.slice(0, 10), kind, label: labelText, band, id: `${kind}-${time}`, detail };
    }
    for (const c of s.checkins) {
      events.push(makeEvent(c.date, "checkin", c.unusable ? "Check-in, unusable" : "Check-in completed",
        c.unusable ? "warn" : "call",
        { duration_s: c.duration_s, face_share: c.channel.face_share, fps: c.channel.fps,
          flash_ok: c.channel.flash_ok, unusable: c.unusable }));
    }
    for (const a of db().alerts.filter((x) => x.patient_id === id)) {
      events.push(makeEvent(a.time, "alert", `Flag raised: ${a.type.replace(/_/g, " ")}`, "flag",
        { type: a.type, trigger: a.trigger }));
    }
    for (const m of s.messages) {
      events.push(makeEvent(m.time, "message", `Message ${m.dir === "out" ? "out" : "in"} by ${m.channel}`,
        "message", { dir: m.dir, channel: m.channel, body: m.body.slice(0, 300) }));
    }
    events.sort((a, b) => a.time.localeCompare(b.time));

    const byDay = new Map<string, { day: string; bands: string[]; count: number; labels: string[] }>();
    for (const e of events) {
      const got = byDay.get(e.day) ?? { day: e.day, bands: [], count: 0, labels: [] };
      got.count += 1;
      if (!got.bands.includes(e.band)) got.bands.push(e.band);
      if (got.labels.length < 4) got.labels.push(e.label);
      byDay.set(e.day, got);
    }
    const last = s.checkins.length ? s.checkins[s.checkins.length - 1].date : null;
    const due = last ? new Date(new Date(last).getTime() + 7 * 864e5) : null;
    const late = due ? Math.floor((Date.now() - due.getTime()) / 864e5) : 0;
    return {
      events,
      days: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)),
      next_call: {
        due: due ? due.toISOString().slice(0, 19) : null,
        last,
        overdue: late > 0,
        days_late: Math.max(0, late),
        say: due ? `Due ${due.toISOString().slice(0, 10)}${late > 0 ? `, ${late} day${late === 1 ? "" : "s"} overdue` : ""}`
                 : "No check-in yet. The first one sets the baseline.",
      },
      bands: {
        call: "A check-in happened on this day.",
        flag: "A flag was raised on this day.",
        warn: "Something did not complete on this day.",
        note: "A record was added on this day.",
        message: "A message went out on this day.",
      },
    };
  },

  percentile: (id: string): Percentile => {
    const s = get(id);
    const r = rng(hashStr(`${id}:cohort`));
    const ks = Array.from({ length: 50 }, () => clamp(0.25 + r.normal() * 0.07, 0.05, 0.6));
    const k = s.patient.params.k;
    const below = ks.filter((v) => v < k).length;
    const sorted = [...ks].sort((a, b) => a - b);
    const q = (p: number) => round(sorted[Math.floor(p * (sorted.length - 1))], 4);
    const outside = k < sorted[0] ? "below" : k > sorted[sorted.length - 1] ? "above" : "";
    const pct = (below / ks.length) * 100;
    const lo = sorted[0];
    const hi = sorted[sorted.length - 1];
    const bins = 20;
    const histogram = Array.from({ length: bins }, (_, i) => {
      const from = lo + ((hi - lo) * i) / bins;
      const to = lo + ((hi - lo) * (i + 1)) / bins;
      return { from: round(from, 4), to: round(to, 4), count: ks.filter((v) => v >= from && v < to).length };
    });
    return {
      ok: true,
      k: round(k, 4),
      percentile: round(pct, 1),
      outside,
      size: ks.length,
      quartiles: [q(0.25), q(0.5), q(0.75)],
      range: [round(lo, 4), round(hi, 4)],
      histogram,
      say: outside === "below"
        ? "This patient's fitted recovery rate is slower than every patient in the cohort, so there is no percentile to give."
        : outside === "above"
        ? "This patient's fitted recovery rate is faster than every patient in the cohort, so there is no percentile to give."
        : `This patient's fitted recovery rate sits ${pct >= 50 ? "in the faster" : "in the slower"} ${pct >= 75 || pct < 25 ? "quarter" : "half"} of the cohort, at the ${Math.round(pct)}th percentile.`,
      limits: [
        "The cohort is 50 synthetic patients fitted by this same model, so this says where they sit among people the model has seen, not among people.",
        "k is one number for the whole brain. Two patients with the same k can be recovering differently in different regions.",
        "A percentile is not a target. Nothing here says a faster rate is the right outcome for this person.",
      ],
    };
  },

  drugImpact: (id: string, drugs: { name: string }[], gain: number): DrugImpact => {
    const s = get(id);
    const book = mock.formulary().drugs;
    const picked: DrugEntry[] = drugs
      .map((d) => book.find((b) => b.name === d.name))
      .filter((d): d is DrugEntry => d !== undefined && d.modeled);
    const receptors = [...new Set(picked.flatMap((d) => d.targets.map((t) => t.receptor)))];
    if (!picked.length) {
      return { kind: "drugs" as const, ok: true, modeled: false, banner: mock.formulary().banner,
               drugs: [], gain, warnings: [], note: "Hypothetical what-if.",
               say: "Nothing selected that this model can represent." };
    }
    // Per region: the drug's combined receptor weight, scaled, times the gain. Same shape
    // as the backend so the map and the legend read the same either way.
    const r = rng(hashStr(`${id}:${picked.map((d) => d.name).join(",")}:${gain}`));
    const weight = Array.from({ length: REGION_NAMES.length }, (_, i) => {
      let w = 0;
      for (const d of picked) for (const t of d.targets) {
        w += t.affinity * t.direction * Math.sin(i * 0.37 + hashStr(t.receptor) * 0.0013);
      }
      return w;
    });
    const peak = Math.max(...weight.map(Math.abs)) || 1;
    const effect = weight.map((w) => round((w / peak) * gain * 0.4 * (1 - 0.3 * s.severity), 6));
    const half = effect.map(() => round(Math.abs(r.normal()) * 0.004 + 0.0006, 6));
    const lo = effect.map((e, i) => round(e - half[i], 6));
    const hi = effect.map((e, i) => round(e + half[i], 6));
    const unclear = lo.map((v, i) => v <= 0 && hi[i] >= 0);
    const clear = unclear.filter((u) => !u).length;
    const order = effect.map((e, i) => i).filter((i) => !unclear[i])
      .sort((a, b) => Math.abs(effect[b]) - Math.abs(effect[a]));
    return {
      kind: "drugs" as const, ok: true, modeled: true,
      banner: mock.formulary().banner,
      drugs: picked.map((d) => d.name), gain, members: 8, receptors,
      weight: weight.map((w) => round(w / peak, 5)),
      region_effect: effect, lo, hi, unclear, unclear_count: unclear.filter(Boolean).length,
      top_changed: order.slice(0, 8),
      baseline_rate: effect.map(() => round(1.2 + r.normal() * 0.05, 5)),
      summary_delta: { rate: round(effect.reduce((a, b) => a + b, 0) / effect.length, 6), fc_strength: 0.0004, metastability: 0.0004 },
      warnings: picked.flatMap((d) => d.proxy_targets.map((t) => `${d.name}: ${t} is a proxy map, not its own target`)),
      interval_covers: [
        "uncertainty in this patient's current damage, from the filter's own posterior",
        "uncertainty in the affinity weights, which are a judgement call",
        "simulation noise",
      ],
      interval_misses: [
        "the receptor maps are group averages from tens of healthy volunteers, not this patient's receptors",
        "a regional gain perturbation is one way of representing a drug's effect among several",
        "the network model itself may be wrong, which no interval computed inside it can say",
      ],
      synthetic_template: false,
      note: "Hypothetical what-if, not a treatment recommendation. No dose is modelled and no timing is modelled.",
      say: `Inside this model, ${clear} of ${effect.length} regions hold their sign across this patient's posterior, weighted by the ${receptors.join(", ")} ${receptors.length === 1 ? "map" : "maps"}. That is self-consistency, not evidence about the drug.`,
    };
  },

  /* ---- the event stream and the ingest ---- */

  /**
   * One generated measurement tick, shaped exactly like the backend's frame event.
   *
   * The gaze follows the target with a lag and a little noise, which is what smooth
   * pursuit looks like. It is generated, the strip says so, and nothing here is ever
   * stored or scored.
   */
  frameEvent: (patientId: string) => {
    const s = get(patientId);
    const t = Date.now() / 1000;
    const r = rng(Math.floor(t * 5) + hashStr(patientId));
    const tx = 0.5 + 0.3 * Math.sin(t * 2 * Math.PI * 0.4);
    const ty = 0.5 + 0.05 * Math.sin(t * 2 * Math.PI * 0.11);
    // A healthier patient tracks more closely. Gain is the ratio of eye to target speed.
    const gain = Math.max(0.3, Math.min(0.99, 0.92 - 0.12 * s.severity));
    return {
      kind: "frame" as const,
      t,
      step: "pursuit_h",
      gaze: { x: round(0.5 + (tx - 0.5) * gain + r.normal() * 0.012, 4), y: round(ty + r.normal() * 0.01, 4) },
      target: { x: round(tx, 4), y: round(ty, 4) },
      quality: { face: true, dist: true, light: true, fps: round(29 + r.normal() * 1.2, 1) },
      pursuit_gain: round(gain, 3),
      line: null,
    };
  },

  provenance: (id: string) => {
    const s = get(id);
    const d = db();
    if (!d.ingested.includes(id)) {
      return {
        ok: true,
        ingested: false,
        threshold: 0.6,
        fields: {} as Record<string, never>,
        needs_review: [] as string[],
        note:
          "This patient was generated, not read from documents. Every value comes from the synthetic generator.",
      };
    }
    const cite = (file: string, quote: string, confidence: number) => ({
      confidence,
      source_file: file,
      source_quote: quote,
      derived_from: [] as string[],
    });
    return {
      ok: true,
      ingested: true,
      threshold: 0.6,
      fields: {
        name: cite("01_ed_triage_note.pdf", `Patient name:\n${s.patient.name}`, 0.95),
        age: cite("01_ed_triage_note.pdf", `Date of birth:\n2004-03-22  (age ${s.patient.age})`, 0.95),
        gcs: cite("01_ed_triage_note.pdf", "GCS:\n15 (E4 V5 M6)", 0.95),
        gfap_pg_ml: cite("05_serum_biomarkers.pdf", "GFAP\n412.0", 0.95),
        apoe: cite("06_genotyping_report.pdf", "APOE genotype:\ne3/e4", 0.95),
        mri_finding: cite(
          "04_mri_brain_report.pdf",
          "Small right frontal cortical contusion measuring 9 x 6 mm with mild surrounding oedema.",
          0.92,
        ),
      },
      needs_review: ["occupation"],
      note: "Hover a value to see the file and the sentence it was read from.",
    };
  },

  /**
   * The five ingest steps, as an async generator with the same event shapes the backend
   * streams. Pacing matches the real thing so the build log is not a different animation
   * in mock mode.
   */
  ingest: async function* (files: File[]) {
    const names = files.length
      ? files.map((f) => f.name)
      : [
          "01_ed_triage_note.pdf",
          "02_ed_physician_note.pdf",
          "03_ct_head_report.pdf",
          "04_mri_brain_report.pdf",
          "05_serum_biomarkers.pdf",
          "06_genotyping_report.pdf",
          "07_sports_medicine_followup.pdf",
          "08_medication_reconciliation.pdf",
          "09_referral_letter_scan.png",
          "10_symptom_diary_scan.png",
        ];
    const scans = names.filter((n) => n.endsWith(".png")).length;
    const steps: [string, string, string][] = [
      ["read", "Reading the files", `${names.length} of ${names.length} files readable`],
      ["extract", "Pulling out the facts", "21 fields read by the built-in extractor"],
      ["check", "Checking them against the schema", "21 fields kept, 1 needs review"],
      ["twin", "Building the twin", "built on the patient's own inputs"],
      ["forecast", "Fitting the first forecast", "13 weeks with 80 percent bands"],
    ];

    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    for (const [step, say, detail] of steps) {
      yield { kind: "step" as const, step, state: "running" as const, say };
      await wait(620);
      yield {
        kind: "step" as const,
        step,
        state: "done" as const,
        say,
        detail,
        ...(step === "read"
          ? {
              items: names.map((name) => ({
                name,
                kind: name.endsWith(".png") ? "image" : "text",
                ...(name.endsWith(".png") ? { why: "a scan, read as an image" } : {}),
              })),
            }
          : {}),
      };
    }

    // The ingested patient is a real row in the mock store, so the workspace it opens
    // afterwards has a twin, a forecast and a timeline like any other.
    const d = db();
    const s = d.patients[0];
    d.ingested.push(s.patient.id);
    yield {
      kind: "done" as const,
      patient_id: s.patient.id,
      name: s.patient.name,
      fields: 21,
      needs_review: ["occupation"],
      threshold: 0.6,
      how: "template",
      sources: {},
      conflicts: [],
      documents: names.map((name) => ({ name, kind: name.endsWith(".png") ? "image" : "text" })),
      ...(scans ? {} : {}),
    };
  },
};

export { NETWORKS, REGION_NAMES, SIGNALS, WEEKS };
