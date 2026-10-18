# The 3D brain viewer

Everything the holographic cortical viewer needs lives in `web/src/components/brain/`. Two pages
host it: `src/pages/PatientTwin.tsx` (C3) and `src/pages/PatientCompare.tsx` (C4). Both pull
`BrainViewer` through `React.lazy`, so three, drei and postprocessing stay out of the main chunk.

## Files

| File | What it is |
| --- | --- |
| `BrainViewer.tsx` | The one reusable viewer. Default export, because the pages lazy load it. Owns the Canvas, the stage chrome, the badges and the 2D fallback. |
| `Scene.tsx` | Everything inside the Canvas. One `useFrame` drives the clock, the tweens, the scan sweep, the injury replay and the shared camera. |
| `CortexMesh.tsx` | Two meshes over one BufferGeometry: back faces then front faces, sharing one uniforms object. |
| `Tracts.tsx` | Tract tubes merged into one geometry, plus a point cloud whose particles ride a Bezier on the GPU. |
| `ImpactMarker.tsx` | The pulsing ring at `shape.impact.point` and the expanding replay wave. |
| `Callouts.tsx` | Floating labels with leader lines for the five regions the layer lights most. |
| `geometry.ts` | Builds the cortex geometry, the tract geometry and the four DataTextures. |
| `shaders.ts` | All the GLSL. The colormaps are generated from `layers.ts`. |
| `uniforms.ts` | The uniform objects, created once per viewer and mutated by the frame driver. |
| `layers.ts` | Layer definitions: ramp stops, plain language meaning, honesty notes, legend ticks. |
| `regionData.ts` | Twin plus overrides to per region shader channels, plus the plain language names. |
| `viewerStore.ts` | Viewer only zustand store. Week, layer, flags, replay, camera sync. |
| `capabilities.ts` | WebGL and float texture probe, run before the Canvas mounts. |
| `Fallback2D.tsx` | A flat region map for browsers that cannot run the viewer. |
| `LayerSwitcher.tsx`, `TimeControls.tsx`, `ShapeControls.tsx`, `SidePanels.tsx`, `WhatIfPanel.tsx`, `CounterfactualPanel.tsx`, `AttributionPanel.tsx` | The 2D panels. None of them import three, so a page can show them while the viewer chunk is still downloading. |
| `index.ts` | The barrel the pages import. `BrainViewer` is deliberately absent from it. |

## The deformation

The vertex shader runs exactly the formula the backend's `shape` payload was built for:

```
pos = mix(position, aInflated, uInflate + uAtrophy * uPersonal)
pos = pos * mix(vec3(1.0), uScale, uPersonal)
pos += normal * (uThick[region] * 0.4 * uPersonal * uThickGain)
pos += normal * (uBump * exp(-(d*d)/(2.0*uRadius*uRadius)) * uPersonal)
```

`uThickGain` is the only addition and it sits at 1.0 unless a Person panel row is hovered, in
which case it briefly exaggerates the thickness term so you can see what the T1 volumes do. The
formula with `uThickGain = 1` is the spec formula untouched.

`thick_z` goes in as a 100 by 1 `RedFormat` float DataTexture, not a uniform array, so the mobile
uniform budget is not an issue.

## Region values

`uVals` is a 100 by 1 RGBA float DataTexture: red is the position along the ramp, green is the
glow, blue is the shimmer, alpha is the hover or select highlight. Red, green and blue tween over
400 ms whenever the week or the layer changes. Alpha is written straight through every frame so
picking a region feels instant.

`uVals0` holds the same channels at week 0 and is the ghost. See the decisions below.

## What the viewer decided

Things the spec left open, and the call made:

- **Up axis.** The mesh arrives in RAS millimetres, so the group that holds the cortex, the
  tracts and the impact marker is rotated minus 90 degrees about X. Superior becomes up, anterior
  becomes minus Z, and the preset buttons are written in that rotated space.
- **Tract endpoints.** `mesh.region_xyz` is used when the payload carries it, which the real
  backend does. The contract type in `api/types.ts` does not declare the field yet, so it is read
  through a narrow optional cast. The fallback is `Twin.regions[].x,y,z`, which the backend says
  are the same surface centroids. Centroids are never recomputed from the vertex arrays.
- **Ghost of week 0.** Drawn in the fragment shader as a faint under glow from a second value
  texture rather than as a third geometry pass. Same reading, no extra draw call.
- **Depth writes are on.** A folded cortex crosses a view ray a dozen times. With additive
  blending and no depth writes every one of those sheets stacks and the brain turns into a white
  blob, which is exactly what happened on the first pass. Writing depth keeps it to the nearest
  back face and the nearest front face. That is still "back faces first at low alpha, then front
  faces", just bounded to the two layers that carry the depth cue.
- **Premultiplied additive.** The hologram materials use `CustomBlending` with both factors set to
  one, so the alpha channel plays no part and every bit of brightness is spelled out in the
  shader. There is a soft knee, `holo / (1 + holo * 0.45)`, because a layer that lights the whole
  cortex at once, simulated activity for instance, clips to white without it.
- **Tracts float over the cortex.** They draw with `depthTest: false` at very low alpha, because
  a tract that runs under the surface should be seen through it, not depth tested away by it. Two
  hundred tubes stack, so a healthy tract is almost invisible and a damaged one is what reads.
- **Damage auto scales.** The model's regional damage runs small, often under 0.2, so a fixed 0 to
  1 ramp leaves the cortex dark. The damage layer scales to this patient's own worst region at
  week 0, floored at 0.12 so a nearly healthy brain is not amplified into looking wrecked. The
  legend prints the real number at the bright end and says it is scaled. The callouts, the panels
  and the "Where it hurts" list all print absolute values, never scaled ones.
- **Callout ranking.** The floating callouts follow whatever the active layer lights most. The
  "Where it hurts" list is always ranked by damage, because that is what the phrase means.
- **Difference layer.** C4's difference toggle needed a diverging ramp with its own legend, so it
  is a ninth entry in `LAYERS` that C3 hides. C4 hides the what-if and the drivers for the same
  reason, they are not scenario comparisons.
- **Scenario damage scale.** `ScenarioResult.diff` is a list of string pairs, so the compare page
  parses the first row whose parameter name mentions damage, scale or severity and whose two
  values parse as numbers, then normalises them against the larger. If no row qualifies both
  brains show the patient's own damage and the panel says so. The impact angle is real either
  way: each side turns `shape.impact.point` about the superior axis, which moves the marker, the
  swelling and `aImpactDist`.
- **Receptor names.** The real backend serves `GABA-A`, `NMDA`, `D2`, `5-HT2A`, `mu-opioid`. The
  mock layer serves `GABAa`, `NMDA`, `D2`, `5HT2a`, `MU` among others. `receptorMap` in
  `SidePanels.tsx` tries every known spelling for a canonical target.
- **Receptor density overlay.** Rather than a tenth ramp, the overlay reuses the signal drivers
  layer: the receptor map is min max scaled to 0 to 1 the way the backend scales it, passed as
  `weights`, and the stage shows a caption naming the map.
- **Healing is flat and says so.** `recovery` is this patient's k over the population mean k and
  the model has one global k, so every region carries the same number. The layer note says that
  in as many words and points at the uncertainty layer, which genuinely does vary per region.
- **Activity is centred on zero.** `activity` is a standardized deviation from the healthy firing
  rate, roughly minus 6 to 0, so the ramp runs blue at minus 3, white at 0 and red at plus 3.
- **Region borders.** `border` is 1 on about 30 percent of vertices, so a straight read gives a fat
  band. The fragment shader uses `pow(vBorder, 12.0)` and a low opacity, which concentrates the
  line near the seam vertices rather than filling whole triangles.
- **Sulcal shading.** The pial to inflated distance is normalised against the mesh's own mean and
  standard deviation, computed once in `buildCortex` and passed as `uSulcLo` and `uSulcHi`. A
  fixed range looked right on the procedural mock and washed out on fsaverage5.
- **Replay timing.** Six seconds. The impact rings from the start, the wave grows from 0.6 s to
  about 3.3 s, then the week hands over to the scrubber and plays 0 to 12. Pause, stop and a
  speed control sit next to the button, and the caption says it is an illustrative animation.
- **Week on open.** C3 opens on the week the patient is actually in, once per patient, then leaves
  the scrubber alone.

## Performance

The approach is to do the work once and then touch almost nothing per frame.

- One `BufferGeometry` for the whole cortex, built once per mesh and shape and disposed on
  unmount. 20484 vertices, 40960 faces, seven attributes.
- Draw calls: cortex back, cortex front, tract tubes, tract particles, grid floor, impact ring,
  impact disc, replay ring, plus the bloom and vignette passes. The two cortex passes are the
  hologram requirement from the header; everything else is one call each.
- Per frame the driver writes about fifteen uniforms, lerps a 400 float array, and uploads two
  small DataTextures, 1.6 kB and 4 kB. No geometry is rebuilt and no buffer is reallocated.
- React never renders inside the frame loop. The replay writes the week to the store only when
  the integer week changes, which is twelve renders across a six second animation.
- Compact mode drops antialiasing, the grid, the particles and the callouts, and lowers the bloom
  resolution, because the compare screen runs two canvases at once.
- `dpr` is capped at 1.75.
- Reduce motion sets `uMotion` to 0, which kills the pulse, the jitter, the shimmer, the scan
  sweep, the tract flow and the particles in one uniform.
- Everything created with `new` is disposed: geometries in `BrainViewer` and `Tracts`, materials
  in `CortexMesh` and `Tracts`, ring geometries in `ImpactMarker`, textures in `Scene`.

Measured frame rate is not reported here because the only browser available in this environment
is a software rasterizer, where the number says nothing about a real GPU.

## Fallbacks

- No WebGL, or WebGL 1 without `OES_texture_float`: `capabilities.ts` catches it before the Canvas
  mounts and `Fallback2D` renders a flat region map, one dot per region at its real centroid,
  coloured by the active layer and clickable, with the reason printed above it.
- `mesh.source !== "fsaverage5"`: the stage shows an amber "Placeholder mesh" badge.
- `shape` fails: the template surface renders and a line says the shape parameters are missing.
- `/api/loadings` 404s when `REGIONAL_LOADINGS` is off: the signal drivers layer falls back to the
  attribution endpoint, mapping tract names back to region ids. If neither is available the layer
  is disabled with the reason on it.

## Known gaps

- **Picking is computed on the undeformed surface.** Raycasting uses the pial positions in the
  BufferGeometry, but the deformation happens on the GPU. At the default settings the offset is a
  millimetre or two and picking lands on the right region. At full inflate it can land on a
  neighbour.
- **Normals are the pial normals.** They are not recomputed after the shader deformation, so the
  lighting at full inflate is slightly stale.
- **Slider labels sit on the Radix root, not the thumb.** `components/ui/slider.tsx` forwards props
  to `Slider.Root` and leaves `Slider.Thumb` bare, and `Thumb` is the element that carries
  `role="slider"`. Every slider here is keyboard driveable and has visible text naming it, but a
  screen reader will read the thumb without a name until that shared component passes
  `aria-label` through. That file is not owned by this agent.
- **`Mesh.region_xyz` is not in the contract type.** It is read through an optional cast. Adding
  it to `api/types.ts` would remove the cast.
