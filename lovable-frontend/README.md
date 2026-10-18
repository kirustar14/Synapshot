# Welcome to your Lovable project

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Open your project in the [Lovable editor](https://lovable.dev) and keep building.

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: connect the project to GitHub and every change made in Lovable is committed straight to your repository.
- **Full ownership**: this code is yours. Push to your repository and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## Built with

- TanStack Start
- TypeScript
- React
- Tailwind CSS

## UNNAMED configuration

- `VITE_API_URL`: backend base URL, for example `http://localhost:8000`. All calls go to `${VITE_API_URL}/api/...` and the rig stream to `${VITE_API_URL}/ws/rig`. If empty, or if `/api/health` fails, the app uses the built-in seeded mock data and shows a "Mock data" pill.
- `VITE_AUTH0_DOMAIN` and `VITE_AUTH0_CLIENT_ID`: optional. When both are set, clinician pages require Auth0 sign in.
- Demo console lives at `/demo`. It appears in the sidebar after being visited once.
- Patient pages: `/consent/:token`, `/phone/:id`, `/stretch/:token`.
