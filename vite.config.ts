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

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Build-time constants surfaced in the About dialog.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __GIT_SHA__: JSON.stringify(gitSha),
  },
  // Vitest: pure game logic runs in Node; UI integration is tested separately.
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
