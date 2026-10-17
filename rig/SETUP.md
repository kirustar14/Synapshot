# Rig setup

The rig is one Mac that places a FaceTime call, shows the patient a stimulus page as if it
were the camera feed, and records what comes back. Everything below has to be true before
`make rig` will do anything other than fall back to the mock session.

Budget two hours the first time. Run `make preflight` after every step: it tells you
exactly which of these is still wrong.

## 0. Consent, before anything technical

Whoever is on the other end is a person, not a test fixture. Before the first call:

- Tell them the call is recorded, what is measured, and that the measurements go to a
  dashboard they can see.
- Tell them the agent is not a clinician, will not tell them what is wrong, and will not
  tell them when they can play or drive again.
- Tell them they can say stop at any point, that the call ends there, and that replying
  STOP to any text withdraws consent for good.
- Get it in writing. `POST /api/consent/{token}` records the four separate answers (calls,
  AI, recording, genetic) and the demo consent page is at `/consent/{token}`.

Nothing in this repo is a substitute for a clinician confirming the red flag list in
`backend/agent/safety.py`.

## 1. Backend and stimulus page

```sh
make seed     # builds the cohort and the demo patients, about 15 s
make dev      # serves the API, the websockets and the stimulus page on :8000
```

Open <http://localhost:8000/stimulus/> in Safari or Chrome. You should see a dark portrait
page with a calm face on it, and the status line in the corner should read
`stimulus: connected`. If it says `closed, retrying`, the backend is not up.

## 2. OBS, so FaceTime sends the stimulus page instead of a camera

1. Install OBS (`brew install --cask obs`).
2. New scene, then add a **Browser** source.
3. URL `http://localhost:8000/stimulus/`, width **1080**, height **1920**.
4. Tick **Shutdown source when not visible** off, and **Refresh browser when scene becomes
   active** on.
5. Right click the source, **Transform**, **Fit to screen**.
6. Set the canvas to portrait: **Settings**, **Video**, base and output resolution
   **1080x1920**, FPS **30**. A 16:9 canvas letterboxes the page and the patient sees two
   black bars where the targets should be.
7. **Start Virtual Camera** (bottom right). It stays running for the whole session.

The stimulus page is now a camera on this Mac.

## 3. FaceTime

1. Use a **dedicated Apple ID** for the rig. Not your personal one: the call history, the
   contacts and the notifications all end up in the capture, and a personal account leaks
   someone else's name into a clinical recording.
2. Open FaceTime, then **Video** menu:
   - **Camera**: OBS Virtual Camera
   - **Microphone**: BlackHole 2ch
3. Call the patient once by hand to check they see the stimulus page and hear the test
   voice. They should see the calm face, not your room.

## 4. Audio, both directions

```sh
brew install --cask blackhole-2ch
brew install --cask blackhole-16ch
```

- **Agent voice into the call**: FaceTime's microphone is BlackHole 2ch, and
  `rig/audio.py` plays the synthesized voice into that same device. Nothing else may use
  it while a call is running.
- **Patient voice out of the call**: FaceTime output goes to BlackHole 16ch, and
  `rig/audio.py` records from it. Set this in **System Settings**, **Sound**, **Output**
  while FaceTime is frontmost, or build a Multi-Output Device in Audio MIDI Setup if you
  also want to hear the call on speakers.
- Device names come from `MIC_DEVICE` and `SPK_DEVICE` in `.env`, so any pair of virtual
  devices works.

Check: `make preflight` shows green for both audio lines. If the patient hears nothing, the
FaceTime microphone is not BlackHole 2ch. If the transcript is empty, FaceTime output is
not going to the second device.

## 5. The patient's phone

- **Microphone Mode: Standard.** Voice Isolation is on by default on recent iPhones and it
  is a noise suppressor that reshapes the voice, which changes jitter, shimmer and HNR
  between calls for reasons that have nothing to do with the patient. Control Centre
  during the call, **Mic Mode**, **Standard**.
- Phone at arm's length, eye level, portrait, propped so it does not move. A hand-held
  phone adds head motion the calibration cannot remove.
- Light on the face, not behind it. A window behind the patient is the most common cause
  of a failed quality gate.

## 6. Permissions on the Mac

**System Settings**, **Privacy and Security**:

- **Screen Recording**: grant to Terminal (or iTerm, or the Python binary if you run it
  directly). Without it the capture returns black frames and every measure fails silently.
- **Accessibility**: grant to the same app. Without it `place_call.scpt` cannot press the
  Call button and every call needs a human.
- **Microphone**: grant to Terminal.

macOS asks once, with a dialog that can appear behind another window. If the preflight
accessibility check times out, that dialog is probably waiting for you.

## 7. Freeze the machine

- **Turn off automatic macOS updates** until the study is over. A point release can rename
  an accessibility element and the Call button stops being found mid-study, or change the
  camera stack and break the virtual camera.
- Note the versions that worked in `DECISIONS.md` so a regression is traceable.
- Do not upgrade OBS or BlackHole between calls either.

## 8. Do Not Disturb

Turn it on before every call, on both the Mac and the phone. A notification sound lands in
the patient's audio channel and is scored as speech. A banner lands in the captured video
and is scored as a brightness step, which is exactly what the flash detector is looking
for.

## 9. Network

Wired if you can. If Wi-Fi stutters, **tether the Mac to the phone hotspot**: FaceTime
drops frames before it drops audio, and a dropped frame is a dropped measurement. The
flash test is the first thing to fail when the link is bad, which is useful, it tells you
the timing measures would have been wrong.

## Run this first: the flash test

Do this before you trust a single latency number. Two hours, once.

1. `make dev`, then open the stimulus page in OBS as above.
2. Call yourself on a second device, with the phone set up as in step 5.
3. `make preflight` and read the **Flash detector** line.
4. On the live call, run `python rig/run_call.py --week 0` and look at `flash_ok` in the
   output.

What it does: every saccade trial starts with a single full-screen white frame in the
stimulus video at a known Mac clock time. That step comes back through FaceTime in the
returned video, delayed by the call. `backend/features/flash.py` finds the returned step,
so both the stimulus event and the patient's response are read off the same returned
stream and the call delay cancels. If fewer than 8 of 10 test flashes are found,
`flash_ok` is false and every tier B measure is dropped, everywhere, for that call.

If the flash is not detected: raise the light on the face, turn Voice Isolation off (it
does not affect video but it correlates with other processing being on), check the capture
is 30 fps in the preflight, and make sure the FaceTime window is not partly off screen.

## When it still does not work

Run the whole loop in mock mode and come back to the rig later:

```sh
MOCK_RIG=1 python rig/run_call.py
```

That replays a generated session through the same websocket events, the same feature
pipeline and the same twin update, so everything downstream of the camera is still being
exercised.
