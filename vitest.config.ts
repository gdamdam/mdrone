import { defineConfig } from "vitest/config";
import pkg from "./package.json" with { type: "json" };

// Unit tests for pure logic only (no React, no Web Audio).
// E2E browser coverage lives under e2e/ and runs via Playwright.
//
// `define` mirrors vite.config.ts so src/config.ts (which references
// the vite-injected `__APP_VERSION__` global) can be imported in tests.
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
    setupFiles: ["./tests/unit/setup.ts"],
    reporters: ["default"],
  },
});
