import { defineConfig, devices } from "@playwright/test";

/**
 * e2e runs against the PRODUCTION build served by wrangler (`npm run build` first).
 * Port: TMA_E2E_PORT (default 5191). Playwright starts `npm start` itself; TMA_E2E_REUSE=1 reuses a running one.
 * The backend is mocked per test with page.route,
 * so the server only has to render /tma/<wsKey>.
 */
const PORT = Number(process.env.TMA_E2E_PORT ?? 5191);
const BASE = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "e2e",
  testMatch: /tma.*\.spec\.ts$/,
  outputDir: ".sites-runtime/playwright/results",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: process.env.CI ? 2 : 4,
  reporter: [["list"]],
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: BASE,
    locale: "ru-RU",
    timezoneId: "Europe/Moscow",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
    },
  ],
  webServer: {
    command: `npm start -- --port ${PORT}`,
    url: `${BASE}/`,
    // Opt-in reuse (TMA_E2E_REUSE=1): a stray server of another worktree on the same port must fail loudly.
    reuseExistingServer: process.env.TMA_E2E_REUSE === "1",
    timeout: 120_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
