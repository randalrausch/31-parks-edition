import { defineConfig, devices } from "@playwright/test";

/**
 * Deployment-smoke config: runs e2e/deployment.spec.ts against a LIVE, already
 * deployed site instead of a local build. No webServer — the target is remote.
 *
 *   E2E_BASE_URL=https://play31.fun npm run test:e2e:deploy
 *
 * Browser: uses branded Chrome by default (CI does `playwright install chrome`).
 * Set PW_EXECUTABLE_PATH to a Chromium binary to run where only Chromium exists
 * (e.g. PW_EXECUTABLE_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome).
 *
 * Note: an agent sandbox whose egress policy blocks the public domain can't reach
 * the live site — run this from CI (azure.yml, post-deploy) or a dev machine.
 */
const executablePath = process.env.PW_EXECUTABLE_PATH;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/deployment.spec.ts",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "line" : "list",
  // The online flow chains many real-network round trips (create → join → start
  // → poll → act), each patient on its own; give the whole test room past the
  // 30s default.
  timeout: 120_000,
  use: {
    baseURL: process.env.E2E_BASE_URL,
    trace: "on-first-retry",
    channel: executablePath ? undefined : "chrome",
  },
  projects: [
    {
      name: "chrome",
      use: {
        ...devices["Desktop Chrome"],
        ...(executablePath ? { channel: undefined } : {}),
        launchOptions: {
          // Quiet Chromium's background phone-home (safebrowsing, component
          // update); under locked-down egress it just spams handshake errors.
          args: ["--disable-background-networking", "--disable-component-update"],
          ...(executablePath ? { executablePath } : {}),
        },
      },
    },
  ],
});
