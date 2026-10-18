# web/

The UNNAMED frontend. Vite, React 19, TypeScript, Tailwind v4, React Router v7, TanStack Query,
Zustand, Recharts, three with react-three-fiber.

This directory currently holds the foundation: the theme, the app shell and routing, the full API
client, the frozen contract types, and a seeded mock layer that answers every contract route.
Every route renders a placeholder page that names what goes there. The screens are built on top
of this.

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
`index.html`, otherwise a reload on `/patients/p1/twin` returns 404.

## Environment variables

Copy `.env.example` to `.env` and fill in what you need. All of them are build time values, read
through `import.meta.env`.

| Variable | Meaning |
| --- | --- |
| `VITE_API_URL` | Base URL for the API. Empty means same origin, which is the normal case. Setting it also disables the mock fallback, so backend errors surface instead of being hidden. |
| `VITE_AUTH0_DOMAIN` | Auth0 tenant domain. Optional. |
| `VITE_AUTH0_CLIENT_ID` | Auth0 single page application client id. Optional. Login is only wired up when both Auth0 values are set. |

Never commit a real `.env`.

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
      ws.ts             /ws/rig, with a seeded 30 fps generator in mock mode
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
| `/` | C1 patient workspace |
| `/patients/:id` | C2 overview |
| `/patients/:id/upload` | C0 model inputs and twin build |
| `/patients/:id/twin` | C3 brain twin viewer |
| `/patients/:id/compare` | C4 scenario compare |
| `/patients/:id/calls` | C5 check-in log |
| `/alerts` | C6 alerts |
| `/cohort` | cohort insights |
| `/rig` | R1 live call console |
| `/rig/preflight` | R2 preflight |
| `/demo` | D1 demo console, hidden in the sidebar until visited once |
| `/consent/:token` | P1 consent, patient facing |
| `/phone/:id` | P2 phone mock, patient facing |
| `/stretch/:token` | P4 gait and hearing, patient facing |
| `/call/:token` | the patient call page, patient facing |

The five patient routes share a nested layout that loads the patient once. The four patient facing
routes sit outside the clinic shell: mobile first, single column, no sidebar, readable at 360px.

## Rules that apply to every screen built here

- No em dashes in any code, comment or user-facing copy.
- Never show a diagnosis, a clearance, or advice about any medicine.
- Amber synthetic badge on every synthetic patient, file and chart.
- Every number that comes out of the model carries a "Model output, not a scan" label.
- Colour is never the only signal. Every chip pairs its colour with an icon or a word.
- Keyboard reachable, real aria labels, empty, loading and error states on every screen.
