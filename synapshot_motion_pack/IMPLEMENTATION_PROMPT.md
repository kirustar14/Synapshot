# Synapshot motion scene and login transition implementation

Inspect the existing codebase and these provided files before editing:
- `assets/landing-reference.png` (visual reference, not a website background)
- `assets/sunlit-scene.webp` (photo-only crop)
- `assets/brain-trace.svg` (actual animated brain SVG)
- `assets/curtain-light.svg` (light overlay)
- `assets/scene-motion.css` (suggested CSS animation)

Implement a minimal, warm, editorial public landing page for Synapshot and a dedicated clinician login page. Preserve existing application routes and authentication. Follow the source image's cream palette, whitespace, lightweight type and one terracotta Login CTA in the navbar. Landing hero copy: "Ongoing insight for recovering minds." Supporting text: "AI-powered neurological check-ins between visits, using simple cognitive tests analyzed over video." Keep the brief three-step explanatory section and research prototype disclaimer if they already exist. No extra hero CTA, navbar menus, feature card grids, badges, stock mockups, or ornament.

SCENE: Create one atmospheric background system for both landing and login. The source photography is ONLY a right-side crop, so keep the left side warm cream and blend the photo's left edge with a mask. Don't stretch that crop as a full-screen image; don't use the reference screenshot itself as wallpaper. Overlay `curtain-light.svg` with very slow horizontal drifting (about 12–18 seconds) and low opacity so the scene feels alive but remains calm. Place `brain-trace.svg` over the wall at the center-right, readable but not sci-fi, with its built-in tracing spark. Do not add glows or particles beyond the SVG. Prefer reduced motion for users requesting it. Avoid animated parallax on scroll.

LEAVES: The crop contains a static plant. Do NOT rotate or pan the whole photo to simulate leaf sway. If you can responsibly segment the plant into a separate transparent alpha layer, animate that leaf layer by fractions of a degree with a 7–12 second slow alternate cycle; otherwise leave the plant still and rely on dynamic sunlight + spark. Do not manufacture poor-looking CSS leaves.

LIGHT SOURCE: The source is a wall scene with implied window light, not an explicit window. Keep lighting consistent. If introducing a sheer curtain, align it with the direction of incoming sunlight and avoid contradictory shadows. The existing reference is more important than a literal visible window.

LOGIN TRANSITION: Clicking the single Login button should navigate to a dedicated `/login` page, NOT open a modal. Preserve the atmosphere so it feels like the camera reframes slightly within the same room. If the app uses Next.js App Router, consider a shared layout scene component to avoid a background hard cut; use a modest 0.5–0.8 second background crop/position transition and a brief content fade. Do not force non-native view transitions if route architecture doesn't support them. The login form should be a small, accessible, solid or softly translucent off-white card, placed center-left or center, with "Welcome back", email, password with visibility toggle, Sign in, and Forgot password if supported by the actual auth flow. Do not fake successful auth. Keep the brand wordmark top-left. The dedicated clinical dashboard after login must remain practical, flat and scannable; do not extend the photographic aesthetic into clinical data grids.

IMPLEMENTATION: Work within the existing framework (preferred Next.js/React/TypeScript/Tailwind if already configured). Place assets at `public/assets`, use semantic HTML, keyboard-visible focus styles, properly associated labels, appropriate autocomplete attributes, responsive layout, performance-friendly compositing for transform/opacity, and image dimensions. Honor `prefers-reduced-motion`; disable the brain animation with a static SVG fallback if needed (can hide animated trace/dot and keep outline). Avoid unnecessary libraries, GIFs and fake video assets.

Verify at 1440px, 1024px and 390px widths; check contrast, typography overlap, scene masks, correct `/login` navigation and existing auth integration. Run lint/build/tests where available. At the end, report what was changed and any limitations, including whether real leaf motion was possible with available image assets. Be restrained: motion should be barely perceptible until someone watches for a few seconds.
