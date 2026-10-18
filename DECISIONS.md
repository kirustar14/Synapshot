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
  Each fsaverage6 inflated hemisphere arrives centred on the origin and would occupy the
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
  `data/uploads/<patient id>/surf/{lh,rh}.pial` when they exist and match the fsaverage6
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

### The outbound call incident, and what the real transports actually said

I made the new ElevenLabs clinic call live by accident and it rang a real phone
repeatedly. Written up here because the cause generalizes.

- **Credentials were treated as consent.** `ELEVENLABS_AGENT_ID`,
  `ELEVENLABS_PHONE_NUMBER_ID` and `CLINIC_NUMBER` were all present in `.env`, and
  `MOCK_ELEVEN` was a switch I had just invented so it was absent, which made
  `flag("MOCK_ELEVEN", ["ELEVENLABS_API_KEY"])` resolve to live. Every red flag and
  drift alert then placed a real outbound call, and `make seed` and the test runs fire
  those alerts, so it called over and over. A key sitting in a dotfile is not permission
  to ring somebody. `LIVE_CLINIC_CALL` now has to be set deliberately.
- **The allow list was only half enforced.** The brief says send nothing in live mode to
  a number outside `DEMO_PHONES`. The texts checked it from the start. The calls never
  did, so the one path that physically rings a person was the only path with no gate.
- **The allow list could not be parsed.** `DEMO_PHONES` held a label next to the number,
  the way a person would write it. `may_text` compared digits so it passed, but `send`
  handed the whole string to the transport as the destination, which then failed a long
  way from the cause. Entries are now normalized to E.164 and the label is dropped.
- **Why the call cut out the instant it was answered.** I first blamed the agent, which
  was wrong. The account is free tier and its 10000 character quota was fully spent, by
  me, generating the voice lines earlier in the session. A conversational agent needs
  credits to speak, so the call connected, had nothing to say, and dropped. The agent
  being the wrong one is true but secondary.

What the transports said once the code was right, verified against the real services:

- **Spectrum Cloud authenticates.** `cloud.getProject` returns the project, so the
  project id and secret are good. `getPlatforms` and `getImessageInfo` want a bearer
  token rather than the secret and are not needed for sending.
- **The send accessor is the narrowing function, not the property.** `imessage.config({})`
  goes in `providers`, and `imessage(app)` returns the platform surface with `space` on
  it. `app.imessage` exists, carries only `close`, and fails with an unhelpful
  `TypeError: Cannot read properties of undefined (reading 'create')`. Two different
  things wear the same name.
- **The remaining iMessage blocker is project side, not code.** With the accessor fixed,
  Spectrum answers `AuthenticationError: [spectrum-imessage] Target not allowed for this
  project`, which is the destination number not being allowed on the project.
- **The local fallback needs Full Disk Access.** `@photon-ai/imessage-kit` reads
  `~/Library/Messages/chat.db`. The file exists and is not readable by this process, so
  it reports `Failed to open database`. That is a macOS permission for the terminal, not
  a bug.
- **Twilio is ready.** Trial account, active, and `CLINIC_NUMBER` is already a verified
  caller ID, which a trial account requires. So the Twilio leg of the clinic call works
  as soon as `MOCK_TWILIO=0` and `LIVE_CLINIC_CALL=1`.

---

# v2: Synapshot, one clean demo

The science did not change. The number of screens did. Every model, every fit and every
gate from the phases above is still here and still running; what went is the surfaces
that showed the same thing twice and the integrations that were never on the demo path.

## The name

`UNNAMED` became **Synapshot**, tagline "A snapshot of your brain, every week." The
database moved from `data/unnamed.db` to `data/synapshot.db` and `make clean` removes the
new name. An existing `data/unnamed.db` is not migrated: it is seed data, `make seed`
rebuilds it in seconds, and a migration for disposable data is a liability.

## Removed, and why

Everything in this list is deleted, not hidden behind a flag. A flag on a path nobody
runs is a path that rots.

| Removed | Why |
| --- | --- |
| The FaceTime rig: `rig/`, `stimulus/`, `backend/rig_hub.py`, OBS, BlackHole, AppleScript, `CALL_MODE=facetime` | The web call on the patient's own phone replaced it in v1 and does the same measurements better. Keeping a second capture path meant two code paths for every feature and a demo that needed a second Mac. |
| R1 live console, R2 preflight, D1 demo console | The live gaze strip now lives in the call modal where the call is. Preflight is `make check` and `make phone`, which run in a terminal where you can act on them. |
| P1 consent mock, P2 phone mock, P4 gait and hearing | The consent screen and the phone screen are real now, inside `/call/:token`. Gait and hearing were exploratory, never validated, and showed numbers with no interval. |
| `/ui` harness, `frontend/` | A test harness for the backend, shipped at a route a visitor could reach. `/docs` already does this job honestly. |
| The clinic outbound phone call: `backend/comms/clinic_call.py`, `CLINIC_NUMBER`, `LIVE_CLINIC_CALL` | See below. This one was not a tidy-up. |
| `LIVE_AGENT`, the question and answer agent, `backend/agent/dialog.py`, `backend/agent/script.py` | The script is fixed and the safety screen is decided by the backend, so a conversational agent sat beside the measurement path adding risk and no measurement. |
| ElevenLabs speech to text | Patient audio for the recall, fluency and speech tasks is the one place a recording exists. `faster_whisper` runs locally and the audio never leaves the machine. Sending it to a hosted API for a convenience the local model already covers was the wrong trade. |
| Fetch.ai, Gemini, Maps, `PLANNER`, `EXPLAIN`, `NOTIFY_ON_MATCH` | None of them were on the demo path. Keys for services the app does not call are a liability in a `.env`, not a feature. |

### The outbound call is gone, and it is not coming back behind a safer flag

In v1 the app rang a clinician when an alert fired. During testing it rang a real person
over and over, because alert rules fire in batches when you seed or advance weeks, and
because credentials in `.env` were treated as permission to dial.

The v1 fix was a required `LIVE_CLINIC_CALL` switch and an allow-list check on calls. That
was the wrong shape of fix. A rule that can fire several times in a row must not be able
to ring a phone several times in a row, and no switch makes that safe.

So the whole path is deleted: the module, the Twilio voice call, the ElevenLabs outbound
agent, `CLINIC_NUMBER`, and the switch itself. An alert now lands in the clinician's
workspace over the event stream, where it waits to be read. Two tests keep it gone:
`test_nothing_in_the_app_can_place_a_phone_call` greps every module in `backend/` for
dialler shapes and asserts the three deleted modules fail to import, and
`test_an_alert_lands_in_the_workspace_instead_of_ringing` checks the alert reaches the
stream and writes no call event.

There is exactly one outbound path left: a text with a link in it.

## Merged into the patient workspace

C2 overview, C3 twin viewer, C4 scenario compare, C5 call log, C6 alerts, the cohort page
and the model validation numbers are now one screen with three zones and four tabs. The
brain never leaves it. Nothing in that list was deleted: the compare viewer is the
Treatment tab's difference mode, the cohort numbers are the population percentile ribbon
in Analysis, and the validation numbers are in the Evidence drawer.

## The websocket became an event stream

`/ws/rig` and `/ws/stimulus` are replaced by `GET /api/patients/{pid}/stream`, server-sent
events, one stream per patient. SSE rather than a websocket because every message goes one
way, EventSource reconnects on its own, and it survives a tunnel that a websocket does not.
The hub keeps the last 40 events per patient so a browser that connects mid-call catches
up instead of showing an empty strip.

Events are per patient and a subscriber gets nothing about anybody else. That matters
because a clinician may have one patient open on a screen somebody else can see.

## The call is four minutes by default

`/call/:token` serves the brief script: eleven screens, about four minutes. `?full=1`
serves the whole fourteen minute protocol. The symptom-triggered short rule is separate
and still applies to either.

This is a real trade, not a free saving, and `backend/calls/script.py` says so where the
list is defined. Ten antisaccade trials estimate the error rate with a standard error
around 15 percentage points where twenty halve it, and the brief script does not run
pursuit_v, saccade, npc, the two oral motor tasks, the picture description or fluency at
all. Those features are then absent for the week rather than measured badly: the filter
assimilates what arrived and the band widens where it did not. Nothing is invented to
fill them in, and `payload()` returns a `skipped` list so the page can say which tasks
did not run.

## Reading a patient out of their documents

`POST /api/patients/ingest` takes a multipart upload and streams five steps back on the
same response, as server-sent events. One upload, one pipeline, one page waiting on it: a
job id and a second connection would be three moving parts where one does.

- **The schema has no way to express a value without its provenance.** Every field is a
  value plus a confidence, the file it came from and the sentence it was read out of
  (`backend/ingest/schema.py`). A field with no source is one somebody has to check by
  hand anyway, and the screen should say so rather than look certain.
- **0.6 is the review line.** Below it the value is kept, shown greyed as "needs review",
  and not used by the twin. A twin built partly on a 0.3 confidence guess is worse than
  one that says it is a template. The number is a judgement call, written down so it can
  be argued with.
- **A derived value says it was derived.** Days since injury is the gap between two dates
  that are stated; no sentence says it. It carries `derived_from` instead of a quote,
  because a quote that does not contain its own number is a provenance trail pointing
  somewhere the value is not.
- **Days since injury is measured from the bundle's own latest date, not from today.**
  Otherwise the same records describe a patient who drifts further from their injury
  every day the demo is run.
- **The model and the fallback never mix.** When the model succeeds nothing from the regex
  pass is merged in. Half a record from each would make `source_file` mean two different
  things on one screen with no way to tell which fields to trust.
- **The build log's one second floor is pacing, not padding.** Steps two to five take
  real time. A step that finishes in 30 ms would flash past unread, and the point of
  showing steps is that somebody can see what was done with their documents. No step
  claims to have done more than it did.

### What the extractor actually scores

On the flagship pack, against `expected.json`: **21 of 21 with a key**, **20 of 21
without one**. The one it misses without a key is her sport, which is written on the
scanned referral letter and in no typeset document. That gap is deliberate (see below).

Bugs found and fixed while measuring it, each of which had put something plausible and
wrong on the screen:

- A dose read off a neighbouring drug. "ondansetron 4 mg and acetaminophen 500 mg" gave
  amitriptyline the acetaminophen dose, because doses were matched per line and a
  clinical note wraps. Doses are now scoped to the span between one drug name and the next.
- Every drug on the reconciliation sheet marked "proposed". That page has almost no full
  stops, so the whole thing was one "sentence" containing CURRENT, PROPOSED and STOPPED
  at once. Headings are sentence boundaries now, and a drug's status comes from its own
  sentence or the section it sits under.
- "PLAN" read as a proposal. A plan heading in an ED note is what is being done now. The
  word was removed from the proposal list; "consider", "not yet started" and "to start"
  remain.
- The CT finding taken from the triage note, which says "CT head per the Canadian CT Head
  Rule". Every note in a head injury chart mentions CT; only one is the CT report. A
  modality is now only read from a document whose title or examination field names it.
- An impression truncated to "Study is". Impressions wrap, and one line of one is not a
  finding. A conclusion now runs to the first real boundary: blank line, heading, page
  footer, a labelled aside like "Note:", or three sentences.
- "Sport and Exercise Medicine" read as an occupation of "and Exercise Medicine". Label
  patterns need their colon.
- A guard that did nothing. "the captured value must start with a lower case letter" was
  written as a `[a-z]` class on a pattern compiled with `re.I`, where it matches upper
  case too. The check is in code now, not in the pattern.
- "nausea without vomiting" reported as vomiting. A negated symptom is worse than a short
  list, so a mention preceded by no, not, without, denies or negative for is skipped, and
  "pressure" preceded by "blood" is not a symptom.
- A quote with no number in it. The label and the value land on separate lines of a PDF's
  text layer, so quoting the line the match started on gave "GCS:" and nothing else.
  Quotes span the whole match now, and a test asserts every numeric field's quote
  contains its own number.

## The flagship pack

`make sample` writes ten documents and an answer key to
`backend/data/sample/maya_ortiz`: eight PDFs typeset with reportlab and two PNGs that look
like they came off a flatbed. Maya Ortiz is invented; the clinical picture is a composite
of what the literature describes for a sport-related concussion with a small contusion.
Every page carries "SYNTHETIC RECORD. NOT A REAL PERSON. NOT FOR CLINICAL USE."

- **One source of truth.** `backend/synth/facts.py` renders both the documents and
  `expected.json`, so the answer key and the pack cannot disagree.
- **The dates are fixed, not relative to today.** Nine days is nine days, in every run,
  forever. A bundle whose dates move needs its answer key regenerated to stay true.
- **One field lives only on a scan, on purpose.** Her sport is on the scanned referral
  letter and nowhere else. With a key, Gemini reads the image and gets it. Without one it
  comes back at confidence zero and the workspace shows it as needing review. A demo where
  every field always resolves would never show that state, and that state is the honest
  behaviour of this pipeline on a real bundle.

## Contract changes

`Injury`, `Alleles` and `Biomarkers` gained optional fields so the clinical detail the
ingest reads survives the response model, which was silently dropping it. A new `Chart`
object carries what the documents said but the model does not consume: occupation, the
medication list, the symptoms the notes name. It is deliberately not inside `injury` or
`biomarkers`, which are model inputs. The `chart` column was added by the existing
migration list in `db.py`.

`CallScript` lost `clinic_number` and gained `full`, `minutes` and `skipped`.

## The workspace, and four bugs a browser found

Five screens became one. The overview, the twin viewer, the scenario compare, the call log
and the alerts list were all about the same patient and all made you leave the brain
behind to read them, so each moved into a tab beside the thing it is about. The rule that
keeps it to four tabs: a tab is a kind of question, not a feature. Where did this number
come from is Data. What does the model think is Analysis.

These four were found by driving a real browser and looking, not by reading the code. All
four render correctly at a glance and are wrong.

- **The damage layer lit the whole cortex red.** Damage from a rotational impact is
  diffuse by construction: the strain model damages edges by how they are oriented
  against the blow, and 3957 of 4950 edges end up above half the maximum. A real week 0
  field is about 0.12 to 0.17. Dividing by the maximum, which is what the ramp did,
  mapped that whole narrow field onto the top third of the colour scale and the brain
  looked catastrophically injured when the model was saying something mild and even. The
  ramp spans the patient's own range now, reports both ends, and the glow is capped at
  0.55 so the bloom pass cannot blow the surface to white and take the parcel boundaries
  with it.
- **The camera framed the brain at a fixed multiple of the mesh radius.** That only works
  at one aspect ratio. A perspective camera's horizontal field of view is the vertical
  one scaled by the aspect, so in the workspace's tall narrow column the brain ran off
  both edges. It fits against whichever axis is tighter now, which also fixes it at 390
  pixels wide.
- **Moving the camera without telling the orbit controls** left the two disagreeing, and
  the next damping tick dragged the view off centre a second after any resize.
- **The workspace grew past the viewport.** A one-screen layout whose grid can grow is
  not a one-screen layout, and the brain sat half below the fold.

Two more worth recording:

- Two flags of the same kind from different weeks rendered identically, because the week
  was being stripped out of the reason line as redundant with the rail. It is not
  redundant. Two identical rows read as a duplicate; the same flag in two consecutive
  weeks is the pattern the rule exists to find.
- The clinic table took the whole page sideways at 390 pixels. A page that scrolls
  horizontally on a phone is a layout bug; a table that does is a table. It scrolls
  inside its panel now and drops its two least important columns on a narrow screen.

### The vessel layer

35 vessels as merged tubes, four draw calls, one per group. Drawn opaque with depth
testing on, unlike the tracts: a vessel is a surface structure and occluding it correctly
is the point, where the tracts run underneath and are deliberately shown through.
Arteries are off by default, because in a head injury the venous side is what usually
matters and both at once is a thicket.

The SWI foci are the only patient-specific thing in that layer, and they are placed
rather than measured: a report gives a count and a lobe, not coordinates, so the nodes
are spread deterministically around the impact point. The caption covers them. A node
there says "the report counted this many foci in this region", not "a focus is here".

### make what

`make check` answers whether the system works. `make what` answers what you are looking
at, which is the question somebody watching the demo actually has: what is real, what is
standing in, what v2 removed and what it merged. It reads the live system rather than a
list somebody typed, so a line claiming a thing is real has gone and looked.

### Region picking

three's default `Mesh.raycast` walks every triangle on every pointer move. The cortex is
40,960 triangles, so hovering it ran about two and a half million ray-triangle tests a
second in JavaScript, which is most of a frame's budget spent working out which parcel
the mouse is over. `three-mesh-bvh` replaces that with a bounding volume hierarchy built
once per geometry: the build costs a few milliseconds and a raycast drops to 0.16 ms,
measured in the page rather than through the test driver's mouse, which has its own much
larger overhead.

The tree is built over the pial positions, which is what the ray actually hits. Inflation
happens in the vertex shader and the picking ray never sees it, so a region picked on an
inflated surface is the region under the pointer on the pial one. That is a real
limitation of doing the deformation on the GPU, and it is why the inflate slider is a
display control rather than a measurement one.

**Clicking a region selected nothing.** The workspace kept its own `region` state next to
the viewer's `selected`, so a click set the viewer's and left the workspace's untouched:
the selection chip never appeared and no tab ever heard about it. Two stores for one fact
is the bug; there is one now. An end to end test clicks the brain and asserts the chip
appears, because this is invisible to a unit test and invisible to a screenshot.

### The vessel caption is shown, not hovered

It started as a tooltip on the layer chip. A label somebody has to hover for is a label
most people never see, and this is the one that stops a rendered vessel being mistaken
for an angiogram. It is a line under the canvas whenever the layer is on, next to the
arteries toggle and the SWI foci count.

### What the end to end tests are for

`npm run e2e` is eight checks that need a real browser: region picking and its speed, the
vessel layer drawing without throwing, every layer chip being present, and no screen
scrolling sideways at 390 pixels or vertically at 1440. They are deliberately not part of
`npm test`: they need a backend on :8111 with seeded data and a built frontend, and they
should fail loudly for a different reason than a unit test does.

Four of the six real bugs in the v2 frontend were only visible in a browser. That is the
argument for having them.

## Polish pass, step 6: making the iMessage actually arrive

### Two call-shape bugs, both of which look right

The sidecar reached the Photon API on every send and reached a phone on none of them.
Two separate mistakes, and both of the wrong forms read as correct:

1. `im.space.create(to)` was passed the raw phone string. `space.create` takes a user,
   so the handle has to be resolved first with `im.user(to)`.
2. The message went out through `app.send(space, text(body))`. Messages are sent on the
   space: `dm.send(body)`.

The working shape, checked against the installed package rather than remembered:

    const user = await im.user(to);
    const dm = await im.space.create(user);
    const sent = await dm.send(body);

A test asserts all four facts about this file, because both wrong forms are easy to
reintroduce from memory.

### Accepted is not delivered

The old modal said "iMessage sent" the moment the API returned, which is a claim about
an HTTP response and not about a phone. A send now records `sent` with the provider id
and the space id. `GET /api/messages/{id}/status` polls `isDelivered` through the
sidecar, every two seconds for thirty seconds, and only a real yes from the provider
promotes the row to `delivered`. If the provider cannot answer, the status stays `sent`
and the chip says so. Four honest states, and no fifth one that means "probably":

- Delivered via iMessage
- Sent via iMessage, delivery not confirmed
- Not sent, with the reason underneath
- Mock, written to the thread

### SMS is out of the fallback chain

A failed iMessage used to become a text. That makes "did the iMessage work" unanswerable
from the screen, which is the one question this demo is about. A failed iMessage now
stays a failed iMessage and the reason is stored on the row so the modal can show it. A
test makes any call to `sms.send` raise, so the send path can never quietly reach it.

### Why nothing arrives on this machine, and what only you can fix

`make send-test` probes both paths separately and names the step that failed.

**Cloud.** The project authenticates. `profile.imessageSynced` is false, the line type is
shared, and the project owns zero lines, so every send returns `Target not allowed for
this project`. That is not a code fault and no code change fixes it. In the Photon
dashboard, open the project, find the iMessage or Lines section, and connect an Apple ID
or claim a number. If the booth runs the project, ask them to attach a line to it.

**Local.** `@spectrum-ts/imessage-local` drives Messages on this Mac and needs no project
line at all, which is why it is here. It fails with `unable to open database file`.
`~/Library/Messages/chat.db` exists and is healthy; macOS is refusing to let this process
read it. System Settings, Privacy and Security, Full Disk Access, add Terminal or iTerm,
then restart the terminal. This is the one that takes thirty seconds.

**Neither is load-bearing.** The QR code and the copyable link are always on the card,
and the call page opens from a scan whether or not a message was ever sent.

### The modal

One card at 560, one focus ring on the dialog and `outline: none` on everything inside,
which is what was stacking blue boxes. The link truncates in place with a copy button
rather than running off the right edge. The QR sits beside it at 160 and always on white,
because a dark-mode QR with inverted modules does not scan. The live strip lives in a
closed "Live call" section that opens itself the moment frames start arriving, which is
the one moment anybody wants to watch it. Below 640 the code and the link stack, because
a 160 pixel square next to a URL leaves the URL about four characters wide. Checked at
1440 and 390 in a browser, not from the code.

## Polish pass, step 1: the framing is said three times, not thirty

Every surface carried a disclaimer. The header had "Research prototype" and a "Synthetic
data" pill, the patient name had a "Synthetic" chip, every clinic row had another one in
a column of its own, the brain carried "fsaverage5 surface" and "Synthetic shape" and
"Model output, not a scan" at the same time, and the landing page and the add-patient
page each ended in a footer saying the same thing again.

Repetition at that volume is not honesty. By the second screen it reads as furniture, and
the one place it genuinely matters, a rendered cortex that looks like a scan, is the place
it gets ignored hardest because it has been on screen since the landing page.

It is now in exactly three places, each one somewhere a person is actually reading rather
than glancing:

1. **The Honest limits block in the Evidence drawer.** Opened deliberately, read
   deliberately. Limit 5 was rewritten: it used to say every viewer carries a label, which
   is no longer true, so it now says the whole thing once instead. The cortex is a template
   surface on fsaverage6, the shape is fitted to the chart rather than reconstructed, every
   colour is model output, and the vessels are from an atlas.
2. **The footer of a printed summary.** Invisible on screen, on every printed page. This
   is the version that leaves the building and the one most likely to reach somebody who
   never opened the drawer.
3. **The footer of every page of the sample PDFs.** Already there, unchanged:
   SYNTHETIC RECORD. NOT A REAL PERSON. NOT FOR CLINICAL USE.

### What stayed, and why it is not the same thing

Two things on the brain look like labels and are not. "Placeholder mesh" appears only when
the real surface failed to load, and "Shape parameters unavailable, showing the template
surface" only when the fit is missing. Both are failure states: they are not true on every
frame, and they change what you should believe about what is in front of you. A permanent
chip is furniture; an intermittent one is information.

The Data tab's Model inputs section still says, per file, what was provided and what was
not, because there it is the value of a field somebody is reading, not a banner over it.

## Polish pass, step 2: every section starts closed, and says what is inside it

The right-hand column opened six sections at once. Injury, Imaging, Bloods and the four
Analysis blocks were all expanded before anybody had asked a question, so the column was
a wall of labelled numbers and most of what you could see was not what you were looking
for.

Everything folds now, and everything starts closed. There is one `Fold` in
`web/src/components/fold.tsx` and the Data tab, the Analysis tab, the Timeline traces,
the Evidence drawer and the call modal all use it.

### A closed section has to earn its line

A row that only says "IMAGING" is a row you have to open to find out whether opening it
was worth it. Every fold carries a summary: the values somebody would have opened it for.
Bloods says "GFAP 412, UCH-L1 318 pg/mL". Drift says "drift z 0.00, inside the band, 0
flags". Population context says "62nd percentile". Often the summary is the whole answer
and the section never gets opened, which is the point.

The summary replaces itself with the body when opened, rather than sitting above it
repeating what is now directly below.

### Empty sections are not shown at all

Medication with nothing on the chart, symptoms with none named, imaging with no report:
these used to render a header and a line of grey text saying there was nothing there. A
row that only ever says "none" is a row somebody reads once and then skips forever. They
are gone when empty, which also means the number of rows is itself information.

### Remembering it, without letting storage break a panel

Which folds are open is one key in localStorage. Reading and writing are both wrapped,
because localStorage throws rather than returning null in private mode and inside some
embedded webviews, and a thrown storage error must never be the reason a panel fails to
render. Anything unreadable, or any value that is not exactly `true`, means closed. That
is the safe default in both directions: nothing that was open gets hidden, and a fresh
machine never opens to a wall of text.

Seven tests cover this, because all of it is invisible on a screenshot: a section that
quietly reopens, a summary that never comes back after closing, and a browser with
storage switched off taking the panel down with it. None of those throw.

### Two things that did not fold

**Honest limits in the Evidence drawer.** It is one of the three places the framing is
kept, and a disclosure somebody has to click is a disclosure most people never read. With
the numbers and the claims above it closed, it is now the first substantial thing in the
drawer rather than something you reach after scrolling past twenty-four claims.

**The Treatment tab.** It is a workflow, not a set of sections: search, pick, simulate.
Its results appear because somebody pressed Simulate, so they are already behind a
deliberate action, and the one genuinely optional part was already a closed disclosure.

### SidePanels.tsx is gone

332 lines holding a second copy of the region card, the tract list and the person
summary. All four exports have been unreachable since the five screens became one
workspace. A second copy of a panel nobody can open is a copy that drifts.

### Two things the summaries exposed

Writing a one-line summary forces you to read what a section actually says, and both of
these had been on screen for weeks without being noticed.

**The limits rendered their own markdown.** Each limit in docs/RESEARCH.md opens with a
bold headline sentence, and the drawer printed it raw: `**Every patient in this system is
synthetic.**`. This is one of the three places the framing is kept, so it has to read
like prose. The drawer renders the bold now. Only bold, because only bold is used.

**Regions in the tabs were "left cortex".** The Analysis and Treatment tabs called
`regionLabel(undefined, undefined, i)`, and without the mesh that function has no lobe and
no centroid, so every parcel in the cohort came back the same: "led by left cortex to left
cortex", and the Treatment tab's most-changed list said it too. Both tabs take the mesh
now. It costs nothing: the mesh query is parameterless and never goes stale, and the
viewer on the same screen has already fetched it. Two different Schaefer parcels can still
share one plain name, so a tract with both ends in one parcel reads "within left back
parietal" rather than "X to X", which looks like a bug even when it is not.

## Gemini replaces Anthropic

Every model call in the backend goes to Gemini now. There were two of them: the call-time
phrasing in `agent/llm.py`, and the document extraction in `ingest/extract.py`. The shape
of both is unchanged, including the thing that matters most about them, which is that a
failure is always a fallback and never an error a patient or a clinician sees.

- **Called over plain REST with httpx, not through a client library.** There is one request
  shape in `llm.py` and the whole file is a page long, so a dependency that has to be
  installed before the backend starts would buy nothing. `anthropic` is out of
  `requirements.txt` and out of the optional-package list in `checklist.py`, and nothing
  replaced it: the LLM can no longer be unavailable because of a missing import, only
  because of a blank key or `MOCK_LLM`.
- **`GEMINI_API_KEY` or `GOOGLE_API_KEY`.** The first is what the Gemini docs tell you to
  set and the second is what a Google Cloud console download calls the same thing. Either
  flips `MOCK_LLM` to 0.
- **`GEMINI_MODEL` is not checked against a list of valid ids, which supersedes the
  decision at "CLAUDE_MODEL was set to a model that does not exist".** That check existed
  because a wrong id 404s silently. The reasoning still holds and the implementation does
  not: Google shipped `gemini-3.5`, `3.6`, `3.7` and `3.8` flash ids while this was being
  written, and a name list in `config.py` would have rejected all four for being newer
  than the list. A name check cannot tell a model that does not exist from one released
  last week, so it no longer tries. The one thing it can still tell is that a
  `claude-sonnet-5` left in `.env` will never answer a Gemini request, so a non-Gemini id
  is still replaced with the default and still records why in `MODEL_NOTE`.
- **`make check` calls the model for real instead.** This is what actually replaced the
  name check, and it is strictly better: `llm.probe` spends one tiny completion and the
  LLM row then says `live on <model>`, or names the reason it is not. A row that says live
  because a key is non-empty is the exact failure the old check was reaching for.
- **A 429 is reported as its own state, not as a failure.** It is the one answer that
  proves the setup is right: the request was understood, accepted, and turned away for
  quota. Nothing is misconfigured and nothing needs changing, so `make check` says
  `rate limited` and says that lines are templates until it resets. This is not a corner
  case. The free tier is 20 requests a day on `gemini-3.8-flash`, which one ingest run and
  a few phrased lines will finish, and the symptom without this is a demo that looks
  configured and phrases nothing.
- **Thinking is off for phrasing and on for extraction.** `thinkingBudget: 0` on the flash
  ids, because a scripted line said in other words is not reasoning and a patient is
  waiting. Extraction leaves it on: reading ten documents and working out which is the
  most recent is reasoning, and nobody is on the phone. 2.5 Pro cannot turn thinking off
  at all, so it is sent no budget rather than one the API would reject.
- **Thought parts are dropped by their `thought` flag.** They arrive in the same `parts`
  list as the answer and they also carry `text`, so joining the list naively puts the
  model's reasoning in front of a spoken line, and in front of the JSON the extractor is
  about to parse. This is the one real difference in reply handling between the two APIs
  and it fails quietly in both places it can fail.
- **Structured output is constrained decoding plus pydantic, not one or the other.** The
  extractor sends the schema as `responseJsonSchema` and validates the reply with
  `Extraction.model_validate` anyway. If a model id rejects a schema that nested, it falls
  back to plain JSON mode with the schema written into the prompt, which is a weaker
  constraint and the same validation. Pydantic is the gate either way, so a malformed
  reply is a fallback to the regex pass rather than something that reaches the database.
  `title` and `default` are stripped from the schema before it is sent: they carry no
  instruction, and `default` invites the model to return the default instead of reading
  the document.
- **Measured, not assumed.** On the flagship ten-document pack, `gemini-2.5-flash` fills
  21 of 21 readable fields with none below the review line, and 20 of them match the
  answer key exactly. The 21st is `ct_finding`, where it quoted one sentence of the CT
  conclusion instead of all three: still copied verbatim from the right file, still true,
  just shorter than the key. `occupation` is the field that only exists on a scanned
  image, and it reads it, so the vision path works and the one deliberate gap in the pack
  behaves as designed.

## The brain viewer, merged from the Creao+Gemini branch

That branch is one commit past the point it forked from, `04d3dbf`, "Added brain model and
gemini integration". This branch was eight commits past the same point, and both had
rewritten the same files, so the brain half of it was a three-way merge rather than a copy.
Twelve of the fifteen files merged with no conflict and are that branch's code verbatim.
The three that conflicted are the only places a judgement was made, and in each one a
straight copy would have deleted something this branch added afterwards.

- **The look is theirs, wholesale.** Light stage instead of the dark hologram, an opaque
  cortex coloured by lobe in one blue family, impact severity drawn as graded bands in the
  fragment shader, drifting sparkles, no bloom and no vignette, labels only under the
  pointer and much larger. `ImpactMarker` is gone from the scene: the shader draws the
  impact on the surface now, through `uImpactGlow` and `uRadius`, rather than floating a
  ring in front of it. The component file is still there and still exported; nothing in the
  scene mounts it.
- **`Scene.tsx` keeps the vessels.** That branch has no `Vessels.tsx` and no `<Vessels>`
  block, so taking its file would have silently removed the vessel layer from the viewer
  while leaving the button that toggles it. Verified by rendering it: the arteries still
  draw over the cortex.
- **`BrainViewer.tsx` keeps `bare` and `fill`, and keeps the chips deleted.** That branch
  has no `bare` prop; this one has ten references to it and `Home.tsx` passes it, so a copy
  would have put a border and a corner radius around the landing page's full-bleed canvas.
  It also still shows the "fsaverage surface" and "Synthetic shape" chips, which the commit
  before this one deleted on purpose. See "Polish pass, step 1". Re-adding them would have
  undone that one commit later, and the comment explaining the deletion is still sitting
  directly above the code.
- **`regionData.ts` keeps the range mapping, takes the week tracking.** Their ramp divides
  by the maximum. That is the exact thing the test named "shows structure in a narrow field
  instead of a wall of red" exists to prevent: a diffuse field of 0.12 to 0.17 maps onto the
  top third of the ramp and lights the whole cortex. So the `lo` to `top` span stays. What
  their version gets right is reading both ends at the week being shown rather than at week
  0, so the ramp follows the recovery instead of staying pinned to the injury, and that is
  taken. The glow cap stays too: its original reason was the bloom pass, which is now gone,
  but the new shader multiplies glow through two smoothsteps and a tone curve, so an
  uncapped 1.0 still flattens the worst regions into one white patch.
- **fsaverage6, 81924 vertices, which supersedes "fsaverage5, 20484 vertices".** Four times
  the vertices for a visibly smoother cortex and crisper parcel edges. It costs: `mesh.json`
  goes from 1.5 MB to 6.1 MB, and the browser downloads all of it before the brain appears.
  That is the whole of the trade and it was made deliberately.
- **Three places that commit missed.** It changed `mesh.py`, `models.py`, `shape.py`,
  `types.ts` and the two fixtures, but not: `intervention.py`, where `HEMI_VERTS = 10242` is
  compared against the mesh's own label count, so every receptor would have failed that
  check and fallen back from the fsaverage surface to the MNI152 volume without saying so;
  and `checklist.py` and `finalcheck.py`, which both compare `source == "fsaverage5"` and
  would have reported a real fsaverage6 mesh as a procedural stand-in. `templates.py` keeps
  its `fsa5` strings on purpose: those are enigmatoolbox's own identifiers for a parcel to
  parcel conversion that never touches the viewer mesh.

## Step 1: one spoken line at a time

The call page played several lines at once. On a safety screen the patient heard the step
introduction, the first safety question and sometimes the one after it, all together.

There were three separate causes and the first fix only covered one of them.

- **Every line made its own audio element.** `Voice.mp3` ran `new Audio(url)` per line and
  assigned it over the previous one, which was still playing and now had nothing holding
  a reference to stop it. There is one element now, owned at module scope in
  `web/src/call/player.ts`. Module scope rather than a component, because React mounts
  twice under StrictMode and a route change can briefly have two call pages alive, and an
  element owned by a component becomes two elements playing at once.
- **An mp3 never cancelled the browser voice.** `speak` called `synth.cancel` but `mp3`
  did not, so a recorded line could start over a spoken one. `stop` now does both, plus
  pause, rewind to zero, and clearing the pending timer, and every play begins with it.
- **Nothing knew a line was stale.** A play that resolved after the step had moved on
  still reported success. Every play is stamped with the generation it started in,
  starting anything bumps the generation, and a play that finishes in an old one returns
  false. `useSpokenLine` keys on the step id, so the line is tied to the step that owns it.

Two further bugs came out of writing the tests, which is the argument for having written
them:

- **Stopping a line hung whatever was waiting on it.** `stop` detached the element's
  handlers and cleared the timeout, so the promise behind the current line never settled.
  The word list awaits each word before starting the next, so one interruption would have
  stopped it for the rest of the call. `stop` now settles the pending play first.
- **Read this to me ran a loop per press.** It reads every consent paragraph in sequence
  in a detached async loop. Pressing it twice started a second loop while the first was
  still going, and the player stopping the current line did not stop either loop from
  immediately starting its next one. `say` returns whether the line was still current
  when it ended, and the loop stops when it was not. The Playwright test found this one
  by pressing the button three times quickly, and it failed on it before this fix.

Also in this step:

- **One file per step, and the length with it.** `ScriptStep` carries one `say` and one
  `audio`, never a list, plus `duration_ms` from the voice manifest. The length is the
  timeout for a line whose ended event never arrives, so one bad mp3 cannot stall a call.
  A step with no file carries `audio: null` and `fallback: "speech"`.
- **`make voices` stopped destroying good audio.** On a failed generation, usually a spent
  quota, it wrote `file: None` into the manifest even when a perfectly good mp3 was on
  disk. The file survived and `audio_map` stopped offering it, so the call quietly
  dropped to the browser voice for a line that had been generated and paid for. A failure
  now keeps the existing file and records the error beside it. It also reports how many
  lines of the total have audio, and names the steps that do not.
- **A Replay button on every spoken screen**, disabled while the line is playing, because
  pressing it twice is how a patient used to start a second line over the first.

What the tests cover: `src/call/__tests__/player.test.ts` fakes the element and the
speech queue and counts how many are sounding at once, which lets it step the whole
script in milliseconds. `e2e/call-audio.spec.ts` counts the same thing in a real browser
with real effects and a real camera stream. It reaches consent, the setup step and the
face gate and stops there, because Chrome's fake camera is a test pattern and MediaPipe
finds no face in it. That limit is written in the test rather than hidden by it.

## Step 2: the brain did not update after a call, and now it does

The question was whether the 3D view changes when a check-in lands. It did not, and the
reason was one missing line.

`demo.assimilate` ran the filter, stored the new ensemble and called `rebuild_forecast`.
Every chart moved, because every chart reads the forecast. The brain reads the twin, and
the twin was written once by `build_twin` when the patient was created and never touched
again. A hundred regions, none of them capable of moving, for the life of the patient.
`scripts/call_update_report.py` printed `0 of 100 regions moved` the first time it ran,
which is what turned a suspicion into a fact.

- **`build.refresh_twin` recomputes the regions from the current ensemble.** Deliberately
  not `build_twin`, which refits G, the expensive part, and resets drift_z, coverage and
  the ensemble to their starting values. Calling that after a call would have undone the
  update that had just happened. Everything structural is recomputed from the patient's
  own record because it is cheap; the only thing that actually changed is the ensemble,
  and that is what moves the per region damage curves.
- **The workspace never refetched.** There was a comment in `Workspace.tsx` saying the
  stream was what let a call land without a reload, and nothing underneath it doing so.
  `call_done` now invalidates the patient, twin, shape, forecast, alerts, timeline,
  check-ins and attribution queries.
- **`GET /api/patients/{id}/latest-update`**, served from the stored `call_update` event
  rather than recomputed, so a page opened after the call shows the same banner as one
  that was open when it landed.
- **The banner says small when it is small.** `update_line` names the biggest mover and
  its network, and switches to "Small change" under 0.02 rather than making an ordinary
  week sound like an event. A banner that always sounds urgent stops being read.

How much it actually moves, measured rather than claimed, on a damage scale that sits
around 0.25 at week 0:

| call | regions moved | largest single region | drift z |
|---|---|---|---|
| typical | 100 of 100 | 0.022 | +0.26 |
| worse (`--degrade 1.0`) | 100 of 100 | 0.041 | +0.68 |
| better (`--degrade -0.8`) | 100 of 100 | 0.048 | -0.31 |

That is 8 to 20 percent of a region's own value, which is visible on the 3D layer, and
visible partly because the damage ramp was rewritten earlier to window the top end at the
98th percentile and spread the colours across the patient's own range.

- **`degrade` moves the measurements, not the result.** It shifts the week's truth in
  SEM-scaled steps before any frames are generated, reusing the arithmetic `inject_drift`
  already used, so the pipeline still has to measure it back out of frames and audio. A
  knob that wrote the answer down would make the report worthless. Zero is the default
  and a call that moves nothing stays a real outcome.
- **The zero face rate was not the generator.** `websynth.session` uses `face_p = 1.0`
  unless the patient is the low quality profile, where it is 0.55, and the seeded
  check-ins hold those values. A face share of 0 comes from `app.py` defaulting a missing
  channel to zero, which is a call with no frames at all being displayed as a call where
  the camera saw nothing. There are now tests on both ends: a default call keeps a face
  share above 0.5, and the poor channel stays poor without ever reaching zero.

Not done: the changed regions do not pulse on the brain yet. The banner names them and
the colours move, but the one-off pulse is still to come.

## Steps 3 and 4: the Treatment tab stops simulating and starts explaining

The tab used to let you pick medicines, run the model, and read off a baseline, a treated
version and the gap between them, with an effect size slider and a ranked list of the
regions that moved most. Underneath, `twin/drugs.py` combined a drug's receptor affinities
into one weight per region and `twin/intervention.run` scaled each region's local
recurrent weight by `1 + gain * weight`, ran the dynamic mean field model twice, and
called the difference the effect.

Every part of that is defensible as a method and none of it is defensible as a screen. It
is a treatment response prediction. Nothing in this system has any standing to make one:
there is no outcome model, nothing was fitted to anybody's response to a medicine, and the
number it printed to four decimal places came from a gain parameter somebody chose with a
slider. Removed: `twin/drugs.py`, `intervention.run`, `intervention.scaled`, the
`/intervention` route, the `DrugImpact` payload, the mock that stood in for it, and the
three tests that drove it.

Kept: the receptor and transporter atlas in `intervention.py`. The atlas was never the
problem, and the viewer that replaced the simulation reads it directly.

What the tab is now: a reference for what each medicine does and where its known targets
are. Toggle one and the brain lights up its target density from the PET and SPECT atlas,
plus the schematic pathway its transmitter runs along. Instant, because there is nothing
to compute. Everything else is in a dropdown, closed by default, so twelve medicines fit
on a page.

- **`no map available` is a real answer and appears five times.** The Hansen atlas covers
  twelve targets. Propranolol acts at beta adrenoceptors, ondansetron at 5-HT3, gabapentin
  at the alpha-2-delta calcium channel subunit, melatonin at MT1 and MT2, and the atlas
  covers none of them. Those say so. Drawing a nearby receptor instead would be inventing
  a picture, and it is exactly the kind of invention that is impossible to spot later.
  Acetaminophen and ibuprofen have no mapped brain target at all, cannot be toggled, and
  keep their dropdown, because the most useful thing the screen can say about
  acetaminophen is that it has nothing to show.
- **The overlap is an intersection, not a claim.** Regions above a fixed damage floor of
  0.15 and above a target density of z = 1. Fixed rather than percentile so the same
  number means the same thing on every patient. It does not say the medicine reaches those
  regions and it does not say anything would improve if it did. Empty is common and is
  printed as empty.
- **Citations are tagged, and most of them say check this.** Giacino 2012 was fetched and
  read, so the amantadine entry is tagged verified and says what it actually studied: 184
  patients in a vegetative or minimally conscious state after SEVERE TBI, in inpatient
  rehabilitation, which is a different population from concussion. The amantadine NMDA
  mechanism is verified the same way. Everything else is tagged check this. The GtoPdb
  ligand pages need a login and the VA/DoD and AAN guideline PDFs would not extract to
  text, so those claims are written from general pharmacological knowledge and are
  labelled as needing a source read end to end. Nothing is cited that was not fetched.
- **No dose anywhere, and a test that keeps it that way.** The old formulary carried a
  `typical_dose` field for recognition. It is gone, and a test greps the whole payload for
  " mg" and its relatives.
- **Ordered by match count, never by better.** The symptom section counts how many of this
  patient's elevated symptoms each medicine is ordinarily used for. That is a count, not a
  judgement, and the words recommend and best appear nowhere, which a test enforces over
  the whole payload. The threshold is a fixed 4 out of 10 so two weeks can be compared.
  Pressure and neck pain fold into headache and blurred vision folds into light
  sensitivity, because they are one complaint as far as what gets prescribed is concerned
  and listing amitriptyline three times for it would be noise.

Two bugs came out of building this:

- **The damage interval never contained its own estimate.** `twin_json` built `damage`
  from `dreg * decay`, where decay came from the point estimates of k and p and left out
  the damage scale, while `damage_lo` and `damage_hi` came from the ensemble, which
  includes it. With a scale above 1 the whole 10th to 90th band sat above the line it was
  supposed to be a band around, on every region of every patient. Both now come from the
  ensemble. Found by printing an overlap row and noticing 0.344 sitting outside
  [0.386, 0.557].
- **`suggested-drugs` would 500 on a fresh database.** The call tables are created the
  first time somebody makes a call, so on a new install the query was against a table that
  did not exist. An empty list is the right answer there.

## Step 5: a message says only what is known about it

`GET /api/messages/{id}/status` now returns the channel, the status, the provider id, the
real error text and the delivery time, with the status one of sent, delivered, not_sent or
mock.

- **`failed` became `not_sent`.** `failed` is the transport's word for it. On a screen the
  thing a clinician needs to know is that nothing left the building.
- **`delivery_confirmation` is only ever `provider`.** Everything else is `unavailable`,
  including local iMessage, which cannot read receipts at all. A message sent that way
  stays `sent` forever, and the modal says "Sent via iMessage, delivery not confirmed",
  which is the whole truth about it. `delivered_at` is null unless a provider confirmed,
  so there is no delivery time without a delivery.

## Step 6: two things `make check` was hiding

It crashed outright on a `KeyError: 'sms'` and had been doing so since SMS was taken out
of the fallback chain: `notify.status` stopped reporting an `sms` key and the row still
read one. So the command whose whole job is to say what is real and what fell back could
not run at all, which is why the Treatment tab's missing route was not noticed sooner.
Both are fixed: the SMS row now says there is no fallback chain, which is the truth, and
the contract route list names the pathway viewer's routes instead of `/intervention`.

`make check` now prints 42 passed, 0 failed, 7 running on a fallback.

## 6a: the face model was never shipped

`web/.gitignore` ignores `public/models`, so the 3.8 MB landmarker does not come with a
checkout. `make models` fetches it, but `make dev` did not depend on that and `make check`
never looked, so any machine that skipped the step served a call page where the eye
measurement silently never ran. The loader itself was fine: wasm already bundled locally,
GPU with a CPU fallback already there.

`make dev` depends on `models` now, the download goes to a `.part` file first so a
truncated one cannot masquerade as a model, and `make check` fails if the file is missing
or under 1 MB. The patient never sees the loader's words: "The camera check could not
start" with Try again and Tell my clinic, and the real error goes to the console.

## 6b: the live call panel is gone

The gaze dot, the face, distance and light lights, the 4/s and 30 fps readouts and the
"Live, 4/s" chip all showed a clinician on a laptop things they could not act on: the
measurements are posted in whole chunks and read back once the call lands. One grey line
replaced the lot, moving through Waiting for the patient, Check-in in progress: step,
Processing, Done. The call page no longer posts /live; the route stays for a future
console. The privacy sentence stays on the patient consent screen, which is where it is
actually read.

## 2: the thing floating on the brain was the tracts

Isolated by rendering with each suspect off in turn. Not the vessels, which are already
gated behind their overlay and off by default. Not the back pass, not the hologram, not
the alpha. Turning the tracts off made it vanish.

Both tract materials had `depthTest: false` at `renderOrder 12`, so the two hundred tubes
painted over the cortex unconditionally. That was survivable while the cortex was opaque.
Once the merged shader made it slightly translucent they read as a khaki veil draped
across the brain with pale streaks through it. Depth testing is on now: the cortex in
front of a tract hides it, the layer still toggles, and nothing else changed.

## 1: the restyle

Editorial pass applied at the token layer so every screen moved at once rather than
screen by screen. Off-white #FBFBFB page, near-black ink, Instrument Serif headings with
one italic word, Space Grotesk body, JetBrains Mono for anything that is a label rather
than a sentence. Fonts are local fontsource packages: the call page has to work on a
phone over a tunnel with no outside network.

Primary buttons are the ink colour, not the accent. The accent is kept for state and for
the brain, where it carries meaning; a page of teal buttons spends it on navigation.

The Home hero canvas is transparent now (`alpha: bare`). It was an opaque buffer, so the
brain sat in a grey box on the off-white page.
