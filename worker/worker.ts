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
import type { PortableScene } from "../src/session";

const APP_ORIGIN = "https://mdrone.mpump.live";
const VERSION = "0.3.0";

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

function normalizeScene(decoded: unknown): PortableScene {
  const num = (v: unknown, fb: number, lo = -Infinity, hi = Infinity): number => {
    if (typeof v !== "number" || !isFinite(v)) return fb;
    return Math.max(lo, Math.min(hi, v));
  };
  const bool = (v: unknown, fb: boolean): boolean => (typeof v === "boolean" ? v : fb);
  const str = (v: unknown, fb: string): string =>
    typeof v === "string" && v.length > 0 ? v : fb;

  const d = (decoded && typeof decoded === "object" ? decoded : {}) as Record<string, unknown>;
  const droneIn = (d.drone && typeof d.drone === "object" ? d.drone : {}) as Record<string, unknown>;
  const fxIn = (d.fx && typeof d.fx === "object" ? d.fx : {}) as Record<string, unknown>;
  const levelsIn = (fxIn.levels && typeof fxIn.levels === "object" ? fxIn.levels : {}) as Record<
    string,
    unknown
  >;
  const uiIn = (d.ui && typeof d.ui === "object" ? d.ui : {}) as Record<string, unknown>;
  const vLayersIn = (droneIn.voiceLayers && typeof droneIn.voiceLayers === "object"
    ? droneIn.voiceLayers
    : {}) as Record<string, unknown>;
  const vLevelsIn = (droneIn.voiceLevels && typeof droneIn.voiceLevels === "object"
    ? droneIn.voiceLevels
    : {}) as Record<string, unknown>;
  const effectsIn = (droneIn.effects && typeof droneIn.effects === "object"
    ? droneIn.effects
    : {}) as Record<string, unknown>;

  const allowedRoots = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;
  const root = (allowedRoots as readonly string[]).includes(droneIn.root as string)
    ? (droneIn.root as (typeof allowedRoots)[number])
    : "A";
  const allowedScales = ["drone", "major", "minor", "dorian", "phrygian", "just5", "pentatonic", "meantone", "harmonics", "maqam-rast", "slendro"] as const;
  const scale = (allowedScales as readonly string[]).includes(droneIn.scale as string)
    ? (droneIn.scale as (typeof allowedScales)[number])
    : "drone";
  const allowedTunings = ["equal", "just5", "meantone", "harmonics", "maqam-rast", "slendro"] as const;
  const tuningId = (allowedTunings as readonly string[]).includes(droneIn.tuningId as string)
    ? (droneIn.tuningId as (typeof allowedTunings)[number])
    : null;
  const allowedRelations = ["unison", "tonic-fifth", "tonic-fourth", "drone-triad", "harmonic-stack"] as const;
  const relationId = (allowedRelations as readonly string[]).includes(droneIn.relationId as string)
    ? (droneIn.relationId as (typeof allowedRelations)[number])
    : null;
  const fineTuneOffsets = Array.isArray(droneIn.fineTuneOffsets)
    ? droneIn.fineTuneOffsets
      .slice(0, 12)
      .map((value) => num(value, 0, -25, 25))
    : [];
  const allowedPalettes = ["ember", "copper", "dusk"] as const;
  const paletteId = (allowedPalettes as readonly string[]).includes(uiIn.paletteId as string)
    ? (uiIn.paletteId as (typeof allowedPalettes)[number])
    : "ember";
  const allowedVisualizers = [
    "mandala", "haloGlow", "fractal", "rothko", "tapeDecay", "dreamHouse",
    "sigil", "starGate", "cymatics", "inkBloom", "horizon", "aurora", "orb", "dreamMachine",
  ] as const;
  const visualizer = (allowedVisualizers as readonly string[]).includes(uiIn.visualizer as string)
    ? (uiIn.visualizer as (typeof allowedVisualizers)[number])
    : "mandala";
  const allowedLfoShapes = ["sine", "triangle", "square", "sawtooth"] as const;
  const lfoShape = (allowedLfoShapes as readonly string[]).includes(droneIn.lfoShape as string)
    ? (droneIn.lfoShape as (typeof allowedLfoShapes)[number])
    : "sine";

  return {
    version: 1,
    name: str(d.name, "Shared Scene"),
    drone: {
      activePresetId: (typeof droneIn.activePresetId === "string" ? droneIn.activePresetId : null),
      playing: bool(droneIn.playing, false),
      root,
      octave: num(droneIn.octave, 2, 0, 7),
      scale,
      tuningId,
      relationId,
      fineTuneOffsets,
      voiceLayers: {
        tanpura: bool(vLayersIn.tanpura, true),
        reed: bool(vLayersIn.reed, false),
        metal: bool(vLayersIn.metal, false),
        air: bool(vLayersIn.air, false),
        piano: bool(vLayersIn.piano, false),
        fm: bool(vLayersIn.fm, false),
        amp: bool(vLayersIn.amp, false),
      },
      voiceLevels: {
        tanpura: num(vLevelsIn.tanpura, 1, 0, 1),
        reed: num(vLevelsIn.reed, 1, 0, 1),
        metal: num(vLevelsIn.metal, 1, 0, 1),
        air: num(vLevelsIn.air, 1, 0, 1),
        piano: num(vLevelsIn.piano, 1, 0, 1),
        fm: num(vLevelsIn.fm, 1, 0, 1),
        amp: num(vLevelsIn.amp, 1, 0, 1),
      },
      effects: {
        tape: bool(effectsIn.tape, false),
        wow: bool(effectsIn.wow, false),
        sub: bool(effectsIn.sub, false),
        comb: bool(effectsIn.comb, false),
        delay: bool(effectsIn.delay, false),
        plate: bool(effectsIn.plate, false),
        hall: bool(effectsIn.hall, false),
        shimmer: bool(effectsIn.shimmer, false),
        freeze: bool(effectsIn.freeze, false),
        cistern: bool(effectsIn.cistern, false),
        granular: bool(effectsIn.granular, false),
        ringmod: bool(effectsIn.ringmod, false),
        formant: bool(effectsIn.formant, false),
      },
      drift: num(droneIn.drift, 0.3, 0, 1),
      air: num(droneIn.air, 0.4, 0, 1),
      time: num(droneIn.time, 0.5, 0, 1),
      sub: num(droneIn.sub, 0, 0, 1),
      bloom: num(droneIn.bloom, 0.15, 0, 1),
      glide: num(droneIn.glide, 0.15, 0, 1),
      climateX: num(droneIn.climateX, 0.5, 0, 1),
      climateY: num(droneIn.climateY, 0.5, 0, 1),
      lfoShape,
      lfoRate: num(droneIn.lfoRate, 0.4, 0, 10),
      lfoAmount: num(droneIn.lfoAmount, 0, 0, 1),
      presetMorph: num(droneIn.presetMorph, 0.25, 0, 1),
      evolve: num(droneIn.evolve, 0, 0, 1),
      pluckRate: num(droneIn.pluckRate, 1, 0, 4),
      presetTrim: num(droneIn.presetTrim, 1, 0, 1),
    },
    mixer: {
      hpfHz: 20,
      low: 0,
      mid: 0,
      high: 0,
      glue: 0,
      drive: 0,
      limiterOn: false,
      ceiling: -1,
      volume: 0.8,
    },
    fx: {
      levels: {
        tape: num(levelsIn.tape, 1, 0, 1),
        wow: num(levelsIn.wow, 1, 0, 1),
        sub: num(levelsIn.sub, 0.9, 0, 1),
        comb: num(levelsIn.comb, 0.85, 0, 1),
        delay: num(levelsIn.delay, 0.9, 0, 1),
        plate: num(levelsIn.plate, 1, 0, 1),
        hall: num(levelsIn.hall, 1, 0, 1),
        shimmer: num(levelsIn.shimmer, 0.95, 0, 1),
        freeze: num(levelsIn.freeze, 1, 0, 1),
        cistern: num(levelsIn.cistern, 1, 0, 1),
        granular: num(levelsIn.granular, 0.9, 0, 1),
        ringmod: num(levelsIn.ringmod, 0.7, 0, 1),
        formant: num(levelsIn.formant, 0.85, 0, 1),
      },
      delayTime: num(fxIn.delayTime, 0.55, 0, 1),
      delayFeedback: num(fxIn.delayFeedback, 0.58, 0, 1),
      combFeedback: num(fxIn.combFeedback, 0.85, 0, 1),
      subCenter: num(fxIn.subCenter, 110, 20, 400),
      freezeMix: num(fxIn.freezeMix, 1, 0, 1),
    },
    ui: { paletteId, visualizer },
  };
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
