import { STORAGE_KEYS } from "./config";
import type { EffectId } from "./engine/FxChain";
import type { VoiceType } from "./engine/VoiceBuilder";
import type { PitchClass, RelationId, ScaleId, TuningId } from "./types";
import type { PaletteId } from "./themes";
import type { Visualizer } from "./components/visualizers";
import { JOURNEY_IDS, type JourneyId } from "./journey";
import { PARTNER_RELATIONS, DEFAULT_PARTNER, type PartnerRelation, type PartnerState } from "./partner";
import { normalizeMotionEvents } from "./sceneRecorder";

export interface DroneSessionSnapshot {
  activePresetId: string | null;
  playing: boolean;
  root: PitchClass;
  octave: number;
  scale: ScaleId;
  /** Microtuning: tuning table id. When both tuningId and relationId are
   *  present they override the legacy scale-based intervals. */
  tuningId: TuningId | null;
  /** Microtuning: interval-relation preset id. */
  relationId: RelationId | null;
  /** Per-active-interval fine detune offsets in cents. Only applied when
   *  both tuningId and relationId are set. Index 0 (root) is ignored. */
  fineTuneOffsets: number[];
  voiceLayers: Record<VoiceType, boolean>;
  voiceLevels: Record<VoiceType, number>;
  effects: Record<EffectId, boolean>;
  drift: number;
  air: number;
  time: number;
  sub: number;
  bloom: number;
  glide: number;
  climateX: number;
  climateY: number;
  lfoShape: OscillatorType;
  lfoRate: number;
  lfoAmount: number;
  presetMorph: number;
  evolve: number;
  pluckRate: number;
  presetTrim: number;
  /** PRNG seed captured the last time this scene was randomised or
   *  mutated. 0 = no explicit seed (initial default). Travels through
   *  the share URL so reloading a shared scene preserves reproducibility
   *  for follow-up mutations. */
  /** FM synthesis parameters — ratio and index of the FM voice.
   *  Defaults match VoiceBuilder (2.0 / 2.4). Persisted so FM
   *  presets (glass-bell, gong) round-trip through sessions and
   *  share URLs without falling back to defaults. */
  fmRatio: number;
  fmIndex: number;
  fmFeedback: number;
  seed: number;
  /** Optional ritual journey id. When set, the evolve loop replaces
   *  its generic mutate-perturb step with a deterministic
   *  arrival → bloom → suspension → dissolve walk authored in
   *  src/journey.ts. null = journey is off (default). */
  journey: JourneyId | null;
  /** Optional sympathetic-partner drone layer. When enabled, the
   *  partner cents are appended to the main interval list and the
   *  audio engine spawns parallel voices automatically. */
  partner: PartnerState;
}

export interface MixerSessionSnapshot {
  hpfHz: number;
  low: number;
  mid: number;
  high: number;
  glue: number;
  drive: number;
  limiterOn: boolean;
  ceiling: number;
  volume: number;
}

export interface FxSessionSnapshot {
  levels: Record<EffectId, number>;
  delayTime: number;
  delayFeedback: number;
  combFeedback: number;
  subCenter: number;
  freezeMix: number;
}

export interface UiSessionSnapshot {
  paletteId: PaletteId;
  visualizer: Visualizer;
}

export interface PortableScene {
  version: 1;
  name: string;
  drone: DroneSessionSnapshot;
  mixer: MixerSessionSnapshot;
  fx: FxSessionSnapshot;
  ui: UiSessionSnapshot;
  /** Optional motion-recording payload — flat tuple list
   *  [t_ms, paramId, value, ...]. Absent on legacy URLs.
   *  See src/sceneRecorder.ts for the format and replay rules. */
  motion?: number[];
}

export interface SavedSession {
  id: string;
  name: string;
  savedAt: string;
  version: 2;
  scene: PortableScene;
}

export interface AutosavedScene {
  savedAt: string;
  scene: PortableScene;
}

function hasLocalStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

const PITCH_CLASSES: readonly PitchClass[] = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;
const SCALE_IDS: readonly ScaleId[] = ["drone", "major", "minor", "dorian", "phrygian", "just5", "pentatonic", "meantone", "harmonics", "maqam-rast", "slendro"] as const;
const TUNING_IDS: readonly TuningId[] = ["equal", "just5", "meantone", "harmonics", "maqam-rast", "slendro"] as const;
const RELATION_IDS: readonly RelationId[] = ["unison", "tonic-fifth", "tonic-fourth", "minor-triad", "drone-triad", "harmonic-stack"] as const;
const LFO_SHAPES: readonly OscillatorType[] = ["sine", "triangle", "square", "sawtooth"] as const;
const PALETTE_IDS: readonly PaletteId[] = ["ember", "copper", "dusk"] as const;
const VISUALIZERS: readonly Visualizer[] = [
  "mandala",
  "haloGlow",
  "fractal",
  "rothko",
  "tapeDecay",
  "dreamHouse",
  "sigil",
  "starGate",
  "cymatics",
  "inkBloom",
  "horizon",
  "aurora",
  "orb",
  "dreamMachine",
] as const;

const DEFAULT_EFFECT_LEVELS: Record<EffectId, number> = {
  tape: 1,
  wow: 1,
  sub: 0.9,
  comb: 0.85,
  delay: 0.9,
  plate: 1,
  hall: 1,
  shimmer: 0.95,
  freeze: 1,
  cistern: 1,
  granular: 0.8,
  graincloud: 0.8,
  ringmod: 0.7,
  formant: 0.85,
};

export const DEFAULT_FX_SNAPSHOT: FxSessionSnapshot = {
  levels: { ...DEFAULT_EFFECT_LEVELS },
  delayTime: 0.55,
  delayFeedback: 0.58,
  combFeedback: 0.68,
  subCenter: 110,
  freezeMix: 1,
};

export const DEFAULT_UI_SNAPSHOT: UiSessionSnapshot = {
  paletteId: "ember",
  visualizer: "mandala",
};

const DEFAULT_DRONE_SNAPSHOT: DroneSessionSnapshot = {
  activePresetId: null,
  playing: false,
  root: "A",
  octave: 2,
  scale: "dorian",
  tuningId: null,
  relationId: null,
  fineTuneOffsets: [],
  voiceLayers: { tanpura: true, reed: false, metal: false, air: false, piano: false, fm: false, amp: false },
  voiceLevels: { tanpura: 1, reed: 1, metal: 1, air: 1, piano: 1, fm: 1, amp: 1 },
  effects: {
    tape: false,
    wow: false,
    sub: false,
    comb: false,
    delay: false,
    plate: false,
    hall: false,
    shimmer: false,
    freeze: false,
    cistern: false,
    granular: false,
    graincloud: false,
    ringmod: false,
    formant: false,
  },
  drift: 0.3,
  air: 0.4,
  time: 0.5,
  sub: 0,
  bloom: 0.15,
  glide: 0.15,
  climateX: 0.5,
  climateY: 0.5,
  lfoShape: "sine",
  lfoRate: 0.4,
  lfoAmount: 0,
  presetMorph: 0.25,
  evolve: 0,
  pluckRate: 1,
  presetTrim: 1,
  fmRatio: 2.0,
  fmIndex: 2.4,
  fmFeedback: 0,
  seed: 0,
  journey: null,
  partner: DEFAULT_PARTNER,
};

const DEFAULT_MIXER_SNAPSHOT: MixerSessionSnapshot = {
  hpfHz: 10,
  low: 0,
  mid: 0,
  high: 0,
  glue: 0.5,
  drive: 1.5,
  limiterOn: true,
  ceiling: -1,
  volume: 1,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isOneOf<T extends string>(value: unknown, options: readonly T[]): value is T {
  return typeof value === "string" && options.includes(value as T);
}

function readNumber(value: unknown, fallback: number, min?: number, max?: number): number {
  if (typeof value !== "number" || Number.isNaN(value)) return fallback;
  const lower = min ?? -Infinity;
  const upper = max ?? Infinity;
  return Math.max(lower, Math.min(upper, value));
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function normalizeVoiceLayers(value: unknown): Record<VoiceType, boolean> {
  const record = isRecord(value) ? value : {};
  return {
    tanpura: readBoolean(record.tanpura, DEFAULT_DRONE_SNAPSHOT.voiceLayers.tanpura),
    reed: readBoolean(record.reed, DEFAULT_DRONE_SNAPSHOT.voiceLayers.reed),
    metal: readBoolean(record.metal, DEFAULT_DRONE_SNAPSHOT.voiceLayers.metal),
    air: readBoolean(record.air, DEFAULT_DRONE_SNAPSHOT.voiceLayers.air),
    piano: readBoolean(record.piano, DEFAULT_DRONE_SNAPSHOT.voiceLayers.piano),
    fm: readBoolean(record.fm, DEFAULT_DRONE_SNAPSHOT.voiceLayers.fm),
    amp: readBoolean(record.amp, DEFAULT_DRONE_SNAPSHOT.voiceLayers.amp),
  };
}

function normalizeVoiceLevels(value: unknown): Record<VoiceType, number> {
  const record = isRecord(value) ? value : {};
  return {
    tanpura: readNumber(record.tanpura, DEFAULT_DRONE_SNAPSHOT.voiceLevels.tanpura, 0, 1),
    reed: readNumber(record.reed, DEFAULT_DRONE_SNAPSHOT.voiceLevels.reed, 0, 1),
    metal: readNumber(record.metal, DEFAULT_DRONE_SNAPSHOT.voiceLevels.metal, 0, 1),
    air: readNumber(record.air, DEFAULT_DRONE_SNAPSHOT.voiceLevels.air, 0, 1),
    piano: readNumber(record.piano, DEFAULT_DRONE_SNAPSHOT.voiceLevels.piano, 0, 1),
    fm: readNumber(record.fm, DEFAULT_DRONE_SNAPSHOT.voiceLevels.fm, 0, 1),
    amp: readNumber(record.amp, DEFAULT_DRONE_SNAPSHOT.voiceLevels.amp, 0, 1),
  };
}

function normalizeEffectStates(value: unknown): Record<EffectId, boolean> {
  const record = isRecord(value) ? value : {};
  return {
    tape: readBoolean(record.tape, false),
    wow: readBoolean(record.wow, false),
    sub: readBoolean(record.sub, false),
    comb: readBoolean(record.comb, false),
    delay: readBoolean(record.delay, false),
    plate: readBoolean(record.plate, false),
    hall: readBoolean(record.hall, false),
    shimmer: readBoolean(record.shimmer, false),
    freeze: readBoolean(record.freeze, false),
    cistern: readBoolean(record.cistern, false),
    granular: readBoolean(record.granular, false),
    graincloud: readBoolean(record.graincloud, false),
    ringmod: readBoolean(record.ringmod, false),
    formant: readBoolean(record.formant, false),
  };
}

function normalizeEffectLevels(value: unknown): Record<EffectId, number> {
  const record = isRecord(value) ? value : {};
  return {
    tape: readNumber(record.tape, DEFAULT_EFFECT_LEVELS.tape, 0, 1),
    wow: readNumber(record.wow, DEFAULT_EFFECT_LEVELS.wow, 0, 1),
    sub: readNumber(record.sub, DEFAULT_EFFECT_LEVELS.sub, 0, 1),
    comb: readNumber(record.comb, DEFAULT_EFFECT_LEVELS.comb, 0, 1),
    delay: readNumber(record.delay, DEFAULT_EFFECT_LEVELS.delay, 0, 1),
    plate: readNumber(record.plate, DEFAULT_EFFECT_LEVELS.plate, 0, 1),
    hall: readNumber(record.hall, DEFAULT_EFFECT_LEVELS.hall, 0, 1),
    shimmer: readNumber(record.shimmer, DEFAULT_EFFECT_LEVELS.shimmer, 0, 1),
    freeze: readNumber(record.freeze, DEFAULT_EFFECT_LEVELS.freeze, 0, 1),
    cistern: readNumber(record.cistern, DEFAULT_EFFECT_LEVELS.cistern, 0, 1),
    granular: readNumber(record.granular, DEFAULT_EFFECT_LEVELS.granular, 0, 1),
    graincloud: readNumber(record.graincloud, DEFAULT_EFFECT_LEVELS.graincloud, 0, 1),
    ringmod: readNumber(record.ringmod, DEFAULT_EFFECT_LEVELS.ringmod, 0, 1),
    formant: readNumber(record.formant, DEFAULT_EFFECT_LEVELS.formant, 0, 1),
  };
}

function normalizeFineTuneOffsets(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, 12)
    .map((item) => readNumber(item, 0, -25, 25));
}

export function normalizeDroneSnapshot(value: unknown): DroneSessionSnapshot | null {
  if (!isRecord(value)) return null;
  return {
    activePresetId: typeof value.activePresetId === "string" ? value.activePresetId : null,
    playing: readBoolean(value.playing, DEFAULT_DRONE_SNAPSHOT.playing),
    root: isOneOf(value.root, PITCH_CLASSES) ? value.root : DEFAULT_DRONE_SNAPSHOT.root,
    octave: readNumber(value.octave, DEFAULT_DRONE_SNAPSHOT.octave, 1, 6),
    scale: isOneOf(value.scale, SCALE_IDS) ? value.scale : DEFAULT_DRONE_SNAPSHOT.scale,
    tuningId: isOneOf(value.tuningId, TUNING_IDS) ? value.tuningId : null,
    relationId: isOneOf(value.relationId, RELATION_IDS) ? value.relationId : null,
    fineTuneOffsets: normalizeFineTuneOffsets(value.fineTuneOffsets),
    voiceLayers: normalizeVoiceLayers(value.voiceLayers),
    voiceLevels: normalizeVoiceLevels(value.voiceLevels),
    effects: normalizeEffectStates(value.effects),
    drift: readNumber(value.drift, DEFAULT_DRONE_SNAPSHOT.drift, 0, 1),
    air: readNumber(value.air, DEFAULT_DRONE_SNAPSHOT.air, 0, 1),
    time: readNumber(value.time, DEFAULT_DRONE_SNAPSHOT.time, 0, 1),
    sub: readNumber(value.sub, DEFAULT_DRONE_SNAPSHOT.sub, 0, 1),
    bloom: readNumber(value.bloom, DEFAULT_DRONE_SNAPSHOT.bloom, 0, 1),
    glide: readNumber(value.glide, DEFAULT_DRONE_SNAPSHOT.glide, 0, 1),
    climateX: readNumber(value.climateX, DEFAULT_DRONE_SNAPSHOT.climateX, 0, 1),
    climateY: readNumber(value.climateY, DEFAULT_DRONE_SNAPSHOT.climateY, 0, 1),
    lfoShape: isOneOf(value.lfoShape, LFO_SHAPES) ? value.lfoShape : DEFAULT_DRONE_SNAPSHOT.lfoShape,
    lfoRate: readNumber(value.lfoRate, DEFAULT_DRONE_SNAPSHOT.lfoRate, 0.05, 8),
    lfoAmount: readNumber(value.lfoAmount, DEFAULT_DRONE_SNAPSHOT.lfoAmount, 0, 1),
    presetMorph: readNumber(value.presetMorph, DEFAULT_DRONE_SNAPSHOT.presetMorph, 0, 1),
    evolve: readNumber(value.evolve, DEFAULT_DRONE_SNAPSHOT.evolve, 0, 1),
    pluckRate: readNumber(value.pluckRate, DEFAULT_DRONE_SNAPSHOT.pluckRate, 0.2, 4),
    presetTrim: readNumber(value.presetTrim, DEFAULT_DRONE_SNAPSHOT.presetTrim, 0.1, 4),
    fmRatio: readNumber(value.fmRatio, DEFAULT_DRONE_SNAPSHOT.fmRatio, 0.5, 12),
    fmIndex: readNumber(value.fmIndex, DEFAULT_DRONE_SNAPSHOT.fmIndex, 0.1, 12),
    fmFeedback: readNumber(value.fmFeedback, DEFAULT_DRONE_SNAPSHOT.fmFeedback, 0, 1),
    seed: readNumber(value.seed, DEFAULT_DRONE_SNAPSHOT.seed, 0, 0xFFFFFFFF),
    journey: isOneOf(value.journey, JOURNEY_IDS) ? value.journey : null,
    partner: normalizePartner(value.partner),
  };
}

function normalizePartner(value: unknown): PartnerState {
  if (!isRecord(value)) return { ...DEFAULT_PARTNER };
  return {
    enabled: readBoolean(value.enabled, DEFAULT_PARTNER.enabled),
    relation: isOneOf(value.relation, PARTNER_RELATIONS)
      ? (value.relation as PartnerRelation)
      : DEFAULT_PARTNER.relation,
  };
}

export function normalizeMixerSnapshot(value: unknown): MixerSessionSnapshot | null {
  if (!isRecord(value)) return null;
  return {
    hpfHz: readNumber(value.hpfHz, DEFAULT_MIXER_SNAPSHOT.hpfHz, 10, 40),
    low: readNumber(value.low, DEFAULT_MIXER_SNAPSHOT.low, -18, 18),
    mid: readNumber(value.mid, DEFAULT_MIXER_SNAPSHOT.mid, -18, 18),
    high: readNumber(value.high, DEFAULT_MIXER_SNAPSHOT.high, -18, 18),
    glue: readNumber(value.glue, DEFAULT_MIXER_SNAPSHOT.glue, 0, 1),
    drive: readNumber(value.drive, DEFAULT_MIXER_SNAPSHOT.drive, 1, 10),
    limiterOn: readBoolean(value.limiterOn, DEFAULT_MIXER_SNAPSHOT.limiterOn),
    ceiling: readNumber(value.ceiling, DEFAULT_MIXER_SNAPSHOT.ceiling, -24, 0),
    volume: readNumber(value.volume, DEFAULT_MIXER_SNAPSHOT.volume, 0, 1.5),
  };
}

export function normalizeFxSnapshot(value: unknown): FxSessionSnapshot {
  const record = isRecord(value) ? value : {};
  return {
    levels: normalizeEffectLevels(record.levels),
    delayTime: readNumber(record.delayTime, DEFAULT_FX_SNAPSHOT.delayTime, 0.05, 2),
    delayFeedback: readNumber(record.delayFeedback, DEFAULT_FX_SNAPSHOT.delayFeedback, 0, 0.95),
    combFeedback: readNumber(record.combFeedback, DEFAULT_FX_SNAPSHOT.combFeedback, 0, 0.98),
    subCenter: readNumber(record.subCenter, DEFAULT_FX_SNAPSHOT.subCenter, 40, 300),
    freezeMix: readNumber(record.freezeMix, DEFAULT_FX_SNAPSHOT.freezeMix, 0, 1),
  };
}

export function normalizeUiSnapshot(value: unknown): UiSessionSnapshot {
  const record = isRecord(value) ? value : {};
  return {
    paletteId: isOneOf(record.paletteId, PALETTE_IDS) ? record.paletteId : DEFAULT_UI_SNAPSHOT.paletteId,
    visualizer: isOneOf(record.visualizer, VISUALIZERS) ? record.visualizer : DEFAULT_UI_SNAPSHOT.visualizer,
  };
}

export function normalizePortableScene(value: unknown, fallbackName = "Shared Scene"): PortableScene | null {
  if (!isRecord(value)) return null;
  const drone = normalizeDroneSnapshot(value.drone);
  const mixer = normalizeMixerSnapshot(value.mixer);
  if (!drone || !mixer) return null;
  const motion = normalizeMotionEvents(value.motion);
  const scene: PortableScene = {
    version: 1,
    name: readString(value.name, fallbackName),
    drone,
    mixer,
    fx: normalizeFxSnapshot(value.fx),
    ui: normalizeUiSnapshot(value.ui),
  };
  if (motion) scene.motion = motion;
  return scene;
}

function migrateLegacySession(value: Record<string, unknown>): SavedSession | null {
  const drone = normalizeDroneSnapshot(value.drone);
  const mixer = normalizeMixerSnapshot(value.mixer);
  if (!drone || !mixer) return null;
  const name = readString(value.name, "Untitled Session");
  return {
    id: readString(value.id, makeSessionId()),
    name,
    savedAt: readString(value.savedAt, new Date().toISOString()),
    version: 2,
    scene: {
      version: 1,
      name,
      drone,
      mixer,
      fx: { ...DEFAULT_FX_SNAPSHOT, levels: { ...DEFAULT_FX_SNAPSHOT.levels } },
      ui: { ...DEFAULT_UI_SNAPSHOT },
    },
  };
}

export function normalizeSavedSession(value: unknown): SavedSession | null {
  if (!isRecord(value)) return null;
  const version = readNumber(value.version, 0);
  if (version >= 2 && isRecord(value.scene)) {
    const name = readString(value.name, "Untitled Session");
    const scene = normalizePortableScene(value.scene, name);
    if (!scene) return null;
    return {
      id: readString(value.id, makeSessionId()),
      name,
      savedAt: readString(value.savedAt, new Date().toISOString()),
      version: 2,
      scene: {
        ...scene,
        name,
        fx: { ...scene.fx, levels: { ...scene.fx.levels } },
      },
    };
  }
  return migrateLegacySession(value);
}

export function loadSessions(): SavedSession[] {
  if (!hasLocalStorage()) return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.sessions);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => normalizeSavedSession(item))
      .filter((item): item is SavedSession => item !== null);
  } catch {
    return [];
  }
}

export function saveSessions(sessions: SavedSession[]): void {
  if (!hasLocalStorage()) return;
  localStorage.setItem(STORAGE_KEYS.sessions, JSON.stringify(sessions));
}

export function loadCurrentSessionId(): string | null {
  if (!hasLocalStorage()) return null;
  return localStorage.getItem(STORAGE_KEYS.currentSessionId);
}

export function saveCurrentSessionId(id: string | null): void {
  if (!hasLocalStorage()) return;
  if (id) localStorage.setItem(STORAGE_KEYS.currentSessionId, id);
  else localStorage.removeItem(STORAGE_KEYS.currentSessionId);
}

export function loadAutosavedScene(): AutosavedScene | null {
  if (!hasLocalStorage()) return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.autosave);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!isRecord(parsed)) return null;
    const scene = normalizePortableScene(parsed.scene, "Last Scene");
    if (!scene) return null;
    return {
      savedAt: readString(parsed.savedAt, new Date().toISOString()),
      scene,
    };
  } catch {
    return null;
  }
}

export function saveAutosavedScene(scene: PortableScene): void {
  if (!hasLocalStorage()) return;
  localStorage.setItem(STORAGE_KEYS.autosave, JSON.stringify({
    savedAt: new Date().toISOString(),
    scene,
  }));
}

/** Full factory reset — wipes every mdrone-namespaced key from
 *  localStorage (known keys + any other `mdrone-*` stragglers from
 *  older app versions). Use from a "Reset everything" UI. */
export function resetAllLocalStorage(): void {
  if (!hasLocalStorage()) return;
  for (const key of Object.values(STORAGE_KEYS)) {
    localStorage.removeItem(key);
  }
  // Sweep up any mdrone-* keys left behind by older code paths.
  const stragglers: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith("mdrone-")) stragglers.push(k);
  }
  for (const k of stragglers) localStorage.removeItem(k);
}

export function makeSessionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
