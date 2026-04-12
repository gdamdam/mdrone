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

export type PresetGroup =
  | "Sacred / Ritual"
  | "Minimal / Just"
  | "Organ / Chamber"
  | "Ambient / Cinematic"
  | "Noise / Industrial";

export interface Preset {
  id: string;
  name: string;
  hint: string;
  /** Named inspiration / creator reference, shown in the tooltip. */
  attribution: string;
  /** Genre/lineage group for the preset grid UI. */
  group: PresetGroup;

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
 * Startup pool — a small curated set of presets that reliably create
 * a beautiful, warm first impression. Used only by "Start New".
 * Biased toward beauty, atmosphere, and clarity over edge variety.
 */
export const STARTUP_PRESET_IDS = [
  "tanpura-drone",
  "shruti-box",
  "deep-listening",
  "eno-airport",
  "frahm-solo",
  "malone-organ",
  "stars-of-the-lid",
  "budd-harold",
  "ritual-tanpura-shruti",
  "fm-glass-bell",
  "oliveros-accordion",
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
  "hecker-virgins",
  "fennesz-endless",
  "biosphere-substrata",
  "basinski-disintegration",
  "budd-harold",
  "frahm-solo",
  "grouper-dragging",
  "arkbro-chords",
  "young-well-tuned",
  "lamb-prisma",
  "sotl-tired-eyes",
  "ritual-tanpura-shruti",
  "fm-glass-bell",
  "fm-gong",
  "marconi-weightless",
  "liles-closed-doors",
  "liles-submariner",
  "palestine-strumming",
  "oliveros-accordion",
  "conrad-bowed",
  "niblock-wall",
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
    hint: "A lone tanpura with jawari buzz. The archetypal Indian string drone — rooted, overtone-rich, unadorned, with only a faint plate room around it.",
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
    id: "shruti-box", group: "Sacred / Ritual",
    name: "Shruti Box",
    attribution: "Indian devotional · reed bellows",
    hint: "Harmonium / shruti-box reed sustain. Warm, woody, devotional. Balanced reed shape (even + odd harmonics, like real free-reed instruments). A slow breath modulation mimics the bellows; hall + tape give it a wooden room.",
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
    id: "malone-organ", group: "Organ / Chamber",
    name: "Kali Organ",
    attribution: "Minimal pipe organ · meantone stillness",
    hint: "Reed (balanced harmonic stack — even + odd, pipe-organ-like) in meantone tuning with slow chord morphs. Kali Malone's Sacrificial Code — architectural, glacial, no bell character.",
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
    gain: 1.02,
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
    hint: "Pure sine tones (reed.shape = sine) in just 5-limit intervals. The beating between tones IS the composition — La Monte Young & Marian Zazeela's Dream House, uncoloured.",
    tuningId: "just5", relationId: "drone-triad",
    voiceLayers: ["reed", "air"],
    voiceLevels: { reed: 1, air: 0.1 },
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
    id: "deep-listening", group: "Organ / Chamber",
    name: "Deep Listening",
    attribution: "Cistern reverb · attentive breathing",
    hint: "Reed and air in the cistern — Pauline Oliveros's Fort Worden, 28-second tail. A single breath fills the whole space.",
    tuningId: "equal", relationId: "unison",
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
    id: "stone-organ", group: "Organ / Chamber",
    name: "Stone Organ",
    attribution: "Dark nave organ · liturgical pressure",
    hint: "Solo balanced reed in a dark nave — maximum sub weight, near-zero motion, pressure over warmth. No metal (dark organ = deep reed pipes, not bells). Stricter and heavier than Kali Organ.",
    tuningId: "meantone", relationId: "drone-triad",
    voiceLayers: ["reed"],
    voiceLevels: { reed: 1 },
    reedShape: "balanced",
    octaveRange: [1, 2],
    drift: 0.06,
    air: 0.36,
    time: 0.03,
    sub: 0.62,        // heavier sub for nave pressure
    bloom: 0.62,
    glide: 0.26,
    lfoShape: "sine",
    lfoRate: 0.05,
    lfoAmount: 0.02,
    climateX: 0.12,   // darker
    climateY: 0.06,
    effects: ["hall", "tape"],
    scale: "drone",
    gain: 1.1,
    motionProfile: motionProfile({
      climateXRange: [0.1, 0.22],
      climateYRange: [0.05, 0.12],
      bloomRange: [0.56, 0.7],
      timeRange: [0.02, 0.06],
      driftRange: [0.05, 0.12],
      // subRange capped — no comb or sub effect here so it's already
      // safer than the chained presets, but we trim to 0.52 max as a
      // library-wide "no hot sub on evolve" rule.
      subRange: [0.4, 0.52],
      macroStep: 0.34,
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
    hint: "Reed (bowed-string shape = even harmonics) + air stacked as a sustained minor triad with slow ~25 s amplitude swells. Plate + hall + tape give the warm recording body of Stars of the Lid's looped strings.",
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
    gain: 0.88,
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
    attribution: "Requiem strings · glacial minor swells · cathedral",
    hint: "Stars of the Lid's Requiem for Dying Mothers — layered bowed strings in minor, barely moving, cathedral-deep. PolyBLEP sawtooth reed (even shape) for dense string harmonics, thick air bed, no distortion. Tape wow for the looped-strings drift, plate + hall for the endless reverberant space. Funereal, slow, heavy with beauty.",
    tuningId: "just5", relationId: "minor-triad",
    voiceLayers: ["reed", "air"],
    voiceLevels: { reed: 1, air: 0.45 },
    reedShape: "even",
    octaveRange: [2, 3],
    drift: 0.06,      // near-static — the strings barely waver
    air: 0.78,        // cathedral-saturated, the reverb IS the sound
    time: 0.03,       // glacial filter movement
    sub: 0.2,         // gentle low weight, not boomy
    bloom: 0.98,      // ~10 s fade in — the strings emerge from nothing
    glide: 0.75,      // very long pitch transitions
    lfoShape: "sine",
    lfoRate: 0.018,   // ~55 s swell — one breath per minute
    lfoAmount: 0.14,  // the strings inhale and exhale slowly
    climateX: 0.32,   // dark, cold
    climateY: 0.12,   // very still
    // tape + wow for looped-string drift body; plate + hall for the
    // cathedral depth. No amp, no shimmer — SOTL is pure strings.
    effects: ["tape", "wow", "plate", "hall"],
    parallelSends: { hall: 0.5, plate: 0.25 },
    scale: "minor",
    gain: 0.8,
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
    hint: "The most common real-world drone setup: tanpura plucks anchoring a shruti-box reed organ. Just intonation, tonic + fifth, warm plate reverb. The sound of a practice room before the raga begins.",
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
    gain: 0.9,
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
    id: "radigue-drift", group: "Minimal / Just",
    name: "Radig Drift",
    attribution: "Pure sine drone · microscopic motion",
    hint: "A single sine tone (reed.shape = sine), dry, crystalline. The Éliane Radigue / ARP 2500 lineage — drift happens microscopically, the room stays close and uncoloured.",
    tuningId: "harmonics", relationId: "harmonic-stack",
    voiceLayers: ["reed"],
    voiceLevels: { reed: 1 },
    reedShape: "sine",
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
    id: "eno-airport", group: "Ambient / Cinematic",
    name: "Terminal Airport",
    attribution: "Pure 5-limit ambient · piano + pad · long decay",
    hint: "Piano (for the 1/1-style looped piano figures) over reed pad and a whisper of air, all in just 5-limit intervals. Deep hall + plate + tape for the sunlit-departure-lounge feel of Brian Eno's Music for Airports — no shimmer, no bells.",
    tuningId: "just5", relationId: "drone-triad",
    voiceLayers: ["piano", "reed", "air"],
    voiceLevels: { piano: 1, reed: 0.15, air: 0.2 },
    octaveRange: [3, 4],
    drift: 0.12,      // low for smooth harmonics, no partial clash
    air: 0.52,
    time: 0.08,
    sub: 0.18,
    bloom: 0.82,      // Eno's defining long decays
    glide: 0.6,
    lfoShape: "sine",
    lfoRate: 0.05,    // very slow, near-stationary
    lfoAmount: 0.06,
    climateX: 0.56,
    climateY: 0.16,
    // hall + plate + tape: no shimmer (its pitch-shifted copies were
    // reading as cold/dissonant — wrong for 1978 Eno).
    effects: ["hall", "plate", "tape"],
    // just5 instead of pentatonic: pentatonic's M2 (200¢) beats against
    // the root and 5th. just5 is root + 5-limit major 3rd + 5th — fully
    // consonant, beating-free, warm.
    scale: "just5",
    gain: 0.98,
    motionProfile: motionProfile({
      climateXRange: [0.48, 0.66],
      climateYRange: [0.1, 0.22],
      bloomRange: [0.74, 0.92],
      timeRange: [0.04, 0.1],
      driftRange: [0.08, 0.18],
      subRange: [0.1, 0.22],
      macroStep: 0.58,
      tonicWalk: "rare",
      tonicIntervals: [-5, 5],
      tonicFloor: 0.56,
      textureFloor: 0.72,
      texturePeriod: 5,
    }),
  },
  {
    id: "buddhist-monk-drone", group: "Sacred / Ritual",
    name: "Low Chant",
    attribution: "Throat-singing overtone halo · low fundamental",
    hint: "Deep reed fundamental with a prominent inharmonic metal halo above — the defining overtone shimmer of Gyuto-style throat singing. Comb resonance locks the harmonics to the root.",
    tuningId: "equal", relationId: "unison",
    voiceLayers: ["reed", "metal", "air"],
    voiceLevels: { reed: 1, metal: 0.5, air: 0.14 },
    octaveRange: [1, 2],
    drift: 0.1,       // low drift keeps reed stable under comb
    air: 0.42,
    time: 0.05,
    sub: 0.42,        // trimmed from 0.58 — comb amplifies LF at peak
    bloom: 0.5,
    glide: 0.22,
    lfoShape: "sine",
    lfoRate: 0.07,
    lfoAmount: 0.05,
    climateX: 0.18,
    climateY: 0.08,
    // formant + comb serial on the dry voice for the throat-singing
    // resonance. Hall via parallel send preserves source energy
    // instead of running 4 serial effects that attenuated ~6 dB.
    effects: ["comb", "formant"],
    parallelSends: { hall: 0.4, plate: 0.2 },
    scale: "drone",
    gain: 1.05,
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
    hint: "Metal bowl modes over a low sine-reed fundamental — the continuous rim-friction tone plus the inharmonic mode cloud above it. Circular, resonant, not a bright bell.",
    tuningId: "harmonics", relationId: "unison",
    voiceLayers: ["metal", "reed", "air"],
    voiceLevels: { metal: 1, reed: 0.22, air: 0.24 },
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
    gain: 1.2,
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
    id: "coil-time-machines", group: "Noise / Industrial",
    name: "Time Machines",
    attribution: "Ceremonial single-note trance · suspended time",
    hint: "A low single-note ritual drone with narcotic stillness. Reed body, a whisper of FM for the Coil synth character, almost no decorative movement — just the faintest tape-flange rotation.",
    tuningId: "equal", relationId: "unison",
    voiceLayers: ["reed", "fm", "air"],
    voiceLevels: { reed: 0.95, fm: 0.28, air: 0.18 },
    octaveRange: [1, 2],
    drift: 0.08,
    air: 0.38,
    time: 0.04,
    sub: 0.62,        // was 0.75 — still narcotic but no LF buildup under wow
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
      // subRange walks around the new safer static value (0.62). No sub
      // effect here, but wow modulates delays so high sub amplifies LF
      // pumping under the flange.
      subRange: [0.5, 0.68],
      macroStep: 0.24,
      tonicWalk: "none",
      tonicIntervals: [],
      tonicFloor: 1,
      textureFloor: 0.94,
      texturePeriod: 8,
    }),
  },
  // ─── FM showcase: Glass Bell — high-ratio FM bell drone ─────────────
  {
    id: "fm-glass-bell", group: "Minimal / Just",
    name: "Glass Bell",
    attribution: "FM bell · crystalline inharmonic overtones",
    hint: "FM synthesis at 3.5:1 ratio with high modulation index producing dense inharmonic bell sidebands. The index LFO makes the bell breathe — sidebands bloom and recede over tens of seconds. Metallic, bright, crystalline.",
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
    gain: 0.92,
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
    hint: "Low-ratio FM (1.4:1) producing deep gong-like tones with dense sidebands. Layered with metal bowl partials for bronze ensemble character. Hall reverb for temple space.",
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
    gain: 0.95,
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
    hint: "Pure spectral texture — air and metal drifting through comb + tape + hall, no identifiable pitched sources. Nurse With Wound's Soliloquy for Lilith.",
    tuningId: "equal", relationId: "unison",
    voiceLayers: ["air", "metal"],
    voiceLevels: { air: 1, metal: 0.24 },
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
    gain: 0.78,
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
    hint: "Distorted amp voice for the saturated sustain, reed for body, metal for the feedback halo — the sustained-amp pressure of drone metal (Sunn O))), Earth), swelling in slow amplitude breaths.",
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
    gain: 0.85,
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
    hint: "Dense air texture with inharmonic metal crackle — Merzbow's ambient side. No pitched source, just spectral weather with tape wear, comb glare and freeze sustain underneath.",
    tuningId: "equal", relationId: "unison",
    voiceLayers: ["air", "metal"],
    voiceLevels: { air: 1, metal: 0.55 },
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
    gain: 0.88,
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
    hint: "Air as a wind-field texture over a soft reed rumble. Comb + wow give it a frozen howl, tape a worn edge — Thomas Köner's deep-cold stillness. Sub + drift kept low because comb has 0.85 feedback and will blow up if fed too much low-end energy.",
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
    effects: ["hall", "comb", "wow", "tape", "granular"],
    scale: "drone",
    gain: 0.88,
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
    hint: "Tanpura + metal bowl cloud in a long hall. Klaus Wiese's Baraka / Sevenfold Sanctuary — layered bowls beating against a tanpura drone, extreme stillness, no motion.",
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
    gain: 1.0,
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
    hint: "Reed (pipe-organ shape) pushed through amp distortion into hall, with a classic graincloud for the fragmented pipe-organ stutter on top. Tim Hecker's Ravedeath 1972 — a church organ recorded in Reykjavik, distorted and compressed until it breaks.",
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
    gain: 0.88,
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

  // ─── Tim Hecker — Virgins: granular piano minor ─────────────────────
  {
    id: "hecker-virgins", group: "Noise / Industrial",
    name: "Virgins",
    attribution: "Ascending orchestral strings · spectral shimmer",
    hint: "Reed (bowed-string shape) + piano accents through shimmer and hall. Tim Hecker's Virgins — orchestral strings and woodwinds ascending through granular processing. Brighter and more spectral than Ravedeath.",
    tuningId: "equal", relationId: "drone-triad",
    voiceLayers: ["reed", "piano"],
    voiceLevels: { reed: 1, piano: 0.35 },
    reedShape: "even",
    octaveRange: [3, 4],
    drift: 0.2,
    air: 0.55,
    time: 0.12,
    sub: 0.15,
    bloom: 0.7,
    glide: 0.6,
    lfoShape: "sine",
    lfoRate: 0.06,
    lfoAmount: 0.08,
    climateX: 0.55,
    climateY: 0.35,
    // Shimmer for the ascending spectral quality of Virgins;
    // hall for orchestral space. No amp — Virgins is less
    // distorted than Ravedeath, more about spectral density.
    effects: ["tape", "shimmer", "hall"],
    parallelSends: { hall: 0.35 },
    scale: "minor",
    gain: 0.85,
    motionProfile: motionProfile({
      climateXRange: [0.28, 0.4],
      climateYRange: [0.14, 0.28],
      bloomRange: [0.76, 0.92],
      timeRange: [0.04, 0.12],
      driftRange: [0.1, 0.22],
      subRange: [0.18, 0.32],
      macroStep: 0.56,
      tonicWalk: "rare",
      tonicIntervals: [-5, 5],
      tonicFloor: 0.6,
      textureFloor: 0.72,
      texturePeriod: 5,
    }),
  },

  // ─── Andrew Liles — dark tape-warped drone (industrial facet) ───────
  {
    id: "liles-closed-doors", group: "Noise / Industrial",
    name: "Closed Doors",
    attribution: "Tape-warped reed + metal · deep chamber · unheimlich drift",
    hint: "Andrew Liles's solo / Nurse With Wound-adjacent tape work — reed (odd, clarinet/shruti) + metal + air, heavily tape-warped with wow and granular cloud. Unlike nww-soliloquy (pure spectral), this stays tonal but deeply processed. Cistern + comb for the shruti-through-a-pipe resonance; chromatic tonic walk every so often for the Liles 'something is wrong' drift.",
    tuningId: "just5", relationId: "tonic-fifth",
    voiceLayers: ["reed", "metal", "air"],
    voiceLevels: { reed: 1, metal: 0.32, air: 0.3 },
    reedShape: "odd",
    octaveRange: [2, 3],
    drift: 0.38,       // tape warp + metal partial wander
    air: 0.6,
    time: 0.08,
    sub: 0.36,
    bloom: 0.86,
    glide: 0.55,
    lfoShape: "sine",
    lfoRate: 0.05,     // ~20 s — unsettling rather than restful
    lfoAmount: 0.14,
    climateX: 0.32,    // cold
    climateY: 0.24,    // dim
    effects: ["tape", "wow", "comb", "cistern", "granular"],
    parallelSends: { cistern: 0.35 },
    scale: "minor",
    gain: 0.86,
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
    hint: "Reed (even harmonics — closest to processed guitar) with long bloom and glide through plate + hall + tape, plus a classic graincloud for the glitchy grain-stutter that defines Fennesz's processed-laptop-guitar sound. Endless Summer — continuous warm melodic smear under a grain shimmer.",
    tuningId: "equal", relationId: "drone-triad",
    voiceLayers: ["reed"],
    voiceLevels: { reed: 1 },
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
    effects: ["plate", "hall", "tape", "graincloud"],
    scale: "major",
    gain: 0.95,
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

  // ─── Biosphere — Substrata: stretched arctic field ──────────────────
  {
    id: "biosphere-substrata", group: "Ambient / Cinematic",
    name: "Substrata",
    attribution: "Arctic wind field · warm synth underneath",
    hint: "Air voice as primary — wind-gusting amplitude walk gives arctic field-recording breath. Reed warmth underneath, not on top. Biosphere's Substrata: the cold wind IS the music, the synth pad is the warmth below it.",
    tuningId: "equal", relationId: "tonic-fifth",
    voiceLayers: ["air", "reed"],
    voiceLevels: { air: 1, reed: 0.35 },
    reedShape: "balanced",
    octaveRange: [2, 3],
    drift: 0.2,
    air: 0.45,
    time: 0.08,
    sub: 0.15,
    bloom: 0.75,
    glide: 0.5,
    lfoShape: "sine",
    lfoRate: 0.04,
    lfoAmount: 0.06,
    climateX: 0.28,
    climateY: 0.3,
    // Hall + tape + wow for the arctic tape-loop drift. No granular
    // (was barely audible). Wow gives the Substrata tape-warble.
    effects: ["hall", "tape", "wow"],
    scale: "minor",
    gain: 0.92,
    motionProfile: motionProfile({
      climateXRange: [0.2, 0.32],
      climateYRange: [0.16, 0.32],
      bloomRange: [0.7, 0.88],
      timeRange: [0.06, 0.14],
      driftRange: [0.14, 0.26],
      subRange: [0.26, 0.44],
      macroStep: 0.62,
      tonicWalk: "rare",
      tonicIntervals: [-5, 5],
      tonicFloor: 0.58,
      textureFloor: 0.66,
      texturePeriod: 5,
    }),
  },

  // ─── William Basinski — Disintegration Loops ────────────────────────
  {
    id: "basinski-disintegration", group: "Ambient / Cinematic",
    name: "Disintegration",
    attribution: "Decaying tape loop · oxide crumble",
    hint: "Solo reed (bowed-string shape) with tape degradation + wow flutter and an ordered graincloud for the fragmented tape-loop drop-outs — Basinski's Disintegration Loops. A single melodic string fragment eroding under tape wear. Dry, close-miked.",
    tuningId: "equal", relationId: "drone-triad",
    voiceLayers: ["reed"],
    voiceLevels: { reed: 1 },
    reedShape: "even",
    drift: 0.12,
    air: 0.35,        // drier — DL is close-miked studio, not big room
    time: 0.04,
    sub: 0.18,
    bloom: 0.82,
    glide: 0.5,
    lfoShape: "sine",
    lfoRate: 0.04,
    lfoAmount: 0.03,  // near-zero — tape speed IS the only modulation
    climateX: 0.38,   // slightly brighter start — DL darkens over time
    climateY: 0.14,
    // tape + wow = the degradation IS the composition. graincloud
    // added for the fragmented tape-loop drop-outs — ordered spawn
    // mode makes grains read consecutive chunks of the drone, which
    // is the correct model for Disintegration Loops' repeating loop
    // replaying with holes. No plate (too wet — DL is dry/close),
    // no piano (DL is strings/synth). Hall at low air gives room tone.
    effects: ["tape", "wow", "hall", "graincloud"],
    scale: "major",   // DL sits in ambiguous bright-melancholy, not minor
    gain: 0.95,
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

  // ─── Harold Budd — The Pearl / The Plateaux of Mirror ───────────────
  {
    id: "budd-harold", group: "Ambient / Cinematic",
    name: "Pearl",
    attribution: "Long-decay piano · infinite reverb tail",
    hint: "Piano with a reed bed. Dry piano attack + parallel hall wet tail — Harold Budd's Pearl / Plateaux of Mirror, where the piano stays definition-ful against an infinite reverb.",
    tuningId: "just5", relationId: "drone-triad",
    voiceLayers: ["piano", "reed"],
    voiceLevels: { piano: 1, reed: 0.3 },
    parallelSends: { hall: 0.4 },
    octaveRange: [3, 4],
    reedShape: "balanced",
    drift: 0.1,
    air: 0.6,
    time: 0.05,
    sub: 0.18,
    bloom: 0.88,
    glide: 0.55,
    lfoShape: "sine",
    lfoRate: 0.05,
    lfoAmount: 0.05,
    climateX: 0.44,
    climateY: 0.14,
    effects: ["plate", "hall", "tape"],
    scale: "just5",
    gain: 0.95,
    motionProfile: motionProfile({
      climateXRange: [0.36, 0.5],
      climateYRange: [0.1, 0.2],
      bloomRange: [0.82, 0.96],
      timeRange: [0.03, 0.08],
      driftRange: [0.08, 0.16],
      subRange: [0.14, 0.26],
      macroStep: 0.44,
      tonicWalk: "rare",
      tonicIntervals: [-5, 5],
      tonicFloor: 0.6,
      textureFloor: 0.72,
      texturePeriod: 6,
    }),
  },

  // ─── Nils Frahm — solo piano drone ──────────────────────────────────
  {
    id: "frahm-solo", group: "Ambient / Cinematic",
    name: "Solo",
    attribution: "Felt piano + sympathetic sustain",
    hint: "Piano with a faint sine-reed bed for sympathetic sustain — Nils Frahm Solo / Spaces. The reed simulates the sympathetic string resonance that makes a real piano hum between notes.",
    tuningId: "equal", relationId: "minor-triad",
    voiceLayers: ["piano", "reed"],
    voiceLevels: { piano: 1, reed: 0.15 },
    reedShape: "sine",
    parallelSends: { hall: 0.35 },
    octaveRange: [3, 4],
    drift: 0.08,
    air: 0.55,
    time: 0.05,
    sub: 0.2,
    bloom: 0.8,
    glide: 0.5,
    lfoShape: "sine",
    lfoRate: 0.06,
    lfoAmount: 0.04,
    climateX: 0.4,
    climateY: 0.12,
    effects: ["hall", "tape", "plate"],
    scale: "minor",
    gain: 1.02,
    motionProfile: motionProfile({
      climateXRange: [0.34, 0.46],
      climateYRange: [0.08, 0.18],
      bloomRange: [0.74, 0.9],
      timeRange: [0.03, 0.08],
      driftRange: [0.06, 0.12],
      subRange: [0.16, 0.26],
      macroStep: 0.4,
      tonicWalk: "rare",
      tonicIntervals: [-5, 5],
      tonicFloor: 0.62,
      textureFloor: 0.74,
      texturePeriod: 6,
    }),
  },

  // ─── Grouper — Dragging a Dead Deer Up a Hill ───────────────────────
  {
    id: "grouper-dragging", group: "Ambient / Cinematic",
    name: "Dragging",
    attribution: "Lo-fi piano + air · tape wear",
    hint: "Piano + air bed in tape + plate. Grouper's Dragging a Dead Deer — lo-fi piano under a veil of air and tape patina.",
    tuningId: "equal", relationId: "tonic-fifth",
    voiceLayers: ["piano", "air"],
    voiceLevels: { piano: 1, air: 0.5 },
    octaveRange: [3, 4],
    drift: 0.18,
    air: 0.55,
    time: 0.08,
    sub: 0.22,
    bloom: 0.78,
    glide: 0.45,
    lfoShape: "sine",
    lfoRate: 0.07,
    lfoAmount: 0.08,
    climateX: 0.34,
    climateY: 0.24,
    // tape + wow + air already give Grouper's lo-fi tape-veiled
    // quality. Smooth granular adds the fragmentary tape-loop
    // character of Dragging a Dead Deer — grains follow the drone
    // scale so the haze stays tonal with the piano + air bed.
    effects: ["tape", "plate", "hall", "wow", "granular"],
    scale: "minor",
    gain: 0.95,
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
    hint: "Marconi Union's Weightless (2011) — designed with sound therapists around slow descending bass intervals and sustained high pads. Piano for the sparse high pings, balanced reed for the pad bed, air for breath. Plate + hall + light tape — clean and spacious, no wow, no grain. Gentle descending tonic walk recreates the track's falling bass motion under a long glide.",
    tuningId: "just5", relationId: "drone-triad",
    voiceLayers: ["piano", "reed", "air"],
    voiceLevels: { piano: 0.72, reed: 1, air: 0.28 },
    reedShape: "balanced",
    octaveRange: [3, 4],
    drift: 0.1,        // clean, not wobbly — MU production is pristine
    air: 0.62,
    time: 0.05,
    sub: 0.3,
    bloom: 0.88,
    glide: 0.7,        // long — piano pings slide gracefully
    lfoShape: "sine",
    lfoRate: 0.02,     // ~50 s breath — Weightless is famously ~56 BPM slow
    lfoAmount: 0.1,    // subtle, not a strong swell
    climateX: 0.5,     // neutral
    climateY: 0.32,    // slightly lifted — MU is brighter than SOTL
    // No tape wow, no shimmer — MU recordings are clean. Light serial
    // tape only for a touch of analog warmth, not grain.
    effects: ["tape", "plate", "hall"],
    // Heavier parallel hall so the piano attacks stay defined against
    // a wide wet tail instead of being smeared through serial plate.
    parallelSends: { hall: 0.42 },
    scale: "minor",
    gain: 0.9,
    motionProfile: motionProfile({
      climateXRange: [0.44, 0.56],
      climateYRange: [0.26, 0.4],
      bloomRange: [0.78, 0.94],
      timeRange: [0.03, 0.08],
      driftRange: [0.06, 0.16],
      subRange: [0.22, 0.36],
      macroStep: 0.48,
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
    hint: "The quieter Liles — tonal, slow, tape-treated but without the unheimlich chromatic drift. Even-harmonic reed (bowed strings) + air + a thread of piano, through tape + plate + hall + cistern. Parallel cistern carries the deep chamber. Think The Dying Submariner or the quieter moments of My Long Accumulating Discontent.",
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
    gain: 0.84,
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
    id: "arkbro-chords", group: "Minimal / Just",
    name: "For Organ",
    attribution: "Meantone organ + brass · church stillness",
    hint: "Reed (balanced — organ pipes + brass warmth) in meantone tuning. Ellen Arkbro's For Organ and Brass — austere meantone chords in a church. Parallel hall for dry organ + wet tail. No metal (brass ≠ bowls).",
    tuningId: "meantone", relationId: "drone-triad",
    voiceLayers: ["reed", "air"],
    voiceLevels: { reed: 1, air: 0.1 },
    reedShape: "balanced",
    drift: 0.1,
    air: 0.48,
    time: 0.04,
    sub: 0.32,
    bloom: 0.78,
    glide: 0.6,
    lfoShape: "sine",
    lfoRate: 0.08,
    lfoAmount: 0.03,
    climateX: 0.3,
    climateY: 0.1,
    effects: ["hall", "tape"],
    parallelSends: { hall: 0.25 },
    scale: "meantone",
    gain: 1.02,
    motionProfile: motionProfile({
      climateXRange: [0.24, 0.36],
      climateYRange: [0.06, 0.14],
      bloomRange: [0.72, 0.88],
      timeRange: [0.02, 0.06],
      driftRange: [0.08, 0.14],
      subRange: [0.26, 0.4],
      macroStep: 0.34,
      tonicWalk: "none",
      tonicIntervals: [],
      tonicFloor: 1,
      textureFloor: 0.9,
      texturePeriod: 7,
    }),
  },

  // ─── La Monte Young — Well-Tuned Piano ──────────────────────────────
  {
    id: "young-well-tuned", group: "Minimal / Just",
    name: "Well-Tuned",
    attribution: "Harmonic-series piano · sympathetic sustain",
    hint: "Piano with a faint sine-reed bed for sympathetic sustain, in harmonic-series tuning. La Monte Young's Well-Tuned Piano — 7-limit retuned Bösendorfer, hours of resonant clouds.",
    tuningId: "harmonics", relationId: "harmonic-stack",
    voiceLayers: ["piano", "reed"],
    voiceLevels: { piano: 1, reed: 0.15 },
    reedShape: "sine",
    octaveRange: [3, 4],
    drift: 0.06,
    air: 0.4,
    time: 0.03,
    sub: 0.22,
    bloom: 0.82,
    glide: 0.55,
    lfoShape: "sine",
    lfoRate: 0.04,
    lfoAmount: 0.02,
    climateX: 0.32,
    climateY: 0.08,
    effects: ["hall", "plate"],
    scale: "harmonics",
    gain: 1.0,
    motionProfile: motionProfile({
      climateXRange: [0.26, 0.36],
      climateYRange: [0.06, 0.12],
      bloomRange: [0.78, 0.9],
      timeRange: [0.02, 0.06],
      driftRange: [0.04, 0.1],
      subRange: [0.16, 0.28],
      macroStep: 0.28,
      tonicWalk: "none",
      tonicIntervals: [],
      tonicFloor: 1,
      textureFloor: 0.92,
      texturePeriod: 8,
    }),
  },

  // ─── Catherine Lamb — microtonal chamber ────────────────────────────
  {
    id: "lamb-prisma", group: "Minimal / Just",
    name: "Prisma",
    attribution: "Spectral chamber · combination tones",
    hint: "Pure sine tones in harmonic-series tuning. Catherine Lamb's Prisma Interius — combination tones emerge from the beating between closely-spaced pure fundamentals. Dry, focused, spectral.",
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
    effects: ["plate", "hall"],
    // just5 — Lamb's tuning is spectral/harmonic, NOT maqam. just5
    // (root + 5-limit 3rd + 5th) is the closest approximation to her
    // combination-tone-derived intervals.
    scale: "just5",
    gain: 1.0,
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
    hint: "Bronze gong sustain layered with a near-harmonic saron reed in slendro pentatonic. The reed carries the pitched saron character that pure bowl modes can't; the metal adds the inharmonic gong halo.",
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
    gain: 1.05,
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
    hint: "A held oud-like reed sustained against a tonic drone in maqam rast with a faint breath bed. The microtonal half-flat third sits between major and minor — distinctly Arabic, neither western mode.",
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
    gain: 1.05,
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
    attribution: "Sufi zikr drone · breath + voice",
    hint: "A slow sufi-zikr ensemble — tanpura-like fundamental with a sustained reed voice in maqam rast. Glacial bloom, long hall, minimal motion. The microtonal third is the whole point: the mode that sits between major and minor.",
    voiceLayers: ["tanpura", "reed"],
    voiceLevels: { tanpura: 0.85, reed: 0.75 },
    reedShape: "odd",
    octaveRange: [2, 2],
    drift: 0.16,
    air: 0.45,
    time: 0.06,
    sub: 0.08,
    bloom: 0.55,
    glide: 0.22,
    lfoShape: "sine",
    lfoRate: 0.1,
    lfoAmount: 0.04,
    climateX: 0.42,
    climateY: 0.18,
    effects: ["plate", "hall"],
    scale: "drone",
    tuningId: "maqam-rast", relationId: "tonic-fifth",
    gain: 1.05,
    motionProfile: motionProfile({
      climateXRange: [0.36, 0.5],
      climateYRange: [0.12, 0.24],
      bloomRange: [0.48, 0.62],
      timeRange: [0.04, 0.1],
      driftRange: [0.12, 0.22],
      subRange: [0.05, 0.14],
      macroStep: 0.36,
      tonicWalk: "none",
      tonicIntervals: [],
      tonicFloor: 0.9,
      textureFloor: 0.88,
      texturePeriod: 9,
    }),
  },

  // ─── Charlemagne Palestine — overtone piano strumming ──────────────
  {
    id: "palestine-strumming", group: "Organ / Chamber",
    name: "Strumming",
    attribution: "Overtone piano · ascending shimmer clouds",
    hint: "Charlemagne Palestine's strumming technique — sustained piano at high bloom with shimmer feeding overtones back into the harmonic series. The piano becomes an overtone generator, not a melody instrument.",
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
    gain: 0.9,
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
    hint: "Pauline Oliveros's accordion practice — sustained odd-harmonic reed with bellows breath, formant vowel resonance, dry close room. No cavernous reverb, no shimmer. The instrument in a room, breathing.",
    tuningId: "just5", relationId: "unison",
    voiceLayers: ["reed", "air"],
    voiceLevels: { reed: 1, air: 0.1 },
    reedShape: "odd",
    octaveRange: [2, 3],
    drift: 0.12,
    air: 0.2,
    time: 0.04,
    sub: 0.1,
    bloom: 0.45,
    glide: 0.2,
    lfoShape: "sine",
    lfoRate: 0.18,
    lfoAmount: 0.08,
    climateX: 0.4,
    climateY: 0.15,
    effects: ["formant", "plate"],
    scale: "drone",
    gain: 1.0,
    motionProfile: motionProfile({
      climateXRange: [0.34, 0.48],
      climateYRange: [0.1, 0.22],
      bloomRange: [0.38, 0.55],
      timeRange: [0.03, 0.07],
      driftRange: [0.08, 0.18],
      subRange: [0.06, 0.15],
      macroStep: 0.3,
      tonicWalk: "none",
      tonicFloor: 1,
      textureFloor: 0.85,
      texturePeriod: 8,
    }),
  },

  // ─── Tony Conrad — bowed violin drone ──────────────────────────────
  {
    id: "conrad-bowed", group: "Minimal / Just",
    name: "Bowed Drone",
    attribution: "Bowed violin · beating unisons · Theatre of Eternal Music",
    hint: "Tony Conrad's bowed violin drone — even-harmonic PolyBLEP sawtooth at high drift so close-tuned strings beat against each other. Harmonics tuning, harmonic-stack intervals. Minimal FX — the beating IS the composition.",
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
    gain: 0.95,
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
    id: "eleh-descent", group: "Noise / Industrial",
    name: "Descent",
    attribution: "Pure electronic drone · sub-heavy · no instrument reference",
    hint: "Eleh-style pure electronic drone. FM + sine reed, sub-heavy, minimal FX. No instrument imitation — just harmonic stacking, low weight, and slow spectral movement. The sound of electricity sustaining.",
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
    gain: 1.0,
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
    hint: "Phill Niblock's wall of close-tuned instruments. Even-harmonic PolyBLEP reed in drone-triad with very high drift — the partials wander in pitch creating dense beating patterns. The beating between near-unison tones is the entire composition.",
    tuningId: "just5", relationId: "drone-triad",
    voiceLayers: ["reed", "air"],
    voiceLevels: { reed: 1, air: 0.2 },
    reedShape: "even",
    octaveRange: [2, 3],
    drift: 0.45,
    air: 0.35,
    time: 0.06,
    sub: 0.2,
    bloom: 0.7,
    glide: 0.6,
    lfoShape: "sine",
    lfoRate: 0.04,
    lfoAmount: 0.04,
    climateX: 0.45,
    climateY: 0.3,
    effects: ["plate", "hall"],
    parallelSends: { hall: 0.3 },
    scale: "drone",
    gain: 0.88,
    motionProfile: motionProfile({
      climateXRange: [0.38, 0.52],
      climateYRange: [0.22, 0.38],
      bloomRange: [0.6, 0.8],
      timeRange: [0.04, 0.1],
      driftRange: [0.38, 0.55],
      subRange: [0.15, 0.28],
      macroStep: 0.4,
      tonicWalk: "none",
      tonicFloor: 1,
      textureFloor: 0.82,
      texturePeriod: 7,
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
  };
  const voiceLevels: Record<VoiceType, number> = {
    tanpura: 1,
    reed: 1,
    metal: 1,
    air: 1,
    piano: 1,
    fm: 1,
    amp: 1,
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
    presetTrim: preset.gain ?? 1,
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

/**
 * Startup-curated scene — uses the smaller STARTUP_PRESET_IDS pool
 * for "Start New" so the first impression is reliably beautiful.
 * Falls back to the broader safe-random pool if the startup pool
 * resolves empty (defensive).
 */
export function createStartupScene(
  root: DroneSessionSnapshot["root"],
  fallbackOctaveRange: readonly [number, number],
  random = Math.random,
): { preset: Preset; snapshot: DroneSessionSnapshot } {
  const startupPresets = STARTUP_PRESET_IDS
    .map((id) => PRESETS.find((preset) => preset.id === id) ?? null)
    .filter((preset): preset is Preset => preset !== null);
  if (startupPresets.length > 0) {
    const preset = startupPresets[Math.floor(random() * startupPresets.length)];
    const range = preset.octaveRange ?? fallbackOctaveRange;
    const [lo, hi] = range;
    const octave = lo + Math.floor(random() * (hi - lo + 1));
    return { preset, snapshot: createPresetVariation(preset, root, octave, random) };
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
  const layers: Record<VoiceType, boolean> = { tanpura: false, reed: false, metal: false, air: false, piano: false, fm: false, amp: false };
  const levels: Record<VoiceType, number> = { tanpura: 1, reed: 1, metal: 1, air: 1, piano: 1, fm: 1, amp: 1 };
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
    // Parallel reverb send levels — reset every preset so stale sends
    // from a previous scene don't leak through.
    engine.setParallelSends(preset.parallelSends ?? {});
    engine.applyDroneScene(layers, levels, engineIntervals);
  }

  // Effects — turn on the listed ones, off the rest
  const active = new Set(preset.effects);
  for (const id of ALL_EFFECT_IDS) {
    ui.setEffectEnabled(id, active.has(id));
  }
}
