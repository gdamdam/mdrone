import type { PortableScene } from "../session";
import { fnv1a, mulberry32 } from "./rng";
import { buildSigilSvg } from "./styles/sigil";
import { buildTalismanSvg } from "./styles/talisman";
import { buildTarotSvg } from "./styles/tarot";
import { buildTesseraSvg } from "./styles/tessera";

/** Canvas dimensions — 1:1 square, matches og:image width/height meta. */
export const SCENE_CARD_WIDTH = 800;
export const SCENE_CARD_HEIGHT = 800;

/** The four art styles authored as SVG. */
export type SceneCardStyle = "sigil" | "tarot" | "tessera" | "talisman";
export type SceneCardStyleChoice = SceneCardStyle | "auto";

export const SCENE_CARD_STYLE_LABELS: Record<SceneCardStyleChoice, string> = {
  auto: "AUTO",
  sigil: "SIGIL",
  tarot: "TAROT",
  tessera: "TESSERA",
  talisman: "TALISMAN",
};

const STYLE_ORDER: readonly SceneCardStyle[] = ["sigil", "tarot", "tessera", "talisman"];

/** Map legacy style names (from older share URLs / persisted choice) to the
 *  current style they correspond to. Returns null if the value is unknown.
 *  Callers should fall back to "auto" when null. */
export function normaliseLegacyStyleChoice(raw: string | null | undefined): SceneCardStyleChoice | null {
  if (!raw) return null;
  if (raw === "fractal") return "tessera"; // renamed 2026-04
  if (raw === "auto" || raw === "sigil" || raw === "tarot" || raw === "tessera" || raw === "talisman") {
    return raw;
  }
  return null;
}

/**
 * Context handed to every style builder. Contains the RNG (already seeded
 * from the payload), the final canvas dimensions, the display title, and
 * any hashed primitives derived from the scene.
 *
 * Style builders must only draw from this object — no global state, no
 * Math.random — so client preview and worker raster produce identical art.
 */
export interface ShareCardContext {
  width: number;
  height: number;
  title: string;
  /** Deterministic PRNG seeded from the payload hash. */
  rng: () => number;
  /** Hash of the payload — useful for style selection + secondary choices. */
  hash: number;
  /** Raw scene for style-specific projections (root, preset, etc). */
  scene: PortableScene;
}

/** Stable string form of a scene, used as the hash input. Only the fields
 *  that affect rendering should land here — anything that drifts between
 *  renders (timestamps, runtime ids) would break client/worker parity. */
export function scenePayloadKey(scene: PortableScene, title: string): string {
  return JSON.stringify({
    t: title,
    r: scene.drone.root,
    o: scene.drone.octave,
    s: scene.drone.scale,
    p: scene.drone.activePresetId ?? null,
    v: scene.ui.visualizer,
  });
}

/** Hash-auto: deterministic style pick from the payload. */
export function resolveSceneCardStyle(
  choice: SceneCardStyleChoice,
  scene: PortableScene,
  title: string,
): SceneCardStyle {
  if (choice !== "auto") return choice;
  const h = fnv1a(scenePayloadKey(scene, title));
  return STYLE_ORDER[h % STYLE_ORDER.length];
}

/** URL param helper for the optional manual style override. Param name
 *  matches what the worker reads (`cs`), and the origin/path of the input
 *  URL is preserved as-is. */
export function withSceneCardStyleParam(url: string, choice: SceneCardStyleChoice): string {
  if (choice === "auto") return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}cs=${encodeURIComponent(choice)}`;
}

/**
 * Build an 800×800 SVG string for a scene in the requested style.
 * This is the single source of truth — the client rasterises it via
 * data-URL + <img>, and the Cloudflare Worker rasterises it via resvg-wasm.
 */
export function buildShareCardSvg(
  scene: PortableScene,
  title: string,
  choice: SceneCardStyleChoice = "auto",
  width = SCENE_CARD_WIDTH,
  height = SCENE_CARD_HEIGHT,
): { svg: string; style: SceneCardStyle } {
  const style = resolveSceneCardStyle(choice, scene, title);
  const hash = fnv1a(scenePayloadKey(scene, title));
  const rng = mulberry32(hash);
  const ctx: ShareCardContext = { width, height, title, rng, hash, scene };

  let inner: string;
  switch (style) {
    case "sigil":
      inner = buildSigilSvg(ctx);
      break;
    case "tarot":
      inner = buildTarotSvg(ctx);
      break;
    case "tessera":
      inner = buildTesseraSvg(ctx);
      break;
    case "talisman":
      inner = buildTalismanSvg(ctx);
      break;
  }

  // No <?xml?> prolog — we embed as data URL + feed to resvg, both
  // prefer a bare root element.
  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${inner}</svg>`,
    style,
  };
}
