# DECISIONS

Every call made without asking. Newest phase at the bottom.

## Phase 0: scaffold

- The repo root is this directory, which is already called `UnNamed`. The layout in the
  brief nests everything under `unnamed/`, so a nested `unnamed/unnamed/` would be wrong.
  Paths are otherwise exactly as specified.
- Python 3.11 in `.venv`. The system `python3` here is 3.14, which has no wheels for
  mediapipe or jax, so the Makefile prefers `.venv/bin/python` when it exists.
- Hard requirements are fastapi, uvicorn, pydantic, numpy, scipy, nibabel, rapidfuzz,
  pytest. Everything else is optional and wrapped in a try block with a fallback, so
  `make seed && make dev && make test` works on a bare laptop with no keys.
- `.env` is parsed by a 20 line reader in `config.py` instead of adding python-dotenv.
- Mock switches resolve in this order: explicit `MOCK_X` in the env wins, otherwise the
  switch is ON when the key that mode needs is missing. So an empty `.env` is full mock.
- `data/` holds the sqlite file, the surrogate cache, the synthetic BIDS tree and
  `cohort.json`. All of it is disposable, `make clean` removes it.

## Phase 1: data and twin core

### Templates
- Optional template sources (cubnm, nilearn, ENIGMA, neuromaps) are tried but skipped
  entirely when `OFFLINE=1`, which is the default. A nilearn atlas fetch downloads data,
  and a demo must not block on conference wifi. Set `OFFLINE=0` to use the real atlases.
  The resolved bundle is cached to `data/cache/templates.npz`, and `templates()["source"]`
  always reports which source each piece came from.
- The fallback SC is distance decay times a within-network boost, with homotopic edges,
  thresholded to 20 percent density. The first version was dense and nearly uniform,
  which made the simulated FC structureless, so the modular sparse version is what the
  rest of the pipeline needs to produce an FC pattern at all.
- SC is normalized by the mean row sum of the healthy template, not by its own row sum.
  Per matrix normalization cancels exactly what injury does to the network: scaling every
  edge by (1 - d) and then renormalizing gives back the original matrix.

### DMF
- Constants (a 270, b 108, d 0.154, gamma 0.641/1000, tau_s 100 ms, w 0.9, J_N 0.2609,
  I0 0.3, sigma 0.001) are written from memory and should be checked against cubnm before
  anyone trusts a number that comes out of them.
- Feedback inhibition had to be added. The excitatory only model has two fixed points, a
  near silent one at about 0.8 Hz with almost no gain and a runaway one, with nothing in
  between, so FC had no structure and G had no effect. `fic()` sets J_i analytically so
  every region sits at a target rate. That is the role J_i plays in Deco 2014.
- The target rate is 1.2 Hz, not the 3 Hz usually quoted. Above about 1.4 Hz the single
  population model with analytic inhibition is unstable: the global mode eigenvalue turns
  positive. 1.2 Hz is the top of the stable band.
- dt is 2 ms, recording every 10 ms. Noise is drawn in blocks of 5000 steps because one
  rng call per step dominated the runtime. A 20 s run takes 0.9 s.
- `fit_G` evaluates the model FC analytically from the linear response (Lyapunov) solution
  instead of averaging 20 s Monte Carlo runs. Two reasons. The analytic FC agrees with a
  300 s run at r = 0.93 in pattern, and it takes 23 ms instead of 2 s. More importantly the
  mean FC level of a 20 s run varies by a factor of two across noise seeds, because the
  global mode has a long correlation time, which made G unidentifiable.
- G is identified by the mean FC level, not by the pattern correlation. In this model the
  pattern correlation rises monotonically with G over the whole stable range, so it has no
  peak to find. The level is monotone and smooth, so `fit_G` inverts it by interpolation.
  `fc_fit` reported to the API is still the Pearson correlation of the upper triangles.
- A synthetic patient's empirical FC is the analytic model FC at the true G plus edge noise
  of 0.10, which puts `fc_fit` near 0.6, the range a real whole brain FC fit reaches. The
  generator and the fitter must use the same FC estimator or G comes out biased by about
  0.4, since a 300 s Monte Carlo estimate sits 20 percent above the analytic level and
  converges down only slowly with run length. The BIDS fMRI file still holds a real HRF
  convolved BOLD series. The honest limit this leaves: `fc_fit` tests the pipeline, not
  the model's realism against real data.

### Emulator
- 15 damage levels on a quadratic grid, not a linear one, because the summaries move fast
  over the first 20 percent of damage and barely at all after that.
- The two FC summaries come from the linear response solution and the two dynamic
  summaries (metastability, mean rate) from a 30 s run at each level. Every summary is
  forced monotone in d so a forecast cannot wobble on emulator noise.
- This is a 1-D emulator standing in for simulation based inference. `sbi` is an optional
  upgrade behind `USE_SBI=1`, wired into `surrogate.invert_d`.
- "Full injury" for the observable loads means a mean damage of 0.2, not d = 1. d = 1 means
  every tract in the brain is gone, and scaling against it would put every patient in the
  flat tail of the response.
- `strain.BASE` is 0.07 so that a typical impact lands in the part of the emulator that
  moves. The resulting mean damage across patients runs from 0.05 to 0.30.
- Mean damage is the SC weighted mean over edges, not the plain mean. Two regions with no
  tract between them should not dilute the average.

### Priors and forecast
- G prior is Normal(1.8, 0.35) clipped to [0.6, 3.0], fit over a grid of 12 values on
  [0.8, 3.4]. Those numbers only mean anything relative to the template row sum scale.
- Which emulator summary drives which observable: pursuit gain and delayed recall from mean
  FC, antisaccade errors from metastability, saccade latency and speech rate from mean
  firing rate, symptom total from FC spread. That assignment is a modelling choice, not a
  result.
- Antisaccade errors are tier B alongside saccade latency, because the antisaccade block is
  a reach feature and lives in the eye block that the short version of the call drops.
- The 80% band includes measurement noise as well as parameter spread, because coverage is
  checked against observations and an observation carries its own SEM.

### EnKF
- Inflation of 1.02 is applied to the AR(1) discrepancy block only, not to log k, logit p
  and log d0_scale. Those three are static parameters. Measured on 50 patients: inflating
  everything holds contraction of log k at 0.21 by week 6, inflating only the discrepancy
  reaches 0.32, and coverage is 0.83 either way. The exact Bayesian posterior for the same
  data gives 0.36, so what is left on the table is the linear Gaussian approximation.
- The week 0 baseline call is assimilated, not just weeks 1 onward. It is a real call in the
  demo and it is the most informative week about the initial damage.
- Observation perturbations are centred and rescaled to carry exactly the intended variance.
  At 200 members the uncorrected sample moments cost real spread accuracy.
- Multiple data assimilation cycles per week were tried and dropped: 2 and 4 cycles moved
  contraction by 0.002, which is not worth the code.
- Drift z is signed by the sign of each observable's injury load, so positive always means
  reality is worse than the twin expected.

### Population layer
- The per patient latent log k and logit p are marginalized analytically, since both levels
  are Gaussian, so NUTS samples only the nine population parameters. 500 warmup and 500
  samples over 50 patients takes 6 s.
- Without numpyro it falls back to weighted least squares with a normal approximation per
  effect, same output shape, reported as `how`.
- The cohort is generated with one set of effects drawn once from the hyperpriors with seed
  1 (b_e4 0.069, b_fe4 0.164, c_e4 0.216, c_bio -0.261). The seed is pinned so the
  population layer has a non zero truth to recover: with the default hyperparameters b_e4
  and c_bio are exactly 0 and there is no sign to get right.

### Twin and storage
- Synthetic arrays are regenerated from one integer seed rather than stored, so sqlite
  holds no large blobs. The EnKF ensemble is stored as JSON, about 40 KB per patient.
- The twin JSON goes in the `twin_inputs` payload next to the input file list and the FC
  fit, rather than in a new table.
- Only the 200 most damaged edges go to the frontend. All 4950 edges over 13 weeks is
  64000 numbers per patient and nothing can draw it.
- `build_twin` uses the prior median strain threshold, not the patient's true eps, because
  the twin does not get to know the truth.

## Phase 2: database, alerts, demo

- `comms/photon.py` and `comms/clinic_call.py` are written here rather than in phase 6,
  because `alerts.py` cannot raise an alert without them and a half wired alert module
  would not be runnable.
- Alert routing: red_flag and drift ring the clinic, red_flag, low_quality and missed_call
  text the patient. A low_quality or drift alert is not repeated within one week of the
  last one of the same kind, otherwise the drifting demo patient generates an alert every
  single week and the list becomes useless.
- The drifting demo patient has three worsening weeks, not two. Drift z at week w averages
  the residuals of weeks w-1 and w, so two bumped weeks only push one week's drift z over
  the threshold and the rule needs two consecutive ones.
- Drift injection adds 3 SEM times the size, signed by each observable's load. Three SEM
  is roughly the edge of the 80% band, so size 1.0 lands just outside it.
- `demo.advance_week` can run past week 12: the truth table is extended from the patient's
  true parameters on demand.
- The mock check-in record (features, gaze, traces, transcript) is synthesized in `demo.py`
  for now. Phase 3 and phase 5 route it through the real feature pipeline instead.
- Seeding 50 cohort patients, 12 weeks of EnKF each, the NumPyro population fit and six
  demo patients takes 8 s, against the 10 minute budget.

## Phase 3: measurement pipeline

- A session is a plain dict (frames, stim log, calib dots, flash times, trials, audio,
  answers), so a mock session and a real capture are the same object downstream. The
  generator lives in `features/synth.py`, which is one file more than the brief lists.
  It builds a session from target observable values, so the pipeline has to measure them
  back out and the mock loop is a real test of the pipeline rather than a bypass of it.
- Timestamp convention: test flash times are in session seconds, because the flash block
  runs over the whole session luminance series, while per trial t_f values are in seconds
  from the start of their own task window, because that is what the gaze traces use.
- The calibration fit uses every settled frame on every dot, about 180 rows, not one
  median per dot. Nine rows against ten polynomial terms is underdetermined: it fits
  every dot exactly, reports a calibration error of zero and returns an overfit map that
  inflated pursuit gain to 1.9. With all frames the reported error is about 1.9 degrees
  on a good channel and about 3 degrees on a poor one, which is what it should look like.
- A failed quality gate removes the eye measures from the feature list and from the
  observables, rather than reporting a number measured through a dark or badly calibrated
  channel. The low quality demo patient therefore has three observables, not six.
- Measured against sessions built from known values, over six seeds: pursuit gain bias
  -0.03 with sd 0.03, antisaccade error bias 0.0 with sd 9.8 points, symptom total exact,
  saccade latency bias -17 ms with sd 9.6 ms.
- That -17 ms latency bias is frame quantization: at 30 fps one frame is 33 ms and the
  speed estimate is centred, so onset is found about half a frame early. It is constant
  week to week, so the AR(1) discrepancy term absorbs it and it does not look like drift.
- `antisaccade_err` SEM in data/sem.json is 10, not 6. Twenty trials of a binomial at a
  20 percent error rate carry about 10 points of noise on their own, so a 6 would make
  the filter over confident about a measure that cannot be that precise.
- The word list in `memory.py` is ours, not a licensed one. The animal list in
  `fluency.py` is a built in 150 word list plus fuzzy matching.
- A poor channel also fails the flash test, which is what gives the demo a patient where
  `flash_ok` is false and every tier B measure is dropped.
- `features/face.py` downloads the MediaPipe model once when OFFLINE=0 and otherwise runs
  without it, in which case every frame comes back with face False and the quality gate
  reports the failure instead of the import blowing up.
- Pupil light reflex is `face.pupil_light_reflex`, which raises NotImplementedError with
  the message "roadmap" and does nothing else.

## Phase 4: agent and call script

- `CLAUDE_MODEL` defaults to `claude-sonnet-5`, not the `claude-sonnet-5-5` in the brief.
  That string is not a model that exists and every call would 404. The real ids are
  `claude-sonnet-5` and `claude-opus-5`; switching is one line in `.env`.
- LLM calls use a 6 s hard timeout, no retries, thinking disabled and effort low. This is
  phrasing, not reasoning, and a patient is waiting on the phone. A retry would double the
  wait, so the template line is the better fallback. Timeouts, rate limits, connection
  errors and `stop_reason: refusal` all fall back to the template.
- The patient summary is model-phrased but the safety sentence is appended verbatim
  afterwards. Asked to rephrase the whole message, the model produced a warm, correct
  summary and silently dropped "if anything feels worse, contact your clinician" , which is
  the only part that matters when something is going wrong.
- Every patient facing line passes through `safety.clean`, which replaces any line
  containing diagnos, cleared to, return to play or medication dose with a redirect to the
  clinician. That is enforced in code as well as in the system prompt, so a bad completion
  cannot reach a patient.
- The short version rule fires on headache or fatigue at 8 or more, or a symptom total rise
  of 10 or more during eye block A, and drops eye block B, number naming and fluency. The
  script is also pruned when the flash test fails or the quality gate blocks the eye tasks.
- `dialog.run` takes a `hub` with speak, show, flash_block, collect, listen, wait, session
  and quality_ok. The mock rig and the real rig implement the same methods, so the dialog
  does not know which one it is driving.
- Red flags stop the call before any measurement is taken. No partial data is stored.

## Phase 5: stimulus page and rig

- The stimulus page draws everything in 1080x1920 logical coordinates and scales the canvas
  to the window, so a gaze position in normalized units means the same thing in the capture
  as it does on the page. OBS has to be set to a portrait canvas or the page is letterboxed
  and the patient sees black bars where the targets should be.
- Clock mapping: the server sends `time.monotonic_ns()` once when the page connects and the
  page keeps the offset, so every event the page reports (`shown`, `flashed`) is already on
  the rig's clock. No conversion happens later.
- The one frame flash is a white overlay turned on inside one animation frame and off on the
  next, with the frame time reported back after it is painted. Painting and reporting in the
  same frame would report a time before the pixel was on screen.
- `rig_hub.py` holds the websocket registries plus both hubs. The call loop is sync and the
  sockets are async, so outbound messages are scheduled onto the stored event loop with
  `run_coroutine_threadsafe` and inbound ones land in a deque the call loop polls.
- The mock hub and the live hub implement the same eight methods, and `hub_for` falls back
  from live to mock if the live hub cannot even be constructed. `dialog.run` never knows
  which one it has.
- `hub.listen` takes the prompt as well as the timeout, so the mock can answer the question
  that was actually asked rather than returning a fixed string.
- `run_call.py` treats seven preflight checks as blocking and falls back to the mock session
  after three failed live attempts, so a demo never dies on a missing permission.
- The picture description scene is drawn with canvas primitives rather than loaded, because
  the brief rules out external assets and a Browser Source cannot see local files.
- The accessibility preflight check times out rather than failing when macOS is showing the
  permission dialog, and says so, because that is what actually happens the first time.

## Phase 6: comms

- The Photon SDK is discovered by introspection, not by a hard coded import: four module
  names, four class names, five send method names and four call signatures are tried, and
  `photon.docs()` reports what was actually found. The hackpack version is whatever is
  installed on the day and a wrong method name would mean no texts at all.
- Transport order is SDK, then a plain HTTP POST to `PHOTON_BASE_URL`, then mock. Every
  message is written to the messages table in all three cases, so the phone mock in the
  frontend shows the same thing the patient would have received.
- An incoming reply of exactly STOP withdraws consent on all four axes, logs the event and
  confirms by text. Any other reply has the first 0 to 10 number pulled out of it and
  stored as a midweek symptom score.
- The midweek sweep is due based on the last outbound message rather than a scheduler, so
  it is idempotent and safe to call repeatedly from a cron or by hand.
- The clinic call says the update twice with a pause between, because a human writing it
  down needs it twice.

## Phase 7: API

- CORS is open to all origins with credentials off, which is what the Lovable frontend
  needs and is safe only because every patient in this build is synthetic.
- `GET /patients/{id}/checkins` returns check-ins with `gaze` as an empty list, per the
  contract note, and `GET /checkins/{cid}` returns the full traces. Each trace is thinned
  to at most 600 samples on the way into the database, not on the way out.
- `Patient.last_call` is the full most recent Checkin object, including its gaze traces,
  because the contract types it as `Checkin | null` rather than a summary.
- `POST /checkins/{cid}/rescore` refuses with a 400 when the quality gate blocked the eye
  tasks on that call. The gaze traces are still stored for those calls so the frontend can
  show what was seen, but rescoring one would put back a number that was deliberately not
  reported.
- `rescore` only handles the tasks that can honestly be recomputed from stored gaze:
  pursuit and fixation. Saccade and antisaccade need the per trial flash times, which are
  not in the trace, so asking for those returns a 400 rather than a wrong number.
- `POST /checkins/{cid}/unusable` deletes that week's observations and rebuilds the
  forecast, so marking a call unusable actually removes it from the twin.
- `POST /demo/trigger-call` starts the call on a background thread and returns
  immediately. A call takes 14 minutes on the real rig and no HTTP client should hold a
  connection open for that.
- Gait and hearing from `POST /stretch/{token}` are appended to the latest check-in as
  tier B features rather than getting a new contract field, which keeps the frontend
  contract untouched.
- `GET /cohort` seeds on demand when `cohort.json` is missing, so a fresh clone can serve
  the cohort view without a separate step.
- Two routes return a file or JSON depending on what exists on disk, so they are declared
  with `response_model=None`. FastAPI cannot build a response model from a union of two
  Response classes.

## Phase 8: tests and docs

- 76 tests in 29 s, against the 3 minute budget. `tests/conftest.py` forces every mock
  switch on before `backend.config` is imported, because the config resolves each switch
  once at import time and the test modules import it transitively.
- The test database is separate (`data/test_unnamed.db`) but the cache directory is
  shared on purpose: the template bundle and the emulator table are expensive to build and
  identical for every caller.
- The contract field sets in `tests/test_api.py` are transcribed from the TypeScript by
  hand rather than derived from the pydantic models. Deriving them would let the test and
  the code drift together, which is exactly the failure the test exists to catch.
- `test_rescore_and_unusable` found a real bug: two forecasts written inside the same
  second tied on `order by week desc, time desc`, so a stale forecast could be served
  after a rebuild. Every "latest row" query now breaks the tie on `rowid desc`.
- The fluency fuzzy match cut is 80, not 86. At 86 the recognizer spelling "elefant" was
  thrown away. Checked at 80 against twenty common non-animal words: no false positives.
- The c_e4 interval check prints a warning rather than failing, exactly as the brief asks.
  With 50 patients and a prior centred on 0.15 it sits outside its own 90% interval some
  of the time, and the current cohort seed is one of those times.
- Two classes exist outside the pydantic models and the config dataclass: `MockHub` and
  `LiveHub`. They hold state across eight methods and are interchangeable, which is what a
  class is for. Everything else in the codebase is a plain function.
- `make check` prints the done checklist: 24 passed, 0 failed, 9 running on a fallback,
  with each fallback saying what it would take to make it real.

## Reach features

All twelve are built and on by default. `REACH=0` is wired rather than decorative: the
counterfactual slider, scenario compare, tract attribution, drift injection and the gait
and hearing stretch endpoints return 404, and the antisaccade block and the expression
traces are not measured. The forecast, the twin, the cohort and every core route are
unaffected, and the filter already handles a missing observable, so turning reach off
degrades rather than breaks.

| Reach feature | Where |
|---|---|
| Counterfactual slider | `POST /api/patients/{id}/counterfactual`, `twin/counterfactual.py` |
| Tract attribution | `GET /api/patients/{id}/attribution`, `twin/attribution.py` |
| Saccade latency, tier B | `features/saccade.py`, dropped when `flash_ok` is false |
| Antisaccade and fixation | `features/antisaccade.py`, `features/fixation.py` |
| Blink and expression traces | `features/blink.py`, on every Checkin as `traces` |
| Gait and hearing stretch | `POST /api/stretch/{token}` |
| 50 patient cohort curve | `GET /api/cohort`, `twin/population.py` |
| Scenario compare, helmet A against B | `POST /api/patients/{id}/scenarios` |
| Template only patient path | the sixth demo patient, `build_twin(template_only=True)` |
| Drift injection | `POST /api/demo/inject-drift` |
| Clinic call | `comms/clinic_call.py` |
| Midweek iMessage symptom check | `comms/photon.py`, `run_midweek` |

## Real brain data, replacing the fallbacks

The brief asked for cubnm, nilearn, ENIGMA and neuromaps with fallbacks. The fallbacks
were what actually ran, because `OFFLINE` defaulted to 1. That is now inverted: the real
sources are the default and the fallbacks are the safety net.

- **Regions**: nilearn's Schaefer-100, real MNI centroids and real labels. Turning this on
  exposed a latent off-by-one: nilearn returns 101 labels for 100 parcels, with
  "Background" at index 0, so every region's name and network was shifted one place
  against its centroid. That path had never run before. Labels are now filtered and the
  count asserted.
- **Connectivity**: real HCP diffusion and resting state matrices for Schaefer-100 from
  the ENIGMA toolbox, which is a GitHub install rather than a PyPI one. The matrices are
  only accepted when their own labels match the atlas labels region for region, because a
  silently permuted connectome is worse than an honestly modelled one. A few
  log-transformed SC entries are slightly negative and are clipped to zero.
- **E:I map**: real Allen Human Brain Atlas expression, as the mean z of three excitatory
  markers (GRIN1, GRIA1, SLC17A7) minus three inhibitory ones (GAD1, GABRA1, SLC32A1).
  The expression tables are in the Desikan parcellation, so the map is projected to the
  surface and back down to Schaefer-100 with the toolbox's own conversion. Seventeen
  parcels come back without donor coverage and are filled from the nearest region that
  has it. The resulting gradient is sensory-high and association-low.
- **cubnm** is still not installed. It needs GSL and a compiler, and the ENIGMA matrices
  cover the same need.
- The model was tuned against the modelled template, so swapping in real connectivity was
  re-verified: the working point is still stable (max Jacobian eigenvalue -0.00099), the
  firing rate is still 1.26 Hz, mean FC is still monotone in G so `fit_G` still inverts,
  all 76 tests still pass, and the cohort numbers are unchanged (coverage 0.780 at week 8,
  contraction 0.366). `c_e4` moved inside its 90% interval.
- **The honest benchmark this unlocks**: the model's predicted FC against the real HCP FC
  is r = 0.205 at G = 1.8 with nothing else tuned. `make check` prints it. Published whole
  brain fits reach 0.3 to 0.5 with per subject parameter tuning, so this is the right sign
  and not competitive. Before, no number in the project compared the model to real data at
  all.

---

## Phase 9: the real 3D brain, and the web call

Two interfaces on top of a twin that was already built and tested. Authority order for
this phase was the master prompt header, then spec file 1, then 2, then 3, then 4.

### The cortical surface

- **fsaverage5, 20484 vertices.** `nilearn.datasets.fetch_surf_fsaverage("fsaverage5")`
  gives pial and inflated for both hemispheres at 10242 vertices each, which is the "about
  20k vertices" the viewer is budgeted for. 40960 faces, re-indexed into one mesh.
- **Labels come from the CBIG annotation files, and they were verified rather than
  trusted.** `lh.Schaefer2018_100Parcels_7Networks_order.annot` and the rh one, read with
  `nibabel.freesurfer.read_annot`. The URL was written from memory and then checked: both
  files download, and critically their 100 region names match `templates()["names"]` in
  order, region for region, with the `7Networks_` prefix and all. That equality is what
  makes it safe to paint region 37's damage on the vertices the connectome calls 37. The
  fallback projects the nilearn volume atlas onto the surface with
  `vol_to_surf(interpolation="nearest_most_frequent")`; the last resort is a procedural
  folded ellipsoid flagged `source: "procedural"`.
- **The medial wall takes its neighbour's label.** 1743 vertices (8.5%) are the medial
  wall, which is genuinely not cortex. Leaving them unlabelled puts 1743 holes in the
  hologram, so each takes the label of its nearest labelled vertex. Every vertex therefore
  has a label 0 to 99 and no vertex is -1. The parcellation is approximate there and the
  viewer says so.
- **Region centroids are a vertex, not a mean.** The spec asks for the mean of each
  region's pial vertices. Measured, that mean sits up to 6.17 mm inside a curved parcel,
  which both fails the 5 mm check and leaves tract endpoints floating under the cortex. So
  the centroid is the region's own vertex nearest that mean: exactly on the surface, 0.00
  mm worst case.
- **Two coordinate spaces, on purpose.** `templates()["xyz"]` stays the nilearn MNI volume
  centroids, because the strain model's edge directions, the distance decay fallback and
  the smooth maps were all tuned against them and the cohort numbers rest on them.
  `Twin.regions[].x,y,z` are now the surface centroids, because the only consumer of those
  is the viewer and its tracts have to land on the cortex it draws. The two agree to 3.3 mm
  on average and 8.6 mm at worst. Strain only uses unit edge directions, which are
  translation invariant, so centring the mesh on the origin changes nothing in the model.
- **The inflated surface is centred on its own centroid**, not shifted by the pial offset.
  Each fsaverage5 inflated hemisphere arrives centred on the origin and would occupy the
  same space as its partner, so each slides sideways until its medial face is at x = 0 with
  a 2 mm gap, and then the joined surface is centred. Inflating expands the cortex in place
  instead of sliding the whole brain forward and down.
- **Border flags are 30.3% of vertices and that is correct.** The flag is 1 when any
  neighbouring vertex has a different label, computed from the face adjacency. With 100
  parcels over 20k vertices a parcel averages 205 vertices, so perimeters are a large share
  of the surface. It is still a minority, and the shader draws it thin with a falloff
  rather than as a band.
- **Lobe tags are approximate and labelled so.** One plain English area per region, derived
  from the Schaefer name token: Vis to occipital, SomMot to sensorimotor, DorsAttn_Post to
  parietal, DorsAttn_FEF to frontal, SalVentAttn_FrOperIns to insula, Limbic_TempPole to
  temporal pole, Default_pCunPCC to cingulate, and so on across all 23 tokens. These are
  network parcels, not anatomical ones, so the tag is the lobe the parcel mostly sits in.
  It is a reading aid for the callouts, not an anatomical claim.

### Per person shape

- **The synthetic T1 is an 8 cubed placeholder volume with no segmentation**, so the per
  region thickness z scores are drawn from the patient's seed rather than measured:
  `thick_z_i = Normal(0,1) - 1.5*(damage_i - mean damage)`. The second term is what makes
  the damaged side visibly thinner, so the personalization slider shows something tied to
  the injury instead of pure noise. Illustrative, and said to be on screen.
- **The shader and the backend share one deformation formula.** `shape.deform` in Python
  and the vertex shader run the same four steps in the same order, so `template_diff` is
  the displacement the viewer actually draws rather than a second guess at it.
- **The impact site is the opposite of the strain direction.** `strain.HITS` points from the
  blow into the head, so the surface site is `-dir`, rotated about z by the same obliquity
  angle the strain model uses. The impact vertex is the pial vertex whose direction from the
  head centre best matches it, which keeps the marker and the tract damage from one impact.
- **FreeSurfer uploads are a hook, not a feature.** `shape._freesurfer_base` reads
  `data/uploads/<patient id>/surf/{lh,rh}.pial` when they exist and match the fsaverage5
  vertex count, and sets `source: "freesurfer"`. Nothing in the UI writes to that path, so
  in practice every patient is synthetic. The spec allowed skipping this if it ran past 30
  minutes; the read path was cheap enough to keep, the upload path was not built.

### Per region damage, healing and activity

- **The damage band is the ensemble, not an assumption.** For member m,
  `D_i(t,m) = dreg_i * exp(log d0_scale_m) * (p_m + (1-p_m)*exp(-k_m*t))`, and
  `damage_lo` and `damage_hi` are the 10th and 90th percentiles over the 200 members. That
  is why the band narrows as calls arrive and the filter tightens k and p, and why the
  uncertainty layer is the one place with genuine spatial structure.
- **The healing layer is uniform, and that is a real limit rather than a missing feature.**
  `recovery` is this patient's k over the population mean k (the cohort mean estimate when
  `cohort.json` exists, otherwise the prior median exp(mu_k) = 0.25). The model has exactly
  one global recovery rate, so this number is identical for every region and the layer is
  flat. Regional detail would need a regional k. The viewer says this on the layer.
- **Activity is now a real per region firing rate.** It used to be one global emulator
  summary scaled by region damage, which could not tell where the injury was. Now
  `dmf.rates_at` evaluates the DMF transfer function at the healthy gating value with the
  damaged SC, holding the inhibition that was tuned on the healthy brain, which is one
  matrix product per week instead of a 30 s simulation.
- **Activity is standardized against the deviation field, not the healthy spread.** The
  first attempt z scored against the spread of the healthy rates across regions and
  produced values from -24 to -1. Feedback inhibition pins every healthy region at the same
  1.2 Hz working point by construction, so that spread is numerically zero and dividing by
  it is meaningless. The deviation `r_i(t) - r_healthy_i` is standardized by its own spread
  over the whole region by week block instead. Zero means healthy, negative means firing
  below normal, and the range is about -6 to 0. Measured: week 0 mean -3.54 with a regional
  sd of 0.99, recovering to -0.70 by week 12.

### The receptor what-if

- **Scope**: this is a visualization of receptor weighted gain changes in a whole brain
  model. It is not medication advice and not a treatment recommendation. Medication stays
  out of the agent, out of the patient texts and out of every summary, and three tests
  enforce that: the what-if cannot move the forecast, the filter or the alerts, no summary
  may contain a receptor or drug word, and every patient facing string still passes the
  banned phrase filter.
- **The maps are group averages and are currently a stand-in.** `neuromaps` is not
  installed, so the five maps (GABA-A, NMDA, D2, 5-HT2A, mu-opioid) are smooth random maps
  from a fixed seed and the response carries `synthetic_template: true`. The real path is
  written against the Hansen annotations and parcellates them onto the same Schaefer-100
  atlas the rest of the model uses.
- **Luppi style perturbation**: each region's local recurrent weight is scaled by
  `1 + gain * receptor_z_scaled[region]`, with the receptor map min-max scaled to 0 to 1
  and the gain clamped to -0.5 to 0.5. Both sides are simulated for 20 s with this
  patient's own SC and current damage, so the reported difference is the effect. All five
  targets return a finite per region effect in about 0.7 to 1.3 s.

### Regional loadings, behind REGIONAL_LOADINGS=1

- **The weights are my design assumption, not a result.** Loosely motivated by what each
  task involves and taken from no paper, which is why the API labels them a hypothesis and
  the UI carries that badge. pursuit_gain on DorsAttn and Visual; antisaccade_err on Cont
  and DorsAttn; saccade_latency on DorsAttn and SalVentAttn; speech_rate on SomMot and
  SalVentAttn with the left hemisphere weighted 1.5x; recall_delayed on Default and Limbic;
  symptom_total on Limbic, Default and Cont. Within a signal, a region's weight is also
  multiplied by its structural strength so a hub counts for more than a sliver, and then the
  row is normalized.
- **Each row sums to 1, which is what keeps the forecast calibrated.** A uniformly damaged
  brain gives every signal the same level, so turning the flag on cannot shift the overall
  scale, only separate the signals by the spatial pattern of the injury. Measured on a
  synthetic patient: the scalar d0 was 0.1456 and the six per signal levels came out 0.1440
  to 0.1465.
- **The forecast refactor is numerically identical when the level is a scalar.** `y_of` plus
  `d_of` became `y_signals`, which evaluates each observable at its own damage level. With
  one scalar level that is the same arithmetic in the same order, which is why the 76
  existing tests did not move. The per signal levels live in `state["d0_vec"]`, absent
  unless the flag is on.
- **The loadings were re-verified with the flag on.** All 31 EnKF and API tests pass with
  `REGIONAL_LOADINGS=1`, including the coverage and contraction gates, so no retuning was
  needed. Attribution now gives genuinely different top tracts per signal: pursuit picks a
  visual to visual tract, speech picks a left SomMot to SalVentAttn one, recall picks
  Limbic to Default. Four distinct top tracts across the six signals; the two pairs that
  share one load on overlapping networks, which is honest rather than a bug.

### Why the web call replaced the FaceTime rig, and what was lost

- **What it fixes.** The rig needed OBS, BlackHole, macOS screen and microphone
  permissions, and a second device, and the FaceTime round trip put a variable delay
  between the stimulus and the response. On the phone, the page draws the stimulus and the
  camera records the eye on one clock, so the timing is direct.
- **What was lost, honestly.** The phone physically ringing was the best moment in the demo
  and it is gone; a link arriving is less theatrical. The call lag trick is gone too, and
  with it a property worth having: on FaceTime the flash and the response came back in the
  same returned video, so the delay cancelled exactly and nothing had to be estimated. In
  the browser the camera lag has to be measured and subtracted, which adds its own error.
  Measured cost: the camera lag is recovered within 7 ms of a known 80 ms, and the saccade
  latency within 13.7 ms of its target over eight seeds, against a 20 ms gate.
- **The rig is not deleted.** `CALL_MODE=facetime` runs the old path unchanged, and the
  tests assert both hubs are still importable.

### The web call's own decisions

- **Camera latency, and a gate the FaceTime path never needed.**
  `camera_latency = median over trials of (brightness rise in the frames) - (flash drawn)`.
  Beyond the existing "8 of 10 flashes must come back" rule there is now a spread gate: if
  the per trial standard deviation is above 25 ms the camera is not steady enough to time
  anything, `flash_ok` is false and every tier B measure is dropped.
- **The mock generator's saccades cross over 45 ms.** The first version stepped the gaze
  instantaneously between frames. A step discontinuity makes the numerical velocity
  gradient rise one sample before the movement starts, which biased the recovered latency
  by -27 ms on every seed. A raised cosine crossing over 45 ms, which is what a real 10
  degree saccade takes, brought the bias to +6 ms and the worst error to 13.7 ms.
- **The test flashes are jittered.** Flashes exactly 1500 ms apart all land on the same
  phase of the 30 fps frame grid, which makes the per trial spread exactly zero and leaves
  the 25 ms gate untested. Up to 33 ms of jitter is added, which also dithers the
  quantization and improves the estimate.
- **Trial times are window relative.** Each task's gaze trace starts its clock at that
  task's own first frame, so trial times are measured from the task marker in the stimulus
  log, not from the session start. Getting this wrong silently produced no saccade latency
  and no antisaccade error rate at all rather than a wrong number.
- **The browser reports brow lowering where the rig reported brow raising.** The contract
  sends `brow_down`, stored as `browDownLeft`, and the pipeline reads whichever blendshape
  is present. Both are exploratory, but `brow_mean` therefore means different things on the
  two capture paths and the two are not comparable week to week. Since `CALL_MODE` is global
  and web is the default, no real patient mixes them.
- **One task per screen.** The FaceTime script bundled several tasks into one step because
  one agent spoke them all down a phone line. The page needs one task per screen, so the
  same fourteen minutes is expanded from 12 steps to 19, keeping the order, the tiers and
  the short version rule identical.
- **The consent text changed in exactly one substantive way**: it now says the video never
  leaves the phone and only the measurements are sent, and that the recorded voice is sent
  for the speaking tasks because the measurements need the sound itself. That is the one
  genuine difference in the privacy story.
- **The page never decides a safety outcome.** It posts the seven answers and obeys the
  returned `stop`. A red flag stops the session server side, so frames posted afterwards
  are refused with a 409.
- **Token handling.** 32 random bytes urlsafe, one session each, 24 hours, rate limited per
  token and per address in process. An expired link returns 410 rather than 404 so the page
  can say which it was. Session events record only the last six characters of a token.

### Voices, comms and serving

- **Generation is refused, never substituted.** The banned phrase filter runs before the
  API call, and a line that fails it produces an error in the manifest instead of a quietly
  swapped line. A refusal is visible; a substitution is not.
- **The voice id is resolved, and the swap is announced.** The configured
  `ELEVENLABS_VOICE_ID` was not on the account at all, and a free plan cannot use a library
  voice through the API (HTTP 402). `make voices` now lists the account's usable voices,
  picks a calm premade one, records it in the manifest and prints the id to put in `.env`.
  25 of 45 lines generated before the free quota ran out; the other 20 fall back to the
  browser's own speech synthesis, which is the designed behaviour and what the manifest
  reports.
- **The iMessage call shapes were checked against the installed packages, not guessed.**
  Both SDKs are TypeScript, so the send happens in a Node sidecar. `spectrum-ts` 12.11
  wants `Spectrum({projectId, projectSecret, providers: [imessage.config({})]})` and sends
  through a space resolved from the handle; `imessage.config` is the provider builder and
  the bare `imessage` export is a narrowing function, which is why passing it directly
  fails. Verified by reaching a Spectrum Cloud validation error on a fake project id, which
  means only the credentials were missing. `@photon-ai/imessage-kit` 3.0 takes
  `{to, text}` on `sdk.send` and needs macOS.
- **Credentials go to the sidecar in its environment, never in argv**, because argv is
  visible to anything that can run `ps`. The sidecar redacts any long token from an error
  string before printing it.
- **A channel is never guessed.** `notify()` writes exactly one message row, after the
  channel is known, and only calls it `imessage` when a real iMessage transport reported
  success. Otherwise the row says `sms` or `mock` and the UI repeats that. An earlier
  version let each transport write its own mock row and the thread showed the same summary
  three times.
- **The clinician sentence is appended outside any model's reach.** It goes on in
  `notify.with_close`, after any model has finished with the text, and only if it is not
  already there. A model asked to rephrase the whole message once dropped exactly that
  sentence.
- **The ElevenLabs clinic call is wired but not placed.** The endpoint and body shape were
  read off this account's own convai API, which lists one agent and one Twilio backed
  number, so the ids are real. No outbound call has actually been dialled from here, so
  that path is untested end to end and falls back to Twilio and then to mock.
- **cloudflared over ngrok.** The free ngrok tier shows an interstitial warning page on the
  first visit from each browser. A patient who was told to tap a link and follow
  instructions should not meet a warning page first. `make tunnel` prints the cloudflared
  steps and says why.
- **CORS closes in live mode.** The frontend is served from the same origin, so with
  `PUBLIC_URL` set and nothing mocked the only allowed origin is that URL. Mock mode stays
  open so a separate `npm run dev` on another port still works.

### Things found while verifying, and what was done about them

- **The call token was in the access log.** Verified against a running server: uvicorn
  logs the whole request path, and the token lives in the path, so every request a
  patient made wrote their only credential out in clear text. With that token you can
  read their script, post measurements as them and read their summary. `backend/logs.py`
  installs a filter that rewrites those paths to keep six characters, which is enough to
  match a session to a stored row and useless to anyone who finds the log. Verified after:
  zero occurrences. The in-app events already only recorded a tail.
- **The inbound reply loop was write only.** `notify()` could send the midweek symptom
  check and `photon.incoming` could parse a 0 to 10 reply and honour STOP, but nothing
  ever called the second one, so a reply had nowhere to land.
  `POST /api/messages/inbound` is now the single entry point for both a real transport's
  webhook and the demo console. Spectrum Cloud signs its webhooks and verifying that
  signature is the one piece still to do before this is exposed publicly.
- **An inbound row claimed to be iMessage when nothing live delivered it.** The outbound
  side already refused to guess; the inbound side was hardcoded. It now applies the same
  rule, so a reply in mock mode says mock.
- **CLAUDE_MODEL was set to a model that does not exist.** `claude-sonnet-5-5` is not a
  model id. Because `llm.ask` falls back to its template on any error, the key looked
  live, every request 404ed, and nothing was ever phrased by the model. Nothing failed
  loudly so nothing had noticed. `config.pick_model` now checks the id against the ones
  that exist, substitutes `claude-sonnet-5`, and records why so `make check` says so. The
  LLM is now genuinely live: a real call returns model text.
- **Responses over a kilobyte are compressed.** The mesh is 1.5 MB of JSON and loads on
  every twin page view. Measured: mesh 1545851 to 498908 bytes, twin 134143 to 48102.
- **Auth0 is the optional login from spec file 4.** With neither variable set there is no
  login and nothing in the tree changes. Only the clinician routes sit behind it, because
  a patient must be able to open a texted link with no account.
- **Photon's mini-app API exists but is not used.** The installed `spectrum-ts` iMessage
  provider does export a `customizedMiniApp` content type, so buttons and forms inside
  the thread are genuinely available. The midweek check still uses plain reply parsing:
  it is a reach item, the parsing path is already tested end to end, and a mini-app that
  only works on one transport would need the plain path kept anyway as the fallback.
