import { defineConfig, devices } from "@playwright/test";

/**
 * Real-browser E2E. Tests the production build served by `vite preview`, driving
 * the system Chrome (channel "chrome") so there's no large browser download —
 * locally it uses installed Google Chrome; in CI, `playwright install chrome`
 * provides it. Specs live in e2e/ (kept out of src/ so vitest/tsc ignore them).
 *
 * Build before running: `vite build` (the `test:e2e` script does this); the
 * webServer below only serves the existing dist/.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "line" : "list",
  use: {
    baseURL: "http://localhost:4321",
    trace: "on-first-retry",
    channel: "chrome",
  },
  projects: [{ name: "chrome", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run preview -- --port 4321 --strictPort",
    url: "http://localhost:4321",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
