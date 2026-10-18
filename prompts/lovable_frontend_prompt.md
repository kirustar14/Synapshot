<!-- Split out of CLAUDE_CODE_MASTER_PROMPT.md. The master prompt header wins wherever this file disagrees with it. Read 'Lovable' as 'build it yourself in web/'. -->

# SPEC FILE 4 of 4: every clinician and patient screen, mock data layer, and the shared API contract

# LOVABLE PROMPT: UNNAMED frontend (paste everything below)

Build the complete frontend for UNNAMED in one pass. Do not use Supabase or any backend of your own. Do not ask questions. Build every screen and every reach feature below. Everything must work on built-in mock data first, then switch to my real API by setting one env var.

## What it is
UNNAMED is a personal brain twin for traumatic brain injury. A rig calls the patient on FaceTime every week and measures eye movements, speech, memory, and facial movement. A whole-brain model (the twin) forecasts 12 weeks of recovery with uncertainty bands and recalibrates after each call. Clinicians watch a dashboard. All demo patients are synthetic and must be labeled so. The user is a clinician, plus a hidden rig console and demo console for the presenters.

## Stack
React, TypeScript, Vite, Tailwind, shadcn/ui, React Router, TanStack Query, Zustand, Recharts, three, @react-three/fiber, @react-three/drei. No other UI kits.

## Look and feel
Clean clinical, calm. White and light gray surfaces, deep teal primary (#0f766e), amber for synthetic badges, red only for red flags, soft shadows, 12px radius, Inter font, generous spacing. Left sidebar (Patients, Alerts, Cohort, Rig, Demo) with a top bar showing app name UNNAMED and a small "synthetic data" pill when the API reports mock mode. Desktop first for clinician screens, fully mobile for patient pages. Dark mode toggle. Every number that comes from a model carries a small label "Model output, not a scan" where relevant. No em dashes in any text.

## Data layer (build this first)
- `src/api/types.ts`: paste the contract types from the bottom exactly.
- `src/api/client.ts`: `const API = import.meta.env.VITE_API_URL`. If it is empty or the health call fails, use the mock layer. One function per route in the contract. TanStack Query hooks for each. Poll alerts every 5 s, messages every 2 s, patients every 10 s.
- `src/api/ws.ts`: connect to `${API}/ws/rig` and expose a hook `useRig()`. In mock mode generate RigEvents at 30 fps: a target dot moving as a sine, gaze following with gain 0.8 plus noise, quality lights flickering rarely, a pursuit gain that settles near 0.8, steps cycling through the call script, and transcript lines arriving every few seconds.
- `src/mock/`: a seeded generator that returns every contract shape with believable values. Seed 6 patients: week 0 fresh, week 4 stable, week 6 drifting (reality outside the band), red flag, low quality, template-only (no MRI). Forecasts have 13 weekly points, 80% bands that narrow as weeks pass, observed points landing mostly inside the band. Twin has 100 regions with centroids on a brain-shaped ellipsoid (left and right hemispheres), 200 edges, damage arrays for 13 weeks that decay by recovery. Cohort has 50 patients, coverage rising from 0.55 to 0.8 over 12 weeks, and four effects (c_e4, c_bio, b_e4, b_fe4) with true and estimated values and intervals. Mock mutations (advance week, inject drift, build twin, ack alert, upload) must update the mock store so the UI visibly reacts.
- A global store (Zustand) holds the selected patient, comparison scenarios, and the demo state.

## Screens and routes

### C1 Patients `/`
Table sorted by drift z descending: name, week, drift z (colored bar), last call date, flag chips (red flag, missed call, low quality, drift), synthetic badge. Filter "alerts only". "Add patient" opens a dialog (name, age, sex) that creates a synthetic patient and routes to C0.

### C0 Data upload `/patients/:id/upload`
Six drop zones: T1 MRI, Diffusion MRI, Resting fMRI, Genotype VCF, Blood biomarkers CSV (GFAP and UCH-L1), Injury form (mechanism, helmet A or B, impact angle slider, location, loss of consciousness, date). Each shows a validation status chip (ok, warn, error, missing), a real or synthetic badge, and a line saying what it changes ("sets structural connectivity", "sets priors on recovery rate"). Buttons: Use synthetic patient (fills all zones), Remove file, Build twin. After building, show a result card: FC fit as a big number with a gauge, a "low fidelity" warning chip if flagged, template-only chip if no diffusion MRI, and an input summary. Show a small explainer: DNA only shifts priors on two recovery parameters and the evidence is mixed.

### C2 Patient overview `/patients/:id`
Header with patient facts and badges. Panels: injury summary; inputs used with real or synthetic badges and the FC fit; four small forecast charts grouped by eyes, speech, memory, symptoms, each with the 80% band as a shaded area, the mean line, and observed points with error bars; calibration card (coverage of the 80% band, a sparkline by week, and posterior contraction for recovery rate k as a shrinking-bar visual); active alerts; last call summary. Buttons: Open twin viewer, Open scenario compare, Open call log, Request callback to patient, Add note, Export report (prints a clean one-page PDF via window.print with a print stylesheet). A tier B signal (saccade latency) shows only when the last call had flash_ok true, otherwise a gray "not measured" tile.

### C3 Twin viewer `/patients/:id/twin`
3D brain in react-three-fiber: 100 region spheres at centroids inside a translucent brain-shaped shell, OrbitControls, damped rotation. Top 200 edges as lines with opacity and width by damage. Layer switch: Tract damage, Simulated activity, Regional excitation-inhibition map (from gene expression), Template vs personal connectome difference. Week scrubber 0 to 12 with play and pause; damaged tracts glow then fade as recovery proceeds. Side panel lists the most affected tracts with damage values at week 0 and now. Clicking a region shows its name and values. Always show the label "Model output, not a scan".
Reach: a "Tract attribution" tab listing, for each signal, the top 3 tracts with scores, with a visible "hypothesis" badge. A counterfactual slider panel: recovery rate multiplier (0.5x to 2x) and permanent damage shift, which re-queries the counterfactual route (debounced) and overlays the new forecast as a dashed line on the four charts.

### C4 Scenario compare `/patients/:id/compare`
Split screen. Each side picks a scenario (helmet A or B, impact angle slider). Run button posts to the scenario route. Both sides show the forecast charts and a diff table of parameters that differ. Buttons: Add scenario, Run, Swap sides, Remove. A 3D mini viewer on each side showing week 0 damage.

### C5 Call log `/patients/:id/calls`
List of calls with date, duration, steps completed, channel health (frame rate, calibration error, face share, flash test result). Opening a call shows: feature table with tier chips (A or B), value, previous value, change versus the minimal detectable change (green when within noise, amber when changed), a gaze trace per eye task (target line versus gaze line, Recharts), the transcript with speaker colors, and for reach: blink, smile, and brow traces labeled "exploratory". Buttons: Re-score a task, Mark data unusable, Flag for review.

### C6 Alerts `/alerts`
List with type, trigger values, time, whether the clinic call was made and confirmed. Buttons: Acknowledge, Call patient, Resolve, Open patient. Red flags are pinned to the top with a red left border.

### Cohort `/cohort`
Population view: coverage by week for the whole cohort rising over time (line chart with the 0.8 target line), a scatter of true k versus estimated k with the diagonal, and a parameter recovery table (name, true, estimated, 90% interval, a green check when the true value is inside). Title: "The shared model improves as patients join".

### R1 Rig console `/rig` (presenter view)
Large panel showing the live frame (base64 jpeg from the websocket when present, otherwise a drawn abstract face) with gaze overlay and the target dot. Quality lights (face, distance, light, fps), live pursuit gain, current step, scrolling transcript, channel health. A big status pill: Idle, Ringing, In call, Failed.

### R2 Rig preflight `/rig/preflight`
Checklist of green or red checks from the preflight route with detail text, a Re-run button, and a banner that says "All green" or "Do not start the demo".

### D1 Demo console `/demo`
Large buttons: Advance week, Inject drift (size slider), Trigger call, Reset cohort, Load synthetic patient. Patient picker. A live mini state: week, drift z, last alert. When Trigger call is pressed show a full-width "Phone ringing" animation until the rig reports In call. Keyboard shortcuts for every button. Hidden from the sidebar unless the URL is visited once (store the unlock in localStorage).

### P1 Consent `/consent/:token` (mobile)
One page: patient name, short plain-language text about weekly FaceTime calls, AI disclosure, recording consent, and a separate toggle for genetic data consent (default off, explained). Accept button posts and shows a thank you.

### P2 Phone mock `/phone/:id`
An iPhone-shaped frame showing the iMessage thread (blue and gray bubbles, timestamps) from the messages route, polled every 2 s, auto-scrolling. Used on stage to show consent, heads-up, midweek check, summary, and emergency texts arriving.

### P4 Gait and hearing `/stretch/:token` (mobile)
Gait: 20 second walk test using DeviceMotion accelerometer, count steps, compute cadence and step variability, show a simple result. Hearing: Web Audio tone ladder at 500, 1000, 2000, 4000 Hz stepping down in volume, patient taps "I hear it", store the thresholds. Posts both to the stretch route. Clear instructions and a safety note (stop if dizzy). Works without sensors by offering a manual entry fallback.

## Cross-cutting reach features (all required)
Auth0 login as an optional layer: if `VITE_AUTH0_DOMAIN` and `VITE_AUTH0_CLIENT_ID` are set, wrap the clinician routes in the Auth0 React SDK, otherwise no login. Pupil light reflex card on C2 shown as a disabled "Roadmap" tile. Empty, loading, and error states on every screen. Keyboard accessible, proper aria labels, color is never the only signal. Responsive down to 360px for P pages.

## Behavior rules
- Mock mode shows a banner "Mock data" in the top bar. Real mode hides it.
- Never show a diagnosis, clearance, or medication advice anywhere. Patient-facing text is plain and calm.
- Synthetic badge (amber) on every synthetic patient, file, and chart.
- No em dashes in any copy.
- Make the app deployable as a static site. Document `VITE_API_URL` in the README and in `.env.example`.

## Done means
Every route above renders with mock data, every button does something visible, `VITE_API_URL=http://localhost:8000` switches all data to the real backend without code changes, and the 3D viewer scrubs smoothly at 60 fps with 100 regions and 200 edges.

---
# API CONTRACT (shared with the backend, do not change names)
```ts
type Flag = "red_flag" | "missed_call" | "low_quality" | "drift";
interface PatientRow { id: string; name: string; week: number; drift_z: number; last_call: string | null; flags: Flag[]; synthetic: boolean }
interface InputFile { kind: "t1" | "dwi" | "fmri" | "vcf" | "labs" | "injury"; file: string; synthetic: boolean; status: "ok" | "warn" | "error" | "missing"; sets: string; note?: string }
interface Alert { id: string; patient_id: string; type: Flag; trigger: string; time: string; called: boolean; acked: boolean }
interface Patient { id: string; name: string; age: number; sex: "F" | "M"; week: number;
  injury: { mechanism: string; helmet: string; angle_deg: number; location: string; date: string; loc: boolean };
  inputs: InputFile[];
  alleles: { apoe_e4: 0 | 1 | 2; bdnf_met: boolean; comt: "Val/Val" | "Val/Met" | "Met/Met" };
  biomarkers: { gfap_z: number; uchl1_z: number };
  fc_fit: number | null; coverage: number; contraction: { k: number };
  params: { G: number; k: number; p: number; eps: number };
  alerts: Alert[]; last_call: Checkin | null; twin_built: boolean; template_only: boolean; low_fidelity: boolean }
interface Signal { key: string; label: string; unit: string; group: "eyes" | "speech" | "memory" | "symptoms"; tier: "A" | "B";
  mean: number[]; lo: number[]; hi: number[]; obs: { week: number; value: number; sem: number }[] }
interface Forecast { weeks: number[]; signals: Signal[]; coverage: { week: number; cov: number }[] }
interface Twin { weeks: number[];
  regions: { id: number; name: string; hemi: "L" | "R"; x: number; y: number; z: number; ei: number; template_ei: number; damage: number[]; activity: number[] }[];
  edges: { a: number; b: number; damage: number[]; template_w: number; personal_w: number }[];
  top_tracts: { name: string; damage_w0: number; damage_now: number }[] }
interface Feature { name: string; tier: "A" | "B"; value: number; prev: number | null; mdc: number; unit: string; changed: boolean }
interface Checkin { id: string; patient_id: string; week: number; date: string; duration_s: number; steps: string[];
  channel: { fps: number; calib_err_deg: number; face_share: number; flash_ok: boolean };
  features: Feature[];
  gaze: { task: string; t: number[]; x: number[]; y: number[]; tx: number[]; ty: number[] }[];
  traces?: { blink: { t: number[]; v: number[] }; smile: { t: number[]; v: number[] }; brow: { t: number[]; v: number[] } };
  transcript: { who: "agent" | "patient"; text: string; t: number }[]; unusable: boolean }
interface Scenario { helmet: string; angle_deg: number }
interface ScenarioResult { a: Forecast; b: Forecast; diff: { param: string; a: string; b: string }[] }
interface Message { dir: "out" | "in"; body: string; time: string }
interface Check { name: string; ok: boolean; detail: string }
interface Cohort { weeks: number[]; coverage: { week: number; cov: number }[]; k_true: number[]; k_est: number[];
  effects: { name: string; true: number; est: number; lo: number; hi: number }[]; size: number }
interface Attribution { signal: string; tracts: { name: string; score: number }[]; note: string } // note always says "hypothesis"
type RigEvent = { type: "frame"; gaze: { x: number; y: number }; target: { x: number; y: number };
  quality: { face: boolean; dist: boolean; light: boolean; fps: number };
  pursuit_gain: number | null; step: string; line: { who: "agent" | "patient"; text: string } | null; frame?: string /* base64 jpeg */ }
```
Routes (all under /api, JSON):
- GET /health -> {ok: boolean; mode: "mock" | "live"}
- GET /patients -> PatientRow[]; POST /patients {name, age, sex, synthetic:true} -> Patient
- GET /patients/{id} -> Patient
- GET /patients/{id}/forecast -> Forecast
- GET /patients/{id}/twin -> Twin
- POST /patients/{id}/scenarios {a: Scenario, b: Scenario} -> ScenarioResult
- POST /patients/{id}/counterfactual {k_mult: number, p_add: number} -> Forecast
- GET /patients/{id}/attribution -> Attribution[]
- GET /patients/{id}/checkins -> Checkin[] (without gaze arrays); GET /checkins/{cid} -> Checkin (full)
- POST /checkins/{cid}/rescore {task}; POST /checkins/{cid}/unusable
- POST /patients/{id}/uploads (multipart file with `kind`, or JSON {synthetic:true}) -> InputFile[]
- GET /patients/{id}/twin-inputs -> {inputs: InputFile[]; fc_fit: number | null; low_fidelity: boolean}
- POST /patients/{id}/build-twin -> Patient
- GET /patients/{id}/messages -> Message[]
- POST /patients/{id}/note {text}
- GET /alerts?patient_id= -> Alert[]; POST /alerts/{id}/ack; POST /alerts/{id}/call
- GET /cohort -> Cohort
- GET /rig/preflight -> Check[]
- POST /demo/reset; POST /demo/advance-week {patient_id}; POST /demo/inject-drift {patient_id, size}; POST /demo/trigger-call {patient_id}
- GET /consent/{token} -> {patient_name: string; text: string[]}; POST /consent/{token} {calls: boolean; ai: boolean; recording: boolean; genetic: boolean}
- POST /stretch/{token} {gait?: {cadence: number; variability: number; steps: number}; hearing?: {thresholds: Record<string, number>}}
- WS /ws/rig (RigEvent), WS /ws/stimulus (backend only, the frontend never opens it)
