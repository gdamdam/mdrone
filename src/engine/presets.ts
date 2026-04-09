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

  /** Optional reed voice harmonic-stack shape. Defaults to "odd". */
  reedShape?: ReedShape;

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
    attribution: "Minimal pipe organ · meantone stillness",
    hint: "Reed (balanced harmonic stack — even + odd, pipe-organ-like) in meantone tuning with slow chord morphs. Kali Malone's Sacrificial Code — architectural, glacial, no bell character.",
    voiceLayers: ["reed", "metal"],
    voiceLevels: { reed: 1, metal: 0.1 },
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
    scale: "meantone",
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
    attribution: "Long-tone just-intonation · pure sines · beating intervals",
    hint: "Pure sine tones (reed.shape = sine) in just 5-limit intervals. The beating between tones IS the composition — La Monte Young & Marian Zazeela's Dream House, uncoloured.",
    voiceLayers: ["reed", "air"],
    voiceLevels: { reed: 1, air: 0.35 },
    reedShape: "sine",
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
    hint: "Reed and air in the cistern — Pauline Oliveros's Fort Worden, 28-second tail. A single breath fills the whole space.",
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
    effects: ["cistern", "plate"],
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
    id: "stars-of-the-lid",
    name: "Nitrous Oxide",
    attribution: "Sustained minor triad · slow swells · tape body",
    hint: "Reed (bowed-string shape = even harmonics) + air stacked as a sustained minor triad with slow ~25 s amplitude swells. Plate + hall + tape give the warm recording body of Stars of the Lid's looped strings.",
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
    id: "radigue-drift",
    name: "Radig Drift",
    attribution: "Pure sine drone · microscopic motion",
    hint: "A single sine tone (reed.shape = sine), dry, crystalline. The Éliane Radigue / ARP 2500 lineage — drift happens microscopically, the room stays close and uncoloured.",
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
    id: "eno-airport",
    name: "Terminal Airport",
    attribution: "Pure 5-limit ambient · long sunlit decay",
    hint: "Reed (harmonic stack) and a soft air bed in a deep hall + plate room. Just-intonation intervals keep everything beating-free. The long-decay vowel-pad feel of Brian Eno's Music for Airports — no shimmer, no bells, no dissonance.",
    voiceLayers: ["reed", "air"],
    voiceLevels: { reed: 1, air: 0.25 },
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
    id: "buddhist-monk-drone",
    name: "Low Chant",
    attribution: "Throat-singing overtone halo · low fundamental",
    hint: "Deep reed fundamental with a prominent inharmonic metal halo above — the defining overtone shimmer of Gyuto-style throat singing. Comb resonance locks the harmonics to the root.",
    voiceLayers: ["reed", "metal", "air"],
    voiceLevels: { reed: 1, metal: 0.5, air: 0.14 },
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
    // formant effect adds the dynamic vocal vowel resonance that's the
    // defining feature of Gyuto throat singing.
    effects: ["hall", "plate", "comb", "formant"],
    scale: "drone",
    gain: 1.08,
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
    id: "tibetan-bowl",
    name: "Tibetan Bowl",
    attribution: "Ritual metal · singing bowl",
    hint: "Grounded singing-bowl resonance in a reflective room. Bowl modes with a small air bed underneath — circular, resonant, not a bright bell.",
    voiceLayers: ["metal", "air"],
    voiceLevels: { metal: 1, air: 0.28 },
    drift: 0.08,      // tamer drift so metal modes don't wander quiet
    air: 0.5,
    time: 0.06,
    sub: 0.5,         // sub effect gives the bowl a phantom fundamental
    bloom: 0.4,
    glide: 0.18,
    lfoShape: "sine",
    lfoRate: 0.09,
    lfoAmount: 0.04,
    climateX: 0.36,
    climateY: 0.1,
    // `sub` effect added: its 110 Hz bandpass + saturator feeds a phantom
    // fundamental that the sparse inharmonic metal modes can't produce on
    // their own. This is what lets the bowl sit in the mix.
    effects: ["plate", "hall", "sub"],
    scale: "drone",
    // Metal voice is structurally quiet (6 sparse inharmonic modes vs
    // reed's ~12 harmonic partials), so we compensate at preset gain on
    // top of the sub-effect body boost.
    gain: 1.5,
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
    id: "coil-time-machines",
    name: "Time Machines",
    attribution: "Ceremonial single-note trance · suspended time",
    hint: "A low single-note ritual drone with narcotic stillness. Reed body, a whisper of FM for the Coil synth character, almost no decorative movement — just the faintest tape-flange rotation.",
    voiceLayers: ["reed", "fm", "air"],
    voiceLevels: { reed: 0.95, fm: 0.2, air: 0.18 },
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
  {
    id: "nww-soliloquy",
    name: "Lilith Drift",
    attribution: "Feedback hum · no clear source",
    hint: "Pure spectral texture — air and metal drifting through comb + tape + hall, no identifiable pitched sources. Nurse With Wound's Soliloquy for Lilith.",
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
    effects: ["tape", "comb", "hall"],
    scale: "drone",
    gain: 0.8,
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
    id: "doom-bloom",
    name: "Doom Bloom",
    attribution: "Amplifier feedback wall · slow breathing",
    hint: "Distorted amp voice for the saturated sustain, reed for body, metal for the feedback halo — the sustained-amp pressure of drone metal (Sunn O))), Earth), swelling in slow amplitude breaths.",
    voiceLayers: ["amp", "reed", "metal"],
    voiceLevels: { amp: 1, reed: 0.4, metal: 0.3 },
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
    id: "merzbient",
    name: "Merzbient",
    attribution: "Ambient-noise pressure · abrasive weather",
    hint: "Dense air texture with inharmonic metal crackle — Merzbow's ambient side. No pitched source, just spectral weather with tape wear, comb glare and freeze sustain underneath.",
    voiceLayers: ["air", "metal"],
    voiceLevels: { air: 1, metal: 0.55 },
    drift: 0.52,      // trimmed — comb resonance sweeps with high drift
    air: 0.62,
    time: 0.22,
    sub: 0.32,        // trimmed — less LF into comb's 0.85 feedback loop
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
    id: "windscape",
    name: "Permafrost",
    attribution: "Arctic wind field · cold resonance",
    hint: "Air as a wind-field texture over a soft reed rumble. Comb + wow give it a frozen howl, tape a worn edge — Thomas Köner's deep-cold stillness. Sub + drift kept low because comb has 0.85 feedback and will blow up if fed too much low-end energy.",
    voiceLayers: ["air", "reed"],
    voiceLevels: { air: 1, reed: 0.22 },
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
    effects: ["hall", "comb", "wow", "tape"],
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
    id: "wiese-baraka",
    name: "Sevenfold",
    attribution: "Layered bowls + tanpura · ritual stillness",
    hint: "Tanpura + metal bowl cloud in a long hall. Klaus Wiese's Baraka / Sevenfold Sanctuary — layered bowls beating against a tanpura drone, extreme stillness, no motion.",
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
    id: "hecker-ravedeath",
    name: "Ravedeath",
    attribution: "Distorted granular organ · saturated tail",
    hint: "Reed (balanced pipe-organ shape) into the granular tail processor with saturation and hall. Tim Hecker's Ravedeath 1972 — a distorted, granulated church-organ texture.",
    voiceLayers: ["reed", "metal"],
    voiceLevels: { reed: 1, metal: 0.22 },
    reedShape: "balanced",
    drift: 0.18,
    air: 0.55,
    time: 0.09,
    sub: 0.3,
    bloom: 0.8,
    glide: 0.5,
    lfoShape: "sine",
    lfoRate: 0.06,
    lfoAmount: 0.08,
    climateX: 0.36,
    climateY: 0.22,
    effects: ["tape", "granular", "hall", "plate"],
    scale: "minor",
    gain: 0.85,
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
    id: "hecker-virgins",
    name: "Virgins",
    attribution: "Granular piano · minor fragments",
    hint: "Piano and reed into granular + hall. Tim Hecker's Virgins — minor-key piano textures stretched and fragmented.",
    voiceLayers: ["piano", "reed"],
    voiceLevels: { piano: 1, reed: 0.35 },
    reedShape: "balanced",
    drift: 0.16,
    air: 0.5,
    time: 0.08,
    sub: 0.24,
    bloom: 0.82,
    glide: 0.55,
    lfoShape: "sine",
    lfoRate: 0.05,
    lfoAmount: 0.06,
    climateX: 0.34,
    climateY: 0.2,
    effects: ["granular", "hall", "plate", "tape"],
    scale: "minor",
    gain: 0.88,
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

  // ─── Fennesz — processed granular harmonic stack ────────────────────
  {
    id: "fennesz-endless",
    name: "Endless Summer",
    attribution: "Processed granular shimmer · bright clouds",
    hint: "Reed + air processed through granular + shimmer. Fennesz's Endless Summer — bright harmonic textures granulated into shimmering clouds.",
    voiceLayers: ["reed", "air"],
    voiceLevels: { reed: 1, air: 0.45 },
    reedShape: "balanced",
    drift: 0.22,
    air: 0.62,
    time: 0.1,
    sub: 0.18,
    bloom: 0.72,
    glide: 0.4,
    lfoShape: "sine",
    lfoRate: 0.08,
    lfoAmount: 0.08,
    climateX: 0.56,
    climateY: 0.28,
    effects: ["granular", "shimmer", "hall", "tape"],
    scale: "just5",
    gain: 0.88,
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
    id: "biosphere-substrata",
    name: "Substrata",
    attribution: "Stretched arctic field · sub drone",
    hint: "Air + reed stretched through granular into a cistern. Biosphere's Substrata — deep arctic field-recording texture, slow motion.",
    voiceLayers: ["air", "reed"],
    voiceLevels: { air: 1, reed: 0.25 },
    reedShape: "balanced",
    drift: 0.2,
    air: 0.58,
    time: 0.1,
    sub: 0.36,
    bloom: 0.78,
    glide: 0.45,
    lfoShape: "sine",
    lfoRate: 0.06,
    lfoAmount: 0.08,
    climateX: 0.26,
    climateY: 0.24,
    effects: ["granular", "cistern", "tape"],
    scale: "drone",
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
    id: "basinski-disintegration",
    name: "Disintegration",
    attribution: "Decaying tape loop · melancholy patina",
    hint: "Reed (bowed-string shape) + granular + heavy tape. Basinski's Disintegration Loops — a loop of orchestral fragments slowly eroding, melancholy patina.",
    voiceLayers: ["reed", "piano"],
    voiceLevels: { reed: 1, piano: 0.4 },
    reedShape: "even",
    drift: 0.16,
    air: 0.52,
    time: 0.06,
    sub: 0.3,
    bloom: 0.85,
    glide: 0.5,
    lfoShape: "sine",
    lfoRate: 0.04,
    lfoAmount: 0.1,
    climateX: 0.32,
    climateY: 0.18,
    effects: ["granular", "tape", "hall", "plate"],
    scale: "minor",
    gain: 0.9,
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
    id: "budd-harold",
    name: "Pearl",
    attribution: "Long-decay piano · infinite reverb tail",
    hint: "Piano with a reed bed in a deep plate + hall. Harold Budd's Pearl / Plateaux of Mirror — simple piano tones with infinite reverb tails.",
    voiceLayers: ["piano", "reed"],
    voiceLevels: { piano: 1, reed: 0.3 },
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
    id: "frahm-solo",
    name: "Solo",
    attribution: "Solo piano drone · felt-dampened hall",
    hint: "Piano alone in hall + tape. Nils Frahm Solo / Spaces — sustained piano as drone, felt-dampened.",
    voiceLayers: ["piano"],
    voiceLevels: { piano: 1 },
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
    id: "grouper-dragging",
    name: "Dragging",
    attribution: "Lo-fi piano + air · tape wear",
    hint: "Piano + air bed in tape + plate. Grouper's Dragging a Dead Deer — lo-fi piano under a veil of air and tape patina.",
    voiceLayers: ["piano", "air"],
    voiceLevels: { piano: 1, air: 0.5 },
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
    effects: ["tape", "plate", "hall", "wow"],
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

  // ─── Ellen Arkbro — meantone chord drones ───────────────────────────
  {
    id: "arkbro-chords",
    name: "For Organ",
    attribution: "Meantone pipe-organ chords · austere",
    hint: "Reed (balanced pipe-organ shape) in meantone tuning. Ellen Arkbro's For Organ and Brass — slow austere meantone chord drones.",
    voiceLayers: ["reed", "metal"],
    voiceLevels: { reed: 1, metal: 0.14 },
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
    scale: "meantone",
    gain: 1.0,
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
    id: "young-well-tuned",
    name: "Well-Tuned",
    attribution: "Harmonic-series drone · pure intervals",
    hint: "Piano + reed (sine shape) in harmonic-series tuning. La Monte Young's Well-Tuned Piano — pure harmonic intervals, static.",
    voiceLayers: ["piano", "reed"],
    voiceLevels: { piano: 1, reed: 0.4 },
    reedShape: "sine",
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
    id: "lamb-prisma",
    name: "Prisma",
    attribution: "Microtonal chamber · maqam rast",
    hint: "Reed (balanced) + air in maqam rast. Catherine Lamb's Prisma — slow microtonal chamber drones with Middle-Eastern scale intervals.",
    voiceLayers: ["reed", "air"],
    voiceLevels: { reed: 1, air: 0.32 },
    reedShape: "balanced",
    drift: 0.1,
    air: 0.52,
    time: 0.04,
    sub: 0.24,
    bloom: 0.82,
    glide: 0.55,
    lfoShape: "sine",
    lfoRate: 0.05,
    lfoAmount: 0.04,
    climateX: 0.34,
    climateY: 0.12,
    effects: ["plate", "hall"],
    scale: "maqam-rast",
    gain: 0.98,
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
  "cistern", "granular", "ringmod", "formant",
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

  // Mode (scale)
  ui.setScale(preset.scale);

  if (engine) {
    // (A) Apply per-preset loudness trim before the scene builds so
    // the new voices come in at the corrected level.
    engine.setPresetTrim(preset.gain ?? 1);
    engine.setPresetMotionProfile(preset.motionProfile);
    engine.setPresetMaterialProfile(getPresetMaterialProfile(preset));
    // Reed shape must be set before applyDroneScene (which rebuilds
    // voices) so the reed worklet picks up the new harmonic profile.
    engine.setReedShape(preset.reedShape ?? "odd");
    // Parallel reverb send levels — reset every preset so stale sends
    // from a previous scene don't leak through.
    engine.setParallelSends(preset.parallelSends ?? {});
    engine.applyDroneScene(layers, levels, SCALE_INTERVALS[preset.scale] ?? [0]);
  }

  // Effects — turn on the listed ones, off the rest
  const active = new Set(preset.effects);
  for (const id of ALL_EFFECT_IDS) {
    ui.setEffectEnabled(id, active.has(id));
  }
}
