# Prompt for the coding agent

Implement the Synapshot animated landing page using the asset pack in `Synapshot_Paper_Landing_Kit_v6`.

Read `README.md` first, then inspect every file in `assets/` and `references/`.

## Main goal
Build a polished, animated, full-scroll landing page that feels like one living, coherent sunlit room.

Use the asset pack directly. Do not replace the core scene direction.

## Use these assets
- base room: `assets/room_base_full_scroll.png`
- curtain layer: `assets/curtain_overlay.png`
- light/shadow layer: `assets/light_and_shadow_overlay.png`
- plant layer: `assets/plant_overlay.png`
- drifting leaves: `assets/drifting_leaves_overlay.png`
- brain layer: `assets/brain_overlay.png`

## Key visual requirements
1. Preserve the left window and full-scroll room continuation.
2. Keep one continuous room from navigation to footer.
3. Keep the hero framing similar to the supplied references.
4. Use the room base as the only main background.
5. Keep all page text and buttons as real HTML/CSS.
6. Do not create a fake lower filler scene.
7. Do not introduce giant white masks or split the room into two unrelated halves.

## Required motion system
The motion should feel physically coherent, as if one gentle breeze drives the scene.

### Shared environment motion
Use one underlying “wind” / “environment” motion signal that coordinates:
- curtain billow
- light / shadow drift
- plant sway
- occasional drifting leaves

This should prevent the animations from feeling random or disconnected.

### Curtain
- place the curtain layer on the left near the window
- keep opacity restrained
- the curtain should not cover the entire page heavily
- animate it with a gentle billow / sway
- avoid rigid rotation
- loop seamlessly

### Light / shadow
- animate the `light_and_shadow_overlay.png` subtly
- it should drift in response to the same wind motion
- maintain the left-to-right sunlight logic
- no abrupt resetting or flashing
- use this layer for the dynamic shadows rather than baking big moving shadows into the base

### Plant
- place the plant on the right side as part of the room
- animate it very subtly
- do not rotate it as one stiff block
- use a restrained sway from the lower anchor point
- it should feel like the same breeze affecting the curtain

### Drifting leaves
- use them sparingly
- only a few should appear
- stagger them in time, speed, opacity, and position
- they should drift through the hero occasionally, not constantly rain down

### Brain
- place the brain precisely inside the silhouette’s head
- use a warm, elegant glow
- implement an animated tracing / traveling-spark effect
- the brain should feel alive but restrained
- no cold neon colors
- no duplicated or offset brain artwork

## Page content
Implement these sections as actual content over the scene:
- wordmark top left: `synapshot`
- top right button: `Login`
- hero headline: `Ongoing insight for recovering minds.`
- supporting copy: `AI-powered neurological check-ins between visits, using simple cognitive tests analyzed over video.`
- lower section: `How Synapshot works` with 3 steps
- closing statement
- footer disclaimer

## Navigation / transition note
This page should be easy to integrate with the rest of the app. The Login button should transition to the login page while keeping the same visual world as much as practical.

## Technical guidance
- Prefer layered DOM + CSS transforms + SVG / canvas for the brain
- You may use requestAnimationFrame for the brain or for a shared motion controller if needed
- Respect `prefers-reduced-motion`
- Keep performance reasonable
- Optimize assets appropriately

## Very important QA requirements
Do not consider the task complete just because the code compiles.

You must run the page and visually verify:
1. the window is visible
2. the full-scroll lower continuation is preserved
3. the hero framing still matches the intended composition
4. the curtain motion is visible and tasteful
5. the light/shadow motion is visible and tasteful
6. the plant sways subtly
7. leaves drift only occasionally
8. the brain is aligned and animated
9. all loops are seamless
10. the whole page feels calm, premium, and handcrafted

If any overlay looks pasted on, too strong, too misaligned, or too distracting, refine it before finishing.
