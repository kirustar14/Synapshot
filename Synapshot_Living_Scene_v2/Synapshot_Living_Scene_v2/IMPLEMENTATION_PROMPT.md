# Implementation prompt — Synapshot Living Scene v2

Build/refine the existing Synapshot public landing and clinician login pages using the `Synapshot_Living_Scene_v2` directory in the project root. First inspect the current repository, the files in this pack, and `APPROVED_FULL_SCROLL_REFERENCE.png`.

## Creative direction
Reproduce the approved full-scroll mockup's continuous, warm sunlit environment: left window and sheer curtain, directional afternoon light, plaster wall, plant foliage, wood table, bowl/books, shadow of a person with a delicate neural-brain illustration inside the head. Keep the single public Login button, Synapshot wordmark, editorial headline and explanation. Text and all form controls must be real HTML; never use the screenshot as the webpage background.

## Assets and composition
- `assets/hero-scene-wide.webp` is a CLEAN, text-free wide background based on the original silhouette scene, with cream negative space on left; the source photo is `assets/silhouette-scene-original.webp`. These are useful starting assets, **not a full photorealistic recreation of the new mockup** (the source does not include the mockup's visible curtains/window). Add/commission a new clean scene if closer fidelity is required, do not claim the provided base has curtains.
- `assets/continuous-lower-scene.webp` is a calming continuous warm texture for below-the-fold with no text. Design the page so hero and lower content feel like one continuous room, not two abrupt sections. Seam the layers with gradients / matching colors rather than repeating the hero artwork.
- `assets/living-light.svg` plus `example/scene-motion.css` produces a mathematically seamless looping light layer: animation state at 0% equals 100%, no cut-off. This is a LIGHT approximation; it does not literally simulate fabric movement.
- `assets/brain-network.svg` and `example/BrainTrace.tsx` show how to trace ALL main neural paths with one arc-length-based clock. Every path runs at the same physical speed; stroke and dot share exactly the same progress. Paths fade out before repeat, then a 4s inactive interval prevents abrupt looping. Tune SVG scale and location to align with the baked-in brain inside the shadow; otherwise the result doubles the outline. If useful, replace the baked-in brain using careful retouching, without altering the person's shadow.
- The foliage is still imagery; do NOT claim real independent leaf motion exists. If you want swaying leaves, commission a separate masked plant layer or perform careful compositing; don't rigidly animate the whole still image.

## Continuity and UX
The hero scene leads naturally into the “How Synapshot works” 3 steps, then the closing statement and footer; no section should hard-cut to an unrelated design. Keep lower portions brighter and quieter to support readability. On login, use the same shared scene in a persistent layout and smoothly shift its crop/position (~800ms), letting the headline fade out and the login form fade in. Brain and shadow must transform together, not become detached. Make back/forward navigation work and avoid remounting the scene during client-side transition where possible. No full-page generic app UI, no signup or demo buttons.

## Looping and performance
Do not substitute GIF or pseudo-video. The provided looping motion uses CSS periodic keyframes with matching 0/100 boundaries. SVG neural trace has a controlled fade to zero prior to restarting, eliminating a visible teleport at the loop boundary. If replacing the animated overlay with actual `.webm`/`.mp4`, only do so when the clip's first and last visual states match and you have verified it loops seamlessly; don't claim to have generated video unless one exists. Avoid unnecessary blur/filters and respect `prefers-reduced-motion`.

## Clinical product
Keep medical dashboard and auth code intact. Login enters the actual clinician login route; do not invent hardcoded credentials. Prototype outputs are research forecasts and supportive signals, not diagnoses. Validate desktop/mobile, brain alignment, browser back, accessibility, and build/lint. Report asset limitations transparently.
