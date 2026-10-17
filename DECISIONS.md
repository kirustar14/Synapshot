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
