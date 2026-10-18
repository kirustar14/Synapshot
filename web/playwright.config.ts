import { defineConfig } from "@playwright/test";

/**
 * End to end checks against a running server.
 *
 * Not part of `npm test`: they need a backend on :8111 with seeded data and a built
 * frontend, which is a different thing from the unit suite and should fail loudly for a
 * different reason. `npm run e2e` after `make dev` on that port.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE ?? "http://localhost:8111",
    viewport: { width: 1600, height: 1000 },
    trace: "off",
  },
});
