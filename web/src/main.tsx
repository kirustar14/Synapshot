import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ready } from "./api/client";
import { initSentry, Sentry } from "./lib/sentry";
import "./styles.css";

// Before anything else, so errors during boot are caught too. No-op without a DSN.
initSentry();

// Start the health probe before the first render so the mock badge is right on the first paint.
ready();

const root = document.getElementById("root");
if (!root) throw new Error("No #root element in index.html");

createRoot(root, {
  onUncaughtError: Sentry.reactErrorHandler(),
  onCaughtError: Sentry.reactErrorHandler(),
  onRecoverableError: Sentry.reactErrorHandler(),
}).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
