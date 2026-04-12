/**
 * mdrone share-card Worker — per-scene OG tags + PNG card.
 *
 * Routes (host: sd.mpump.live):
 *   GET /health           → { ok, v }
 *   GET /?z=<payload>     → OG HTML stub, then meta-redirect to the app
 *   GET /?b=<payload>     → same, plain-b64 fallback
 *   GET /img?z=<payload>  → 800×800 PNG scene card
 *   GET /                 → 302 to the app
 *
 * The card itself is now SVG, built once by `src/shareCard/svgBuilder.ts`
 * and rasterised via @resvg/resvg-wasm. This replaces the old hand-rolled
 * pixel port — the client preview and the server card now share a single
 * source of truth for the art.
 */

// @ts-expect-error — wrangler resolves the .wasm import to a CompiledWasm binding
import resvgWasmModule from "@resvg/resvg-wasm/index_bg.wasm";
import { initWasm, Resvg } from "@resvg/resvg-wasm";

import {
  buildShareCardSvg,
  resolveSceneCardStyle,
  SCENE_CARD_HEIGHT,
  SCENE_CARD_WIDTH,
  type SceneCardStyle,
  type SceneCardStyleChoice,
} from "../src/shareCard/svgBuilder";
import { normalizePortableScene, type PortableScene } from "../src/session";

const APP_ORIGIN = "https://mdrone.mpump.live";
const VERSION = "1.7.2";

/* ─── resvg-wasm init ─────────────────────────────────────────────────── */

// Initialise once per isolate — the module keeps the WebAssembly.Instance
// alive across requests. Each fetch just reuses it.
let resvgReady: Promise<void> | null = null;
function ensureResvgReady(): Promise<void> {
  if (!resvgReady) {
    resvgReady = initWasm(resvgWasmModule as WebAssembly.Module);
  }
  return resvgReady;
}

async function svgToPng(svg: string): Promise<Uint8Array> {
  await ensureResvgReady();
  const renderer = new Resvg(svg, {
    background: "rgba(0,0,0,0)",
    fitTo: { mode: "width", value: SCENE_CARD_WIDTH },
    font: {
      // resvg-wasm cannot see host fonts in a Worker; it will fall back to
      // its internal defaults for generic families. Our SVGs reference
      // "Georgia, serif" and "ui-monospace, monospace" which resvg maps to
      // its bundled fallbacks.
      loadSystemFonts: false,
    },
  });
  const pngData = renderer.render();
  const bytes = pngData.asPng();
  pngData.free();
  renderer.free();
  return bytes;
}

/* ─── payload codec (mirrors src/shareCodec.ts) ───────────────────────── */

async function decodePayload(raw: string, compressed: boolean): Promise<unknown> {
  try {
    const b64 = raw
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(raw.length / 4) * 4, "=");
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    let jsonBytes = bytes;
    if (compressed) {
      const ds = new DecompressionStream("deflate");
      const writer = ds.writable.getWriter();
      writer.write(bytes);
      writer.close();
      jsonBytes = new Uint8Array(await new Response(ds.readable).arrayBuffer());
    }
    const json = new TextDecoder().decode(jsonBytes);
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/* ─── scene normalisation ─────────────────────────────────────────────── */

/**
 * Share-link scene normaliser. Delegates to the client's
 * `normalizePortableScene` (src/session.ts) so the OG card, the PNG
 * card, and the app itself all agree on the exact same clamps and
 * defaults. A partial or malformed payload used to render one scene in
 * the worker and load a different one in the app — this keeps them in
 * lockstep.
 *
 * The client normaliser returns `null` when `drone` or `mixer` are
 * missing from the input; we preserve the worker's forgiving behavior
 * (never 500 on a weird payload) by filling in empty records as a
 * baseline before delegating.
 */
function normalizeScene(decoded: unknown): PortableScene {
  const record = (decoded && typeof decoded === "object")
    ? (decoded as Record<string, unknown>)
    : {};
  const droneIn = (record.drone && typeof record.drone === "object")
    ? record.drone
    : {};
  const mixerIn = (record.mixer && typeof record.mixer === "object")
    ? record.mixer
    : {};
  // With drone + mixer guaranteed to be records, normalizePortableScene
  // never returns null — the non-null assertion is load-bearing.
  return normalizePortableScene({
    ...record,
    drone: droneIn,
    mixer: mixerIn,
  })!;
}

/* ─── description helpers for OG text ─────────────────────────────────── */

const SCALE_LABELS: Record<string, string> = {
  drone: "DRONE",
  major: "MAJOR",
  minor: "MINOR",
  dorian: "DORIAN",
  phrygian: "PHRYGIAN",
  just5: "JUST5",
  pentatonic: "PENTA",
  meantone: "MEANTONE",
  harmonics: "HARMONICS",
  "maqam-rast": "RAST",
  slendro: "SLENDRO",
};

const TUNING_LABELS: Record<string, string> = {
  equal: "12-TET",
  just5: "JUST5",
  meantone: "MEANTONE",
  harmonics: "HARMONICS",
  "maqam-rast": "RAST",
  slendro: "SLENDRO",
};

function metaTitle(scene: PortableScene): string {
  const drone = scene.drone;
  // Show tuning label when microtuning is active, else legacy scale label
  const label = (drone.tuningId && TUNING_LABELS[drone.tuningId])
    ? TUNING_LABELS[drone.tuningId]
    : (SCALE_LABELS[drone.scale] ?? "DRONE");
  return `${drone.root}${drone.octave} ${label}`;
}

function activeVoiceSummary(scene: PortableScene): string {
  const layers = scene.drone.voiceLayers;
  const levels = scene.drone.voiceLevels;
  const active = (Object.keys(layers) as Array<keyof typeof layers>)
    .filter((v) => layers[v] && levels[v] > 0.08);
  return active.length > 0 ? active.join("+").toUpperCase() : "TANPURA";
}

/* ─── style choice compat shim ────────────────────────────────────────── */

// Old style names from the legacy card codec. Map them all to "auto" so
// previously shared URLs still render — just using the new art.
function sanitiseStyleChoice(raw: string | null): SceneCardStyleChoice {
  if (!raw) return "auto";
  if (raw === "auto" || raw === "sigil" || raw === "tarot" || raw === "fractal") {
    return raw;
  }
  return "auto";
}

/* ─── HTML builder ────────────────────────────────────────────────────── */

function esc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
function escJs(s: string): string {
  return String(s)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "")
    .replace(/\n/g, "\\n");
}

interface OgParams {
  title: string;
  desc: string;
  shareUrl: string;
  appUrl: string;
  imgUrl: string;
  width: number;
  height: number;
}

function buildOgHtml(p: OgParams): string {
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8">
<title>${esc(p.title)} — mdrone</title>
<meta name="description" content="${esc(p.desc)}">
<meta property="og:title" content="${esc(p.title)}">
<meta property="og:description" content="${esc(p.desc)}">
<meta property="og:url" content="${esc(p.shareUrl)}">
<meta property="og:type" content="music.song">
<meta property="og:site_name" content="mdrone">
<meta property="og:image" content="${esc(p.imgUrl)}">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="${p.width}">
<meta property="og:image:height" content="${p.height}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(p.title)}">
<meta name="twitter:description" content="${esc(p.desc)}">
<meta name="twitter:image" content="${esc(p.imgUrl)}">
</head><body><p>Opening <a href="${esc(p.appUrl)}">mdrone</a>…</p>
<script>window.location.replace("${escJs(p.appUrl)}");</script>
<noscript><meta http-equiv="refresh" content="1;url=${esc(p.appUrl)}"></noscript>
</body></html>`;
}

/* ─── routes ──────────────────────────────────────────────────────────── */

async function handleRequest(url: URL): Promise<Response> {
  if (url.pathname === "/health") {
    return new Response(JSON.stringify({ ok: true, v: VERSION }), {
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }

  if (url.pathname === "/img" || url.pathname === "/img/") {
    const z = url.searchParams.get("z");
    const b = url.searchParams.get("b");
    const raw = z || b;
    if (!raw) return new Response("Missing payload", { status: 400 });
    const decoded = await decodePayload(raw, !!z);
    if (!decoded) return new Response("Bad payload", { status: 400 });
    const scene = normalizeScene(decoded);
    const styleChoice = sanitiseStyleChoice(
      url.searchParams.get("cs") || url.searchParams.get("s"),
    );
    const { svg } = buildShareCardSvg(scene, scene.name, styleChoice);
    const png = await svgToPng(svg);
    return new Response(png, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=604800, immutable",
      },
    });
  }

  if (url.pathname === "/" || url.pathname === "") {
    const z = url.searchParams.get("z");
    const b = url.searchParams.get("b");
    const raw = z || b;
    if (!raw) return Response.redirect(APP_ORIGIN, 302);

    const decoded = await decodePayload(raw, !!z);
    if (!decoded) {
      const paramKey = z ? "z" : "b";
      return Response.redirect(`${APP_ORIGIN}/?${paramKey}=${raw}`, 302);
    }
    const scene = normalizeScene(decoded);
    const styleChoice = sanitiseStyleChoice(url.searchParams.get("cs"));
    const resolvedStyle: SceneCardStyle = resolveSceneCardStyle(styleChoice, scene, scene.name);
    const title = scene.name;
    const desc = `${metaTitle(scene)} · ${activeVoiceSummary(scene)} — a drone landscape from mdrone.`;
    const paramKey = z ? "z" : "b";
    const csParam = styleChoice !== "auto" ? `&cs=${resolvedStyle}` : "";
    const shareUrl = `https://sd.mpump.live/?${paramKey}=${raw}${csParam}`;
    const appUrl = `${APP_ORIGIN}/?${paramKey}=${raw}${csParam}`;
    const imgUrl = `https://sd.mpump.live/img?${paramKey}=${raw}${csParam}`;

    const html = buildOgHtml({
      title,
      desc,
      shareUrl,
      appUrl,
      imgUrl,
      width: SCENE_CARD_WIDTH,
      height: SCENE_CARD_HEIGHT,
    });
    return new Response(html, {
      headers: {
        "Content-Type": "text/html;charset=UTF-8",
        "Cache-Control": "public, max-age=86400",
      },
    });
  }

  return new Response("Not found", { status: 404 });
}

export default {
  async fetch(request: Request): Promise<Response> {
    try {
      return await handleRequest(new URL(request.url));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown";
      return new Response(`Error: ${msg}`, { status: 500 });
    }
  },
};
