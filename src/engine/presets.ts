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

  /** Optional per-preset loudness trim (A). Defaults to 1.0. Applied
   *  on top of the auto-normalization so authors can fine-tune. */
  gain?: number;
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
    hint: "A lone tanpura with jawari buzz. The archetypal Indian string drone — rooted, overtone-rich, unadorned, with only a faint plate room around it.",
    voiceLayers: ["tanpura"],
    voiceLevels: { tanpura: 1 },
    drift: 0.16,
    air: 0.3,
    time: 0.05,      // almost no filter sweep — tanpura sits still
    sub: 0,
    bloom: 0.35,
    glide: 0.12,
    lfoShape: "sine",
    lfoRate: 0.14,
    lfoAmount: 0.04, // very subtle breath
    climateX: 0.42,
    climateY: 0.12,
    effects: ["plate"],
    scale: "drone",  // tanpura is a single open drone, not a modal set
    gain: 1.1,
  },
  {
    id: "shruti-box",
    name: "Shruti Box",
    attribution: "Indian devotional · reed bellows",
    hint: "Harmonium / shruti-box reed sustain. Warm, woody, devotional. A slow breath modulation mimics the bellows; hall + tape give it a wooden room.",
    voiceLayers: ["reed"],
    voiceLevels: { reed: 1 },
    drift: 0.18,
    air: 0.34,
    time: 0.06,
    sub: 0.22,
    bloom: 0.45,
    glide: 0.18,
    lfoShape: "sine",
    lfoRate: 0.2,    // ~5 s bellows period
    lfoAmount: 0.1,
    climateX: 0.4,
    climateY: 0.14,
    effects: ["hall", "tape"],
    scale: "drone",
    gain: 1.12,
  },
  {
    id: "malone-organ",
    name: "Kali Organ",
    attribution: "Minimal pipe organ · cathedral stillness",
    hint: "Reed + metal ranks voiced at pure 5-limit intervals. Slow bloom, large hall, gentle tape — a patient church-space drone with no tremolo.",
    voiceLayers: ["reed", "metal"],
    voiceLevels: { reed: 1, metal: 0.5 },
    drift: 0.14,
    air: 0.5,
    time: 0.05,
    sub: 0.38,
    bloom: 0.62,
    glide: 0.24,
    lfoShape: "sine",
    lfoRate: 0.12,
    lfoAmount: 0.04, // organs don't tremolo
    climateX: 0.32,
    climateY: 0.12,
    effects: ["hall", "tape"], // dropped plate — hall carries the space
    scale: "just5",
    gain: 1.0,
  },
  {
    id: "dream-house",
    name: "Dream House",
    attribution: "Long-tone just-intonation · beating intervals",
    hint: "Stable sustained just intervals. The beating between tones is the composition — movement macros are near-zero, effects minimal so the beats stay intact.",
    voiceLayers: ["reed", "air"],
    voiceLevels: { reed: 1, air: 0.35 },
    drift: 0.06,
    air: 0.2,
    time: 0.03,
    sub: 0.18,
    bloom: 0.85,
    glide: 0.45,
    lfoShape: "sine",
    lfoRate: 0.06,
    lfoAmount: 0.02,
    climateX: 0.32,
    climateY: 0.05,
    effects: ["hall"],
    scale: "just5",
    gain: 1.08,
  },
  {
    id: "deep-listening",
    name: "Deep Listening",
    attribution: "Attentive spacious drone · resonant listening room",
    hint: "A reflective, patient drone in a large resonant room. Less ritual, less cathedral — listening into the tone and its reflections.",
    voiceLayers: ["reed", "air", "tanpura"],
    voiceLevels: { reed: 0.9, air: 0.3, tanpura: 0.2 },
    drift: 0.16,
    air: 0.52,
    time: 0.05,
    sub: 0.22,
    bloom: 0.7,
    glide: 0.35,
    lfoShape: "sine",
    lfoRate: 0.08,
    lfoAmount: 0.05,
    climateX: 0.4,
    climateY: 0.1,
    effects: ["hall", "plate"],
    scale: "drone",
    gain: 1.0,
  },
  {
    id: "stone-organ",
    name: "Stone Organ",
    attribution: "Austere liturgical drone · dark nave resonance",
    hint: "A darker, stricter organ than the warmer church preset. Reed-forward, very low motion, more pressure than warmth.",
    voiceLayers: ["reed", "metal"],
    voiceLevels: { reed: 1, metal: 0.22 },
    drift: 0.08,
    air: 0.36,
    time: 0.04,
    sub: 0.55,
    bloom: 0.62,
    glide: 0.26,
    lfoShape: "sine",
    lfoRate: 0.06,
    lfoAmount: 0.03,
    climateX: 0.16,
    climateY: 0.08,
    effects: ["hall", "tape"],
    scale: "drone",
    gain: 1.08, // dark low preset — small perceptual lift
  },
  {
    id: "stars-of-the-lid",
    name: "Nitrous Oxide",
    attribution: "Ambient cinematic · suspended glow",
    hint: "Tanpura, metal, and air layered with slow bloom and shimmer reverb. Cinematic, softly drifting, not fully settled.",
    voiceLayers: ["tanpura", "metal", "air"],
    voiceLevels: { tanpura: 0.8, metal: 0.55, air: 0.7 },
    drift: 0.32,
    air: 0.6,
    time: 0.18,       // gentler filter sweep
    sub: 0.26,
    bloom: 0.78,
    glide: 0.4,
    lfoShape: "sine",
    lfoRate: 0.08,
    lfoAmount: 0.1,   // tamed so it floats instead of throbs
    climateX: 0.5,
    climateY: 0.32,
    // tape → plate → hall → shimmer reads like a real cinematic
    // reverb stack (warm → early refl → big room → bright cloud).
    effects: ["tape", "plate", "hall", "shimmer"],
    scale: "just5",
    gain: 0.95,
  },
  {
    id: "radigue-drift",
    name: "Radig Drift",
    attribution: "Minimal synth drift · near-silent motion",
    hint: "Near-silence that keeps slowly evolving. Tanpura and air with long drift, comb resonance, and a faint frozen seam.",
    voiceLayers: ["tanpura", "air"],
    voiceLevels: { tanpura: 0.5, air: 0.95 },
    drift: 0.72,
    air: 0.58,
    time: 0.07,       // was too fast — near-silent shouldn't sweep
    sub: 0.2,
    bloom: 0.9,
    glide: 0.52,
    lfoShape: "sine",
    lfoRate: 0.05,
    lfoAmount: 0.08,
    climateX: 0.32,
    climateY: 0.38,
    effects: ["hall", "comb", "freeze"], // dropped tape — cleaner spectral drift
    scale: "drone",   // phrygian was too melodic for a near-silent preset
    gain: 1.1,
  },
  {
    id: "eno-airport",
    name: "Terminal Airport",
    attribution: "Terminal ambience · floating air",
    hint: "Reed, air and metal softly suspended. Gentle hall and shimmer, slow glide, a calm transit-space feeling.",
    voiceLayers: ["reed", "air", "metal"],
    voiceLevels: { reed: 0.85, air: 0.55, metal: 0.3 },
    drift: 0.28,
    air: 0.5,
    time: 0.1,
    sub: 0.22,
    bloom: 0.55,
    glide: 0.4,
    lfoShape: "sine",
    lfoRate: 0.1,
    lfoAmount: 0.08,
    climateX: 0.56,
    climateY: 0.2,
    effects: ["hall", "shimmer", "tape"],
    scale: "pentatonic",
    gain: 0.98,
  },
  {
    id: "buddhist-monk-drone",
    name: "Low Chant",
    attribution: "Low chant · ritual overtone drone",
    hint: "Low reed body with a faint air breath and a restrained metallic halo — the very low fundamental and overtone shimmer of monastic chant, without turning into a choir pad.",
    voiceLayers: ["reed", "metal", "air"],
    voiceLevels: { reed: 1, metal: 0.28, air: 0.2 },
    drift: 0.1,
    air: 0.42,
    time: 0.05,
    sub: 0.65,
    bloom: 0.5,
    glide: 0.22,
    lfoShape: "sine",
    lfoRate: 0.07,
    lfoAmount: 0.05,
    climateX: 0.18,
    climateY: 0.08,
    effects: ["hall", "plate"],
    scale: "drone",
    gain: 1.12,
  },
  {
    id: "tibetan-bowl",
    name: "Tibetan Bowl",
    attribution: "Ritual metal · singing bowl",
    hint: "Grounded singing-bowl resonance in a reflective room. Bowl modes with a small air bed underneath — circular, resonant, not a bright bell.",
    voiceLayers: ["metal", "air"],
    voiceLevels: { metal: 1, air: 0.22 },
    drift: 0.1,
    air: 0.5,
    time: 0.06,
    sub: 0.2,
    bloom: 0.4,
    glide: 0.18,
    lfoShape: "sine",
    lfoRate: 0.09,
    lfoAmount: 0.04,
    climateX: 0.36,
    climateY: 0.1,
    effects: ["plate", "hall"],
    scale: "drone",
    gain: 1.05,
  },
  {
    id: "coil-time-machines",
    name: "Time Machines",
    attribution: "Ceremonial single-note trance · suspended time",
    hint: "A low single-note ritual drone with narcotic stillness. One center, deep sustain, almost no decorative movement.",
    voiceLayers: ["reed", "metal", "air"],
    voiceLevels: { reed: 0.95, metal: 0.14, air: 0.18 },
    drift: 0.08,
    air: 0.38,
    time: 0.04,
    sub: 0.75,
    bloom: 0.78,
    glide: 0.48,
    lfoShape: "sine",
    lfoRate: 0.05,
    lfoAmount: 0.03,
    climateX: 0.16,
    climateY: 0.06,
    effects: ["hall", "tape"],
    scale: "drone",
    gain: 1.1,
  },
  {
    id: "nww-soliloquy",
    name: "Lilith Drift",
    attribution: "Feedback hum drift · spectral haze",
    hint: "Dark feedback-hum atmosphere — unstable air, comb resonance and tape haze. Room tone and spectral drift, not melody.",
    voiceLayers: ["air", "metal", "tanpura"],
    voiceLevels: { air: 1, metal: 0.2, tanpura: 0.18 },
    // drift dropped from 0.55 → 0.28: the air voice's Q-walks and metal
    // partial walks were getting whipped around at high drift, driving
    // the comb resonance into peaks that clipped the chain.
    drift: 0.28,
    air: 0.55,
    time: 0.08,
    // sub lowered from 0.2 → 0.12 so the comb (tuned to the root) has
    // less low-end to amplify at its resonance peak.
    sub: 0.12,
    bloom: 0.82,
    glide: 0.55,
    lfoShape: "sine",
    lfoRate: 0.06,
    lfoAmount: 0.05,
    climateX: 0.22,
    climateY: 0.2,
    // freeze removed: in a serial chain it captures whichever moment
    // you enable it and then keeps running at that level underneath the
    // live signal, which stacked on top of the comb resonance and was
    // the main source of the clipping. Keep comb + tape + hall for the
    // dark spectral identity.
    effects: ["tape", "comb", "hall"],
    scale: "drone",
    gain: 0.82,
  },
  {
    id: "doom-bloom",
    name: "Doom Bloom",
    attribution: "Slow heavy drone · amplifier pressure",
    hint: "A heavy darkened wall with massive low end, slow bloom and pressure. Soft-edged rather than saturated into collapse.",
    voiceLayers: ["reed", "metal", "tanpura"],
    voiceLevels: { reed: 0.9, metal: 0.35, tanpura: 0.28 },
    drift: 0.18,
    air: 0.32,
    time: 0.05,
    sub: 0.88,
    bloom: 0.88,
    glide: 0.22,
    lfoShape: "sine",
    lfoRate: 0.05,
    lfoAmount: 0.03,
    climateX: 0.1,
    climateY: 0.08,
    effects: ["hall", "tape", "sub"],
    scale: "drone",
    gain: 0.95, // already hot — small cut to match the library
  },
  {
    id: "merzbient",
    name: "Merzbient",
    attribution: "Ambient-noise pressure · abrasive weather",
    hint: "An ambient-noise pressure field — dense air, unstable bowl modes, sub weight, tape wear and comb glare. Noisy weather instead of melody, but still controlled.",
    voiceLayers: ["air", "metal", "reed"],
    voiceLevels: { air: 1, metal: 0.42, reed: 0.2 },
    drift: 0.68,
    air: 0.62,
    time: 0.22,       // was 0.58 — way too nervous
    sub: 0.55,
    bloom: 0.55,
    glide: 0.22,
    lfoShape: "triangle", // sawtooth was edgy; triangle still abrasive but smoother
    lfoRate: 0.18,    // was 0.48 — halved for slower weather-like pulsing
    lfoAmount: 0.14,  // tamed
    climateX: 0.6,
    climateY: 0.5,
    // wow adds the worn-tape flutter central to the "abrasive weather"
    // identity; sub + comb keep the spectral pressure; freeze + hall
    // stretch the wall out.
    effects: ["wow", "tape", "sub", "comb", "hall", "freeze"],
    scale: "drone",
    gain: 0.78,       // perceptually very loud (noise + wide spectrum) — cut
  },
  {
    id: "windscape",
    name: "Windscape",
    attribution: "Weather ambient · worn tape air",
    hint: "Air as the main voice with a ghostly tanpura underneath. Comb tracks the tonic, wow/flutter gives it worn tape-era instability — gentle erosion, not violence.",
    voiceLayers: ["air", "tanpura"],
    voiceLevels: { air: 1, tanpura: 0.32 },
    drift: 0.48,
    air: 0.56,
    time: 0.2,        // was 0.55 — gentler
    sub: 0.22,
    bloom: 0.6,
    glide: 0.32,
    lfoShape: "sine",
    lfoRate: 0.09,
    lfoAmount: 0.12,
    climateX: 0.42,
    climateY: 0.42,
    effects: ["hall", "comb", "wow", "tape"],
    scale: "drone",   // minor added melodic content that fought the weather identity
    gain: 1.05,
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

  // (B) Auto-normalize active layer levels so that the sum of the
  // active layers equals a fixed budget. This smooths out authoring
  // accidents (e.g. 3 layers at 1.0 vs 1 layer at 1.0). The per-voice
  // mix ratio is preserved — only the sum is normalized.
  const ACTIVE_LEVEL_BUDGET = 1.4;
  const activeSum = ALL_VOICE_TYPES.reduce(
    (s, t) => s + (layers[t] ? levels[t] : 0),
    0,
  );
  if (activeSum > 0.0001) {
    const k = ACTIVE_LEVEL_BUDGET / activeSum;
    for (const t of ALL_VOICE_TYPES) {
      if (layers[t]) levels[t] = Math.max(0, Math.min(1, levels[t] * k));
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
    // (A) Apply per-preset loudness trim before the scene builds so
    // the new voices come in at the corrected level.
    engine.setPresetTrim(preset.gain ?? 1);
    engine.applyDroneScene(layers, levels, SCALE_INTERVALS[preset.scale] ?? [0]);
  }

  // Effects — turn on the listed ones, off the rest
  const active = new Set(preset.effects);
  for (const id of ALL_EFFECT_IDS) {
    ui.setEffectEnabled(id, active.has(id));
  }
}
