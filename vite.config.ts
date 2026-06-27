/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Vitest: pure game logic runs in Node; UI integration is tested separately.
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
