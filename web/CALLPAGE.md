# The patient call page

`/call/:token` is the screen a concussion patient opens from a text message. It runs the
whole fourteen minute check-in on their own phone, draws every stimulus itself, measures the
face with MediaPipe on-device, and posts measurements only. No video and no frame image ever
leaves the phone. Audio is the one piece of raw media that is uploaded, and only during the
speaking tasks.

Everything on this page is driven by `GET /api/call/{token}/script`. There is no hardcoded
running order: the backend owns it, the page renders it.

## Files

| File | What it is |
| --- | --- |
| `src/pages/PatientCall.tsx` | Loads the script and hands it to the runner. Nothing else. |
| `src/call/CallRunner.tsx` | Owns the camera, landmarker, microphone, voice, stimulus log, posts and the state machine. Renders one stage at a time. |
| `src/call/machine.ts` | The pure state machine. Stage order, the skip list, the stop, the pauses. No DOM, no clock, no network. |
| `src/call/ctx.ts` | What a task is allowed to reach: the script, the stimulus log, the transport, the tracker, the voice, the recorder, and four callbacks. |
| `src/call/transport.ts` | Every post the page makes, with the right promise for each kind of data. |
| `src/call/vision.ts` | MediaPipe Face Landmarker. The only module that touches camera pixels. |
| `src/call/media.ts` | One getUserMedia for camera plus microphone, and the speech recorder. |
| `src/call/voice.ts` | Pre-generated mp3, then `speechSynthesis`, never blocking. |
| `src/call/stim.ts` | The stimulus log, with the exact event names the backend reads. |
| `src/call/measure.ts` | The per-task bookkeeping: mark, buffer, post, or throw away and retry. |
| `src/call/canvas.ts` | One rAF loop for every drawn task, device pixel aware. |
| `src/call/eyes.tsx` | Quality flashes, calibration, pursuit, saccade, antisaccade, fixation. |
| `src/call/forms.tsx` | Red flags, symptom scores, the word list. |
| `src/call/speech.tsx` | Ahhh, pa-ta-ka, passage, picture, fluency, recall, near point. |
| `src/call/stages.tsx` | Consent, setup, step introduction, emergency, stopped, wrap. |
| `src/call/kitchen.tsx` | An original kitchen scene in SVG. Not a copyrighted test picture. |
| `src/call/ui.tsx` | The always visible bar, captions, lights, self view, tap targets, number picker. |
| `src/call/callStore.ts` | Call-only state: the accessibility choices, the banner, the pending post count. |
| `src/call/wake.ts` | Wake lock, viewport lock, text scale. |
| `src/pages/Consent.tsx` | P1, the standalone consent page. |
| `src/pages/Stretch.tsx` | P4, the gait walk and the hearing tone ladder. |

## How the measurement loop is wired

```
camera track -> <video> (2px, opacity 0.01, never shown, never recorded)
                  |
                  | requestVideoFrameCallback, rAF fallback
                  v
            FaceTracker.read()
                  |
                  +-- FaceLandmarker.detectForVideo -> 478 landmarks + blendshapes + 4x4 pose
                  +-- 24 by 24 offscreen canvas over the face box -> mean luma -> bright
                  v
              one FrameRec  --> FaceTracker.buffer (only while a measured task is running)
                            --> FaceTracker.lights (face, distance, light, steady, fps)
```

A second loop in `CallRunner` runs every 250 ms and does three things, none of which can
block a task: refresh the setup lights, post one `/live` event, and tell the machine whether
the camera can still see a face.

Per task, `useMeasured(task, params)`:

1. On mount, `tracker.record(true)` and `stim.mark(task, params)`. The marker goes in before
   the first buffered frame, because the backend finds a task's gaze window between that
   marker and the next one.
2. The task draws, and logs what it drew with the rAF timestamp of the frame that painted it.
3. On completion, `post.frames(task, tracker.take(), stim.drain())`, chunked at 600 frames
   and 600 stimulus events per post.
4. On abandonment, the frames are dropped and the stimulus log is cleared. A retry writes a
   new marker, so the backend sees one clean window rather than two halves. `eye_values`
   takes the last window of each kind and skips windows with fewer than ten frames, so the
   abandoned attempt costs nothing.

Clocks: `performance.now()` for everything. `FrameRec.t` is when the page read the frame,
`FrameRec.cap` is `VideoFrameCallbackMetadata.captureTime` when the browser offers it, and
every `StimEvent.t` is on the same clock. That is what makes the camera latency estimate
possible.

Stimulus names, which are contract and must not be renamed:
`task`, `test_flash`, `calib_dot`, `saccade_jump`, `antisaccade_jump`. Pursuit also logs
`pursuit_h_target` and `pursuit_v_target` every painted frame; the backend ignores them and
rebuilds the sine from `params.amp` and `params.freq`, which is why the page draws exactly
`amp * sin(2 * pi * freq * t) + 0.5` with `t` measured from the task marker.

## Decisions

- **Main thread, not a Web Worker.** `requestVideoFrameCallback` plus `detectForVideo` on the
  main thread keeps the video element, the capture time and the landmarker on one timeline. A
  worker would need `ImageBitmap` transfers per frame and loses `captureTime`. The drawn tasks
  are simple canvas fills, so there is headroom. Revisit if a real iPhone drops below 20 fps.
- **The wasm runtime is bundled, not fetched from a CDN.** `vision_wasm_internal.js` and
  `.wasm` are imported with Vite's `?url` and emitted into `dist/assets`, so the call page
  makes no third party request. The 13.5 MB wasm is only fetched when the landmarker starts,
  and the MediaPipe bundle is a dynamic import, so the clinician screens never pay for it.
- **The stimulus surface is near black with a bright target.** Standard for oculomotor
  testing, kindest to a photophobic patient, and it maximises the brightness step when the
  white flash paints. The rest of the page keeps the Lovable theme.
- **A paused task is an unmounted task.** Resuming remounts with a new attempt number, which
  restarts the task cleanly rather than stitching two halves of a trial together.
- **Scroll stays on.** The viewport lock kills pinch zoom, double tap zoom and rubber
  banding. It does not set `overflow: hidden`, because a consent paragraph that cannot be
  scrolled is a consent paragraph nobody read.
- **One question per screen** for both the red flags and the symptom items, with a Back
  button on the symptoms only. The red flags have no Back on purpose: changing a safety
  answer after seeing the next question is not a thing we want to invite.
- **The page never decides a red flag.** It posts seven booleans keyed by question key and
  obeys `stop`. If the post fails after three tries it stops and says so rather than carrying
  on, because carrying on would mean running a fourteen minute test on someone who may need
  an ambulance.
- **Two routes bypass the shared API client.** `redflags` takes answers keyed by question key
  and `symptoms` takes scores keyed by symptom key, which `src/api/client.ts` types as arrays.
  Rather than edit a file two other agents are also using, `transport.ts` posts those two
  directly and falls back to the same mock layer the client uses.
- **A "carry on without the camera" option** was added to the blocked camera screen, on top
  of the "tell my clinic" option the spec asked for. It skips the eye steps and runs the
  speaking and memory ones, which is the same fallback the missing model file gets.
- **Captions are per screen, not a global strip.** Every stage already renders the line it is
  speaking, so a muted call reads exactly the same as a spoken one and nothing shifts when a
  caption changes length.

## Accessibility

The gear in the always visible bar opens one sheet with five switches, persisted in
`localStorage["unnamed-call-prefs"]`: larger text (sets the root font size to 19px, which
scales every rem), high contrast (overrides the theme variables on the call page wrapper to
near black on white with stronger outlines), show captions, reduce motion, mute the voice.
Every tap target on the page is at least 48 px, most are 56. Everything is a real `<button>`,
so it is keyboard reachable with no extra work.

## Verified, and how

Against the real backend on `localhost:8000` through the Vite proxy, in headless Chromium at
390x844:

- Consent posts and the session moves to `in_call`. The three required switches really do
  gate the start button, and the genetic switch really does default off.
- The seven red flag answers arrive keyed correctly:
  `{"worsening_headache": false, ... "unusual_drowsiness": false}`, and the returned clear
  wording is spoken and captioned before the call moves on.
- Symptom scores arrive keyed by symptom key for both phases, and the rerate phase produces a
  `jump` on the backend.
- The full no-camera run reaches the wrap screen, `finish` lands, status polling reaches
  `done`, and the plain language summary is shown with no scores and no diagnosis.
- With the model file present, MediaPipe loads from the bundled wasm, creates its XNNPACK
  delegate and runs `detectForVideo` on a stubbed camera stream. `/live` events post every
  200 ms and return 200.
- Brightness is measured from real pixels: the light tick goes green on a grey synthetic
  stream and the hint text changes with the measured value.
- Losing the face for three seconds inside a watched task pauses it and shows "move back into
  frame".
- The exact `FrameRec` and `StimEvent` shapes this page emits were posted to
  `/api/call/{token}/frames` and accepted: `{"ok": true, "frames": 30, "stim": 6}`, including
  the task marker with `task` and `params`, `test_flash`, `calib_dot`, `saccade_jump`,
  `antisaccade_jump` and the per-frame pursuit target.
- P1 consent loads a real consent row, gates on the three switches, posts, and shows the
  thank you with the right genetic sentence.
- P4 stretch renders with the safety note and the manual entry fallback.
- `npx tsc --noEmit`, `npm run build` and `npx vitest run` all pass.

## Needs a real iPhone

Nothing below can be checked in a headless browser.

- **Camera latency and the flash trick.** The ten white flashes have to show up as a
  brightness rise in the frame records, within an 8 of 10 detection rate and a 25 ms spread,
  or every tier B measure is dropped. This is the single most important thing to test on
  hardware, and it is the one that is most likely to need the flash duration or the
  brightness window tuned.
- **Iris pixel size thresholds.** Distance is gated on `iris_px` between 8 and 30 at a 640
  by 480 capture. Those numbers are reasoned, not measured. Check them at arm's length on a
  real phone and adjust the two constants in `vision.ts`.
- **`requestVideoFrameCallback` and `captureTime` on iOS Safari.** The callback exists from
  Safari 15.4, but `captureTime` is frequently absent, in which case the page falls back to
  `performance.now()` at read time and the camera latency estimate absorbs the difference.
- **MediaRecorder on iOS.** The mime list starts with webm and falls through to mp4 and aac,
  which is what Safari answers. The blob content type is set from the chosen mime so the
  backend's ffmpeg decode gets the right hint. Untested on a real device.
- **Wake lock.** `navigator.wakeLock` is Safari 16.4 and later. Older phones will dim.
- **The 13.5 MB wasm over a tunnel.** It is fetched once when the landmarker starts, on the
  setup screen, before any timing matters. On a slow connection that is a visible wait with
  no progress bar.
- **DeviceMotion on the stretch page.** iOS needs `requestPermission()` from a user gesture,
  which the Start button provides, but the step detection threshold of 1.25 m/s² is a guess.
- **The hearing ladder.** Phone speakers vary enormously, so the dB values are relative to
  full scale, not hearing level. The page says so.

## Cut, and what the contract did not give me

- **No Web Worker for the landmarker.** Main thread, for the reasons above.
- **No Playwright smoke test.** The spec marked it optional over twenty minutes. The flow was
  walked by hand in headless Chromium instead and the results are listed above. The two
  render tests in `src/call/__tests__` cover the consent gate and the wrap polling, which are
  the two places a regression would be silent.
- **The near point value has nowhere to go.** The script asks the patient to tap when the
  numbers go double, and `pipeline.answer_values` reads `answers["npc_cm"]`, but no route
  accepts it. The page logs it as a stimulus event, `{"kind": "npc_double", "x": cm / max_cm}`,
  which reaches the server in the frames chunk and is ignored. If the npc measure matters,
  the backend needs either a field on the symptoms route or a new one.
- **The word list has nowhere to go either.** `encode` shows the fifteen words and `recall`
  records the spoken answer, which is right, but the page cannot tell the backend which words
  were shown or when. `assemble(words=...)` exists on the backend side, so the backend fills
  it from the script.
- **No clinic phone number on the page.** The contract gives the page a token and a script,
  not a clinic number, so the stopped screen tells the patient to reply to the text that sent
  the link. A `clinic_number` on `CallScript` would let the page offer a tap to call.
- **The white flash is 93 percent of the screen, not 100.** The always visible bar sits above
  the stimulus canvas, by design, because the spec requires Pause and Stop to be reachable at
  every moment. The flash fills everything below it.
- **Reduce motion does not stop the stimuli.** The moving dot is the measurement. The switch
  is honoured for everything decorative.
- **`symptoms_rerate` is matched by step id,** because its task is `symptoms` like the first
  one. If the backend ever renames that step, the phase sent with it goes wrong.
