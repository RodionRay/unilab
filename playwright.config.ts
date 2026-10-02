import { defineConfig, devices } from "@playwright/test";

/**
 * E2E against an already running production server (no webServer here: the app needs wrangler + .dev.vars).
 * Base URL: E2E_BASE_URL (default http://127.0.0.1:5481). Seed: docs/project/specs/tg-chat-ui.md §E2E.
 */
export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  outputDir: "test-results/e2e",
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://127.0.0.1:5481",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
