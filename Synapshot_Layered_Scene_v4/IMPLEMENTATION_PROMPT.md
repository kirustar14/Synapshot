# Synapshot — Implement Layered Scene v4

Implement the supplied **Synapshot Layered Scene v4** asset pack in the existing project.

The folder `Synapshot_Layered_Scene_v4` has been added to the project root.

## 1. Read and inspect first

Before changing code:

1. Read `Synapshot_Layered_Scene_v4/README.md`.
2. Inspect every asset in `Synapshot_Layered_Scene_v4/assets/`.
3. Inspect `components/BrainTrace.tsx`, `components/LayeredScene.tsx`, and `styles/scene-motion.css`.
4. Inspect the current landing page, login page, shared layout, and authentication flow.
5. Inspect the approved composition reference at `references/full-scroll-reference.png`.

Use the provided files as the implementation foundation.

## 2. Core design direction

The landing page and login page should both live inside the same warm, continuous room.

That means:

- one continuous room background
- one lighting system
- one silhouette on the wall
- one brain overlay aligned to that silhouette
- one set of animated scene layers
- a camera-like transition between landing and login

Do **not** revert to a hero image plus a fake beige lower extension.

## 3. Use the layered scene approach

Use `assets/room-base.png` as the static room plate.

This should be the only base background for the landing page.

Then layer on:

- `assets/curtain-overlay.png`
- `assets/light-shadow-overlay.png`
- `assets/plant-overlay.png`
- repeated instances of `assets/drifting-leaves.png`
- the animated `assets/brain-network.svg` via `components/BrainTrace.tsx`

Stack them in the same environment using a shared scene wrapper. You can use the provided `components/LayeredScene.tsx` as the starting point or adapt its structure into the app's architecture.

## 4. Landing page requirements

Keep the existing page copy and structure.

Preserve:

- top-left `synapshot` wordmark
- a single top-right `Login` button
- headline: `Ongoing insight for recovering minds.`
- supporting paragraph
- `How Synapshot works`
- the three workflow steps
- closing statement
- footer disclaimer

Do not redesign the content.
Do not add extra CTA buttons.
Do not add generic SaaS cards.

All text and controls must remain real HTML/CSS.

## 5. Scene behavior

### Base background

Use one continuous room background across the full landing page.

Do not:

- split the scene into hero and lower sections
- blur or fade the lower half into beige
- stretch a shorter image vertically
- swap to a different background lower on the page

The whole landing page must feel like one room.

### Curtains

Use `curtain-overlay.png` as the animated foreground curtain layer on the left.

The motion should feel like sheer fabric moving gently in a breeze.

Keep it subtle.
Do not swing it dramatically.

### Light and shadows

Use `light-shadow-overlay.png` as the animated natural-light layer.

It should shift gently, almost imperceptibly, as though sunlight and blinds / sheer curtains are moving slightly.

The loop must remain seamless.

### Plant

Use `plant-overlay.png` as the right-side plant layer.

Animate it slightly at the stem base so the leaves appear to drift in the same breeze.

Keep the movement restrained.

### Falling leaves

Use the `drifting-leaves.png` asset sparingly.

Do not create a constant heavy rain of leaves.

A few soft drifting leaves moving across the scene is enough.

If you use multiple leaf instances, stagger timing, opacity, and movement so they do not look synchronized.

### Brain animation

Use `components/BrainTrace.tsx` and align it precisely with the silhouette's head in the base room image.

Requirements:

- the brain stays inside the head silhouette
- the spark and illuminated line remain synchronized
- the tracing eventually traverses the whole network
- the underlying faint network remains visible
- no duplicated or offset brain appears

If the default example placement is slightly off, recalibrate it visually.

## 6. Login page continuity

The login page should use the same scene, not a separate unrelated background.

Use the same layers but shift the crop / scene position slightly so it feels like the camera moves through the same room.

Keep the login form minimal and functional.

Preserve the real authentication flow.
Do not break the dashboard.

## 7. Responsiveness

Support desktop and mobile.

On smaller screens:

- keep the layout readable
- maintain a sensible crop of the room
- preserve the silhouette if possible
- keep the Login button visible
- reduce motion density if needed

Do not force the full desktop scene into mobile without adjustment.

## 8. Reduced motion

Respect `prefers-reduced-motion`.

When enabled:

- stop curtain animation
- stop plant sway
- stop drifting leaves
- stop animated light drift
- show the brain in a static, polished state or let the tracing component handle reduced motion

## 9. Clean implementation expectations

- Move the supplied assets into the proper public/assets path or another project-appropriate asset location.
- Keep only one active background strategy.
- Remove the previously broken lower-scene extension approach from active use.
- Integrate the new layered environment cleanly with the existing page.
- Use GPU-friendly transforms and opacity changes.
- Avoid animation libraries unless the project already uses one and it clearly helps.

## 10. Final verification

Before finishing:

1. Confirm the full landing page looks like one continuous room.
2. Confirm there is no abrupt scene cutoff.
3. Confirm the silhouette remains visible.
4. Confirm the brain is aligned and animated properly.
5. Confirm the curtain, light, plant, and leaf layers animate naturally.
6. Confirm the landing-to-login experience still feels cohesive.
7. Confirm the build passes.
8. Confirm reduced-motion behavior works.

## Final goal

The result should feel like a living, sunlit editorial scene behind the Synapshot landing page and login page.

It should stay minimal and warm.

Do not over-style it. Do not reinterpret the composition. Use the supplied assets and keep the implementation faithful.
