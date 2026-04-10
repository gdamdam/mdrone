import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { writeFileSync } from "node:fs";
import pkg from "./package.json" with { type: "json" };

// Auto-update version.json on build so the running client can detect
// that a new build has been published and prompt the user to reload.
writeFileSync("./public/version.json", JSON.stringify({ v: pkg.version }) + "\n");

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: "./",
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
});
