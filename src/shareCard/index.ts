/**
 * Public API for scene share cards.
 *
 * The SVG is built via `svgBuilder.ts` (shared with the Cloudflare Worker
 * at render time). Here we wrap it with browser-only rasterisation —
 * SVG → data URL → <img> → <canvas>. A `renderSceneCardPng` helper goes
 * one step further, returning raw PNG bytes for download.
 *
 * The worker does not go through this file; it imports buildShareCardSvg
 * directly and rasterises via @resvg/resvg-wasm.
 */
import type { PortableScene } from "../session";
import {
  buildShareCardSvg,
  resolveSceneCardStyle as resolveStyle,
  SCENE_CARD_HEIGHT,
  SCENE_CARD_WIDTH,
  SCENE_CARD_STYLE_LABELS,
  type SceneCardStyle,
  type SceneCardStyleChoice,
  withSceneCardStyleParam,
} from "./svgBuilder";

export {
  SCENE_CARD_HEIGHT,
  SCENE_CARD_WIDTH,
  SCENE_CARD_STYLE_LABELS,
  withSceneCardStyleParam,
};
export type { SceneCardStyle, SceneCardStyleChoice };

/** Legacy-compatible wrapper — derives title from scene.name. */
export function resolveSceneCardStyle(
  choice: SceneCardStyleChoice,
  scene: PortableScene,
): SceneCardStyle {
  return resolveStyle(choice, scene, scene.name ?? "");
}

/** Rasterise the SVG into a canvas. Asynchronous because <img> loads
 *  a data URL off the main thread. */
export async function renderSceneCardToCanvas(
  canvas: HTMLCanvasElement,
  scene: PortableScene,
  choice: SceneCardStyleChoice = "auto",
  width = SCENE_CARD_WIDTH,
  height = SCENE_CARD_HEIGHT,
): Promise<void> {
  const { svg } = buildShareCardSvg(scene, scene.name ?? "", choice, width, height);
  const blob = new Blob([svg], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  try {
    await new Promise<void>((resolve, reject) => {
      const img = new Image();
      img.decoding = "async";
      img.onload = () => {
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Canvas 2D context unavailable"));
          return;
        }
        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        resolve();
      };
      img.onerror = () => reject(new Error("SVG image decode failed"));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Rasterise to a canvas and export as PNG bytes. Used for the "download"
 *  button in ShareModal. */
export async function renderSceneCardPng(
  scene: PortableScene,
  choice: SceneCardStyleChoice = "auto",
  width = SCENE_CARD_WIDTH,
  height = SCENE_CARD_HEIGHT,
): Promise<Uint8Array> {
  const canvas = document.createElement("canvas");
  await renderSceneCardToCanvas(canvas, scene, choice, width, height);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png"),
  );
  if (!blob) throw new Error("Failed to encode canvas to PNG blob");
  return new Uint8Array(await blob.arrayBuffer());
}
