<!-- Split out of CLAUDE_CODE_MASTER_PROMPT.md. The master prompt header wins wherever this file disagrees with it. Read 'Lovable' as 'build it yourself in web/'. -->

# SPEC FILE 2 of 4: web call backend, voices, comms, serving

# CLAUDE CODE PROMPT: switch UNNAMED from FaceTime rig to a web call (backend session)

Read README.md, DECISIONS.md, and the current contract first. 76 tests are green and must stay green. Do not ask me questions, make the call and write it in DECISIONS.md. Commit after every step. Same style rules as before: simple Python, short names, no n_ count variables, complete files, no em dashes.

## Why we are changing
The FaceTime rig needs OBS, BlackHole, macOS permissions, and a second device, and call lag corrupts timing. New plan: Photon (or SMS fallback) texts the patient a link, the patient opens a mobile web page, and the page itself draws the stimuli, records, and measures on the same phone. Stimulus and camera share one clock, so reaction timing is direct. Keep the FaceTime code in the repo behind `CALL_MODE=facetime`, default is now `CALL_MODE=web`.

## Secrets (do this first)
- Make sure `.env` is in `.gitignore` and was never committed (`git log --all -- .env`). If any key was ever committed, stop and tell me in the first line of your final message.
- Never print, log, or echo a key. Never send a key to the frontend. Only read these names from `.env`: ANTHROPIC_API_KEY, CLAUDE_MODEL, ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID, ELEVENLABS_AGENT_ID, ELEVENLABS_PHONE_NUMBER_ID, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER, PUBLIC_URL, PHOTON_*, CLINIC_NUMBER, DEMO_PHONES, MOCK_*, CALL_MODE. Ignore every other variable in `.env`. Update `.env.example` with these names and blank values.
- `DEMO_PHONES` may only hold numbers of people who agreed to be texted. Send nothing to any number outside it in live mode.

## Step 1: call sessions and routes (`backend/calls/`)
Add these routes under /api. Tokens are 32 random bytes urlsafe, one session each, expire in 24 h, stored with patient id, state, and timestamps. Rate limit per token and per IP. In live mode lock CORS to PUBLIC_URL.
- `POST /calls {patient_id, send}` -> `{token, url, expires}`. `url` = PUBLIC_URL + "/call/" + token. If `send` is true, text it (Step 5).
- `GET /call/{token}/script` -> `CallScript` (marks the session opened).
- `POST /call/{token}/consent {calls, ai, recording, genetic}` stores consent (genetic default false). No tasks run without calls, ai, and recording true.
- `POST /call/{token}/redflags {answers}` -> `{stop, say, audio}`. Backend decides, not the page. Any yes: create the red_flag alert, send the emergency text, phone the clinic, mark the session stopped, and return the emergency wording and its audio file. A clinician must confirm the question list before any non-teammate use (keep that comment).
- `POST /call/{token}/symptoms {scores, phase}` -> `{jump, short}`. Apply the existing short-version rule (headache or fatigue 8 or more, or a jump after eye block A) and return which blocks to skip.
- `POST /call/{token}/live {t, gaze, target, quality, step, line?}` fire and forget, about every 200 ms. Forward to the existing rig hub so the R1 console shows the live call as a RigEvent.
- `POST /call/{token}/frames {task, meta, frames, stim}` per task, chunked. `meta` = `{w_px, h_px, dpr, ua, fps}`.
- `POST /call/{token}/audio/{task}` multipart audio (Safari sends mp4/aac, others webm/opus or ogg). Decode with ffmpeg to 16 kHz mono wav. Fail clearly if ffmpeg is missing.
- `POST /call/{token}/finish {aborted}` -> `{ok, call_id}`. Runs the pipeline in a background task.
- `GET /call/{token}/status` -> `{state: "waiting"|"in_call"|"stopped"|"processing"|"done"|"failed", call_id?, summary?}`.
Also change `POST /demo/trigger-call` so in web mode it creates a session and sends the link, and in mock mode it generates a web-style session through the same ingest code so the demo works with no phone.

## Step 2: contract additions (frontend builds against these, do not rename)
```ts
interface CallStart { token: string; url: string; expires: string }
interface ScriptStep { id: string; say: string; audio?: string;
  task: "none" | "redflags" | "quality" | "calib" | "symptoms" | "encode" | "pursuit_h" | "pursuit_v" | "saccade" | "antisaccade" | "fixation" | "npc" | "speech_ah" | "speech_pataka" | "speech_passage" | "picture" | "fluency" | "recall" | "wrap";
  minutes: number; tier: "A" | "B" | "safety" | "gate" | "none"; block?: "A" | "B"; params: Record<string, unknown> }
interface CallScript { consent: string[]; steps: ScriptStep[]; voice_base: string; symptom_items: string[]; redflag_items: string[];
  words: string[]; passage: string; picture: "kitchen"; fluency_seconds: number }
interface FrameRec { t: number; cap?: number; face: boolean; ratio: { h: number; v: number };
  iris: { lx: number; ly: number; rx: number; ry: number }; iris_px: number;
  head: { yaw: number; pitch: number; roll: number }; ear: { l: number; r: number }; bright: number;
  blend: { smile: number; brow_down: number; jaw_open: number } }   // t and cap in ms, browser clock
interface StimEvent { t: number; kind: string; x?: number; y?: number; flash?: boolean; trial?: number; side?: "L" | "R" }  // x,y in 0..1 of the canvas
```
The browser runs MediaPipe Face Landmarker on the phone and sends only FrameRecs, never raw video. Audio is the only raw media that leaves the device.

## Step 3: ingest and pipeline (`backend/features/webframes.py`, `pipeline.py`)
- Validate FrameRec and StimEvent schemas with pydantic, reject malformed or absurd values (t not increasing, more than 90 fps, values outside 0..1 where required).
- Reuse the existing gaze calibration, pursuit regression, fixation, antisaccade, blink, quality gate, speech, memory, fluency, and EnKF code. Calibration now uses exact screen coordinates from the stim log for the nine dots, fit on all settled frames, and reports residual error in degrees.
- Camera latency from the flash: the page draws 10 test flashes. Camera latency is the median over trials of (brightness rise time in the frames) minus (flash draw time in the stim log). Subtract it from saccade and antisaccade latencies. If fewer than 8 of 10 flashes are detected, or the spread (sd) of the per-trial latency is above 25 ms, set `flash_ok` false and drop every tier B metric for that call, exactly as before.
- Face distance check from `iris_px`, light check from `bright`, frame rate from `meta.fps` and actual spacing. Quality gate rules unchanged: any fail deletes the eye metrics and keeps the speech ones.
- Delete audio files after features are extracted unless `KEEP_AUDIO=1`.
- `CALL_MODE=facetime` keeps the old capture path working. Default is web.
- Update the mock session generator to emit FrameRecs and a StimEvent log with a known camera delay, so the real web pipeline is exercised end to end with no phone.

## Step 4: voice lines with ElevenLabs (`backend/agent/voices.py`, `make voices`)
- Every spoken line in the script (all steps, safety and emergency wording, wrap up) is pre-generated as an mp3 with the ElevenLabs text to speech API using `ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID`. Model name from env `ELEVENLABS_TTS_MODEL`, default `eleven_multilingual_v2` (from memory, verify). Voice settings calm and slow.
- Run every line through the existing banned-phrase filter BEFORE generating. Refuse to generate a line that fails.
- Save to `backend/data/voice/<step id>.mp3`, write `manifest.json` with line text, hash, and duration. Regenerate only lines whose hash changed. Serve at `/voice/<file>`. `GET /call/{token}/script` fills `audio` for each step.
- If the key is missing or a file is missing, return no `audio` and the page falls back to the browser's speech synthesis. Add a test that the manifest has a file for every step.
- Do NOT put a live conversational agent in the safety or measurement path. Optional reach, off by default (`LIVE_AGENT=0`): after the script ends, an ElevenLabs conversational agent (`ELEVENLABS_AGENT_ID`) answers general questions, with a banner that it cannot give medical advice. Its transcript is stored but never used for scoring or safety.

## Step 5: comms
- `comms/photon.py`: use Photon's SDK if installed and PHOTON keys exist. Read the Photon docs from the hackpack at runtime. Otherwise fall back.
- `comms/sms.py`: Twilio SMS fallback using the TWILIO_* values, with the same interface (`send(to, body)`). The consent text, link, midweek check, summary, and emergency text all go through one `notify(patient, kind)` function that tries Photon, then SMS, then mock, and records which channel it used on the message row. Say plainly in the UI data (`channel` field) and in the README when a text went by SMS and not iMessage, because the Photon challenge needs real iMessage.
- Clinic call: if `ELEVENLABS_AGENT_ID` and `ELEVENLABS_PHONE_NUMBER_ID` are set, place an outbound call to `CLINIC_NUMBER` with the ElevenLabs conversational AI outbound call API, passing the structured clinician update as the first message and context (from memory, check the docs). Else Twilio TwiML reading the update twice. Else mock. The script text must pass the banned-phrase filter.
- STOP withdraws consent as before.

## Step 6: serving and the tunnel
- FastAPI serves the built frontend from `web/dist` at `/` (SPA fallback to index.html for non-API paths), the API at `/api`, voices at `/voice`, the old harness at `/ui`. One origin means no CORS problem and one HTTPS URL for the phone.
- `make web` runs the frontend build. `make tunnel` prints the exact steps to expose port 8000 and set PUBLIC_URL. Prefer `cloudflared tunnel --url http://localhost:8000` because ngrok free shows an interstitial warning page on first visit that can confuse a patient (the ngrok URL in `.env` works but the warning appears once per browser). iOS needs HTTPS to open the camera, so localhost links do not work on the phone.

## Step 7: tests (all existing 76 stay green)
- Schema validation rejects bad frames.
- Camera latency recovery: synthetic frames with a known camera delay of 80 ms, estimate within 15 ms, saccade latency recovered within 20 ms.
- Flash failure (fewer than 8 detected) drops tier B only.
- Full mock web call end to end: session created, red flags clear, frames and audio ingested, pipeline run, twin updated, alert rules run, summary created.
- Red flag yes: stop, alert, emergency text, clinic call, no frames accepted afterward.
- Token: one session, expires, unknown token gives 404, rate limit works.
- Every voice step has audio or a documented fallback, every line passes the banned-phrase filter, the manifest hash check works.
- `notify` falls back Photon to SMS to mock and records the channel.
- No secret appears in any log line or API response (grep test over a full mock run).
- `make check` updated: PUBLIC_URL is https and reachable, ElevenLabs key valid (a cheap authenticated GET, never print the key), voices generated, Twilio creds present, ffmpeg present, MediaPipe model file present in `web/public/models/`, tunnel tool present.

## Step 8: docs
README: web call run order, "Run this first" is now a real iPhone test of the flash and camera latency (90 minutes), update "Honest limits" (synthetic patients, placeholder SEMs, Photon untested until a key exists, SMS is not iMessage, camera latency estimated not measured with hardware). DECISIONS.md: why web replaced FaceTime and what we lost (the phone ringing moment, the call lag trick).

## Done means
`make voices && make seed && make test && make dev` work, a mock web call runs start to finish through `POST /demo/trigger-call`, `make check` prints what is real and what fell back, and the contract above is served exactly. Print a final checklist.

---
# Shared contract for the call page routes (the frontend session builds against this)
Routes under /api: POST /calls, GET /call/{token}/script, POST /call/{token}/consent, POST /call/{token}/redflags, POST /call/{token}/symptoms, POST /call/{token}/live, POST /call/{token}/frames, POST /call/{token}/audio/{task}, POST /call/{token}/finish, GET /call/{token}/status. Request and response shapes are in Step 1 and Step 2 above.
