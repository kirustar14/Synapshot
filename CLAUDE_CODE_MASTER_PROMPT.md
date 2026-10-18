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
# SPEC FILE 1 of 4: 3D brain, mesh, shape, receptors, what-if
(Part A is backend, Part B is frontend. Read "Lovable" as "build it yourself in web/".)

# UPDATE: real 3D brain that lights up and changes with the person

Two parts. Part A goes into Claude Code (backend repo, already built). Part B goes into Lovable (existing project). Do A first or at the same time. B has a fallback so it will not break while A is running.

One honest note before the prompts. DNA does not change the shape of a brain, and the model does not claim it does. What morphs the mesh is age, sex, regional volumes from the T1, and the injury site. DNA shows up in the healing layer (recovery speed, uncertainty). The viewer says this on screen so nobody on stage gets caught claiming otherwise.

---
# PART A: CLAUDE CODE UPDATE PROMPT (paste into the existing repo session)

Read DECISIONS.md and the current contract first. Do not break any existing route or test. Every new field is additive. Do not ask me questions. Commit after each step and keep `make test` green. Same style rules as before: simple Python, short names, no n_ count variables, complete files, no em dashes.

## Goal
Serve a real cortical surface mesh, per-person shape parameters, per-region damage with uncertainty, receptor maps, and a hypothetical intervention what-if, so the frontend can render a real-looking brain that lights up where the model says damage is.

## Step 1: real mesh (`backend/data/mesh.py`, `make mesh`)
- Load fsaverage5 with `nilearn.datasets.fetch_surf_fsaverage("fsaverage5")`: pial and inflated for both hemispheres, about 10k vertices each.
- Region label per vertex for Schaefer-100 (cortical only). First choice: read the CBIG annotation files `lh.Schaefer2018_100Parcels_7Networks_order.annot` and the rh one for fsaverage5 with `nibabel.freesurfer.read_annot` (file names and URL are from memory, verify). Fallback: project the nilearn Schaefer-100 volume atlas onto the pial surface with `nilearn.surface.vol_to_surf(..., interpolation="nearest_most_frequent")`. Label 0 to 99, left hemisphere first, same order as the existing 100 regions. If a vertex has no label, give it the nearest labeled vertex.
- Concatenate left and right into one mesh. Faces re-indexed. Positions in millimeters, centered at the origin, same coordinate space as everything else.
- IMPORTANT: recompute each region's centroid (x, y, z) as the mean of its pial vertices, and make `Twin.regions[].x,y,z` use those. Tract endpoints must land on the surface. Remove any ellipsoid or random centroids.
- Save `backend/data/mesh.json` and also write a copy to `exports/mesh.json` for the frontend `public/` folder. Cache so `make seed` does not refetch.
- Region names and the 7-network label per region (Visual, SomMot, DorsAttn, SalVentAttn, Limbic, Cont, Default) go in the mesh payload.

## Step 2: person shape (`backend/twin/shape.py`)
Visual deformation parameters per patient, all derived from the synthetic generator and labeled illustrative, not a measured segmentation:
```
scale   = [s, s, s] * small_axis_noise      s = 1 + 0.03 * sex_sign + head_noise   sex_sign = +1 male, -1 female, head_noise ~ N(0, 0.02^2)
atrophy = clip((age - 30) / 60, 0, 1) * 0.04    drives sulcal widening (blend toward inflated surface, visual only)
thick_z = per-region z score from the synthetic T1 volumes (generator draws N(0,1) plus regional loss correlated with that region's damage)
impact  = {vertex, point, radius, amp[13]}
  vertex = pial vertex nearest to the impact direction from the head center (use injury location and angle_deg)
  radius = 25 mm
  amp[t] = amp0 * severity * exp(-0.5 * t)    amp0 = 3 mm, severity from biomarkers and strain, t in weeks (swelling that settles)
template_diff = per-vertex displacement magnitude between this person and the template brain (for the personalization slider)
source = "synthetic" (or "freesurfer" if a real surface is uploaded, optional)
```
For real uploads with FreeSurfer surfaces (`lh.pial`, `rh.pial` read with nibabel), use the subject's own mesh as the base and set `source` to "freesurfer". Do this only if it takes under 30 minutes, otherwise skip and note it in DECISIONS.md.

## Step 3: per-region damage with uncertainty (`twin/build.py`, `twin/forecast.py`)
- Region damage at week t = mean over incident edges of D_ij(t), weighted by edge weight.
- For each region and week return the posterior mean, 10th percentile, and 90th percentile across the 200 ensemble members: `damage`, `damage_lo`, `damage_hi`.
- `recovery` per region and per patient: this patient's k divided by the population mean k (above 1 means healing faster than typical). Use it for the healing layer.
- `activity` per region per week from the DMF region firing rates (z-scored), through the emulator where possible, falling back to scaling the healthy rates by (1 - damage).

## Step 4: receptor maps and the what-if (`twin/intervention.py`)
- `GET /api/receptors`: z-scored Schaefer-100 group maps from neuromaps (Hansen atlas) for GABA-A, NMDA, dopamine D2, serotonin 5-HT2A, and mu-opioid, with a `synthetic_template` label if neuromaps is unavailable (smooth random maps from a fixed seed).
- `POST /api/patients/{id}/intervention {target, gain}`: regional gain perturbation in the Luppi style. Scale each region's local gain by 1 + gain * receptor_z_scaled[region] (receptor map min-max scaled to 0..1), run one short DMF simulation (20 s) with the patient's SC and current damage, and return the region-wise effect on firing rate, plus the change in global FC strength, mean rate, and metastability versus no intervention.
- This is a clinician-only hypothetical. The response must include `note: "Hypothetical what-if. Not a treatment recommendation."`. It must never feed the forecast, the EnKF, the alerts, any patient text, or any summary. Add a test that the safety banned-phrase check still passes for every patient-facing string and that no summary mentions an intervention.
- Scope note: medication advice stays out of the agent and the patient texts. This is a visualization of receptor-weighted gain changes only. Write that line in DECISIONS.md.

## Step 5 (do last, behind `REGIONAL_LOADINGS=1`): signals depend on where the damage is
Right now every signal reads one global damage number, which is why tract attribution gives the same ordering for every signal. Replace the single d(t) with a regional weighted sum:
```
d_s(t) = sum over r of w_sr * damage_r(t)       w_sr >= 0, sum over r of w_sr = 1
```
Loadings by Schaefer 7-network label, my design assumption (loosely motivated, not from a paper, say so in DECISIONS.md): pursuit_gain on DorsAttn and Visual; antisaccade_err on Cont and DorsAttn; saccade_latency on DorsAttn and SalVentAttn; speech_rate on SomMot and SalVentAttn, left hemisphere weighted 1.5x; recall_delayed on Default and Limbic; symptom_total on Limbic, Default, and Cont. Feed d_s(t) into the emulator in place of d(t) per signal. Then `attribution.py` ranks tracts per signal using these loadings, so each signal gets a different top 3. Keep the old path when the flag is off. Existing coverage and contraction tests must still pass; if they drop out of range, retune the loadings scale and record the numbers in DECISIONS.md.

## Step 6: routes and tests
Add (all under /api):
- `GET /mesh` -> Mesh
- `GET /patients/{id}/shape` -> Shape
- `GET /receptors` -> Receptors
- `POST /patients/{id}/intervention` -> Intervention
Extend `Twin.regions[]` with `damage_lo`, `damage_hi`, `recovery`, `network`. Tests: mesh has 100 labels all present, centroids lie within 5 mm of a vertex of their own label, `shape` returns 13 amp values, `damage_lo <= damage <= damage_hi` everywhere, intervention returns a finite effect for all five targets, contract test updated by hand for the new fields.

## Contract additions (shared with the frontend)
```ts
interface Mesh { space: "fsaverage5"; pial: number[]; inflated: number[]; faces: number[]; labels: number[];
  region_names: string[]; networks: string[]; source: "fsaverage5" | "procedural" }  // pial and inflated are flat [x,y,z,...] in mm
interface Shape { scale: [number, number, number]; atrophy: number; thick_z: number[];
  impact: { vertex: number; point: [number, number, number]; radius: number; amp: number[] };
  template_diff: number[]; source: "synthetic" | "freesurfer" }
interface Receptors { names: string[]; maps: Record<string, number[]>; synthetic_template: boolean }
interface Intervention { target: string; region_effect: number[];
  summary_delta: { fc_strength: number; rate: number; metastability: number }; note: string }
// Twin.regions[] gains: damage_lo: number[]; damage_hi: number[]; recovery: number; network: string
```

## Done means
`make mesh && make seed && make test` pass, `GET /api/mesh` returns about 20k vertices with all 100 labels, region centroids sit on the surface, `exports/mesh.json` exists, and DECISIONS.md lists every assumption (shape formulas, loadings, intervention scaling).

---
# PART B: LOVABLE UPDATE PROMPT (paste into the existing Lovable project)

Replace the 3D viewer on C3 (and the small viewers on C0 and C4) with a real-looking cortical brain. Keep every other screen as is. Do not remove the old viewer until the new one renders. Do not ask questions. No em dashes in any copy.

## Data
Add to `types.ts` exactly the contract additions below and the matching client functions and hooks: `getMesh`, `getShape`, `getReceptors`, `postIntervention`. In mock mode, load `/mesh.json` from the `public/` folder (I will drop the real file there). If it is missing, generate a procedural placeholder brain (two noisy folded ellipsoids with about 20k vertices, fake region labels from angular sectors) and show a small badge "placeholder mesh". Mock `shape`, `receptors`, `intervention`, and the extra Twin fields so every control below works without a backend.

## Rendering (react-three-fiber, drei, @react-three/postprocessing)
Build `BrainViewer.tsx` as one reusable component with props: patientId, week, layer, scenario overrides, compact. Use one `BufferGeometry` for the whole cortex:
- attributes: `position` (pial), `inflatedPosition`, `normal` (computeVertexNormals), `region` (float 0 to 99 per vertex), `impactDist` (distance in mm from each vertex to the impact point).
- A custom `ShaderMaterial`. Vertex shader:
```
pos = mix(position, inflatedPosition, uInflate + uAtrophy * uPersonal)
pos = pos * mix(vec3(1.0), uScale, uPersonal)
pos += normal * (uThick[region] * 0.4 * uPersonal)
pos += normal * (uBump * exp(-(impactDist * impactDist) / (2.0 * uRadius * uRadius)) * uPersonal)
```
`uPersonal` (0 to 1) is a slider "Personalization: template to this patient" so the audience watches the brain morph from the template into the person. `uBump` is the impact swelling `amp[week]` from `shape`, interpolated smoothly between weeks.
- Region values go in a 100x1 float DataTexture `uVals`, tweened over about 400 ms whenever week or layer changes. Fragment shader: base cortex color (soft warm gray with lambert shading and a fresnel rim), colormap(value) mixed in by value, emissive = color * value * uGlow. Add subtle sulcal darkening from the difference between pial and inflated positions.
- Bloom postprocessing so lit regions actually glow. Keep 60 fps with about 20k vertices.
- Raycast hover and click: pick the vertex, read its region label, show a tooltip and fill the side panel (name, network, damage with its 10 to 90 percent range, activity, recovery, receptor values).
- Controls: OrbitControls with damped rotation, preset view buttons (left, right, top, front), hemisphere split toggle, and an "Inflate" slider (0 to 1) that morphs pial to inflated so folded regions are visible.
- A small translucent head outline is optional. An impact marker (pulsing ring) at `shape.impact.point` is required.

## Layers (switcher on the left, each with a legend and a one-line meaning)
1. Damage: dark to amber to red by `damage[week]`.
2. Uncertainty: stippled, translucent shimmer proportional to `damage_hi - damage_lo`. Meaning: where the twin is not sure yet. It shrinks as weeks of calls arrive.
3. Healing: red to green by `recovery`. Meaning: healing faster or slower than the typical patient. This is where DNA, age, and biomarkers show up.
4. Simulated activity: blue to white to red by `activity[week]`.
5. Excitation-inhibition map: from `ei`.
6. Template vs personal: diverging map of `personal_w - template_w` aggregated per region.
7. Intervention what-if (see below).
8. Signal drivers: pick one of the six signals and light the regions that drive it (reach). Uses the signal-to-region loadings if the backend returns them, otherwise the tract attribution endpoint. Always carries a "hypothesis" badge.

## Tracts
Top 200 edges as thin tube curves (quadratic Bezier from region centroid to centroid, control point pulled 35 percent toward the brain center, so they arc under the surface look). A shader draws flowing pulses along each tract, color from damage, with gaps and flicker proportional to damage so broken tracts look broken. Toggle on and off. Clicking a tract shows its damage at week 0 and now.

## Injury replay (the demo moment)
Button "Replay injury". Sequence in about 6 seconds: the impact ring pulses at the impact point, a wave expands across the surface (`uWaveR` grows, vertices light where distance to the wave front is small), the tracts light by their week 0 damage in order of strain, the bump swells at the impact site, and then the week scrubber auto-plays from week 0 to 12 so damage fades and the bump settles. Label it "Illustrative animation. Lit regions come from the model." Pause, scrub, and speed controls.

## Person panel
A side card titled "What shapes this brain" with live rows, each tied to a visible effect, and a hover that highlights it on the mesh:
- Age -> sulcal widening (atrophy)
- Sex -> overall size
- T1 regional volumes -> local thickness bumps
- Injury -> impact swelling and tract damage
- Genotype (APOE e4 count, BDNF Met, COMT) and biomarkers -> healing layer and uncertainty, NOT shape
Include the sentence: "DNA changes the recovery forecast, not the anatomy." Show the real or synthetic badge on the mesh source and on every input.

## Intervention what-if (clinician only)
Tab with: receptor target picker (GABA-A, NMDA, dopamine D2, serotonin 5-HT2A, mu-opioid), a gain slider from minus 50 percent to plus 50 percent, and a Run button posting to the intervention route. Show the `region_effect` as a purple to teal diverging layer, an overlay of the receptor density map, and the summary delta (FC strength, rate, metastability) as three small numbers. A permanent red-bordered banner on this tab: "Hypothetical what-if. Not a treatment recommendation. Not shown to patients." Hide the tab from the print and export view.

## Other screens
- C4 Scenario compare: two `BrainViewer`s side by side, synced camera, each with its own helmet and angle, same layer and week, with a difference toggle that shows the damage difference on one brain.
- C0 Upload: after Build twin, show the compact viewer morphing from template to this patient, with the personalization slider.
- C2 Overview: small static viewer (no controls) showing damage at the current week.
- Counterfactual slider panel stays, and now its changed forecast also tints the Healing layer.
- Keep every control keyboard reachable. Add an "Reduce motion" toggle that disables the wave, glow pulses, and flow shader animation.

## Performance and fallbacks
Decimate nothing on the client. Use one draw call for the cortex and one for the tracts. Dispose geometries on unmount. If WebGL or float textures fail, fall back to the old viewer with a note.

## Contract additions
```ts
interface Mesh { space: "fsaverage5"; pial: number[]; inflated: number[]; faces: number[]; labels: number[];
  region_names: string[]; networks: string[]; source: "fsaverage5" | "procedural" }
interface Shape { scale: [number, number, number]; atrophy: number; thick_z: number[];
  impact: { vertex: number; point: [number, number, number]; radius: number; amp: number[] };
  template_diff: number[]; source: "synthetic" | "freesurfer" }
interface Receptors { names: string[]; maps: Record<string, number[]>; synthetic_template: boolean }
interface Intervention { target: string; region_effect: number[];
  summary_delta: { fc_strength: number; rate: number; metastability: number }; note: string }
// Twin.regions[] gains: damage_lo: number[]; damage_hi: number[]; recovery: number; network: string
```
Routes: GET /api/mesh, GET /api/patients/{id}/shape, GET /api/receptors, POST /api/patients/{id}/intervention {target, gain}.

## Done means
The cortex looks like a brain, regions glow where damage is, the personalization slider visibly morphs the shape, Replay injury runs end to end, every layer and the what-if work in mock mode, and setting `VITE_API_URL` switches all of it to real data with no code change.


---
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


---
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


---
# SPEC FILE 4 of 4: every clinician and patient screen, mock data layer, and the shared API contract

# LOVABLE PROMPT: UNNAMED frontend (paste everything below)

Build the complete frontend for UNNAMED in one pass. Do not use Supabase or any backend of your own. Do not ask questions. Build every screen and every reach feature below. Everything must work on built-in mock data first, then switch to my real API by setting one env var.

## What it is
UNNAMED is a personal brain twin for traumatic brain injury. A rig calls the patient on FaceTime every week and measures eye movements, speech, memory, and facial movement. A whole-brain model (the twin) forecasts 12 weeks of recovery with uncertainty bands and recalibrates after each call. Clinicians watch a dashboard. All demo patients are synthetic and must be labeled so. The user is a clinician, plus a hidden rig console and demo console for the presenters.

## Stack
React, TypeScript, Vite, Tailwind, shadcn/ui, React Router, TanStack Query, Zustand, Recharts, three, @react-three/fiber, @react-three/drei. No other UI kits.

## Look and feel
Clean clinical, calm. White and light gray surfaces, deep teal primary (#0f766e), amber for synthetic badges, red only for red flags, soft shadows, 12px radius, Inter font, generous spacing. Left sidebar (Patients, Alerts, Cohort, Rig, Demo) with a top bar showing app name UNNAMED and a small "synthetic data" pill when the API reports mock mode. Desktop first for clinician screens, fully mobile for patient pages. Dark mode toggle. Every number that comes from a model carries a small label "Model output, not a scan" where relevant. No em dashes in any text.

## Data layer (build this first)
- `src/api/types.ts`: paste the contract types from the bottom exactly.
- `src/api/client.ts`: `const API = import.meta.env.VITE_API_URL`. If it is empty or the health call fails, use the mock layer. One function per route in the contract. TanStack Query hooks for each. Poll alerts every 5 s, messages every 2 s, patients every 10 s.
- `src/api/ws.ts`: connect to `${API}/ws/rig` and expose a hook `useRig()`. In mock mode generate RigEvents at 30 fps: a target dot moving as a sine, gaze following with gain 0.8 plus noise, quality lights flickering rarely, a pursuit gain that settles near 0.8, steps cycling through the call script, and transcript lines arriving every few seconds.
- `src/mock/`: a seeded generator that returns every contract shape with believable values. Seed 6 patients: week 0 fresh, week 4 stable, week 6 drifting (reality outside the band), red flag, low quality, template-only (no MRI). Forecasts have 13 weekly points, 80% bands that narrow as weeks pass, observed points landing mostly inside the band. Twin has 100 regions with centroids on a brain-shaped ellipsoid (left and right hemispheres), 200 edges, damage arrays for 13 weeks that decay by recovery. Cohort has 50 patients, coverage rising from 0.55 to 0.8 over 12 weeks, and four effects (c_e4, c_bio, b_e4, b_fe4) with true and estimated values and intervals. Mock mutations (advance week, inject drift, build twin, ack alert, upload) must update the mock store so the UI visibly reacts.
- A global store (Zustand) holds the selected patient, comparison scenarios, and the demo state.

## Screens and routes

### C1 Patients `/`
Table sorted by drift z descending: name, week, drift z (colored bar), last call date, flag chips (red flag, missed call, low quality, drift), synthetic badge. Filter "alerts only". "Add patient" opens a dialog (name, age, sex) that creates a synthetic patient and routes to C0.

### C0 Data upload `/patients/:id/upload`
Six drop zones: T1 MRI, Diffusion MRI, Resting fMRI, Genotype VCF, Blood biomarkers CSV (GFAP and UCH-L1), Injury form (mechanism, helmet A or B, impact angle slider, location, loss of consciousness, date). Each shows a validation status chip (ok, warn, error, missing), a real or synthetic badge, and a line saying what it changes ("sets structural connectivity", "sets priors on recovery rate"). Buttons: Use synthetic patient (fills all zones), Remove file, Build twin. After building, show a result card: FC fit as a big number with a gauge, a "low fidelity" warning chip if flagged, template-only chip if no diffusion MRI, and an input summary. Show a small explainer: DNA only shifts priors on two recovery parameters and the evidence is mixed.

### C2 Patient overview `/patients/:id`
Header with patient facts and badges. Panels: injury summary; inputs used with real or synthetic badges and the FC fit; four small forecast charts grouped by eyes, speech, memory, symptoms, each with the 80% band as a shaded area, the mean line, and observed points with error bars; calibration card (coverage of the 80% band, a sparkline by week, and posterior contraction for recovery rate k as a shrinking-bar visual); active alerts; last call summary. Buttons: Open twin viewer, Open scenario compare, Open call log, Request callback to patient, Add note, Export report (prints a clean one-page PDF via window.print with a print stylesheet). A tier B signal (saccade latency) shows only when the last call had flash_ok true, otherwise a gray "not measured" tile.

### C3 Twin viewer `/patients/:id/twin`
3D brain in react-three-fiber: 100 region spheres at centroids inside a translucent brain-shaped shell, OrbitControls, damped rotation. Top 200 edges as lines with opacity and width by damage. Layer switch: Tract damage, Simulated activity, Regional excitation-inhibition map (from gene expression), Template vs personal connectome difference. Week scrubber 0 to 12 with play and pause; damaged tracts glow then fade as recovery proceeds. Side panel lists the most affected tracts with damage values at week 0 and now. Clicking a region shows its name and values. Always show the label "Model output, not a scan".
Reach: a "Tract attribution" tab listing, for each signal, the top 3 tracts with scores, with a visible "hypothesis" badge. A counterfactual slider panel: recovery rate multiplier (0.5x to 2x) and permanent damage shift, which re-queries the counterfactual route (debounced) and overlays the new forecast as a dashed line on the four charts.

### C4 Scenario compare `/patients/:id/compare`
Split screen. Each side picks a scenario (helmet A or B, impact angle slider). Run button posts to the scenario route. Both sides show the forecast charts and a diff table of parameters that differ. Buttons: Add scenario, Run, Swap sides, Remove. A 3D mini viewer on each side showing week 0 damage.

### C5 Call log `/patients/:id/calls`
List of calls with date, duration, steps completed, channel health (frame rate, calibration error, face share, flash test result). Opening a call shows: feature table with tier chips (A or B), value, previous value, change versus the minimal detectable change (green when within noise, amber when changed), a gaze trace per eye task (target line versus gaze line, Recharts), the transcript with speaker colors, and for reach: blink, smile, and brow traces labeled "exploratory". Buttons: Re-score a task, Mark data unusable, Flag for review.

### C6 Alerts `/alerts`
List with type, trigger values, time, whether the clinic call was made and confirmed. Buttons: Acknowledge, Call patient, Resolve, Open patient. Red flags are pinned to the top with a red left border.

### Cohort `/cohort`
Population view: coverage by week for the whole cohort rising over time (line chart with the 0.8 target line), a scatter of true k versus estimated k with the diagonal, and a parameter recovery table (name, true, estimated, 90% interval, a green check when the true value is inside). Title: "The shared model improves as patients join".

### R1 Rig console `/rig` (presenter view)
Large panel showing the live frame (base64 jpeg from the websocket when present, otherwise a drawn abstract face) with gaze overlay and the target dot. Quality lights (face, distance, light, fps), live pursuit gain, current step, scrolling transcript, channel health. A big status pill: Idle, Ringing, In call, Failed.

### R2 Rig preflight `/rig/preflight`
Checklist of green or red checks from the preflight route with detail text, a Re-run button, and a banner that says "All green" or "Do not start the demo".

### D1 Demo console `/demo`
Large buttons: Advance week, Inject drift (size slider), Trigger call, Reset cohort, Load synthetic patient. Patient picker. A live mini state: week, drift z, last alert. When Trigger call is pressed show a full-width "Phone ringing" animation until the rig reports In call. Keyboard shortcuts for every button. Hidden from the sidebar unless the URL is visited once (store the unlock in localStorage).

### P1 Consent `/consent/:token` (mobile)
One page: patient name, short plain-language text about weekly FaceTime calls, AI disclosure, recording consent, and a separate toggle for genetic data consent (default off, explained). Accept button posts and shows a thank you.

### P2 Phone mock `/phone/:id`
An iPhone-shaped frame showing the iMessage thread (blue and gray bubbles, timestamps) from the messages route, polled every 2 s, auto-scrolling. Used on stage to show consent, heads-up, midweek check, summary, and emergency texts arriving.

### P4 Gait and hearing `/stretch/:token` (mobile)
Gait: 20 second walk test using DeviceMotion accelerometer, count steps, compute cadence and step variability, show a simple result. Hearing: Web Audio tone ladder at 500, 1000, 2000, 4000 Hz stepping down in volume, patient taps "I hear it", store the thresholds. Posts both to the stretch route. Clear instructions and a safety note (stop if dizzy). Works without sensors by offering a manual entry fallback.

## Cross-cutting reach features (all required)
Auth0 login as an optional layer: if `VITE_AUTH0_DOMAIN` and `VITE_AUTH0_CLIENT_ID` are set, wrap the clinician routes in the Auth0 React SDK, otherwise no login. Pupil light reflex card on C2 shown as a disabled "Roadmap" tile. Empty, loading, and error states on every screen. Keyboard accessible, proper aria labels, color is never the only signal. Responsive down to 360px for P pages.

## Behavior rules
- Mock mode shows a banner "Mock data" in the top bar. Real mode hides it.
- Never show a diagnosis, clearance, or medication advice anywhere. Patient-facing text is plain and calm.
- Synthetic badge (amber) on every synthetic patient, file, and chart.
- No em dashes in any copy.
- Make the app deployable as a static site. Document `VITE_API_URL` in the README and in `.env.example`.

## Done means
Every route above renders with mock data, every button does something visible, `VITE_API_URL=http://localhost:8000` switches all data to the real backend without code changes, and the 3D viewer scrubs smoothly at 60 fps with 100 regions and 200 edges.

---
# API CONTRACT (shared with the backend, do not change names)
```ts
type Flag = "red_flag" | "missed_call" | "low_quality" | "drift";
interface PatientRow { id: string; name: string; week: number; drift_z: number; last_call: string | null; flags: Flag[]; synthetic: boolean }
interface InputFile { kind: "t1" | "dwi" | "fmri" | "vcf" | "labs" | "injury"; file: string; synthetic: boolean; status: "ok" | "warn" | "error" | "missing"; sets: string; note?: string }
interface Alert { id: string; patient_id: string; type: Flag; trigger: string; time: string; called: boolean; acked: boolean }
interface Patient { id: string; name: string; age: number; sex: "F" | "M"; week: number;
  injury: { mechanism: string; helmet: string; angle_deg: number; location: string; date: string; loc: boolean };
  inputs: InputFile[];
  alleles: { apoe_e4: 0 | 1 | 2; bdnf_met: boolean; comt: "Val/Val" | "Val/Met" | "Met/Met" };
  biomarkers: { gfap_z: number; uchl1_z: number };
  fc_fit: number | null; coverage: number; contraction: { k: number };
  params: { G: number; k: number; p: number; eps: number };
  alerts: Alert[]; last_call: Checkin | null; twin_built: boolean; template_only: boolean; low_fidelity: boolean }
interface Signal { key: string; label: string; unit: string; group: "eyes" | "speech" | "memory" | "symptoms"; tier: "A" | "B";
  mean: number[]; lo: number[]; hi: number[]; obs: { week: number; value: number; sem: number }[] }
interface Forecast { weeks: number[]; signals: Signal[]; coverage: { week: number; cov: number }[] }
interface Twin { weeks: number[];
  regions: { id: number; name: string; hemi: "L" | "R"; x: number; y: number; z: number; ei: number; template_ei: number; damage: number[]; activity: number[] }[];
  edges: { a: number; b: number; damage: number[]; template_w: number; personal_w: number }[];
  top_tracts: { name: string; damage_w0: number; damage_now: number }[] }
interface Feature { name: string; tier: "A" | "B"; value: number; prev: number | null; mdc: number; unit: string; changed: boolean }
interface Checkin { id: string; patient_id: string; week: number; date: string; duration_s: number; steps: string[];
  channel: { fps: number; calib_err_deg: number; face_share: number; flash_ok: boolean };
  features: Feature[];
  gaze: { task: string; t: number[]; x: number[]; y: number[]; tx: number[]; ty: number[] }[];
  traces?: { blink: { t: number[]; v: number[] }; smile: { t: number[]; v: number[] }; brow: { t: number[]; v: number[] } };
  transcript: { who: "agent" | "patient"; text: string; t: number }[]; unusable: boolean }
interface Scenario { helmet: string; angle_deg: number }
interface ScenarioResult { a: Forecast; b: Forecast; diff: { param: string; a: string; b: string }[] }
interface Message { dir: "out" | "in"; body: string; time: string }
interface Check { name: string; ok: boolean; detail: string }
interface Cohort { weeks: number[]; coverage: { week: number; cov: number }[]; k_true: number[]; k_est: number[];
  effects: { name: string; true: number; est: number; lo: number; hi: number }[]; size: number }
interface Attribution { signal: string; tracts: { name: string; score: number }[]; note: string } // note always says "hypothesis"
type RigEvent = { type: "frame"; gaze: { x: number; y: number }; target: { x: number; y: number };
  quality: { face: boolean; dist: boolean; light: boolean; fps: number };
  pursuit_gain: number | null; step: string; line: { who: "agent" | "patient"; text: string } | null; frame?: string /* base64 jpeg */ }
```
Routes (all under /api, JSON):
- GET /health -> {ok: boolean; mode: "mock" | "live"}
- GET /patients -> PatientRow[]; POST /patients {name, age, sex, synthetic:true} -> Patient
- GET /patients/{id} -> Patient
- GET /patients/{id}/forecast -> Forecast
- GET /patients/{id}/twin -> Twin
- POST /patients/{id}/scenarios {a: Scenario, b: Scenario} -> ScenarioResult
- POST /patients/{id}/counterfactual {k_mult: number, p_add: number} -> Forecast
- GET /patients/{id}/attribution -> Attribution[]
- GET /patients/{id}/checkins -> Checkin[] (without gaze arrays); GET /checkins/{cid} -> Checkin (full)
- POST /checkins/{cid}/rescore {task}; POST /checkins/{cid}/unusable
- POST /patients/{id}/uploads (multipart file with `kind`, or JSON {synthetic:true}) -> InputFile[]
- GET /patients/{id}/twin-inputs -> {inputs: InputFile[]; fc_fit: number | null; low_fidelity: boolean}
- POST /patients/{id}/build-twin -> Patient
- GET /patients/{id}/messages -> Message[]
- POST /patients/{id}/note {text}
- GET /alerts?patient_id= -> Alert[]; POST /alerts/{id}/ack; POST /alerts/{id}/call
- GET /cohort -> Cohort
- GET /rig/preflight -> Check[]
- POST /demo/reset; POST /demo/advance-week {patient_id}; POST /demo/inject-drift {patient_id, size}; POST /demo/trigger-call {patient_id}
- GET /consent/{token} -> {patient_name: string; text: string[]}; POST /consent/{token} {calls: boolean; ai: boolean; recording: boolean; genetic: boolean}
- POST /stretch/{token} {gait?: {cadence: number; variability: number; steps: number}; hearing?: {thresholds: Record<string, number>}}
- WS /ws/rig (RigEvent), WS /ws/stimulus (backend only, the frontend never opens it)
