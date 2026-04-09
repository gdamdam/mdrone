/**
 * Authored presets for mdrone — curated scenes inspired by traditional
 * and modern drone instruments / composers. Each preset captures:
 *
 *   - which voice layers are active + their mix levels
 *   - all six macros (drift / air / time / sub / bloom / glide)
 *   - LFO shape / rate / depth
 *   - climate XY position
 *   - which effects are toggled on
 *   - the scale (mode) — but NOT the root tonic (user's choice)
 *
 * Presets are applied via `applyPreset(engine, preset, setters)` where
 * `setters` is a bag of React state setters from DroneView so the UI
 * reflects the new state alongside the engine changes.
 *
 * Adding a preset: copy an existing entry, change the fields, give it
 * a unique id + name + hint. No scale editor in the UI yet — presets
 * suggest a mode but the user can pick any tonic.
 */

import type { AudioEngine } from "./AudioEngine";
import type { EffectId } from "./FxChain";
import type { VoiceType } from "./VoiceBuilder";
import { ALL_VOICE_TYPES } from "./VoiceBuilder";
import type { ScaleId } from "../types";
import type { DroneSessionSnapshot } from "../session";

export interface Preset {
  id: string;
  name: string;
  hint: string;
  /** Named inspiration / creator reference, shown in the tooltip. */
  attribution: string;

  voiceLayers: VoiceType[];
  voiceLevels?: Partial<Record<VoiceType, number>>;

  drift: number;
  air: number;
  time: number;
  sub: number;
  bloom: number;
  glide: number;

  lfoShape: OscillatorType;
  lfoRate: number;
  lfoAmount: number;

  climateX: number;
  climateY: number;

  effects: EffectId[]; // effects to enable (all others disabled)

  scale: ScaleId;
}

const SCALE_INTERVALS: Record<ScaleId, number[]> = {
  drone: [0],
  major: [0, 400, 700],
  minor: [0, 300, 700],
  dorian: [0, 300, 700, 1000],
  phrygian: [0, 100, 700],
  just5: [0, 386.31, 701.96],
  pentatonic: [0, 200, 700],
};

export const SAFE_RANDOM_PRESET_IDS = [
  "tanpura-drone",
  "shruti-box",
  "malone-organ",
  "dream-house",
  "deep-listening",
  "stone-organ",
  "stars-of-the-lid",
  "eno-airport",
  "buddhist-monk-drone",
  "tibetan-bowl",
  "coil-time-machines",
  "windscape",
] as const;

/**
 * The preset library — 9 authored scenes. Each one is a reference to
 * a specific drone tradition or artist, tuned to sit at sensible
 * starting levels when you tap it. Not a "preset browser" — a small
 * curated set.
 */
export const PRESETS: Preset[] = [
  {
    id: "tanpura-drone",
    name: "Tanpura Drone",
    attribution: "Jawari string drone · buzzing overtones",
    hint: "A lone tanpura — Karplus-Strong with jawari buzz on a 4-string auto-pluck cycle. Minimal reverb, no other layers. The archetypal drone, unadorned.",
    voiceLayers: ["tanpura"],
    voiceLevels: { tanpura: 1 },
    drift: 0.18,
    air: 0.28,
    time: 0.35,
    sub: 0,
    bloom: 0.2,
    glide: 0.1,
    lfoShape: "sine",
    lfoRate: 0.35,
    lfoAmount: 0.1,
    climateX: 0.5,
    climateY: 0.25,
    effects: ["plate"],
    scale: "dorian",
  },
  {
    id: "shruti-box",
    name: "Shruti Box",
    attribution: "Indian devotional · reed bellows",
    hint: "Harmonium / shruti-box reed voice with slow bellows breath modulation. Warm, organic, sustained body. Hall reverb and tape saturation give it a wooden room feel.",
    voiceLayers: ["reed"],
    voiceLevels: { reed: 1 },
    drift: 0.25,
    air: 0.35,
    time: 0.3,
    sub: 0.3,
    bloom: 0.25,
    glide: 0.15,
    lfoShape: "sine",
    lfoRate: 0.3,
    lfoAmount: 0.18,
    climateX: 0.45,
    climateY: 0.35,
    effects: ["hall", "tape"],
    scale: "dorian",
  },
  {
    id: "malone-organ",
    name: "Kali Organ",
    attribution: "Minimal pipe organ · cathedral stillness",
    hint: "Reed + metal ranks stacked at just 5-limit intervals, with slow bloom, hall, and tape for a patient church-space drone.",
    voiceLayers: ["reed", "metal"],
    voiceLevels: { reed: 1, metal: 0.55 },
    drift: 0.2,
    air: 0.4,
    time: 0.2,
    sub: 0.45,
    bloom: 0.55,
    glide: 0.25,
    lfoShape: "sine",
    lfoRate: 0.2,
    lfoAmount: 0.12,
    climateX: 0.35,
    climateY: 0.2,
    effects: ["hall", "tape", "plate"],
    scale: "just5",
  },
  {
    id: "dream-house",
    name: "Dream House",
    attribution: "Long-tone just-intonation · beating intervals",
    hint: "Stable sustained intervals with very slow internal motion and almost no decorative effect movement. Built to let the beating between tones become the composition.",
    voiceLayers: ["reed", "air"],
    voiceLevels: { reed: 1, air: 0.14 },
    drift: 0.05,
    air: 0.22,
    time: 0.04,
    sub: 0.22,
    bloom: 0.74,
    glide: 0.42,
    lfoShape: "sine",
    lfoRate: 0.05,
    lfoAmount: 0.03,
    climateX: 0.28,
    climateY: 0.08,
    effects: ["hall"],
    scale: "just5",
  },
  {
    id: "deep-listening",
    name: "Deep Listening",
    attribution: "Attentive spacious drone · resonant listening room",
    hint: "A spacious, reflective drone with low-motion breath and a patient room around it. Less ritual, less cathedral, more listening into the tone and its reflections.",
    voiceLayers: ["reed", "air", "tanpura"],
    voiceLevels: { reed: 0.9, air: 0.28, tanpura: 0.22 },
    drift: 0.18,
    air: 0.48,
    time: 0.11,
    sub: 0.26,
    bloom: 0.62,
    glide: 0.34,
    lfoShape: "sine",
    lfoRate: 0.07,
    lfoAmount: 0.06,
    climateX: 0.34,
    climateY: 0.16,
    effects: ["hall", "plate"],
    scale: "drone",
  },
  {
    id: "stone-organ",
    name: "Stone Organ",
    attribution: "Austere liturgical drone · dark nave resonance",
    hint: "A darker, stricter organ drone than the warmer minimalist church preset. Reed-forward, slower air, less shimmer, more stone and pressure in the room.",
    voiceLayers: ["reed", "metal"],
    voiceLevels: { reed: 1, metal: 0.26 },
    drift: 0.1,
    air: 0.34,
    time: 0.07,
    sub: 0.52,
    bloom: 0.58,
    glide: 0.28,
    lfoShape: "triangle",
    lfoRate: 0.05,
    lfoAmount: 0.04,
    climateX: 0.18,
    climateY: 0.1,
    effects: ["hall", "tape"],
    scale: "drone",
  },
  {
    id: "stars-of-the-lid",
    name: "Nitrous Oxide",
    attribution: "Ambient cinematic · suspended glow",
    hint: "Tanpura, metal, and air layered with slow bloom, shimmer reverb, and delay. Cinematic, drifting, and never fully settled.",
    voiceLayers: ["tanpura", "metal", "air"],
    voiceLevels: { tanpura: 0.85, metal: 0.6, air: 0.7 },
    drift: 0.4,
    air: 0.55,
    time: 0.45,
    sub: 0.3,
    bloom: 0.7,
    glide: 0.35,
    lfoShape: "sine",
    lfoRate: 0.12,
    lfoAmount: 0.22,
    climateX: 0.55,
    climateY: 0.4,
    effects: ["hall", "shimmer", "delay", "tape"],
    scale: "just5",
  },
  {
    id: "radigue-drift",
    name: "Radig Drift",
    attribution: "Minimal synth drift · near-silent motion",
    hint: "Tanpura and air with maximum drift, comb resonance, and a faint frozen seam. Near-silence that keeps slowly evolving.",
    voiceLayers: ["tanpura", "air"],
    voiceLevels: { tanpura: 0.55, air: 0.9 },
    drift: 0.85,
    air: 0.65,
    time: 0.15,
    sub: 0.2,
    bloom: 0.8,
    glide: 0.5,
    lfoShape: "triangle",
    lfoRate: 0.08,
    lfoAmount: 0.3,
    climateX: 0.3,
    climateY: 0.55,
    effects: ["hall", "comb", "freeze", "tape"],
    scale: "phrygian",
  },
  {
    id: "eno-airport",
    name: "Terminal Airport",
    attribution: "Terminal ambience · floating air",
    hint: "Reed, air, and metal at soft intervals with slow glide, gentle hall, and shimmer. Airy, floating, and softly suspended.",
    voiceLayers: ["reed", "air", "metal"],
    voiceLevels: { reed: 0.9, air: 0.55, metal: 0.35 },
    drift: 0.35,
    air: 0.45,
    time: 0.3,
    sub: 0.25,
    bloom: 0.45,
    glide: 0.4,
    lfoShape: "sine",
    lfoRate: 0.18,
    lfoAmount: 0.16,
    climateX: 0.6,
    climateY: 0.35,
    effects: ["hall", "shimmer", "tape"],
    scale: "pentatonic",
  },
  {
    id: "buddhist-monk-drone",
    name: "Low Chant",
    attribution: "Low chant · ritual overtone drone",
    hint: "Low, centered reed body with a faint air breath and restrained bowl-metal halo. Built to suggest the very low fundamental and audible overtone shimmer associated with Tibetan monastic chant, without turning into a bright choir pad.",
    voiceLayers: ["reed", "metal", "air"],
    voiceLevels: { reed: 1, metal: 0.32, air: 0.24 },
    drift: 0.12,
    air: 0.42,
    time: 0.12,
    sub: 0.62,
    bloom: 0.45,
    glide: 0.22,
    lfoShape: "sine",
    lfoRate: 0.08,
    lfoAmount: 0.08,
    climateX: 0.2,
    climateY: 0.12,
    effects: ["hall", "plate"],
    scale: "drone",
  },
  {
    id: "tibetan-bowl",
    name: "Tibetan Bowl",
    attribution: "Ritual metal · singing bowl",
    hint: "Sparse bowl modes with a split low resonance and only a trace of air underneath. Less 'bright bell', more grounded singing bowl in a resonant room.",
    voiceLayers: ["metal", "air"],
    voiceLevels: { metal: 1, air: 0.26 },
    drift: 0.14,
    air: 0.46,
    time: 0.16,
    sub: 0.12,
    bloom: 0.28,
    glide: 0.15,
    lfoShape: "sine",
    lfoRate: 0.12,
    lfoAmount: 0.06,
    climateX: 0.38,
    climateY: 0.18,
    effects: ["plate", "hall"],
    scale: "drone",
  },
  {
    id: "coil-time-machines",
    name: "Time Machines",
    attribution: "Ceremonial single-note trance · suspended time",
    hint: "A low single-note ritual drone with restrained movement, deep sustain, and a narcotic sense of suspended time. Built around one center rather than a harmonic stack.",
    voiceLayers: ["reed", "metal", "air"],
    voiceLevels: { reed: 0.95, metal: 0.16, air: 0.22 },
    drift: 0.1,
    air: 0.38,
    time: 0.08,
    sub: 0.72,
    bloom: 0.68,
    glide: 0.46,
    lfoShape: "sine",
    lfoRate: 0.06,
    lfoAmount: 0.05,
    climateX: 0.16,
    climateY: 0.08,
    effects: ["hall", "tape"],
    scale: "drone",
  },
  {
    id: "nww-soliloquy",
    name: "Lilith Drift",
    attribution: "Feedback hum drift · spectral haze",
    hint: "Dark suspended feedback-hum atmosphere with unstable air, comb resonance, tape haze, and a faint frozen seam. More room tone and spectral drift than melody.",
    voiceLayers: ["air", "metal", "tanpura"],
    voiceLevels: { air: 1, metal: 0.22, tanpura: 0.18 },
    drift: 0.62,
    air: 0.58,
    time: 0.22,
    sub: 0.18,
    bloom: 0.72,
    glide: 0.52,
    lfoShape: "triangle",
    lfoRate: 0.07,
    lfoAmount: 0.18,
    climateX: 0.22,
    climateY: 0.42,
    effects: ["hall", "comb", "freeze", "tape", "wow"],
    scale: "drone",
  },
  {
    id: "doom-bloom",
    name: "Doom Bloom",
    attribution: "Slow heavy drone · amplifier pressure",
    hint: "A heavier, darker sustained wall with low-end weight, slower rise, and more pressure than clarity. Not a literal amp stack, but a browser drone bent toward doom mass.",
    voiceLayers: ["reed", "metal", "tanpura"],
    voiceLevels: { reed: 0.92, metal: 0.38, tanpura: 0.3 },
    drift: 0.22,
    air: 0.3,
    time: 0.09,
    sub: 0.84,
    bloom: 0.82,
    glide: 0.2,
    lfoShape: "triangle",
    lfoRate: 0.06,
    lfoAmount: 0.05,
    climateX: 0.12,
    climateY: 0.12,
    effects: ["hall", "tape", "sub"],
    scale: "drone",
  },
  {
    id: "merzbient",
    name: "Merzbient",
    attribution: "Ambient-noise pressure · abrasive weather",
    hint: "An ambient-noise wall of dense air, unstable bowl modes, sub pressure, tape wear, comb glare, and frozen grit. A tonal engine pushed toward noise weather instead of melody.",
    voiceLayers: ["air", "metal", "reed"],
    voiceLevels: { air: 1, metal: 0.46, reed: 0.2 },
    drift: 0.82,
    air: 0.7,
    time: 0.58,
    sub: 0.48,
    bloom: 0.36,
    glide: 0.18,
    lfoShape: "sawtooth",
    lfoRate: 0.48,
    lfoAmount: 0.24,
    climateX: 0.78,
    climateY: 0.72,
    effects: ["hall", "delay", "comb", "freeze", "tape", "wow", "sub"],
    scale: "drone",
  },
  {
    id: "windscape",
    name: "Windscape",
    attribution: "Weather ambient · worn tape air",
    hint: "Air layer as the main voice with a ghostly tanpura underneath. Comb resonator tracks the tonic, wow/flutter gives it tape-era instability.",
    voiceLayers: ["air", "tanpura"],
    voiceLevels: { air: 1, tanpura: 0.35 },
    drift: 0.55,
    air: 0.6,
    time: 0.55,
    sub: 0.25,
    bloom: 0.5,
    glide: 0.3,
    lfoShape: "triangle",
    lfoRate: 0.14,
    lfoAmount: 0.25,
    climateX: 0.4,
    climateY: 0.6,
    effects: ["hall", "comb", "wow", "tape"],
    scale: "minor",
  },
];

/** All effect ids the presets can toggle — used when clearing the
 *  chain before applying a new preset. */
const ALL_EFFECT_IDS: EffectId[] = [
  "tape", "wow", "plate", "hall", "shimmer", "delay", "sub", "comb", "freeze",
];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function jitter(value: number, spread: number, min = 0, max = 1, random = Math.random): number {
  return clamp(value + (random() * 2 - 1) * spread, min, max);
}

export function createPresetVariation(
  preset: Preset,
  root: DroneSessionSnapshot["root"],
  octave: number,
  random = Math.random,
): DroneSessionSnapshot {
  const voiceLayers: Record<VoiceType, boolean> = {
    tanpura: false,
    reed: false,
    metal: false,
    air: false,
  };
  const voiceLevels: Record<VoiceType, number> = {
    tanpura: 1,
    reed: 1,
    metal: 1,
    air: 1,
  };

  for (const type of preset.voiceLayers) {
    voiceLayers[type] = true;
  }
  for (const type of ALL_VOICE_TYPES) {
    const base = preset.voiceLevels?.[type] ?? (voiceLayers[type] ? 1 : 0);
    voiceLevels[type] = voiceLayers[type]
      ? jitter(base, 0.1, 0.08, 1, random)
      : 0;
  }

  const effects = Object.fromEntries(
    ALL_EFFECT_IDS.map((id) => [id, preset.effects.includes(id)])
  ) as Record<EffectId, boolean>;

  return {
    activePresetId: preset.id,
    playing: true,
    root,
    octave,
    scale: preset.scale,
    voiceLayers,
    voiceLevels,
    effects,
    drift: jitter(preset.drift, 0.08, 0, 0.88, random),
    air: jitter(preset.air, 0.08, 0.12, 0.82, random),
    time: jitter(preset.time, 0.07, 0.03, 0.72, random),
    sub: jitter(preset.sub, 0.08, 0, 0.78, random),
    bloom: jitter(preset.bloom, 0.08, 0.08, 0.88, random),
    glide: jitter(preset.glide, 0.08, 0.04, 0.72, random),
    climateX: jitter(preset.climateX, 0.07, 0.08, 0.82, random),
    climateY: jitter(preset.climateY, 0.07, 0.06, 0.78, random),
    lfoShape: preset.lfoShape,
    lfoRate: jitter(preset.lfoRate, Math.max(0.03, preset.lfoRate * 0.18), 0.03, 0.72, random),
    lfoAmount: jitter(preset.lfoAmount, 0.06, 0, 0.3, random),
  };
}

export function createSafeRandomScene(
  root: DroneSessionSnapshot["root"],
  octave: number,
  random = Math.random,
): { preset: Preset; snapshot: DroneSessionSnapshot } {
  const safePresets = SAFE_RANDOM_PRESET_IDS
    .map((id) => PRESETS.find((preset) => preset.id === id) ?? null)
    .filter((preset): preset is Preset => preset !== null);
  const presetPool = safePresets.length > 0 ? safePresets : PRESETS;
  const preset = presetPool[Math.floor(random() * presetPool.length)];

  return {
    preset,
    snapshot: createPresetVariation(preset, root, octave, random),
  };
}

/**
 * DroneView-side state setters that a preset needs to update so the
 * UI reflects the new scene. These are passed in from the component
 * rather than imported so presets.ts stays React-free.
 */
export interface PresetUiSetters {
  setVoiceLayers: (map: Record<VoiceType, boolean>) => void;
  setVoiceLevels: (map: Record<VoiceType, number>) => void;
  setDrift: (v: number) => void;
  setAir: (v: number) => void;
  setTime: (v: number) => void;
  setSub: (v: number) => void;
  setBloom: (v: number) => void;
  setGlide: (v: number) => void;
  setLfoShape: (s: OscillatorType) => void;
  setLfoRate: (v: number) => void;
  setLfoAmount: (v: number) => void;
  setClimate: (x: number, y: number) => void;
  setScale: (s: ScaleId) => void;
  setEffectEnabled: (id: EffectId, on: boolean) => void;
}

/**
 * Apply a preset to the engine and the UI in one pass. Any effect
 * not in the preset's `effects` list is toggled off so scenes swap
 * cleanly rather than accumulating. Tonic stays user-chosen.
 */
export function applyPreset(engine: AudioEngine | null, preset: Preset, ui: PresetUiSetters): void {
  // Voice layers — turn on the listed ones, off the rest.
  const layers: Record<VoiceType, boolean> = { tanpura: false, reed: false, metal: false, air: false };
  const levels: Record<VoiceType, number> = { tanpura: 1, reed: 1, metal: 1, air: 1 };
  for (const t of preset.voiceLayers) layers[t] = true;
  for (const t of ALL_VOICE_TYPES) {
    if (preset.voiceLevels && preset.voiceLevels[t] !== undefined) {
      levels[t] = preset.voiceLevels[t]!;
    }
  }
  ui.setVoiceLayers(layers);
  ui.setVoiceLevels(levels);

  // Macros
  ui.setDrift(preset.drift);
  ui.setAir(preset.air);
  ui.setTime(preset.time);
  ui.setSub(preset.sub);
  ui.setBloom(preset.bloom);
  ui.setGlide(preset.glide);

  // LFO
  ui.setLfoShape(preset.lfoShape);
  ui.setLfoRate(preset.lfoRate);
  ui.setLfoAmount(preset.lfoAmount);

  // Climate
  ui.setClimate(preset.climateX, preset.climateY);

  // Mode (scale)
  ui.setScale(preset.scale);

  if (engine) {
    engine.applyDroneScene(layers, levels, SCALE_INTERVALS[preset.scale] ?? [0]);
  }

  // Effects — turn on the listed ones, off the rest
  const active = new Set(preset.effects);
  for (const id of ALL_EFFECT_IDS) {
    ui.setEffectEnabled(id, active.has(id));
  }
}
