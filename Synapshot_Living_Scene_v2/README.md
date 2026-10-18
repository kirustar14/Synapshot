# Synapshot Living Scene v2

This pack contains **real files**, including two text-free WebP backgrounds, a full-scroll reference image, a transparent SVG lighting overlay, an SVG brain network, an executable React/TypeScript neural tracing component, and looping CSS. The supplied materials are not prerecorded videos.

### Pack contents
- `APPROVED_FULL_SCROLL_REFERENCE.png` — user-approved tall visual mockup (TEXT IS BAKED IN: reference only)
- `assets/silhouette-scene-original.webp` — original cropped text-free still, including shadow, brain, plant, table, book and bowl
- `assets/hero-scene-wide.webp` — text-free adapted wide scene, blended into cream negative space
- `assets/continuous-lower-scene.webp` — long text-free neutral environment for below-fold continuation
- `assets/brain-network.svg` — complete eight-path static neural network
- `assets/living-light.svg` — transparent directional light overlay
- `example/BrainTrace.tsx` — synchronized full-path tracing, with mathematically defined 18s cycle and 4s idle
- `example/scene-motion.css` — seamless 22s light animation; first/last keyframes match
- `IMPLEMENTATION_PROMPT.md` — give this to your coding agent

### Important limitations
- The **wide still image was derived from the earlier clean silhouette asset**; its photographed scene lacks the visible window and curtains shown in the latest full-scroll mockup. That exact scene has *not* been recreated without text. This pack includes the reference to help the agent art-direct a better clean image.
- No `.mp4`/`.webm` file is included: the provided SVG/CSS and React animations loop continuously without an abrupt visual reset. The curtain effect represents shifting light, not moving photographic fabric.
- No isolated foliage layer is included; the plant remains static in the still image.
- The SVG brain requires alignment with the image's existing baked-in brain; the position and scale must be calibrated by the coding agent.
- The network traces 8 visible paths sequentially; connectedness and full graph traversal may need manual authoring for a specific intended topology, so avoid asserting a physical brain electrical simulation.

Extract the folder into your project root. Copy assets to `public/synapshot-living`, and adapt the example code to your routing and layout. Read `IMPLEMENTATION_PROMPT.md` for full instructions.
