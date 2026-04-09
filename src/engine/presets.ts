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

  /** Authored evolve behavior so each preset can feel alive in its own way. */
  motionProfile: PresetMotionProfile;
}

export interface PresetMaterialProfile {
  driftBias: Partial<Record<VoiceType, number>>;
  levelWobble: Partial<Record<VoiceType, number>>;
  wobbleRate: number;
  pluckRange: readonly [number, number];
  shimmerPulse: number;
  subPulse: number;
}

export interface PresetMotionProfile {
  climateXRange: readonly [number, number];
  climateYRange: readonly [number, number];
  bloomRange: readonly [number, number];
  timeRange: readonly [number, number];
  driftRange: readonly [number, number];
  subRange: readonly [number, number];
  macroStep: number;
  tonicWalk: "none" | "rare" | "gentle" | "restless";
  tonicIntervals: readonly number[];
  tonicFloor: number;
  textureFloor: number;
  texturePeriod: number;
}

export const DEFAULT_PRESET_MOTION_PROFILE: PresetMotionProfile = {
  climateXRange: [0.28, 0.62],
  climateYRange: [0.08, 0.42],
  bloomRange: [0.28, 0.82],
  timeRange: [0.03, 0.24],
  driftRange: [0.08, 0.52],
  subRange: [0, 0.52],
  macroStep: 0.75,
  tonicWalk: "rare",
  tonicIntervals: [-5, 5],
  tonicFloor: 0.58,
  textureFloor: 0.66,
  texturePeriod: 5,
};

export const DEFAULT_PRESET_MATERIAL_PROFILE: PresetMaterialProfile = {
  driftBias: { tanpura: 1, reed: 1, metal: 1, air: 1 },
  levelWobble: { tanpura: 0.02, reed: 0.02, metal: 0.02, air: 0.025 },
  wobbleRate: 0.85,
  pluckRange: [0.96, 1.06],
  shimmerPulse: 0.08,
  subPulse: 0.06,
};

function motionProfile(overrides: Partial<PresetMotionProfile>): PresetMotionProfile {
  return {
    ...DEFAULT_PRESET_MOTION_PROFILE,
    ...overrides,
  };
}

function materialProfile(overrides: Partial<PresetMaterialProfile>): PresetMaterialProfile {
  return {
    ...DEFAULT_PRESET_MATERIAL_PROFILE,
    ...overrides,
    driftBias: {
      ...DEFAULT_PRESET_MATERIAL_PROFILE.driftBias,
      ...overrides.driftBias,
    },
    levelWobble: {
      ...DEFAULT_PRESET_MATERIAL_PROFILE.levelWobble,
      ...overrides.levelWobble,
    },
  };
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
    motionProfile: motionProfile({
      climateXRange: [0.36, 0.48],
      climateYRange: [0.05, 0.18],
      bloomRange: [0.28, 0.42],
      timeRange: [0.02, 0.08],
      driftRange: [0.12, 0.24],
      subRange: [0, 0.05],
      macroStep: 0.45,
      tonicWalk: "none",
      tonicIntervals: [],
      tonicFloor: 1,
      textureFloor: 0.9,
      texturePeriod: 7,
    }),
  },
  {
    id: "shruti-box",
    name: "Shruti Box",
    attribution: "Indian devotional · reed bellows",
    hint: "Harmonium / shruti-box reed sustain. Warm, woody, devotional. A slow breath modulation mimics the bellows; hall + tape give it a wooden room.",
    voiceLayers: ["reed"],
    voiceLevels: { reed: 1 },
    drift: 0.18,
    air: 0.4,
    time: 0.06,
    sub: 0.22,
    bloom: 0.45,
    glide: 0.18,
    lfoShape: "sine",
    lfoRate: 0.2,    // ~5 s bellows period
    lfoAmount: 0.14, // stronger bellows swell
    climateX: 0.4,
    climateY: 0.14,
    effects: ["hall", "tape"],
    scale: "drone",
    gain: 1.12,
    motionProfile: motionProfile({
      climateXRange: [0.34, 0.48],
      climateYRange: [0.08, 0.22],
      bloomRange: [0.36, 0.52],
      timeRange: [0.03, 0.1],
      driftRange: [0.14, 0.26],
      subRange: [0.14, 0.3],
      macroStep: 0.58,
      tonicWalk: "rare",
      tonicIntervals: [-5, 5],
      tonicFloor: 0.72,
      textureFloor: 0.74,
      texturePeriod: 6,
    }),
  },
  {
    id: "malone-organ",
    name: "Kali Organ",
    attribution: "Minimal pipe organ · cathedral stillness",
    hint: "Pure pipe-organ reed ranks at 5-limit intervals with the slowest chord morphs in the library. Kali Malone's Sacrificial Code — architectural, glacial, no bell character.",
    voiceLayers: ["reed", "metal"],
    voiceLevels: { reed: 1, metal: 0.12 },
    drift: 0.14,
    air: 0.5,
    time: 0.05,
    sub: 0.28,
    bloom: 0.78,
    glide: 0.55,     // very slow chord morphs — Malone's signature
    lfoShape: "sine",
    lfoRate: 0.1,
    lfoAmount: 0.03, // organs don't tremolo
    climateX: 0.32,
    climateY: 0.12,
    effects: ["hall", "tape"], // dropped plate — hall carries the space
    scale: "just5",
    gain: 1.0,
    motionProfile: motionProfile({
      climateXRange: [0.24, 0.36],
      climateYRange: [0.06, 0.16],
      bloomRange: [0.7, 0.88],
      timeRange: [0.02, 0.08],
      driftRange: [0.1, 0.18],
      subRange: [0.2, 0.34],
      macroStep: 0.32,
      tonicWalk: "none",
      tonicIntervals: [],
      tonicFloor: 1,
      textureFloor: 0.92,
      texturePeriod: 7,
    }),
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
    motionProfile: motionProfile({
      climateXRange: [0.28, 0.36],
      climateYRange: [0.03, 0.08],
      bloomRange: [0.78, 0.92],
      timeRange: [0.02, 0.05],
      driftRange: [0.04, 0.08],
      subRange: [0.12, 0.24],
      macroStep: 0.22,
      tonicWalk: "none",
      tonicIntervals: [],
      tonicFloor: 1,
      textureFloor: 0.96,
      texturePeriod: 8,
    }),
  },
  {
    id: "deep-listening",
    name: "Deep Listening",
    attribution: "Cistern reverb · attentive breathing",
    hint: "Reed and air in the deepest reverb in the library — Pauline Oliveros's Fort Worden cistern, 45-second tails. A single breath fills the whole space.",
    voiceLayers: ["reed", "air"],
    voiceLevels: { reed: 0.9, air: 0.5 },
    drift: 0.16,
    air: 0.7,        // much wetter — the cistern IS the instrument
    time: 0.05,
    sub: 0.22,
    bloom: 0.94,     // deepest bloom in the library
    glide: 0.42,
    lfoShape: "sine",
    lfoRate: 0.07,
    lfoAmount: 0.12, // breath motion
    climateX: 0.4,
    climateY: 0.16,
    effects: ["hall", "plate"],
    scale: "drone",
    gain: 1.0,
    motionProfile: motionProfile({
      climateXRange: [0.32, 0.48],
      climateYRange: [0.1, 0.22],
      bloomRange: [0.86, 0.98],
      timeRange: [0.03, 0.08],
      driftRange: [0.12, 0.22],
      subRange: [0.14, 0.3],
      macroStep: 0.5,
      tonicWalk: "rare",
      tonicIntervals: [-5, 5],
      tonicFloor: 0.7,
      textureFloor: 0.78,
      texturePeriod: 6,
    }),
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
    motionProfile: motionProfile({
      climateXRange: [0.1, 0.22],
      climateYRange: [0.05, 0.12],
      bloomRange: [0.56, 0.7],
      timeRange: [0.02, 0.06],
      driftRange: [0.05, 0.12],
      subRange: [0.46, 0.64],
      macroStep: 0.34,
      tonicWalk: "none",
      tonicIntervals: [],
      tonicFloor: 1,
      textureFloor: 0.88,
      texturePeriod: 7,
    }),
  },
  {
    id: "stars-of-the-lid",
    name: "Nitrous Oxide",
    attribution: "Orchestral swell · long grieving bloom",
    hint: "Reed + air bed with a trace of metal as high string harmonics. Slow breathing swells (~25 s period) in a deep plate/hall — the looped bowed-strings quality of Stars of the Lid, without plucks or shimmer.",
    voiceLayers: ["reed", "air", "metal"],
    voiceLevels: { reed: 1, air: 0.45, metal: 0.18 },
    drift: 0.22,
    air: 0.6,
    time: 0.06,
    sub: 0.34,
    bloom: 0.92,
    glide: 0.55,
    lfoShape: "sine",
    lfoRate: 0.04,    // ~25 s swell period — the SOTL breath
    lfoAmount: 0.24,  // strong amplitude swell — the defining feature
    climateX: 0.42,
    climateY: 0.22,
    // plate + hall only: no shimmer (wrong for SOTL), no tape — the
    // signature is dry orchestral bloom, not tape-coloured.
    effects: ["plate", "hall"],
    scale: "minor",
    gain: 0.98,
    motionProfile: motionProfile({
      climateXRange: [0.36, 0.5],
      climateYRange: [0.14, 0.3],
      bloomRange: [0.82, 0.98],
      timeRange: [0.03, 0.08],
      driftRange: [0.14, 0.3],
      subRange: [0.26, 0.42],
      macroStep: 0.72,
      tonicWalk: "rare",
      tonicIntervals: [-5, 5],
      tonicFloor: 0.58,
      textureFloor: 0.62,
      texturePeriod: 5,
    }),
  },
  {
    id: "radigue-drift",
    name: "Radig Drift",
    attribution: "Pure sine drone · microscopic motion",
    hint: "Pure reed (additive sine stack), dry, crystalline. The Éliane Radigue / ARP 2500 lineage — drift happens microscopically in the partials, the room stays close and uncoloured.",
    voiceLayers: ["reed"],
    voiceLevels: { reed: 1 },
    drift: 0.08,      // crystalline — drift is timbral, not pitch
    air: 0.35,        // drier than Deep Listening (0.7) — Radigue rooms are close
    time: 0.03,       // near-zero motion
    sub: 0.35,
    bloom: 0.95,
    glide: 0.9,       // longest glide in the library
    lfoShape: "sine",
    lfoRate: 0.04,
    lfoAmount: 0.03,
    climateX: 0.3,
    climateY: 0.12,
    // hall only — freeze caused a periodic click from captured-frame
    // looping, and Radigue's own rooms aren't cavernous anyway.
    effects: ["hall"],
    scale: "drone",
    gain: 1.1,
    motionProfile: motionProfile({
      climateXRange: [0.24, 0.34],
      climateYRange: [0.08, 0.18],
      bloomRange: [0.9, 0.98],
      timeRange: [0.02, 0.05],
      driftRange: [0.06, 0.16],
      subRange: [0.24, 0.4],
      macroStep: 0.26,
      tonicWalk: "none",
      tonicIntervals: [],
      tonicFloor: 1,
      textureFloor: 0.94,
      texturePeriod: 8,
    }),
  },
  {
    id: "eno-airport",
    name: "Terminal Airport",
    attribution: "Terminal ambience · pale bright bloom",
    hint: "Reed + air + a trace of metal, pentatonic, with the longest decays in the library. Sparse, pale-bright — the sunlit-departure-lounge feel of Brian Eno's Music for Airports.",
    voiceLayers: ["reed", "air", "metal"],
    voiceLevels: { reed: 0.85, air: 0.55, metal: 0.18 },
    drift: 0.16,
    air: 0.52,
    time: 0.08,
    sub: 0.14,
    bloom: 0.82,      // Eno's defining long decays
    glide: 0.6,
    lfoShape: "sine",
    lfoRate: 0.05,    // very slow, near-stationary
    lfoAmount: 0.06,
    climateX: 0.56,
    climateY: 0.16,
    effects: ["hall", "shimmer", "tape"],
    scale: "pentatonic",
    gain: 0.98,
    motionProfile: motionProfile({
      climateXRange: [0.48, 0.66],
      climateYRange: [0.1, 0.22],
      bloomRange: [0.74, 0.92],
      timeRange: [0.04, 0.1],
      driftRange: [0.1, 0.22],
      subRange: [0.08, 0.2],
      macroStep: 0.62,
      tonicWalk: "rare",
      tonicIntervals: [-2, 2, -5, 5],
      tonicFloor: 0.52,
      textureFloor: 0.7,
      texturePeriod: 5,
    }),
  },
  {
    id: "buddhist-monk-drone",
    name: "Low Chant",
    attribution: "Throat-singing overtone halo · low fundamental",
    hint: "Deep reed fundamental with a prominent inharmonic metal halo above — the defining overtone shimmer of Gyuto-style throat singing. Comb resonance locks the harmonics to the root.",
    voiceLayers: ["reed", "metal", "air"],
    voiceLevels: { reed: 1, metal: 0.5, air: 0.14 },
    drift: 0.1,
    air: 0.42,
    time: 0.05,
    sub: 0.58,
    bloom: 0.5,
    glide: 0.22,
    lfoShape: "sine",
    lfoRate: 0.07,
    lfoAmount: 0.05,
    climateX: 0.18,
    climateY: 0.08,
    effects: ["hall", "plate", "comb"],
    scale: "drone",
    gain: 1.08,
    motionProfile: motionProfile({
      climateXRange: [0.14, 0.22],
      climateYRange: [0.05, 0.12],
      bloomRange: [0.44, 0.58],
      timeRange: [0.03, 0.07],
      driftRange: [0.08, 0.14],
      subRange: [0.5, 0.68],
      macroStep: 0.32,
      tonicWalk: "none",
      tonicIntervals: [],
      tonicFloor: 1,
      textureFloor: 0.88,
      texturePeriod: 7,
    }),
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
    motionProfile: motionProfile({
      climateXRange: [0.28, 0.42],
      climateYRange: [0.06, 0.14],
      bloomRange: [0.32, 0.48],
      timeRange: [0.03, 0.08],
      driftRange: [0.06, 0.16],
      subRange: [0.12, 0.26],
      macroStep: 0.54,
      tonicWalk: "rare",
      tonicIntervals: [-5, 7],
      tonicFloor: 0.62,
      textureFloor: 0.74,
      texturePeriod: 6,
    }),
  },
  {
    id: "coil-time-machines",
    name: "Time Machines",
    attribution: "Ceremonial single-note trance · suspended time",
    hint: "A low single-note ritual drone with narcotic stillness. One center, deep sustain, almost no decorative movement — just the faintest tape-flange rotation.",
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
    effects: ["hall", "tape", "wow"],
    scale: "drone",
    gain: 1.1,
    motionProfile: motionProfile({
      climateXRange: [0.12, 0.2],
      climateYRange: [0.04, 0.09],
      bloomRange: [0.68, 0.88],
      timeRange: [0.02, 0.06],
      driftRange: [0.05, 0.1],
      subRange: [0.64, 0.84],
      macroStep: 0.26,
      tonicWalk: "none",
      tonicIntervals: [],
      tonicFloor: 1,
      textureFloor: 0.94,
      texturePeriod: 8,
    }),
  },
  {
    id: "nww-soliloquy",
    name: "Lilith Drift",
    attribution: "Feedback hum · no clear source",
    hint: "Pure spectral texture — air and metal drifting through comb + tape + hall, no identifiable pitched sources. Nurse With Wound's Soliloquy for Lilith.",
    voiceLayers: ["air", "metal"],
    voiceLevels: { air: 1, metal: 0.28 },
    // drift 0.34 — previously 0.55 caused the air Q-walks + metal
    // partial walks to drive the comb resonance into clipping peaks.
    // Dropping tanpura removed one source of that chaos; we can run
    // drift a touch higher than 0.28 without reintroducing the issue.
    drift: 0.34,
    air: 0.55,
    time: 0.12,
    sub: 0.12,        // kept low so comb has less LF to amplify at peak
    bloom: 0.82,
    glide: 0.55,
    lfoShape: "sine",
    lfoRate: 0.06,
    lfoAmount: 0.05,
    climateX: 0.22,
    climateY: 0.2,
    effects: ["tape", "comb", "hall"],
    scale: "drone",
    gain: 0.85,
    motionProfile: motionProfile({
      climateXRange: [0.16, 0.3],
      climateYRange: [0.12, 0.28],
      bloomRange: [0.72, 0.9],
      timeRange: [0.08, 0.18],
      driftRange: [0.22, 0.44],
      subRange: [0.04, 0.18],
      macroStep: 0.88,
      tonicWalk: "gentle",
      tonicIntervals: [-1, 1, -5, 5],
      tonicFloor: 0.44,
      textureFloor: 0.52,
      texturePeriod: 4,
    }),
  },
  {
    id: "doom-bloom",
    name: "Doom Bloom",
    attribution: "Amplifier feedback wall · slow breathing",
    hint: "Saturated reed body with a metal feedback halo — the sustained-amp pressure of drone metal (Sunn O))), Earth), swelling in slow amplitude breaths.",
    voiceLayers: ["reed", "metal"],
    voiceLevels: { reed: 1, metal: 0.45 },
    drift: 0.22,
    air: 0.32,
    time: 0.05,
    sub: 0.88,
    bloom: 0.88,
    glide: 0.22,
    lfoShape: "sine",
    lfoRate: 0.05,
    lfoAmount: 0.08, // slow swell breathing — Pyroclasts-style
    climateX: 0.1,
    climateY: 0.08,
    effects: ["hall", "tape", "sub"],
    scale: "drone",
    gain: 0.9,
    motionProfile: motionProfile({
      climateXRange: [0.06, 0.14],
      climateYRange: [0.05, 0.1],
      bloomRange: [0.8, 0.96],
      timeRange: [0.03, 0.07],
      driftRange: [0.12, 0.22],
      subRange: [0.76, 0.94],
      macroStep: 0.38,
      tonicWalk: "rare",
      tonicIntervals: [-5, 5],
      tonicFloor: 0.7,
      textureFloor: 0.8,
      texturePeriod: 6,
    }),
  },
  {
    id: "merzbient",
    name: "Merzbient",
    attribution: "Ambient-noise pressure · abrasive weather",
    hint: "Dense air texture with inharmonic metal crackle — Merzbow's ambient side. No pitched source, just spectral weather with tape wear, comb glare and freeze sustain underneath.",
    voiceLayers: ["air", "metal"],
    voiceLevels: { air: 1, metal: 0.55 },
    drift: 0.68,
    air: 0.62,
    time: 0.22,
    sub: 0.55,
    bloom: 0.55,
    glide: 0.22,
    lfoShape: "triangle",
    lfoRate: 0.18,
    lfoAmount: 0.14,
    climateX: 0.6,
    climateY: 0.5,
    // freeze removed — it captured a moment at enable time and kept
    // looping it underneath the live signal (same failure as NWW and
    // the original Radig Drift). Wow + tape + sub + comb + hall still
    // carry the dense spectral-pressure identity.
    effects: ["wow", "tape", "sub", "comb", "hall"],
    scale: "drone",
    gain: 0.75,       // perceptually very loud — slight extra cut vs. before
    motionProfile: motionProfile({
      climateXRange: [0.48, 0.72],
      climateYRange: [0.34, 0.62],
      bloomRange: [0.46, 0.64],
      timeRange: [0.12, 0.3],
      driftRange: [0.52, 0.82],
      subRange: [0.4, 0.68],
      macroStep: 1.28,
      tonicWalk: "restless",
      tonicIntervals: [-1, 1, -2, 2, -5, 5],
      tonicFloor: 0.34,
      textureFloor: 0.42,
      texturePeriod: 3,
    }),
  },
  {
    id: "windscape",
    name: "Permafrost",
    attribution: "Arctic sub drone · frozen wind field",
    hint: "Air as a wind-field texture over a deep reed rumble. Heavy sub weight, slow spectral motion, comb-tuned to the root — Thomas Köner's deep-cold stillness.",
    voiceLayers: ["air", "reed"],
    voiceLevels: { air: 1, reed: 0.25 },
    drift: 0.36,
    air: 0.52,
    time: 0.12,
    sub: 0.56,
    bloom: 0.62,
    glide: 0.32,
    lfoShape: "sine",
    lfoRate: 0.06,
    lfoAmount: 0.08,
    climateX: 0.2,
    climateY: 0.22,
    effects: ["hall", "comb", "wow", "tape"],
    scale: "drone",
    gain: 0.98,
    motionProfile: motionProfile({
      climateXRange: [0.14, 0.28],
      climateYRange: [0.14, 0.32],
      bloomRange: [0.52, 0.72],
      timeRange: [0.08, 0.18],
      driftRange: [0.26, 0.46],
      subRange: [0.44, 0.68],
      macroStep: 0.82,
      tonicWalk: "rare",
      tonicIntervals: [-5, 5],
      tonicFloor: 0.56,
      textureFloor: 0.62,
      texturePeriod: 5,
    }),
  },
];

const PRESET_MATERIAL_PROFILES: Record<string, PresetMaterialProfile> = {
  "tanpura-drone": materialProfile({
    driftBias: { tanpura: 1.08 },
    levelWobble: { tanpura: 0.012 },
    wobbleRate: 0.48,
    pluckRange: [0.94, 1.08],
    shimmerPulse: 0.02,
    subPulse: 0.02,
  }),
  "shruti-box": materialProfile({
    driftBias: { reed: 1.05 },
    levelWobble: { reed: 0.028 },
    wobbleRate: 0.62,
    subPulse: 0.07,
  }),
  "malone-organ": materialProfile({
    driftBias: { reed: 0.9, metal: 1.05 },
    levelWobble: { reed: 0.015, metal: 0.022 },
    wobbleRate: 0.42,
    pluckRange: [0.98, 1.02],
    shimmerPulse: 0.03,
    subPulse: 0.05,
  }),
  "dream-house": materialProfile({
    driftBias: { reed: 0.82, air: 0.9 },
    levelWobble: { reed: 0.008, air: 0.015 },
    wobbleRate: 0.28,
    pluckRange: [0.99, 1.01],
    shimmerPulse: 0.01,
    subPulse: 0.03,
  }),
  "deep-listening": materialProfile({
    driftBias: { reed: 0.94, air: 1.05, tanpura: 1.04 },
    levelWobble: { reed: 0.016, air: 0.022, tanpura: 0.01 },
    wobbleRate: 0.54,
    pluckRange: [0.95, 1.06],
    shimmerPulse: 0.04,
    subPulse: 0.05,
  }),
  "stone-organ": materialProfile({
    driftBias: { reed: 0.84, metal: 0.98 },
    levelWobble: { reed: 0.01, metal: 0.014 },
    wobbleRate: 0.34,
    pluckRange: [0.99, 1.02],
    shimmerPulse: 0.01,
    subPulse: 0.08,
  }),
  "stars-of-the-lid": materialProfile({
    driftBias: { tanpura: 1.1, metal: 1.18, air: 1.06 },
    levelWobble: { tanpura: 0.018, metal: 0.03, air: 0.026 },
    wobbleRate: 0.9,
    pluckRange: [0.9, 1.16],
    shimmerPulse: 0.22,
    subPulse: 0.08,
  }),
  "radigue-drift": materialProfile({
    // Pure reed stack — ultra-stable. Very small drift bias and near-zero
    // level wobble to keep Radigue's crystalline character. Any wobble in
    // the reed partials was audible as faint pulsing at 800×800.
    driftBias: { reed: 0.55 },
    levelWobble: { reed: 0.006 },
    wobbleRate: 0.25,
    shimmerPulse: 0,
    subPulse: 0,
  }),
  "eno-airport": materialProfile({
    driftBias: { reed: 1.02, air: 1.08, metal: 1.12 },
    levelWobble: { reed: 0.02, air: 0.026, metal: 0.018 },
    wobbleRate: 0.82,
    shimmerPulse: 0.18,
    subPulse: 0.05,
  }),
  "buddhist-monk-drone": materialProfile({
    driftBias: { reed: 0.9, metal: 0.96, air: 1.02 },
    levelWobble: { reed: 0.012, metal: 0.016, air: 0.018 },
    wobbleRate: 0.4,
    pluckRange: [0.98, 1.03],
    shimmerPulse: 0.04,
    subPulse: 0.09,
  }),
  "tibetan-bowl": materialProfile({
    driftBias: { metal: 1.12, air: 1.02 },
    levelWobble: { metal: 0.026, air: 0.014 },
    wobbleRate: 0.7,
    pluckRange: [0.98, 1.03],
    shimmerPulse: 0.05,
    subPulse: 0.04,
  }),
  "coil-time-machines": materialProfile({
    driftBias: { reed: 0.86, metal: 0.92, air: 0.96 },
    levelWobble: { reed: 0.008, metal: 0.01, air: 0.012 },
    wobbleRate: 0.26,
    pluckRange: [0.99, 1.01],
    shimmerPulse: 0.02,
    subPulse: 0.1,
  }),
  "nww-soliloquy": materialProfile({
    driftBias: { air: 1.2, metal: 1.08, tanpura: 1.06 },
    levelWobble: { air: 0.028, metal: 0.018, tanpura: 0.01 },
    wobbleRate: 0.78,
    pluckRange: [0.92, 1.1],
    shimmerPulse: 0.04,
    subPulse: 0.03,
  }),
  "doom-bloom": materialProfile({
    driftBias: { reed: 0.98, metal: 1.04, tanpura: 1.02 },
    levelWobble: { reed: 0.012, metal: 0.02, tanpura: 0.01 },
    wobbleRate: 0.46,
    pluckRange: [0.94, 1.07],
    shimmerPulse: 0.02,
    subPulse: 0.12,
  }),
  merzbient: materialProfile({
    driftBias: { air: 1.28, metal: 1.18, reed: 1.04 },
    levelWobble: { air: 0.04, metal: 0.028, reed: 0.016 },
    wobbleRate: 1.18,
    shimmerPulse: 0.08,
    subPulse: 0.14,
  }),
  windscape: materialProfile({
    driftBias: { air: 1.22, tanpura: 1.12 },
    levelWobble: { air: 0.034, tanpura: 0.014 },
    wobbleRate: 0.94,
    pluckRange: [0.9, 1.12],
    shimmerPulse: 0.03,
    subPulse: 0.05,
  }),
};

export function getPresetMaterialProfile(presetOrId: Preset | string | null): PresetMaterialProfile {
  if (!presetOrId) return DEFAULT_PRESET_MATERIAL_PROFILE;
  const id = typeof presetOrId === "string" ? presetOrId : presetOrId.id;
  return PRESET_MATERIAL_PROFILES[id] ?? DEFAULT_PRESET_MATERIAL_PROFILE;
}

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
    presetMorph: 0.25,
    evolve: 0,
    pluckRate: 1,
    presetTrim: preset.gain ?? 1,
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
    engine.setPresetMotionProfile(preset.motionProfile);
    engine.setPresetMaterialProfile(getPresetMaterialProfile(preset));
    engine.applyDroneScene(layers, levels, SCALE_INTERVALS[preset.scale] ?? [0]);
  }

  // Effects — turn on the listed ones, off the rest
  const active = new Set(preset.effects);
  for (const id of ALL_EFFECT_IDS) {
    ui.setEffectEnabled(id, active.has(id));
  }
}
