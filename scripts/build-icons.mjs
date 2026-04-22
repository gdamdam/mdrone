#!/usr/bin/env node
/**
 * Rasterise public/favicon.svg into the PNG icons the PWA manifest
 * and iOS home-screen need. Reuses @resvg/resvg-wasm, already a
 * runtime dep for share-card rendering, so no new tooling is added.
 *
 * Outputs (written to public/):
 *   - icon-192.png           — PWA icon, purpose "any"
 *   - icon-512.png           — PWA icon, purpose "any"
 *   - icon-maskable-512.png  — PWA icon, purpose "maskable" (same art
 *                              for now; safe zone handled by the SVG
 *                              composition — favicon already sits on
 *                              a full-bleed radial gradient)
 *   - apple-touch-icon.png   — 180×180 for iOS home-screen
 */

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Resvg, initWasm } from "@resvg/resvg-wasm";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

const WASM_PATH = join(ROOT, "node_modules/@resvg/resvg-wasm/index_bg.wasm");
const SVG_PATH = join(ROOT, "public/favicon.svg");
const PUBLIC = join(ROOT, "public");

async function render(svg, width) {
  const resvg = new Resvg(svg, { fitTo: { mode: "width", value: width } });
  return resvg.render().asPng();
}

async function main() {
  await initWasm(await readFile(WASM_PATH));
  const svg = await readFile(SVG_PATH, "utf8");

  const outputs = [
    { file: "icon-192.png", width: 192 },
    { file: "icon-512.png", width: 512 },
    { file: "icon-maskable-512.png", width: 512 },
    { file: "apple-touch-icon.png", width: 180 },
  ];

  for (const { file, width } of outputs) {
    const png = await render(svg, width);
    await writeFile(join(PUBLIC, file), png);
    console.log(`wrote public/${file} (${width}×${width})`);
  }
}

main().catch((err) => {
  console.error("build-icons failed:", err);
  process.exit(1);
});
