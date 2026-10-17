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
