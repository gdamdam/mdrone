import {
  Fragment,
  Suspense,
  forwardRef,
  lazy,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";

const ScaleEditorModal = lazy(() =>
  import("./ScaleEditorModal").then((m) => ({ default: m.ScaleEditorModal })),
);
import type { AudioEngine } from "../engine/AudioEngine";
import type { VoiceType } from "../engine/VoiceBuilder";
import { PRESETS, ARRIVAL_PRESET_IDS, type PresetGroup } from "../engine/presets";
import { JOURNEYS, JOURNEY_IDS, type JourneyId } from "../journey";
import { PARTNER_RELATIONS, type PartnerRelation } from "../partner";
import { VuMeter } from "./VuMeter";
import { DropdownSelect } from "./DropdownSelect";
import { WeatherPad } from "./WeatherPad";
import { EntrainPanel } from "./EntrainPanel";
// VisualizerPreview also pulls the `meditate` chunk (visualizers.ts).
// Lazy-loaded so the chunk only fetches when the user enables the
// preview tile (Settings → APPEARANCE) — it's off by default.
const VisualizerPreview = lazy(() =>
  import("./VisualizerPreview").then((m) => ({ default: m.VisualizerPreview })),
);
import type { Visualizer } from "./visualizers";

const PRESET_GROUPS: PresetGroup[] = [
  "Sacred / Ritual", "Minimal / Just", "Organ / Chamber",
  "Ambient / Cinematic", "Noise / Industrial", "Pulse / Studies",
];
const SHORT_GROUP_LABELS: Partial<Record<PresetGroup, string>> = {
  "Sacred / Ritual": "SACRED",
  "Minimal / Just": "MINIMAL",
  "Organ / Chamber": "ORGAN",
  "Ambient / Cinematic": "AMBIENT",
  "Noise / Industrial": "NOISE",
  "Pulse / Studies": "PULSE",
};
const MORPH_CYCLE = [0, 10, 30, 120] as const;

import type { DroneSessionSnapshot } from "../session";
import type { PitchClass } from "../types";
import { FxBar } from "./FxBar";
import { TouchSlider } from "./TouchSlider";
import { EFFECT_ORDER, type EffectId } from "../engine/FxChain";
import { STORAGE_KEYS } from "../config";
import {
  TANPURA_TUNING_IDS,
  TANPURA_TUNING_LABELS,
  type TanpuraTuningId,
} from "../engine/VoiceBuilder";
import { PITCH_CLASSES, SCALES } from "../scene/droneSceneModel";
import { relationLabels, resolveTuning, TUNINGS, RELATIONS } from "../microtuning";
import { sampleGoodDrone } from "../goodDrone";
import { useDroneScene, type DroneLivePatch } from "../scene/useDroneScene";
import { autoDetectLinkBridge, getLinkState, onLinkState, type LinkState } from "../engine/linkBridge";
import {
  isFlowDone,
  onExpandAdvancedRequested,
  onExpandEditRequested,
  requestOfferFlow,
} from "../tutorial/state";

/** LFO sync modes. "free" runs the user's manual rate; every other
 *  option locks the LFO period to a note-value at the current Link
 *  tempo, so the drone's breathing aligns with the host DAW's grid. */
type LfoSyncMode = "free" | "1/1" | "1/2" | "1/4" | "1/8" | "1/16";
const LFO_SYNC_MODES: readonly LfoSyncMode[] = ["free", "1/1", "1/2", "1/4", "1/8", "1/16"];

function loadLfoSyncMode(): LfoSyncMode {
  try {
    const raw = typeof window !== "undefined"
      ? window.localStorage?.getItem(STORAGE_KEYS.lfoSyncMode) ?? ""
      : "";
    if ((LFO_SYNC_MODES as readonly string[]).includes(raw)) return raw as LfoSyncMode;
  } catch { /* noop */ }
  return "free";
}

/** One LFO cycle per 1/n note at the given BPM.
 *  duration(1/n) = 60/BPM × (4/n) seconds → freq = BPM × n / 240 Hz. */
function lfoSyncedHz(mode: LfoSyncMode, bpm: number): number {
  if (mode === "free") return 0;
  const n = Number(mode.split("/")[1]);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return (bpm * n) / 240;
}

/** Voice timbre list — each entry has an id, label, hint, and inline SVG.
 * Icons are defined inline (not as separate components) to avoid React
 * Fast Refresh hoisting issues where module-level refs to bottom-of-file
 * function declarations are undefined at evaluation time. */
interface VoiceDef {
  id: VoiceType;
  label: string;
  hint: string;
  icon: React.ReactNode;
}

// Shared SVG wrapper attrs for the 18×18 voice icons.
const V_SVG = {
  width: 18,
  height: 18,
  viewBox: "0 0 18 18",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.4,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

/**
 * Four authored voices — each is a physical / spectral model running
 * in the DroneVoiceProcessor AudioWorklet. Not generic waveform options;
 * each has its own sonic logic and sits in a different musical register.
 */
const VOICES: VoiceDef[] = [
  {
    id: "tanpura", label: "TANPURA",
    hint: "Karplus-Strong plucked string with jawari-style nonlinear bridge. Auto-plucking 4-string cycle, stereo offset taps. The archetypal drone instrument — buzzing, overtone-rich, alive without needing effects.",
    icon: (
      // Four vertical strings over a curved bridge
      <svg {...V_SVG}>
        <path d="M4 2 V 14" />
        <path d="M7 2 V 14" />
        <path d="M10 2 V 14" />
        <path d="M13 2 V 14" />
        <path d="M2 14 Q 9 11, 16 14" strokeWidth="1.6" />
      </svg>
    ),
  },
  {
    id: "reed", label: "REED",
    hint: "Harmonium / shruti-box free-reed additive stack. Odd-heavy harmonic series with per-partial slow wobble, bellows amplitude breath, source-level tanh saturation. Warm, organic, breathing.",
    icon: (
      // Bellows with wind curve
      <svg {...V_SVG}>
        <path d="M3 5 V 13 L 9 13 L 15 10 L 15 8 L 9 5 Z" />
        <path d="M5 7 L 5 11" opacity="0.5" />
        <path d="M7 7 L 7 11" opacity="0.5" />
      </svg>
    ),
  },
  {
    id: "metal", label: "METAL",
    hint: "Singing-bowl / ritual metal voice built from sparse inharmonic bowl modes, including split low resonances and slowly moving upper partials. Darker and purer than a generic bell, with a floating metal halo.",
    icon: (
      // Struck bar with radiating resonance
      <svg {...V_SVG}>
        <path d="M2 9 H 16" strokeWidth="2.2" />
        <path d="M2 6 L 4 4 L 6 6" opacity="0.6" />
        <path d="M8 4 L 10 2 L 12 4" opacity="0.6" />
        <path d="M14 6 L 16 4" opacity="0.6" />
        <path d="M4 13 H 14" opacity="0.5" />
      </svg>
    ),
  },
  {
    id: "air", label: "AIR",
    hint: "Pink noise through three modulated state-variable bandpass resonators at harmonic ratios. Breath-like, tuned wind texture — the sound of air through an open pipe, slowly shifting.",
    icon: (
      // Open pipe with wind swirls
      <svg {...V_SVG}>
        <path d="M4 3 V 15 Q 4 16, 5 16 H 13 Q 14 16, 14 15 V 3" />
        <path d="M6 8 Q 9 6, 12 8" opacity="0.55" />
        <path d="M6 11 Q 9 9, 12 11" opacity="0.55" />
      </svg>
    ),
  },
  {
    id: "piano", label: "PIANO",
    hint: "Inharmonically-stretched harmonic stack with a pink-noise strike transient and a slow breath LFO. A looped sustained piano tone — for ambient piano presets in the Eno / Budd / Hecker / Grouper / Frahm lineage.",
    icon: (
      // Three keys: two white with a black between
      <svg {...V_SVG}>
        <rect x="3" y="3" width="4" height="12" />
        <rect x="7" y="3" width="4" height="12" />
        <rect x="11" y="3" width="4" height="12" />
        <rect x="6" y="3" width="2" height="7" fill="currentColor" />
        <rect x="10" y="3" width="2" height="7" fill="currentColor" />
      </svg>
    ),
  },
  {
    id: "fm", label: "FM",
    hint: "2-op FM synthesis — modulator frequency-modulates carrier, producing controllable inharmonic sidebands. Bell-like metal tones distinct from the modal METAL voice. DX7-era synth drones.",
    icon: (
      // Two small circles = carrier + modulator with a sine wave
      <svg {...V_SVG}>
        <circle cx="5" cy="9" r="2.5" />
        <circle cx="13" cy="9" r="2.5" />
        <path d="M5 9 L 13 9" strokeWidth="0.8" />
      </svg>
    ),
  },
  {
    id: "amp", label: "AMP",
    hint: "Distorted amplifier voice — additive harmonic source pushed through hard tanh saturation and a cabinet low-pass. The sustained-guitar-feedback character of drone metal.",
    icon: (
      // Amp cabinet with a speaker grille
      <svg {...V_SVG}>
        <rect x="3" y="3" width="12" height="13" rx="1" />
        <circle cx="9" cy="9.5" r="3" />
        <circle cx="9" cy="9.5" r="1" fill="currentColor" />
      </svg>
    ),
  },
  {
    id: "noise", label: "NOISE",
    hint: "Untuned broadband bed — white to pink to brown to sub-rumble via COLOR. Tonic-independent; doesn't follow the scale. Hiss beds, wind washes, tape-floor, rain, ritual dust, industrial rumble. Passes through the full FX chain (FREEZE, GRANULAR, CISTERN become expressive here).",
    icon: (
      // Scattered dots — visual shorthand for noise / grain.
      <svg {...V_SVG}>
        <circle cx="4" cy="5" r="0.9" fill="currentColor" />
        <circle cx="9" cy="4" r="0.7" fill="currentColor" />
        <circle cx="14" cy="6" r="0.9" fill="currentColor" />
        <circle cx="6" cy="9" r="0.7" fill="currentColor" />
        <circle cx="11" cy="9.5" r="0.9" fill="currentColor" />
        <circle cx="15" cy="11" r="0.7" fill="currentColor" />
        <circle cx="4" cy="13" r="0.9" fill="currentColor" />
        <circle cx="9" cy="14" r="0.7" fill="currentColor" />
        <circle cx="13" cy="15" r="0.9" fill="currentColor" />
      </svg>
    ),
  },
];

interface DroneViewProps {
  engine: AudioEngine | null;
  onTransportChange?: (playing: boolean) => void;
  onTonicChange?: (root: PitchClass, octave: number) => void;
  onPresetChange?: (presetId: string | null, presetName: string | null) => void;
  onMutateScene?: (intensity: number) => void;
  /** Push a short "fine-tune active" hint string up to the header
   *  (e.g. "±7 ¢"), or null when no offsets are non-zero or
   *  microtuning isn't engaged. */
  onTuneOffsetChange?: (hint: string | null) => void;
  /** Optional motion-recorder hook — forwarded into useDroneScene so
   *  every meaningful dispatch can be captured for the share URL. */
  onParamRecord?: (id: import("../sceneRecorder").MotionParamId, value: number) => void;
  /** Whether the motion recorder is currently capturing. Drives the
   *  REC MOTION button's active state in the preset panel header. */
  isRecordingMotion?: boolean;
  /** Toggle the motion recorder on/off. */
  onToggleMotionRecord?: () => void;
  /** Feature flag — hides the REC MOTION button unless the user
   *  has explicitly opted in from the Settings modal. */
  motionRecEnabled?: boolean;
  weatherVisual?: import("../config").WeatherVisual;
  kbdActive: boolean;
  onToggleKbd: () => void;
  // REC WAV / BOUNCE LOOP / TIMED REC live in the header's
  // ⤓ EXPORT AUDIO dropdown — DroneView no longer owns recorder
  // state. Inline buttons were removed to keep the perform row calm
  // and instrument-like.
  /** MUTATE intensity (0..1). Hoisted from internal state so the
   *  Settings → GENERAL slider and the MUTATE button read the same
   *  source of truth. Persisted in Layout. */
  mutateIntensity?: number;
  /** Currently selected MEDITATE visualizer — used by the inline
   *  preview so DRONE shows what MEDITATE would expand into. */
  meditateVisualizer?: Visualizer;
  /** Tap on the inline preview opens the MEDITATE overlay. */
  onOpenMeditate?: () => void;
  /** Change the active MEDITATE visualizer from the inline tile's
   *  selector — wired to the same handler the overlay's HUD uses. */
  onChangeMeditateVisualizer?: (visualizer: Visualizer) => void;
  /** Pause the inline preview's rAF loop while MEDITATE is open.
   *  Visualizers with module-level offscreen canvases (illuminated
   *  glyphs, petroglyphs, etc.) thrash if two consumers render the
   *  same fn at different sizes simultaneously. */
  meditatePreviewPaused?: boolean;
  /** Whether the inline MEDITATE preview tile is shown. Toggle lives
   *  in the header (right of HOLD); state is hoisted to Layout so
   *  Header and DroneView see the same source of truth. */
  visualPreviewOn?: boolean;
}

export interface DroneViewHandle {
  getSnapshot(): DroneSessionSnapshot;
  applySnapshot(snapshot: DroneSessionSnapshot): void;
  applyLivePatch(patch: DroneLivePatch, options?: { record?: boolean }): void;
  /** Set a single voice's mix level. Routes through scene state so
   *  the UI sliders track the change (vs. calling engine.setVoiceLevel
   *  directly, which the scene reducer would overwrite on next sync). */
  setVoiceLevel(type: import("../engine/VoiceBuilder").VoiceType, level: number): void;
  togglePlay(): void;
  /** Force-rebuild the voice graph in place (no playing-state toggle).
   *  Used for iOS suspend/resume recovery after the AudioContext
   *  returns from "interrupted/suspended" — voices may be zombie. */
  restartDrone(): void;
  setRoot(root: PitchClass): void;
  /** User-originated tonic change (Header dropdown, MIDI note-on,
   *  QWERTY key). Identical to setRoot but advances the ARRIVE
   *  prompt through its TONIC step. Use this for any caller that
   *  represents a real human gesture. */
  setRootFromUser(root: PitchClass): void;
  setOctave(octave: number): void;
  applyPresetById(presetId: string): void;
  startImmediate(root: PitchClass, octave: number, presetId?: string): void;
  /** Ensure the PRESETS disclosure is open. Called by the header
   *  scene-marquee so tapping the currently-playing name expands the
   *  preset list, matching the preset-strip meta button. */
  openPresets(): void;
  /** Apply a user-customised FX chain order (from a share URL or
   *  loaded session). Updates React state, localStorage, and the
   *  engine via the same cascade a manual drag-reorder uses, so a
   *  subsequent render can't overwrite the engine with a stale
   *  locally-persisted order. */
  applyEffectOrder(order: readonly EffectId[]): void;
}

/**
 * DroneView — the instrument. Prototype layout:
 *   [tonic dial + mode picker]        [climate XY surface]
 *   [DRIFT · AIR · TIME macros]
 *
 * No transport button — the drone is on whenever there's a root set.
 * Tap the tonic pitch to start/retune; tap again to stop.
 */
export const DroneView = forwardRef<DroneViewHandle, DroneViewProps>(function DroneView(
  { engine, onTransportChange, onTonicChange, onPresetChange, onMutateScene, onTuneOffsetChange, onParamRecord, isRecordingMotion, onToggleMotionRecord, motionRecEnabled, weatherVisual, kbdActive, onToggleKbd, mutateIntensity: mutateIntensityProp, meditateVisualizer, onOpenMeditate, onChangeMeditateVisualizer, meditatePreviewPaused, visualPreviewOn }: DroneViewProps,
  ref,
) {
  const {
    state,
    setRoot,
    setOctave,
    setScale,
    setTuning,
    setRelation,
    setFineTuneOffsets,
    setPresetMorph,
    setPresetEvolve,
    toggleVoiceLayer,
    setVoiceLevel,
    setNoiseColor,
    setDrift,
    setAir,
    setTime,
    setSub,
    setBloom,
    setGlide,
    setLfoShape,
    setLfoRate,
    setLfoAmount,
    setClimate,
    toggleEffect,
    displayEffects,
    togglePlay,
    restartDrone,
    handlePreset,
    getSnapshot,
    applySnapshot,
    applyLivePatch,
    startImmediate,
    setJourney,
    setPartner,
    setEntrain,
  } = useDroneScene({
    engine,
    onTransportChange,
    onTonicChange,
    onPresetChange,
    onParamRecord,
  });

  // ── History: undo/redo + A/B snapshot slots ──────────────────────
  // History is debounced (400 ms idle after the last state change)
  // so a slider drag doesn't push 60 snapshots per second. While
  // undo/redo or an A/B recall is in flight, pushes are suppressed
  // (otherwise the applySnapshot call would immediately push the
  // just-applied state and drown the redo tail). Cap at 50 entries.
  const HISTORY_LIMIT = 50;
  const historyRef = useRef<DroneSessionSnapshot[]>([]);
  const historyIndexRef = useRef(-1);
  const slotARef = useRef<DroneSessionSnapshot | null>(null);
  const slotBRef = useRef<DroneSessionSnapshot | null>(null);
  const suppressPushRef = useRef(false);
  const [historyUi, setHistoryUi] = useState({
    canUndo: false,
    canRedo: false,
    hasSlotA: false,
    hasSlotB: false,
  });
  const [shapeHintsOn, setShapeHintsOn] = useState<boolean>(() => {
    try { return window.localStorage?.getItem("mdrone.shapeHintsOn") === "1"; }
    catch { return false; }
  });
  const toggleShapeHints = () => setShapeHintsOn((v) => {
    const next = !v;
    try { window.localStorage?.setItem("mdrone.shapeHintsOn", next ? "1" : "0"); }
    catch { /* noop */ }
    return next;
  });

  // Shape-panel collapse — on phones the SHAPE column (motion +
  // body + voices + gestures + scale + A/B + LFO2) swamps the XY
  // pad. Default to collapsed on narrow viewports; a header tap
  // toggles it. Desktop never reads this (CSS no-ops the class).
  const [shapeCollapsed, setShapeCollapsed] = useState<boolean>(() => {
    try {
      const saved = window.localStorage?.getItem("mdrone.shapeCollapsed");
      if (saved === "1") return true;
      if (saved === "0") return false;
    } catch { /* noop */ }
    return typeof window !== "undefined"
      && typeof window.matchMedia === "function"
      && window.matchMedia("(max-width: 600px)").matches;
  });
  const toggleShapeCollapsed = () => setShapeCollapsed((v) => {
    const next = !v;
    try { window.localStorage?.setItem("mdrone.shapeCollapsed", next ? "1" : "0"); }
    catch { /* noop */ }
    return next;
  });

  const syncHistoryUi = useCallback(() => {
    const next = {
      canUndo: historyIndexRef.current > 0,
      canRedo: historyIndexRef.current < historyRef.current.length - 1,
      hasSlotA: slotARef.current !== null,
      hasSlotB: slotBRef.current !== null,
    };
    setHistoryUi((prev) => (
      prev.canUndo === next.canUndo &&
      prev.canRedo === next.canRedo &&
      prev.hasSlotA === next.hasSlotA &&
      prev.hasSlotB === next.hasSlotB
        ? prev
        : next
    ));
  }, []);

  useEffect(() => {
    if (suppressPushRef.current) return;
    const handle = setTimeout(() => {
      if (suppressPushRef.current) return;
      const snap = getSnapshot();
      const hist = historyRef.current;
      hist.splice(historyIndexRef.current + 1);
      hist.push(snap);
      if (hist.length > HISTORY_LIMIT) hist.shift();
      historyIndexRef.current = hist.length - 1;
      syncHistoryUi();
    }, 400);
    return () => clearTimeout(handle);
  }, [state, getSnapshot, syncHistoryUi]);

  const applyAndSuppress = useCallback((snap: DroneSessionSnapshot) => {
    suppressPushRef.current = true;
    applySnapshot(snap);
    // Release after the push debounce window plus a margin so the
    // next state change from the user re-engages history cleanly.
    setTimeout(() => { suppressPushRef.current = false; }, 500);
  }, [applySnapshot]);

  const undo = useCallback(() => {
    if (historyIndexRef.current <= 0) return;
    historyIndexRef.current -= 1;
    applyAndSuppress(historyRef.current[historyIndexRef.current]);
    syncHistoryUi();
  }, [applyAndSuppress, syncHistoryUi]);

  const redo = useCallback(() => {
    if (historyIndexRef.current >= historyRef.current.length - 1) return;
    historyIndexRef.current += 1;
    applyAndSuppress(historyRef.current[historyIndexRef.current]);
    syncHistoryUi();
  }, [applyAndSuppress, syncHistoryUi]);

  const saveSlotA = useCallback(() => { slotARef.current = getSnapshot(); syncHistoryUi(); }, [getSnapshot, syncHistoryUi]);
  const saveSlotB = useCallback(() => { slotBRef.current = getSnapshot(); syncHistoryUi(); }, [getSnapshot, syncHistoryUi]);
  const recallSlotA = useCallback(() => { if (slotARef.current) applyAndSuppress(slotARef.current); }, [applyAndSuppress]);
  const recallSlotB = useCallback(() => { if (slotBRef.current) applyAndSuppress(slotBRef.current); }, [applyAndSuppress]);

  // A/B slot gesture: tap = recall (saves on empty slot), hold = save
  // (overwrites). Same 420 ms threshold the FxBar uses for its long-
  // press → modal gesture, so the "press-and-hold to open/commit" idiom
  // is consistent across the app.
  const slotHoldTimerRef = useRef<number | null>(null);
  const slotHoldFiredRef = useRef(false);
  const cancelSlotHold = useCallback(() => {
    if (slotHoldTimerRef.current !== null) {
      window.clearTimeout(slotHoldTimerRef.current);
      slotHoldTimerRef.current = null;
    }
  }, []);
  const startSlotHold = useCallback((save: () => void) => {
    slotHoldFiredRef.current = false;
    cancelSlotHold();
    slotHoldTimerRef.current = window.setTimeout(() => {
      slotHoldFiredRef.current = true;
      save();
    }, 420);
  }, [cancelSlotHold]);
  const clickSlotA = useCallback(() => {
    if (slotHoldFiredRef.current) {
      slotHoldFiredRef.current = false;
      return;
    }
    if (slotARef.current) recallSlotA();
    else saveSlotA();
  }, [recallSlotA, saveSlotA]);
  const clickSlotB = useCallback(() => {
    if (slotHoldFiredRef.current) {
      slotHoldFiredRef.current = false;
      return;
    }
    if (slotBRef.current) recallSlotB();
    else saveSlotB();
  }, [recallSlotB, saveSlotB]);

  // Progressive disclosure — collapsible sections. Default: collapsed.
  // Persisted to localStorage so the user's layout survives reloads.
  // Backwards-compat: missing keys (e.g. older saves with no `edit`)
  // fall back to defaultDisclosure so users coming from a previous
  // build land on the new Performance Surface defaults.
  const DISCLOSURE_KEY = "mdrone-disclosure";
  type Section = "presets" | "tuning" | "detune" | "perform" | "edit";
  const defaultDisclosure: Record<Section, boolean> = {
    presets: false, tuning: false, detune: false, perform: true, edit: false,
  };
  const [disclosed, setDisclosed] = useState<Record<Section, boolean>>(() => {
    try {
      const raw = localStorage.getItem(DISCLOSURE_KEY);
      return raw ? { ...defaultDisclosure, ...JSON.parse(raw) } : defaultDisclosure;
    } catch { return defaultDisclosure; }
  });
  const toggle = (s: Section) => {
    setDisclosed((prev) => {
      const next = { ...prev, [s]: !prev[s] };
      try { localStorage.setItem(DISCLOSURE_KEY, JSON.stringify(next)); } catch { /* noop */ }
      return next;
    });
  };

  // MUTATE intensity — local state, not persisted across reloads.
  // 0.25 is an audible but coherent default for typical drones.
  // Source of truth lives in Layout (Settings → GENERAL slider). The
  // local alias keeps the callsites at MUTATE click + tooltip terse.
  const mutateIntensity = mutateIntensityProp ?? 0.25;
  // Scale-editor modal — opens from the ✎ button beside the tuning
  // dropdown so users can author and save custom tuning tables
  // (degrees in cents above the root). See audit P2 — scale editor UI.
  const [scaleEditorOpen, setScaleEditorOpen] = useState(false);

  // LFO ↔ Ableton Link tempo sync. When `lfoSyncMode` is non-free
  // AND the Link bridge reports `connected`, the LFO rate is driven
  // by tempo × division and the user's manual macro becomes a
  // read-only display. Persisted to localStorage so the mode
  // survives reloads.
  const [lfoSyncMode, setLfoSyncMode] = useState<LfoSyncMode>(() => loadLfoSyncMode());
  const [linkState, setLinkState] = useState<LinkState>(() => getLinkState());
  useEffect(() => {
    // Silent auto-detect on mount — if the bridge isn't running,
    // nothing happens. Explicit enable (with retries) is driven
    // from Settings via enableLinkBridge().
    autoDetectLinkBridge();
    const unsub = onLinkState((s) => setLinkState(s));
    return unsub;
  }, []);
  useEffect(() => {
    try { window.localStorage?.setItem(STORAGE_KEYS.lfoSyncMode, lfoSyncMode); } catch { /* noop */ }
  }, [lfoSyncMode]);
  // When sync is active, continuously push the computed rate to the
  // engine so tempo changes track in real time. Clamped to the
  // macro's 0.05..8 Hz range so fast divisions at high BPM don't
  // overdrive the LFO.
  useEffect(() => {
    if (lfoSyncMode === "free" || !linkState.connected) return;
    const hz = Math.max(0.05, Math.min(8, lfoSyncedHz(lfoSyncMode, linkState.tempo)));
    setLfoRate(hz);
  }, [lfoSyncMode, linkState.tempo, linkState.connected, setLfoRate]);
  const lfoSyncActive = lfoSyncMode !== "free" && linkState.connected;
  const cycleLfoSyncMode = useCallback(() => {
    setLfoSyncMode((cur) => LFO_SYNC_MODES[(LFO_SYNC_MODES.indexOf(cur) + 1) % LFO_SYNC_MODES.length]);
  }, []);
  // User-customised effect chain order, persisted in localStorage.
  // Hydrated from storage on mount; any invalid / missing value falls
  // back to the canonical EFFECT_ORDER. Every change is pushed to the
  // engine via setEffectOrder. Per audit P2 — drag-reorderable FX chain.
  const [effectOrder, setEffectOrder] = useState<readonly EffectId[]>(() => {
    try {
      const raw = typeof window !== "undefined" ? window.localStorage?.getItem(STORAGE_KEYS.effectOrder) : null;
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length === EFFECT_ORDER.length) {
          const known = new Set<string>(EFFECT_ORDER);
          const seen = new Set<string>();
          const ok = parsed.every((x) => typeof x === "string" && known.has(x) && !seen.has(x) && (seen.add(x), true));
          if (ok) return parsed as EffectId[];
        }
      }
    } catch { /* swallow — fall back to default */ }
    return EFFECT_ORDER;
  });
  // Push the hydrated / latest order to the engine whenever either
  // changes. `engine` may be null during the first render before the
  // AudioContext boots — the engine spin-up path will pick up the
  // current order from state at that point.
  useEffect(() => {
    if (engine) engine.setEffectOrder(effectOrder);
  }, [engine, effectOrder]);
  const handleEffectReorder = useCallback((next: readonly EffectId[]) => {
    setEffectOrder(next);
    try { window.localStorage?.setItem(STORAGE_KEYS.effectOrder, JSON.stringify(next)); } catch { /* noop */ }
  }, []);

  // FX suppressed by runtime stability mechanisms (adaptive mitigation
  // and/or LIVE SAFE). Both overlays force the live FxChain off while
  // preserving user intent, so FxBar renders these as ON-but-suppressed
  // rather than confusing the user with a button that flipped itself.
  const [adaptiveBypassed, setAdaptiveBypassed] = useState<readonly EffectId[]>([]);
  const [liveSafeBypassed, setLiveSafeBypassed] = useState<readonly EffectId[]>([]);
  useEffect(() => {
    if (!engine) return;
    return engine.subscribeAdaptiveStability((s) => setAdaptiveBypassed(s.bypassedFx));
  }, [engine]);
  useEffect(() => {
    if (!engine) return;
    return engine.subscribeLiveSafe((s) => setLiveSafeBypassed(s.suppressedFx));
  }, [engine]);
  const suppressedFx = useMemo<ReadonlySet<EffectId>>(
    () => new Set<EffectId>([...adaptiveBypassed, ...liveSafeBypassed]),
    [adaptiveBypassed, liveSafeBypassed],
  );

  // Tanpura string-tuning picker. Shown in the SHAPE panel only when
  // the tanpura voice is active. Persisted so reloads keep the choice.
  // Pitch-locked LFO division cycle — 0 = off, otherwise LFO rate =
  // rootHz / N so pitch changes retune the LFO proportionally
  // (Radigue / Éliane-style). Mirror the engine so cycling through
  // the chip updates both sides. Not localStorage-persisted; scene
  // snapshots carry it when non-zero.
  const [lfoDivision, setLfoDivisionState] = useState<number>(
    () => engine?.getLfoDivision?.() ?? 0,
  );
  useEffect(() => {
    if (engine) engine.setLfoDivision(lfoDivision);
  }, [engine, lfoDivision]);
  const cycleLfoDivision = useCallback(() => {
    setLfoDivisionState((prev) => {
      if (prev === 0) return 1024;
      if (prev === 1024) return 2048;
      if (prev === 2048) return 4096;
      return 0;
    });
  }, []);

  const [tanpuraTuning, setTanpuraTuningState] = useState<TanpuraTuningId>(() => {
    try {
      const raw = typeof window !== "undefined" ? window.localStorage?.getItem(STORAGE_KEYS.tanpuraTuning) : null;
      if (raw && (TANPURA_TUNING_IDS as readonly string[]).includes(raw)) return raw as TanpuraTuningId;
    } catch { /* noop */ }
    return "classic";
  });
  useEffect(() => {
    if (engine) engine.setTanpuraTuning(tanpuraTuning);
  }, [engine, tanpuraTuning]);
  const handleTanpuraTuning = useCallback((id: TanpuraTuningId) => {
    setTanpuraTuningState(id);
    try { window.localStorage?.setItem(STORAGE_KEYS.tanpuraTuning, id); } catch { /* noop */ }
  }, []);

  // ARRIVE choreography — a tiny 3-step state machine that runs only
  // on a true first launch (no prior autosave). Teaches the most
  // playable controls in order: SHAPE → WEATHER → TONIC. Strictly
  // gesture-driven: each step advances only on real user interaction
  // with that surface; no auto-advance timers.
  //
  // Linger: between SHAPE→WEATHER and WEATHER→TONIC, the next
  // callout + glow are suppressed for ARRIVE_LINGER_MS so the user
  // can hear the change they just made before being prompted again.
  // TONIC has no linger — gesture dismisses immediately.
  type ArriveStep = "shape" | "weather" | "tonic" | null;
  const ARRIVE_LINGER_MS = 5000;
  const [arriveStep, setArriveStep] = useState<ArriveStep>(() => {
    try { return !localStorage.getItem("mdrone-autosave") ? "shape" : null; }
    catch { return "shape"; }
  });
  const [arriveLingering, setArriveLingering] = useState(false);
  const lingerTimerRef = useRef<number | null>(null);
  const advanceArrive = useCallback((from: NonNullable<ArriveStep>) => {
    setArriveStep((s) => {
      if (s !== from) return s;
      if (from === "tonic") return null;
      const next: ArriveStep = from === "shape" ? "weather" : "tonic";
      if (lingerTimerRef.current !== null) {
        window.clearTimeout(lingerTimerRef.current);
      }
      setArriveLingering(true);
      lingerTimerRef.current = window.setTimeout(() => {
        setArriveLingering(false);
        lingerTimerRef.current = null;
      }, ARRIVE_LINGER_MS);
      return next;
    });
  }, []);
  useEffect(() => {
    return () => {
      if (lingerTimerRef.current !== null) {
        window.clearTimeout(lingerTimerRef.current);
        lingerTimerRef.current = null;
      }
    };
  }, []);
  // True only when the current step's callout/glow should actually
  // render (i.e. step is set AND we're not inside a linger window).
  const arriveVisible = arriveStep !== null && !arriveLingering;
  // Back-compat alias for downstream code referring to the older
  // single-flag intro. WEATHER pad's pulse follows the same gate.
  const weatherIntro = arriveStep === "weather" && arriveVisible;

  // Auto-open the DETUNE disclosure when fine-tune offsets become
  // non-zero (e.g. loading a preset or share URL with authored
  // detune). Kept transient — only the manual toggle persists to
  // localStorage, so the next load without offsets falls back to
  // the user's explicit preference rather than sticking open.
  //
  // This is a deliberate set-state-in-effect: the trigger is an
  // external source-of-truth change (state.fineTuneOffsets, mutated
  // by reducer dispatch), and we sync the local disclosure state to
  // it. There's no derived alternative that lets the user manually
  // collapse without re-opening on the next render.
  useEffect(() => {
    if (disclosed.detune) return;
    if (!state.fineTuneOffsets.some((o) => o !== 0)) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDisclosed((prev) => ({ ...prev, detune: true }));
  }, [state.fineTuneOffsets, disclosed.detune]);

  // Tutorial — when the advanced flow is triggered from Settings,
  // the DroneView ADVANCED section needs to be open so the spotlight
  // can land on MICROTONAL + the tuning picker underneath.
  useEffect(() => {
    return onExpandAdvancedRequested(() => {
      setDisclosed((prev) => prev.tuning ? prev : { ...prev, tuning: true });
    });
  }, []);

  // Effects tour anchors on `[data-tutor="fx-bar"]` which lives
  // inside the EDIT disclosure (default closed). Same pattern as
  // ADVANCED above — open EDIT before the spotlight tries to land.
  useEffect(() => {
    return onExpandEditRequested(() => {
      setDisclosed((prev) => prev.edit ? prev : { ...prev, edit: true });
    });
  }, []);

  // Push a short "fine-tune active" hint to the header. The hint is
  // `±N ¢` where N is the largest absolute offset, only when both
  // tuningId + relationId are set and at least one finite, non-zero
  // offset exists. Otherwise null (header hides the pill).
  //
  // Note: state.fineTuneOffsets can contain sparse slots (undefined)
  // because the slider onChange spreads an empty array and assigns
  // by index. Filter to finite numbers before computing the peak so
  // the hint never reads "±NaN ¢".
  useEffect(() => {
    if (!onTuneOffsetChange) return;
    if (!state.tuningId || !state.relationId) {
      onTuneOffsetChange(null);
      return;
    }
    const finite = state.fineTuneOffsets.filter(
      (o): o is number => typeof o === "number" && Number.isFinite(o),
    );
    const peak = finite.length > 0 ? Math.max(...finite.map(Math.abs)) : 0;
    if (peak === 0) {
      onTuneOffsetChange(null);
      return;
    }
    const rounded = Math.round(peak * 10) / 10;
    onTuneOffsetChange(`±${rounded.toFixed(1)} ¢`);
  }, [state.fineTuneOffsets, state.tuningId, state.relationId, onTuneOffsetChange]);

  // Active preset-group tab. Follows the active preset's group
  // automatically; a user tab-click overrides until the preset changes.
  // Purely derived — no refs, no effects.
  const presetGroupForActive = (
    state.activePresetId
      ? PRESETS.find((p) => p.id === state.activePresetId)?.group
      : null
  ) ?? PRESET_GROUPS[0];
  const [tabOverride, setTabOverride] = useState<{
    group: PresetGroup;
    presetId: string | null;
  } | null>(null);

  // Scene-chain morph — when seconds > 0, clicking a preset runs a
  // fade-out → snap → fade-in crossfade via AudioEngine.morphRun so
  // back-to-back scenes in a 30-min set aren't abrupt cuts.
  // Transient UI-only state; not persisted.
  const [morphSeconds, setMorphSeconds] = useState<number>(0);
  const cycleMorph = useCallback(() => {
    setMorphSeconds((prev) => {
      const i = MORPH_CYCLE.indexOf(prev as (typeof MORPH_CYCLE)[number]);
      return MORPH_CYCLE[(i + 1) % MORPH_CYCLE.length];
    });
  }, []);
  const morphLabel = morphSeconds === 0
    ? "CUT"
    : morphSeconds < 60
      ? `${morphSeconds}s`
      : `${Math.round(morphSeconds / 60)}m`;
  const onPresetClick = useCallback((presetId: string, group: PresetGroup) => {
    const run = () => { handlePreset(presetId); setTabOverride({ group, presetId }); };
    if (morphSeconds > 0 && engine) {
      engine.morphRun(run, morphSeconds);
    } else {
      run();
    }
  }, [engine, handlePreset, morphSeconds]);
  const presetTab =
    tabOverride && tabOverride.presetId === state.activePresetId
      ? tabOverride.group
      : presetGroupForActive;
  const visiblePresets = PRESETS
    .filter((p) => p.group === presetTab && !p.hidden)
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));
  const microtunedBaseIntervals =
    state.tuningId && state.relationId
      ? resolveTuning(state.tuningId, state.relationId)
      : [];
  const microtunedLabels =
    state.tuningId && state.relationId
      ? relationLabels(state.relationId)
      : [];
  const fineDetuneRows = microtunedBaseIntervals
    .map((base, index) => ({
      index,
      base,
      label: microtunedLabels[index] ?? `INT ${index + 1}`,
      offset: state.fineTuneOffsets[index] ?? 0,
    }))
    .filter((row) => row.index > 0);
  const intervalReadoutRows = microtunedBaseIntervals.map((base, index) => {
    const offset = index === 0 ? 0 : (state.fineTuneOffsets[index] ?? 0);
    const final = index === 0 ? 0 : base + offset;
    return {
      index,
      label: microtunedLabels[index] ?? `INT ${index + 1}`,
      final,
      offset,
    };
  });
  // Microtonal mode is active when both a tuning and a relation are
  // set — the same condition that gates `resolveTuning` above. Kept
  // as a single derived boolean so the MODE tab UI and the downstream
  // rendering can't disagree.
  const modeIsMicro = Boolean(state.tuningId && state.relationId);

  // Keyboard shortcuts — Space: HOLD, Cmd/Ctrl+Z: undo, Cmd/Ctrl+Shift+Z: redo.
  // Ignored while typing into an input/textarea/contentEditable.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.code === "Space") {
        e.preventDefault();
        togglePlay();
        return;
      }
      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, undo, redo]);

  const dismissWeatherIntro = useCallback(() => advanceArrive("weather"), [advanceArrive]);

  // Explicit user-originated tonic setter. Use ONLY at UI call sites
  // (piano keys, mobile dropdown, MIDI note-on, QWERTY tonic) — not
  // for programmatic paths like scene/preset/share/autosave restore.
  // Those still use the raw `setRoot` so loading a scene with a
  // different root never accidentally advances ARRIVE.
  const setRootFromUser = useCallback<typeof setRoot>((pc) => {
    setRoot(pc);
    advanceArrive("tonic");
  }, [setRoot, advanceArrive]);

  // Wrap getSnapshot/applySnapshot so tanpuraTuning — which lives in
  // DroneView state rather than the scene reducer — round-trips
  // through PortableScene the same way effectOrder does. Apply routes
  // through handleTanpuraTuning so React state, localStorage, and
  // engine all stay in sync (the useEffect above would otherwise
  // overwrite the engine with the stale local value on next render).
  const getSnapshotWithLocals = useCallback((): DroneSessionSnapshot => {
    const base = getSnapshot();
    const snap: DroneSessionSnapshot = { ...base, tanpuraTuning };
    // lfoDivision lives on the engine (MotionEngine); capture it
    // only when non-zero so legacy saves stay byte-identical for
    // scenes that never touched the pitch-locked LFO.
    const div = engine?.getLfoDivision?.() ?? 0;
    if (div > 0) snap.lfoDivision = div;
    return snap;
  }, [getSnapshot, tanpuraTuning, engine]);
  const applySnapshotWithLocals = useCallback((snap: DroneSessionSnapshot) => {
    if (snap.tanpuraTuning && snap.tanpuraTuning !== tanpuraTuning) {
      handleTanpuraTuning(snap.tanpuraTuning);
    }
    // Sync local UI state to the scene's lfoDivision so the chip
    // reflects the loaded value (engine side is also set inside
    // applyDroneSnapshot, but our useEffect would otherwise push
    // the stale local 0 back on next render).
    const nextDiv = typeof snap.lfoDivision === "number" ? snap.lfoDivision : 0;
    if (nextDiv !== lfoDivision) setLfoDivisionState(nextDiv);
    applySnapshot(snap);
  }, [applySnapshot, handleTanpuraTuning, tanpuraTuning, lfoDivision]);

  useImperativeHandle(ref, () => ({
    getSnapshot: getSnapshotWithLocals,
    applySnapshot: applySnapshotWithLocals,
    applyLivePatch,
    setVoiceLevel,
    togglePlay,
    restartDrone,
    setRoot,
    setRootFromUser,
    setOctave,
    applyPresetById(presetId) {
      handlePreset(presetId);
    },
    startImmediate,
    openPresets() {
      setDisclosed((prev) => prev.presets ? prev : { ...prev, presets: true });
    },
    applyEffectOrder: handleEffectReorder,
  }), [
    getSnapshotWithLocals,
    applySnapshotWithLocals,
    applyLivePatch,
    setVoiceLevel,
    setOctave,
    setRoot,
    setRootFromUser,
    startImmediate,
    togglePlay,
    restartDrone,
    handlePreset,
    handleEffectReorder,
  ]);

  return (
    <>
    <div className="drone-layout">
      <div className="preset-vu-wide">
        <VuMeter
          analyser={engine?.getAnalyser() ?? null}
          width={600}
          height={16}
          isActive={() => engine?.isPlaying() ?? false}
        />
      </div>
      <div className="panel preset-panel preset-panel-wide">
        {/* Compact preset strip — active preset meta, inline keyboard,
            tonic readout, expand chevron. Converted from a single
            <button> to a flex row so the inline keyboard can host its
            own clickable keys without nesting-button invariants. */}
        <div className="preset-strip">
          {/* Row 1 — IDENTITY: what scene is loaded, + global scene
              actions (morph, expand chevron). No tonic / no keys. */}
          <div className="preset-strip-identity">
          <button
            type="button"
            data-tutor="presets"
            className="preset-strip-meta-btn"
            onClick={() => toggle("presets" as Section)}
            title="Click to browse presets"
          >
            {(() => {
              const active = PRESETS.find((p) => p.id === state.activePresetId);
              return active ? (
                <>
                  <span
                    className="preset-strip-icon"
                    style={{ ["--icon" as string]: `url(/preset-icons/${active.id}.svg)` } as React.CSSProperties}
                    aria-hidden="true"
                  />
                  <span className="preset-strip-meta">
                    <span className="preset-strip-name">{active.name}</span>
                    <span className="preset-strip-attr">{active.attribution}</span>
                  </span>
                </>
              ) : (
                <span className="preset-strip-name">No preset</span>
              );
            })()}
          </button>
          {/* Two visually grouped clusters next to the playing-preset
              identity:
                · TRIGGERS — momentary actions (ATTUNE / MUTATE),
                  always reachable without expanding the preset list.
                · STATE — persistent scene controls (PARTNER /
                  JOURNEY / XFADE) that read dim-when-off and
                  light up with their value when active. The "off"
                  word never appears: state is conveyed by glow,
                  not by reading text.
              On mobile each cluster wraps to its own row inside the
              identity flex container (`flex-wrap: wrap`). */}
          <div className="preset-strip-actions-triggers">
            <button
              type="button"
              data-tutor="good-drone"
              className="preset-mut-btn preset-strip-action"
              onClick={() => {
                const g = sampleGoodDrone();
                setTuning(g.tuningId);
                setRelation(g.relationId);
                setFineTuneOffsets(g.fineTuneOffsets);
              }}
              title="ATTUNE — sample a curated microtonal tuning + subtle (±2–5¢) detune for the current preset. Touches only the tuning layer: voicing, FX, and motion are preserved. Click again for a different tuning."
              aria-label="Attune — sample a curated microtonal tuning"
            >
              <span className="preset-mut-btn-label">ATTUNE</span>
              <span className="preset-mut-btn-icon" aria-hidden="true">✦</span>
            </button>
            <button
              type="button"
              className="preset-mut-btn preset-strip-action"
              onClick={() => onMutateScene?.(mutateIntensity)}
              title={`MUTATE — one-shot random perturbation of the current scene by ${Math.round(mutateIntensity * 100)}% (voice mix, macros, effect levels). Fires once per click.`}
              aria-label="Mutate the current scene"
              data-midi-id="mutate"
            >
              <span className="preset-mut-btn-label">MUTATE</span>
              <span className="preset-mut-btn-icon" aria-hidden="true">↯</span>
            </button>
          </div>
          <div className="preset-strip-actions-state">
            <DropdownSelect
              value={state.partner.enabled ? state.partner.relation : ""}
              options={[
                { value: "", label: "PARTNER" },
                ...PARTNER_RELATIONS.map((r) => ({ value: r, label: `PARTNER · ${r}` })),
              ]}
              onChange={(v) => {
                if (v === "") {
                  setPartner({ ...state.partner, enabled: false });
                } else {
                  setPartner({ enabled: true, relation: v as PartnerRelation });
                }
              }}
              className={`preset-journey-select preset-strip-action-select preset-strip-action-state${
                state.partner.enabled ? " preset-strip-action-on" : ""
              }`}
              title="PARTNER — sympathetic second drone layer at a fixed musical relation."
              ariaLabel="Sympathetic partner"
            />
            <DropdownSelect
              value={state.journey ?? ""}
              options={[
                { value: "", label: "JOURNEY" },
                ...JOURNEY_IDS.map((id) => ({ value: id, label: `JOURNEY · ${JOURNEYS[id].label}` })),
              ]}
              onChange={(v) => setJourney(v === "" ? null : (v as JourneyId))}
              className={`preset-journey-select preset-strip-action-select preset-strip-action-state${
                state.journey ? " preset-strip-action-on" : ""
              }`}
              title="JOURNEY (~20 min) — authored 4-phase ritual: arrival → bloom → suspension → dissolve. While active, replaces EVOLVE's automatic drift with the scripted arc."
              ariaLabel="Journey"
            />
            <button
              type="button"
              className={`preset-mut-btn preset-strip-action preset-strip-action-state${
                morphSeconds > 0 ? " preset-strip-action-on preset-mut-btn-armed" : ""
              }`}
              onClick={cycleMorph}
              title={
                morphSeconds === 0
                  ? "Preset crossfade OFF — preset clicks swap instantly. Click to cycle through 10s / 30s / 2min crossfade."
                  : `Preset crossfade ON — clicks crossfade over ${morphLabel} (fade-out, snap, fade-in).`
              }
              aria-label="Preset crossfade"
            >
              <span className="preset-mut-btn-label">↔ XFADE{morphSeconds === 0 ? "" : ` · ${morphLabel}`}</span>
              <span className="preset-mut-btn-icon" aria-hidden="true">↔{morphSeconds === 0 ? "" : morphLabel}</span>
            </button>
          </div>
          </div>
          {/* Row 2 — PERFORMANCE: what note is playing. Piano + octave
              + kbd toggle + Hz readout. On mobile this row is lifted
              to a persistent footer-above-footer via CSS (see
              @media (max-width: 720px) .preset-strip-perform). */}
          <div
            className={
              arriveStep === "tonic" && arriveVisible
                ? "preset-strip-perform arrive-target-active"
                : "preset-strip-perform"
            }
            data-arrive-target={arriveStep === "tonic" && arriveVisible ? "tonic" : undefined}
          >
          {arriveStep === "tonic" && arriveVisible && (
            <ArriveCallout
              step="tonic"
              title="Try a new TONIC"
              body="Tap a key to retune the drone"
            />
          )}
          {/* Inline piano keyboard — sits left of the tonic readout so
              the user can retune without scrolling. Relocated from the
              scene-actions area per the layout pass (P2.3). Hidden on
              mobile where space is tight; the two native-select
              dropdowns below take its place there. */}
          <div className="tonic-keys tonic-keys-inline preset-strip-keys">
            {PITCH_CLASSES.map((pc) => {
              const isSharp = pc.includes("#");
              const isActive = state.root === pc;
              return (
                <button
                  key={pc}
                  type="button"
                  className={
                    `tonic-key${isSharp ? " tonic-key-black" : ""}${isActive ? " tonic-key-active" : ""}`
                  }
                  onClick={() => setRootFromUser(pc)}
                  title={pc}
                  aria-label={pc}
                >
                  {isActive ? pc.replace("#", "♯") : ""}
                </button>
              );
            })}
          </div>
          {/* Mobile tonic picker — custom-styled DropdownSelect (not
              the native OS select) listing all 72 options (12 pitch
              classes × 6 octaves) grouped by octave. Each option
              labelled "A2 · 110.0 Hz" so the closed button displays
              what's playing. Only shown on narrow viewports (CSS
              toggles visibility at ≤ 720 px); the inline keyboard
              above remains the default on desktop. */}
          <div className="preset-strip-tonic-picker">
            <DropdownSelect
              value={`${state.root}|${state.octave}`}
              groups={[1, 2, 3, 4, 5, 6].map((oct) => ({
                label: `OCTAVE ${oct}`,
                items: PITCH_CLASSES.map((pc) => {
                  const idx = PITCH_CLASSES.indexOf(pc);
                  const semi = idx - 9 + (oct - 4) * 12;
                  const hz = 440 * Math.pow(2, semi / 12);
                  return {
                    value: `${pc}|${oct}`,
                    label: `${pc.replace("#", "♯")}${oct} · ${hz.toFixed(1)} Hz`,
                  };
                }),
              }))}
              onChange={(v) => {
                const [pc, oct] = v.split("|");
                setRootFromUser(pc as PitchClass);
                setOctave(parseInt(oct, 10));
              }}
              className="preset-strip-tonic-btn"
              ariaLabel="Tonic and octave"
              title="Pick the tonic and octave"
            />
          </div>
          <div className="weather-octave preset-strip-octave">
            <button
              type="button"
              className="header-octave-btn"
              onClick={() => setOctave(Math.max(1, state.octave - 1))}
              disabled={state.octave <= 1}
              aria-label="Octave down"
            >
              −
            </button>
            <span className="header-octave-value">{state.octave}</span>
            <button
              type="button"
              className="header-octave-btn"
              onClick={() => setOctave(Math.min(6, state.octave + 1))}
              disabled={state.octave >= 6}
              aria-label="Octave up"
            >
              +
            </button>
            <button
              type="button"
              className={kbdActive ? "header-kbd-btn header-kbd-btn-active" : "header-kbd-btn"}
              onClick={onToggleKbd}
              title={kbdActive
                ? "QWERTY keyboard active — A=C W=C# S=D E=D# D=E F=F T=F# G=G Y=G# H=A U=A# J=B · Z/X = octave down/up"
                : "Enable QWERTY keyboard as tonic controller"}
            >
              ⌨
            </button>
          </div>
          <span className="preset-strip-tonic">
            {modeIsMicro && (() => {
              const tuning = TUNINGS.find((t) => t.id === state.tuningId);
              const relation = RELATIONS.find((r) => r.id === state.relationId);
              if (!tuning || !relation) return null;
              const tuningShort: Record<string, string> = {
                equal: "12-TET",
                just5: "Just 5",
                meantone: "Meantone",
                harmonics: "Harmonics",
                "maqam-rast": "Rast",
                slendro: "Slendro",
                "custom:young-wtp": "Young WTP",
                "custom:just7": "Just 7",
                "custom:partch-11": "Partch 11",
                "custom:15-tet": "15-TET",
                "custom:pythagorean": "Pythagorean",
                "custom:kirnberger-iii": "Kirnberger",
                "custom:werckmeister-iii": "Werckmeister",
                "custom:17-tet": "17-TET",
                "custom:19-tet": "19-TET",
                "custom:22-edo": "22-EDO",
                "custom:31-tet": "31-TET",
                "custom:yaman": "Yaman",
                "custom:pelog": "Pelog",
                "custom:bayati": "Bayati",
                "custom:otonal-16-32": "Otonal",
                "custom:spectral-primes": "Spectral",
                "custom:skewed-pythagorean": "Skewed",
                "custom:cluster-sruti": "Cluster",
                "custom:hollow-fifth": "Hollow",
                "custom:mdrone-signature": "Just×31-TET",
              };
              const relationShort: Record<string, string> = {
                unison: "Unison",
                "tonic-fifth": "5th",
                "tonic-fourth": "4th",
                "minor-triad": "Min triad",
                "drone-triad": "Triad",
                "harmonic-stack": "Stack",
              };
              const fallback = (s: string) => s.replace(/\s*\([^)]*\)\s*/g, "").trim();
              const tLabel = tuningShort[tuning.id] ?? fallback(tuning.label);
              const rLabel = relationShort[relation.id] ?? fallback(relation.label);
              return (
                <>
                  <span className="preset-strip-tune">{tLabel} · {rLabel}</span>
                  {" · "}
                </>
              );
            })()}
            {state.root}{state.octave} · {(() => {
              const idx = PITCH_CLASSES.indexOf(state.root);
              const semi = idx - 9 + (state.octave - 4) * 12;
              return (440 * Math.pow(2, semi / 12)).toFixed(1);
            })()} Hz
          </span>
          </div>
          {/* Expand chevron in a trailing slot inside the identity
              row — stays aligned right via the grid-area layout.
              Preset crossfade (↔) moved to the scene-actions row
              next to MUTATE, where the other preset-transition
              controls live. */}
          <div className="preset-strip-scene-actions">
          <button
            type="button"
            className="preset-strip-chevron"
            onClick={() => toggle("presets" as Section)}
            aria-label={disclosed.presets ? "Collapse preset list" : "Expand preset list"}
          >
            {disclosed.presets ? "▾" : "▸"}
          </button>
          </div>
        </div>
        {disclosed.presets && (
        <>
        <div className="preset-tabs" role="tablist">
          {PRESET_GROUPS.map((g) => (
            <button
              key={g}
              role="tab"
              aria-selected={presetTab === g}
              className={presetTab === g ? "preset-tab preset-tab-active" : "preset-tab"}
              onClick={() => setTabOverride({ group: g, presetId: state.activePresetId })}
            >
              {SHORT_GROUP_LABELS[g] ?? g}
            </button>
          ))}
        </div>
        <div className="preset-grid">
          {visiblePresets.map((p) => {
            const isArrival = (ARRIVAL_PRESET_IDS as readonly string[]).includes(p.id);
            return (
            <button
              key={p.id}
              onClick={() => onPresetClick(p.id, p.group)}
              className={state.activePresetId === p.id ? "preset-btn preset-btn-active" : "preset-btn"}
              title={`${p.name} — ${p.attribution}${isArrival ? "\n\n✦ Curated arrival preset" : ""}${p.testedAt ? `\n\n✓ Tested ${p.testedAt}${p.testedHardware ? ` — ${p.testedHardware}` : ""}` : ""}\n\n${p.hint}`}
            >
              <span
                className="preset-btn-icon"
                style={{ ["--icon" as string]: `url(/preset-icons/${p.id}.svg)` } as React.CSSProperties}
                aria-hidden="true"
              />
              <span className="preset-btn-meta">
                <span className="preset-btn-name">
                  {isArrival && <span className="preset-btn-arrival" aria-hidden="true">✦ </span>}
                  {p.name}
                  {p.testedAt && <span className="preset-btn-tested" aria-label="tested preset"> ✓</span>}
                </span>
                <span className="preset-btn-attr">{p.attribution}</span>
              </span>
            </button>
            );
          })}
        </div>
        </>
        )}

        {/* ARRIVE choreography is now inline-targeted — each step
            renders an <ArriveCallout> directly inside the surface
            it teaches (SHAPE panel, WEATHER pad, TONIC keys), and
            that surface gets an `.arrive-target-active` glow class.
            See renders below. */}
        {/* Inline MEDITATE preview — small live tile sitting above the
            WEATHER pad. Runs the currently-selected MEDITATE visualizer
            at 15 fps so DRONE has a quiet instrument-display reading of
            what MEDITATE will expand into. Selector inline; tap canvas
            to expand to MEDITATE. */}
        {visualPreviewOn && meditateVisualizer && onOpenMeditate && (
          <Suspense fallback={null}>
            <VisualizerPreview
              engine={engine}
              visualizer={meditateVisualizer}
              onChangeVisualizer={onChangeMeditateVisualizer}
              onOpen={onOpenMeditate}
              paused={meditatePreviewPaused}
            />
          </Suspense>
        )}
        <button
          className="disclosure-toggle disclosure-toggle-wide"
          onClick={() => toggle("perform")}
          aria-expanded={disclosed.perform}
        >
          <span className="disclosure-arrow">{disclosed.perform ? "▾" : "▸"}</span>
          PERFORM
        </button>
        {disclosed.perform && (
        <div className="weather-macro-row">
          <WeatherPad
            climateX={state.climateX}
            climateY={state.climateY}
            onChange={setClimate}
            intro={weatherIntro}
            onDismissIntro={dismissWeatherIntro}
            analyser={engine?.getAnalyser() ?? null}
            visual={weatherVisual ?? "flow"}
            arriveActive={arriveStep === "weather" && arriveVisible}
            arriveCallout={
              arriveStep === "weather" && arriveVisible ? (
                <ArriveCallout
                  step="weather"
                  title="Move the room"
                  body="Drag WEATHER"
                />
              ) : null
            }
          />

          {/* Mobile tonic + octave — lives between the XY pad and the
              SHAPE column on narrow viewports, so the performance
              control sits next to the element it performs against
              rather than pinned to the bottom of the viewport.
              CSS-hidden on desktop; the perform strip inside the
              preset panel remains authoritative there. */}
          <div className="mobile-perform-row">
            <div className="preset-strip-tonic-picker mobile-perform-tonic">
              <DropdownSelect
                value={`${state.root}|${state.octave}`}
                groups={[1, 2, 3, 4, 5, 6].map((oct) => ({
                  label: `OCTAVE ${oct}`,
                  items: PITCH_CLASSES.map((pc) => {
                    const idx = PITCH_CLASSES.indexOf(pc);
                    const semi = idx - 9 + (oct - 4) * 12;
                    const hz = 440 * Math.pow(2, semi / 12);
                    return {
                      value: `${pc}|${oct}`,
                      label: `${pc.replace("#", "♯")}${oct} · ${hz.toFixed(1)} Hz`,
                    };
                  }),
                }))}
                onChange={(v) => {
                  const [pc, oct] = v.split("|");
                  setRootFromUser(pc as PitchClass);
                  setOctave(parseInt(oct, 10));
                }}
                className="preset-strip-tonic-btn"
                ariaLabel="Tonic and octave"
                title="Pick the tonic and octave"
              />
            </div>
            <div className="weather-octave mobile-perform-octave">
              <button
                type="button"
                className="header-octave-btn"
                onClick={() => setOctave(Math.max(1, state.octave - 1))}
                disabled={state.octave <= 1}
                aria-label="Octave down"
              >
                −
              </button>
              <span className="header-octave-value">{state.octave}</span>
              <button
                type="button"
                className="header-octave-btn"
                onClick={() => setOctave(Math.min(6, state.octave + 1))}
                disabled={state.octave >= 6}
                aria-label="Octave up"
              >
                +
              </button>
            </div>
          </div>

          <div
            data-tutor="shape"
            data-arrive-target={arriveStep === "shape" && arriveVisible ? "shape" : undefined}
            className={[
              "weather-controls",
              shapeHintsOn ? "shape-hints-on" : "",
              shapeCollapsed ? "shape-collapsed" : "",
              arriveStep === "shape" && arriveVisible ? "arrive-target-active" : "",
            ].filter(Boolean).join(" ")}
            onPointerDownCapture={() => {
              // First-touch advances ARRIVE if it's still on this step.
              // The dedicated SHAPE tutorial flow was removed — the
              // inline ARRIVE callout teaches the panel sufficiently.
              advanceArrive("shape");
            }}
            onInputCapture={() => {
              // Catches keyboard ArrowUp/Down on any macro range
              // input (or programmatic input events). Range inputs
              // fire `input` on every value change, so this advances
              // ARRIVE for keyboard-only users too. Bubbles up from
              // inputs since `input` is a bubbling event.
              advanceArrive("shape");
            }}
          >
            <div className="shape-header">
              <button
                type="button"
                className="shape-collapse-toggle"
                onClick={toggleShapeCollapsed}
                title={shapeCollapsed ? "Expand SHAPE" : "Collapse SHAPE"}
                aria-label={shapeCollapsed ? "Expand SHAPE panel" : "Collapse SHAPE panel"}
                aria-expanded={!shapeCollapsed}
              >
                {shapeCollapsed ? "▸" : "▾"}
              </button>
              <span className="shape-title">SHAPE</span>
              <span className="shape-hint">the evolution engine · the body it shapes</span>
              <button
                type="button"
                className={shapeHintsOn ? "shape-hints-toggle shape-hints-toggle-on" : "shape-hints-toggle"}
                onClick={toggleShapeHints}
                title={shapeHintsOn ? "Hide macro descriptions" : "Show a one-line description under each macro"}
                aria-label="Toggle macro hints"
                aria-pressed={shapeHintsOn}
              >
                ?
              </button>
            </div>
            {arriveStep === "shape" && arriveVisible && (
              <ArriveCallout
                step="shape"
                title="Shape the drone"
                body="Move AIR, BLOOM, or SUB"
              />
            )}
            <div className="shape-tier-label">MOTION</div>
            <div className="macro-primary-col">
              <Macro
                label="MORPH"
                value={state.presetMorph}
                onChange={(v) => { setPresetMorph(v); engine?.setPresetMorph(v); }}
                icon={<IconBloom />}
                title="MORPH (seconds) — time the drone takes to cross-fade when you load another preset. 0 = snap, 1 = ~20 s glacial fade."
                hint="preset-change crossfade"
                midiId="morph"
              />
              <Macro
                label="EVOLVE"
                value={state.evolve}
                onChange={(v) => { setPresetEvolve(v); engine?.setEvolve(v); }}
                icon={<IconDrift />}
                title="EVOLVE (minutes) — how much the drone drifts on its own while a preset is held. 0 = dead-still, 1 = continuous slow change."
                hint="autonomous slow drift"
                midiId="evolve"
              />
              <Macro
                label="TIME"
                value={state.time}
                onChange={setTime}
                icon={<IconTime />}
                title="Time — the rate of weather movement (LFO sweeping the filter). 0 = glacial, 1 = restless"
                hint="rate of weather motion"
                midiId="time"
              />
            </div>

            <div className="shape-tier-label">BODY</div>
            <div className="shape-morph-row">
              <Macro
                label="DRIFT"
                value={state.drift}
                onChange={setDrift}
                icon={<IconDrift />}
                title="Drift — how much the partials wander in pitch. 0 = crystalline, 1 = floating"
                hint="partials wander in pitch"
                midiId="drift"
              />
              <Macro
                label="AIR"
                value={state.air}
                onChange={setAir}
                icon={<IconAir />}
                title="Air — wet send into the atmosphere chain (reverb + space)"
                hint="reverb / space send"
                midiId="air"
              />
              <Macro
                label="SUB"
                value={state.sub}
                onChange={setSub}
                icon={<IconSub />}
                title="Sub — adds a triangle voice one octave below the root. Weight without brightness"
                hint="sub-octave triangle layer"
                midiId="sub"
              />
              <Macro
                label="BLOOM"
                value={state.bloom}
                onChange={setBloom}
                icon={<IconBloom />}
                displayValue={`${(0.3 + state.bloom * 9.7).toFixed(1)}s`}
                title="Bloom — attack time on the next HOLD. 0.3 s = immediate, 10 s = slow rise from silence"
                hint="voice attack on next HOLD"
                midiId="bloom"
              />
              <Macro
                label="GLIDE"
                value={state.glide}
                onChange={setGlide}
                icon={<IconGlide />}
                displayValue={`${(0.05 * Math.pow(160, state.glide)).toFixed(2)}s`}
                title="Glide — how slowly the drone retunes when you pick a new tonic. 50 ms = snap, 8 s = slowly flowing between notes"
                hint="retune time between notes"
                midiId="glide"
              />
            </div>

            {/* Tanpura string tuning — shown only when the tanpura
                voice is active. Classic preserves the legacy micro-
                detune unison; Sa Pa / Sa Ma / Sa Ni swap one string
                out for the classical raga tuning. Changing rebuilds
                voices (VoiceEngine.setTanpuraTuning). */}
            {state.voiceLayers.tanpura && (
              <div className="shape-tanpura-row">
                <span className="shape-tanpura-label">TANPURA</span>
                <DropdownSelect
                  value={tanpuraTuning}
                  options={TANPURA_TUNING_IDS.map((id) => ({
                    value: id,
                    label: TANPURA_TUNING_LABELS[id],
                  }))}
                  onChange={(v) => handleTanpuraTuning(v as TanpuraTuningId)}
                  className="shape-tanpura-select"
                  title="Tanpura string tuning — classical Sa Pa / Sa Ma / Sa Ni or unison"
                  ariaLabel="Tanpura tuning"
                />
              </div>
            )}

            {/* HISTORY — undo/redo + two A/B slots. Surface kept tiny
                so it doesn't compete with the primary motion controls.
                Keyboard: Cmd/Ctrl+Z undoes, Cmd/Ctrl+Shift+Z redoes.
                Slot buttons short-click = save, alt-click = recall;
                but UI also exposes explicit recall buttons for clarity. */}
            <div className="scene-actions-row scene-history-row">
              <button
                type="button"
                className="history-btn"
                onClick={undo}
                disabled={!historyUi.canUndo}
                title="Undo last change (Cmd/Ctrl+Z)"
                aria-label="Undo"
              >
                ↺
              </button>
              <button
                type="button"
                className="history-btn"
                onClick={redo}
                disabled={!historyUi.canRedo}
                title="Redo (Cmd/Ctrl+Shift+Z)"
                aria-label="Redo"
              >
                ↻
              </button>
              <span className="history-divider" aria-hidden="true" />
              <button
                type="button"
                className={historyUi.hasSlotA ? "history-btn history-btn-armed" : "history-btn"}
                title={
                  historyUi.hasSlotA
                    ? "Slot A: tap to recall · hold to overwrite with current scene"
                    : "Slot A empty: tap or hold to save current scene"
                }
                onPointerDown={() => startSlotHold(saveSlotA)}
                onPointerUp={cancelSlotHold}
                onPointerLeave={cancelSlotHold}
                onPointerCancel={cancelSlotHold}
                onClick={clickSlotA}
              >
                A
              </button>
              <button
                type="button"
                className={historyUi.hasSlotB ? "history-btn history-btn-armed" : "history-btn"}
                title={
                  historyUi.hasSlotB
                    ? "Slot B: tap to recall · hold to overwrite with current scene"
                    : "Slot B empty: tap or hold to save current scene"
                }
                onPointerDown={() => startSlotHold(saveSlotB)}
                onPointerUp={cancelSlotHold}
                onPointerLeave={cancelSlotHold}
                onPointerCancel={cancelSlotHold}
                onClick={clickSlotB}
              >
                B
              </button>
            </div>

            <div className="scene-actions-row">
              {/* PARTNER, JOURNEY, PRESET XFADE, GOOD DRONE, MUTATE
                  all moved to the always-visible preset-strip-identity
                  row. MUTATE intensity slider lives in Settings →
                  GENERAL. Capture controls (REC / LOOP / TIMED REC)
                  live in the header ⤓ EXPORT AUDIO dropdown. Only
                  REC MOTION remains inline. */}
              {motionRecEnabled && (
                <button
                  type="button"
                  className={isRecordingMotion ? "preset-mut-btn preset-mut-btn-rec" : "preset-mut-btn"}
                  onClick={() => onToggleMotionRecord?.()}
                  title={isRecordingMotion
                    ? "Stop REC MOTION — captured gestures travel with the next share URL and replay on load"
                    : "REC MOTION (60 s / 200 events) — capture your live slider moves into the next share URL so listeners hear your performance, not just the final state"}
                >
                  {isRecordingMotion ? "● MOTION" : "MOTION"}
                </button>
              )}
              {/* Master-output WAV / loop bounce / timed REC moved to
                  the ⤓ EXPORT AUDIO dropdown in the header. The
                  perform row keeps only the gesture controls
                  (MOTION). */}
            </div>

            {/* Piano keyboard + octave — moved into the preset-strip
                at the top of this view per layout pass (P2.3). */}
          </div>
        </div>
        )}

        {/* ── EDIT — collapsible drawer for mix-grade controls:
            INSTRUMENTS voice toggles · per-voice level sliders · FX BAR.
            Default closed so the first screen reads as an instrument,
            not a console. Performance surface above stays focused on
            HOLD / tonic / preset / macros / WeatherPad. */}
        <button
          data-tutor="edit-toggle"
          className="disclosure-toggle disclosure-toggle-wide"
          onClick={() => toggle("edit")}
          aria-expanded={disclosed.edit}
        >
          <span className="disclosure-arrow">{disclosed.edit ? "▾" : "▸"}</span>
          EDIT
        </button>
        {disclosed.edit && (
          <div className="timbre-fx-row">
            <div className="timbre-col">
              <div className="panel-label">INSTRUMENTS</div>
              <div className="timbre-grid timbre-grid-compact">
                {VOICES.map((v) => {
                  const active = state.voiceLayers[v.id];
                  const level = active ? Math.round(state.voiceLevels[v.id] * 100) : 0;
                  return (
                    <button
                      key={v.id}
                      onClick={() => toggleVoiceLayer(v.id)}
                      className={active ? "timbre-btn timbre-btn-active" : "timbre-btn"}
                      title={v.hint}
                    >
                      <span className="timbre-btn-icon">{v.icon}</span>
                      <span className="timbre-btn-label">{v.label}</span>
                      {active && <span className="timbre-btn-level">{level}</span>}
                    </button>
                  );
                })}
              </div>
              {/* Per-voice level sliders for currently-active voices,
                  rendered directly under the INSTRUMENTS grid. */}
              {VOICES.map((v) => state.voiceLayers[v.id] && (
                <Fragment key={v.id}>
                  <div className="layer-level-row" data-midi-id={v.id !== "noise" ? `voice.${v.id}` : undefined}>
                    <span className="layer-level-label">{v.label}</span>
                    <input
                      type="range" min={0} max={1} step={0.01}
                      value={state.voiceLevels[v.id]}
                      onChange={(e) => setVoiceLevel(v.id, parseFloat(e.target.value))}
                      className="macro-slider"
                      title={`${v.label} mix level`}
                    />
                    <span className="layer-level-value">{Math.round(state.voiceLevels[v.id] * 100)}</span>
                  </div>
                  {/* NOISE — second row for the COLOR shape param.
                      Only rendered for the noise voice; tonic-independent,
                      picks the bed's spectral tilt (white → sub-rumble). */}
                  {v.id === "noise" && (
                    <div className="layer-level-row layer-level-row-sub">
                      <span className="layer-level-label layer-level-label-sub">COLOR</span>
                      <input
                        type="range" min={0} max={1} step={0.01}
                        value={state.noiseColor}
                        onChange={(e) => setNoiseColor(parseFloat(e.target.value))}
                        className="macro-slider"
                        title="NOISE COLOR — 0 white, 0.3 pink, 0.6 brown, 1 sub-rumble"
                      />
                      <span className="layer-level-value">{Math.round(state.noiseColor * 100)}</span>
                    </div>
                  )}
                </Fragment>
              ))}
            </div>
            <div
              className="fx-col"
              data-tutor="fx-bar"
              onPointerDownCapture={() => {
                // First interaction with the FX strip surfaces the
                // effects tour as a pill. Subsequent clicks no-op via
                // the flow-done flag.
                if (!isFlowDone("effects")) requestOfferFlow("effects");
              }}
            >
              <FxBar
                engine={engine}
                states={displayEffects}
                onToggle={toggleEffect}
                order={effectOrder}
                onReorder={handleEffectReorder}
                suppressed={suppressedFx}
              />
            </div>
          </div>
        )}

        {/* ── ADVANCED — collapsible drawer holding tuning + LFO.
            Matches hardware-synth separation of performance from
            programming: identity + macros + voice toggles stay on
            top; EDIT carries mix; ADVANCED carries deep systems. */}
        <button
          data-tutor="advanced-toggle"
          className="disclosure-toggle disclosure-toggle-wide"
          onClick={() => {
            const willOpen = !disclosed.tuning;
            toggle("tuning");
            // First-time expansion offers the advanced tour as a
            // dismissible pill — never auto-starts the spotlight.
            if (willOpen && !isFlowDone("advanced")) {
              window.setTimeout(() => requestOfferFlow("advanced"), 120);
            }
          }}
        >
          <span className="disclosure-arrow">{disclosed.tuning ? "▾" : "▸"}</span>
          ADVANCED
        </button>
        {disclosed.tuning && (
        <div className="tuning-lfo-row">
          <div className="preset-mode-col">
            <div className="panel-label">MODE</div>
            <div className="mode-tabs" role="tablist" data-tutor="mode-tabs">
              <button
                role="tab"
                aria-selected={!modeIsMicro}
                className={!modeIsMicro ? "mode-tab mode-tab-active" : "mode-tab"}
                onClick={() => {
                  if (!modeIsMicro) return;
                  setTuning(null);
                  setRelation(null);
                  setFineTuneOffsets([]);
                }}
                title="Scale intervals stacked on the root"
              >
                SCALE
              </button>
              <button
                role="tab"
                data-tutor="microtonal-tab"
                aria-selected={modeIsMicro}
                className={modeIsMicro ? "mode-tab mode-tab-active" : "mode-tab"}
                onClick={() => {
                  if (modeIsMicro) return;
                  setTuning(TUNINGS[0].id);
                  setRelation(RELATIONS[1]?.id ?? RELATIONS[0].id);
                }}
                title="Alternative tuning system overriding the scale intervals"
              >
                MICROTONAL
              </button>
            </div>
            {!modeIsMicro && (
              <>
                <div className="panel-hint">Scale intervals stacked on the root</div>
                <div className="scale-grid scale-grid-compact" data-tutor="scale-grid">
                  {SCALES.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => setScale(s.id)}
                      className={s.id === state.scale ? "scale-btn scale-btn-active" : "scale-btn"}
                      title={`Modal set: ${s.label} — biases the harmonic voices that fit the tonic`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </>
            )}
            {modeIsMicro && (
              <>
                <div className="panel-hint">Tuning system + interval relation</div>
                <div className="intonation-row" data-tutor="tuning-picker">
                  <DropdownSelect
                    value={state.tuningId ?? ""}
                    options={TUNINGS.map((t) => ({ value: t.id, label: t.label }))}
                    onChange={(v) => setTuning(v === "" ? null : v as typeof state.tuningId)}
                    className="intonation-select"
                    title="Tuning system — pitch degrees in cents above the root"
                  />
                  <button
                    type="button"
                    className="intonation-edit-btn"
                    onClick={() => setScaleEditorOpen(true)}
                    title="Scale editor — author a custom tuning table"
                    aria-label="Open scale editor"
                  >
                    ✎
                  </button>
                  <DropdownSelect
                    value={state.relationId ?? ""}
                    options={RELATIONS.map((r) => ({ value: r.id, label: r.label }))}
                    onChange={(v) => setRelation(v === "" ? null : v as typeof state.relationId)}
                    className="intonation-select"
                    title="Interval relation — which degrees from the tuning to sound"
                  />
                </div>
                <PitchWheel
                  intervalsCents={intervalReadoutRows.map((r) => r.final)}
                  labels={intervalReadoutRows.map((r) => r.label)}
                />
                {intervalReadoutRows.length > 0 && (
                  <div className="intonation-readout">
                    <div className="panel-hint">INTERVALS · resolved cents</div>
                    <div className="intonation-chip-grid">
                      {intervalReadoutRows.map((row) => (
                        <div key={`${row.label}-${row.index}`} className="intonation-chip">
                          <span className="intonation-chip-label">{row.label}</span>
                          <span className="intonation-chip-value">{row.final.toFixed(2)}c</span>
                          {row.index > 0 && row.offset !== 0 && (
                            <span className="intonation-chip-offset">
                              {row.offset > 0 ? "+" : ""}{row.offset.toFixed(1)}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {fineDetuneRows.length > 0 && (
                  <div className="intonation-offsets">
                    {/* Closed by default — fine detune is an advanced
                     * microtonal control and tends to confuse users who
                     * stumble onto it. Click to reveal. */}
                    <button
                      className="disclosure-toggle"
                      onClick={() => toggle("detune")}
                      title="Fine-detune the resolved interval cents"
                    >
                      <span className="disclosure-arrow">{disclosed.detune ? "▾" : "▸"}</span>
                      DETUNE · active intervals in cents
                    </button>
                    {disclosed.detune && fineDetuneRows.map((row) => (
                      <label key={`${row.label}-${row.index}`} className="intonation-offset-row">
                        <span className="intonation-offset-label">
                          {row.label}
                          <span className="intonation-offset-value">
                            {row.offset >= 0 ? "+" : ""}{row.offset.toFixed(1)}c
                          </span>
                        </span>
                        <input
                          type="range"
                          min={-25}
                          max={25}
                          step={0.5}
                          value={row.offset}
                          onChange={(e) => {
                            const next = [...state.fineTuneOffsets];
                            next[row.index] = parseFloat(e.target.value);
                            setFineTuneOffsets(next);
                          }}
                          className="macro-slider"
                          title={`${row.label} fine detune around ${row.base.toFixed(2)} cents`}
                        />
                      </label>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          <div className="lfo-col" data-tutor="lfo">
            <div className="panel-label">LFO · VOLUME SWELL</div>
            <div className="panel-hint">Modulates master gain — the drone breathes in and out</div>
            <div className="lfo-shape-row">
              {(["sine", "triangle", "square", "sawtooth"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setLfoShape(s)}
                  className={s === state.lfoShape ? "lfo-shape-btn lfo-shape-btn-active" : "lfo-shape-btn"}
                  title={`LFO wave shape: ${s}`}
                >
                  <IconShape shape={s} />
                </button>
              ))}
            </div>
            <div className="macro-with-chip">
              <Macro
                label="RATE"
                value={(Math.log(state.lfoRate / 0.05) / Math.log(160))}
                onChange={(v) => {
                  if (lfoSyncActive) return; // locked to Link tempo
                  setLfoRate(0.05 * Math.pow(160, v));
                }}
                icon={<IconRate />}
                displayValue={
                  lfoSyncActive
                    ? `${lfoSyncMode} · ${state.lfoRate.toFixed(2)} Hz`
                    : `${state.lfoRate.toFixed(2)} Hz`
                }
                title={
                  lfoSyncActive
                    ? `Locked to Ableton Link: ${linkState.tempo.toFixed(1)} BPM × ${lfoSyncMode} note`
                    : "LFO rate — 0.05 Hz (very slow) to 8 Hz (fluttering). Click SYNC to lock to Ableton Link tempo."
                }
                midiId="lfoRate"
              />
              <button
                type="button"
                className={
                  "lfo-sync-chip" +
                  (lfoSyncMode !== "free" ? " lfo-sync-chip-armed" : "") +
                  (lfoSyncActive ? " lfo-sync-chip-locked" : "")
                }
                onClick={cycleLfoSyncMode}
                title={
                  lfoSyncMode === "free"
                    ? "FREE — manual rate. Click to cycle through Link-synced note values."
                    : linkState.connected
                      ? `Locked to Link tempo (${linkState.tempo.toFixed(1)} BPM). Click to cycle.`
                      : "Armed for Link sync. Waiting for Link Bridge — enable Ableton Link in Settings or run the companion app."
                }
              >
                {lfoSyncMode === "free" ? "FREE" : lfoSyncMode}
              </button>
              <button
                type="button"
                className={
                  "lfo-sync-chip" +
                  (lfoDivision > 0 ? " lfo-sync-chip-armed lfo-sync-chip-locked" : "")
                }
                onClick={cycleLfoDivision}
                title={
                  lfoDivision === 0
                    ? "PITCH-LOCK off. Click to lock LFO rate to rootHz/N — tuning and octave changes retune the LFO proportionally."
                    : `LFO rate locked to rootHz/${lfoDivision}. Click to cycle.`
                }
              >
                {lfoDivision === 0 ? "HZ" : `÷${lfoDivision}`}
              </button>
            </div>
            <Macro
              label="DEPTH"
              value={state.lfoAmount}
              onChange={setLfoAmount}
              icon={<IconDepth />}
              title="LFO depth — how much it modulates the voice gain. 0 = off, 1 = full breathing"
              midiId="lfoAmount"
            />
            <div data-tutor="entrain">
              <EntrainPanel
                entrain={state.entrain}
                onChange={setEntrain}
                breathingHz={state.lfoRate}
              />
            </div>
          </div>
        </div>
        )}
      </div>
    </div>
    {scaleEditorOpen && (
      <Suspense fallback={null}>
        <ScaleEditorModal
          currentTuningId={state.tuningId ?? null}
          onApply={(table) => setTuning(table.id)}
          onClose={() => setScaleEditorOpen(false)}
        />
      </Suspense>
    )}
    </>
  );
});

/** ARRIVE choreography callout — small ember-bordered card rendered
 *  inside the surface a step is teaching. role="status" + aria-live
 *  so screen readers announce the step transition; not a focus trap. */
function ArriveCallout({
  step,
  title,
  body,
}: {
  step: "shape" | "weather" | "tonic";
  title: string;
  body: string;
}) {
  return (
    <div
      className="arrive-callout"
      role="status"
      aria-live="polite"
      data-arrive-step={step}
    >
      <span className="arrive-callout-title">{title}</span>
      <span className="arrive-callout-body">{body}</span>
    </div>
  );
}

/** Horizontal macro slider with icon + label + live value readout. */
function Macro({
  label,
  value,
  onChange,
  icon,
  title,
  displayValue,
  hint,
  vertical,
  midiId,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  icon?: React.ReactNode;
  title: string;
  /** Optional pre-formatted value string; falls back to 0..100 %. */
  displayValue?: string;
  /** Short one-liner rendered under the label when the parent
   *  panel has `.shape-hints-on` — teaches what the macro does
   *  without waiting for the tooltip. */
  hint?: string;
  /** Render as a vertical fader column instead of a horizontal row.
   *  Used by SHAPE macros where the "studio console" metaphor
   *  reinforces the two-tier driver/body hierarchy. On narrow
   *  viewports CSS collapses vertical mode back to a row. */
  vertical?: boolean;
  /** MIDI target id for global learn mode. */
  midiId?: string;
}) {
  if (vertical) {
    return (
      <div className="macro-col" title={title} data-midi-id={midiId}>
        <span className="macro-col-label">{label}</span>
        {hint && <span className="macro-col-hint">{hint}</span>}
        <div className="macro-col-fader">
          <input
            type="range"
            min={0}
            max={1}
            step={0.001}
            value={value}
            onChange={(e) => onChange(parseFloat(e.target.value))}
            className="macro-col-slider"
            aria-label={label}
          />
        </div>
        <span className="macro-col-value">
          {displayValue ?? Math.round(value * 100)}
        </span>
      </div>
    );
  }
  return (
    <div className="macro-row-wrap" title={title}>
      <div className="macro-row">
        {icon && <span className="macro-icon">{icon}</span>}
        <span className="macro-label-col">
          <span className="macro-label">{label}</span>
        </span>
        <TouchSlider
          min={0}
          max={1}
          step={0.001}
          value={value}
          onChange={onChange}
          className="macro-slider"
          aria-label={label}
          midiId={midiId}
          style={{ ["--fill" as string]: `${value * 100}%` } as React.CSSProperties}
        />
        <span className="macro-value">
          {displayValue ?? Math.round(value * 100)}
        </span>
      </div>
      {hint && <span className="macro-hint">{hint}</span>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// SVG icons — inline, monochrome, inherit currentColor. Kept tiny so
// the whole icon set weighs nothing and reads as a vocabulary.
// ─────────────────────────────────────────────────────────────────────

const ICON_SIZE = 16;
const iconProps = {
  width: ICON_SIZE,
  height: ICON_SIZE,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.4,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

/** DRIFT — a gentle wandering curve (sine with phase offset). */
function IconDrift() {
  return (
    <svg {...iconProps}>
      <path d="M1 8 Q 3 3, 5 8 T 9 8 T 13 8 T 15 8" />
      <circle cx="8" cy="8" r="0.8" fill="currentColor" />
    </svg>
  );
}

/** AIR — cloud / wind puff. */
function IconAir() {
  return (
    <svg {...iconProps}>
      <path d="M2 10 Q 2 7, 5 7 Q 5 4, 9 5 Q 13 4, 13 8 Q 15 8, 14 11 L 3 11 Q 1 11, 2 10Z" />
    </svg>
  );
}

/** TIME — slow spiral / circular motion. */
function IconTime() {
  return (
    <svg {...iconProps}>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4 V 8 L 11 10" />
    </svg>
  );
}

/** RATE — fast oscillation (dense sine). */
function IconRate() {
  return (
    <svg {...iconProps}>
      <path d="M1 8 Q 2 4, 3 8 T 5 8 T 7 8 T 9 8 T 11 8 T 13 8 T 15 8" />
    </svg>
  );
}

/** DEPTH — vertical modulation arrows. */
function IconDepth() {
  return (
    <svg {...iconProps}>
      <path d="M8 2 V 14" />
      <path d="M5 5 L 8 2 L 11 5" />
      <path d="M5 11 L 8 14 L 11 11" />
    </svg>
  );
}

/** SUB — a thick horizontal bar plus downward bracket (low end). */
function IconSub() {
  return (
    <svg {...iconProps}>
      <path d="M2 7 H 14" strokeWidth="2.2" />
      <path d="M3 11 H 13" />
      <path d="M5 13 L 8 15 L 11 13" />
    </svg>
  );
}

/** BLOOM — slow rising curve. */
function IconBloom() {
  return (
    <svg {...iconProps}>
      <path d="M1 14 Q 6 14, 8 9 T 15 2" />
      <circle cx="15" cy="2" r="0.9" fill="currentColor" />
    </svg>
  );
}

/** GLIDE — portamento curve connecting two notes. */
function IconGlide() {
  return (
    <svg {...iconProps}>
      <circle cx="2" cy="13" r="1.2" fill="currentColor" />
      <path d="M2 13 Q 7 13, 9 8 T 14 3" />
      <circle cx="14" cy="3" r="1.2" fill="currentColor" />
    </svg>
  );
}


/** LFO shape icons — one per wave. */
function IconShape({ shape }: { shape: OscillatorType }) {
  switch (shape) {
    case "sine":
      return (
        <svg {...iconProps}>
          <path d="M1 8 Q 3 2, 5 8 T 9 8 T 13 8 T 15 8" />
        </svg>
      );
    case "triangle":
      return (
        <svg {...iconProps}>
          <path d="M1 8 L 4 2 L 8 14 L 12 2 L 15 8" />
        </svg>
      );
    case "square":
      return (
        <svg {...iconProps}>
          <path d="M1 12 L 1 4 L 8 4 L 8 12 L 15 12 L 15 4" />
        </svg>
      );
    case "sawtooth":
      return (
        <svg {...iconProps}>
          <path d="M1 12 L 6 2 L 6 12 L 11 2 L 11 12 L 15 6" />
        </svg>
      );
    default:
      return null;
  }
}

// ─────────────────────────────────────────────────────────────────────
// PitchWheel — circular visualization of the active microtonal set.
// Each resolved interval is drawn as a dot placed around the octave
// at `angle = cents / 1200 * 2π − π/2` so 0¢ (root) sits at 12 o'clock
// and the circle advances clockwise. Twelve faint 100¢ guide ticks
// give a familiar 12-TET reference so the eye can read how far each
// microtonal degree departs from equal temperament.
// ─────────────────────────────────────────────────────────────────────
function PitchWheel({
  intervalsCents,
  labels,
}: {
  intervalsCents: number[];
  labels: string[];
}) {
  const size = 140;
  const cx = size / 2;
  const cy = size / 2;
  const radius = 52;
  const toXY = (cents: number, r: number) => {
    const a = (cents / 1200) * Math.PI * 2 - Math.PI / 2;
    return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
  };
  // 100-cent equal-temperament guides
  const guides = Array.from({ length: 12 }, (_, i) => i * 100);
  return (
    <div className="pitch-wheel" aria-hidden>
      <svg
        width="100%"
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        preserveAspectRatio="xMidYMid meet"
      >
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeOpacity={0.22}
          strokeWidth={1}
        />
        {guides.map((g) => {
          const p1 = toXY(g, radius - 3);
          const p2 = toXY(g, radius + 3);
          return (
            <line
              key={g}
              x1={p1.x}
              y1={p1.y}
              x2={p2.x}
              y2={p2.y}
              stroke="currentColor"
              strokeOpacity={0.22}
              strokeWidth={1}
            />
          );
        })}
        {intervalsCents.map((c, i) => {
          // Normalize to 0..1200 so octave-shifted intervals still
          // land on the wheel.
          const norm = ((c % 1200) + 1200) % 1200;
          const p = toXY(norm, radius);
          const isRoot = i === 0;
          return (
            <g key={`${labels[i] ?? i}-${i}`}>
              <line
                x1={cx}
                y1={cy}
                x2={p.x}
                y2={p.y}
                stroke="var(--preview)"
                strokeOpacity={isRoot ? 0.55 : 0.35}
                strokeWidth={1}
              />
              <circle
                cx={p.x}
                cy={p.y}
                r={isRoot ? 4.5 : 3.5}
                fill="var(--preview)"
                stroke="var(--preview)"
                strokeWidth={isRoot ? 1.5 : 0}
                fillOpacity={isRoot ? 1 : 0.85}
              >
                <title>{`${labels[i] ?? `INT ${i + 1}`} · ${c.toFixed(2)}¢`}</title>
              </circle>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
