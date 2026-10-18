# Synapshot landing and login handoff

The live preview is http://localhost:5186/. Desktop and laptop are the primary composition targets.

## Final composition

The opening text sits lower and farther left. The wordmark and Login action sit near the upper corners, with 3vw side insets and a 30px top position on desktop. The desk, books, and bowl remain visible in the first 1920 × 1080 screen. The silhouette is part of the untouched photograph and receives no independent deformation.

The supplied `Synapshot_Paper_Landing_Kit_v6/assets/wide outpaint og ref.png` is 1122 × 1402 pixels. The scene uses its native proportions at 102vw wide, offset left by 1vw and cropped by 14vw from the top. All overlays share that same coordinate space and camera transform. The login camera moves the entire scene another 0.9vw left and 7vw up.

The brain SVG has a native box at x=785, y=378, width=133. Its paths have internal whitespace, so those box coordinates deliberately differ from the visible outline. The fitted outline stays inside the photographed head. The ivory base paths are 2.1 SVG units wide at 94% opacity; active tracing is 3 units wide with a restrained glow.

## Full scroll

The original photograph is retained, including its floor. The bottom 200 native pixels contain unobstructed floor; reflected and normal copies add 400 pixels, giving a 1122 × 1802 scene. The resulting WebP is about 327KB. A gradual mask starts at 79% of the extended image and reaches beige only at the bottom. Headline, explanatory steps, closing statement, and footer remain ordinary document content over that scene.

Repeating floor texture may be recognizable on close inspection. It is the requested copy-and-paste extension. A bespoke floor outpaint could replace the extension later without changing the layout.

## Wind and light

`motion.ts` provides one 24-second wind field. Harmonic frequencies make both position and velocity continuous at the loop boundary. Foliage follows with a 0.65-second lag; leaf tips lag by 1.05 seconds.

`Environment.tsx` draws the supplied transparent assets on a canvas. The curtain is pinned at its top and displacement increases toward its hem. The plant base stays fixed while upper branches and tips move more. A precomputed soft foliage shadow follows the same motion. Broad warm light transmission on the wall and floor shifts with that wind; the photographed silhouette, window frames, and table stay stable. Individual leaves drift occasionally with quiet intervals.

The canvas draws at up to 30fps on desktop and 20fps on smaller screens. It pauses outside the viewport and when the document is hidden. Reduced-motion mode renders a still environment and static neural outline. Mobile reduces environmental displacement and omits drifting leaves.

## Neural tracing

`BrainTrace.tsx` contains 18 connected SVG edges and named junctions. Earliest arrival times are computed from exact SVG path lengths. The same travel distance positions both the highlighted tail and its leading spark, avoiding separate timing that could drift. A traversal lasts 15 seconds, followed by a 3-second rest. Junctions brighten when a signal passes nearby.

## Navigation and loading

`PublicExperience.tsx` persists across landing and login, so navigation crossfades content while the environment and brain keep their timelines. Inactive content is inert and hidden from assistive technology. The heading receives focus after navigation. The wordmark links home. The requested demo note, demo entry button, and Back to home link are removed.

The login form uses the existing backend authentication API, session query, error handling, and safe internal destination. Authenticated routes retain the clinic shell while `RouteSurface.tsx` gives the content a short entrance. `WorkspaceSkeleton.tsx` supplies local loading placeholders for the session and patient record. Current clinic pages and navigation are preserved as they evolve separately.

## Files

- Public content: `web/src/pages/Landing.tsx`, `Login.tsx`, and `landing.css`.
- Scene: `web/src/components/scene/PublicExperience.tsx`, `LayeredScene.tsx`, `Environment.tsx`, `BrainTrace.tsx`, `geometry.ts`, `motion.ts`, `scene.css`, and `motion.test.ts`.
- Prepared assets: `web/public/scene/v6/`; reproducible preparation: `scripts/prepare_living_scene.py`.
- Routing and loading integration: `web/src/App.tsx`, `api/client.ts`, `components/AuthGate.tsx`, `ClinicLayout.tsx`, `RouteSurface.tsx`, `WorkspaceSkeleton.tsx`, and patient loading states.

## Validation

- Production build and TypeScript check passed.
- Frontend suite: 58 tests passed. Backend authentication suite: 8 tests passed.
- Full-page screenshots inspected at 1920 × 1080, 1440 × 900, 1366 × 768, 768 × 1024, and 390 × 844. No horizontal overflow at these sizes.
- An 80-second browser observation reached all 18 neural edges; maximum spark/path discrepancy was under 0.001 SVG units. Landing/login navigation preserved the scene elements.
- A subsequent observation of the stronger environmental motion sampled 34 distinct curtain, plant, and lighting frames across more than two wind periods. Reduced-motion checks confirmed a still canvas and trace.
- The configured local account successfully signed in through the form and opened a patient record. The sidebar and header stayed mounted and the document did not reload between clinical routes.
- Captures and verification helpers are in `output/playwright/`.

## Paper

The page **Landing · OG reference · Final** contains editable desktop full-scroll and clinician login compositions, including the final header, hero, and fitted brain. Existing design pages are retained. Paper is the static composition reference; the running site is the animation reference. No manual Paper work is required for the delivered desktop composition.

Paper page: https://app.paper.design/file/01M5604RD8QBHQK8XPWMG0CWQ5/p-8-3
