import { defineConfig, devices } from "@playwright/test";

/**
 * Real-browser E2E. Tests the production build served by `vite preview`, driving
 * the system Chrome (channel "chrome") so there's no large browser download —
 * locally it uses installed Google Chrome; in CI, the prebuilt CI image provides
 * it. Specs live in e2e/ (kept out of src/ so vitest/tsc ignore them).
 *
 * Set PW_EXECUTABLE_PATH to a Chromium binary to run where branded Chrome isn't
 * installed (e.g. an agent sandbox or devcontainer that ships only Chromium) —
 * same escape hatch as playwright.deploy.config.ts.
 *
 * Build before running: `vite build --mode e2e` (the `test:e2e` script does
 * this — the e2e mode bakes in the local online backend, see .env.e2e); the
 * webServers below only serve the existing dist/ and start the in-memory game
 * server (e2e/localServer.ts) the online spec plays against.
 */
const executablePath = process.env.PW_EXECUTABLE_PATH;

export default defineConfig({
  testDir: "./e2e",
  // deployment.spec.ts targets a live URL (see playwright.deploy.config.ts); keep
  // it out of the default local-preview run.
  testIgnore: "**/deployment.spec.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "line" : "list",
  use: {
    baseURL: "http://localhost:4321",
    trace: "on-first-retry",
    channel: executablePath ? undefined : "chrome",
  },
  projects: [
    {
      name: "chrome",
      use: {
        ...devices["Desktop Chrome"],
        ...(executablePath ? { channel: undefined, launchOptions: { executablePath } } : {}),
      },
    },
  ],
  webServer: [
    {
      command: "npm run preview -- --port 4321 --strictPort",
      url: "http://localhost:4321",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      // The in-memory game backend the online spec (and the e2e build's baked
      // VITE_API_BASE) points at. GET / answers 200 as the readiness probe.
      command: "npm run e2e:server",
      url: "http://127.0.0.1:8787/",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
