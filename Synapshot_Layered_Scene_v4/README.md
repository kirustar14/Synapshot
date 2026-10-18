# Synapshot Layered Scene v4

This pack contains a rebuilt layered room scene for the Synapshot landing page and login page.

## Verified contents

- `assets/room-base.png` — static room plate (1024 × 1536), no alpha. Verified to contain the full continuous room with the window, profile-shadow silhouette, table, bowl, book, floor, and lower-room continuation.
- `assets/curtain-overlay.png` — RGBA transparent overlay (1024 × 1536). Verified to contain partial transparency and isolated sheer curtains for motion.
- `assets/plant-overlay.png` — RGBA transparent overlay (1024 × 1536). Verified to contain isolated potted plant with transparency.
- `assets/drifting-leaves.png` — RGBA transparent overlay (1024 × 1536). Verified to contain isolated drifting leaves with transparency.
- `assets/light-shadow-overlay.png` — RGBA transparent overlay (1024 × 1536). Verified to contain a transparent sunlight / shadow overlay.
- `assets/brain-network.svg` — editable SVG network for the animated brain.
- `components/BrainTrace.tsx` — animated tracing component with synchronized spark + line.
- `components/LayeredScene.tsx` — example composition component showing how to stack all assets.
- `styles/scene-motion.css` — animation CSS for curtain sway, light drift, plant sway, and drifting leaves.
- `references/full-scroll-reference.png` — the approved full-page composition reference.
- `references/plain-background-example.png` — earlier plain background reference.
- `IMPLEMENTATION_PROMPT.md` — exact implementation prompt.

## What this pack is designed to do

- Use one continuous room background for the whole landing page.
- Animate the curtains separately.
- Animate sunlight / shadow movement separately.
- Animate the plant separately.
- Add sparse drifting leaves.
- Add a separate animated brain overlay aligned to the silhouette.
- Reuse the same room for the login page via a shifted crop.

## What was programmatically checked

The PNG overlays were checked for dimensions and alpha channels. All four overlays include actual transparency and are not flattened black rectangles.

## Notes

- These are layered assets intended to sit behind real HTML content.
- The login page should use the same scene with a shifted crop or horizontal translation.
- Brain placement still needs visual alignment in implementation because the landing-page layout and crop determine the final exact position.
