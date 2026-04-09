/**
 * mdrone share-card Worker — per-scene OG tags + PNG card.
 *
 * Routes (host: sd.mpump.live):
 *   GET /health           → { ok: true, v }
 *   GET /?z=<payload>     → OG HTML stub, then meta-redirect to mdrone.mpump.live
 *   GET /?b=<payload>     → same, plain-b64 fallback
 *   GET /img?z=<payload>  → PNG scene card (480×270)
 *   GET /                 → 302 to mdrone.mpump.live
 *
 * The renderer is a VERBATIM PORT of mdrone/src/shareCard.ts so that the
 * client preview and the server unfurl are visually identical. If you change
 * one, change the other. Byte equality of the final PNG is not required, but
 * the raw pixel buffer produced by renderSceneCardPixels() should match the
 * client's output for a given scene.
 *
 * No dependencies. No state. Everything flows from the payload.
 */

const APP_ORIGIN = "https://mdrone.mpump.live";
const VERSION = "0.2.0";

const SCENE_CARD_WIDTH = 480;
const SCENE_CARD_HEIGHT = 270;

// ── payload codec (mirrors src/shareCodec.ts) ──────────────────────────────

async function decodePayload(raw, compressed) {
  try {
    const b64 = raw.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(raw.length / 4) * 4, "=");
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    let jsonBytes = bytes;
    if (compressed) {
      const ds = new DecompressionStream("deflate");
      const w = ds.writable.getWriter();
      w.write(bytes);
      w.close();
      jsonBytes = new Uint8Array(await new Response(ds.readable).arrayBuffer());
    }
    const json = new TextDecoder().decode(jsonBytes);
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/**
 * Normalize a decoded object into a PortableScene-shaped structure that the
 * ported shareCard.ts renderer can consume without additional type guards.
 * Kept deliberately light — only fills in fields actually read by the renderer.
 */
function normalizeScene(decoded) {
  const num = (v, fb, lo = -Infinity, hi = Infinity) => {
    if (typeof v !== "number" || !isFinite(v)) return fb;
    return Math.max(lo, Math.min(hi, v));
  };
  const bool = (v, fb) => (typeof v === "boolean" ? v : fb);
  const str = (v, fb) => (typeof v === "string" && v.length ? v : fb);

  const d = decoded || {};
  const droneIn = (d.drone && typeof d.drone === "object") ? d.drone : {};
  const fxIn = (d.fx && typeof d.fx === "object") ? d.fx : {};
  const levelsIn = (fxIn.levels && typeof fxIn.levels === "object") ? fxIn.levels : {};
  const uiIn = (d.ui && typeof d.ui === "object") ? d.ui : {};
  const vLayersIn = droneIn.voiceLayers || {};
  const vLevelsIn = droneIn.voiceLevels || {};
  const effectsIn = droneIn.effects || {};

  const allowedRoots = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const root = allowedRoots.includes(droneIn.root) ? droneIn.root : "A";
  const allowedScales = ["drone", "major", "minor", "dorian", "phrygian", "just5", "pentatonic"];
  const scale = allowedScales.includes(droneIn.scale) ? droneIn.scale : "drone";
  const allowedPalettes = ["ember", "copper", "dusk"];
  const paletteId = allowedPalettes.includes(uiIn.paletteId) ? uiIn.paletteId : "ember";
  const allowedVisualizers = [
    "mandala", "haloGlow", "fractal", "rothko", "tapeDecay", "dreamHouse",
    "sigil", "starGate", "cymatics", "inkBloom", "horizon", "aurora", "orb", "dreamMachine",
  ];
  const visualizer = allowedVisualizers.includes(uiIn.visualizer) ? uiIn.visualizer : "mandala";
  const allowedLfoShapes = ["sine", "triangle", "square", "sawtooth"];
  const lfoShape = allowedLfoShapes.includes(droneIn.lfoShape) ? droneIn.lfoShape : "sine";

  return {
    version: 1,
    name: str(d.name, "Shared Scene"),
    drone: {
      activePresetId: str(droneIn.activePresetId, null),
      playing: bool(droneIn.playing, false),
      root,
      octave: num(droneIn.octave, 2, 0, 7),
      scale,
      voiceLayers: {
        tanpura: bool(vLayersIn.tanpura, true),
        reed: bool(vLayersIn.reed, false),
        metal: bool(vLayersIn.metal, false),
        air: bool(vLayersIn.air, false),
      },
      voiceLevels: {
        tanpura: num(vLevelsIn.tanpura, 1, 0, 1),
        reed: num(vLevelsIn.reed, 1, 0, 1),
        metal: num(vLevelsIn.metal, 1, 0, 1),
        air: num(vLevelsIn.air, 1, 0, 1),
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

// ─────────────────────────────────────────────────────────────────────────
// RENDERER — verbatim port of src/shareCard.ts. DO NOT drift from the client.
// ─────────────────────────────────────────────────────────────────────────

const SCENE_CARD_STYLE_LABELS = {
  auto: "AUTO", bands: "BANDS", rings: "RINGS", sigil: "SIGIL", spectrum: "SPECTRUM",
};

const PITCH_INDEX = {
  C: 0, "C#": 1, D: 2, "D#": 3, E: 4, F: 5, "F#": 6, G: 7, "G#": 8, A: 9, "A#": 10, B: 11,
};

const SCALE_LABELS = {
  drone: "DRONE", major: "MAJOR", minor: "MINOR", dorian: "DORIAN",
  phrygian: "PHRYGIAN", just5: "JUST5", pentatonic: "PENTA",
};

const VOICE_LABELS = { tanpura: "TANPURA", reed: "REED", metal: "METAL", air: "AIR" };

const VISUALIZER_STYLE_MAP = {
  mandala: "rings", haloGlow: "rings", fractal: "spectrum", rothko: "bands",
  tapeDecay: "bands", dreamHouse: "bands", sigil: "sigil", starGate: "sigil",
  cymatics: "spectrum", inkBloom: "spectrum", horizon: "bands", aurora: "spectrum",
  orb: "rings", dreamMachine: "sigil",
};

const PIXEL_FONT = {
  "0": [0b11111, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b11111],
  "1": [0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  "2": [0b11111, 0b00001, 0b00001, 0b11111, 0b10000, 0b10000, 0b11111],
  "3": [0b11111, 0b00001, 0b00001, 0b01111, 0b00001, 0b00001, 0b11111],
  "4": [0b10001, 0b10001, 0b10001, 0b11111, 0b00001, 0b00001, 0b00001],
  "5": [0b11111, 0b10000, 0b10000, 0b11111, 0b00001, 0b00001, 0b11111],
  "6": [0b11111, 0b10000, 0b10000, 0b11111, 0b10001, 0b10001, 0b11111],
  "7": [0b11111, 0b00001, 0b00001, 0b00011, 0b00010, 0b00010, 0b00010],
  "8": [0b11111, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b11111],
  "9": [0b11111, 0b10001, 0b10001, 0b11111, 0b00001, 0b00001, 0b11111],
  A: [0b01110, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
  B: [0b11110, 0b10001, 0b10001, 0b11110, 0b10001, 0b10001, 0b11110],
  C: [0b01111, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b01111],
  D: [0b11110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b11110],
  E: [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b11111],
  F: [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b10000],
  G: [0b01111, 0b10000, 0b10000, 0b10111, 0b10001, 0b10001, 0b01111],
  H: [0b10001, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
  I: [0b01110, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  J: [0b00111, 0b00010, 0b00010, 0b00010, 0b00010, 0b10010, 0b01100],
  K: [0b10001, 0b10010, 0b10100, 0b11000, 0b10100, 0b10010, 0b10001],
  L: [0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b11111],
  M: [0b10001, 0b11011, 0b10101, 0b10001, 0b10001, 0b10001, 0b10001],
  N: [0b10001, 0b11001, 0b10101, 0b10011, 0b10001, 0b10001, 0b10001],
  O: [0b01110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
  P: [0b11110, 0b10001, 0b10001, 0b11110, 0b10000, 0b10000, 0b10000],
  Q: [0b01110, 0b10001, 0b10001, 0b10001, 0b10101, 0b10010, 0b01101],
  R: [0b11110, 0b10001, 0b10001, 0b11110, 0b10100, 0b10010, 0b10001],
  S: [0b01111, 0b10000, 0b10000, 0b01110, 0b00001, 0b00001, 0b11110],
  T: [0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100],
  U: [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
  V: [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01010, 0b00100],
  W: [0b10001, 0b10001, 0b10001, 0b10101, 0b10101, 0b11011, 0b10001],
  X: [0b10001, 0b10001, 0b01010, 0b00100, 0b01010, 0b10001, 0b10001],
  Y: [0b10001, 0b10001, 0b01010, 0b00100, 0b00100, 0b00100, 0b00100],
  Z: [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b10000, 0b11111],
  "#": [0b01010, 0b11111, 0b01010, 0b01010, 0b11111, 0b01010, 0b01010],
  ".": [0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b00110, 0b00110],
  "-": [0b00000, 0b00000, 0b00000, 0b11111, 0b00000, 0b00000, 0b00000],
  "/": [0b00001, 0b00010, 0b00100, 0b01000, 0b10000, 0b00000, 0b00000],
  " ": [0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b00000],
};

function clamp01(v) { return Math.max(0, Math.min(1, v)); }

function hslToRgb(h, s, l) {
  h = (((h % 360) + 360) % 360) / 360;
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const ch = (t) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 0.5) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [Math.round(ch(h + 1 / 3) * 255), Math.round(ch(h) * 255), Math.round(ch(h - 1 / 3) * 255)];
}

function hashString(input) {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function setPixel(px, width, x, y, r, g, b, opacity = 1) {
  const pxX = Math.round(x);
  const pxY = Math.round(y);
  if (pxX < 0 || pxY < 0 || pxX >= width) return;
  const height = Math.floor(px.length / (width * 3));
  if (pxY >= height) return;
  const i = (pxY * width + pxX) * 3;
  if (opacity >= 1) { px[i] = r; px[i + 1] = g; px[i + 2] = b; return; }
  px[i]     = Math.round(px[i]     + (r - px[i])     * opacity);
  px[i + 1] = Math.round(px[i + 1] + (g - px[i + 1]) * opacity);
  px[i + 2] = Math.round(px[i + 2] + (b - px[i + 2]) * opacity);
}

function fillRect(px, width, x, y, w, h, r, g, b, opacity = 1) {
  const x1 = Math.max(0, Math.round(x));
  const y1 = Math.max(0, Math.round(y));
  const x2 = Math.min(width, Math.round(x + w));
  const height = Math.floor(px.length / (width * 3));
  const y2 = Math.min(height, Math.round(y + h));
  for (let py = y1; py < y2; py++) {
    for (let px2 = x1; px2 < x2; px2++) {
      setPixel(px, width, px2, py, r, g, b, opacity);
    }
  }
}

function drawLine(px, width, x0, y0, x1, y1, r, g, b, opacity = 1, thickness = 1) {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = x0 + (x1 - x0) * t;
    const y = y0 + (y1 - y0) * t;
    fillRect(px, width, x - (thickness - 1) / 2, y - (thickness - 1) / 2, thickness, thickness, r, g, b, opacity);
  }
}

function drawRing(px, width, cx, cy, radius, thickness, r, g, b, opacity = 1) {
  const circumference = Math.max(48, Math.round(radius * 10));
  for (let i = 0; i < circumference; i++) {
    const angle = (i / circumference) * Math.PI * 2;
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;
    fillRect(px, width, x - thickness / 2, y - thickness / 2, thickness, thickness, r, g, b, opacity);
  }
}

function sanitizeFontText(input) {
  return input.toUpperCase().replace(/[^A-Z0-9#./\- ]+/g, " ").replace(/\s+/g, " ").trim();
}

function wrapText(input, maxChars, maxLines) {
  const text = sanitizeFontText(input) || "DRONE LANDSCAPE";
  const words = text.split(" ");
  const lines = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) { current = candidate; continue; }
    if (current) lines.push(current);
    current = word;
    if (lines.length === maxLines - 1) break;
  }
  if (lines.length < maxLines && current) lines.push(current);
  if (lines.length === 0) return ["DRONE LANDSCAPE"];
  return lines.slice(0, maxLines);
}

function drawText(px, width, text, x, y, scale, r, g, b, opacity = 1) {
  let cursorX = x;
  const safeText = sanitizeFontText(text) || " ";
  for (const char of safeText) {
    const bitmap = PIXEL_FONT[char] || PIXEL_FONT[" "];
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 5; col++) {
        if (bitmap[row] & (1 << (4 - col))) {
          fillRect(px, width, cursorX + col * scale, y + row * scale, scale, scale, r, g, b, opacity);
        }
      }
    }
    cursorX += 6 * scale;
  }
  return cursorX;
}

function voiceWeights(scene) {
  const order = ["tanpura", "reed", "metal", "air"];
  return order.map((voice) => {
    if (!scene.drone.voiceLayers[voice]) return 0;
    return clamp01(scene.drone.voiceLevels[voice]);
  });
}

function activeVoiceSummary(scene) {
  const voices = Object.keys(VOICE_LABELS)
    .filter((voice) => scene.drone.voiceLayers[voice] && scene.drone.voiceLevels[voice] > 0.08)
    .map((voice) => VOICE_LABELS[voice]);
  if (voices.length === 0) return "SUSTAIN";
  return voices.slice(0, 2).join("/");
}

function effectEnergy(scene) {
  const levels = Object.entries(scene.fx.levels)
    .map(([effectId, level]) => scene.drone.effects[effectId] ? level : 0);
  return levels.reduce((sum, value) => sum + value, 0) / Math.max(levels.length, 1);
}

function backgroundColors(scene) {
  const paletteShift = scene.ui.paletteId === "copper" ? 16 : scene.ui.paletteId === "dusk" ? 52 : 0;
  const tonicHue = PITCH_INDEX[scene.drone.root] * 30;
  const climateHue = scene.drone.climateX * 110;
  const moodHue = tonicHue + paletteShift + climateHue;
  const glowHue = moodHue + 28 + scene.drone.climateY * 36;
  return {
    base: hslToRgb(moodHue - 14, 0.45, 0.08 + scene.drone.climateY * 0.06),
    accent: hslToRgb(glowHue, 0.88, 0.62),
    warm: hslToRgb(glowHue - 24, 0.7, 0.48),
    glow: hslToRgb(glowHue + 18, 0.9, 0.72),
  };
}

function metaTitle(scene) {
  return `${scene.drone.root}${scene.drone.octave} ${SCALE_LABELS[scene.drone.scale]}`;
}

function sceneSeed(scene) {
  return hashString([
    scene.name,
    scene.drone.root,
    scene.drone.scale,
    scene.drone.activePresetId ?? "custom",
    scene.ui.visualizer,
  ].join("|"));
}

function lfoSample(scene, t) {
  const phase = t * (1 + scene.drone.lfoRate * 3);
  switch (scene.drone.lfoShape) {
    case "triangle": return 1 - 4 * Math.abs(Math.round(phase - 0.25) - (phase - 0.25));
    case "square":   return Math.sin(phase * Math.PI * 2) >= 0 ? 1 : -1;
    case "sawtooth": return 2 * (phase - Math.floor(phase + 0.5));
    case "sine":
    default:         return Math.sin(phase * Math.PI * 2);
  }
}

function drawLfoWave(px, width, height, scene, r, g, b) {
  const baseY = Math.round(height * 0.73);
  const amplitude = 6 + scene.drone.lfoAmount * 24;
  let prevX = 28;
  let prevY = baseY;
  for (let x = 28; x < width - 28; x += 4) {
    const t = (x - 28) / Math.max(width - 56, 1);
    const y = baseY + lfoSample(scene, t) * amplitude;
    drawLine(px, width, prevX, prevY, x, y, r, g, b, 0.75, 2);
    prevX = x;
    prevY = y;
  }
}

function drawBackground(px, width, height, scene) {
  const { base, accent, warm, glow } = backgroundColors(scene);
  fillRect(px, width, 0, 0, width, height, base[0], base[1], base[2]);
  for (let y = 0; y < height; y++) {
    const mix = y / Math.max(height - 1, 1);
    const hue = PITCH_INDEX[scene.drone.root] * 30 + scene.drone.climateX * 70 + mix * 18;
    const [r, g, b] = hslToRgb(hue, 0.38 + scene.drone.climateY * 0.18, 0.08 + (1 - mix) * 0.12);
    fillRect(px, width, 0, y, width, 1, r, g, b, 0.6);
  }
  fillRect(px, width, 0, 0, width, 14, accent[0], accent[1], accent[2], 0.12 + scene.drone.air * 0.22);
  fillRect(px, width, 0, height - 18, width, 18, warm[0], warm[1], warm[2], 0.18 + scene.drone.bloom * 0.2);
  const seed = sceneSeed(scene);
  for (let i = 0; i < 42; i++) {
    const x = ((seed >> (i % 12)) + i * 37) % width;
    const y = ((seed >> ((i + 4) % 13)) + i * 23) % Math.round(height * 0.5);
    fillRect(px, width, x, y, 2, 2, glow[0], glow[1], glow[2], 0.14 + ((i % 5) * 0.04));
  }
  return { accent, glow, warm };
}

function drawBandsStyle(px, width, height, scene, accent, glow) {
  const weights = voiceWeights(scene);
  const baseY = height * 0.18;
  let cursorY = baseY;
  weights.forEach((weight, index) => {
    const bandHeight = 16 + weight * 34 + index * 5;
    const hue = PITCH_INDEX[scene.drone.root] * 30 + scene.drone.climateX * 60 + index * 24;
    const [r, g, b] = hslToRgb(hue, 0.8, 0.35 + weight * 0.24);
    fillRect(px, width, 32, cursorY, width - 64, bandHeight, r, g, b, 0.34 + weight * 0.3);
    fillRect(px, width, 48 + index * 18, cursorY + bandHeight * 0.36, width - 96 - index * 36, 2, glow[0], glow[1], glow[2], 0.22 + weight * 0.2);
    cursorY += bandHeight * 0.68;
  });
  fillRect(px, width, 24, height * 0.55, width - 48, 2, accent[0], accent[1], accent[2], 0.2 + scene.drone.glide * 0.3);
}

function drawRingsStyle(px, width, height, scene, accent, glow) {
  const weights = voiceWeights(scene);
  const cx = width * 0.72;
  const cy = height * 0.44;
  weights.forEach((weight, index) => {
    const hue = PITCH_INDEX[scene.drone.root] * 30 + 16 + index * 18 + scene.drone.climateX * 54;
    const [r, g, b] = hslToRgb(hue, 0.85, 0.4 + weight * 0.2);
    drawRing(px, width, cx, cy, 22 + index * 18 + weight * 12, 2 + Math.round(weight * 2), r, g, b, 0.38 + weight * 0.34);
  });
  drawRing(px, width, cx, cy, 8 + scene.drone.bloom * 16, 4, glow[0], glow[1], glow[2], 0.65);
  drawLine(px, width, cx - 46, cy, cx + 46, cy, accent[0], accent[1], accent[2], 0.3, 2);
  drawLine(px, width, cx, cy - 46, cx, cy + 46, accent[0], accent[1], accent[2], 0.3, 2);
}

function drawSigilStyle(px, width, height, scene, accent, glow) {
  const seed = sceneSeed(scene);
  const left = Math.round(width * 0.58);
  const top = Math.round(height * 0.16);
  const size = 104;
  fillRect(px, width, left - 10, top - 10, size + 20, size + 20, accent[0], accent[1], accent[2], 0.06);
  fillRect(px, width, left, top, size, 2, accent[0], accent[1], accent[2], 0.4);
  fillRect(px, width, left, top + size - 2, size, 2, accent[0], accent[1], accent[2], 0.4);
  fillRect(px, width, left, top, 2, size, accent[0], accent[1], accent[2], 0.4);
  fillRect(px, width, left + size - 2, top, 2, size, accent[0], accent[1], accent[2], 0.4);
  const step = 13;
  for (let i = 0; i < 8; i++) {
    const x0 = left + ((seed >> (i % 10)) % 8) * step;
    const y0 = top + ((seed >> ((i + 3) % 11)) % 8) * step;
    const x1 = left + ((seed >> ((i + 5) % 12)) % 8) * step;
    const y1 = top + ((seed >> ((i + 7) % 13)) % 8) * step;
    drawLine(px, width, x0, y0, x1, y1, glow[0], glow[1], glow[2], 0.5, 2);
    fillRect(px, width, x0 - 2, y0 - 2, 5, 5, accent[0], accent[1], accent[2], 0.55);
  }
  drawLine(px, width, left + size * 0.5, top - 18, left + size * 0.5, top + size + 18, glow[0], glow[1], glow[2], 0.2, 1);
}

function drawSpectrumStyle(px, width, height, scene, accent, glow) {
  const weights = voiceWeights(scene);
  const fxEnergy = effectEnergy(scene);
  const centerX = Math.round(width * 0.73);
  const floorY = Math.round(height * 0.6);
  for (let i = -9; i <= 9; i++) {
    const mirroredIndex = Math.abs(i) % Math.max(weights.length, 1);
    const voiceWeight = weights[mirroredIndex] ?? 0.2;
    const barHeight = 18 + voiceWeight * 48 + fxEnergy * 22 + ((Math.abs(i) + 3) % 5) * 6;
    const hue = PITCH_INDEX[scene.drone.root] * 30 + scene.drone.climateX * 64 + i * 7;
    const [r, g, b] = hslToRgb(hue, 0.88, 0.42 + voiceWeight * 0.2);
    const x = centerX + i * 10;
    fillRect(px, width, x, floorY - barHeight, 7, barHeight, r, g, b, 0.38 + voiceWeight * 0.36);
    fillRect(px, width, x, floorY - barHeight - 6, 7, 2, glow[0], glow[1], glow[2], 0.3);
  }
  drawLine(px, width, centerX - 110, floorY, centerX + 110, floorY, accent[0], accent[1], accent[2], 0.24, 2);
}

function drawSharedChrome(px, width, height, scene, style, accent, glow, warm) {
  const titleLines = wrapText(scene.name, 15, 2);
  const meta = metaTitle(scene);
  const voiceMeta = activeVoiceSummary(scene);
  const visualizerMeta = `${SCENE_CARD_STYLE_LABELS[style]} / ${sanitizeFontText(scene.ui.visualizer)}`;

  fillRect(px, width, 18, 18, 112, 18, accent[0], accent[1], accent[2], 0.14);
  drawText(px, width, "MDRONE", 24, 22, 2, glow[0], glow[1], glow[2], 0.92);

  fillRect(px, width, 18, height - 76, 210, 54, warm[0], warm[1], warm[2], 0.08);
  drawText(px, width, meta, 24, height - 70, 2, accent[0], accent[1], accent[2], 0.75);
  drawText(px, width, voiceMeta, 24, height - 54, 2, glow[0], glow[1], glow[2], 0.64);
  drawText(px, width, visualizerMeta, 24, height - 38, 2, glow[0], glow[1], glow[2], 0.5);

  let titleY = 46;
  for (const line of titleLines) {
    drawText(px, width, line, 22, titleY, 4, 245, 231, 212, 0.95);
    titleY += 32;
  }

  drawLfoWave(px, width, height, scene, glow[0], glow[1], glow[2]);

  fillRect(px, width, 0, 0, width, 2, accent[0], accent[1], accent[2], 0.32);
  fillRect(px, width, 0, height - 2, width, 2, accent[0], accent[1], accent[2], 0.26);
  fillRect(px, width, 0, 0, 2, height, accent[0], accent[1], accent[2], 0.18);
  fillRect(px, width, width - 2, 0, 2, height, accent[0], accent[1], accent[2], 0.18);
}

function getDefaultSceneCardStyle(scene) {
  return VISUALIZER_STYLE_MAP[scene.ui.visualizer] || "bands";
}

function resolveSceneCardStyle(style, scene) {
  return style === "auto" || !style ? getDefaultSceneCardStyle(scene) : style;
}

function renderSceneCardPixels(scene, styleChoice, width = SCENE_CARD_WIDTH, height = SCENE_CARD_HEIGHT) {
  const style = resolveSceneCardStyle(styleChoice, scene);
  const px = new Uint8Array(width * height * 3);
  const { accent, glow, warm } = drawBackground(px, width, height, scene);
  switch (style) {
    case "rings":    drawRingsStyle(px, width, height, scene, accent, glow); break;
    case "sigil":    drawSigilStyle(px, width, height, scene, accent, glow); break;
    case "spectrum": drawSpectrumStyle(px, width, height, scene, accent, glow); break;
    case "bands":
    default:         drawBandsStyle(px, width, height, scene, accent, glow); break;
  }
  drawSharedChrome(px, width, height, scene, style, accent, glow, warm);
  return { px, style };
}

// ── PNG encoding (kept from previous worker) ──────────────────────────────

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (c & 1 ? 0xEDB88320 : 0);
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type, data) {
  const typeBytes = new TextEncoder().encode(type);
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length, false);
  out.set(typeBytes, 4);
  out.set(data, 8);
  const crcBuf = new Uint8Array(4 + data.length);
  crcBuf.set(typeBytes);
  crcBuf.set(data, 4);
  view.setUint32(8 + data.length, crc32(crcBuf), false);
  return out;
}

async function encodePng(pixels, width, height) {
  const scanlines = new Uint8Array(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    scanlines[y * (1 + width * 3)] = 0;
    scanlines.set(pixels.subarray(y * width * 3, (y + 1) * width * 3), y * (1 + width * 3) + 1);
  }
  const cs = new CompressionStream("deflate");
  const writer = cs.writable.getWriter();
  writer.write(scanlines);
  writer.close();
  const compressed = new Uint8Array(await new Response(cs.readable).arrayBuffer());

  const ihdrData = new Uint8Array(13);
  const dv = new DataView(ihdrData.buffer);
  dv.setUint32(0, width, false);
  dv.setUint32(4, height, false);
  ihdrData[8] = 8;
  ihdrData[9] = 2;

  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const parts = [sig, pngChunk("IHDR", ihdrData), pngChunk("IDAT", compressed), pngChunk("IEND", new Uint8Array(0))];
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

async function generateCard(scene, styleChoice) {
  const { px, style } = renderSceneCardPixels(scene, styleChoice);
  const png = await encodePng(px, SCENE_CARD_WIDTH, SCENE_CARD_HEIGHT);
  return { png, style };
}

// ── routes ─────────────────────────────────────────────────────────────────

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escJs(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, "").replace(/\n/g, "\\n");
}

function buildOgHtml({ title, desc, shareUrl, appUrl, imgUrl, width, height }) {
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8">
<title>${esc(title)} — mdrone</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(shareUrl)}">
<meta property="og:type" content="music.song">
<meta property="og:site_name" content="mdrone">
<meta property="og:image" content="${esc(imgUrl)}">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="${width}">
<meta property="og:image:height" content="${height}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(imgUrl)}">
</head><body><p>Opening <a href="${esc(appUrl)}">mdrone</a>…</p>
<script>window.location.replace("${escJs(appUrl)}");</script>
<noscript><meta http-equiv="refresh" content="1;url=${esc(appUrl)}"></noscript>
</body></html>`;
}

async function handleRequest(url) {
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
    const styleChoice = url.searchParams.get("cs") || url.searchParams.get("s") || "auto";
    const { png } = await generateCard(scene, styleChoice);
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
    const styleChoice = url.searchParams.get("cs") || "auto";
    const style = resolveSceneCardStyle(styleChoice, scene);
    const title = scene.name;
    const desc = `${metaTitle(scene)} · ${activeVoiceSummary(scene)} — a drone landscape from mdrone.`;
    const paramKey = z ? "z" : "b";
    const csParam = styleChoice !== "auto" ? `&cs=${style}` : "";
    const shareUrl = `https://sd.mpump.live/?${paramKey}=${raw}${csParam}`;
    const appUrl = `${APP_ORIGIN}/?${paramKey}=${raw}${csParam}`;
    const imgUrl = `https://sd.mpump.live/img?${paramKey}=${raw}${csParam}`;

    const html = buildOgHtml({
      title, desc, shareUrl, appUrl, imgUrl,
      width: SCENE_CARD_WIDTH, height: SCENE_CARD_HEIGHT,
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
  async fetch(request) {
    try {
      return await handleRequest(new URL(request.url));
    } catch (e) {
      return new Response(`Error: ${e && e.message ? e.message : "unknown"}`, { status: 500 });
    }
  },
};
