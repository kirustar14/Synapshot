<!-- Split out of CLAUDE_CODE_MASTER_PROMPT.md. The master prompt header wins wherever this file disagrees with it. Read 'Lovable' as 'build it yourself in web/'. -->

# SPEC FILE 3 of 4: web/ frontend in the Lovable theme and the patient call page

# CLAUDE CODE PROMPT: build the real frontend (`web/`) in the Lovable theme, plus the patient call page

Do not ask me questions. Make the call, write it in `web/DECISIONS.md`, commit after each step. No em dashes in any copy. Simple code, short names, no n_ count variables, complete files.

## Inputs already in this repo
- `lovable-frontend/`: a frontend I exported from Lovable. It is the VISUAL REFERENCE. Take its look, not its screens.
- `prompts/`: put these three files here before you start if they are missing, and tell me: `lovable_frontend_prompt.md` (all clinician and patient screens plus the shared API contract), `update_prompt_3d_brain.md` (Part B is the 3D brain viewer spec), `prompt_webcall_backend.md` (the call routes and contract at the bottom).
- The backend is built and serves the API at `/api` on port 8000.

## Step 1: read the theme
Read `lovable-frontend/` end to end: `tailwind.config`, `index.css` or global styles, fonts (family, weights, how loaded), color tokens, radii, shadows, spacing, background treatment (gradients, textures, noise), component styles (buttons, cards, inputs, tables, badges), motion, and the layout shell. Write `web/THEME.md` with the exact tokens, fonts, and rules you found (copy values, do not paraphrase). If a font file is bundled, reuse it. If it is loaded from a CDN, load it the same way.

## Step 2: scaffold `web/`
Vite, React, TypeScript, Tailwind, shadcn/ui, React Router, TanStack Query, Zustand, Recharts, three, @react-three/fiber, @react-three/drei, @react-three/postprocessing, `@mediapipe/tasks-vision`. Copy the theme tokens, fonts, and background into the new app so it looks like the Lovable reference. Same-origin API: base URL is `/api` by default, `VITE_API_URL` overrides it. Keep a mock layer (seeded, every contract shape) used when the API health call fails, with a "Mock data" badge. `npm run build` outputs `web/dist`, which the backend serves.

## Step 3: build every screen
Implement ALL screens, behaviors, mock data, and reach features from `prompts/lovable_frontend_prompt.md` (C0 upload, C1 patients, C2 overview, C3 twin viewer, C4 scenario compare, C5 call log, C6 alerts, cohort, R1 rig console, R2 preflight, D1 demo console, P1 consent, P2 phone mock, P4 gait and hearing). Then replace the 3D viewer with the full spec in Part B of `prompts/update_prompt_3d_brain.md` (real cortical mesh, shader layers, bloom glow, personalization slider, inflate, tracts, injury replay, what-if tab). Use the real mesh from `GET /api/mesh` or `/mesh.json` in `public/`, and a procedural placeholder with a visible badge if neither exists. Apply the Lovable theme to every one of these screens.
Changes to the earlier spec:
- R1 Rig console is now the "Live call" console: it shows a patient's web call as it happens (gaze dot, target, quality lights, step, transcript) from the same `/ws/rig` events. Keep the name R1 in routes.
- D1 Trigger call now creates a call link (`POST /api/calls`), shows the link and a QR code, and has a Send text button (`send:true`). Show which channel delivered it (iMessage, SMS, or mock) from the message row, never claim iMessage when it went by SMS.
- P2 phone mock shows the thread with the link bubble, and a "Open call page" button that opens `/call/:token` in a phone-sized frame so the audience sees both.

## Step 4: the patient call page `/call/:token` (mobile first, the most important screen)
Same Lovable theme, big touch targets, calm, one task per screen, portrait, minimal text. Always visible: a progress bar, a Pause button, and "Stop and contact my clinic". Stages, in order, driven entirely by `GET /api/call/{token}/script`:
1. Consent: the consent text from the script, three required toggles (calls, AI disclosure, recording) and one separate optional genetic toggle default off. "This assistant is software, not a person." State that video never leaves the phone, only measurements do, and audio is uploaded for speech tasks. Post consent.
2. Permissions and setup: request camera and microphone, request a screen wake lock, show a live self-view small with a face guide. Checks with green ticks: face found, distance (iris pixel size), light (brightness), steady. Instructions: prop the phone, same light on your face, no glasses glare if possible.
3. Red flag screen: seven big Yes and No buttons, one question at a time, with the voice line. Post the answers, and if `stop` is true show the emergency screen from the response and play its audio, and end. The page never decides the outcome.
4. Calibration: nine dots, 1 s each, logging every dot as a StimEvent.
5. Then every other step from the script in order, each with its voice line (mp3 from `voice_base` + `audio`, fallback to `speechSynthesis` if no audio), then the task:
 - symptoms: 8 items on a 0 to 10 big-number picker, post, and obey the returned `short` flag to skip blocks.
 - encode and recall: show the 15 words one by one with voice, then later record the spoken recall.
 - pursuit_h and pursuit_v: a dot moving as a sine on a `<canvas>`, drawn with requestAnimationFrame, log target x,y every frame.
 - saccade: target jumps, each trial starts with a one-frame full-screen white flash. Log the flash with the rAF timestamp, and run 10 test flashes in the quality step too.
 - antisaccade: 20 trials, target left or right, look the other way.
 - fixation: 10 s centre dot.
 - npc: number cards drawn in code, record speech.
 - speech_ah, speech_pataka, speech_passage: show instruction, record audio with MediaRecorder (pick the supported mime type, Safari gives mp4), upload to `/audio/{task}`.
 - picture: draw an original kitchen scene in code (SVG or canvas, do not use any copyrighted test picture), record 60 s of speech.
 - fluency: animals for the given seconds, record.
 - wrap: thank you screen, status polling until `done`, then show the plain-language summary text returned (no scores, no diagnosis).
6. Measurement: a Web Worker or the main thread runs MediaPipe Face Landmarker (IMAGE or VIDEO mode, iris landmarks, blendshapes on), model file loaded from `/models/face_landmarker.task` (add a `make models` script that downloads it into `web/public/models/`, URL from memory, verify, commit nothing large if over limits). On every video frame (use `requestVideoFrameCallback`, fall back to rAF) build a FrameRec: `t` from `performance.now()`, `cap` from `captureTime` if available, face flag, iris-based horizontal and vertical ratios, iris pixel size, head pose, eye openness, mean brightness of the face region, smile, brow_down, jaw_open. Batch FrameRecs and StimEvents per task and POST to `/frames` in chunks. Post a compact `/live` event about every 200 ms. Never send video.
7. Robustness: if the face is lost for more than 3 s, pause the task and show "move back into frame", retry the trial. If the tab goes to background, pause. If the network drops, buffer and retry, show a calm banner. Disable pinch zoom, lock scroll, keep the screen on. Handle denied camera or mic with a clear explanation and a "tell my clinic" option.
8. Accessibility: large text option, high contrast, voice lines also shown as captions, reduce motion, all buttons reachable by keyboard.

## Step 5: tests and checks
- Vitest for the call state machine (stage order, short-version skipping, stop on red flag, pause on face loss).
- Type check passes, `npm run build` passes, bundle loads on a 390x844 viewport.
- A Playwright smoke test using Chromium fake media flags (`--use-fake-device-for-media-stream`, `--use-fake-ui-for-media-stream`) that opens `/call/:token` against the mock backend and reaches the wrap screen. Mark it optional if it takes more than 20 minutes.
- Lighthouse style check for the call page: no layout shift, buttons at least 48 px.

## Done means
`cd web && npm run build` produces `dist`, the backend serves it at `/`, every screen from the spec renders in the Lovable theme with real or mock data, `/call/:token` runs a full call on a real iPhone over the HTTPS tunnel and posts frames, audio, and answers, and the 3D brain looks like a brain and glows where the model says damage is. Print a checklist of what works and what is on a fallback.
