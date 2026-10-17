# CLAUDE CODE PROMPT: UNNAMED backend, rig, stimulus page (paste everything below)

You are building the whole backend of UNNAMED in one go, at a hackathon, in about 20 hours. Do not ask me questions. Make the call, write it in a DECISIONS.md line, and keep going. Commit after every phase. Everything must run with zero API keys using mock mode, then upgrade itself when keys exist.

## What UNNAMED is
A personal brain twin for traumatic brain injury. A Mac rig calls a patient on FaceTime every week and measures eye movements, speech, memory, and facial movement through the phone camera and microphone. A whole-brain model (the twin) forecasts 12 weeks of recovery with uncertainty bands, then an ensemble Kalman filter updates the twin after each call. Drift alerts go to a clinician. All patient data in the demo is synthetic. A separate frontend (built elsewhere in Lovable) talks to your API using the contract at the bottom. Follow that contract exactly.

## Style rules (strict)
- Python 3.11. Simple code. Plain functions, no classes unless a dataclass or pydantic model is needed. No design patterns, no abstract base classes.
- Short descriptive names (sc, fc, ens, obs, lo, hi, th). Never name a count variable n_something. Use len(x) inline, or loop over the thing.
- Type hints on function signatures only. One-line docstrings. No dead code, no TODO stubs. Every file complete and runnable.
- Put the formula in a comment above the code that implements it, one equation per line, with variables defined.
- No em dashes anywhere, in code, comments, or text.

## Mock switches (all default ON if the key is missing)
MOCK_RIG, MOCK_LLM, MOCK_PHOTON, MOCK_TWILIO in .env. Mock rig replays a recorded or generated session so the whole loop works without a Mac, a phone, or a call. Real modes use the same function signatures.

## Repo layout (create exactly this)
```
unnamed/
  README.md  DECISIONS.md  .env.example  Makefile  requirements.txt
  stimulus/index.html
  rig/ preflight.py call.py audio.py capture.py run_call.py place_call.scpt SETUP.md
  backend/
    app.py config.py db.py models.py seed.py alerts.py demo.py rig_hub.py
    twin/ dmf.py strain.py priors.py surrogate.py forecast.py enkf.py population.py build.py counterfactual.py attribution.py
    data/ synthetic.py upload.py genotype.py templates.py
    features/ quality.py gaze.py pursuit.py saccade.py flash.py antisaccade.py fixation.py blink.py face.py speech.py memory.py fluency.py sem.py pipeline.py
    agent/ script.py dialog.py safety.py llm.py summary.py
    comms/ photon.py clinic_call.py
  tests/
```
Makefile targets: `dev` (uvicorn backend.app:app --reload --port 8000), `seed` (build cohort and demo patients), `test`, `rig` (python rig/run_call.py), `preflight`.

## Phase 1: data and twin core
1. `data/templates.py`: load the Schaefer-100 template structural connectivity (SC), functional connectivity (FC), and BOLD with the `cubnm` package (`cubnm.datasets.load_sc/load_fc/load_bold`, parc schaefer-100). If cubnm is missing or fails, fall back to a symmetric distance-decay matrix over region centroids with the same 100 labels. Load Schaefer-100 region names and centroids with nilearn (fallback: 100 points on an ellipsoid, labeled L/R). Load group gene expression and receptor maps from the ENIGMA Toolbox and neuromaps if installed. Fallback: smooth random maps from a fixed seed, labeled `synthetic_template`. Never crash on a missing optional package.
2. `data/synthetic.py`: `make_patient(seed)` returns a full synthetic patient:
   - SC: template times lognormal noise (sd 0.2) per edge, symmetric.
   - True params drawn from the priors in `twin/priors.py`: G, k, p, eps (strain threshold).
   - Genotype: apoe_e4 count (carrier rate about 25%), bdnf_met bool, comt string, sex, age 16 to 60.
   - Biomarkers: gfap_z and uchl1_z correlated with a latent severity.
   - Injury: mechanism, helmet (A or B), angle_deg, location, date, loc bool.
   - Empirical FC from a DMF run at the true G, hemodynamic forward model (balloon or a simple gamma HRF convolution), plus noise.
   - Writes a BIDS-style folder under `data/synthetic/sub-XXX/` with placeholder NIfTI files (tiny valid files via nibabel), a real minimal VCF with rs429358, rs7412, rs6265, rs4680, `labs/biomarkers.csv`, `injury.json`.
   - Weekly truth: observables for weeks 0 to 12 from the true k, p (see `forecast.py`), with measurement noise from `features/sem.py`.
   - Every record carries `synthetic: true`.
3. `data/genotype.py`: read only the four SNPs from a VCF (plain text parse, gzip ok, no heavy dependency) and return `apoe_e4`, `bdnf_met`, `comt`. APOE e4 from rs429358 and rs7412 (e4 is the allele with rs429358 C and rs7412 C). Discard everything else. Never store the raw file after parsing in live mode.
4. `data/upload.py`: validate files per modality (BIDS names, bval and bvec shape, fMRI TR and length present, four SNPs found, biomarker units stated). Return the `InputFile` list from the contract with a `sets` string saying what each file changes. Accept real multipart uploads and the synthetic shortcut.
5. `twin/dmf.py`: dynamic mean field model (Deco 2014 style) over 100 regions, Euler-Maruyama, vectorized numpy. Use the standard constants (a=270, b=108, d=0.154, gamma=0.641/1000, tau_s=100 ms, w=0.9, J_N=0.2609, I0=0.3, sigma=0.001) and say in DECISIONS.md that they are from memory and should be checked against cubnm. Inputs: sc, G, regional E:I scalar map (one or two scalars times the gene expression map), duration. Output: region firing rates and BOLD via the forward model. Also `fit_G(sc, fc_emp)`: grid search over about 12 values of G, 20 s runs, pick the value that maximizes the Pearson correlation between simulated and empirical FC (upper triangle). Return G and the fit. Cache results on disk by hash.
6. `twin/strain.py`: peak tract-oriented strain per edge from impact (angle_deg, location, helmet, severity). Simple lookup surrogate: strain_ij = base * (1 + cos(angle between impact direction and edge direction)) * helmet factor (B lower than A). Edges are straight lines between centroids. Initial damage D_ij(0) = g(strain_ij, zbio) = sigmoid((strain_ij - eps) / 0.05) * (0.5 + 0.1 * zbio), clipped to [0, 0.95].
7. `twin/priors.py` implements exactly this, one equation per line in comments:
   ```
   log(k_i)   ~ Normal(mu_k + b_e4*e4_i + b_fe4*e4_i*fem_i, s_k^2 + s_bdnf^2*met_i)
   logit(p_i) ~ Normal(mu_p + c_e4*e4_i + c_bio*zbio_i, s_p^2)
   c_e4 ~ Normal(0.15, 0.2^2)    b_e4, b_fe4, c_bio ~ Normal(0, 0.2^2)
   ```
   Defaults: mu_k = log(0.25) per week, mu_p = logit(0.15), s_k = 0.4, s_p = 0.5, s_bdnf = 0.3, eps ~ lognormal around 0.15. Note in comments that the APOE prior is a hypothesis with mixed evidence and that the BDNF term widens variance without a direction.
8. `twin/surrogate.py`: DMF at every week is too slow. Build a 1-D table once at startup (cached): run the DMF at about 15 global damage levels d in [0, 1] (scale all SC edges by 1 - d), 30 s each, and store summaries z(d) = [mean FC, FC std, metastability, mean rate]. Interpolate. `z_of(d)` must be a fast numpy call. In DECISIONS.md say this is a 1-D emulator standing in for sbi, and keep `sbi` as an optional upgrade behind a flag.
9. `twin/forecast.py`:
   ```
   D_ij(t) = D_ij(0) * (p + (1 - p) * exp(-k * t))     t in weeks
   d(t)    = mean over edges of D_ij(t)
   y_s(t)  = base_s + load_s * (z_of(d(t)) summary_index - z_of(0)) / scale + noise
   ```
   Six observables (key, label, unit, group, tier, healthy value, shift at full injury, SEM placeholder): pursuit_gain (0.85, -0.20, 0.04), antisaccade_err (% 15, +25, 6), saccade_latency (ms 200, +40, 15, tier B), speech_rate (syll/s 4.5, -1.0, 0.25), recall_delayed (words of 15, 11, -4, 1.2), symptom_total (0 to 80, 6, +30, 4). Say in DECISIONS.md the SEM values are placeholders until teammates do test-retest, and `features/sem.py` reads them from `data/sem.json` so they are one edit to replace. Produce 12 weeks with 80% bands by sampling 300 members from the current ensemble.
10. `twin/enkf.py`: ensemble Kalman filter, 200 members, state theta = [log k, logit p, log d0_scale]. Stochastic EnKF with perturbed observations, observation noise from SEM, 1.02 covariance inflation, plus an AR(1) discrepancy term per observable (rho 0.5) carried as extra state. Tier B observables are dropped from the update when the flash test failed (`flash_ok` false). Track: one-step-ahead 80% band coverage (computed BEFORE the update), posterior contraction of log k (1 - sd_post / sd_prior), standardized residuals, drift z (mean standardized residual of the last two weeks, signed toward worse).
11. `twin/population.py`: NumPyro hierarchical model across the cohort learning mu_k, mu_p, s_k, s_p, s_bdnf, b_e4, b_fe4, c_e4, c_bio from each patient's posterior (log k, logit p, with their uncertainties) and genotype. NUTS, 500 warmup, 500 samples, small. Output `data/cohort.json` in the `Cohort` contract shape: coverage by week across all patients, k_true vs k_est, and for each effect the true value used by the generator, the estimate, and the 90% interval.
12. `twin/build.py`: `build_twin(patient_id)` does the whole personalization: load inputs, SC, fit G to FC (report `fc_fit`), E:I map, priors from genotype, sex, age, biomarkers, D0 from injury and strain, initial ensemble, initial forecast. Writes params, forecast, twin JSON to the DB. Low fit (r < 0.3) sets a `low_fidelity` flag and widens bands by 1.3x.
13. `twin/counterfactual.py` (reach): forecast with k multiplied by `k_mult` and p shifted by `p_add`, same shape as Forecast. `twin/attribution.py` (reach): for each observable, rank tracts by the effect of zeroing that tract's damage on the observable (finite difference on the emulator), return top 3 with scores. Always label the result "hypothesis" in the text field.

## Phase 2: database, alerts, demo
- `db.py`: sqlite3 with plain SQL. Tables: patients, events, checkins, observations, parameters, forecasts, alerts, consents, messages, uploads, twin_inputs. Helper functions only.
- `alerts.py`: rules over the posterior and drift z. Types: drift (drift_z > 2 for two consecutive weeks), red_flag, missed_call, low_quality (face share < 0.7 or calibration error > 3 degrees). Creating an alert may trigger the clinic call and a Photon text. Each alert stores trigger text, time, called, acked.
- `demo.py`: reset (reseed 6 demo patients and the cohort), advance-week (generate the next week's truth, run a call in mock mode, run the EnKF update, store), inject-drift (add size * SEM-scaled worsening to the next week's truth so reality leaves the band), trigger-call (real rig or mock). Demo patients: one fresh at week 0, one at week 4 stable, one at week 6 drifting, one with a red flag, one low quality, one template-based (no MRI uploaded).
- `seed.py` builds 50 synthetic cohort patients, runs the EnKF over 12 weeks, runs the population layer, writes `cohort.json`. It must finish in under 10 minutes and print the final coverage number and the parameter recovery table.

## Phase 3: measurement pipeline (features/)
Everything runs on timestamped data: every video frame and every stimulus change carries `time.monotonic_ns()` from the Mac clock.
- `quality.py`: per-call gates: face present share, face distance from iris diameter in pixels, brightness, frame rate, 3 test flashes detected. Return pass or fail with a reason. Failing gate blocks eye tasks and logs `low_quality`.
- `face.py`: MediaPipe Face Landmarker (Python, iris landmarks, blendshapes on). Return per-frame landmarks, head pose, blink EAR, and blendshapes.
- `gaze.py`: iris center relative to eye corners gives horizontal and vertical ratios per eye, averaged. 9-point calibration from the stimulus page (agent shows 9 dots, patient looks, 1 s each) fits a degree 2 polynomial from ratios and head pose to normalized screen coordinates. Report calibration error in degrees assuming 30 cm viewing distance and the phone screen size from config. Gaze is relative to the phone screen as shown in the stimulus video.
- `pursuit.py`: tracks target x(t) = A sin(2 pi f t). Regress gaze on target over a lag search of 0 to 800 ms. Gain is the regression slope at the best lag. Do not report lag clinically (it includes call delay), only RMS error after alignment. Run horizontal and vertical.
- `flash.py`: the flash trick. Each saccade trial begins with a one-frame full-screen brightness step in the stimulus video at time T_f. Detect the matching brightness rise in the returned video (mean intensity of the face region, change point against a rolling baseline). If the rise is not detectable in at least 8 of 10 test trials, set `flash_ok` false and tier B is dropped everywhere. Document the test in README under "Run this first".
- `saccade.py` (tier B): latency = T_e - T_f where T_e is the first sample after the target jump where gaze speed exceeds a threshold (30 deg/s equivalent in normalized units), requiring a direction match. Call delay cancels because both events are delayed equally.
- `antisaccade.py` (tier B, reach): 20 trials, target appears left or right, correct response is the opposite side. Report error rate and correct-trial latency.
- `fixation.py`: 10 s hold, report BCEA (bivariate contour ellipse area) and saccadic intrusion count.
- `blink.py` (reach): EAR threshold with hysteresis, blink rate and duration traces.
- `speech.py`: audio from the patient channel. `faster-whisper` for words and timestamps, voice activity detection, `parselmouth` for jitter, shimmer, HNR, CPP, sustained "ah" duration, pa-ta-ka rate by syllable peaks, passage reading rate, `librosa` for spectral extras. Normalize by the patient's own baseline (week 0) and age and sex placeholder norms.
- `memory.py`: 15-word list, immediate and delayed recall with fuzzy matching (rapidfuzz). `fluency.py`: animals in 60 s, count valid unique words with a small built-in animal list plus fuzzy match.
- `sem.py`: reads `data/sem.json` (SEM and minimal detectable change per metric, MDC = 1.96 * sqrt(2) * SEM). `pipeline.py`: given a recorded session (frames, audio, stimulus log), returns the `Feature` list for the contract with tier, previous value, MDC, and a `changed` flag when the change exceeds MDC.
- Rapid number naming: time per card from word timestamps.
- Reach: facial expression traces (smile and brow blendshapes over the picture description task, labeled exploratory), gait and hearing from the texted web page results (see `/api/stretch`), pupil light reflex is roadmap only: write a stub function that raises NotImplementedError with the message "roadmap" and nothing else.

## Phase 4: agent and call script (agent/)
- `script.py`: the 14 minute weekly script as a list of step dicts (id, say, task, minutes, tier): consent and red flag screen 1 min; setup quality gate 1; baseline symptoms (8 items, rate 0 to 10 aloud) 1; memory encoding 1; eye block A (pursuit horizontal and vertical, saccades with flash, symptoms re-rated) 2; eye block B (antisaccade 20 trials, fixation 10 s, near point of convergence, symptoms) 1.5; rapid number naming 1; motor speech (sustained ah, pa-ta-ka, passage) 1.5; picture description 1; verbal fluency 1; delayed recall 0.75; wrap up and summary 1.25. Short version rule: if headache or fatigue is 8 or more, or total symptoms jump in eye block A, skip eye block B, number naming, and fluency.
- `safety.py`: the red flag screen. Questions: worsening headache, repeated vomiting, seizure, increasing confusion, new weakness or numbness, slurred speech, unusual drowsiness. Any yes: stop all tasks, say clear emergency guidance (call emergency services now), create a red_flag alert, send the Photon emergency text, call the clinic. Put a comment at the top: "A clinician must confirm this list before any non-teammate use." The agent never diagnoses, never gives return-to-play or driving clearance, never gives medication advice. Enforce this in code by filtering patient-facing text through a check list, and in the system prompt.
- `llm.py`: Anthropic SDK, model from env `CLAUDE_MODEL` (default `claude-sonnet-5-5`), used for natural phrasing, handling off-script patient answers, and summaries. Mock mode uses templates. Every call has a hard timeout and falls back to the template line.
- `dialog.py`: the state machine that walks the script: speak (TTS to the virtual mic), send a stimulus command over the stimulus websocket, collect audio and frames for the task, call the feature function, store results, move on. Handles "can you repeat that" and pauses.
- `summary.py`: patient summary text for iMessage (plain, no diagnosis, no scores that alarm) and the clinician structured update for the clinic call.

## Phase 5: stimulus page and rig
- `stimulus/index.html`: one canvas page, fullscreen, portrait phone aspect (1080x1920 logical), dark background, no external assets. A websocket to `ws://localhost:8000/ws/stimulus` receives commands: `show` {kind: calib|pursuit_h|pursuit_v|saccade|antisaccade|fixation|npc|digits|picture|blank, params}, `flash`, `avatar` {state: idle|talking}. Draws the target dot, the 9 calibration dots, number cards (own digit cards), a simple calm avatar face whose mouth moves while talking, and the one-frame flash (full white frame for exactly one rendered frame, then logs the frame time back to the server). Page reports its own `performance.now()` mapped to the Mac monotonic clock at load.
- `rig/place_call.scpt`: AppleScript that runs `open facetime://<number>` equivalent and presses the Call button through System Events accessibility scripting. `rig/call.py` wraps it with a manual fallback prompt ("click Call, then press Enter").
- `rig/audio.py`: BlackHole 2ch is the FaceTime mic input (agent voice goes here via sounddevice playback). A second virtual device is the FaceTime output, read by sounddevice into the speech pipeline. Device names from config.
- `rig/capture.py`: capture the FaceTime window region with `mss` at 30 fps (15 fps fallback) into a ring buffer, timestamp every frame with `time.monotonic_ns()`, push JPEG frames at about 5 fps to the rig websocket for the console.
- `rig/preflight.py`: green or red checks that print and also serve `GET /api/rig/preflight`: OBS virtual camera present, BlackHole devices present, Accessibility and Screen Recording permissions, FaceTime window found, MediaPipe loads, Whisper loads, stimulus page reachable, flash test passed, clock stamping works, Do Not Disturb note, Wi-Fi hint. Each check returns name, ok, detail.
- `rig/SETUP.md`: the exact setup list: OBS Browser Source pointing at the stimulus page then Start Virtual Camera, FaceTime camera set to OBS Virtual Camera and mic to BlackHole 2ch, iPhone Microphone Mode Standard, freeze the macOS version, dedicated Apple ID, grant permissions to Terminal or Python, Do Not Disturb, phone hotspot if Wi-Fi stutters, get the friend's consent.
- `rig/run_call.py`: full loop: preflight, place call, wait for answer (audio energy for 2 s or Enter), run `agent/dialog.py`, hang up, run the pipeline, update the twin, create alerts, send the summary. If anything fails after 3 retries, print the failure and fall back to the mock session so the demo continues.
- Mock rig (`MOCK_RIG=1`): replays a generated session through the same websocket events with a synthetic gaze following a sine target at the patient's true gain, a flash, and a scripted transcript.

## Phase 6: comms
- `comms/photon.py`: Photon iMessage agent wrapper with `send(to, body)` and `on_message(handler)`. Read the Photon docs from the hackathon hackpack at runtime if the SDK is installed. If not available or MOCK_PHOTON is on, write to the messages table and let the frontend phone mock show it. Messages: consent request with link, heads-up before the call, midweek symptom check (reply parsed 0 to 10), post-call summary, red flag emergency text. Incoming replies update the DB and, for "STOP", withdraw consent.
- `comms/clinic_call.py`: Twilio outbound call to the clinic number with a TwiML Say of the structured update. Mock logs the script and returns success. Note in README that Twilio trial needs verified numbers.

## Phase 7: API
Implement every route in the contract below with FastAPI. CORS open to all origins. WebSockets: `/ws/rig` (RigEvent JSON, optional base64 `frame`), `/ws/stimulus`. Background tasks for calls. Return the exact field names. Add `GET /api/health` returning `{ok:true, mode:"mock"|"live"}`.

## Phase 8: tests and docs
pytest, all must pass with `make test` in under 3 minutes:
- DMF runs and returns finite values. `fit_G` recovers the true G within 15 percent on 5 synthetic patients.
- EnKF: on the 50-patient cohort, one-step-ahead coverage of the 80% band is between 0.65 and 0.9 by week 8, and posterior contraction of log k is above 0.3 by week 6.
- Population layer recovers the sign of c_bio and has the true c_e4 inside its 90% interval (print a warning, not a failure, if not).
- Genotype parser reads the four SNPs from the synthetic VCF.
- Flash detection finds a step in a synthetic brightness series with added noise at 8 of 10 trials.
- Pursuit gain recovers a known gain within 0.05 on synthetic gaze.
- Safety: any yes on the red flag screen creates an alert and returns the emergency script, and no patient-facing string contains the banned phrases (diagnos, cleared to, return to play, medication dose).
- Contract: every endpoint returns every field named in the contract.
README: setup, `.env` keys, run order, "Run this first" (flash test, 2 hours), the demo script, honest limits (synthetic data, placeholder SEMs, 1-D emulator, APOE prior is a hypothesis). DECISIONS.md: every assumption.

## Reach features (build them all, flagged by a `REACH=1` env default on)
Counterfactual slider endpoint, tract attribution, saccade latency (tier B), antisaccade and fixation, blink and expression traces, gait and hearing stretch endpoints, 50-patient cohort curve, scenario compare (helmet A vs B), template-only patient path, drift injection, clinic call, midweek iMessage symptom check.

## Done means
`make seed && make dev` serves every contract route with seeded demo data in mock mode, `make test` is green, and `python rig/run_call.py` completes a full mock call and updates the twin and the alert list. Print a final checklist of what passed and what fell back to mock.

---
# API CONTRACT (shared with the frontend, do not change names)
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
- GET /health
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
- WS /ws/rig (RigEvent), WS /ws/stimulus
