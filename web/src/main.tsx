import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ready } from "./api/client";
import "./styles.css";

// Start the health probe before the first render so the mock badge is right on the first paint.
ready();

const root = document.getElementById("root");
if (!root) throw new Error("No #root element in index.html");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
