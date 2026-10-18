> This is a record of the app as it was **before** the v2 rework, written so the
> changes could be made against something written down. Routes, websockets and
> page lists in here describe what used to exist. For what exists now, run
> `make what`, or read the v2 section of DECISIONS.md.

# NOTES: the app as I found it

Written at the start of the web call and frontend session, before any change. Read with
DECISIONS.md, which carries the reasoning behind every number mentioned here.

## Verified by running it

- `make test` 76 passed, 4 warnings, 23.8 s. No failures, no skips.
- `make check` 32 passed, 0 failed, 5 on a fallback. Mode: mock.
- `.env` was never committed: `git log --all -- .env` is empty, and `.env` is in
  `.gitignore` twice. No secret has ever been in the history.
- `lovable-frontend/` holds no `.env`, only `.env.example` with three blank names
  (`VITE_API_URL`, `VITE_AUTH0_DOMAIN`, `VITE_AUTH0_CLIENT_ID`). Nothing to report.

## What exists and works

**The twin.** Schaefer-100 parcellation with real nilearn MNI centroids and labels, real
HCP diffusion and resting state connectivity from the ENIGMA toolbox, and an E:I map from
Allen Human Brain Atlas gene expression. A reduced Wong-Wang dynamic mean field model with
analytic feedback inhibition, a linear response FC solution, and a grid fit of the global
coupling G. A 1-D emulator compresses the whole network response to four summaries of one
number, the mean damage. An ensemble Kalman filter with 200 members updates log k, logit p
and a damage scale after every call, and a NumPyro hierarchical layer fits the four
genotype and biomarker effects across a 50 patient cohort.

Measured on the current build: `fit_G` recovers true G to within 0.3 percent, EnKF
one-step-ahead coverage at week 8 is 0.780, posterior contraction of log k at week 6 is
0.331, and the model FC correlates with real HCP FC at r = 0.205 with nothing tuned beyond
G.

**The measurement pipeline.** Nine point gaze calibration on a degree 2 polynomial of iris
ratios and head pose, reported in degrees. The flash trick: one full screen white frame per
trial, detected in the returned video, so the stimulus event and the response are timed off
the same stream and the call delay cancels. Smooth pursuit gain and aligned RMS, saccade
and antisaccade latency and error rate, fixation BCEA and intrusions, blink rate and
duration, speech rate, pa-ta-ka rate, sustained ah, jitter, shimmer, HNR, CPP, rapid number
naming, immediate and delayed word recall, verbal fluency, symptom total. Quality gates on
face share, frame rate, brightness, iris pixel size and the flash test. A failing gate
deletes the eye metrics and keeps the speech ones. Tier B dies with the flash test.

**The agent.** A twelve step, fourteen minute script. A seven item red flag screen with a
hard stop, an emergency script, a clinic call and an emergency text. A banned phrase filter
(`diagnos`, `cleared to`, `return to play`, `medication dose`) on every patient facing line,
enforced twice: in the system prompt and in `safety.clean`. A short version rule on headache
or fatigue at 8 or above, or a 10 point symptom jump after eye block A.

**The app.** FastAPI with 30 contract routes plus `/api/photon/status`,
`/api/summary/{pid}/{week}` and a JSON root, two websockets (`/ws/rig`, `/ws/stimulus`), a
sqlite store with plain SQL, six seeded demo patients (week 0, stable, drifting, red flag,
low quality, template only), alert rules that produce the flags on each row, and a dummy
test harness at `/ui`.

**The rig.** FaceTime capture, BlackHole audio, screen capture, an AppleScript dialer and a
fifteen check preflight. Working, and about to become legacy.

## What runs on a fallback right now

| Thing | State | What makes it real |
|---|---|---|
| rig | mock, replays a generated session | `RIG_FACETIME_NUMBER`, and it is being replaced by the web call anyway |
| iMessage | mock, written to the messages table | Photon credentials plus the new sidecar |
| clinic call | mock, script logged | four Twilio keys, or the ElevenLabs agent |
| `cubnm` | not installed | falls back to ENIGMA HCP, which is already real |
| `sbi` | not installed | optional emulator upgrade behind `USE_SBI` |
| LLM | **live** on the model id in `.env` | see the warning below |

Everything else is real: nilearn, enigmatoolbox, mediapipe, cv2, faster_whisper,
parselmouth, librosa, mss, sounddevice, anthropic, twilio, numpyro are all installed, and
the atlases are fetched rather than modelled.

**One warning.** `.env` sets `CLAUDE_MODEL` to a model id that does not exist, and
`ANTHROPIC_API_KEY` is present, so `MOCK_LLM` is off and every live model call 404s. It
degrades silently because `llm.ask` falls back to the template on any error, so nothing
breaks, but nothing is phrased by the model either. The valid current ids are
`claude-opus-5`, `claude-sonnet-5`, `claude-fable-5` and `claude-haiku-4-5-20251001`.
`.env.example` will carry a valid default. Only the owner can change `.env`.

## Route list as found

```
GET  /api/health                              GET  /api/patients
POST /api/patients                            GET  /api/patients/{pid}
GET  /api/patients/{pid}/forecast             GET  /api/patients/{pid}/twin
POST /api/patients/{pid}/scenarios            POST /api/patients/{pid}/counterfactual
GET  /api/patients/{pid}/attribution          GET  /api/patients/{pid}/checkins
GET  /api/checkins/{cid}                      POST /api/checkins/{cid}/rescore
POST /api/checkins/{cid}/unusable             POST /api/patients/{pid}/uploads
GET  /api/patients/{pid}/twin-inputs          POST /api/patients/{pid}/build-twin
GET  /api/patients/{pid}/messages             POST /api/patients/{pid}/note
GET  /api/alerts                              POST /api/alerts/{aid}/ack
POST /api/alerts/{aid}/call                   GET  /api/cohort
GET  /api/rig/preflight                       POST /api/demo/reset
POST /api/demo/advance-week                   POST /api/demo/inject-drift
POST /api/demo/trigger-call                   GET  /api/consent/{token}
POST /api/consent/{token}                     POST /api/stretch/{token}
GET  /api/photon/status                       GET  /api/summary/{pid}/{week}
GET  /                                        GET  /consent/{token}
WS   /ws/rig                                  WS   /ws/stimulus
mount /stimulus                               mount /ui
```

## Test count by file

| File | Tests |
|---|---|
| `tests/test_api.py` | 24 |
| `tests/test_features.py` | 17 |
| `tests/test_safety.py` | 10 |
| `tests/test_twin.py` | 9 |
| `tests/test_data.py` | 9 |
| `tests/test_enkf.py` | 7 |
| total | 76 |

## Gaps against the four specs

**Spec 1, the 3D brain.** Nothing of it exists. There is no mesh at all: the twin serves
100 region centroids and the frontend is expected to draw spheres inside a shell. Missing:
`backend/data/mesh.py`, `make mesh`, fsaverage5 pial and inflated surfaces, per-vertex
Schaefer labels, per-vertex border flags, lobe tags, surface-recomputed region centroids
(the current ones are nilearn volume centres of mass, which do not sit on a surface),
`backend/twin/shape.py`, per-region `damage_lo`, `damage_hi`, `recovery` and `network`,
`backend/twin/intervention.py`, `GET /api/mesh`, `GET /api/patients/{id}/shape`,
`GET /api/receptors`, `POST /api/patients/{id}/intervention`, and the regional loadings
behind `REGIONAL_LOADINGS=1`. `Twin.regions[].activity` exists but comes from scaling the
healthy rate by damage rather than from the emulator per region.

**Spec 2, the web call.** Nothing of it exists. There is no `backend/calls/` package, no
call tokens, no `CallScript`, no `FrameRec` or `StimEvent` schema, no
`backend/features/webframes.py`, no camera latency estimate from browser-side flashes, no
`backend/agent/voices.py` and no ElevenLabs integration of any kind, no `comms/sms.py`, no
`notify()` with a recorded channel, no Node sidecar for Photon, and `CALL_MODE` is not read
anywhere. `comms/photon.py` exists but discovers an SDK by introspection under four guessed
module names and reads `PHOTON_API_KEY`, which the header says to replace with
`PHOTON_PROJECT_ID` and `PHOTON_PROJECT_SECRET`. The backend does not serve a built
frontend; `/` returns JSON and there is no SPA fallback. No `make web`, `make voices`,
`make tunnel`, `make models` or `make mesh`.

**Spec 3, the `web/` frontend.** The directory does not exist. `frontend/` is a single
`index.html` test harness and is explicitly not the product. `lovable-frontend/` is the
visual reference: TanStack Start, Tailwind v4 CSS-first tokens, Nunito and JetBrains Mono
from Google Fonts, `--radius: 1.25rem`, oklch tokens with a teal primary
(`oklch(0.43 0.065 172)`), amber `--synthetic`, a `panel` utility, soft and lift shadows, a
`science-grid` background, dark mode on a `.dark` class. It has most clinician screens at a
sketch level and a sphere-based `Brain3D.tsx`. The patient call page does not exist
anywhere, in any form. `prompts/` does not exist.

**Spec 4, the screens.** The contract types and routes are all served by the backend
already, so the frontend has something real to build against. Missing on the frontend side:
every screen, in the real app.

## Where the stated priorities land

P0 is: the web call page with voices, consent, red flags, calibration, pursuit, speech and
summary; the call routes and ingest; a text with the link; the clinician patient list and
overview in the Lovable theme; the holographic brain with damage and recovery over weeks;
and `make seed && make dev` serving all of it. None of that exists today. The twin and the
pipeline underneath it are built, tested and real, which is the half that takes the longest,
so the work is the two interfaces on top of it.
