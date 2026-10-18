# Synapshot visual motion pack

## Contents
- `assets/landing-reference.png` — original approved reference screenshot; reference ONLY, not a background image (it includes text).
- `assets/sunlit-scene.webp` — cropped photographic right-side background, no baked-in text or buttons (736×809). Use for atmosphere; not a full-width photograph.
- `assets/brain-trace.svg` — animated, transparent brain illustration with tracing spark. Usable directly in `<img>`; SVG SMIL animation support varies slightly by environment.
- `assets/curtain-light.svg` — transparent soft-light overlay; move slowly using supplied CSS.
- `assets/scene-motion.css` — starting styles and reduced-motion fallback. Adapt to the actual app layout; not drop-in complete route code.
- `IMPLEMENTATION_PROMPT.md` — full coding agent instructions.

## Usage
Copy the `assets/` directory to `<project>/public/assets/`, the prompt to your project root, and tell your coding agent to follow `IMPLEMENTATION_PROMPT.md`.

## Important production notes
- The extracted photo is a crop from the reference, not a separate clean full-width photo. Extend the cream background to cover the other side; do not stretch it across the whole viewport.
- Actual wind-blown leaves require separate transparent leaf masks or a specially shot video. We are **not** pretending a video or alpha plant layer exists in this archive.
- The SVG tracing animation is real. The light layer motion is real when the CSS is integrated. Do not overanimate the static leaves baked into the photograph.
- The reference does not contain a physical window object on the right; the source of sunlight is implied off-frame. Keep any newly introduced window geometry consistent with shadow direction.
