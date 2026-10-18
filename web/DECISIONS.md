# web/ decisions

Every call made while scaffolding `web/`, and why. The spec left some of these open, so they are
recorded here rather than argued about later.

## Router

**React Router v7, `createBrowserRouter`, declarative route objects.** The spec names React
Router, not TanStack Router, so the Lovable export's file based TanStack routes were ported by
hand rather than copied. Consequences:

- The route tree lives in `src/App.tsx` as an exported `routes` array. Exporting it means a test
  can mount the same tree through `createMemoryRouter` with no duplication.
- Active nav styling uses `NavLink`'s `isActive` render prop instead of TanStack's
  `data-[status=active]` attribute. The resulting classes are identical to the reference.
- The patient tab layout passes the loaded patient down through `Outlet context`, read by
  `usePatientContext()`. One fetch, five tabs, no prop drilling and no second request.
- No loaders. Data fetching is TanStack Query inside components, so polling, invalidation and the
  mock fallback all work the same way on every screen.
- Browser history, not hashes, so the backend must rewrite unknown paths to `index.html`. Noted in
  the README.

## How the mock fallback decides

`src/api/client.ts` runs one health probe at boot, memoised in a module level promise.

- `VITE_API_URL` empty, probe succeeds: live mode, same origin `/api`.
- `VITE_API_URL` empty, probe fails or times out after 2.5 s: mock mode. Every route runs its mock
  handler and the top bar shows an amber "Mock data" badge.
- `VITE_API_URL` set: live mode, always. A set API URL is an explicit statement that a backend
  exists, so a failure must surface as an error rather than be papered over with fixture data.
  Silently serving fake numbers to someone who asked for a specific backend would be worse than an
  error state.

`health.mode` is a separate idea and comes from the backend: it reports whether the backend's own
data is synthetic. That drives the teal "Synthetic data" pill. Both can be on at once, and in mock
mode both are.

Mock calls get a 110 ms artificial delay so loading states are actually visible and testable.

## The contract is copied, not re-derived

`src/api/types.ts` is `prompts/contract.ts` verbatim, minus the "copy this into" line, including
the route list comment block at the end. The Lovable export had an older, compressed copy of the
same types that predates mesh, shape, receptors, intervention, loadings and the whole web call, so
it was discarded.

Three response shapes the contract describes inline in its route list rather than as named
interfaces (`Health`, `TwinInputs`, `ConsentDoc`) are declared in `client.ts`, not in `types.ts`,
so `types.ts` stays a byte for byte copy of the contract.

## The procedural mesh

`GET /api/mesh` returns the real fsaverage5 surface, and the backend writes `public/mesh.json`.
Neither is faked here. When both are missing, `src/mock/mesh.ts` builds a placeholder:

- Two closed, folded ellipsoids, one per hemisphere, at `x = ±30` with half axes 28, 72, 46 mm.
  Two separate closed surfaces rather than one mirrored half sphere, because mirroring produces
  coincident faces along the midline and the z-fighting looks broken.
- A 70 by 140 UV grid per hemisphere, so 10,011 vertices each and 20,022 in total, with 39,200
  triangles. That lands in the 20k range the spec asked for and still renders at 60 fps.
- Folding is a sum of four sines over the spherical coordinates displaced along the radial
  direction, plus 0.18 mm of seeded jitter. Pure per vertex noise looks spiky, sines look gyral.
- `inflated` is the same vertex order on a rounder ellipsoid with no folds, so a shader can
  interpolate between the two arrays directly.
- Labels: each vertex takes the nearest of the 50 atlas centroids in its own hemisphere, measured
  as an angular dot product on the unit sphere. The centroids come from a Fibonacci spiral, so
  nearest centroid gives contiguous angular sectors, which is what the spec asked for and also
  produces patches that look like a parcellation rather than latitude bands.
- `labels` is `-1` on the medial wall, defined as the inward facing third of each ellipsoid. The
  atlas centroids are filtered to stay clear of it, so no region ends up owning zero vertices.
- `border` is computed from face adjacency: any triangle whose three vertices do not share a label
  marks all three as border.
- `source` is `"procedural"`. Any screen built on it must show a visible placeholder badge.

The atlas lives in `src/mock/atlas.ts` and is shared: twin region centroids, mesh labels, mesh
`region_names`, `networks` and `lobes` all read the same 100 entries, so a region id means the
same thing in the sphere view, the surface view and the attribution list.

## Twin coordinates are millimetres

The contract does not state units for `Region.x/y/z`. They are millimetres in the same space as
`Mesh.pial`, taken straight from the atlas centroids. That way the sphere view and the surface
view can be overlaid with no rescaling, and a click in one maps to the other.

## `Region.recovery` is read as a weekly retained damage factor

The contract says `recovery` is a per region scalar and the brief says it sits near 1. It is used
here as the weekly factor by which damage is retained, so
`damage[w] = damage0 * (p + (1 - p) * recovery ** w)`, with `recovery` between 0.82 and 0.985 and
derived from the patient's own `params.k` as `exp(-k)`. Values near 1 therefore mean slow recovery,
which is the only reading that makes "near 1" and "decaying by recovery" consistent.

`damage_lo` and `damage_hi` are a symmetric band around `damage`, widened with the damage level and
by 50% again for template only patients. The invariant `damage_lo <= damage <= damage_hi` holds at
every week and is asserted in the tests.

## Six observables, three for the low quality profile

The forecast carries six signals: pursuit gain and saccade latency for eyes, speech rate and pause
ratio for speech, delayed word recall for memory, symptom total for symptoms. That matches the
"3 observables not 6" description of the low quality profile, which keeps pursuit gain, word recall
and symptom total and loses the tier B saccade latency to `flash_ok: false` plus both speech
measures to unusable audio.

The 80% band is `mean ± 1.28 sd`, and `sd` shrinks linearly from 1.6 to 0.7 of the base across the
13 weeks, so the band narrows as the twin sees more data. Observations are drawn at 0.6 sd, so most
land inside the band. The drifting patient gets an extra 2.6 sd push on the current and previous
week, which puts it clearly outside.

## Seeded randomness only

`src/mock/rng.ts` is a hand written mulberry32 plus an FNV-1a string hash. `Math.random` appears
nowhere in `src/mock/`. Patient ids seed their own generators, so patient `p3` has the same twin,
the same charts and the same transcript on every reload and in every test run. Alert ids come from
a counter rather than a random suffix for the same reason.

## Mock mutations really mutate

`advanceWeek`, `injectDrift`, `buildTwin`, `ack`, `callAlert`, `upload`, `unusable`, `rescore`,
`intervention`, `createCall` and `reset` all write to the in memory store, then the twin and shape
caches are cleared and the alert list is resynced. Every mutation hook invalidates the read caches
except `health`, `preflight` and `mesh`, so pressing a demo button visibly moves the patient list,
the alert count, the charts and the message thread at once. The store is module level, so it
resets on a page reload, which is the right behaviour for a demo.

## Call tokens

Any token resolves in mock mode. A pasted or stale `/call/:token` link opens rather than 404s,
because on stage the link is read off a QR code and it has to work. The call record is created on
first touch with the first seeded patient attached. Real tokens from `POST /api/calls` are ten
characters from an alphabet with no look alike glyphs.

`callStatus` moves `processing` to `done` four seconds after `finish`, so the wrap screen's polling
loop has something to wait for and then a plain language summary to show.

## Tailwind and the theme

Tailwind v4 CSS first. `src/styles.css` is the Lovable `styles.css` unchanged: the same
`@import "tailwindcss" source(none)` plus `@source "../src"`, the same `@theme inline` block, the
same `:root` and `.dark` oklch values, the same `panel`, `science-grid`, `patient-table`,
`ring-pulse`, `ring-wave` and print rules. `tw-animate-css` is installed, so that import stays.
There is no `tailwind.config.js` and there should not be one: adding a config file palette would
create a second source of truth for colour. Every value is also written out in `THEME.md`.

Fonts load from Google Fonts with preconnect plus a stylesheet link in `index.html`, the same way
the reference loaded them. Nothing is self hosted, so there is no font file to keep in sync.

## shadcn components

Copied from `lovable-frontend/src/components/ui/` with no changes except one: `sonner.tsx` now
imports `ComponentProps` from react instead of relying on a global `React` namespace. 26 files
were taken, listed in the README. The ones left behind (sidebar, calendar, carousel, command,
chart, form, menubar, and the rest) pull in extra dependencies that nothing in the spec needs. Any
later agent can copy one more from the reference the same way.

`components.json` is not carried over. There is no shadcn CLI in this project, the components are
plain files, and a config file that nothing reads is just drift waiting to happen. The settings it
held are recorded in `THEME.md` instead.

## Dependency versions

Node 20 is what is installed, so the test tooling is pinned to what runs there: `vitest@4` and
`jsdom@28`, not the latest 5 and 30 which both require Node 22 or newer. Vite 8 and
`@vitejs/plugin-react` 6 are fine on Node 20, and `@vitejs/plugin-react` 6 requires Vite 8, which
is why Vite 7 was not an option. A plain `npm install` resolves the whole tree with no peer
dependency overrides.

`lucide-react` is held at the `^0.575.0` range the reference used, because the copied components
were written against it and v1 is a major bump with nothing to gain here.

`postprocessing` is a direct dependency, not just a transitive one, because
`@react-three/postprocessing` lists it as a peer.

## Vite config

`@` aliases to `src`. `build.outDir` is `dist`. The dev server proxies `/api`, `/voice` and `/ws`
to `http://localhost:8000`, with `ws: true` on the socket path so the live call console works in
dev against the real backend. The build warns that the main chunk is over 500 kB; splitting it is
left to whoever adds the 3D viewer, since three and drei are the bulk of it and they should be
lazily loaded behind the twin route.

## Store scope

Zustand holds only user choices: selected patient, dark mode, demo unlock, comparison scenarios and
the viewer settings (layer, week, inflate, personalization, hologram, reduce motion, tracts). No
server data is ever mirrored into it, because then two things would own the same value. Dark mode
and the demo unlock are read from `localStorage` during store creation and written on every change,
both wrapped in try/catch so private browsing cannot crash the app. `reduceMotion` initialises from
the `prefers-reduced-motion` media query.

Dark mode is applied by one effect in `App.tsx` that toggles `.dark` on `<html>`. Keeping that in
one place means no screen has to think about it.

## Placeholder pages

Every route renders its real `PageHeader` plus a `ComingNext` panel that lists, in plain language,
exactly what belongs on that screen. Where a page can already show something true from the data
layer it does: the patient list shows its count, C0 lists the real input files with status chips,
C5 lists the real check-ins, the alert page lists real open alerts, R2 runs real preflight checks,
and the call page lists the real script steps. That way the shell is provably wired to the data
layer rather than just drawn, and the smoke test has something real to assert on.
