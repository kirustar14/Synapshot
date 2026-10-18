# Clinician and presenter screens

Notes for the screens in `web/src/pages` that are not the 3D twin viewer, the scenario compare
or the patient call page. Written by the clinician screens agent. If this file and the code
disagree, the code wins.

## What is where

| Screen | Route | File |
| --- | --- | --- |
| C1 Patients | `/` | `src/pages/Patients.tsx` |
| C0 Model inputs | `/patients/:id/upload` | `src/pages/PatientUpload.tsx` |
| C2 Overview | `/patients/:id` | `src/pages/PatientOverview.tsx` |
| C5 Check-in log | `/patients/:id/calls` | `src/pages/PatientCalls.tsx` |
| C6 Alerts | `/alerts` | `src/pages/Alerts.tsx` |
| Cohort | `/cohort` | `src/pages/Cohort.tsx` |
| R1 Live call console | `/rig` | `src/pages/Rig.tsx` |
| R2 Preflight | `/rig/preflight` | `src/pages/RigPreflight.tsx` |
| D1 Demo console | `/demo` | `src/pages/Demo.tsx` |
| P2 Phone mock | `/phone/:id` | `src/pages/Phone.tsx` |

Shared pieces added for them:

- `src/components/charts/chartTheme.ts`, colours and axis defaults bound to the CSS variables,
  so every chart follows light and dark mode with no per chart overrides.
- `src/components/charts/SignalChart.tsx`, the 80% band, the mean line and the observed points
  with error bars, plus `ChartKey` for the legend wording.
- `src/components/charts/LineTrace.tsx`, a multi series line used for gaze traces, the face
  traces and cohort coverage.
- `src/components/charts/Sparkline.tsx`, the axis free coverage line on the calibration card.
- `src/components/charts/ScatterDiagonal.tsx`, true against estimated with the identity line.
- `src/components/panels/`: `AlertCard`, `CompactTwin`, `DriftBar`, `FeatureTable`, `Gauge`,
  `PhoneStage`, `QualityLights`, `Transcript`.

## Decisions

**The band is drawn as two stacked areas.** A transparent floor at `lo` and a stacked span of
`hi - lo` on top of it. That is the Recharts shape that is certain to paint a filled interval.
Every signal in the contract has a positive `lo`, so the stack never crosses zero.

**The 3D viewer is loaded through `import.meta.glob`, not a bare dynamic import.** A missing
module would break the build with `import()`. The glob resolves at build time and gives an empty
map when `src/components/brain/BrainViewer.tsx` is absent, so `CompactTwin` falls back to a plain
card and the build stays green either way. An error boundary around it keeps a WebGL failure from
taking the page down. `CompactTwin` only passes layers the viewer knows: `damage`, `activity`,
`ei`.

**The personalization slider writes to the store, not to the viewer.** `useApp().viewer.
personalization` is the shared setting the twin viewer already reads, so the slider on C0 moves
the same value the twin screen moves.

**Four forecast charts, one panel per group.** Each group panel holds every tier A signal in that
group, so speech shows two small charts and the rest show one. Tier B saccade latency is not in
the group grid: it has its own tile, which is the only place the contract asks for the flash test
rule.

**Saccade latency is read from `last_call.features`.** The tile shows a value only when
`last_call.channel.flash_ok` is true, and otherwise a grey "not measured" tile that says the flash
test did not pass so the screen and camera clocks could not be aligned.

**C2 prints to about one page.** The action row, the live transcript and the 3D panel carry
`no-print`, so the printed report is the facts, the inputs, the four charts, the calibration card
and the alerts.

**Keyboard shortcuts on D1** are W advance week, D inject drift, C trigger call, R reset cohort,
L load synthetic patient, K create call link, T send text. They are listed on screen and they do
not fire inside a text field or with a modifier held.

**Load synthetic patient** on D1 is three contract calls in a row: create the patient, upload the
synthetic inputs, build the twin. That gives a patient that is ready to show, rather than an empty
record.

**The QR code** is `QRCode.toDataURL`, which needs a canvas. Where a canvas is refused the code
falls back to `QRCode.toString` as SVG and uses that as the data URL, so the `<img>` always has
something to draw.

**The live call console is the web call, not a rig.** The `Ringing` state from `useRig()` is shown
as "Waiting for the patient to open the link". The stage says in plain words that the video stays
on the patient's phone and that the drawn face is a stand-in unless the call page sends a frame.

**P2 does not use `PatientShell`.** The shell is capped at 460px, and P2 has to show the thread
and the call page side by side on stage. It has its own header and its own safety line, and it
stacks to one column below the `lg` breakpoint.

## Where the contract did not have what a screen asked for

- **Request callback (C2)** has no route. It is written to the patient record through
  `POST /patients/{id}/note` and the toast says so.
- **Resolve (C6)** has no route either. Acknowledge is the only alert state the contract carries,
  so Resolve acknowledges the alert and writes a note naming what was resolved. The page header
  says that out loud so nobody reads Resolve as a second server state.
- **Flag for review (C5)** is also a note, for the same reason.
- **Clinic call confirmed (C6)**: the contract has a single `called` boolean, so the chip reads
  "clinic call made and confirmed" or "clinic call not made". There is no separate confirmation
  field to show.
- **Channel health on R1**: `RigEvent` carries `quality.fps` but no calibration error and no face
  share, which the per call channel health does carry. The console shows frame rate, the current
  step, the event rate and whether the stream is connected, and the full four readings appear on
  C5 where `Checkin.channel` has them.
- **Mark data unusable** toggles. The contract route has no body, and the mock flips the flag, so
  the button names the direction it will move.

## Not done

- No virtualisation anywhere. The cohort is six patients and a call has nineteen steps, so the
  lists are short by construction.
- The patient table scrolls sideways under about 700px rather than collapsing into cards. These
  are desktop first clinician screens, and the patient facing routes are the ones that have to
  work at 360px.
