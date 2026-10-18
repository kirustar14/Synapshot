# web/

The Synapshot frontend. Vite, React 19, TypeScript, Tailwind v4, React Router v7, TanStack Query,
Zustand, Recharts, three with react-three-fiber.

The Paper landing page and account-backed clinician dashboard share the API client with the
document intake flow and consolidated patient workspace. Both workflows use the same patient
records, check-ins, brain viewer and Sentry instrumentation.

## Run it

```sh
cd web
npm install
npm run dev        # http://localhost:5173
```

`npm run dev` proxies `/api`, `/voice` and `/ws` to `http://localhost:8000`, so start the backend
first if you want real data. With no backend running, the boot health probe fails and the app
switches to the seeded mock layer. You then get six synthetic patients, forecasts, a brain twin, a
procedural mesh, a cohort and a full call script with no server at all, and a "Mock data" badge in
the top bar so nobody mistakes it for real output.

```sh
npm run build      # writes web/dist
npm run preview    # serves web/dist
npm run typecheck  # tsc --noEmit
npm test           # vitest run
```

## How it is served in production

`npm run build` writes `web/dist`. The backend serves that directory at `/` and its own API at
`/api` on the same origin, so `VITE_API_URL` stays empty for the deployed build. Set it only when
the frontend is hosted somewhere other than the backend.

Because the router uses real paths, any host serving `dist` must rewrite unknown paths to
`index.html`, otherwise a reload on `/patients/p1` or `/app/patients/p1` returns 404.

## Environment variables

Copy `.env.example` to `.env` and fill in what you need. All of them are build time values, read
through `import.meta.env`.

| Variable | Meaning |
| --- | --- |
| `VITE_API_URL` | Base URL for the API. Empty means same origin, which is the normal case. Setting it also disables the mock fallback, so backend errors surface instead of being hidden. |
| `VITE_SENTRY_DSN` | Optional browser error tracking, tracing and masked session replay. |
| `VITE_SENTRY_ORG` | Sentry organization for links from the Settings demo. |

Clinician login uses the backend's HttpOnly session cookie. Set `AUTH_ENABLED=1` in the
backend environment to require sign-in at `/login`; without a backend, mock mode opens
the synthetic workspace directly. Never commit a real `.env`.

## Files the backend or a script provides

None of these are committed, and none of them are faked here.

- `public/mesh.json` is the real fsaverage5 cortical surface. The backend writes it. When it is
  absent and `GET /api/mesh` is unavailable, the viewer falls back to the procedural placeholder in
  `src/mock/mesh.ts` and must show a visible placeholder badge.
- `public/models/face_landmarker.task` is the MediaPipe model the call page needs. A `make models`
  script downloads it.
- `public/voice/*.mp3` are the generated voice lines. The call page falls back to
  `speechSynthesis` for any line with no file.

## Layout

```
web/
  index.html            fonts, viewport, the root div
  THEME.md              every theme token, copied from the Lovable reference
  DECISIONS.md          the calls made while building this, and why
  src/
    main.tsx            entry, starts the health probe, mounts App
    App.tsx             query client, theme sync, createBrowserRouter, toaster
    styles.css          Tailwind v4 CSS first config and the whole design system
    api/
      types.ts          the frozen contract, copied verbatim
      client.ts         one function per route, query and mutation hooks, mock fallback
      stream.ts         the per patient event stream, with a generator in mock mode
    mock/
      rng.ts            mulberry32, FNV-1a, rounding helpers
      atlas.ts          100 regions with networks, area tags and centroids
      mesh.ts           procedural cortical surface, about 20k vertices
      call.ts           the call script and the voice inventory
      db.ts             the seeded store and every route handler
    store/app.ts        Zustand: selected patient, dark mode, demo unlock, viewer settings
    components/
      ClinicLayout.tsx  sidebar shell, top bar, mock and synthetic badges
      PatientShell.tsx  mobile first shell for the patient facing routes
      PatientHeader.tsx patient facts, badges and the tab strip
      common.tsx        badges, chips, Panel, Loading, ErrorState, Empty, PageHeader
      ComingNext.tsx    the scaffold marker every placeholder page renders
      ui/               shadcn components, carried over from the Lovable export
    pages/              one file per route
    test/               vitest setup, routing smoke test, mock layer contract test
```

## Routes

| Path | Screen |
| --- | --- |
| `/` | Paper landing page |
| `/login` | Clinician sign-in |
| `/app` | Overview |
| `/app/patients` | Dashboard patient worklist |
| `/app/assessments` | Assessments |
| `/app/research` | Cohort research |
| `/app/reports` | Reports |
| `/app/settings` | Profile, tools and the Sentry demo |
| `/app/patients/:id` | Patient record with assessment, note and report tabs |
| `/clinic` | Patient list for the consolidated workspaces |
| `/patients/new` | Document intake with a streamed build log |
| `/patients/:id` | Brain workspace with Data, Analysis, Treatment and Timeline tabs |
| `/call/:token` | Public patient check-in page |

Both clinician route groups use the same session gate. Existing record links to recovery,
upload and comparison open the consolidated workspace. Retired rig and demo bookmarks
redirect to `/clinic`. The patient call page stays outside both clinician shells.

## Rules that apply to every screen built here

- No em dashes in any code, comment or user-facing copy.
- Never show a diagnosis, a clearance, or advice about any medicine.
- Keep provenance and model limits visible in the workspace evidence drawer and reports.
- Colour is never the only signal. Every chip pairs its colour with an icon or a word.
- Keyboard reachable, real aria labels, empty, loading and error states on every screen.
