import type { PortableScene } from "./session";
import type { PitchClass, ScaleId } from "./types";
import type { Visualizer } from "./components/visualizers";

export type SceneCardStyle = "bands" | "rings" | "sigil" | "spectrum";
export type SceneCardStyleChoice = SceneCardStyle | "auto";

export const SCENE_CARD_WIDTH = 480;
export const SCENE_CARD_HEIGHT = 270;

export const SCENE_CARD_STYLE_LABELS: Record<SceneCardStyleChoice, string> = {
  auto: "AUTO",
  bands: "BANDS",
  rings: "RINGS",
  sigil: "SIGIL",
  spectrum: "SPECTRUM",
};

const CARD_TIMEOUT_MS = 500;

const PITCH_INDEX: Record<PitchClass, number> = {
  C: 0,
  "C#": 1,
  D: 2,
  "D#": 3,
  E: 4,
  F: 5,
  "F#": 6,
  G: 7,
  "G#": 8,
  A: 9,
  "A#": 10,
  B: 11,
};

const SCALE_LABELS: Record<ScaleId, string> = {
  drone: "DRONE",
  major: "MAJOR",
  minor: "MINOR",
  dorian: "DORIAN",
  phrygian: "PHRYGIAN",
  just5: "JUST5",
  pentatonic: "PENTA",
};

const VOICE_LABELS = {
  tanpura: "TANPURA",
  reed: "REED",
  metal: "METAL",
  air: "AIR",
} as const;

const VISUALIZER_STYLE_MAP: Record<Visualizer, SceneCardStyle> = {
  mandala: "rings",
  haloGlow: "rings",
  fractal: "spectrum",
  rothko: "bands",
  tapeDecay: "bands",
  dreamHouse: "bands",
  sigil: "sigil",
  starGate: "sigil",
  cymatics: "spectrum",
  inkBloom: "spectrum",
  horizon: "bands",
  aurora: "spectrum",
  orb: "rings",
  dreamMachine: "sigil",
};

const PIXEL_FONT: Record<string, number[]> = {
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

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = globalThis.setTimeout(() => {
      reject(new Error("Scene card encoding timed out."));
    }, timeoutMs);

    promise.then(
      (value) => {
        globalThis.clearTimeout(timeoutId);
        resolve(value);
      },
      (error) => {
        globalThis.clearTimeout(timeoutId);
        reject(error);
      },
    );
  });
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((((h % 360) + 360) % 360) / 360);
  if (s === 0) {
    const value = Math.round(l * 255);
    return [value, value, value];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 0.5) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [
    Math.round(channel(h + 1 / 3) * 255),
    Math.round(channel(h) * 255),
    Math.round(channel(h - 1 / 3) * 255),
  ];
}

function hashString(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function setPixel(px: Uint8Array, width: number, x: number, y: number, r: number, g: number, b: number, opacity = 1): void {
  const pxX = Math.round(x);
  const pxY = Math.round(y);
  if (pxX < 0 || pxY < 0 || pxX >= width) return;
  const height = Math.floor(px.length / (width * 3));
  if (pxY >= height) return;
  const index = (pxY * width + pxX) * 3;
  if (opacity >= 1) {
    px[index] = r;
    px[index + 1] = g;
    px[index + 2] = b;
    return;
  }
  px[index] = Math.round(px[index] + (r - px[index]) * opacity);
  px[index + 1] = Math.round(px[index + 1] + (g - px[index + 1]) * opacity);
  px[index + 2] = Math.round(px[index + 2] + (b - px[index + 2]) * opacity);
}

function fillRect(px: Uint8Array, width: number, x: number, y: number, w: number, h: number, r: number, g: number, b: number, opacity = 1): void {
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

function drawLine(px: Uint8Array, width: number, x0: number, y0: number, x1: number, y1: number, r: number, g: number, b: number, opacity = 1, thickness = 1): void {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = x0 + (x1 - x0) * t;
    const y = y0 + (y1 - y0) * t;
    fillRect(px, width, x - (thickness - 1) / 2, y - (thickness - 1) / 2, thickness, thickness, r, g, b, opacity);
  }
}

function drawRing(px: Uint8Array, width: number, cx: number, cy: number, radius: number, thickness: number, r: number, g: number, b: number, opacity = 1): void {
  const circumference = Math.max(48, Math.round(radius * 10));
  for (let i = 0; i < circumference; i++) {
    const angle = (i / circumference) * Math.PI * 2;
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;
    fillRect(px, width, x - thickness / 2, y - thickness / 2, thickness, thickness, r, g, b, opacity);
  }
}

function sanitizeFontText(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^A-Z0-9#./\- ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wrapText(input: string, maxChars: number, maxLines: number): string[] {
  const text = sanitizeFontText(input) || "DRONE LANDSCAPE";
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = word;
    if (lines.length === maxLines - 1) break;
  }
  if (lines.length < maxLines && current) lines.push(current);
  if (lines.length === 0) return ["DRONE LANDSCAPE"];
  return lines.slice(0, maxLines);
}

function drawText(px: Uint8Array, width: number, text: string, x: number, y: number, scale: number, r: number, g: number, b: number, opacity = 1): number {
  let cursorX = x;
  const safeText = sanitizeFontText(text) || " ";
  for (const char of safeText) {
    const bitmap = PIXEL_FONT[char] ?? PIXEL_FONT[" "];
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

function voiceWeights(scene: PortableScene): number[] {
  const order: (keyof PortableScene["drone"]["voiceLevels"])[] = ["tanpura", "reed", "metal", "air"];
  return order.map((voice) => {
    if (!scene.drone.voiceLayers[voice]) return 0;
    return clamp01(scene.drone.voiceLevels[voice]);
  });
}

function activeVoiceSummary(scene: PortableScene): string {
  const voices = (Object.keys(VOICE_LABELS) as (keyof typeof VOICE_LABELS)[])
    .filter((voice) => scene.drone.voiceLayers[voice] && scene.drone.voiceLevels[voice] > 0.08)
    .map((voice) => VOICE_LABELS[voice]);
  if (voices.length === 0) return "SUSTAIN";
  return voices.slice(0, 2).join("/");
}

function effectEnergy(scene: PortableScene): number {
  const levels = Object.entries(scene.fx.levels)
    .map(([effectId, level]) => scene.drone.effects[effectId as keyof PortableScene["drone"]["effects"]] ? level : 0);
  return levels.reduce((sum, value) => sum + value, 0) / Math.max(levels.length, 1);
}

function backgroundColors(scene: PortableScene): {
  base: [number, number, number];
  accent: [number, number, number];
  warm: [number, number, number];
  glow: [number, number, number];
} {
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

function metaTitle(scene: PortableScene): string {
  return `${scene.drone.root}${scene.drone.octave} ${SCALE_LABELS[scene.drone.scale]}`;
}

function sceneSeed(scene: PortableScene): number {
  return hashString([
    scene.name,
    scene.drone.root,
    scene.drone.scale,
    scene.drone.activePresetId ?? "custom",
    scene.ui.visualizer,
  ].join("|"));
}

function lfoSample(scene: PortableScene, t: number): number {
  const phase = t * (1 + scene.drone.lfoRate * 3);
  switch (scene.drone.lfoShape) {
    case "triangle":
      return 1 - 4 * Math.abs(Math.round(phase - 0.25) - (phase - 0.25));
    case "square":
      return Math.sin(phase * Math.PI * 2) >= 0 ? 1 : -1;
    case "sawtooth":
      return 2 * (phase - Math.floor(phase + 0.5));
    case "sine":
    default:
      return Math.sin(phase * Math.PI * 2);
  }
}

function drawLfoWave(px: Uint8Array, width: number, height: number, scene: PortableScene, r: number, g: number, b: number): void {
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

function drawBackground(px: Uint8Array, width: number, height: number, scene: PortableScene): { accent: [number, number, number]; glow: [number, number, number]; warm: [number, number, number] } {
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

function drawBandsStyle(px: Uint8Array, width: number, height: number, scene: PortableScene, accent: [number, number, number], glow: [number, number, number]): void {
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

function drawRingsStyle(px: Uint8Array, width: number, height: number, scene: PortableScene, accent: [number, number, number], glow: [number, number, number]): void {
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

function drawSigilStyle(px: Uint8Array, width: number, height: number, scene: PortableScene, accent: [number, number, number], glow: [number, number, number]): void {
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

function drawSpectrumStyle(px: Uint8Array, width: number, height: number, scene: PortableScene, accent: [number, number, number], glow: [number, number, number]): void {
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

function drawSharedChrome(px: Uint8Array, width: number, height: number, scene: PortableScene, style: SceneCardStyle, accent: [number, number, number], glow: [number, number, number], warm: [number, number, number]): void {
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

export function getDefaultSceneCardStyle(scene: PortableScene): SceneCardStyle {
  return VISUALIZER_STYLE_MAP[scene.ui.visualizer] ?? "bands";
}

export function resolveSceneCardStyle(style: SceneCardStyleChoice, scene: PortableScene): SceneCardStyle {
  return style === "auto" ? getDefaultSceneCardStyle(scene) : style;
}

export function withSceneCardStyleParam(url: string, style: SceneCardStyle): string {
  const next = new URL(url);
  next.searchParams.set("cs", style);
  return next.toString();
}

export function renderSceneCardPixels(
  scene: PortableScene,
  styleChoice: SceneCardStyleChoice = "auto",
  width = SCENE_CARD_WIDTH,
  height = SCENE_CARD_HEIGHT,
): Uint8Array {
  const style = resolveSceneCardStyle(styleChoice, scene);
  const px = new Uint8Array(width * height * 3);
  const { accent, glow, warm } = drawBackground(px, width, height, scene);

  switch (style) {
    case "rings":
      drawRingsStyle(px, width, height, scene, accent, glow);
      break;
    case "sigil":
      drawSigilStyle(px, width, height, scene, accent, glow);
      break;
    case "spectrum":
      drawSpectrumStyle(px, width, height, scene, accent, glow);
      break;
    case "bands":
    default:
      drawBandsStyle(px, width, height, scene, accent, glow);
      break;
  }

  drawSharedChrome(px, width, height, scene, style, accent, glow, warm);
  return px;
}

function rgbToImageData(pixels: Uint8Array, width: number, height: number): ImageData {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0, j = 0; i < pixels.length; i += 3, j += 4) {
    rgba[j] = pixels[i];
    rgba[j + 1] = pixels[i + 1];
    rgba[j + 2] = pixels[i + 2];
    rgba[j + 3] = 255;
  }
  return new ImageData(rgba, width, height);
}

export function renderSceneCardToCanvas(
  canvas: HTMLCanvasElement,
  scene: PortableScene,
  styleChoice: SceneCardStyleChoice = "auto",
  width = SCENE_CARD_WIDTH,
  height = SCENE_CARD_HEIGHT,
): void {
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.imageSmoothingEnabled = false;
  const image = rgbToImageData(renderSceneCardPixels(scene, styleChoice, width, height), width, height);
  ctx.putImageData(image, 0, 0);
}

function crc32(buf: Uint8Array): number {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length, false);
  out.set(typeBytes, 4);
  out.set(data, 8);
  const crcBuffer = new Uint8Array(4 + data.length);
  crcBuffer.set(typeBytes);
  crcBuffer.set(data, 4);
  view.setUint32(8 + data.length, crc32(crcBuffer), false);
  return out;
}

async function encodePng(pixels: Uint8Array, width: number, height: number): Promise<Uint8Array> {
  if (typeof CompressionStream === "undefined") {
    throw new Error("PNG encoding needs CompressionStream in this environment.");
  }

  const scanlines = new Uint8Array(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const offset = y * (1 + width * 3);
    scanlines[offset] = 0;
    scanlines.set(pixels.subarray(y * width * 3, (y + 1) * width * 3), offset + 1);
  }

  const compressor = new CompressionStream("deflate");
  const writer = compressor.writable.getWriter();
  await writer.write(scanlines);
  await writer.close();
  const compressed = new Uint8Array(await withTimeout(new Response(compressor.readable).arrayBuffer(), CARD_TIMEOUT_MS));

  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width, false);
  view.setUint32(4, height, false);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const parts = [
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", compressed),
    pngChunk("IEND", new Uint8Array(0)),
  ];
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export async function renderSceneCardPng(
  scene: PortableScene,
  styleChoice: SceneCardStyleChoice = "auto",
  width = SCENE_CARD_WIDTH,
  height = SCENE_CARD_HEIGHT,
): Promise<Uint8Array> {
  return encodePng(renderSceneCardPixels(scene, styleChoice, width, height), width, height);
}
