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

/**
 * The preset library — 8 authored scenes. Each one is a reference to
 * a specific drone tradition or artist, tuned to sit at sensible
 * starting levels when you tap it. Not a "preset browser" — a small
 * curated set.
 */
export const PRESETS: Preset[] = [
  {
    id: "tanpura-drone",
    name: "Tanpura Drone",
    attribution: "Indian classical · Pandit Pran Nath",
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
    name: "Kali Malone Organ",
    attribution: "Minimalist pipe organ · Kali Malone",
    hint: "Reed + metal ranks stacked at just 5-limit intervals, slow bloom, hall + tape for the church space. Cathedral drone with Kali Malone's stillness.",
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
    id: "stars-of-the-lid",
    name: "Stars of the Lid",
    attribution: "Ambient cinematic · Wiltzie / McBride",
    hint: "Tanpura + metal + air layered with slow bloom, shimmer reverb, and delay. Cinematic, drifting, never fully present — the Stars of the Lid signature.",
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
    name: "Radigue Drift",
    attribution: "ARP 2500 minimalism · Éliane Radigue",
    hint: "Tanpura + air with maximum drift, comb resonator, freeze loop. Near-silence that keeps evolving — Radigue's instability filter technique in a browser.",
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
    name: "Eno Airport",
    attribution: "Ambient 1 · Brian Eno",
    hint: "Reed + air + metal at just intervals, slow glide, gentle hall + shimmer. Airy, floating, incommensurate motion — Music for Airports in one tap.",
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
    id: "tibetan-bowl",
    name: "Tibetan Bowl",
    attribution: "Ritual metal · singing bowl",
    hint: "Pure metal voice with a breath of air underneath. Inharmonic partials ring out into a plate reverb. Meditation hall, crystalline.",
    voiceLayers: ["metal", "air"],
    voiceLevels: { metal: 1, air: 0.3 },
    drift: 0.3,
    air: 0.5,
    time: 0.25,
    sub: 0,
    bloom: 0.3,
    glide: 0.15,
    lfoShape: "sine",
    lfoRate: 0.22,
    lfoAmount: 0.14,
    climateX: 0.65,
    climateY: 0.3,
    effects: ["plate", "shimmer"],
    scale: "minor",
  },
  {
    id: "windscape",
    name: "Windscape",
    attribution: "Weather ambient · Basinski / Hecker",
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
  if (engine) {
    for (const t of ALL_VOICE_TYPES) {
      engine.setVoiceLayer(t, layers[t]);
      engine.setVoiceLevel(t, levels[t]);
    }
  }

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

  // Effects — turn on the listed ones, off the rest
  const active = new Set(preset.effects);
  for (const id of ALL_EFFECT_IDS) {
    ui.setEffectEnabled(id, active.has(id));
  }
}
