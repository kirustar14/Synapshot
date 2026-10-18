# Synapshot

A personal brain twin for traumatic brain injury.

Every week a patient gets a text with a link. They open it on their own phone, and the page
runs a fourteen minute check-in: it draws the stimuli, records, and measures eye movements,
speech, memory and facial movement on the device. A whole-brain model forecasts twelve
weeks of recovery with uncertainty bands, an ensemble Kalman filter updates that model
after every call, and a drift alert goes to a clinician when reality leaves the band.

Every patient in this repository is synthetic.

The live-service path, from a new Tiger Cloud service to a trained Veri deployment, is
[TIGER_VERI_SETUP.md](TIGER_VERI_SETUP.md).

---

## Hackathon tracks

### Best use of Sentry

Both halves report to Sentry (`unnamed-backend`, FastAPI, and `unnamed-web`, React). Set
`SENTRY_DSN` in `.env` and `VITE_SENTRY_DSN` in `web/.env.local`; without them Sentry is off.

| Product | Where | What it showed us |
|---|---|---|
| Errors | `backend/observability.py`, `web/src/lib/sentry.ts` | Call failures used to be swallowed into a `failed` session state. They are now captured with patient and week tags. |
| Tracing | spans in `backend/calls/run.py` | Each check-in is broken into audio, transcription, assembly, feature pipeline, store, ensemble Kalman update and notify. The feature pipeline is the slow step (32 to 531 ms, about 5x slower after drift), not the twin update (20 to 55 ms). |
| Logs | stdlib logging forwarded at INFO | Call finished, call failed and drift alert lines, each linked to its trace. |
| Profiling | continuous, attached to traces | Hotspots inside the slow feature pipeline span. |
| Session Replay | the clinician app and the phone call page | Every replay masks all text and blocks all media, because the call page shows the patient's camera. |

**The bug Sentry found.** `UNNAMED-BACKEND-2`: *database disk image is malformed* on
`/api/patients/{pid}/twin`. The file passed `integrity_check`, so it was not corruption. One SQLite
connection was shared by every FastAPI worker thread with no lock, and the clinician app loads the
twin, shape and forecast in parallel. Sixteen parallel requests reproduced it (500s and false 404s);
a lock around every statement in `backend/db.py` fixed it.

Call tokens are a patient's only credential and they live in the URL, so every event, transaction,
breadcrumb and log is passed through the same mask as `backend/logs.py` before it leaves the
machine.

### Best designed hack

Designed in Paper first (the *Clinic app · polish* page of the team Paper file), then built:

- **Say what matters first.** The patient list opens with who needs a look today, in words. Each
  patient page opens with a plain-English status ("Recovery has slipped outside the forecast")
  and the one action that follows from it.
- **One encoding for drift everywhere.** A dot on a track against the pale forecast band, red only
  past the alert threshold, always with the number beside it so colour is never the only signal.
- **Fewer boxes.** Surfaces float on a tinted ground with one soft shadow instead of outlines;
  secondary actions are soft fills, so the primary action is the only solid button on a screen.
- **Built for the person on the phone.** On the patient's call page, *Read this to me* comes before
  the consent text, because reading is tiring after a head injury.

---

## Quick start

Nothing below needs an API key. With an empty `.env` the whole system runs in mock mode.

```sh
python3.11 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
cp .env.example .env            # optional, an empty file behaves the same

make mesh                       # the cortical surface, fetched once        (~30 s)
make seed                       # cohort, population fit, six demo patients (~50 s)
make models                     # the face landmarker the phone runs        (3.8 MB)
make web                        # build the clinician app and the call page
make dev                        # everything on :8000
make test                       # 135 tests                                (~40 s)
```

`make all` runs mesh, seed, voices, models and web in the right order.

Then:

- <http://localhost:8000/> is the clinician app
- <http://localhost:8000/api/health> should say `{"ok": true, "mode": "mock"}`
- <http://localhost:8000/docs> is the generated API reference
- `make check` prints what is real and what fell back

To see a whole call with no phone at all:

```sh
curl -s -XPOST localhost:8000/api/demo/trigger-call \
     -H 'content-type: application/json' -d '{"patient_id":"<id>"}'
```

In mock mode that generates everything a phone would post and runs it through the real
validation, the real nine point calibration fit, the real feature pipeline and the real
filter update. The only thing it skips is the phone.

## Run this first

**Do the flash and camera latency test on a real iPhone before you trust a single latency
number.** Budget 90 minutes.

The page draws ten full-screen white flashes and logs when each one painted. The camera
sees them a little later than the screen showed them, and that gap is the camera latency:

```
camera_latency = median over trials of (brightness rise in the frames) - (flash drawn)
```

It is subtracted from every saccade and antisaccade latency. If fewer than 8 of the 10
flashes come back, or the per-trial spread is above 25 ms, `flash_ok` is false and every
tier B measure is dropped for that call, everywhere.

On synthetic frames with a known 80 ms delay the estimate lands within 7 ms and the saccade
latency within 13.7 ms. **That is the estimator checked against its own generator, not
against a phone.** A real camera's lag depends on the sensor, the browser, the lighting and
the thermal state of the device, and none of that is in the generator.

The procedure:

1. `make tunnel` and follow the steps to get an https URL. iOS will not open the camera over
   plain http, so a localhost link cannot work.
2. Put that URL in `PUBLIC_URL` and restart `make dev`.
3. `POST /api/calls {patient_id, send:false}` and open the returned link on the phone.
4. Run the quality step several times, in bright light and in dim light, at arm's length and
   closer, held and propped.
5. Read `GET /api/call/{token}/status` and the stored channel block. Check the camera
   latency is stable between runs and that its spread stays under 25 ms.
6. If the spread is above the gate on a phone you intend to use, tier B is not measurable on
   that device and the system will correctly refuse to report it.

Until this passes, timing measures are not measurements.

## Run order

| Step | Command | What it does |
|---|---|---|
| 1 | `make mesh` | fsaverage5 pial and inflated, 20484 vertices, with a Schaefer-100 label on every one. Cached, so nothing else refetches it. |
| 2 | `make seed` | 50 synthetic cohort patients, 12 weeks of EnKF each, the NumPyro population fit, then the six demo patients. Prints coverage and the parameter recovery table. |
| 3 | `make voices` | Every spoken line as an mp3 through ElevenLabs. Lines whose text has not changed are left alone. Without a key the page uses the browser's own speech synthesis. |
| 4 | `make models` | The MediaPipe face landmarker the phone runs, into `web/public/models/`. |
| 5 | `make web` | Builds the clinician app and the patient call page into `web/dist`, which the backend serves at `/`. |
| 6 | `make dev` | The API, the app, the voices, both websockets and the old harness, all on port 8000. |
| 7 | `make tunnel` | Prints the exact steps to get an https URL a phone can reach. |
| 8 | `make test` | The full suite. Needs nothing running. |
| 9 | `make check` | The final checklist: what passed, what is running on a fallback. |

`make imessage` installs the two iMessage SDKs into the Node sidecar, which is what turns
real iMessage on. `make clean` deletes the database, the caches, the synthetic BIDS tree,
the mesh and `cohort.json`; everything regenerates.

## The web call

```
POST /api/calls {patient_id, send:true}
  -> creates a session, texts the patient a link
patient opens PUBLIC_URL/call/<token>
  -> GET  /api/call/{token}/script          the whole script, one task per screen
  -> POST /api/call/{token}/consent         three required toggles, genetic separate
  -> POST /api/call/{token}/redflags        the backend decides, never the page
  -> POST /api/call/{token}/symptoms        returns which blocks to skip
  -> POST /api/call/{token}/frames          measurements per task, never video
  -> POST /api/call/{token}/audio/{task}    the speaking tasks only
  -> POST /api/call/{token}/live            about every 200 ms, to the clinician console
  -> POST /api/call/{token}/finish
  -> GET  /api/call/{token}/status           until it says done, then the summary
```

A token is 32 random bytes urlsafe, good for one session and 24 hours, rate limited per
token and per address. No task runs until consent is in. A red flag stops the session
server side, raises the alert, texts the patient and rings the clinic, and nothing posted
afterwards is accepted.

**The video never leaves the phone.** The browser runs MediaPipe on the device and posts
only measurements: iris ratios, head pose, eye openness, face-region brightness and three
blendshapes per frame. Audio is the one raw medium that is uploaded, because the speech
measures need the sound itself, and it is deleted as soon as the features are out of it
unless `KEEP_AUDIO=1`.

`CALL_MODE=facetime` runs the old Mac rig path unchanged. `CALL_MODE=web` is the default.

## .env keys

Every mock switch defaults to **on** when the key it needs is missing, so an empty file is
full mock mode. Set `MOCK_X=0` to force a real path. See `.env.example` for all of them.

| Key | Default | What it does |
|---|---|---|
| `CALL_MODE` | `web` | `web` is a link to the patient's phone. `facetime` is the old rig. |
| `PUBLIC_URL` | empty | The https URL the texted link points at. Required for a real phone. |
| `DEMO_PHONES` | empty | The only numbers that can ever be texted. Nothing goes outside it. |
| `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID` | empty | The spoken lines. Without them the browser speaks. |
| `ELEVENLABS_AGENT_ID`, `ELEVENLABS_PHONE_NUMBER_ID` | empty | The clinic call through the conversational agent. |
| `PHOTON_PROJECT_ID`, `PHOTON_PROJECT_SECRET` | empty | iMessage. Also needs `make imessage`. |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`, `CLINIC_NUMBER` | empty | The SMS fallback and the clinic call. |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | empty / `gemini-2.5-flash` | Natural phrasing and the summaries. |
| `KEEP_AUDIO` | `0` | Keep the uploaded recordings after measuring them. For debugging only. |
| `ASR` | `whisper` | `elevenlabs` sends the audio to the API instead of transcribing locally. |
| `LIVE_AGENT` | `0` | An optional question and answer agent after the script. Never on the safety path. |
| `REGIONAL_LOADINGS` | `0` | Give each signal its own damage level from the regions that drive it. |
| `OFFLINE` | `0` | `1` skips every loader that could touch the network and runs on the modelled template. |
| `REACH` | `1` | Reach features on. |
| `DATABASE_URL` | empty | Tiger Cloud service URI. Empty means sqlite. |
| `AUTH_ENABLED` | `0` | `1` enforces clinician sessions. The synthetic admin is the default until the login screen exists. |
| `DEMO_LOGIN` | `1` | The one click demo sign in, for the seeded account. |
| `VERI_API_KEY`, `VERI_DEPLOYMENT_ID` | empty | The deployed decision model. Empty runs the heuristic. |
| `ADAPTIVE_MODE` | `heuristic` | `veri` calls the model, a miss falls back to script. |

A Twilio trial account can only call or text numbers it has verified first.

## Demo script

Twelve minutes, no keys, nothing to install beyond `make mesh && make seed && make web`.

1. **The list.** Six patients: week 0, stable at week 4, drifting at week 6, a red flag, a
   poor camera, and one with no MRI at all. The flags on each row come from real alert
   rules, not fixtures.
2. **A stable patient.** Six signals, each with an 80 percent band and the weekly
   observations inside it. `coverage` is the share of one-step-ahead observations that
   landed inside the band, computed before each update.
3. **The brain.** The twin viewer: a real fsaverage5 cortex that glows where the model says
   the damage is, a week scrubber from 0 to 12, the five most affected regions as callouts
   in plain language, and the impact marker where the head was hit. Drag the
   personalization slider and watch the template morph into this patient.
4. **The layers.** Damage, uncertainty (the one layer with genuine regional structure),
   healing, simulated activity, excitation and inhibition, template against personal, and
   the receptor what-if. Each says in one line what it means.
5. **Replay injury.** The impact ring pulses, a wave crosses the surface, the tracts light
   by their week 0 strain, the bump swells, then twelve weeks of recovery play out.
6. **The drifting one.** `drift_z` above 2 and a `drift` alert whose trigger text names the
   weeks. The clinic call was placed.
7. **Inject drift live.** `POST /api/demo/inject-drift` then `POST /api/demo/advance-week`.
   The next observation lands outside the band and the twin's estimate of `k` moves. Twice
   and the alert fires.
8. **The poor camera.** Three observables instead of six: the quality gate blocked the eye
   tasks, `flash_ok` is false and tier B was dropped. The gaze traces are still stored so
   you can see what the camera saw.
9. **A red flag.** The call stopped at the safety screen. No measurements, and the emergency
   text went out.
10. **A whole call.** `POST /api/demo/trigger-call`. A generated web session runs through
    the real ingest and the real pipeline, the twin updates, and the summary text appears
    in the phone mock.
11. **The cohort.** Coverage by week over 50 patients, true against estimated recovery rate,
    and each genotype effect with its 90 percent interval next to the value the generator
    actually used.

## Honest limits

Read this before showing anyone a number.

- **Every patient is synthetic.** No human data has gone near this. The generator draws
  parameters from the priors, so the twin is being tested against a world it already
  assumes. That tests the pipeline, not the science.
- **The SEMs are placeholders.** Every value in `data/sem.json` is a guess until the team
  runs test-retest on real sessions. Minimal detectable change, the `changed` flags, the
  observation noise in the filter and therefore the coverage numbers all rest on them.
  They are one file edit away from being real.
- **Camera latency is estimated, never measured with hardware.** The 7 ms and 13.7 ms
  figures are the estimator checked against the generator that made the frames. Nobody has
  pointed a real phone at a photodiode. A real camera's lag depends on the sensor, the
  browser, the light and how hot the phone is, and the honest version of this test needs an
  oscilloscope and an LED.
- **Photon iMessage is untested.** The two SDK call shapes were read off the installed
  packages and the Spectrum Cloud path was confirmed as far as a credentials rejection on a
  fake project id, so the wiring is right. No message has ever actually been delivered.
  Until it is, `make check` says mock.
- **An SMS is not an iMessage.** The fallback is Twilio SMS, which lands in the same app
  and looks much the same. Every message row records which transport actually carried it
  and the UI repeats that, because the iMessage challenge needs real iMessage.
- **25 of 45 voice lines are real.** The free ElevenLabs quota ran out partway through. The
  other 20 fall back to the browser's own speech synthesis, which is the designed behaviour
  and what the voices panel reports.
- **The emulator is one dimensional.** The whole-brain model is compressed to four
  summaries of one number, the mean damage. `REGIONAL_LOADINGS=1` gives each signal its own
  damage level from the regions that drive it, which finally makes tract attribution differ
  per signal, but those loadings are a design assumption and carry a hypothesis badge.
- **The healing layer is uniform.** There is one global recovery rate in this model, so
  `recovery` is the same number for every region and that layer is flat. Regional detail
  would need a regional `k`. The uncertainty layer is the one that genuinely varies in
  space.
- **DNA does not change the shape of a brain, and nothing here claims it does.** What
  morphs the mesh is age, sex, regional volumes and the injury. The genotype enters the
  recovery forecast and the uncertainty. The viewer says this on screen.
- **The lobe tags are approximate.** Schaefer parcels are network parcels, not anatomical
  ones, so each tag is the lobe the parcel mostly sits in. It is a reading aid for the
  callouts, not an anatomical claim.
- **The regional thickness scores are drawn, not segmented.** The synthetic T1 is an 8 cubed
  placeholder volume. Shape is labelled illustrative everywhere it appears.
- **The receptor maps are a stand-in.** `neuromaps` is not installed, so the five maps are
  smooth random maps from a fixed seed and the response says `synthetic_template: true`.
- **The what-if is not medication advice.** It is a visualization of receptor weighted gain
  changes in a whole brain model. It never touches the forecast, the filter, the alerts, any
  patient text or any summary, and three tests enforce that.
- **The APOE prior is a hypothesis.** The literature on APOE e4 and TBI recovery is mixed.
  The prior mean is small, positive and easily covers zero. The BDNF term carries no
  direction at all, it only widens the variance.
- **The model fits real FC at r = 0.205.** The brain template is real: Schaefer-100
  centroids and labels from nilearn, HCP diffusion and resting state connectivity from the
  ENIGMA toolbox, an E:I map from Allen Human Brain Atlas gene expression, and the
  fsaverage5 surface with the parcellation's own CBIG vertex labels. The model's predicted
  functional connectivity correlates with real HCP functional connectivity at r = 0.205
  with nothing tuned beyond the global coupling. Published whole brain fits reach 0.3 to 0.5
  with per subject tuning, so this is in the right direction and not yet competitive.
- **The DMF constants are from memory.** The reduced Wong-Wang values should be checked
  against cubnm before anyone trusts a firing rate. Feedback inhibition had to be added to
  get a usable working point, and the target rate is 1.2 Hz rather than the 3 Hz usually
  quoted, because above about 1.4 Hz the single population model is unstable.
- **G is identified by FC level, not pattern.** The FC pattern correlation rises
  monotonically with coupling, so it has no peak to find. The fit inverts the mean FC level
  instead, and the generator and the fitter deliberately share one FC estimator, which makes
  `fc_fit` a test of the pipeline rather than of the model against real data.
- **The red flag list is not clinically approved.** A clinician must confirm it before any
  use outside the team. The agent never diagnoses, never gives return-to-play or driving
  clearance and never discusses medication, and that is enforced in code by a filter on
  every patient facing line as well as in the system prompt.
- **Pursuit lag is never reported.** Only the gain and the aligned RMS error are.
- **Nothing here is a medical device.** It measures and it reports. A clinician decides.

## Layout

```
backend/
  app.py          every contract route, both websockets, serves web/dist at /
  calls/          the web call: sessions, script, audio, the finish pipeline
  rig_hub.py      the legacy FaceTime path, behind CALL_MODE=facetime
  db.py           sqlite, plain SQL          models.py   the contract as pydantic
  demo.py         reset, advance week, inject drift      alerts.py   the alert rules
  seed.py         cohort, population fit, demo patients
  twin/           dmf, strain, priors, surrogate, forecast, enkf, population, build,
                  counterfactual, attribution, shape, intervention, loadings
  data/           templates, mesh, synthetic patients, genotype, upload validation
  features/       quality, face, gaze, pursuit, flash, saccade, antisaccade, fixation,
                  blink, speech, memory, fluency, sem, pipeline, synth,
                  webframes, websynth
  agent/          script, dialog, safety, llm, summary, voices
  comms/          notify, photon, sms, clinic_call, node/ (the iMessage sidecar)
web/              the clinician app and the patient call page
  src/call/       the call state machine, the tasks, the on-device measurement
  src/components/brain/   the holographic viewer
rig/              the legacy rig: preflight, call, audio, capture, SETUP.md
prompts/          the four specs this was built from, and the frozen contract
tests/            135 tests
DECISIONS.md      every assumption, and the measurement that forced it
NOTES.md          what the app was before this session
```

## What was measured

Numbers from the current build, all reproducible with `make mesh`, `make seed` and
`make test`.

| Check | Result | Target |
|---|---|---|
| `fit_G` recovers the true G | worst error 0.3% over 5 patients | within 15% |
| EnKF one-step-ahead coverage at week 8 | 0.780 over 50 patients | 0.65 to 0.9 |
| Posterior contraction of log k at week 6 | 0.331 over 50 patients | above 0.3 |
| Same two, with `REGIONAL_LOADINGS=1` | both still inside their gates | unchanged |
| Population layer, sign of `c_bio` | recovered | recovered |
| Population layer, true `c_e4` in its 90% interval | inside | warning, not failure |
| Mesh: regions present on the surface | 100 of 100 | all |
| Region centroid to a vertex of its own label | 0.00 mm worst case | within 5 mm |
| Border flags as a share of vertices | 30.3% | a minority |
| Camera latency from a known 80 ms | within 7 ms over 8 seeds | within 15 ms |
| Saccade latency once the camera lag is removed | within 13.7 ms over 8 seeds | within 20 ms |
| Flash detection | 10 of 10 on a noisy synthetic series | 8 of 10 |
| Pursuit gain | worst error 0.0027 on synthetic gaze | within 0.05 |
| Intervention, all five receptor targets | finite effect, 0.7 to 1.3 s each | finite |
| Safety | no patient facing string contains a banned phrase | none |
| Contract | every endpoint returns every named field | all |
| Model FC against real HCP FC | r = 0.205, untuned beyond G | a real benchmark, not a target |
| `make seed` | 50 s from a clean checkout | under 10 minutes |
| `make test` | 47 s, 169 tests | under 3 minutes |

---

## Phase 10: Tiger Data, clinician accounts, and the decision model

Three capabilities on top of the twin, all of them runnable with no external account. The
click-by-click path to the live services is [TIGER_VERI_SETUP.md](TIGER_VERI_SETUP.md).

### Tiger Data

`DATABASE_URL` is the only switch. With it set, every query goes to Postgres and the
interaction between the relational graph and the time-series stream is real: clinics,
clinicians, patients and assignments sit beside a `metric_samples` hypertable that takes
the 5 Hz live telemetry from the call page. With it empty, sqlite is the system of record
and every response says so.

```sh
make tiger          # hypertable, metrics_1m and metrics_1h, refresh + columnstore policies
make tiger-check    # extension, aggregates, size, compression, measured raw against aggregate
make tiger-load     # 300k samples, ingest rate, refresh, compression, benchmark
```

What is used:

- `create_hypertable('metric_samples', by_range('time', interval '1 day'))`
- two continuous aggregates, `metrics_1m` and `metrics_1h`, with refresh policies
- columnstore after one day, segmented by `patient_id`, ordered by `time desc`, with the
  pre 2.18 compression calls as the fallback
- `GET /api/pulse` reads the aggregate first, falls back to a raw `time_bucket` query, and
  reports `source`, aggregate lag, table size, compression stats and assignment totals
- `GET /api/pulse?bench=1` (admin only) runs the same window against the raw table and the
  aggregate and returns median wall clock, row counts and the speedup

The bootstrap records each step in `tiger_bootstrap`, so `make tiger` twice does not create
duplicate policies. Every catalog query is guarded: a service version that lacks a view
returns `available: false` with the reason, never a made up number.

### Clinician accounts and assignments

Accounts are local: scrypt hashes, random session tokens stored hashed, an HttpOnly cookie
with `SameSite=Lax`, and a 12 hour expiry. `make seed` creates two clinics, four staff and
one primary assignment per demo patient. The middleware is off by default because the web
build has no login screen yet: turn on `AUTH_ENABLED=1` and sign in through the API, or
add the screen later. With it off the app runs as the synthetic admin.

```
POST /api/auth/login      POST /api/auth/demo      POST /api/auth/logout
GET  /api/auth/me         GET  /api/clinicians     GET  /api/assignments
GET  /api/clinics         POST /api/assignments    DELETE /api/assignments/{id}
```

The middleware has an explicit public allow list: health, the auth routes, every patient
token namespace (`/api/call/`, `/api/consent/`, `/api/stretch/`), the public reference data
and the inbound webhook. Everything else needs a session, so a new route is protected by
default. Patient scoping is a second check inside the route: a clinician sees assigned
patients, an admin also sees their clinic, and anything else is a 404 rather than a 403 so
ids cannot be probed. `AUTH_ENABLED=0` is the synthetic admin the tests and a fresh
checkout use.

Demo accounts, all with `DEMO_PASSWORD` (default `synapshot-demo`):

| Email | Role | Sees |
|---|---|---|
| `reyes@synapshot.health` | admin, UCLA | the five UCLA patients |
| `lee@synapshot.health` | doctor, UCLA | two UCLA patients |
| `ng@synapshot.health` | nurse, UCLA | one UCLA patient |
| `okafor@synapshot.health` | doctor, Cedar | the one Cedar patient |

### The open source decision model

This is a Jev shaped decision model, not a chat model: it reads a compact evidence state
and returns typed probabilities plus the next assessment block. It drives an adaptive
test, so a call can stop early when the remaining blocks would not change the estimate.

```sh
make decision-data                       # synthetic SFT and GRPO traces
veri datasets upload data/decision/train.jsonl --name synapshot-sft
veri datasets upload data/decision/train_grpo.jsonl --name synapshot-grpo

# 1. teach the JSON contract
python scripts/veri_train.py --method sft --dataset-id <id> \
  --hf-repo <you>/synapshot-adaptive-sft --submit
# 2. reinforce the choice from the merged SFT weights
python scripts/veri_train.py --method grpo --dataset-id <id> \
  --base-model <you>/synapshot-adaptive-sft \
  --hf-repo <you>/synapshot-adaptive-qwen-0.5b --submit

# 3. score the deployment
python scripts/veri_predict.py --limit 200
make veri-eval                           # full vs short-rule vs heuristic vs model
```

Both `--submit` lines need `VERI_API_KEY`. The dataset id is the bare id that
`veri datasets upload` prints.

The reward file is `scripts/veri_reward.py`, written to run standalone in Veri's sandbox.
It scores the JSON contract, the two argmax labels, information per minute of burden, and a
cost term, and it returns zero for a banned phrase or a safety block. `scripts/veri_eval.py`
writes `data/decision/eval.json` with mean minutes, information, information per minute,
a posterior sd proxy, miss rate, schema validity, safety violations and drift Brier score.

Runtime selection is explicit:

```
POST /api/call/{token}/next-block   {done: ["symptoms"]}
-> {next, probabilities, source: veri | heuristic | script, scores, minutes_saved, ms}
```

`ADAPTIVE_MODE=heuristic` is the default. `veri` requires both `VERI_API_KEY` and
`VERI_DEPLOYMENT_ID`; a three second miss falls back to the script order and the response
says `source: script`. The safety, consent, quality and calibration steps are never
candidates, and nothing in the model path can move the forecast, the filter or the alerts.

Measured on the 520 held out decision points, 200 synthetic patients:

| Policy | Minutes | Info per minute | Posterior sd proxy |
|---|---:|---:|---:|
| Full script | 9.35 | 43.90 | 0.0493 |
| Short rule | 8.99 | 43.74 | 0.0504 |
| Heuristic | 2.60 | 153.32 | 0.0500 |
| Veri model | pending | pending | pending |

The heuristic keeps 97 percent of the information in 28 percent of the patient time. This
is the generator's own information proxy, not clinical benefit. The model row stays
pending until a deployment is trained and scored; an empty row is honest, a copied
heuristic row is not.

Nothing here trains on real data. The dataset is generated by the same synthetic patient
generator the app uses, and the dataset card says the labels are oracle labels from that
generator, not clinical annotations.

### What is not done

- No Tiger Cloud service and no Veri account were available while this was built, so the
  Postgres and GPU paths are implemented and their setup commands are scripted, but they
  have not been run against a live service. The sqlite path and every fallback is tested.
  [TIGER_VERI_SETUP.md](TIGER_VERI_SETUP.md) is the exact sequence to run them.
- The landing page, `/login` screen, clinic team screen and pulse chart are not built. The
  capabilities behind them (auth, assignments, pulse) are complete and verified over HTTP.
