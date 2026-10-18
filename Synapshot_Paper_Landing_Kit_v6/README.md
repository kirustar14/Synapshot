# Synapshot Paper Landing Kit v6

This kit is a full layered landing-scene pack for Synapshot, intended for two uses:
1. building the final visual framing in **Paper** for the design / UI / UX track
2. implementing the animated landing page in code afterward

## What is included

### Production assets
- `assets/room_base_full_scroll.png`
  - clean tall full-scroll room plate
  - includes the left window, soft curtain presence near the window, the right-side silhouette, table, bowl, books, rug, chair edge, and the calmer lower continuation of the room
  - intentionally avoids strong diagonal dynamic light bands so those can be animated separately
- `assets/curtain_overlay.png`
  - transparent isolated curtain overlay for motion
- `assets/light_and_shadow_overlay.png`
  - transparent sunlight / window-shadow / foliage-shadow overlay for dynamic lighting
- `assets/plant_overlay.png`
  - transparent right-side plant + pottery overlay for subtle sway
- `assets/drifting_leaves_overlay.png`
  - transparent sparse drifting leaves overlay
- `assets/brain_overlay.png`
  - transparent glowing warm neural brain overlay

### Reference-only files
- `references/full_scroll_layout_reference.png`
  - full-page layout reference with text baked in; do **not** use as the deployed background image
- `references/hero_framing_reference.png`
  - hero framing reference showing the desired relationship between text area, silhouette, brain, window, and table

## Canvas + ratio
All production assets are on the same 941 × 1672 canvas (portrait full-scroll friendly). This keeps positioning simpler across layers.

## Important implementation intent
- The **window is preserved** in the base room composition.
- The **full-scroll continuation is preserved** in the base room composition.
- The **dynamic lighting is meant to come from the separate light/shadow overlay**, not from big baked-in moving shadows in the base.
- The **brain is a separate overlay** so it can animate independently.
- The landing page should use one shared room scene from top to bottom, not a hero image plus a fake lower filler.

## Recommended design / build workflow
- In Paper: use `room_base_full_scroll.png` as the base visual direction and compose the final landing page over it. Use the references to match framing.
- In code: stack the overlays over the base room and animate them with one coordinated motion system.

## Notes
- The silhouette remains part of the base room, since it is a key compositional anchor.
- The strong moving sunbeams and foliage shadows should come mainly from `light_and_shadow_overlay.png` to avoid the “double shadow” problem.
