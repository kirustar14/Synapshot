<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Architecture
- All data goes through `src/api/client.ts`; it falls back to `src/mock/db.ts` when `VITE_API_URL` is empty or health fails. Why: one env var switches mock to live.
- Clinician pages live under the pathless `_clinic` layout with `ssr: false`. Why: the mock store and 3D canvas are browser-only.
- Shared visual roles are defined in `src/styles.css` and reused through the common components and UI variants. Why: the workspace, patient pages, and dark mode must stay visually consistent.
