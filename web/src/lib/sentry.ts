// Sentry for the clinician app and the patient call page: errors, tracing, session
// replay and logs. Off unless VITE_SENTRY_DSN is set in web/.env.local.
//
// Two rules, both about patients:
// - A call token is a patient's only credential and it lives in the URL (/call/<token>,
//   /consent/<token>, /stretch/<token>). Every URL that leaves the browser is masked to
//   its last six characters, the same as backend/logs.py does on the server.
// - Replays mask all text and block all media. The call page shows the camera; that
//   never goes into a recording.

import * as Sentry from "@sentry/react";
import { useEffect } from "react";
import {
  createBrowserRouter,
  createRoutesFromChildren,
  matchRoutes,
  useLocation,
  useNavigationType,
} from "react-router-dom";

const DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined;
export const sentryOn = Boolean(DSN);

const TOKEN_PATH = /(\/(?:api\/)?(?:call|consent|stretch)\/)([A-Za-z0-9_-]{16,})/g;
export const maskTokens = (s: string) =>
  s.replace(TOKEN_PATH, (_m, pre: string, tok: string) => `${pre}token-${tok.slice(-6)}`);

function scrub<T>(obj: T): T {
  if (typeof obj === "string") return maskTokens(obj) as T;
  if (Array.isArray(obj)) return obj.map(scrub) as T;
  if (obj && typeof obj === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) out[k] = scrub(v);
    return out as T;
  }
  return obj;
}

export function initSentry() {
  if (!DSN) return;
  Sentry.init({
    dsn: DSN,
    environment: (import.meta.env.VITE_SENTRY_ENV as string | undefined) ?? import.meta.env.MODE,
    integrations: [
      // Route templates (/call/:token) as transaction names, never the real token.
      Sentry.reactRouterV7BrowserTracingIntegration({
        useEffect,
        useLocation,
        useNavigationType,
        createRoutesFromChildren,
        matchRoutes,
      }),
      // console.warn / console.error from the call page become searchable Sentry logs.
      Sentry.consoleLoggingIntegration({ levels: ["warn", "error"] }),
      Sentry.replayIntegration({ maskAllText: true, blockAllMedia: true, maskAllInputs: true }),
      // "Report a problem" lives in Settings, not as a floating button over the workspace.
      Sentry.feedbackIntegration({ autoInject: false, colorScheme: "light", showBranding: false }),
    ],
    // Hackathon volume: keep everything.
    tracesSampleRate: 1.0,
    // Connects a page load on the phone to the FastAPI trace that served it.
    tracePropagationTargets: [/^\/api\//, /^\/voice\//, /^https?:\/\/localhost/],
    replaysSessionSampleRate: 1.0,
    replaysOnErrorSampleRate: 1.0,
    beforeSend: (e) => scrub(e),
    beforeSendTransaction: (e) => scrub(e),
    beforeBreadcrumb: (b) => scrub(b),
    beforeSendLog: (l) => scrub(l),
  });
}

/** createBrowserRouter, instrumented when Sentry is on. */
export const createRouter: typeof createBrowserRouter = (routes, opts) =>
  sentryOn
    ? Sentry.wrapCreateBrowserRouterV7(createBrowserRouter)(routes, opts)
    : createBrowserRouter(routes, opts);

/** The Sentry org the demo links open in. */
export const SENTRY_ORG = (import.meta.env.VITE_SENTRY_ORG as string | undefined) ?? "ucsd-6y";
const base = `https://${SENTRY_ORG}.sentry.io`;

export const sentryLinks = {
  event: (id: string) => `${base}/issues/?query=${encodeURIComponent(id)}`,
  trace: (id: string) => `${base}/performance/trace/${id}/`,
  replay: (id: string) => `${base}/replays/${id}/`,
  logs: () => `${base}/explore/logs/`,
  issues: () => `${base}/issues/`,
};

/** The id of the replay recording this tab, if replay is on. */
export const currentReplayId = () => Sentry.getReplay()?.getReplayId() ?? null;

/** Open Sentry's feedback form. Resolves false when Sentry is off. */
export async function openFeedback(): Promise<boolean> {
  const feedback = Sentry.getFeedback();
  if (!feedback) return false;
  const form = await feedback.createForm({ formTitle: "Report a problem" });
  form.appendToDom();
  form.open();
  return true;
}

export { Sentry };
