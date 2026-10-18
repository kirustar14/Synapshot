<!-- The authority header from CLAUDE_CODE_MASTER_PROMPT.md. This beats every spec file. -->

# UNNAMED MASTER UPDATE PROMPT (new Claude Code session)

You are joining a project mid-build. Do not ask me questions. Make the call, log it in DECISIONS.md, and keep going. This file has a header (rules and added requirements) followed by four spec files pasted in full. Read the whole thing before touching code. Style rules for all code: simple code, short descriptive names, no n_ count variables (use len(x) or loop), complete files not snippets, one-line docstrings, no dead code, no em dashes anywhere in code, comments, or user-facing text.

## 0. First, read the app (do this before any change)
1. Read README.md, DECISIONS.md, `backend/app.py` (all routes), `backend/models.py`, `backend/twin/`, `backend/features/`, `backend/agent/`, `backend/comms/`, `rig/`, `tests/`, the Makefile, `.env.example`, and the `lovable-frontend/` folder (visual reference only).
2. Run `make test` and `make check` and record the results. Do not read or print `.env` values, only check which variable names exist.
3. Write `NOTES.md` with: what exists and works, what runs on mock fallbacks, the route list, the test count, and the gaps versus the specs below. Commit it. Then start.

## 1. What exists and what changed
Already built and tested (76 tests green): the brain twin (Schaefer-100 regions, HCP connectome and FC, Allen gene expression, dynamic mean field model, 1-D emulator, 200-member forecast with 80% bands, ensemble Kalman filter, NumPyro population layer), the measurement pipeline (flash trick, calibration, pursuit, saccade, antisaccade, fixation, blink, speech, memory, fluency, quality gates), the call agent with red flag screen and banned-phrase filter, the FaceTime rig code (now legacy), the FastAPI app with 30 routes and a test harness at `/ui`, synthetic cohort and demo patients, comms stubs.
What changes now, all of it in this one session:
1. The patient flow moves from a FaceTime rig to a WEB CALL: Photon iMessage (Twilio SMS fallback) sends a link, the patient opens a mobile web page, the page runs the whole script with ElevenLabs voices and measures on-device. (Spec files 2 and 3.)
2. A new frontend in `web/`, restyled to match the theme in `lovable-frontend/`, with every clinician screen. (Spec files 3 and 4.)
3. A realistic holographic 3D brain that lights up where the injury and damage are, shows changes over time, personal differences, uncertainty, and a drug what-if. (Spec file 1 plus section 3 below.)

## 2. Ground rules and conflict resolution
- Authority order when specs disagree: this header, then spec file 1, then 2, then 3, then 4. Wherever a spec says "Lovable" or "paste into Lovable", read it as "build it yourself in `web/`". `lovable-frontend/` is a reference for look and feel only, never import code from it blindly, never copy any `.env` from it (check it for secrets and tell me).
- Never print, log, echo, or commit a secret. `.env` stays in `.gitignore`. Only read the variable names listed in spec file 2. Photon credentials are now `PHOTON_PROJECT_ID` and `PHOTON_PROJECT_SECRET` (replace any PHOTON_API_KEY mention). Add them to `.env.example` blank.
- Send nothing in live mode to any number outside `DEMO_PHONES`. Keep `MOCK_*` switches working exactly as documented. `make check` must print which services are real and which fell back.
- Keep all 76 existing tests green. Add tests as the specs list. Commit after every step with a clear message. Keep `main` runnable at every commit.
- All patient data is synthetic. Label it everywhere. The agent never diagnoses, never clears anyone to return to play or driving, never gives medication advice. The drug what-if is a clinician-only hypothetical that never touches the forecast, alerts, summaries, or patient text.
- DNA does not change brain shape. Shape comes from age, sex, T1 volumes, and the injury. DNA shows up in the healing layer and the uncertainty. Say so on screen.

## 3. Added requirements (these extend the spec files)

### 3a. Holographic brain look (extends spec file 1, Part B)
The viewer stage is a dark panel inside the app theme (the rest of the UI keeps the Lovable theme). Build it so it looks like a medical hologram, not a flat map:
- Translucent cortex with additive blending and a strong fresnel rim glow (cool cyan by default). Render back faces first at low alpha so you see depth through the brain, then front faces. Inner body alpha about 0.15 to 0.35.
- A faint contour or wireframe overlay at low opacity, a soft grid floor, a vignette, and a slow scan sweep: a horizontal plane moving up and down that brightens vertices near it. Tiny particles drifting along the tracts.
- Region borders glow as thin lines. The backend supplies a per-vertex `border` flag (0 or 1, 1 when any neighboring vertex has a different region label). Hovering or selecting a region brightens its fill and its border and draws a leader line to a callout card.
- Damaged regions glow hot orange to red with a slow pulse and a very small jitter. Healing regions fade toward green. Uncertainty shows as shimmer. Drug effect is a violet to teal diverging glow with a ripple. Use bloom so glow reads.
- Plain-English callouts: each region gets a lobe or area tag (frontal, parietal, temporal, occipital, cingulate, insula, sensorimotor, orbitofrontal, temporal pole) derived heuristically from the Schaefer region name tokens in `data/mesh.py` and returned as `lobes: string[]` in the mesh payload (approximate, say so in DECISIONS.md). Show the 5 most affected regions as floating labeled callouts with leader lines, updated as the week changes, plus a list panel "Where it hurts" with names in plain language.
- Time: scrubber from week 0 to 12 with play, a ghost outline of week 0 under the current week, and a small timeline under the viewer showing the global damage curve with its uncertainty band and the current week marker. Weeks beyond the last real call are shown as forecast (dashed) and weeks with calls as measured.
- Injury replay, impact marker, personalization slider, inflate slider, tract flow shaders, layer switcher, scenario compare with two synced brains, what-if tab: all as in spec file 1.
- A "Hologram off" toggle gives a solid anatomical shading for print and export. A "Reduce motion" toggle disables the sweep, pulses, particles, and flow. 60 fps target with about 20k vertices, one draw call for the cortex, one for tracts, dispose on unmount.
- Mesh payload additions (extend `Mesh` in the contract): `border: number[]` (per vertex), `lobes: string[]` (per region). Add tests: border flags exist and are a minority of vertices, every region has a lobe tag.

### 3b. ElevenLabs everywhere it fits (extends spec file 2, Step 4 and Step 5)
- TTS: every script line, the emergency wording, and the wrap-up are pre-generated mp3s through the ElevenLabs API (key and voice id from `.env`). Banned-phrase filter runs before generation. Browser speech synthesis is only the fallback.
- STT: keep local `faster-whisper` as default. Add an optional `ASR=elevenlabs` backend using ElevenLabs speech to text (model name from memory, verify in the docs, probably `scribe_v1`) with the same function signature, so the recall, fluency, and speech tasks can run on either.
- Outbound clinic call: through the ElevenLabs conversational agent and phone number (`ELEVENLABS_AGENT_ID`, `ELEVENLABS_PHONE_NUMBER_ID`) when set, else Twilio, else mock. The spoken update must pass the banned-phrase filter and be read twice.
- Optional Q and A after the script (`LIVE_AGENT=1`): the ElevenLabs agent answers general questions with a banner that it cannot give medical advice. Its transcript is stored but never used for scoring or safety. Off by default.
- A "Voices" panel on the demo console (D1): shows each script line with a play button, its hash, and whether the mp3 exists, with a Regenerate button for one line.

### 3c. Photon to web interface (extends spec files 2 and 3)
- Flow: `POST /api/calls {patient_id, send:true}` creates the session and notifies. `notify()` tries Spectrum Cloud (`spectrum-ts`, project id and secret), then local `@photon-ai/imessage-kit`, then Twilio SMS, then mock, via a small Node sidecar called from `comms/photon.py`. Read the Spectrum and imessage-kit docs first, names and options are from search results, not tested. Record the channel used on each message row and never label an SMS as iMessage.
- Texts: consent request with link, heads-up the day before, midweek symptom check (reply parsed 0 to 10), post-call summary with the standard clinician sentence appended verbatim outside any model's reach, red flag emergency text. STOP withdraws consent.
- If Photon's mini-app API (buttons and forms inside the thread) is available in the SDK, use it for the midweek symptom check as an optional reach feature, otherwise plain reply parsing.
- The phone mock page (P2) shows the thread and the link bubble, and an "Open call page" button opens `/call/:token` in a phone-sized frame so judges see both.

### 3d. Tunnel and serving
FastAPI serves `web/dist` at `/`, the API at `/api`, `/voice`, and the old harness at `/ui`. `make tunnel` prints exact steps for `cloudflared tunnel --url http://localhost:8000` (preferred, ngrok free shows an interstitial warning page) and says to put the HTTPS URL in `PUBLIC_URL`. iOS requires HTTPS for the camera.

## 4. Work plan (use parallel subagents with separate worktrees if you can)
Backend agent owns `backend/`, `rig/`, `Makefile`, `tests/`. Frontend agent owns `web/`. The contract in the spec files is the source of truth between them. Lead merges and runs the full test suite.

Priority order, finish each tier and commit before starting the next:
- P0 (must work end to end): web call page with ElevenLabs voices, consent, red flags, calibration, pursuit, speech, summary; call routes and ingest; Photon or SMS text with the link; the clinician dashboard patient list and overview in the Lovable theme; the holographic 3D brain with damage, recovery over weeks, impact marker, where-it-hurts callouts; `make seed && make dev` serving everything.
- P1: all remaining screens, all layers, personalization and inflate sliders, injury replay, scenario compare, what-if tab, cohort page, live call console, demo console with voices panel, clinic call via ElevenLabs.
- P2 (reach): regional loadings (Step 5 of spec file 1, behind its flag), signal-driver layer, counterfactual slider, tract attribution, antisaccade and fixation, blink and expression traces, ASR=elevenlabs, LIVE_AGENT, gait and hearing page, Playwright smoke test, Auth0 optional login.
Now is Saturday evening and submission is at 12:00 PDT tomorrow, so cut P2 items freely if P0 and P1 are not solid, and say what you cut.

## 5. Verification and final report
- `make test` green (existing 76 plus the new tests in the specs). `cd web && npm run build` passes. `make check` prints real versus fallback for ElevenLabs, Photon, Twilio, ffmpeg, mesh, voices, MediaPipe model, tunnel tool.
- Run a full mock web call through `POST /api/demo/trigger-call` and show the twin updating, the 3D brain changing, an alert firing, and the summary text.
- Final message: a checklist of what is real, what is on a fallback, what you cut, and the exact steps I must do by hand (Photon permissions, tunnel URL, iPhone test of camera latency and flash detection, ElevenLabs voices generated, consent from anyone I text).

---
