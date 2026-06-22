import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for the Phase 3 smoke-test spike.
 *
 * Boots the real Vite dev server (which sets the COOP/COEP headers from
 * vite.config.ts, so the app is cross-origin isolated). The app's `base` is
 * `/pdf-editor/`, so baseURL points there and tests can `goto('/')`.
 *
 * Run with: pnpm test:e2e   (see package.json). Chromium only for the spike;
 * widen `projects` once the harness is proven.
 */
const PORT = 5173;
const BASE = "/pdf-editor/";

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${PORT}${BASE}`,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm dev",
    url: `http://localhost:${PORT}${BASE}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
