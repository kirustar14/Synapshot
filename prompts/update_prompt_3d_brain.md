<!-- Split out of CLAUDE_CODE_MASTER_PROMPT.md. The master prompt header wins wherever this file disagrees with it. Read 'Lovable' as 'build it yourself in web/'. -->

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
