# Implementation task: Synapshot One Room v3

You are working inside the existing Synapshot application. The `Synapshot_One_Room_v3` folder is already extracted into the project root. Build and refine the existing public landing page and matching clinician login page using the files in this pack. Preserve the existing app, clinical dashboard, routing, authentication, and other features.

## 0. Inspect and validate
Read `Synapshot_One_Room_v3/README.md`. Open the real assets and the full-scroll visual reference. Check framework, styles, existing routes and login. Do not assume mockups are deployable background assets. No video file is included.

## 1. Nonnegotiable design
- Use **one cohesive room environment** behind the ENTIRE landing page, from the navigation through the footer. No hard seams between hero and lower text sections; do not use separate stacked section background images.
- The page is calm and minimalist: cream and natural warm light, dark thin sans-serif, muted terracotta, lots of whitespace, no cards/glows beyond the restrained brain animation. Header has only `synapshot` (left) and a single `Login` button (right). No extra hero CTA.
- Keep landing copy: **Ongoing insight for recovering minds.** Body: **AI-powered neurological check-ins between visits, using simple cognitive tests analyzed over video.** Below: **How Synapshot works**, three columns **01 Check in / 02 Understand change / 03 Stay informed**, then **Recovery doesn’t stop between appointments. Neither should our understanding of it.** Footer: **Research prototype. Not a replacement for professional medical evaluation.**
- The photographically coherent human head silhouette with neural network in its head must remain present and aligned. Physical sunlight direction should match the window.
- `reference/approved-full-scroll-mockup.png` is VISUAL REFERENCE ONLY. It has text baked in. Use `assets/one-room-continuous.webp` (one 2200×3300 text-free image) as available implementation fallback. Its lower part is intentionally a subtle ambient fade rather than a new photographic room; if a truly text-free single room image can be generated/retouched, improve it without inserting text or swapping to unrelated imagery. Never use the screenshot itself behind live text.

## 2. Image coordinate system and scrolling
Use one scene root element containing a single full-page background layer. Size and position it responsively. Establish normalized reference coordinates against `one-room-continuous.webp`, and anchor every overlay to this SAME container, NOT the browser viewport. Ensure image crop and overlay positioning use the same aspect/crop transform and remain aligned at 1440px desktop, 1024px tablet, and 390px mobile. Text remains real semantic HTML on top. Never stretch aspect ratio or simply tile an unrelated image.

## 3. Curtains, light, plant
- Copy `assets` to `public/synapshot-v3/` and adapt `components/scene-motion.css` to the app. Import `curtain-veil.svg` and `foliage-shadow.svg` as sparse optional overlays.
- The photographic blinds / sheer curtains remain in the static base. Simulate a soft breeze with minuscule changes in veil curvature and opacity, consistent with the left-side window. Light shafts shift slowly across the existing wall. Use exactly periodic CSS keyframes (same 0% and 100% transforms and opacity) with staggered ~17–26 second cycles so loops never cut.
- Plant: gently move foliage near right side (approx 1 degree / few px), not the whole image, shadow, furniture, or silhouette. The included foliage shadow is stylized, NOT an extracted matching plant. If layering it causes doubled leaves, OMIT it or replace with an accurately isolated leaf mask; don't misalign fake foliage over real foliage. A subtle animated shadow alone is acceptable.
- No GIFs, fake asset paths, or promised WebM files. Video may be created later only from actual recorded/rendered seamless source footage, with first/last-frame QA.

## 4. Brain tracing
- Use provided editable `brain-network.svg` and `components/BrainTrace.tsx` as the basis, but **calibrate geometry against the silhouette in the actual scene**. Brain may be slightly more evident but should not look neon.
- All major brain paths are traversed within a complete sequence. One primary golden-white spark follows the leading edge of the active line; its position and stroke reveal MUST use one shared arc-length progress. Use getTotalLength() and getPointAtLength() for each traversed path. The dot may not run ahead or lag behind the stroke.
- IMPORTANT: The SVG includes one compound path with multiple subpaths. Split disconnected subpaths into separate path elements or author topology explicitly to avoid teleporting between M commands. For disconnected sections fade a new spark in instead of jumping.
- Base lines remain faintly visible, active segment brightens, short trailing glow fades. 12–18s trace + 2–4s pause, with all highlighted segments faded to zero before cycle wraps. No first/last-frame flash.
- If the original brain is already baked into the photograph, avoid visibly doubling its outlines. Precise positioning is more important than cosmetic effects.
- Preserve scene and trace progress during landing-to-login navigation if technically feasible.

## 5. Login scene continuity
Clicking the one header Login button routes to the existing `/login` or discovered real auth route. Landing text fades and the shared room background gently shifts/crops, while a small cream email/password form appears. Same room, light direction, plant and silhouette. Time 700–1000ms; no bounce. Back navigation reverses it. Refreshing `/login` works. Use existing authentication; never hardcode real passwords or fake production auth. Forgot password only if actual flow exists. Dashboard after successful sign-in remains untouched.

## 6. Accessibility, performance, QA
- Motion via CSS transforms/opacity or efficient SVG updates, not React rerenders each frame; clean up RAF. Avoid full-page blur, excess assets, or video overhead.
- Respect prefers-reduced-motion: stop curtains, light, foliage, and brain spark; show static brain and allow direct route transition.
- Verify screenshot at desktop/mobile against the approved reference and inspect the full page scroll: no seams/duplicated motifs, good reading contrast, no clipping. Check brain alignment, dot/stroke velocity, smooth full cycle, browser back, direct login refresh, and auth flow. Run project build and typecheck. Address concrete failures.

Be explicit in your work summary if the current background cannot reproduce the newest curtains/window perfectly. Do not claim photographic wind animation or video assets exist. Improve using actual source or code, not generic AI-themed ornaments.
