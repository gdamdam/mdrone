import type { AudioEngine } from "../engine/AudioEngine";
import type { EffectId } from "../engine/FxChain";
import type { DroneSessionSnapshot } from "../session";
import type { PitchClass, RelationId, ScaleId, TuningId } from "../types";
import type { VoiceType } from "../engine/VoiceBuilder";
import { resolveIntervals as resolveIntervalsCore } from "../microtuning";
import type { JourneyId } from "../journey";
import { DEFAULT_PARTNER, type PartnerState } from "../partner";

export const PITCH_CLASSES: PitchClass[] = [
  "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
];

export interface Scale {
  id: ScaleId;
  label: string;
  intervalsCents: number[];
}

export const SCALES: Scale[] = [
  { id: "drone", label: "Drone", intervalsCents: [0] },
  { id: "major", label: "Major", intervalsCents: [0, 400, 700] },
  { id: "minor", label: "Minor", intervalsCents: [0, 300, 700] },
  { id: "dorian", label: "Dorian", intervalsCents: [0, 300, 700, 1000] },
  { id: "phrygian", label: "Phrygian", intervalsCents: [0, 100, 700] },
  { id: "just5", label: "Just 5-limit", intervalsCents: [0, 386.31, 701.96] },
  { id: "pentatonic", label: "Pentatonic", intervalsCents: [0, 200, 700] },
  // 1/4-comma meantone — Malone / Arkbro pipe organs, pre-Bach tuning
  { id: "meantone", label: "Meantone", intervalsCents: [0, 193.16, 310.26, 503.42, 696.58, 889.74] },
  // Harmonic series partials 4-8 as pitches (over a fundamental) — La Monte Young,
  // Éliane Radigue's later work, spectral drones
  { id: "harmonics", label: "Harmonics", intervalsCents: [0, 386.31, 701.96, 968.83, 1200] },
  // Maqam Rast — Arabic maqam with half-flat degrees, approximated here in cents
  { id: "maqam-rast", label: "Rast", intervalsCents: [0, 200, 350, 500, 700, 900, 1050] },
  // Slendro — Javanese gamelan pentatonic, near-equal 5-tone
  { id: "slendro", label: "Slendro", intervalsCents: [0, 240, 480, 720, 960] },
];

export type LiveDroneSceneState = DroneSessionSnapshot;

export function pitchToFreq(pc: PitchClass, octave: number): number {
  const idx = PITCH_CLASSES.indexOf(pc);
  const semitonesFromA4 = idx - 9 + (octave - 4) * 12;
  return 440 * Math.pow(2, semitonesFromA4 / 12);
}

export function freqToPitch(freq: number): { pitchClass: PitchClass; octave: number } {
  const midi = Math.round(69 + 12 * Math.log2(freq / 440));
  const pitchClass = PITCH_CLASSES[((midi % 12) + 12) % 12];
  const octave = Math.max(1, Math.min(6, Math.floor(midi / 12) - 1));
  return { pitchClass, octave };
}

export function scaleById(id: ScaleId): Scale {
  return SCALES.find((s) => s.id === id) ?? SCALES[0];
}

/** Resolve intervals from scene state. Microtuning (tuningId + relationId)
 *  takes precedence; falls back to the legacy scale lookup. */
export function resolveIntervals(state: {
  scale: ScaleId;
  tuningId?: TuningId | null;
  relationId?: RelationId | null;
  fineTuneOffsets?: readonly number[];
}): number[] {
  return resolveIntervalsCore(state, (id) => scaleById(id).intervalsCents);
}

export function createInitialDroneScene(engine: AudioEngine | null): LiveDroneSceneState {
  return {
    activePresetId: null,
    playing: true, // default to playing — drone starts as soon as AudioContext resumes
    root: "A",
    octave: 2,
    // Default to single-tone drone so the initial startup is one pitch,
    // not a 4-note dorian chord. User picks a preset to shape the scene.
    scale: "drone",
    tuningId: null,
    relationId: null,
    fineTuneOffsets: [],
    voiceLayers: engine?.getVoiceLayers() ?? {
      tanpura: true,
      reed: false,
      metal: false,
      air: false,
      piano: false,
      fm: false,
      amp: false,
    },
    voiceLevels: {
      tanpura: engine?.getVoiceLevel("tanpura") ?? 1,
      reed: engine?.getVoiceLevel("reed") ?? 1,
      metal: engine?.getVoiceLevel("metal") ?? 1,
      air: engine?.getVoiceLevel("air") ?? 1,
      piano: engine?.getVoiceLevel("piano") ?? 1,
      fm: engine?.getVoiceLevel("fm") ?? 1,
      amp: engine?.getVoiceLevel("amp") ?? 1,
    },
    effects: engine?.getEffectStates() ?? {
      tape: false,
      wow: false,
      plate: false,
      hall: false,
      shimmer: false,
      delay: false,
      sub: false,
      comb: false,
      freeze: false,
      cistern: false,
      granular: false,
      graincloud: false,
      ringmod: false,
      formant: false,
    },
    drift: engine?.getDrift() ?? 0.3,
    air: engine?.getAir() ?? 0.4,
    time: engine?.getTime() ?? 0.5,
    sub: engine?.getSub() ?? 0,
    bloom: engine?.getBloom() ?? 0.15,
    glide: engine?.getGlide() ?? 0.15,
    climateX: engine?.getClimateX() ?? 0.5,
    climateY: engine?.getClimateY() ?? 0.5,
    lfoShape: engine?.getLfoShape() ?? "sine",
    lfoRate: engine?.getLfoRate() ?? 0.4,
    lfoAmount: engine?.getLfoAmount() ?? 0,
    presetMorph: engine?.getPresetMorph() ?? 0.25,
    evolve: engine?.getEvolve() ?? 0,
    pluckRate: engine?.getTanpuraPluckRate() ?? 1,
    presetTrim: engine?.getPresetTrim() ?? 1,
    seed: 0,
    journey: null,
    partner: { ...DEFAULT_PARTNER },
  };
}

export type LiveDroneSceneAction =
  | { type: "merge"; patch: Partial<LiveDroneSceneState> }
  | { type: "setRoot"; root: PitchClass }
  | { type: "setOctave"; octave: number }
  | { type: "setScale"; scale: ScaleId }
  | { type: "setTuning"; tuningId: TuningId | null }
  | { type: "setRelation"; relationId: RelationId | null }
  | { type: "setFineTuneOffsets"; fineTuneOffsets: number[] }
  | { type: "setPlaying"; playing: boolean }
  | { type: "setVoiceLayer"; voiceType: VoiceType; on: boolean }
  | { type: "setVoiceLevel"; voiceType: VoiceType; level: number }
  | { type: "setEffect"; effectId: EffectId; on: boolean }
  | { type: "setClimate"; x: number; y: number }
  | { type: "setJourney"; journey: JourneyId | null }
  | { type: "setPartner"; partner: PartnerState };

export function liveDroneSceneReducer(
  state: LiveDroneSceneState,
  action: LiveDroneSceneAction,
): LiveDroneSceneState {
  switch (action.type) {
    case "merge":
      return { ...state, ...action.patch };
    case "setRoot":
      return { ...state, root: action.root };
    case "setOctave":
      return { ...state, octave: Math.max(1, Math.min(6, action.octave)) };
    case "setScale":
      return { ...state, scale: action.scale };
    case "setTuning":
      return { ...state, tuningId: action.tuningId, fineTuneOffsets: [] };
    case "setRelation":
      return { ...state, relationId: action.relationId, fineTuneOffsets: [] };
    case "setFineTuneOffsets":
      return { ...state, fineTuneOffsets: [...action.fineTuneOffsets] };
    case "setPlaying":
      return { ...state, playing: action.playing };
    case "setVoiceLayer":
      return {
        ...state,
        voiceLayers: { ...state.voiceLayers, [action.voiceType]: action.on },
      };
    case "setVoiceLevel":
      return {
        ...state,
        voiceLevels: { ...state.voiceLevels, [action.voiceType]: action.level },
      };
    case "setEffect":
      return {
        ...state,
        effects: { ...state.effects, [action.effectId]: action.on },
      };
    case "setClimate":
      return {
        ...state,
        climateX: action.x,
        climateY: action.y,
      };
    case "setJourney":
      return { ...state, journey: action.journey };
    case "setPartner":
      return { ...state, partner: { ...action.partner } };
    default:
      return state;
  }
}
