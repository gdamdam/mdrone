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
import type { ReedShape, VoiceType } from "./VoiceBuilder";
import { ALL_VOICE_TYPES } from "./VoiceBuilder";
import type { RelationId, ScaleId, TuningId } from "../types";
import { resolveTuning } from "../microtuning";
import type { DroneSessionSnapshot } from "../session";
import { DEFAULT_PARTNER } from "../partner";
import { DEFAULT_ENTRAIN, type EntrainState } from "../entrain";
import { sampleSubtleOffsets } from "../goodDrone";

export type PresetGroup =
  | "Sacred / Ritual"
  | "Minimal / Just"
  | "Organ / Chamber"
  | "Ambient / Cinematic"
  | "Noise / Industrial"
  | "Pulse / Studies";

export interface Preset {
  id: string;
  name: string;
  hint: string;
  /** Named inspiration / creator reference, shown in the tooltip. */
  attribution: string;
  /** Genre/lineage group for the preset grid UI. */
  group: PresetGroup;
  /** When true, the preset is still a real library entry (applicable
   *  by id, included in the material/motion tables) but is hidden
   *  from user-facing selection UI: grid, group cycle, library cycle.
   *  Used for the Welcome preset which serves only on first launch. */
  hidden?: boolean;

  voiceLayers: VoiceType[];
  voiceLevels?: Partial<Record<VoiceType, number>>;
  /** NOISE voice COLOR (0..1): white → pink → brown → deep. Defaults
   *  to the neutral pink-ish midpoint when omitted. */
  noiseColor?: number;

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

  /** Optional microtuning overrides. When both are set, the resolved
   *  intervals replace the legacy scale-based intervals. */
  tuningId?: TuningId;
  relationId?: RelationId;

  /** Optional reed voice harmonic-stack shape. Defaults to "odd". */
  reedShape?: ReedShape;
  /** FM voice modulator:carrier frequency ratio. Default 2.0 (octave bell).
   *  1.4 = gong, 3.5 = chime, 7.0 = glass bell. */
  fmRatio?: number;
  /** FM modulation index (sideband richness). Default 2.4.
   *  Higher = more metallic/complex. Lower = purer, bell-like. */
  fmIndex?: number;
  /** FM modulator self-feedback (0..1). Default 0 (classic 2-op).
   *  Higher values produce richer/grittier metallic timbres. */
  fmFeedback?: number;

  /** Resonant-comb feedback coefficient (0..0.98). Default 0.68.
   *  Lower values (0.3–0.45) tame self-amplification for presets
   *  whose FX chain otherwise pins the limiter regardless of input
   *  gain — Permafrost, Closed Doors, Sarangi. */
  combFeedback?: number;

  /** Optional preferred octave range for random-scene selection.
   *  If set, createSafeRandomScene picks an octave in [lo, hi] inclusive.
   *  Defaults to whatever the caller passes in (usually [2, 3]). */
  octaveRange?: readonly [number, number];

  /** Optional parallel reverb send levels (0..1) — run the chosen
   *  reverbs in parallel off the raw input instead of serial-only. Lets
   *  a preset have "dry voice + wet reverb" without the voice going
   *  through every earlier serial effect first. Only reverb-family
   *  effects support parallel routing. */
  parallelSends?: Partial<{ plate: number; hall: number; cistern: number }>;

  /** Optional per-preset loudness trim (A). Defaults to 1.0. Applied
   *  on top of the auto-normalization so authors can fine-tune. */
  gain?: number;

  /** Authored evolve behavior so each preset can feel alive in its own way. */
  motionProfile: PresetMotionProfile;

  /** Optional ENTRAIN (LFO 2 · FLICKER) state. When present, applying
   *  the preset enables / rates FLICKER to match the preset's band
   *  target. Omitted on presets that don't care about FLICKER — they
   *  leave the user's current FLICKER state alone. */
  entrain?: EntrainState;
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
  meantone: [0, 193.16, 310.26, 503.42, 696.58, 889.74],
  harmonics: [0, 386.31, 701.96, 968.83, 1200],
  "maqam-rast": [0, 200, 350, 500, 700, 900, 1050],
  slendro: [0, 240, 480, 720, 960],
};

/**
 * Arrival pool — presets that sound beautiful within 3 seconds at
 * the default tonic/octave. Curated for first-impression quality:
 * immediate consonance, no muddy onsets, no slow reverb build-up.
 *
 * Used by:
 *   - "Start New"   → every time
 *   - RND button    → first 3 calls per session, then falls through
 *                     to SAFE_RANDOM_PRESET_IDS for full variety
 *
 * Differences from the prior STARTUP pool: frahm-solo (too sparse
 * in 3s) and deep-listening (cistern tail needs seconds to fill)
 * were dropped in favour of marconi-weightless (instant float),
 * young-well-tuned (Young WTP lattice settles immediately), and
 * lamb-prisma (harmonic-stack triad reads as beauty on onset).
 */
export const ARRIVAL_PRESET_IDS = [
  "tanpura-drone",
  "shruti-box",
  "eno-airport",
  "malone-organ",
  "stars-of-the-lid",
  "ritual-tanpura-shruti",
  "fm-glass-bell",
  "oliveros-accordion",
  "marconi-weightless",
  "young-well-tuned",
  "lamb-prisma",
] as const;

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
  "wiese-baraka",
  "hecker-ravedeath",
  "fennesz-endless",
  "basinski-disintegration",
  "frahm-solo",
  "grouper-dragging",
  "arkbro-chords",
  "young-well-tuned",
  "lamb-prisma",
  "sotl-tired-eyes",
  "ritual-tanpura-shruti",
  "sitar-sympathy",
  "fm-glass-bell",
  "fm-gong",
  "marconi-weightless",
  "liles-closed-doors",
  "liles-submariner",
  "palestine-strumming",
  "oliveros-accordion",
  "conrad-bowed",
  "niblock-wall",
  "breath-pipe",
  "delay-vigil",
  "freeze-chamber",
  "radigue-arp",
  "fm-warm-organ",
  "noise-meditation",
  "close-room",
  "sub-chamber",
  "high-shimmer",
] as const;

/**
 * The preset library — 9 authored scenes. Each one is a reference to
 * a specific drone tradition or artist, tuned to sit at sensible
 * starting levels when you tap it. Not a "preset browser" — a small
 * curated set.
 */
export const PRESETS: Preset[] = [
  {
    id: "tanpura-drone", group: "Sacred / Ritual",
    name: "Tanpura Drone",
    attribution: "Jawari string drone · buzzing overtones",
    hint: "Lone tanpura with jawari buzz. Rooted, overtone-rich, almost dry.",
    voiceLayers: ["tanpura"],
    voiceLevels: { tanpura: 1 },
    octaveRange: [2, 2],
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
    tuningId: "just5", relationId: "tonic-fifth",
    gain: 0.74,
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
    id: "shruti-box", group: "Sacred / Ritual",
    name: "Shruti Box",
    attribution: "Indian devotional · reed bellows",
    hint: "Harmonium / shruti-box sustain. Warm, woody, slow breath in a wooden room.",
    tuningId: "just5", relationId: "tonic-fifth",
    voiceLayers: ["reed"],
    voiceLevels: { reed: 1 },
    reedShape: "balanced",
    drift: 0.18,
    air: 0.4,
    time: 0.06,
    sub: 0.22,
    bloom: 0.45,
    glide: 0.18,
    lfoShape: "sine",
    lfoRate: 0.2,    // ~5 s bellows period
    lfoAmount: 0.06, // subtle breath swell — heavier modulation read as unnatural pulsing
    climateX: 0.4,
    climateY: 0.14,
    effects: ["hall", "tape"],
    scale: "drone",
    gain: 0.4,
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
    id: "malone-organ", group: "Organ / Chamber",
    name: "Kali Organ",
    attribution: "Minimal pipe organ · meantone stillness",
    hint: "Meantone pipe-organ reed, slow chord morphs. Architectural, glacial, no bell.",
    tuningId: "meantone", relationId: "drone-triad",
    voiceLayers: ["reed"],
    voiceLevels: { reed: 1 },
    reedShape: "balanced",
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
    // Parallel hall send — cathedral space around the dry pipe source
    // without the hall coming after tape in the serial chain.
    parallelSends: { hall: 0.3 },
    scale: "meantone",
    gain: 0.34,
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
    id: "dream-house", group: "Minimal / Just",
    name: "Dream House",
    attribution: "Long-tone just-intonation · pure sines · beating intervals",
    hint: "Pure sines in 5-limit just intonation. The beating between tones is the piece.",
    tuningId: "just5", relationId: "drone-triad",
    voiceLayers: ["reed"],
    voiceLevels: { reed: 1 },
    reedShape: "sine",
    octaveRange: [2, 3],
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
    gain: 1.6,
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
    id: "deep-listening", group: "Organ / Chamber",
    name: "Deep Listening",
    attribution: "Cistern reverb · attentive breathing",
    hint: "Reed and air through a long cistern tail. One breath fills the whole space.",
    // Pythagorean reveals Oliveros's pipe-organ lineage: the single
    // breath through the cistern sits on pure 3-limit air.
    tuningId: "custom:pythagorean", relationId: "unison",
    voiceLayers: ["reed", "air"],
    voiceLevels: { reed: 0.9, air: 0.5 },
    reedShape: "balanced",
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
    // formant added — Oliveros's Deep Listening recordings include voice
    // alongside accordion and trombone; the vocal formant adds that
    // human vowel resonance to the reed-air bed.
    effects: ["cistern", "plate", "formant"],
    // Parallel cistern — the voice goes dry into the cistern bus so the
    // 28-second tail comes from raw input, not from a pre-processed
    // signal. This is the actual cistern experience.
    parallelSends: { cistern: 0.55 },
    scale: "drone",
    gain: 1.06,
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
    id: "stone-organ", group: "Organ / Chamber",
    name: "Stone Organ",
    attribution: "Dark nave organ · liturgical pressure",
    hint: "Low organ pipes, stone pressure, almost no motion. Darker and heavier than Kali Organ.",
    tuningId: "meantone", relationId: "drone-triad",
    voiceLayers: ["reed"],
    voiceLevels: { reed: 1 },
    reedShape: "balanced",
    octaveRange: [1, 2],
    drift: 0.04,
    air: 0.24,
    time: 0.02,
    sub: 0.68,
    bloom: 0.72,
    glide: 0.18,
    lfoShape: "sine",
    lfoRate: 0.05,
    lfoAmount: 0.02,
    climateX: 0.08,
    climateY: 0.04,
    effects: ["hall"],
    parallelSends: { hall: 0.22 },
    scale: "drone",
    gain: 0.64,
    motionProfile: motionProfile({
      climateXRange: [0.06, 0.14],
      climateYRange: [0.03, 0.08],
      bloomRange: [0.66, 0.8],
      timeRange: [0.01, 0.04],
      driftRange: [0.03, 0.08],
      // Keep the nave heavy, but stop evolve from leaning so hard on the
      // low end that the organ loses its pipe definition.
      subRange: [0.52, 0.68],
      macroStep: 0.24,
      tonicWalk: "none",
      tonicIntervals: [],
      tonicFloor: 1,
      textureFloor: 0.88,
      texturePeriod: 7,
    }),
  },
  {
    id: "stars-of-the-lid", group: "Ambient / Cinematic",
    name: "Nitrous Oxide",
    attribution: "Sustained minor triad · slow swells · tape body",
    hint: "Bowed-string reed + air as a sustained minor triad, slow 25 s swells. Warm tape-and-room body.",
    tuningId: "just5", relationId: "minor-triad",
    voiceLayers: ["reed", "air"],
    voiceLevels: { reed: 1, air: 0.45 },
    reedShape: "even",
    drift: 0.14,      // near-static — SOTL's looped strings don't drift
    air: 0.6,
    time: 0.06,
    sub: 0.34,
    bloom: 0.92,
    glide: 0.55,
    lfoShape: "sine",
    lfoRate: 0.04,    // ~25 s swell period — the SOTL breath
    lfoAmount: 0.18,  // strong amplitude swell but safe — ±18% around unity
    climateX: 0.42,
    climateY: 0.22,
    // plate + hall + tape: tape adds the warm low-mid recording body
    // that is audibly present on The Tired Sounds Of… and anchors the
    // string illusion. No shimmer (wrong for SOTL).
    effects: ["plate", "hall", "tape"],
    // Parallel hall send — dry voice + parallel wet reverb, so the
    // string illusion keeps its attack definition without drowning in
    // serial-routed reverb.
    parallelSends: { hall: 0.35 },
    scale: "minor",
    // gain cut to leave headroom for the amplitude swell peaks.
    gain: 0.26,
    motionProfile: motionProfile({
      climateXRange: [0.36, 0.5],
      climateYRange: [0.14, 0.3],
      bloomRange: [0.82, 0.98],
      timeRange: [0.03, 0.08],
      driftRange: [0.08, 0.18],
      subRange: [0.26, 0.42],
      macroStep: 0.58,
      tonicWalk: "rare",
      tonicIntervals: [-5, 5],
      tonicFloor: 0.58,
      textureFloor: 0.62,
      texturePeriod: 5,
    }),
  },
  {
    id: "sotl-tired-eyes", group: "Ambient / Cinematic",
    name: "Tired Eyes",
    attribution: "Degraded tape strings · funereal wow · buried cathedral",
    hint: "Cassette-dubbed bowed strings through heavy wow and tape hiss. Funereal, slow, dissolving.",
    tuningId: "just5", relationId: "minor-triad",
    voiceLayers: ["reed", "air"],
    voiceLevels: { reed: 1, air: 0.35 },
    reedShape: "even",
    octaveRange: [2, 3],
    drift: 0.1,
    air: 0.45,
    time: 0.02,       // barely moving
    sub: 0.32,        // heavier low end than Nitrous Oxide
    bloom: 0.98,
    glide: 0.75,
    lfoShape: "sine",
    lfoRate: 0.018,
    lfoAmount: 0.2,   // stronger swell — the tape stretches
    climateX: 0.18,   // dark but not buried — cathedral still reads through hiss
    climateY: 0.24,   // more wow flutter
    // SOTL tape wear is CONTINUOUS (wow, saturation, HF loss) — NOT
    // fragmented grain drop-outs. Graincloud belongs on Basinski, not
    // here. Differentiation from stars-of-the-lid: heavier wow, longer
    // lfo swell, darker climate, lower gain.
    effects: ["tape", "wow", "hall"],
    parallelSends: { hall: 0.35 },
    scale: "minor",
    gain: 0.32,
    motionProfile: motionProfile({
      climateXRange: [0.26, 0.38],
      climateYRange: [0.08, 0.18],
      bloomRange: [0.92, 0.99],
      timeRange: [0.02, 0.05],
      driftRange: [0.04, 0.1],
      subRange: [0.15, 0.28],
      macroStep: 0.35,
      tonicWalk: "none",
      tonicIntervals: [],
      tonicFloor: 1,
      textureFloor: 0.82,
      texturePeriod: 8,
    }),
  },
  {
    id: "ritual-tanpura-shruti", group: "Sacred / Ritual",
    name: "Ritual Room",
    attribution: "Tanpura + shruti · sacred drone bed",
    hint: "Tanpura plucks under a shruti-box reed organ, tonic + fifth. Warm practice-room feel.",
    tuningId: "just5", relationId: "tonic-fifth",
    voiceLayers: ["tanpura", "reed"],
    voiceLevels: { tanpura: 1, reed: 0.7 },
    reedShape: "odd",
    octaveRange: [2, 3],
    drift: 0.15,
    air: 0.4,
    time: 0.06,
    sub: 0.18,
    bloom: 0.6,
    glide: 0.3,
    lfoShape: "sine",
    lfoRate: 0.04,
    lfoAmount: 0.05,
    climateX: 0.42,
    climateY: 0.2,
    effects: ["plate"],
    parallelSends: { plate: 0.3 },
    scale: "drone",
    gain: 0.88,
    motionProfile: motionProfile({
      climateXRange: [0.35, 0.52],
      climateYRange: [0.12, 0.28],
      bloomRange: [0.5, 0.72],
      timeRange: [0.04, 0.1],
      driftRange: [0.1, 0.22],
      subRange: [0.12, 0.24],
      macroStep: 0.45,
      tonicWalk: "none",
      tonicFloor: 0.8,
      textureFloor: 0.7,
      texturePeriod: 7,
    }),
  },
  {
    id: "sitar-sympathy", group: "Sacred / Ritual",
    name: "Sitar Sympathy",
    attribution: "Sympathetic-string sitar · jawari shimmer",
    hint: "Bright tanpura strings with a metallic sympathetic halo. Jawari buzz and upper-harmonic sparkle.",
    tuningId: "just5", relationId: "tonic-fifth",
    voiceLayers: ["tanpura", "metal"],
    voiceLevels: { tanpura: 1, metal: 0.35 },
    octaveRange: [2, 3],
    drift: 0.22,
    air: 0.48,
    time: 0.1,
    sub: 0.08,
    bloom: 0.55,
    glide: 0.2,
    lfoShape: "sine",
    lfoRate: 0.08,
    lfoAmount: 0.05,
    climateX: 0.56,   // brighter than tanpura-drone (0.42)
    climateY: 0.16,
    effects: ["plate", "shimmer"],
    parallelSends: { plate: 0.25 },
    scale: "drone",
    gain: 0.99,
    motionProfile: motionProfile({
      climateXRange: [0.48, 0.64],
      climateYRange: [0.1, 0.22],
      bloomRange: [0.45, 0.65],
      timeRange: [0.06, 0.14],
      driftRange: [0.16, 0.3],
      subRange: [0, 0.12],
      macroStep: 0.42,
      tonicWalk: "none",
      tonicIntervals: [],
      tonicFloor: 1,
      textureFloor: 0.82,
      texturePeriod: 7,
    }),
  },
  {
    id: "radigue-drift", group: "Minimal / Just",
    name: "Radig Drift",
    attribution: "Pure sine drone · microscopic motion",
    hint: "Single sine tone in a close, uncoloured room. Microscopic drift only.",
    tuningId: "harmonics", relationId: "harmonic-stack",
    voiceLayers: ["reed"],
    voiceLevels: { reed: 1 },
    reedShape: "sine",
    drift: 0.14,      // raised — detune between harmonic-stack intervals
                      // produces the subliminal beating that defines Radigue
    air: 0.35,        // drier than Deep Listening (0.7) — Radigue rooms are close
    time: 0.03,       // near-zero motion
    sub: 0.35,
    bloom: 0.95,
    glide: 0.9,       // longest glide in the library
    lfoShape: "sine",
    lfoRate: 0.04,
    lfoAmount: 0.06,  // subtle gain breathing — filter-routed LFO deferred
                      // pending audition of the new FX stack (see
                      // misc/2026-04-19-preset-roadmap.md Sprint 3)
    climateX: 0.3,
    climateY: 0.12,
    // Plate adds a very close room behind the sine stack; hall in
    // parallel for depth.
    effects: ["plate"],
    parallelSends: { hall: 0.22, plate: 0.25 },
    scale: "drone",
    gain: 1.09,
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
    id: "eno-airport", group: "Ambient / Cinematic",
    name: "Terminal Airport",
    attribution: "Pure 5-limit ambient · piano + tape pad",
    hint: "Sparse piano over a soft reed pad in 5-limit tuning. Bright, spacious, silent between tones.",
    tuningId: "just5", relationId: "drone-triad",
    voiceLayers: ["piano", "reed"],
    voiceLevels: { piano: 1, reed: 0.5 },
    reedShape: "even",
    octaveRange: [3, 5],
    drift: 0.04,       // near-static — tape loops don't drift
    air: 0.35,         // bright hall but not drenched
    time: 0.01,
    sub: 0,
    bloom: 0.35,       // short bloom — tones appear quickly, fade slowly
    glide: 0.6,
    lfoShape: "sine",
    lfoRate: 0.015,
    lfoAmount: 0.01,   // almost nothing
    climateX: 0.55,    // bright — sunlit departure lounge
    climateY: 0.04,
    // Piano attacks must stay legible; plate serial + hall parallel
    // gives reed pad a sheen without swallowing the piano.
    effects: ["plate", "tape"],
    parallelSends: { hall: 0.42, plate: 0.28 },
    // just5 instead of pentatonic: pentatonic's M2 (200¢) beats against
    // the root and 5th. just5 is root + 5-limit major 3rd + 5th — fully
    // consonant, beating-free, warm.
    scale: "just5",
    gain: 1.02,
    motionProfile: motionProfile({
      climateXRange: [0.48, 0.58],
      climateYRange: [0.04, 0.12],
      bloomRange: [0.36, 0.58],
      timeRange: [0.01, 0.04],
      driftRange: [0.05, 0.1],
      subRange: [0.02, 0.08],
      macroStep: 0.32,
      tonicWalk: "rare",
      tonicIntervals: [-5, 5],
      tonicFloor: 0.64,
      textureFloor: 0.84,
      texturePeriod: 7,
    }),
  },
  {
    id: "buddhist-monk-drone", group: "Sacred / Ritual",
    name: "Low Chant",
    attribution: "Throat-singing overtone halo · low fundamental",
    hint: "Deep reed fundamental with an inharmonic metal halo. Gyuto-style throat-sing shimmer.",
    tuningId: "equal", relationId: "unison",
    voiceLayers: ["reed", "metal", "amp"],
    // Metal (inharmonic overtone halo) is the defining Gyuto-style
    // character — push it forward; reed is support, not the lead.
    // Prior balance read as harmonium, not throat chant.
    voiceLevels: { reed: 0.6, metal: 0.85, amp: 0.2 },
    octaveRange: [1, 2],
    drift: 0.14,
    air: 0.38,
    time: 0.04,
    sub: 0.48,        // deep fundamental — throat singing lives here
    bloom: 0.55,
    glide: 0.22,
    lfoShape: "sine",
    lfoRate: 0.06,
    lfoAmount: 0.04,
    climateX: 0.2,
    climateY: 0.08,
    // Formant for vocal resonance, hall for monastery space.
    // No comb — it caused harshness at high sub levels.
    effects: ["formant"],
    parallelSends: { hall: 0.45 },
    scale: "drone",
    gain: 0.92,
    motionProfile: motionProfile({
      climateXRange: [0.14, 0.22],
      climateYRange: [0.05, 0.12],
      bloomRange: [0.44, 0.58],
      timeRange: [0.03, 0.07],
      driftRange: [0.08, 0.14],
      // sub capped below the comb "safe" ceiling — buddhist-monk has
      // comb in its FX chain, so sub walking high would drive the
      // 0.85 feedback loop into clipping peaks.
      subRange: [0.32, 0.46],
      macroStep: 0.3,
      tonicWalk: "none",
      tonicIntervals: [],
      tonicFloor: 1,
      textureFloor: 0.88,
      texturePeriod: 7,
    }),
  },
  {
    id: "tibetan-bowl", group: "Sacred / Ritual",
    name: "Tibetan Bowl",
    attribution: "Ritual metal · singing bowl",
    hint: "Metal-bowl modes over a low sine reed. Circular and resonant, not a bright bell.",
    tuningId: "harmonics", relationId: "unison",
    voiceLayers: ["metal", "reed"],
    voiceLevels: { metal: 1, reed: 0.22 },
    octaveRange: [3, 4],
    // Sine reed gives the continuous low fundamental that real bowls
    // have from their rim-friction excitation. Replaces the previous
    // gain-compensation hack.
    reedShape: "sine",
    drift: 0.08,      // tamer drift so metal modes don't wander quiet
    air: 0.5,
    time: 0.06,
    sub: 0.42,
    bloom: 0.4,
    glide: 0.18,
    lfoShape: "sine",
    lfoRate: 0.09,
    lfoAmount: 0.04,
    climateX: 0.36,
    climateY: 0.1,
    effects: ["plate", "hall", "sub"],
    scale: "drone",
    // Lower gain than before because the sine-reed bed provides the
    // continuous fundamental that was previously faked with gain 1.5.
    gain: 0.91,
    motionProfile: motionProfile({
      climateXRange: [0.28, 0.42],
      climateYRange: [0.06, 0.14],
      bloomRange: [0.32, 0.48],
      timeRange: [0.03, 0.08],
      driftRange: [0.06, 0.16],
      // sub walk kept around the new static value (0.5). Prevents evolve
      // from dipping the bowl back into inaudibility while capping at 0.6
      // to leave headroom under the sub-effect saturator.
      subRange: [0.38, 0.6],
      macroStep: 0.5,
      tonicWalk: "rare",
      tonicIntervals: [-5, 7],
      tonicFloor: 0.62,
      textureFloor: 0.74,
      texturePeriod: 6,
    }),
  },
  {
    id: "coil-time-machines", group: "Sacred / Ritual",
    name: "Time Machines",
    attribution: "Ceremonial analog drone · detuned oscillator stack",
    hint: "Detuned analog-style drone, cabinet body, tape warmth. Hypnotic, narcotic.",
    // Kirnberger III: well-tempered keyboard warmth inside the tape hiss.
    tuningId: "custom:kirnberger-iii", relationId: "unison",
    voiceLayers: ["reed", "amp"],
    voiceLevels: { reed: 1.0, amp: 0.35 },
    reedShape: "odd",
    octaveRange: [1, 2],
    drift: 0.22,       // analog-oscillator detune between partials is the signature
    air: 0.25,         // dry — Coil's studios were close
    time: 0.03,        // near-static
    sub: 0.55,         // felt, not dominant
    bloom: 0.88,
    glide: 0.7,        // very slow
    lfoShape: "sine",
    lfoRate: 0.03,     // ~33 s — glacial breath
    lfoAmount: 0.05,
    climateX: 0.18,    // dark/warm
    climateY: 0.06,
    // Tape + wow serial = analog warmth + subtle pitch drift; parallel
    // hall keeps the ritual-chamber distance quiet so the source stays
    // in the foreground.
    effects: ["tape", "wow"],
    parallelSends: { hall: 0.28 },
    scale: "drone",
    gain: 0.19,
    motionProfile: motionProfile({
      climateXRange: [0.14, 0.22],
      climateYRange: [0.04, 0.1],
      bloomRange: [0.82, 0.94],
      timeRange: [0.02, 0.05],
      driftRange: [0.18, 0.28],
      subRange: [0.48, 0.62],
      macroStep: 0.22,
      tonicWalk: "none",
      tonicIntervals: [],
      tonicFloor: 1,
      textureFloor: 0.92,
      texturePeriod: 8,
    }),
  },
  // ─── FM showcase: Glass Bell — high-ratio FM bell drone ─────────────
  {
    id: "fm-glass-bell", group: "Minimal / Just",
    name: "Glass Bell",
    attribution: "FM bell · crystalline inharmonic overtones",
    hint: "Dense inharmonic bell sidebands from high-index FM. Metallic, bright, slowly breathing.",
    tuningId: "harmonics", relationId: "tonic-fifth",
    voiceLayers: ["fm", "air"],
    voiceLevels: { fm: 1, air: 0.15 },
    fmRatio: 3.5,
    fmIndex: 4.5,
    octaveRange: [3, 4],
    drift: 0.06,
    air: 0.11,
    time: 0.05,
    sub: 0.1,
    bloom: 0.65,
    glide: 0.4,
    lfoShape: "sine",
    lfoRate: 0.04,
    lfoAmount: 0.04,
    climateX: 0.6,
    climateY: 0.15,
    effects: ["plate", "hall"],
    parallelSends: { plate: 0.3, hall: 0.2 },
    scale: "drone",
    gain: 1.6,
    motionProfile: motionProfile({
      climateXRange: [0.5, 0.7],
      climateYRange: [0.1, 0.22],
      bloomRange: [0.55, 0.75],
      timeRange: [0.03, 0.08],
      driftRange: [0.04, 0.1],
      subRange: [0.08, 0.16],
      macroStep: 0.32,
      tonicWalk: "none",
      tonicFloor: 0.9,
      textureFloor: 0.8,
      texturePeriod: 7,
    }),
  },

  // ─── FM showcase: Gong Meditation — low-ratio FM gong drone ────────
  {
    id: "fm-gong", group: "Sacred / Ritual",
    name: "Gong Meditation",
    attribution: "FM gong · bronze resonance · deep space",
    hint: "Deep gong tones from low-ratio FM with metal-bowl partials. Bronze ensemble in a temple hall.",
    tuningId: "just5", relationId: "unison",
    voiceLayers: ["fm", "metal"],
    voiceLevels: { fm: 1, metal: 0.4 },
    fmRatio: 1.4,
    octaveRange: [1, 2],
    drift: 0.18,
    air: 0.5,
    time: 0.06,
    sub: 0.35,
    bloom: 0.75,
    glide: 0.35,
    lfoShape: "sine",
    lfoRate: 0.05,
    lfoAmount: 0.06,
    climateX: 0.35,
    climateY: 0.18,
    effects: ["hall"],
    parallelSends: { hall: 0.4 },
    scale: "drone",
    gain: 1.12,
    motionProfile: motionProfile({
      climateXRange: [0.28, 0.42],
      climateYRange: [0.12, 0.26],
      bloomRange: [0.65, 0.85],
      timeRange: [0.04, 0.1],
      driftRange: [0.14, 0.24],
      subRange: [0.25, 0.42],
      macroStep: 0.4,
      tonicWalk: "none",
      tonicFloor: 0.85,
      textureFloor: 0.78,
      texturePeriod: 7,
    }),
  },

  {
    id: "nww-soliloquy", group: "Noise / Industrial",
    name: "Lilith Drift",
    attribution: "Feedback hum · no clear source",
    hint: "Air and metal drifting through comb, tape and hall. Pure spectral texture, no pitched source.",
    // Skewed Pythagorean: seeded detune turns the "no clear source"
    // feedback hum into living, slowly-beating partials.
    tuningId: "custom:skewed-pythagorean", relationId: "unison",
    voiceLayers: ["air", "metal", "noise"],
    voiceLevels: { air: 1, metal: 0.24, noise: 0.18 },
    // Brown-leaning noise bed — adds the sub-audible hiss of a
    // room mic picking up the feedback chain; stays under comb's
    // safe threshold (see drift/sub caps below).
    noiseColor: 0.6,
    // drift 0.26 — sits just under the 0.28 "safe comb" threshold. At
    // 0.34 the metal partial walks were still close enough to drive the
    // comb's 0.85 feedback into clipping peaks. Historically the author
    // noted drift 0.55 originally caused the same failure.
    drift: 0.26,
    air: 0.48,        // trimmed — less wet into hall = less feedback pressure
    time: 0.09,
    sub: 0.1,         // extra low so comb has minimal LF to amplify at peak
    bloom: 0.82,
    glide: 0.55,
    lfoShape: "sine",
    lfoRate: 0.06,
    lfoAmount: 0.05,
    climateX: 0.22,
    climateY: 0.2,
    // ringmod adds the inharmonic scrape NWW's Soliloquy has from their
    // no-input mixer / ring-modulator feedback chain.
    effects: ["tape", "comb", "hall", "ringmod"],
    scale: "drone",
    gain: 0.48,
    motionProfile: motionProfile({
      climateXRange: [0.16, 0.3],
      climateYRange: [0.12, 0.28],
      bloomRange: [0.72, 0.9],
      timeRange: [0.06, 0.12],
      // drift capped at 0.28 — the "safe comb" ceiling. Previously 0.44
      // let evolve walk drift straight into clipping territory.
      driftRange: [0.18, 0.28],
      subRange: [0.04, 0.14],
      macroStep: 0.72,
      tonicWalk: "gentle",
      tonicIntervals: [-1, 1, -5, 5],
      tonicFloor: 0.44,
      textureFloor: 0.52,
      texturePeriod: 4,
    }),
  },
  {
    id: "doom-bloom", group: "Noise / Industrial",
    name: "Doom Bloom",
    attribution: "Amplifier feedback wall · slow breathing",
    hint: "Distorted amp sustain, reed body, metallic feedback halo. Slow breaths, drone-metal pressure.",
    tuningId: "equal", relationId: "tonic-fifth",
    voiceLayers: ["amp", "reed", "metal"],
    voiceLevels: { amp: 1, reed: 0.4, metal: 0.3 },
    octaveRange: [1, 2],
    drift: 0.22,
    air: 0.32,
    time: 0.05,
    // sub macro 0.88 was pushing the sub-effect saturator way past the
    // breaking point — doom character wants pressure, not collapse.
    sub: 0.72,
    bloom: 0.88,
    glide: 0.22,
    lfoShape: "sine",
    lfoRate: 0.05,
    lfoAmount: 0.08, // slow swell breathing — Pyroclasts-style
    climateX: 0.1,
    climateY: 0.08,
    effects: ["hall", "tape", "sub"],
    scale: "drone",
    gain: 0.13,
    motionProfile: motionProfile({
      climateXRange: [0.06, 0.14],
      climateYRange: [0.05, 0.1],
      bloomRange: [0.8, 0.96],
      timeRange: [0.03, 0.07],
      driftRange: [0.12, 0.22],
      // sub effect saturator is ON — walking sub past ~0.8 pushes the
      // waveshaper past its stable zone and "destroys" the sound.
      subRange: [0.56, 0.78],
      macroStep: 0.32,
      tonicWalk: "rare",
      tonicIntervals: [-5, 5],
      tonicFloor: 0.7,
      textureFloor: 0.8,
      texturePeriod: 6,
    }),
  },
  {
    id: "merzbient", group: "Noise / Industrial",
    name: "Merzbient",
    attribution: "Ambient-noise pressure · abrasive weather",
    hint: "Dense air with inharmonic metal crackle. Spectral weather, tape wear, comb glare.",
    tuningId: "equal", relationId: "unison",
    voiceLayers: ["air", "metal", "noise"],
    voiceLevels: { air: 1, metal: 0.55, noise: 0.26 },
    // Pink-ish noise with a brown tilt — pressure and body, not
    // hiss. Kept moderate so the ringmod + comb chain doesn't
    // glare (sub/drift are already capped for the same reason).
    noiseColor: 0.45,
    drift: 0.38,      // lower — less Q-walk wobble
    air: 0.58,
    time: 0.14,       // slower motion
    sub: 0.28,        // trimmed — less LF into comb feedback
    bloom: 0.55,
    glide: 0.22,
    lfoShape: "sine",
    lfoRate: 0.1,
    lfoAmount: 0.06,  // was 0.14 triangle — too much amplitude pumping
    climateX: 0.6,
    climateY: 0.5,
    // freeze removed — it captured a moment at enable time and kept
    // looping it underneath the live signal (same failure as NWW and
    // the original Radig Drift). Wow + tape + sub + comb + hall carry
    // the dense spectral-pressure identity. Ringmod + granular add the
    // inharmonic scrape and stretched-loop quality of Merzbow's noise
    // collage method.
    // Shortened from 6 serial to 4 — ringmod + comb carry the noise
    // pressure, hall via parallel send preserves source energy.
    effects: ["tape", "comb", "ringmod"],
    parallelSends: { hall: 0.35 },
    scale: "drone",
    gain: 0.47,
    motionProfile: motionProfile({
      climateXRange: [0.48, 0.72],
      climateYRange: [0.34, 0.62],
      bloomRange: [0.46, 0.64],
      timeRange: [0.12, 0.3],
      // drift + sub capped so evolve can't walk them into comb's
      // clipping zone (same safe pattern as nww/permafrost).
      driftRange: [0.36, 0.56],
      subRange: [0.22, 0.38],
      macroStep: 1.1,
      tonicWalk: "restless",
      tonicIntervals: [-1, 1, -2, 2, -5, 5],
      tonicFloor: 0.34,
      textureFloor: 0.42,
      texturePeriod: 3,
    }),
  },
  {
    id: "windscape", group: "Noise / Industrial",
    name: "Permafrost",
    attribution: "Arctic wind field · cold resonance",
    hint: "Wind-field air over a soft reed rumble. Frozen howl, worn tape edge.",
    tuningId: "equal", relationId: "tonic-fourth",
    voiceLayers: ["air", "reed"],
    voiceLevels: { air: 1, reed: 0.22 },
    octaveRange: [1, 2],
    // drift + sub deliberately held below the "safe comb" threshold
    // (same pattern as nww-soliloquy). Going higher walks the reed
    // partials straight into the comb's resonant peak and clips the chain.
    drift: 0.22,
    air: 0.5,
    time: 0.12,
    sub: 0.2,
    bloom: 0.6,
    glide: 0.32,
    lfoShape: "sine",
    lfoRate: 0.06,
    lfoAmount: 0.06,
    climateX: 0.22,
    climateY: 0.22,
    // granular adds Köner's time-stretched field-recording character
    // on top of the wind/comb/tape weather texture.
    combFeedback: 0.4,
    effects: ["hall", "comb", "wow", "tape", "granular"],
    scale: "drone",
    gain: 0.5,
    motionProfile: motionProfile({
      climateXRange: [0.16, 0.3],
      climateYRange: [0.14, 0.32],
      bloomRange: [0.5, 0.7],
      timeRange: [0.08, 0.18],
      driftRange: [0.14, 0.28],
      subRange: [0.1, 0.26],
      macroStep: 0.78,
      tonicWalk: "rare",
      tonicIntervals: [-5, 5],
      tonicFloor: 0.56,
      textureFloor: 0.62,
      texturePeriod: 5,
    }),
  },

  // ─── Klaus Wiese — ritual bowl + tanpura cloud ──────────────────────
  {
    id: "wiese-baraka", group: "Sacred / Ritual",
    name: "Sevenfold",
    attribution: "Layered bowls + tanpura · ritual stillness",
    hint: "Tanpura + metal-bowl cloud in a long hall. Extreme stillness, almost no motion.",
    tuningId: "harmonics", relationId: "harmonic-stack",
    voiceLayers: ["tanpura", "metal", "air"],
    voiceLevels: { tanpura: 1, metal: 0.62, air: 0.16 },
    drift: 0.08,
    air: 0.5,
    time: 0.04,
    sub: 0.38,
    bloom: 0.75,
    glide: 0.5,
    lfoShape: "sine",
    lfoRate: 0.05,
    lfoAmount: 0.03,
    climateX: 0.28,
    climateY: 0.12,
    effects: ["plate", "hall", "sub"],
    scale: "drone",
    gain: 0.76,
    motionProfile: motionProfile({
      climateXRange: [0.22, 0.32],
      climateYRange: [0.08, 0.16],
      bloomRange: [0.68, 0.82],
      timeRange: [0.02, 0.06],
      driftRange: [0.06, 0.12],
      subRange: [0.3, 0.46],
      macroStep: 0.3,
      tonicWalk: "none",
      tonicIntervals: [],
      tonicFloor: 1,
      textureFloor: 0.9,
      texturePeriod: 7,
    }),
  },

  // ─── Tim Hecker — Ravedeath: distorted granular organ ───────────────
  {
    id: "hecker-ravedeath", group: "Noise / Industrial",
    name: "Ravedeath",
    attribution: "Distorted pipe organ · church compression",
    hint: "Distorted pipe organ through hall, granular stutter on top. A church organ pushed to breaking.",
    tuningId: "equal", relationId: "minor-triad",
    voiceLayers: ["reed", "amp"],
    voiceLevels: { reed: 1, amp: 0.35 },
    reedShape: "balanced",
    drift: 0.14,
    air: 0.52,
    time: 0.07,
    sub: 0.32,
    bloom: 0.82,
    glide: 0.5,
    lfoShape: "sine",
    lfoRate: 0.05,
    lfoAmount: 0.06,
    climateX: 0.3,
    climateY: 0.2,
    // tape + hall, plus graincloud for the fragmented organ stutter.
    // No plate (redundant with hall — Hecker recorded in one church,
    // one room). Parallel hall for dry organ attack + wet reverb tail.
    effects: ["tape", "hall", "graincloud"],
    parallelSends: { hall: 0.35 },
    scale: "minor",
    gain: 0.27,
    motionProfile: motionProfile({
      climateXRange: [0.3, 0.44],
      climateYRange: [0.16, 0.3],
      bloomRange: [0.72, 0.9],
      timeRange: [0.06, 0.14],
      driftRange: [0.12, 0.26],
      subRange: [0.22, 0.38],
      macroStep: 0.58,
      tonicWalk: "rare",
      tonicIntervals: [-5, 5],
      tonicFloor: 0.58,
      textureFloor: 0.68,
      texturePeriod: 5,
    }),
  },
  // ─── Andrew Liles — dark tape-warped drone (industrial facet) ───────
  {
    id: "liles-closed-doors", group: "Noise / Industrial",
    name: "Closed Doors",
    attribution: "Tape-warped reed + metal · deep chamber · unheimlich drift",
    hint: "Tape-warped reed, metal and air with heavy wow and granular cloud. Tonal but unheimlich.",
    tuningId: "just5", relationId: "tonic-fifth",
    voiceLayers: ["reed", "metal", "air", "noise"],
    voiceLevels: { reed: 1, metal: 0.32, air: 0.3, noise: 0.2 },
    // Deep-brown floor — reads as cistern air under the reed,
    // reinforcing the closed-chamber dread without competing
    // with the granular cloud up top.
    noiseColor: 0.78,
    reedShape: "odd",
    octaveRange: [2, 3],
    drift: 0.38,       // tape warp + metal partial wander
    air: 0.42,         // was 0.6 — additive reverbs + cistern on
                       // serial were reading as a wall of wash
    time: 0.08,
    sub: 0.36,
    bloom: 0.86,
    glide: 0.55,
    lfoShape: "sine",
    lfoRate: 0.05,     // ~20 s — unsettling rather than restful
    lfoAmount: 0.14,
    climateX: 0.32,    // cold
    climateY: 0.24,    // dim
    // Cistern carries the deep-chamber body; the previous
    // parallelSends.cistern was double-verb on top of the serial
    // insert. Removed — the additive serial cistern already
    // preserves dry + wet cleanly.
    combFeedback: 0.4,
    effects: ["tape", "wow", "comb", "cistern", "granular"],
    scale: "minor",
    gain: 0.5,
    motionProfile: motionProfile({
      climateXRange: [0.26, 0.4],
      climateYRange: [0.18, 0.32],
      bloomRange: [0.78, 0.92],
      timeRange: [0.05, 0.14],
      driftRange: [0.28, 0.48],
      subRange: [0.26, 0.44],
      macroStep: 0.62,
      // chromatic sideways — the Liles half-step slide-to-wrong-place
      tonicWalk: "rare",
      tonicIntervals: [-1, 1],
      tonicFloor: 0.52,
      textureFloor: 0.6,
      texturePeriod: 4,
    }),
  },

  // ─── Fennesz — processed granular harmonic stack ────────────────────
  {
    id: "fennesz-endless", group: "Ambient / Cinematic",
    name: "Endless Summer",
    attribution: "Warm continuous guitar smear · golden haze",
    hint: "Guitar-like reed with an air halo, long bloom through tape and graincloud. Warm melodic smear under grain shimmer.",
    // Kirnberger III warms the held triad — tempered key colour
    // rather than flat 12-TET equal.
    tuningId: "custom:kirnberger-iii", relationId: "drone-triad",
    voiceLayers: ["reed", "air"],
    voiceLevels: { reed: 1, air: 0.3 },
    reedShape: "even",
    octaveRange: [3, 4],
    drift: 0.08,       // very stable — Fennesz holds chords, doesn't drift
    air: 0.58,         // wet into the reverbs
    time: 0.04,        // near-static
    sub: 0.14,
    bloom: 0.88,       // long bloom — the "smear" comes from reverb sustain
    glide: 0.6,        // slow chord morphs
    lfoShape: "sine",
    lfoRate: 0.04,     // very slow
    lfoAmount: 0.03,   // near-zero — no amplitude wobble
    climateX: 0.46,
    climateY: 0.18,
    // graincloud added now that the per-channel envelope-sum norm +
    // pitch-quantisation eliminated the rhythmic wobble — Fennesz's
    // actual sound IS grain-based laptop processing on top of the
    // continuous reed smear, and quantised grains stay tonal with
    // the drone chord.
    // Keep the tape body + grain shimmer in the serial path, but move
    // the big spaces parallel so the source doesn't disappear into wet.
    effects: ["tape", "graincloud"],
    parallelSends: { plate: 0.24, hall: 0.22 },
    scale: "major",
    gain: 0.6,
    motionProfile: motionProfile({
      climateXRange: [0.48, 0.64],
      climateYRange: [0.2, 0.36],
      bloomRange: [0.6, 0.82],
      timeRange: [0.06, 0.14],
      driftRange: [0.16, 0.3],
      subRange: [0.12, 0.24],
      macroStep: 0.7,
      tonicWalk: "rare",
      tonicIntervals: [-5, 5, 7],
      tonicFloor: 0.54,
      textureFloor: 0.64,
      texturePeriod: 4,
    }),
  },
  // ─── William Basinski — Disintegration Loops ────────────────────────
  {
    id: "basinski-disintegration", group: "Ambient / Cinematic",
    name: "Disintegration",
    attribution: "Decaying tape loop · oxide crumble",
    hint: "Reed and amp hum as the source; tape, wow and graincloud as the crumbling medium. Dry, close-miked.",
    // Skewed Pythagorean IS tape decay: the seeded detune reads as
    // oxide crumble on what would otherwise be a stable triad.
    tuningId: "custom:skewed-pythagorean", relationId: "drone-triad",
    voiceLayers: ["reed", "amp"],
    voiceLevels: { reed: 0.5, amp: 0.15 },
    reedShape: "balanced",
    drift: 0.10,
    air: 0.25,        // dry — DL is close-miked studio
    time: 0.03,
    sub: 0.24,
    bloom: 0.88,
    glide: 0.5,
    lfoShape: "sine",
    lfoRate: 0.035,
    lfoAmount: 0.02,
    climateX: 0.16,   // very dark — oxide shedding kills highs first
    climateY: 0.18,   // moderated wow — "even" + heavy wow was reading as
                      // saturated noise, not degradation
    // tape + wow = the oxide crumble; graincloud adds the fragmented
    // tape-loop drop-outs that are a Disintegration Loops signature.
    // NOT freeze: FREEZE captures a moment at load and loops it under
    // the live signal — "works on load, wrong over time" trap.
    effects: ["tape", "wow", "graincloud"],
    scale: "major",   // DL sits in ambiguous bright-melancholy, not minor
    gain: 0.36,
    motionProfile: motionProfile({
      climateXRange: [0.26, 0.38],
      climateYRange: [0.12, 0.24],
      bloomRange: [0.78, 0.94],
      timeRange: [0.04, 0.1],
      driftRange: [0.12, 0.22],
      subRange: [0.22, 0.38],
      macroStep: 0.52,
      tonicWalk: "rare",
      tonicIntervals: [-5, 5],
      tonicFloor: 0.6,
      textureFloor: 0.7,
      texturePeriod: 5,
    }),
  },
  // ─── Nils Frahm — solo piano drone ──────────────────────────────────
  {
    id: "frahm-solo", group: "Ambient / Cinematic",
    name: "Solo",
    attribution: "Felt piano in vast space · sparse intimacy",
    hint: "Solo piano in a large reverberant room. Sparse and intimate, notes dissolving into space.",
    // Kirnberger III: felted piano sits naturally on Bach-era
    // well-temperament rather than flat 12-TET.
    tuningId: "custom:kirnberger-iii", relationId: "minor-triad",
    voiceLayers: ["piano"],
    voiceLevels: { piano: 1 },
    parallelSends: { hall: 0.45, plate: 0.2 },
    octaveRange: [3, 4],
    drift: 0.04,
    air: 0.5,         // wetter — the space is the instrument
    time: 0.02,
    sub: 0.08,
    bloom: 0.42,       // shorter bloom — notes appear, not sustain
    glide: 0.3,
    lfoShape: "sine",
    lfoRate: 0.03,
    lfoAmount: 0.02,
    climateX: 0.38,
    climateY: 0.06,
    effects: ["hall", "plate", "tape"],
    scale: "minor",
    gain: 0.7,
    motionProfile: motionProfile({
      climateXRange: [0.3, 0.38],
      climateYRange: [0.04, 0.1],
      bloomRange: [0.44, 0.62],
      timeRange: [0.02, 0.05],
      driftRange: [0.04, 0.08],
      subRange: [0.08, 0.16],
      macroStep: 0.26,
      tonicWalk: "rare",
      tonicIntervals: [-5, 5],
      tonicFloor: 0.74,
      textureFloor: 0.84,
      texturePeriod: 7,
    }),
  },

  // ─── Grouper — Dragging a Dead Deer Up a Hill ───────────────────────
  {
    id: "grouper-dragging", group: "Ambient / Cinematic",
    name: "Dragging",
    attribution: "Lo-fi piano + air · tape wear",
    hint: "Lo-fi piano under a veil of air, tape and plate patina.",
    tuningId: "equal", relationId: "tonic-fifth",
    voiceLayers: ["piano", "air"],
    voiceLevels: { piano: 1, air: 0.5 },
    octaveRange: [3, 4],
    drift: 0.22,
    air: 0.4,         // less reverb — Grouper is close-miked cassette
    time: 0.06,
    sub: 0.28,
    bloom: 0.7,
    glide: 0.45,
    lfoShape: "sine",
    lfoRate: 0.07,
    lfoAmount: 0.1,
    climateX: 0.22,   // dark — cassette rolls off highs heavily
    climateY: 0.32,   // strong wow — tape warble is the signature
    // Heavy tape+wow is the defining Grouper character. No plate —
    // too clean. Hall at low air for distant room, granular for
    // the fragmentary tape-loop quality.
    effects: ["tape", "wow", "hall", "granular"],
    scale: "minor",
    gain: 0.29,
    motionProfile: motionProfile({
      climateXRange: [0.28, 0.4],
      climateYRange: [0.18, 0.32],
      bloomRange: [0.72, 0.88],
      timeRange: [0.04, 0.12],
      driftRange: [0.12, 0.24],
      subRange: [0.16, 0.3],
      macroStep: 0.62,
      tonicWalk: "rare",
      tonicIntervals: [-5, 5],
      tonicFloor: 0.58,
      textureFloor: 0.66,
      texturePeriod: 5,
    }),
  },

  // ─── Marconi Union — clean modern ambient with slow descent ─────────
  {
    id: "marconi-weightless", group: "Ambient / Cinematic",
    name: "Weightless",
    attribution: "Clean pad + falling bass · piano pings · wide reverb",
    hint: "Clean high pads, sparse piano pings, gentle falling bass. Wide, slow, modern.",
    tuningId: "just5", relationId: "drone-triad",
    voiceLayers: ["piano", "reed", "air"],
    voiceLevels: { piano: 0.62, reed: 1, air: 0.36 },
    reedShape: "balanced",
    octaveRange: [3, 4],
    drift: 0.06,
    air: 0.58,
    time: 0.03,
    sub: 0.24,
    bloom: 0.9,
    glide: 0.84,
    lfoShape: "sine",
    lfoRate: 0.018,
    lfoAmount: 0.08,
    climateX: 0.56,
    climateY: 0.24,
    effects: ["plate", "hall"],
    // Heavier parallel hall so the piano attacks stay defined against
    // a wide wet tail instead of being smeared through serial plate.
    parallelSends: { hall: 0.5 },
    scale: "minor",
    gain: 1.25,
    motionProfile: motionProfile({
      climateXRange: [0.5, 0.62],
      climateYRange: [0.18, 0.3],
      bloomRange: [0.84, 0.96],
      timeRange: [0.02, 0.05],
      driftRange: [0.04, 0.1],
      subRange: [0.18, 0.3],
      macroStep: 0.4,
      // Descending-favored fifths and fourths so the evolve loop
      // recreates the track's gentle falling-bass motion.
      tonicWalk: "gentle",
      tonicIntervals: [-7, -5, -2],
      tonicFloor: 0.5,
      textureFloor: 0.66,
      texturePeriod: 6,
    }),
  },

  // ─── Andrew Liles — cinematic facet, quieter and more tonal ─────────
  {
    id: "liles-submariner", group: "Ambient / Cinematic",
    name: "Dying Submariner",
    attribution: "Tonal tape-treated drone · melancholic chamber",
    hint: "Bowed-string reed, air and a thread of piano, deep-chamber cistern. Tonal, slow, tape-treated.",
    tuningId: "just5", relationId: "drone-triad",
    voiceLayers: ["reed", "air", "piano"],
    voiceLevels: { reed: 1, air: 0.3, piano: 0.32 },
    reedShape: "even",
    octaveRange: [2, 3],
    drift: 0.18,
    air: 0.66,
    time: 0.05,
    sub: 0.36,
    bloom: 0.92,
    glide: 0.6,
    lfoShape: "sine",
    lfoRate: 0.028,    // ~35 s — melancholic, not restless
    lfoAmount: 0.14,
    climateX: 0.38,    // toward cold
    climateY: 0.22,    // dim
    // Tape for the treatment, plate + hall for the room, cistern for
    // the deep-chamber distance Liles's cinematic records always have.
    // No wow — this is the still, tonal facet, not the warped one.
    effects: ["tape", "plate", "hall", "cistern"],
    parallelSends: { cistern: 0.32, hall: 0.28 },
    scale: "minor",
    gain: 0.23,
    motionProfile: motionProfile({
      climateXRange: [0.32, 0.46],
      climateYRange: [0.16, 0.3],
      bloomRange: [0.82, 0.96],
      timeRange: [0.03, 0.08],
      driftRange: [0.12, 0.26],
      subRange: [0.28, 0.44],
      macroStep: 0.5,
      tonicWalk: "rare",
      tonicIntervals: [-5, 5],
      tonicFloor: 0.64,
      textureFloor: 0.72,
      texturePeriod: 6,
    }),
  },

  // ─── Ellen Arkbro — meantone chord drones ───────────────────────────
  {
    id: "arkbro-chords", group: "Organ / Chamber",
    name: "For Organ",
    attribution: "Meantone organ + brass · church stillness",
    hint: "Austere meantone chords with a pale brass-air edge. Drier and more vertical than Kali Organ.",
    // 31-TET is effectively 1/4-comma meantone extended — Arkbro's
    // pipe organs live here with more precision than legacy "meantone".
    tuningId: "custom:31-tet", relationId: "drone-triad",
    voiceLayers: ["reed", "air"],
    voiceLevels: { reed: 1, air: 0.18 },
    reedShape: "balanced",
    drift: 0.08,
    air: 0.34,
    time: 0.03,
    sub: 0.24,
    bloom: 0.72,
    glide: 0.72,
    lfoShape: "sine",
    lfoRate: 0.06,
    lfoAmount: 0.02,
    climateX: 0.38,
    climateY: 0.06,
    effects: ["hall"],
    parallelSends: { hall: 0.42 },
    scale: "meantone",
    gain: 1.6,
    motionProfile: motionProfile({
      climateXRange: [0.34, 0.44],
      climateYRange: [0.04, 0.1],
      bloomRange: [0.66, 0.82],
      timeRange: [0.01, 0.05],
      driftRange: [0.05, 0.11],
      subRange: [0.18, 0.3],
      macroStep: 0.28,
      tonicWalk: "none",
      tonicIntervals: [],
      tonicFloor: 1,
      textureFloor: 0.94,
      texturePeriod: 7,
    }),
  },

  // ─── La Monte Young — Well-Tuned Piano ──────────────────────────────
  {
    id: "young-well-tuned", group: "Minimal / Just",
    name: "Well-Tuned",
    attribution: "7-limit just lattice · sympathetic sustain",
    hint: "7-limit just lattice with bright partial clouds, long sympathetic bloom and a characteristic 444-cent third.",
    tuningId: "custom:young-wtp", relationId: "harmonic-stack",
    voiceLayers: ["piano", "reed"],
    voiceLevels: { piano: 1, reed: 0.08 },
    reedShape: "sine",
    octaveRange: [3, 4],
    drift: 0.04,
    air: 0.34,
    time: 0.02,
    sub: 0.14,
    bloom: 0.9,
    glide: 0.68,
    lfoShape: "sine",
    lfoRate: 0.03,
    lfoAmount: 0.015,
    climateX: 0.42,
    climateY: 0.06,
    effects: ["hall", "plate"],
    parallelSends: { hall: 0.28 },
    scale: "harmonics",
    gain: 1.6,
    motionProfile: motionProfile({
      climateXRange: [0.36, 0.5],
      climateYRange: [0.04, 0.1],
      bloomRange: [0.84, 0.96],
      timeRange: [0.01, 0.04],
      driftRange: [0.03, 0.08],
      subRange: [0.1, 0.2],
      macroStep: 0.28,
      tonicWalk: "none",
      tonicIntervals: [],
      tonicFloor: 1,
      textureFloor: 0.94,
      texturePeriod: 8,
    }),
  },
  // ─── Catherine Lamb — microtonal chamber ────────────────────────────
  {
    id: "lamb-prisma", group: "Minimal / Just",
    name: "Prisma",
    attribution: "Spectral chamber · combination tones",
    hint: "Pure sines in harmonic-series tuning. Combination tones emerge from closely-spaced fundamentals. Dry and spectral.",
    tuningId: "harmonics", relationId: "harmonic-stack",
    voiceLayers: ["reed"],
    voiceLevels: { reed: 1 },
    reedShape: "sine",
    drift: 0.08,
    air: 0.42,
    time: 0.04,
    sub: 0.2,
    bloom: 0.82,
    glide: 0.55,
    lfoShape: "sine",
    lfoRate: 0.05,
    lfoAmount: 0.03,
    climateX: 0.34,
    climateY: 0.1,
    // Prisma wants dry spectral fundamentals with a chamber around
    // them. Parallel plate/hall preserves the tone while adding space.
    effects: [],
    parallelSends: { plate: 0.18, hall: 0.16 },
    scale: "just5",
    gain: 1.6,
    motionProfile: motionProfile({
      climateXRange: [0.28, 0.4],
      climateYRange: [0.08, 0.16],
      bloomRange: [0.76, 0.9],
      timeRange: [0.02, 0.06],
      driftRange: [0.08, 0.14],
      subRange: [0.18, 0.3],
      macroStep: 0.34,
      tonicWalk: "rare",
      tonicIntervals: [-5, 5],
      tonicFloor: 0.62,
      textureFloor: 0.76,
      texturePeriod: 6,
    }),
  },
  {
    id: "slendro-gamelan", group: "Sacred / Ritual",
    name: "Slendro Gamelan",
    attribution: "Javanese gamelan · bronze ensemble",
    hint: "Bronze gong sustain with a saron-like reed in slendro pentatonic. Pitched saron under an inharmonic halo.",
    voiceLayers: ["reed", "metal"],
    voiceLevels: { reed: 1, metal: 0.35 },
    reedShape: "odd",
    octaveRange: [2, 3],
    drift: 0.22,
    air: 0.42,
    time: 0.08,
    sub: 0.18,
    bloom: 0.62,
    glide: 0.22,
    lfoShape: "sine",
    lfoRate: 0.12,
    lfoAmount: 0.05,
    climateX: 0.5,
    climateY: 0.22,
    effects: ["plate", "hall"],
    scale: "drone",
    tuningId: "slendro", relationId: "drone-triad",
    gain: 1.6,
    motionProfile: motionProfile({
      climateXRange: [0.42, 0.58],
      climateYRange: [0.16, 0.32],
      bloomRange: [0.55, 0.72],
      timeRange: [0.05, 0.12],
      driftRange: [0.18, 0.3],
      subRange: [0.12, 0.24],
      macroStep: 0.4,
      tonicWalk: "none",
      tonicIntervals: [],
      tonicFloor: 0.85,
      textureFloor: 0.82,
      texturePeriod: 8,
    }),
  },
  {
    id: "maqam-rast-oud", group: "Sacred / Ritual",
    name: "Maqam Rast (Oud)",
    attribution: "Arabic devotional · oud + breath",
    hint: "Held oud-like reed against a tonic drone in maqam rast. Half-flat third between major and minor.",
    voiceLayers: ["reed", "air"],
    voiceLevels: { reed: 1, air: 0.12 },
    reedShape: "odd",
    octaveRange: [2, 3],
    drift: 0.2,
    air: 0.36,
    time: 0.08,
    sub: 0.12,
    bloom: 0.42,
    glide: 0.18,
    lfoShape: "sine",
    lfoRate: 0.16,
    lfoAmount: 0.06,
    climateX: 0.52,
    climateY: 0.2,
    effects: ["plate", "hall"],
    scale: "drone",
    tuningId: "maqam-rast", relationId: "drone-triad",
    gain: 1.6,
    motionProfile: motionProfile({
      climateXRange: [0.44, 0.6],
      climateYRange: [0.14, 0.28],
      bloomRange: [0.34, 0.5],
      timeRange: [0.05, 0.12],
      driftRange: [0.16, 0.28],
      subRange: [0.08, 0.18],
      macroStep: 0.42,
      tonicWalk: "rare",
      tonicIntervals: [-7, -5, 5, 7],
      tonicFloor: 0.78,
      textureFloor: 0.82,
      texturePeriod: 7,
    }),
  },
  {
    id: "maqam-rast-sufi", group: "Sacred / Ritual",
    name: "Maqam Rast (Sufi)",
    attribution: "Sufi vocal meditation · breath + quarter-tone drone",
    hint: "Maqam rast with vocal resonance — richer reed, breath, choral formant. More human than the Oud preset.",
    voiceLayers: ["reed", "air"],
    voiceLevels: { reed: 1, air: 0.3 },
    reedShape: "balanced",
    octaveRange: [2, 3],
    drift: 0.16,
    air: 0.52,
    time: 0.06,
    sub: 0.2,
    bloom: 0.65,
    glide: 0.3,
    lfoShape: "sine",
    lfoRate: 0.1,
    lfoAmount: 0.08,
    climateX: 0.38,
    climateY: 0.18,
    effects: ["formant", "hall"],
    parallelSends: { hall: 0.4 },
    scale: "drone",
    // Bayati's neutral 2nd (~150¢) distinguishes the Sufi devotional
    // register from the Rast(Oud) sibling — same lineage, darker mode.
    tuningId: "custom:bayati", relationId: "tonic-fourth",
    gain: 1.6,
    motionProfile: motionProfile({
      climateXRange: [0.32, 0.46],
      climateYRange: [0.12, 0.26],
      bloomRange: [0.55, 0.75],
      timeRange: [0.04, 0.1],
      driftRange: [0.12, 0.22],
      subRange: [0.14, 0.26],
      macroStep: 0.45,
      tonicWalk: "rare",
      tonicIntervals: [-5, 5],
      tonicFloor: 0.72,
      textureFloor: 0.78,
      texturePeriod: 6,
    }),
  },
  // ─── Charlemagne Palestine — overtone piano strumming ──────────────
  {
    id: "palestine-strumming", group: "Minimal / Just",
    name: "Strumming",
    attribution: "Overtone piano · ascending shimmer clouds",
    hint: "Sustained piano at high bloom, shimmer feeding overtones back. The piano becomes an overtone generator.",
    tuningId: "harmonics", relationId: "harmonic-stack",
    voiceLayers: ["piano", "reed"],
    voiceLevels: { piano: 1, reed: 0.2 },
    reedShape: "sine",
    octaveRange: [3, 4],
    drift: 0.1,
    air: 0.5,
    time: 0.06,
    sub: 0.15,
    bloom: 0.92,
    glide: 0.4,
    lfoShape: "sine",
    lfoRate: 0.03,
    lfoAmount: 0.06,
    climateX: 0.55,
    climateY: 0.2,
    effects: ["shimmer", "hall"],
    parallelSends: { hall: 0.35 },
    scale: "drone",
    gain: 1.6,
    motionProfile: motionProfile({
      climateXRange: [0.45, 0.65],
      climateYRange: [0.14, 0.28],
      bloomRange: [0.85, 0.98],
      timeRange: [0.04, 0.1],
      driftRange: [0.08, 0.16],
      subRange: [0.1, 0.2],
      macroStep: 0.38,
      tonicWalk: "none",
      tonicFloor: 1,
      textureFloor: 0.8,
      texturePeriod: 7,
    }),
  },

  // ─── Pauline Oliveros — accordion drone ────────────────────────────
  {
    id: "oliveros-accordion", group: "Organ / Chamber",
    name: "Accordion Room",
    attribution: "Accordion drone · practice room breath",
    hint: "Close-miked accordion — fast breath, little room, no halo. Bellows moving air in front of you.",
    // Pythagorean suits Oliveros — pure 3/2 air, no 5-limit sweetness.
    tuningId: "custom:pythagorean", relationId: "unison",
    voiceLayers: ["reed", "air"],
    voiceLevels: { reed: 1, air: 0.18 },
    reedShape: "odd",
    octaveRange: [2, 3],
    drift: 0.1,
    air: 0.12,
    time: 0.03,
    sub: 0.06,
    bloom: 0.38,
    glide: 0.14,
    lfoShape: "sine",
    lfoRate: 0.22,
    lfoAmount: 0.1,
    climateX: 0.46,
    climateY: 0.12,
    effects: ["formant"],
    scale: "drone",
    gain: 1.6,
    motionProfile: motionProfile({
      climateXRange: [0.4, 0.52],
      climateYRange: [0.08, 0.16],
      bloomRange: [0.32, 0.46],
      timeRange: [0.02, 0.05],
      driftRange: [0.07, 0.14],
      subRange: [0.02, 0.1],
      macroStep: 0.3,
      tonicWalk: "none",
      tonicFloor: 1,
      textureFloor: 0.9,
      texturePeriod: 8,
    }),
  },

  // ─── Tony Conrad — bowed violin drone ──────────────────────────────
  {
    id: "conrad-bowed", group: "Minimal / Just",
    name: "Bowed Drone",
    attribution: "Bowed violin · beating unisons · minimalist sustain",
    hint: "Bowed-violin drone, close-tuned strings beating against each other. Harmonics tuning, minimal FX.",
    tuningId: "harmonics", relationId: "harmonic-stack",
    voiceLayers: ["reed"],
    voiceLevels: { reed: 1 },
    reedShape: "even",
    octaveRange: [3, 4],
    drift: 0.35,
    air: 0.25,
    time: 0.05,
    sub: 0.08,
    bloom: 0.5,
    glide: 0.3,
    lfoShape: "sine",
    lfoRate: 0.05,
    lfoAmount: 0.03,
    climateX: 0.5,
    climateY: 0.25,
    effects: ["plate"],
    scale: "drone",
    gain: 1.6,
    motionProfile: motionProfile({
      climateXRange: [0.42, 0.58],
      climateYRange: [0.18, 0.34],
      bloomRange: [0.42, 0.6],
      timeRange: [0.03, 0.08],
      driftRange: [0.28, 0.42],
      subRange: [0.05, 0.12],
      macroStep: 0.35,
      tonicWalk: "none",
      tonicFloor: 1,
      textureFloor: 0.88,
      texturePeriod: 8,
    }),
  },

  // ─── Eleh — pure electronic sub-heavy drone ────────────────────────
  {
    id: "eleh-descent", group: "Minimal / Just",
    name: "Descent",
    attribution: "Pure electronic drone · sub-heavy · no instrument reference",
    hint: "Pure electronic drone — FM and sine reed, sub-heavy, minimal FX. No instrument imitation.",
    tuningId: "equal", relationId: "unison",
    voiceLayers: ["fm", "reed"],
    voiceLevels: { fm: 1, reed: 0.3 },
    reedShape: "sine",
    fmRatio: 2.0,
    fmIndex: 1.8,
    octaveRange: [1, 2],
    drift: 0.05,
    air: 0.2,
    time: 0.03,
    sub: 0.55,
    bloom: 0.6,
    glide: 0.45,
    lfoShape: "sine",
    lfoRate: 0.03,
    lfoAmount: 0.04,
    climateX: 0.3,
    climateY: 0.08,
    effects: ["hall"],
    parallelSends: { hall: 0.25 },
    scale: "drone",
    gain: 0.84,
    motionProfile: motionProfile({
      climateXRange: [0.24, 0.36],
      climateYRange: [0.05, 0.14],
      bloomRange: [0.5, 0.7],
      timeRange: [0.02, 0.05],
      driftRange: [0.03, 0.08],
      subRange: [0.45, 0.65],
      macroStep: 0.28,
      tonicWalk: "none",
      tonicFloor: 1,
      textureFloor: 0.9,
      texturePeriod: 9,
    }),
  },

  // ─── Phill Niblock — dense microtone wall ──────────────────────────
  {
    id: "niblock-wall", group: "Minimal / Just",
    name: "Microtone Wall",
    attribution: "Dense beating · close intervals",
    hint: "Wall of close-tuned wind and metal in a drone-triad. Motion only in beating near-unison partials.",
    tuningId: "just5", relationId: "drone-triad",
    voiceLayers: ["air", "metal"],
    voiceLevels: { air: 0.92, metal: 0.68 },
    octaveRange: [2, 3],
    drift: 0.08,
    air: 0.35,
    time: 0.03,
    sub: 0.2,
    bloom: 0.95,
    glide: 0.15,
    lfoShape: "sine",
    lfoRate: 0.04,
    lfoAmount: 0.02,
    climateX: 0.45,
    climateY: 0.3,
    effects: ["plate", "hall"],
    parallelSends: { hall: 0.3 },
    scale: "drone",
    gain: 1.6,
    motionProfile: motionProfile({
      climateXRange: [0.42, 0.48],
      climateYRange: [0.26, 0.34],
      bloomRange: [0.9, 0.98],
      timeRange: [0.02, 0.05],
      driftRange: [0.05, 0.12],
      subRange: [0.15, 0.28],
      macroStep: 0.2,
      tonicWalk: "none",
      tonicFloor: 1,
      textureFloor: 0.82,
      texturePeriod: 7,
    }),
  },
  {
    id: "didgeridoo", group: "Sacred / Ritual",
    name: "Didgeridoo",
    attribution: "Aboriginal breath drone · formant overtones",
    hint: "Low fundamental through continuous breath cycles and a vocal-tract formant. Deep, bodily, continuous.",
    // Otonal 16:32 — the didgeridoo IS a harmonic-series instrument;
    // zero-beat partials reveal what's already there.
    tuningId: "custom:otonal-16-32", relationId: "unison",
    voiceLayers: ["air", "reed"],
    voiceLevels: { air: 1, reed: 0.6 },
    reedShape: "odd",
    octaveRange: [1, 2],
    drift: 0.12,
    air: 0.6,
    time: 0.08,
    sub: 0.65,
    bloom: 0.75,
    glide: 0.5,
    lfoShape: "sine",
    lfoRate: 0.16,    // ~6 s breath cycle
    lfoAmount: 0.18,  // audible breath-cycle amplitude swell
    climateX: 0.25,
    climateY: 0.15,
    effects: ["formant", "sub", "tape"],
    parallelSends: { hall: 0.25 },
    scale: "drone",
    gain: 0.35,
    motionProfile: motionProfile({
      climateXRange: [0.2, 0.32],
      climateYRange: [0.1, 0.22],
      bloomRange: [0.68, 0.82],
      timeRange: [0.05, 0.12],
      driftRange: [0.08, 0.18],
      subRange: [0.55, 0.72],
      macroStep: 0.35,
      tonicWalk: "none",
      tonicIntervals: [],
      tonicFloor: 1,
      textureFloor: 0.82,
      texturePeriod: 6,
    }),
  },
  {
    id: "alva-noto-sines", group: "Minimal / Just",
    name: "Clinical Sines",
    attribution: "Clinical digital minimalism · FM near-sines",
    hint: "Near-pure FM sines in harmonic-stack intervals. Dry, no drift, no modulation. Digital clarity only.",
    tuningId: "equal", relationId: "harmonic-stack",
    voiceLayers: ["fm"],
    voiceLevels: { fm: 1 },
    fmRatio: 2.0,
    fmIndex: 0.18,
    fmFeedback: 0,
    octaveRange: [4, 5],
    drift: 0,
    air: 0.05,
    time: 0,
    sub: 0,
    bloom: 0.95,
    glide: 0.95,
    lfoShape: "sine",
    lfoRate: 0.01,
    lfoAmount: 0,
    climateX: 0.8,
    climateY: 0,
    effects: [],
    scale: "drone",
    gain: 1.6,
    motionProfile: motionProfile({
      climateXRange: [0.78, 0.82],
      climateYRange: [0, 0.02],
      bloomRange: [0.92, 0.98],
      timeRange: [0, 0.01],
      driftRange: [0, 0.02],
      subRange: [0, 0.04],
      macroStep: 0.1,
      tonicWalk: "none",
      tonicIntervals: [],
      tonicFloor: 1,
      textureFloor: 0.98,
      texturePeriod: 10,
    }),
  },
  {
    id: "sunn-amp-drone", group: "Noise / Industrial",
    name: "Cathedral Amps",
    attribution: "Drone metal · downtuned amp chord",
    hint: "Amp-cabinet body and reed chord in minor triad through cathedral reverb. Massive sub, long sustain.",
    tuningId: "equal", relationId: "minor-triad",
    voiceLayers: ["amp", "reed", "metal"],
    voiceLevels: { amp: 1, reed: 0.6, metal: 0.2 },
    reedShape: "odd",
    octaveRange: [1, 2],
    drift: 0.08,
    air: 0.35,
    time: 0.04,
    sub: 0.75,
    bloom: 0.9,
    glide: 0.5,
    lfoShape: "sine",
    lfoRate: 0.04,
    lfoAmount: 0.04,
    climateX: 0.12,
    climateY: 0.1,
    effects: ["tape"],
    parallelSends: { hall: 0.35, cistern: 0.25 },
    scale: "minor",
    gain: 0.31,
    motionProfile: motionProfile({
      climateXRange: [0.08, 0.18],
      climateYRange: [0.06, 0.14],
      bloomRange: [0.85, 0.95],
      timeRange: [0.02, 0.06],
      driftRange: [0.05, 0.12],
      subRange: [0.65, 0.8],
      macroStep: 0.3,
      tonicWalk: "none",
      tonicIntervals: [],
      tonicFloor: 1,
      textureFloor: 0.88,
      texturePeriod: 7,
    }),
  },
  {
    id: "tuvan-khoomei", group: "Sacred / Ritual",
    name: "Khöömei",
    attribution: "Tuvan throat singing · whistle overtone",
    hint: "Reed fundamental with a high metal-whistle partial above. Brighter and more melodic than Tibetan chant.",
    // Otonal 16:32 — khoomei overtone singing lives on pure partials;
    // the metal-whistle sits on a true harmonic above the reed.
    tuningId: "custom:otonal-16-32", relationId: "tonic-fifth",
    voiceLayers: ["reed", "metal", "air"],
    voiceLevels: { reed: 1, metal: 0.4, air: 0.25 },
    reedShape: "balanced",
    octaveRange: [2, 3],
    drift: 0.12,
    air: 0.45,
    time: 0.06,
    sub: 0.28,
    bloom: 0.62,
    glide: 0.3,
    lfoShape: "sine",
    lfoRate: 0.08,
    lfoAmount: 0.05,
    climateX: 0.45,   // brighter than buddhist-monk (0.2) — melodic not monastic
    climateY: 0.12,
    effects: ["formant"],
    parallelSends: { hall: 0.35 },
    scale: "drone",
    gain: 1.27,
    motionProfile: motionProfile({
      climateXRange: [0.4, 0.52],
      climateYRange: [0.08, 0.18],
      bloomRange: [0.54, 0.72],
      timeRange: [0.04, 0.1],
      driftRange: [0.08, 0.18],
      subRange: [0.22, 0.36],
      macroStep: 0.36,
      tonicWalk: "none",
      tonicIntervals: [],
      tonicFloor: 1,
      textureFloor: 0.82,
      texturePeriod: 7,
    }),
  },
  {
    id: "alice-coltrane-devotional", group: "Sacred / Ritual",
    name: "Devotional",
    attribution: "Harp-organ ashram · ecstatic devotional",
    hint: "Warm ashram-organ reed with piano strikes under a shimmer ceiling. Ecstatic but grounded.",
    tuningId: "harmonics", relationId: "harmonic-stack",
    voiceLayers: ["reed", "piano"],
    voiceLevels: { reed: 1, piano: 0.4 },
    reedShape: "even",
    octaveRange: [2, 4],
    drift: 0.1,
    air: 0.48,
    time: 0.04,
    sub: 0.22,
    bloom: 0.88,
    glide: 0.55,
    lfoShape: "sine",
    lfoRate: 0.05,
    lfoAmount: 0.06,
    climateX: 0.55,
    climateY: 0.1,
    effects: ["shimmer", "plate"],
    parallelSends: { hall: 0.3 },
    scale: "harmonics",
    gain: 1.33,
    motionProfile: motionProfile({
      climateXRange: [0.48, 0.62],
      climateYRange: [0.06, 0.16],
      bloomRange: [0.82, 0.94],
      timeRange: [0.03, 0.08],
      driftRange: [0.06, 0.14],
      subRange: [0.16, 0.3],
      macroStep: 0.32,
      tonicWalk: "rare",
      tonicIntervals: [5, 7],
      tonicFloor: 0.72,
      textureFloor: 0.8,
      texturePeriod: 8,
    }),
  },
  {
    id: "sarangi", group: "Sacred / Ritual",
    name: "Sarangi",
    attribution: "Indian bowed string · sympathetic resonance",
    hint: "Bowed-string drone against a tanpura tonic with a sympathetic halo. Vocal portamento, maqam-rast microtuning.",
    tuningId: "maqam-rast", relationId: "drone-triad",
    voiceLayers: ["reed", "tanpura"],
    voiceLevels: { reed: 1, tanpura: 0.4 },
    reedShape: "odd",
    octaveRange: [2, 3],
    drift: 0.22,
    air: 0.38,
    time: 0.08,
    sub: 0.12,
    bloom: 0.55,
    glide: 0.35,
    lfoShape: "sine",
    lfoRate: 0.14,
    lfoAmount: 0.08,
    climateX: 0.45,
    climateY: 0.18,
    combFeedback: 0.4,
    effects: ["comb", "plate"],
    parallelSends: { hall: 0.28 },
    scale: "drone",
    gain: 0.6,
    motionProfile: motionProfile({
      climateXRange: [0.4, 0.52],
      climateYRange: [0.14, 0.24],
      bloomRange: [0.48, 0.64],
      timeRange: [0.05, 0.12],
      driftRange: [0.18, 0.3],
      subRange: [0.08, 0.18],
      macroStep: 0.42,
      tonicWalk: "none",
      tonicIntervals: [],
      tonicFloor: 1,
      textureFloor: 0.78,
      texturePeriod: 7,
    }),
  },

  // ─── Pulse / Studies — FLICKER-driven pieces across the EEG bands ───
  // Five compositional études, each pairing a drone bed with LFO 2 ·
  // FLICKER set to a representative rate. Names describe the sonic
  // character, not a prescribed mental state.

  {
    id: "pulse-surrender", group: "Pulse / Studies",
    name: "Surrender",
    attribution: "delta / 2 Hz FLICKER · long-breath drone",
    hint: "Lone tanpura at A2, just-intonation fifth, 2 Hz amplitude pulse. One swell every half-second over a still room.",
    voiceLayers: ["tanpura"],
    voiceLevels: { tanpura: 1 },
    octaveRange: [2, 2],
    drift: 0.10, air: 0.60, time: 0.15, sub: 0, bloom: 0.30, glide: 0.20,
    lfoShape: "sine", lfoRate: 0.12, lfoAmount: 0.15,
    climateX: 0.40, climateY: 0.12,
    effects: ["plate", "hall"],
    scale: "drone",
    tuningId: "just5", relationId: "tonic-fifth",
    gain: 0.76,
    entrain: { enabled: true, rateHz: 2, mode: "am", dichoticCents: 8 },
    motionProfile: motionProfile({
      climateXRange: [0.34, 0.46], climateYRange: [0.06, 0.18],
      bloomRange: [0.24, 0.38], timeRange: [0.08, 0.20],
      driftRange: [0.06, 0.14], subRange: [0, 0.02],
      macroStep: 0.35, tonicWalk: "none", tonicIntervals: [],
      tonicFloor: 1, textureFloor: 0.9, texturePeriod: 9,
    }),
  },

  {
    id: "pulse-float", group: "Pulse / Studies",
    name: "Float",
    attribution: "theta / 6 Hz FLICKER · harmonic bed",
    hint: "Reed + air over spectral partials (harmonics 4–8), 6 Hz tremolo. Wet reverb tail, narrow detune, hypnagogic range.",
    voiceLayers: ["reed", "air"],
    voiceLevels: { reed: 0.7, air: 0.4 },
    octaveRange: [3, 3],
    drift: 0.28, air: 0.70, time: 0.28, sub: 0.10, bloom: 0.55, glide: 0.22,
    lfoShape: "sine", lfoRate: 0.30, lfoAmount: 0.20,
    climateX: 0.52, climateY: 0.35,
    effects: ["plate", "hall", "shimmer"],
    scale: "harmonics",
    tuningId: "just5", relationId: "harmonic-stack",
    gain: 0.70,
    entrain: { enabled: true, rateHz: 6, mode: "am", dichoticCents: 10 },
    motionProfile: motionProfile({
      climateXRange: [0.44, 0.60], climateYRange: [0.28, 0.44],
      bloomRange: [0.48, 0.62], timeRange: [0.22, 0.36],
      driftRange: [0.22, 0.34], subRange: [0.06, 0.14],
      macroStep: 0.42, tonicWalk: "rare", tonicIntervals: [0, 7],
      tonicFloor: 1, textureFloor: 0.82, texturePeriod: 8,
    }),
  },

  {
    id: "pulse-calm-alert", group: "Pulse / Studies",
    name: "Calm-Alert",
    attribution: "alpha / 10 Hz FLICKER · dorian bed",
    hint: "Reed + metal in dorian, 10 Hz pulse. Eyes-closed relaxed-wakeful range. Bright but not harsh.",
    voiceLayers: ["reed", "metal"],
    voiceLevels: { reed: 0.6, metal: 0.55 },
    octaveRange: [3, 3],
    drift: 0.32, air: 0.50, time: 0.42, sub: 0.05, bloom: 0.50, glide: 0.18,
    lfoShape: "sine", lfoRate: 0.50, lfoAmount: 0.18,
    climateX: 0.55, climateY: 0.38,
    effects: ["plate", "hall"],
    scale: "dorian",
    tuningId: "just5", relationId: "tonic-fifth",
    gain: 0.72,
    entrain: { enabled: true, rateHz: 10, mode: "am", dichoticCents: 12 },
    motionProfile: motionProfile({
      climateXRange: [0.46, 0.62], climateYRange: [0.28, 0.46],
      bloomRange: [0.42, 0.58], timeRange: [0.34, 0.48],
      driftRange: [0.24, 0.38], subRange: [0.02, 0.10],
      macroStep: 0.45, tonicWalk: "rare", tonicIntervals: [0, 3, 7],
      tonicFloor: 1, textureFloor: 0.8, texturePeriod: 8,
    }),
  },

  {
    id: "pulse-focus", group: "Pulse / Studies",
    name: "Focus",
    attribution: "low-beta / 18 Hz FLICKER · phrygian bed",
    hint: "Metal + FM in phrygian at D3. 18 Hz flutter, dry plate only, upper partials. Darker, narrower, task-lit.",
    voiceLayers: ["metal", "fm"],
    voiceLevels: { metal: 0.55, fm: 0.5 },
    octaveRange: [3, 3],
    drift: 0.20, air: 0.28, time: 0.35, sub: 0.02, bloom: 0.40, glide: 0.15,
    lfoShape: "sine", lfoRate: 0.40, lfoAmount: 0.10,
    climateX: 0.55, climateY: 0.20,
    effects: ["plate"],
    scale: "phrygian",
    tuningId: "just5", relationId: "tonic-fifth",
    fmRatio: 3.5, fmIndex: 2.0, fmFeedback: 0,
    gain: 0.78,
    entrain: { enabled: true, rateHz: 18, mode: "am", dichoticCents: 8 },
    motionProfile: motionProfile({
      climateXRange: [0.48, 0.62], climateYRange: [0.14, 0.28],
      bloomRange: [0.34, 0.46], timeRange: [0.28, 0.42],
      driftRange: [0.14, 0.26], subRange: [0, 0.06],
      macroStep: 0.4, tonicWalk: "none", tonicIntervals: [],
      tonicFloor: 1, textureFloor: 0.86, texturePeriod: 9,
    }),
  },

  {
    id: "pulse-bind", group: "Pulse / Studies",
    name: "Bind",
    attribution: "gamma / 40 Hz FLICKER · harmonic stack",
    hint: "Reed + metal in harmonics 4–8 at A3. 40 Hz amplitude modulation — the gamma rate under active research. Metallic roughness, strong combination tones.",
    voiceLayers: ["reed", "metal"],
    voiceLevels: { reed: 0.5, metal: 0.5 },
    octaveRange: [3, 3],
    drift: 0.34, air: 0.45, time: 0.42, sub: 0.06, bloom: 0.60, glide: 0.20,
    lfoShape: "sine", lfoRate: 0.40, lfoAmount: 0.15,
    climateX: 0.58, climateY: 0.42,
    effects: ["plate", "hall"],
    scale: "harmonics",
    tuningId: "just5", relationId: "harmonic-stack",
    gain: 0.62,
    entrain: { enabled: true, rateHz: 40, mode: "am", dichoticCents: 10 },
    motionProfile: motionProfile({
      climateXRange: [0.50, 0.66], climateYRange: [0.32, 0.52],
      bloomRange: [0.48, 0.66], timeRange: [0.34, 0.50],
      driftRange: [0.24, 0.40], subRange: [0.02, 0.10],
      macroStep: 0.4, tonicWalk: "rare", tonicIntervals: [0, 7],
      tonicFloor: 1, textureFloor: 0.82, texturePeriod: 8,
    }),
  },

  // ─── Welcome — dedicated first-launch preset ───────────────────────
  // Served deterministically the first time a fresh browser lands on
  // mdrone (no prior autosave). Designed for the "3 seconds at default
  // tonic/octave" arrival bar: instant just-5 drone-triad consonance
  // from tanpura + air, audible breath LFO so motion reads immediately,
  // mid climateX/Y so the first WEATHER drag has room in every
  // direction, safe 0.68 gain. No heavy effects — plate + hall only.
  {
    id: "welcome", group: "Minimal / Just",
    name: "Welcome",
    attribution: "First-launch drone · instant arrival",
    hidden: true,
    hint: "A clean just-intonation triad on tanpura and air. Drag WEATHER to feel the room open.",
    voiceLayers: ["tanpura", "air"],
    voiceLevels: { tanpura: 1, air: 0.35 },
    octaveRange: [3, 3],
    drift: 0.18,
    air: 0.4,
    time: 0.15,
    sub: 0.15,
    bloom: 0.55,
    glide: 0.2,
    lfoShape: "sine",
    lfoRate: 0.14,
    lfoAmount: 0.09,
    climateX: 0.55,
    climateY: 0.45,
    effects: ["plate", "hall"],
    scale: "drone",
    tuningId: "just5", relationId: "drone-triad",
    gain: 0.68,
    motionProfile: motionProfile({
      climateXRange: [0.4, 0.7],
      climateYRange: [0.3, 0.6],
      bloomRange: [0.45, 0.65],
      timeRange: [0.1, 0.22],
      driftRange: [0.14, 0.24],
      subRange: [0.1, 0.22],
      macroStep: 0.5,
      tonicWalk: "rare",
      tonicIntervals: [-5, 5, 7],
      tonicFloor: 0.8,
      textureFloor: 0.88,
      texturePeriod: 6,
    }),
  },

  // ─── Tuning-showcase variants ──────────────────────────────────────
  // Three presets whose identity IS the tuning. Kept intentionally
  // simple so the microtonal structure is what the ear tracks.

  {
    id: "mdrone-house", group: "Minimal / Just",
    name: "House Drone",
    attribution: "mdrone signature · just × 31-TET",
    hint: "Pure-just drone on the house tuning. Tanpura body, reed shimmer, air halo. Warm, rooted, still.",
    voiceLayers: ["tanpura", "reed", "air"],
    voiceLevels: { tanpura: 1, reed: 0.4, air: 0.22 },
    reedShape: "balanced",
    octaveRange: [2, 3],
    drift: 0.14,
    air: 0.36,
    time: 0.05,
    sub: 0.18,
    bloom: 0.52,
    glide: 0.18,
    lfoShape: "sine",
    lfoRate: 0.16,
    lfoAmount: 0.05,
    climateX: 0.44,
    climateY: 0.2,
    effects: ["plate", "hall"],
    scale: "drone",
    tuningId: "custom:mdrone-signature", relationId: "harmonic-stack",
    gain: 0.68,
    motionProfile: motionProfile({
      climateXRange: [0.38, 0.5],
      climateYRange: [0.14, 0.26],
      bloomRange: [0.44, 0.6],
      timeRange: [0.03, 0.08],
      driftRange: [0.1, 0.2],
      subRange: [0.12, 0.24],
      macroStep: 0.5,
      tonicWalk: "rare",
      tonicIntervals: [-5, 5, 7],
      tonicFloor: 0.78,
      textureFloor: 0.86,
      texturePeriod: 6,
    }),
  },
  {
    id: "cluster-shimmer", group: "Noise / Industrial",
    name: "Cluster Shimmer",
    attribution: "22-sruti dense cluster · spectral weather",
    hint: "Air and metal held on a dense quarter-tone cluster. Beats everywhere, shimmer without chord.",
    voiceLayers: ["air", "metal"],
    voiceLevels: { air: 1, metal: 0.28 },
    octaveRange: [3, 4],
    drift: 0.22,
    air: 0.52,
    time: 0.1,
    sub: 0.1,
    bloom: 0.58,
    glide: 0.3,
    lfoShape: "sine",
    lfoRate: 0.08,
    lfoAmount: 0.06,
    climateX: 0.5,
    climateY: 0.4,
    effects: ["tape", "hall"],
    scale: "drone",
    // drone-triad picks slots 0/4/7 — with the cluster tuning that
    // resolves to three pitches packed inside ~160¢ (a beating field
    // around the root), then silence up to the octave.
    tuningId: "custom:cluster-sruti", relationId: "drone-triad",
    gain: 0.46,
    motionProfile: motionProfile({
      climateXRange: [0.42, 0.6],
      climateYRange: [0.3, 0.52],
      bloomRange: [0.5, 0.7],
      timeRange: [0.06, 0.16],
      driftRange: [0.16, 0.3],
      subRange: [0.06, 0.16],
      macroStep: 0.7,
      tonicWalk: "gentle",
      tonicIntervals: [-2, 2, -5, 5],
      tonicFloor: 0.6,
      textureFloor: 0.7,
      texturePeriod: 5,
    }),
  },
  {
    id: "hollow-drone", group: "Minimal / Just",
    name: "Hollow",
    attribution: "Open-fifth power drone · archetypal empty space",
    hint: "Amp sustain and tanpura locked on a near-unison field around root and fifth. Power chord as meditation.",
    voiceLayers: ["amp", "tanpura"],
    voiceLevels: { amp: 1, tanpura: 0.38 },
    octaveRange: [1, 2],
    drift: 0.18,
    air: 0.22,
    time: 0.04,
    sub: 0.48,
    bloom: 0.5,
    glide: 0.12,
    lfoShape: "sine",
    lfoRate: 0.12,
    lfoAmount: 0.04,
    climateX: 0.32,
    climateY: 0.18,
    effects: ["tape", "hall"],
    scale: "drone",
    // Hollow tuning: interior slots cluster within sub-10¢ of P1/P5/P8.
    // harmonic-stack resolves to {0, 8, 704, 1196, 1200} — a fan of
    // near-unisons at root, fifth, and octave. The tuning itself
    // imposes the power-chord identity regardless of relation.
    tuningId: "custom:hollow-fifth", relationId: "harmonic-stack",
    gain: 0.64,
    motionProfile: motionProfile({
      climateXRange: [0.26, 0.4],
      climateYRange: [0.12, 0.26],
      bloomRange: [0.4, 0.6],
      timeRange: [0.02, 0.08],
      driftRange: [0.12, 0.26],
      subRange: [0.38, 0.58],
      macroStep: 0.45,
      tonicWalk: "none",
      tonicIntervals: [],
      tonicFloor: 1,
      textureFloor: 0.88,
      texturePeriod: 7,
    }),
  },
  // ─ Function-first + gap fills (Apr 2026) ────────────────
  // Nine additions target the gaps audited in the preset
  // library: a pure air voice with no reed anchor, delay/
  // freeze as compositional identities, warmer/brittler
  // FM territory beyond bell+gong, a contemplative noise
  // preset, and plain-language identities (close room /
  // sub chamber / high shimmer). Tuning+relation pairs
  // deliberately pull away from the just5 / tonic-fifth
  // concentration — tonic-fourth, kirnberger-iii,
  // werckmeister-iii, 31-tet, otonal-16-32, maqam-rast.
  {
    id: "breath-pipe", group: "Ambient / Cinematic",
    name: "Breath Pipe",
    attribution: "Air-only flue pipe · shō / ney breath column",
    hint: "Pure air voice, no reed anchor. Hollow flute breath column with slow bellows over a fourth.",
    voiceLayers: ["air"],
    voiceLevels: { air: 1 },
    octaveRange: [3, 4],
    drift: 0.14,
    air: 0.72,
    time: 0.08,
    sub: 0.06,
    bloom: 0.55,
    glide: 0.16,
    lfoShape: "sine",
    lfoRate: 0.12,
    lfoAmount: 0.09,
    climateX: 0.44,
    climateY: 0.28,
    effects: ["hall", "plate"],
    scale: "drone",
    tuningId: "custom:bayati", relationId: "tonic-fourth",
    gain: 0.82,
    motionProfile: motionProfile({
      climateXRange: [0.38, 0.52],
      climateYRange: [0.18, 0.36],
      bloomRange: [0.48, 0.66],
      timeRange: [0.05, 0.14],
      driftRange: [0.1, 0.22],
      subRange: [0, 0.14],
      macroStep: 0.5,
      tonicWalk: "rare",
      tonicIntervals: [-5, 5],
      tonicFloor: 0.74,
      textureFloor: 0.78,
      texturePeriod: 6,
    }),
  },
  {
    id: "delay-vigil", group: "Minimal / Just",
    name: "Delay Vigil",
    attribution: "Piano plucks in a long tempo-synced delay",
    hint: "Sparse piano notes dissolving into a long resonant delay. Delay is the instrument, not a seasoning.",
    voiceLayers: ["piano", "air"],
    voiceLevels: { piano: 1, air: 0.42 },
    octaveRange: [3, 4],
    drift: 0.12,
    air: 0.38,
    time: 0.1,
    sub: 0.08,
    bloom: 0.48,
    glide: 0.08,
    lfoShape: "sine",
    lfoRate: 0.16,
    lfoAmount: 0.05,
    climateX: 0.5,
    climateY: 0.22,
    effects: ["delay", "plate"],
    scale: "drone",
    tuningId: "custom:pythagorean", relationId: "tonic-fifth",
    gain: 0.72,
    motionProfile: motionProfile({
      climateXRange: [0.42, 0.58],
      climateYRange: [0.14, 0.3],
      bloomRange: [0.4, 0.58],
      timeRange: [0.06, 0.16],
      driftRange: [0.08, 0.2],
      subRange: [0.04, 0.16],
      macroStep: 0.58,
      tonicWalk: "rare",
      tonicIntervals: [-5, 5, -7, 7],
      tonicFloor: 0.72,
      textureFloor: 0.72,
      texturePeriod: 6,
    }),
  },
  {
    id: "freeze-chamber", group: "Ambient / Cinematic",
    name: "Freeze Chamber",
    attribution: "Spectral-freeze sustain · held chord in amber",
    hint: "Reed and air captured and frozen by the spectral-freeze block. A single held breath, suspended.",
    voiceLayers: ["reed", "air"],
    voiceLevels: { reed: 0.92, air: 0.6 },
    reedShape: "balanced",
    octaveRange: [2, 3],
    drift: 0.1,
    air: 0.52,
    time: 0.06,
    sub: 0.18,
    bloom: 0.7,
    glide: 0.1,
    lfoShape: "sine",
    lfoRate: 0.08,
    lfoAmount: 0.03,
    climateX: 0.38,
    climateY: 0.32,
    effects: ["freeze", "plate"],
    scale: "drone",
    tuningId: "custom:kirnberger-iii", relationId: "drone-triad",
    gain: 0.7,
    motionProfile: motionProfile({
      climateXRange: [0.32, 0.46],
      climateYRange: [0.24, 0.42],
      bloomRange: [0.6, 0.82],
      timeRange: [0.03, 0.1],
      driftRange: [0.06, 0.16],
      subRange: [0.1, 0.26],
      macroStep: 0.42,
      tonicWalk: "none",
      tonicIntervals: [],
      tonicFloor: 0.96,
      textureFloor: 0.88,
      texturePeriod: 8,
    }),
  },
  {
    id: "radigue-arp", group: "Minimal / Just",
    name: "Electronic Arcana",
    attribution: "Radigue-adjacent FM sustain · slow beating partials",
    hint: "Metallic FM + bell-metal at near-unison ratios. Slow beats between partials instead of melodic motion.",
    voiceLayers: ["fm", "metal"],
    voiceLevels: { fm: 0.9, metal: 0.55 },
    octaveRange: [2, 3],
    drift: 0.1,
    air: 0.3,
    time: 0.04,
    sub: 0.22,
    bloom: 0.52,
    glide: 0.06,
    lfoShape: "sine",
    lfoRate: 0.06,
    lfoAmount: 0.05,
    climateX: 0.34,
    climateY: 0.2,
    effects: ["plate", "hall"],
    scale: "drone",
    tuningId: "custom:31-tet", relationId: "harmonic-stack",
    fmRatio: 1.007,
    fmIndex: 3.2,
    fmFeedback: 0.22,
    gain: 0.7,
    motionProfile: motionProfile({
      climateXRange: [0.28, 0.42],
      climateYRange: [0.14, 0.28],
      bloomRange: [0.44, 0.62],
      timeRange: [0.02, 0.08],
      driftRange: [0.06, 0.16],
      subRange: [0.16, 0.32],
      macroStep: 0.4,
      tonicWalk: "none",
      tonicIntervals: [],
      tonicFloor: 0.92,
      textureFloor: 0.9,
      texturePeriod: 9,
    }),
  },
  {
    id: "fm-warm-organ", group: "Organ / Chamber",
    name: "Warm FM Organ",
    attribution: "2-op FM organ · woody, low-index",
    hint: "FM tuned warm: low index, octave ratio, soft feedback. Wood-panel organ rather than metal bell.",
    voiceLayers: ["fm", "reed"],
    voiceLevels: { fm: 0.88, reed: 0.42 },
    reedShape: "balanced",
    octaveRange: [2, 3],
    drift: 0.14,
    air: 0.34,
    time: 0.06,
    sub: 0.2,
    bloom: 0.44,
    glide: 0.12,
    lfoShape: "sine",
    lfoRate: 0.14,
    lfoAmount: 0.05,
    climateX: 0.38,
    climateY: 0.18,
    effects: ["hall", "tape"],
    scale: "drone",
    tuningId: "custom:werckmeister-iii", relationId: "drone-triad",
    fmRatio: 2.0,
    fmIndex: 1.4,
    fmFeedback: 0.08,
    gain: 0.74,
    motionProfile: motionProfile({
      climateXRange: [0.32, 0.46],
      climateYRange: [0.1, 0.26],
      bloomRange: [0.36, 0.54],
      timeRange: [0.03, 0.1],
      driftRange: [0.1, 0.22],
      subRange: [0.14, 0.3],
      macroStep: 0.5,
      tonicWalk: "rare",
      tonicIntervals: [-5, 5],
      tonicFloor: 0.76,
      textureFloor: 0.78,
      texturePeriod: 6,
    }),
  },
  {
    id: "noise-meditation", group: "Ambient / Cinematic",
    name: "Still Rain",
    attribution: "Meditative brown-noise field · contemplative, not industrial",
    hint: "Deep brown noise + air laid into a cistern. Soft, rainy, contemplative — no grind.",
    voiceLayers: ["noise", "air"],
    voiceLevels: { noise: 0.82, air: 0.58 },
    noiseColor: 0.85,
    octaveRange: [2, 3],
    drift: 0.08,
    air: 0.6,
    time: 0.04,
    sub: 0.22,
    bloom: 0.72,
    glide: 0.08,
    lfoShape: "sine",
    lfoRate: 0.06,
    lfoAmount: 0.04,
    climateX: 0.32,
    climateY: 0.36,
    effects: ["cistern", "plate"],
    scale: "drone",
    tuningId: "maqam-rast", relationId: "tonic-fourth",
    gain: 0.72,
    motionProfile: motionProfile({
      climateXRange: [0.26, 0.4],
      climateYRange: [0.28, 0.46],
      bloomRange: [0.62, 0.82],
      timeRange: [0.02, 0.08],
      driftRange: [0.06, 0.14],
      subRange: [0.16, 0.3],
      macroStep: 0.35,
      tonicWalk: "none",
      tonicIntervals: [],
      tonicFloor: 0.96,
      textureFloor: 0.92,
      texturePeriod: 9,
    }),
  },
  {
    id: "close-room", group: "Organ / Chamber",
    name: "Close Room",
    attribution: "Dry intimate chamber · one voice, one wall",
    hint: "Reed and breath in a small, near-dry room. Short plate, no hall. Meditation at arm's length.",
    voiceLayers: ["reed", "air"],
    voiceLevels: { reed: 0.9, air: 0.4 },
    reedShape: "balanced",
    octaveRange: [2, 3],
    drift: 0.14,
    air: 0.38,
    time: 0.05,
    sub: 0.14,
    bloom: 0.28,
    glide: 0.14,
    lfoShape: "sine",
    lfoRate: 0.18,
    lfoAmount: 0.05,
    climateX: 0.36,
    climateY: 0.1,
    effects: ["plate"],
    scale: "drone",
    tuningId: "meantone", relationId: "tonic-fourth",
    gain: 0.78,
    motionProfile: motionProfile({
      climateXRange: [0.3, 0.44],
      climateYRange: [0.06, 0.2],
      bloomRange: [0.22, 0.38],
      timeRange: [0.02, 0.08],
      driftRange: [0.1, 0.22],
      subRange: [0.08, 0.22],
      macroStep: 0.55,
      tonicWalk: "rare",
      tonicIntervals: [-5, 5],
      tonicFloor: 0.7,
      textureFloor: 0.74,
      texturePeriod: 6,
    }),
  },
  {
    id: "sub-chamber", group: "Minimal / Just",
    name: "Sub Chamber",
    attribution: "Low-register amp drone in a deep cistern",
    hint: "Amp sustain + air, dropped an octave, run through the cistern block. All floor, no ceiling.",
    voiceLayers: ["amp", "air"],
    voiceLevels: { amp: 0.95, air: 0.32 },
    octaveRange: [1, 2],
    drift: 0.18,
    air: 0.28,
    time: 0.04,
    sub: 0.6,
    bloom: 0.48,
    glide: 0.1,
    lfoShape: "sine",
    lfoRate: 0.09,
    lfoAmount: 0.05,
    climateX: 0.3,
    climateY: 0.18,
    effects: ["sub", "cistern"],
    scale: "drone",
    tuningId: "custom:otonal-16-32", relationId: "tonic-fifth",
    gain: 0.62,
    motionProfile: motionProfile({
      climateXRange: [0.24, 0.38],
      climateYRange: [0.12, 0.26],
      bloomRange: [0.38, 0.58],
      timeRange: [0.02, 0.08],
      driftRange: [0.12, 0.24],
      subRange: [0.5, 0.7],
      macroStep: 0.42,
      tonicWalk: "none",
      tonicIntervals: [],
      tonicFloor: 0.96,
      textureFloor: 0.86,
      texturePeriod: 8,
    }),
  },
  {
    id: "high-shimmer", group: "Ambient / Cinematic",
    name: "High Shimmer",
    attribution: "Bright metal + air in the shimmer block",
    hint: "Bell-metal and breath an octave up, fed into shimmer. Glacial, celestial, suspended high above the tonic.",
    voiceLayers: ["metal", "air"],
    voiceLevels: { metal: 0.88, air: 0.5 },
    octaveRange: [4, 5],
    drift: 0.1,
    air: 0.58,
    time: 0.06,
    sub: 0.04,
    bloom: 0.76,
    glide: 0.08,
    lfoShape: "sine",
    lfoRate: 0.1,
    lfoAmount: 0.05,
    climateX: 0.48,
    climateY: 0.36,
    effects: ["shimmer", "plate"],
    scale: "drone",
    tuningId: "harmonics", relationId: "harmonic-stack",
    gain: 0.78,
    motionProfile: motionProfile({
      climateXRange: [0.4, 0.56],
      climateYRange: [0.28, 0.46],
      bloomRange: [0.68, 0.88],
      timeRange: [0.03, 0.1],
      driftRange: [0.06, 0.16],
      subRange: [0, 0.1],
      macroStep: 0.45,
      tonicWalk: "rare",
      tonicIntervals: [7, -7, 12, -12],
      tonicFloor: 0.78,
      textureFloor: 0.82,
      texturePeriod: 6,
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
    // Lower wobble so the sparse metal modes stay consistently present
    // — previously 0.026 could drop partials to near-zero and make the
    // bowl feel quieter than the rest of the library.
    driftBias: { metal: 0.85, air: 0.9 },
    levelWobble: { metal: 0.01, air: 0.008 },
    wobbleRate: 0.45,
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
  "didgeridoo": materialProfile({
    driftBias: { air: 1.1, reed: 0.95 },
    levelWobble: { air: 0.06, reed: 0.015 },
    wobbleRate: 0.38,
    subPulse: 0.05,
  }),
  "sunn-amp-drone": materialProfile({
    driftBias: { amp: 1.05, reed: 0.98, metal: 1.08 },
    levelWobble: { amp: 0.018, reed: 0.012, metal: 0.025 },
    wobbleRate: 0.5,
    subPulse: 0.06,
  }),
  "tuvan-khoomei": materialProfile({
    driftBias: { reed: 1.02, metal: 1.08 },
    levelWobble: { reed: 0.022, metal: 0.03, air: 0.018 },
    wobbleRate: 0.62,
    shimmerPulse: 0.03,
  }),
  "alice-coltrane-devotional": materialProfile({
    driftBias: { reed: 0.95, piano: 1.03 },
    levelWobble: { reed: 0.02, piano: 0.018 },
    wobbleRate: 0.45,
    shimmerPulse: 0.04,
    subPulse: 0.03,
  }),
  "sarangi": materialProfile({
    driftBias: { reed: 1.1, tanpura: 1.05 },
    levelWobble: { reed: 0.025, tanpura: 0.012 },
    wobbleRate: 0.55,
    pluckRange: [0.9, 1.12],
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
  "cistern", "granular", "graincloud", "ringmod", "formant",
];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function jitter(value: number, spread: number, min = 0, max = 1, random = Math.random): number {
  return clamp(value + (random() * 2 - 1) * spread, min, max);
}

/**
 * mulberry32 — 32-bit seedable PRNG, ~2^32 period. Tiny and
 * deterministic; good enough for scene randomisation and mutation
 * perturbation where we just need reproducibility from a seed, not
 * cryptographic quality. Same seed ⇒ same sequence.
 */
/** FNV-1a hash of a preset id → 32-bit unsigned int. Used to derive a
 *  stable seed for the reverb IR PRNG so every preset always produces
 *  the same hall / cistern impulse across reloads. */
export function hashPresetIdToSeed(id: string): number {
  let h = 0x811C9DC5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Perturb a scene snapshot's numeric parameters by a given intensity
 * (0..1 = perturbation range, NOT probability). Booleans and
 * categorical fields (effects, lfoShape, scale, voiceLayers, tuning)
 * are left untouched. Result is clamped to each field's natural range
 * so the output is always valid and never contains NaN.
 *
 * Voice levels are only perturbed for currently-active layers.
 */
export function mutateScene(
  current: DroneSessionSnapshot,
  intensity: number,
  random: () => number = Math.random,
): DroneSessionSnapshot {
  const amt = Math.max(0, Math.min(1, intensity));
  const j01 = (v: number) => clamp(v + (random() - 0.5) * 2 * amt, 0, 1);
  const jRange = (v: number, lo: number, hi: number) => {
    const span = hi - lo;
    return clamp(v + (random() - 0.5) * 2 * amt * span, lo, hi);
  };
  const voiceLevels = { ...current.voiceLevels };
  for (const t of ALL_VOICE_TYPES) {
    if (current.voiceLayers[t]) voiceLevels[t] = j01(current.voiceLevels[t]);
  }
  return {
    ...current,
    voiceLevels,
    drift: j01(current.drift),
    air: j01(current.air),
    time: j01(current.time),
    sub: j01(current.sub),
    bloom: j01(current.bloom),
    glide: j01(current.glide),
    climateX: j01(current.climateX),
    climateY: j01(current.climateY),
    lfoRate: jRange(current.lfoRate, 0.05, 8),
    lfoAmount: j01(current.lfoAmount),
    presetMorph: j01(current.presetMorph),
    evolve: j01(current.evolve),
    pluckRate: jRange(current.pluckRate, 0.2, 4),
    // NOISE COLOR — jitter gently within the same color family so
    // mutated scenes don't jump from white to sub-rumble.
    noiseColor: j01(current.noiseColor),
  };
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
    piano: false,
    fm: false,
    amp: false,
    noise: false,
  };
  const voiceLevels: Record<VoiceType, number> = {
    tanpura: 1,
    reed: 1,
    metal: 1,
    air: 1,
    piano: 1,
    fm: 1,
    amp: 1,
    noise: 1,
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
    tuningId: preset.tuningId ?? null,
    relationId: preset.relationId ?? null,
    fineTuneOffsets: [],
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
    noiseColor: 0.3,
    presetTrim: preset.gain ?? 1,
    fmRatio: preset.fmRatio ?? 2.0,
    fmIndex: preset.fmIndex ?? 2.4,
    fmFeedback: preset.fmFeedback ?? 0,
    seed: 0,
    journey: null,
    partner: { ...DEFAULT_PARTNER },
  };
}

export function createSafeRandomScene(
  root: DroneSessionSnapshot["root"],
  fallbackOctaveRange: readonly [number, number],
  random = Math.random,
): { preset: Preset; snapshot: DroneSessionSnapshot } {
  const safePresets = SAFE_RANDOM_PRESET_IDS
    .map((id) => PRESETS.find((preset) => preset.id === id) ?? null)
    .filter((preset): preset is Preset => preset !== null);
  const presetPool = safePresets.length > 0 ? safePresets : PRESETS;
  const preset = presetPool[Math.floor(random() * presetPool.length)];

  // Prefer the preset's authored octave range if set, otherwise the
  // library-wide default passed by the caller.
  const range = preset.octaveRange ?? fallbackOctaveRange;
  const [lo, hi] = range;
  const octave = lo + Math.floor(random() * (hi - lo + 1));

  return {
    preset,
    snapshot: createPresetVariation(preset, root, octave, random),
  };
}

/** Deterministic first-launch scene — always serves the Welcome
 *  preset at a fixed tonic/octave (C3) so the very first sound mdrone
 *  makes for a new user is reliably beautiful, not a coin flip from
 *  the arrival pool. Falls back to the arrival picker if, for any
 *  reason, the welcome preset isn't present. */
export function createWelcomeScene(
  fallbackOctaveRange: readonly [number, number],
  random = Math.random,
): { preset: Preset; snapshot: DroneSessionSnapshot } {
  const welcome = PRESETS.find((p) => p.id === "welcome");
  if (welcome) {
    const range = welcome.octaveRange ?? fallbackOctaveRange;
    const [lo, hi] = range;
    const octave = lo + Math.floor(random() * (hi - lo + 1));
    return { preset: welcome, snapshot: createPresetVariation(welcome, "C", octave, random) };
  }
  return createArrivalScene("C", fallbackOctaveRange, random);
}

/**
 * Arrival-curated scene — picks from ARRIVAL_PRESET_IDS so the first
 * impression is reliably beautiful within ~3 seconds at the default
 * tonic/octave. Used by "Start New" every time, and by RND for the
 * first three calls of a session (the useSceneManager hook tracks
 * the count). After that, RND falls through to createSafeRandomScene
 * so users reach the full library variety.
 *
 * Falls back to the broader safe-random pool if the arrival pool
 * resolves empty (defensive).
 */
export function createArrivalScene(
  root: DroneSessionSnapshot["root"],
  fallbackOctaveRange: readonly [number, number],
  random = Math.random,
): { preset: Preset; snapshot: DroneSessionSnapshot } {
  const arrivalPresets = ARRIVAL_PRESET_IDS
    .map((id) => PRESETS.find((preset) => preset.id === id) ?? null)
    .filter((preset): preset is Preset => preset !== null);
  if (arrivalPresets.length > 0) {
    const preset = arrivalPresets[Math.floor(random() * arrivalPresets.length)];
    const range = preset.octaveRange ?? fallbackOctaveRange;
    const [lo, hi] = range;
    const octave = lo + Math.floor(random() * (hi - lo + 1));
    const snapshot = createPresetVariation(preset, root, octave, random);
    // Arrival presets should land as if the user had clicked GOOD DRONE:
    // authored tuning/relation preserved, but with subtle ±2–5¢ detune
    // per interval so every voice "breathes" on first impression.
    if (snapshot.relationId) {
      snapshot.fineTuneOffsets = sampleSubtleOffsets(snapshot.relationId, random);
    }
    return { preset, snapshot };
  }
  // Fallback to the broader pool
  return createSafeRandomScene(root, fallbackOctaveRange, random);
}

/**
 * DroneView-side state setters that a preset needs to update so the
 * UI reflects the new scene. These are passed in from the component
 * rather than imported so presets.ts stays React-free.
 */
export interface PresetUiSetters {
  setVoiceLayers: (map: Record<VoiceType, boolean>) => void;
  setVoiceLevels: (map: Record<VoiceType, number>) => void;
  setNoiseColor: (v: number) => void;
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
  setTuning: (id: TuningId | null) => void;
  setRelation: (id: RelationId | null) => void;
  setFineTuneOffsets: (offsets: number[]) => void;
  setEffectEnabled: (id: EffectId, on: boolean) => void;
  /** Optional ENTRAIN state setter. Called only when the preset
   *  carries an `entrain` field. */
  setEntrain?: (state: EntrainState) => void;
  /** Optional pre-resolved interval list for the engine build path.
   *  Lets callers preserve extra derived layers (e.g. partner drone)
   *  without forcing a second rebuild after preset apply. */
  engineIntervals?: number[];
}

/**
 * Apply a preset to the engine and the UI in one pass. Any effect
 * not in the preset's `effects` list is toggled off so scenes swap
 * cleanly rather than accumulating. Tonic stays user-chosen.
 */
export function applyPreset(engine: AudioEngine | null, preset: Preset, ui: PresetUiSetters): void {
  // Voice layers — turn on the listed ones, off the rest.
  const layers: Record<VoiceType, boolean> = { tanpura: false, reed: false, metal: false, air: false, piano: false, fm: false, amp: false, noise: false };
  const levels: Record<VoiceType, number> = { tanpura: 1, reed: 1, metal: 1, air: 1, piano: 1, fm: 1, amp: 1, noise: 1 };
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
  // 1.4 was pushing every preset into the drive + limiter by default —
  // the active-voice sum plus reverb wet stacks meant the limiter
  // engaged constantly, producing the "saturated all the time"
  // character users flagged. 1.0 keeps the voice stack at unity; the
  // reverb wet (now additive, ~0.22 per reverb at AIR 0.4) layers on
  // top without slamming the chain.
  const ACTIVE_LEVEL_BUDGET = 1.0;
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
  ui.setNoiseColor(preset.noiseColor ?? 0.3);

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

  // LFO 2 · FLICKER — PULSE presets carry an `entrain` field; others
  // must reset to disabled so flicker doesn't leak across categories.
  if (ui.setEntrain) ui.setEntrain(preset.entrain ?? { ...DEFAULT_ENTRAIN, enabled: false });

  // Climate
  ui.setClimate(preset.climateX, preset.climateY);

  // Mode — apply microtuning if the preset carries it, else legacy scale.
  ui.setScale(preset.scale);
  ui.setTuning(preset.tuningId ?? null);
  ui.setRelation(preset.relationId ?? null);
  ui.setFineTuneOffsets([]);

  const intervals = (preset.tuningId && preset.relationId)
    ? resolveTuning(preset.tuningId, preset.relationId)
    : SCALE_INTERVALS[preset.scale] ?? [0];
  const engineIntervals = ui.engineIntervals ?? intervals;

  if (engine) {
    // (A) Apply per-preset loudness trim before the scene builds so
    // the new voices come in at the corrected level.
    engine.setPresetTrim(preset.gain ?? 1);
    engine.setPresetMotionProfile(preset.motionProfile);
    engine.setPresetMaterialProfile(getPresetMaterialProfile(preset));
    // Reed shape must be set before applyDroneScene (which rebuilds
    // voices) so the reed worklet picks up the new harmonic profile.
    engine.setReedShape(preset.reedShape ?? "odd");
    engine.setFmRatio?.(preset.fmRatio ?? 2.0);
    engine.setFmIndex?.(preset.fmIndex ?? 2.4);
    engine.setFmFeedback?.(preset.fmFeedback ?? 0);
    // Resonant-comb feedback — reset each preset so a hot previous
    // scene doesn't leak. Default 0.68 matches FxChain's initial value.
    engine.setCombFeedback?.(preset.combFeedback ?? 0.68);
    // Parallel reverb send levels — reset every preset so stale sends
    // from a previous scene don't leak through.
    engine.setParallelSends(preset.parallelSends ?? {});
    // Seed the reverb IR PRNG from the preset id so hall / cistern
    // impulses are deterministic across reloads of the same scene.
    engine.setReverbSeed?.(hashPresetIdToSeed(preset.id));
    engine.applyDroneScene(layers, levels, engineIntervals);
  }

  // Effects — turn on the listed ones, off the rest. Freeze is the
  // exception: even with the ring buffer always filling (see FxChain
  // freeze wiring), the *new* preset's voices need a moment to ramp
  // into the ring before the snapshot fires, otherwise the freeze
  // captures the previous scene's tail or near-silence on first
  // launch. Defer freeze enable by ~3 s so the ring holds steady-
  // state audio of the new voices when active flips up.
  if (pendingFreezeEnableTimer !== null) {
    clearTimeout(pendingFreezeEnableTimer);
    pendingFreezeEnableTimer = null;
  }
  const active = new Set(preset.effects);
  for (const id of ALL_EFFECT_IDS) {
    if (id === "freeze") continue;
    ui.setEffectEnabled(id, active.has(id));
  }
  if (active.has("freeze")) {
    ui.setEffectEnabled("freeze", false);
    pendingFreezeEnableTimer = setTimeout(() => {
      pendingFreezeEnableTimer = null;
      ui.setEffectEnabled("freeze", true);
    }, FREEZE_PRESET_DEFER_MS) as unknown as number;
  } else {
    ui.setEffectEnabled("freeze", false);
  }
}

const FREEZE_PRESET_DEFER_MS = 3000;
// Module-scoped cancel token — applyPreset cancels any pending
// freeze enable from a prior preset call so a quick A→B switch
// (where B has no freeze) doesn't get its freeze re-enabled by a
// stale timer from A.
let pendingFreezeEnableTimer: number | null = null;
