import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import pkg from "./package.json" with { type: "json" };

// NOTE: public/version.json is written by scripts/write-version-json.mjs
// via the `prebuild` npm lifecycle hook. Keeping the fs write out of
// vite.config.ts means we don't have to pull in @types/node just to
// satisfy tsc's check of this file.

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: "./",
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (
            id.includes("/src/components/MeditateView.tsx")
            || id.includes("/src/components/visualizers.ts")
            || id.includes("/src/meditateState.ts")
          ) {
            return "meditate";
          }
          if (id.includes("/src/engine/presets.ts")) {
            return "presets";
          }
        },
      },
    },
  },
});
