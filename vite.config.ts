/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
);
let gitSha = "dev";
try {
  // execFileSync (no shell) with a fixed arg list — no injection surface.
  gitSha = execFileSync("git", ["rev-parse", "--short", "HEAD"])
    .toString()
    .trim();
} catch {
  gitSha = (process.env.GITHUB_SHA || "").slice(0, 7) || "dev";
}

// An auto-incrementing build number so each pushed build shows a NEW version
// (package.json's version is a hand-managed release marker that rarely changes).
// Commit count is stable across machines — same history → same number — but
// needs full git history in CI (checkout with fetch-depth: 0). Fall back to the
// CI run number, then to nothing for one-off local builds without git.
let build = "";
try {
  build = execFileSync("git", ["rev-list", "--count", "HEAD"]).toString().trim();
} catch {
  build = process.env.GITHUB_RUN_NUMBER || "";
}
const appVersion = build ? `${pkg.version}+${build}` : pkg.version;

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Build-time constants surfaced in the About dialog.
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __GIT_SHA__: JSON.stringify(gitSha),
  },
  // Vitest: pure game logic runs in Node; UI integration is tested separately.
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
