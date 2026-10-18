# Synapshot One Room v3

This pack contains **actual usable assets and code**, not generated video clips. The looping effects are CSS/SVG so they have matching 0% and 100% positions, unlike clips that cut abruptly.

## Contents
- `assets/one-room-continuous.webp`: ONE text-free 2200×3300 continuous background. The intact top photo is extended into a quieter ambient plaster continuation. **The bottom is an art-directed fade, not a photographically generated continuation of the room.**
- `assets/original-room-still.webp`: original text-free atmospheric source.
- `assets/brain-network.svg`: editable stylized neural paths.
- `components/BrainTrace.tsx`: React SVG tracing example with shared path-length progress and spark alignment.
- `assets/curtain-veil.svg`, `assets/foliage-shadow.svg`, `components/scene-motion.css`: optional, seamless-loop overlays.
- `reference/approved-full-scroll-mockup.png`: the approved full-scroll reference **contains baked-in words; never use as the deployed image background**.
- `reference/design-board.png`: concept only; any videos depicted in this board are **not** video files included in the pack.
- `IMPLEMENTATION_PROMPT.md`: implementation instructions.

## Important constraints
- The continuous background is built from the earlier clean image and does **not** faithfully reproduce the newest window/curtain details. The original approved tall artwork is a text-bearing mockup, not a clean environment plate. A photo-grade recreation would require retouching or generating a truly text-free plate.
- Curtain motion here is a moving **lightweight translucent veil**, NOT realistic independently billowing photographic fabric. Foliage is an additive shadow, NOT an isolated animation of the existing photographed plant. The agent should reduce/omit overlays that visually double existing elements.
- Brain trace SVG geometry is stylized and needs calibration against the photographic silhouette: do not claim pixel-perfect registration before aligning it.
- Brain traversal is a visual effect, not physiological simulation. SVG includes one compound path with two subpaths; split at `M` subpath boundaries if spark jumps are visible.
- No GIF, MP4, or WebM is supplied or required. All included overlays are real assets.

## Install
Copy `assets/*` into `public/synapshot-v3/`. Bring the React component and CSS into your existing app. Render one background layer behind the entire scrollable landing page, not one background per section. Adjust its vertical dimensions to the desired page height. Place the brain overlay in the same scene coordinate space, match its crop/scaling, and retain the original authentication integration.
