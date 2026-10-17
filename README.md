# UNNAMED

A personal brain twin for traumatic brain injury.

A Mac rig calls a patient on FaceTime every week and measures eye movements, speech,
memory and facial movement through the phone camera and microphone. A whole-brain model
forecasts twelve weeks of recovery with uncertainty bands, an ensemble Kalman filter
updates that model after every call, and a drift alert goes to a clinician when reality
leaves the band. Every patient in this repository is synthetic.

This is the backend, the rig and the stimulus page. The clinician frontend is built
separately against the API contract at the bottom of `claude_code_backend_prompt.md`.

---

## Quick start

Nothing below needs an API key. With an empty `.env` the whole system runs in mock mode.

```sh
python3.11 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
cp .env.example .env            # optional, an empty file behaves the same

make seed                       # cohort, population fit, six demo patients  (~20 s)
make dev                        # API, websockets and the stimulus page on :8000
make test                       # 76 tests                                   (~30 s)
make rig                        # a full mock call, start to finish
```

Then:

- <http://localhost:8000/api/health> should say `{"ok": true, "mode": "mock"}`
- <http://localhost:8000/stimulus/> is the page the patient sees
- <http://localhost:8000/docs> is the generated API reference

## Run this first

**Do the flash test before you trust a single latency number.** Budget two hours.

Every saccade trial starts with one full-screen white frame in the stimulus video at a
known Mac clock time. That step comes back through FaceTime in the returned video,
delayed by the call. `backend/features/flash.py` finds the returned step, so the stimulus
event and the patient's response are both read off the same returned stream and the call
delay cancels out. If fewer than 8 of 10 test flashes come back, `flash_ok` is false and
every tier B measure (saccade latency, antisaccade) is dropped for that call, everywhere.

The procedure is step by step in `rig/SETUP.md` under "Run this first". Until it passes,
timing measures are not measurements.

## Run order

| Step | Command | What it does |
|---|---|---|
| 1 | `make seed` | 50 synthetic cohort patients, 12 weeks of EnKF each, the NumPyro population fit, `data/cohort.json`, then the six demo patients. Prints coverage and the parameter recovery table. |
| 2 | `make dev` | Serves the API, `/ws/rig`, `/ws/stimulus` and the stimulus page. |
| 3 | `make preflight` | Fifteen rig checks. Each red one names its own fix. |
| 4 | `make rig` | Places the call if the rig is ready, otherwise runs the mock session through the same pipeline. |
| 5 | `make test` | The full suite. Needs nothing running. |
| 6 | `make check` | The final checklist: what passed, what is running on a fallback. |

`make clean` deletes the database, the caches, the synthetic BIDS tree and `cohort.json`.
Everything regenerates from `make seed`.

## .env keys

Every mock switch defaults to **on** when the key it needs is missing, so an empty file is
full mock mode. Set `MOCK_X=0` to force a real path.

| Key | Default | What it does |
|---|---|---|
| `MOCK_RIG` | on unless `RIG_FACETIME_NUMBER` | Replays a generated session instead of calling a phone. |
| `MOCK_LLM` | on unless `ANTHROPIC_API_KEY` | Uses template lines instead of calling Claude. |
| `MOCK_PHOTON` | on unless `PHOTON_API_KEY` | Writes iMessages to the database instead of sending them. |
| `MOCK_TWILIO` | on unless all four Twilio keys | Logs the clinic call script instead of dialling. |
| `OFFLINE` | `1` | Skips any template loader that would download an atlas. Set to `0` once to fetch the real Schaefer atlas and the MediaPipe model. |
| `REACH` | `1` | Reach features on. |
| `USE_SBI` | `0` | Swaps the emulator table inversion for an `sbi` neural posterior, if `sbi` is installed. |
| `CLAUDE_MODEL` | `claude-sonnet-5` | Any current model id. |
| `ANTHROPIC_API_KEY` | empty | Natural phrasing, off-script answers and summaries. |
| `PHOTON_API_KEY`, `PHOTON_BASE_URL` | empty | iMessage transport. |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`, `CLINIC_NUMBER` | empty | The clinic call. |
| `RIG_FACETIME_NUMBER` | empty | Who the rig calls. |
| `MIC_DEVICE`, `SPK_DEVICE` | BlackHole 2ch / 16ch | The two virtual audio devices. |
| `SCREEN_W_MM`, `SCREEN_H_MM`, `VIEW_DIST_MM` | 71.5 / 147 / 300 | Phone screen and viewing distance, used to turn normalized gaze into degrees. |
| `DB_PATH`, `DATA_DIR`, `API_BASE` | `data/...` | Paths. |

A Twilio trial account can only call numbers it has verified first, so verify the clinic
number in the Twilio console before setting `MOCK_TWILIO=0`.

## Demo script

Twelve minutes, no keys, nothing to install beyond `make seed`.

1. **The list.** `GET /api/patients`. Six patients: one at week 0, one stable at week 4,
   one drifting at week 6, one with a red flag, one with a poor video channel, one with no
   MRI at all. The flags on each row come from real alert rules, not fixtures.
2. **A stable patient.** Open the week 4 one. Six signals, each with an 80 percent band and
   the weekly observations inside it. `coverage` is the share of one-step-ahead
   observations that landed inside the band, computed before each update.
3. **The drifting one.** Its `drift_z` is above 2 and it carries a `drift` alert whose
   trigger text names the weeks. The clinic call was placed: `called` is true on the alert.
4. **Inject drift live.** `POST /api/demo/inject-drift {patient_id, size: 1.5}` then
   `POST /api/demo/advance-week {patient_id}`. The next observation lands outside the band
   and the twin's estimate of `k` moves. Do it twice and the alert fires.
5. **The poor channel.** The low quality patient has three observables instead of six: the
   quality gate blocked the eye tasks, `flash_ok` is false and tier B was dropped. The
   gaze traces are still stored so you can see what the camera saw.
6. **A red flag.** The red flag patient's call stopped at the safety screen. No
   measurements were taken and the emergency text went out.
7. **The twin.** `GET /api/patients/{id}/twin`. 100 regions with per-week damage and
   activity, the 200 most damaged tracts, and the three worst named.
8. **What if.** `POST /api/patients/{id}/scenarios` with helmet A at 10 degrees against
   helmet B at 70. Then `POST /api/patients/{id}/counterfactual {k_mult: 2, p_add: -0.05}`.
9. **The cohort.** `GET /api/cohort`. Coverage by week over 50 patients, true against
   estimated recovery rate, and each genotype effect with its 90 percent interval next to
   the value the generator actually used.
10. **A live call.** `make rig`. The mock session runs through the real dialog, the real
    feature pipeline and the real twin update, and the week advances.

## Honest limits

Read this before showing anyone a number.

- **Every patient is synthetic.** No human data has gone near this. The generator draws
  parameters from the priors, so the twin is being tested against a world it already
  assumes. That tests the pipeline, not the science.
- **The SEMs are placeholders.** Every value in `data/sem.json` is a guess until the team
  runs test-retest on real sessions. Minimal detectable change, the `changed` flags, the
  observation noise in the filter and therefore the coverage numbers all rest on them.
  They are one file edit away from being real.
- **The emulator is one dimensional.** The whole-brain model is compressed to four
  summaries of one number, the mean damage. It stands in for a proper simulation based
  inference posterior. Everything routes through that one number, which is why tract
  attribution gives the same ordering for every signal.
- **The APOE prior is a hypothesis.** The literature on APOE e4 and TBI recovery is mixed.
  The prior mean is small, positive and easily covers zero. The BDNF term carries no
  direction at all, it only widens the variance. Nothing here is evidence about either.
- **The DMF constants are from memory.** The reduced Wong-Wang values should be checked
  against cubnm before anyone trusts a firing rate. Feedback inhibition had to be added to
  get a usable working point at all, and the target rate is 1.2 Hz rather than the 3 Hz
  usually quoted, because above about 1.4 Hz the single population model is unstable.
- **G is identified by FC level, not pattern.** In this model the FC pattern correlation
  rises monotonically with coupling, so it has no peak to find. The fit inverts the mean FC
  level instead, and the generator and the fitter deliberately share one FC estimator. That
  makes `fc_fit` a test of the pipeline, not of the model against real data.
- **Saccade latency is one frame early.** Measured bias is about -17 ms at 30 fps, which is
  frame quantization. It is constant week to week, so the filter's discrepancy term absorbs
  it, but it is not a clinical-grade latency.
- **The red flag list is not clinically approved.** A clinician must confirm it before any
  use outside the team. The agent never diagnoses, never gives return-to-play or driving
  clearance and never discusses medication, and that is enforced in code by a filter on
  every patient facing line as well as in the system prompt.
- **Pursuit lag is never reported.** It contains the FaceTime round trip, the virtual
  camera latency and the phone's own pipeline. Only the gain and the aligned RMS error are
  reported.
- **Nothing here is a medical device.** It measures and it reports. A clinician decides.

## Layout

```
backend/
  app.py          every contract route, both websockets
  rig_hub.py      sync call loop to async websocket bridge, mock and live hubs
  db.py           sqlite, plain SQL          models.py   the contract as pydantic
  demo.py         reset, advance week, inject drift      alerts.py   the alert rules
  seed.py         cohort, population fit, demo patients
  twin/           dmf, strain, priors, surrogate, forecast, enkf, population, build,
                  counterfactual, attribution
  data/           templates, synthetic patients, genotype, upload validation
  features/       quality, face, gaze, pursuit, flash, saccade, antisaccade, fixation,
                  blink, speech, memory, fluency, sem, pipeline, synth
  agent/          script, dialog, safety, llm, summary
  comms/          photon, clinic_call
rig/              preflight, call, audio, capture, run_call, place_call.scpt, SETUP.md
stimulus/         index.html
tests/            76 tests
DECISIONS.md      every assumption, and the measurement that forced it
```

## What was measured

Numbers from the current build, all reproducible with `make seed` and `make test`.

| Check | Result | Target |
|---|---|---|
| `fit_G` recovers the true G | worst error 0.3% over 5 patients | within 15% |
| EnKF one-step-ahead coverage at week 8 | 0.780 over 50 patients | 0.65 to 0.9 |
| Posterior contraction of log k at week 6 | 0.331 over 50 patients | above 0.3 |
| Population layer, sign of `c_bio` | recovered | recovered |
| Population layer, true `c_e4` in its 90% interval | warns when outside | warning, not failure |
| Genotype parser | all four SNPs, every combination round trips | four SNPs |
| Flash detection | 10 of 10 on a noisy synthetic series | 8 of 10 |
| Pursuit gain | worst error 0.0027 on synthetic gaze | within 0.05 |
| Safety | no patient facing string contains a banned phrase | none |
| Contract | every endpoint returns every named field | all |
| `make seed` | 20 s from a clean checkout | under 10 minutes |
| `make test` | 29 s, 76 tests | under 3 minutes |
