import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { AudioEngine } from "../engine/AudioEngine";
import type { VoiceType } from "../engine/VoiceBuilder";
import { PRESETS, type PresetGroup } from "../engine/presets";
import { JOURNEYS, JOURNEY_IDS, type JourneyId } from "../journey";
import { PARTNER_RELATIONS, type PartnerRelation } from "../partner";
import { VuMeter } from "./VuMeter";

const PRESET_GROUPS: PresetGroup[] = [
  "Sacred / Ritual", "Minimal / Just", "Organ / Chamber",
  "Ambient / Cinematic", "Noise / Industrial",
];
const SHORT_GROUP_LABELS: Partial<Record<PresetGroup, string>> = {
  "Sacred / Ritual": "SACRED",
  "Minimal / Just": "MINIMAL",
  "Organ / Chamber": "ORGAN",
  "Ambient / Cinematic": "AMBIENT",
  "Noise / Industrial": "NOISE",
};

import type { DroneSessionSnapshot } from "../session";
import type { PitchClass } from "../types";
import { FxBar } from "./FxBar";
import { PITCH_CLASSES, SCALES } from "../scene/droneSceneModel";
import { relationLabels, resolveTuning, TUNINGS, RELATIONS } from "../microtuning";
import { useDroneScene, type DroneLivePatch } from "../scene/useDroneScene";

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
    hint: "2-op FM synthesis — modulator frequency-modulates carrier, producing controllable inharmonic sidebands. Bell-like metal tones distinct from the modal METAL voice. Coil, DX7-era synth drones, Tangerine Dream.",
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
    hint: "Distorted amplifier voice — additive harmonic source pushed through hard tanh saturation and a cabinet low-pass. The sustained-guitar-feedback character of drone metal: Sunn O))), Earth, Boris.",
    icon: (
      // Amp cabinet with a speaker grille
      <svg {...V_SVG}>
        <rect x="3" y="3" width="12" height="13" rx="1" />
        <circle cx="9" cy="9.5" r="3" />
        <circle cx="9" cy="9.5" r="1" fill="currentColor" />
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
  kbdActive: boolean;
  onToggleKbd: () => void;
}

export interface DroneViewHandle {
  getSnapshot(): DroneSessionSnapshot;
  applySnapshot(snapshot: DroneSessionSnapshot): void;
  applyLivePatch(patch: DroneLivePatch): void;
  togglePlay(): void;
  setRoot(root: PitchClass): void;
  setOctave(octave: number): void;
  applyPresetById(presetId: string): void;
  startImmediate(root: PitchClass, octave: number, presetId?: string): void;
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
  { engine, onTransportChange, onTonicChange, onPresetChange, onMutateScene, onTuneOffsetChange, onParamRecord, isRecordingMotion, onToggleMotionRecord, motionRecEnabled, kbdActive, onToggleKbd }: DroneViewProps,
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
    setPluckRate,
    toggleVoiceLayer,
    setVoiceLevel,
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
    togglePlay,
    handlePreset,
    getSnapshot,
    applySnapshot,
    applyLivePatch,
    startImmediate,
    setJourney,
    setPartner,
  } = useDroneScene({
    engine,
    onTransportChange,
    onTonicChange,
    onPresetChange,
    onParamRecord,
  });

  // Progressive disclosure — collapsible sections. Default: collapsed.
  // Persisted to localStorage so the user's layout survives reloads.
  const DISCLOSURE_KEY = "mdrone-disclosure";
  type Section = "timbre" | "controls" | "effects" | "climate" | "detune";
  const defaultDisclosure: Record<Section, boolean> = {
    timbre: true, controls: false, effects: false, climate: false, detune: false,
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
  const [mutateIntensity, setMutateIntensity] = useState(0.25);

  // Auto-open the DETUNE disclosure once when fine-tune offsets
  // become non-zero (e.g. when loading a preset or share URL with
  // authored detune). Only opens — never auto-closes — so a user
  // who manually collapses it stays collapsed until the next time
  // offsets transition from all-zero to non-zero.
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
    setDisclosed((prev) => {
      const next = { ...prev, detune: true };
      try { localStorage.setItem(DISCLOSURE_KEY, JSON.stringify(next)); } catch { /* noop */ }
      return next;
    });
  }, [state.fineTuneOffsets, disclosed.detune]);

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
  const presetTab =
    tabOverride && tabOverride.presetId === state.activePresetId
      ? tabOverride.group
      : presetGroupForActive;
  const visiblePresets = PRESETS.filter((p) => p.group === presetTab);
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

  // Spacebar toggles HOLD — ignored while typing into an input/textarea
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      e.preventDefault();
      togglePlay();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay]);

  // XY surface interaction — pointer capture lives on the container
  // itself so drags that leave the bounds still update. `draggingRef`
  // gates pointermove events instead of relying on `e.buttons`, which
  // is unreliable on touch/pen.
  const xyRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const updateXy = useCallback((clientX: number, clientY: number) => {
    const el = xyRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, 1 - (clientY - rect.top) / rect.height));
    setClimate(x, y);
  }, [setClimate]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    draggingRef.current = true;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ok */ }
    updateXy(e.clientX, e.clientY);
  }, [updateXy]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    updateXy(e.clientX, e.clientY);
  }, [updateXy]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    draggingRef.current = false;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* ok */ }
  }, []);

  useImperativeHandle(ref, () => ({
    getSnapshot,
    applySnapshot,
    applyLivePatch,
    togglePlay,
    setRoot,
    setOctave,
    applyPresetById(presetId) {
      handlePreset(presetId);
    },
    startImmediate,
  }), [
    applySnapshot,
    applyLivePatch,
    getSnapshot,
    setOctave,
    setRoot,
    startImmediate,
    togglePlay,
    handlePreset,
  ]);

  return (
    <div className="drone-layout">
      <div className="preset-vu-wide">
        <VuMeter analyser={engine?.getAnalyser() ?? null} width={600} height={16} />
      </div>
      <div className="panel preset-panel preset-panel-wide">
        <div className="preset-panel-header">
          <div className="panel-label">PRESETS · tap to load</div>
          <div className="preset-mut-row">
            <select
              className="preset-journey-select"
              value={state.journey ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                setJourney(v === "" ? null : (v as JourneyId));
              }}
              title="JOURNEY — authored ritual phases (arrival → bloom → suspension → dissolve). Replaces evolve drift while active."
              aria-label="Journey"
            >
              <option value="">JOURNEY: off</option>
              {JOURNEY_IDS.map((id) => (
                <option key={id} value={id}>JOURNEY: {JOURNEYS[id].label}</option>
              ))}
            </select>
            <select
              className="preset-journey-select"
              value={state.partner.enabled ? state.partner.relation : ""}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "") {
                  setPartner({ ...state.partner, enabled: false });
                } else {
                  setPartner({ enabled: true, relation: v as PartnerRelation });
                }
              }}
              title="PARTNER — sympathetic second drone layer at a fixed musical relation."
              aria-label="Sympathetic partner"
            >
              <option value="">PARTNER: off</option>
              {PARTNER_RELATIONS.map((r) => (
                <option key={r} value={r}>PARTNER: {r}</option>
              ))}
            </select>
            {motionRecEnabled && (
              <button
                type="button"
                className={isRecordingMotion ? "preset-mut-btn preset-mut-btn-rec" : "preset-mut-btn"}
                onClick={() => onToggleMotionRecord?.()}
                title={isRecordingMotion
                  ? "Stop motion recording — captured gestures travel with the next share URL"
                  : "Record meaningful gestures (60 s / 200 events max) into the next share URL"}
              >
                {isRecordingMotion ? "● REC MOTION" : "REC MOTION"}
              </button>
            )}
            <button
              type="button"
              className="preset-mut-btn"
              onClick={() => onMutateScene?.(mutateIntensity)}
              title={`MUTATE — perturb the current scene by ${Math.round(mutateIntensity * 100)}%`}
            >
              MUTATE
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={mutateIntensity}
              onChange={(e) => setMutateIntensity(parseFloat(e.target.value))}
              className="preset-mut-intensity"
              title={`Mutation intensity: ${Math.round(mutateIntensity * 100)}%`}
              aria-label="Mutation intensity"
            />
            <span className="preset-mut-value" aria-hidden="true">
              {Math.round(mutateIntensity * 100)}%
            </span>
          </div>
        </div>
        {/* Genre tabs — one row of small group buttons */}
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
        {/* Active group's presets */}
        <div className="preset-grid">
          {visiblePresets.map((p) => (
            <button
              key={p.id}
              onClick={() => { handlePreset(p.id); setTabOverride({ group: p.group, presetId: p.id }); }}
              className={state.activePresetId === p.id ? "preset-btn preset-btn-active" : "preset-btn"}
              title={`${p.name} — ${p.attribution}\n\n${p.hint}`}
            >
              <span
                className="preset-btn-icon"
                style={{ ["--icon" as string]: `url(/preset-icons/${p.id}.svg)` } as React.CSSProperties}
                aria-hidden="true"
              />
              <span className="preset-btn-meta">
                <span className="preset-btn-name">{p.name}</span>
                <span className="preset-btn-attr">{p.attribution}</span>
              </span>
            </button>
          ))}
        </div>
        {/* Row 2 — MODE · TONIC · TIMBRE */}
        <div className="preset-row-2">
          <div className="preset-mode-col">
            <div className="panel-label">MODE</div>
            {/* Mutually exclusive tabs. The active tab is derived from
             * state: if both tuningId and relationId are set, we're in
             * microtonal mode; otherwise scale mode. Clicking a tab
             * clears / seeds the opposing state to keep the two sets
             * truly exclusive — a scene can never be both at once. */}
            <div className="mode-tabs" role="tablist">
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
                aria-selected={modeIsMicro}
                className={modeIsMicro ? "mode-tab mode-tab-active" : "mode-tab"}
                onClick={() => {
                  if (modeIsMicro) return;
                  // Seed with a reasonable default so the user
                  // immediately hears a microtonal result instead of
                  // an empty selector pair.
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
                <div className="scale-grid scale-grid-compact">
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
                <div className="intonation-row">
                  <select
                    value={state.tuningId ?? ""}
                    onChange={(e) => setTuning(e.target.value === "" ? null : e.target.value as typeof state.tuningId)}
                    className="intonation-select"
                    title="Tuning system — pitch degrees in cents above the root"
                  >
                    {TUNINGS.map((t) => (
                      <option key={t.id} value={t.id}>{t.label}</option>
                    ))}
                  </select>
                  <select
                    value={state.relationId ?? ""}
                    onChange={(e) => setRelation(e.target.value === "" ? null : e.target.value as typeof state.relationId)}
                    className="intonation-select"
                    title="Interval relation — which degrees from the tuning to sound"
                  >
                    {RELATIONS.map((r) => (
                      <option key={r.id} value={r.id}>{r.label}</option>
                    ))}
                  </select>
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

          <div className="preset-tonic-col">
            <div className="panel-label">TONIC</div>
            <div className="panel-hint">Root pitch of the drone</div>
            <div className="tonic-wheel tonic-wheel-compact">
              {PITCH_CLASSES.map((pc) => (
                <button
                  key={pc}
                  onClick={() => setRoot(pc)}
                  className={pc === state.root ? "tonic-cell tonic-cell-active" : "tonic-cell"}
                  title={`Set root to ${pc}${state.octave}`}
                >
                  {pc}
                </button>
              ))}
            </div>
            {/* Mini piano keyboard + QWERTY toggle below the tonic grid */}
            <div className="tonic-piano-row">
              <div className="tonic-keys">
                {PITCH_CLASSES.map((pc) => {
                  const isSharp = pc.includes("#");
                  const isActive = state.root === pc;
                  return (
                    <button
                      key={pc}
                      className={
                        `tonic-key${isSharp ? " tonic-key-black" : ""}${isActive ? " tonic-key-active" : ""}`
                      }
                      onClick={() => setRoot(pc)}
                      title={pc}
                      aria-label={pc}
                    >
                      {isActive ? pc.replace("#", "♯") : ""}
                    </button>
                  );
                })}
              </div>
              <button
                className={kbdActive ? "header-kbd-btn header-kbd-btn-active" : "header-kbd-btn"}
                onClick={onToggleKbd}
                title={kbdActive
                  ? "QWERTY keyboard active — A=C W=C# S=D E=D# D=E F=F T=F# G=G Y=G# H=A U=A# J=B · Z/X = octave down/up"
                  : "Enable QWERTY keyboard as tonic controller"}
              >
                ⌨
              </button>
              <select
                value={state.octave}
                onChange={(e) => setOctave(parseInt(e.target.value, 10))}
                className="header-select header-select-octave"
                title={`Octave: ${state.octave}`}
              >
                {[1, 2, 3, 4, 5, 6].map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="preset-timbre-col">
            <button className="disclosure-toggle" onClick={() => toggle("timbre")}>
              <span className="disclosure-arrow">{disclosed.timbre ? "▾" : "▸"}</span>
              TIMBRE
            </button>
            {disclosed.timbre && (<>
            <div className="panel-hint">Voice models — combine for texture</div>
            <div className="timbre-grid">
              {VOICES.map((v) => (
                <button
                  key={v.id}
                  onClick={() => toggleVoiceLayer(v.id)}
                  className={state.voiceLayers[v.id] ? "timbre-btn timbre-btn-active" : "timbre-btn"}
                  title={v.hint}
                >
                  <span className="timbre-btn-icon">{v.icon}</span>
                  <span className="timbre-btn-label">{v.label}</span>
                </button>
              ))}
            </div>
            <div className="layer-levels">
              {VOICES.map((v) => state.voiceLayers[v.id] && (
                <div key={v.id} className="layer-level-row">
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
              ))}
              {state.voiceLayers.tanpura && (
                <div className="layer-level-row">
                  <span className="layer-level-label">PLUCK</span>
                  <input
                    type="range"
                    min={0.2}
                    max={4}
                    step={0.05}
                    value={state.pluckRate}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      setPluckRate(v);
                      engine?.setTanpuraPluckRate(v);
                    }}
                    className="macro-slider"
                    title="Tanpura re-pluck rate."
                  />
                  <span className="layer-level-value">{state.pluckRate.toFixed(1)}×</span>
                </div>
              )}
            </div>
            </>)}
          </div>
        </div>

        {/* Row 3 — MORPH/EVOLVE · MACROS · LFO — collapsible */}
        <button className="disclosure-toggle disclosure-toggle-wide" onClick={() => toggle("controls")}>
          <span className="disclosure-arrow">{disclosed.controls ? "▾" : "▸"}</span>
          CONTROLS · morph · macros · lfo
        </button>
        {disclosed.controls && (
        <div className="preset-row-3">
          <div className="preset-controls-col">
            <div className="panel-hint">Transition speed + self-evolution</div>
            <div className="preset-morph-row">
              <span className="preset-morph-label">MORPH</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={state.presetMorph}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  setPresetMorph(v);
                  engine?.setPresetMorph(v);
                }}
                className="preset-morph-slider"
                title="How slowly the drone morphs between presets. 0 = snap, 1 = glacial (~6 s macros, 4× bloom crossfade)."
              />
              <span className="preset-morph-value">{Math.round(state.presetMorph * 100)}%</span>
            </div>
            <div className="preset-morph-row">
              <span className="preset-morph-label">EVOLVE</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={state.evolve}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  setPresetEvolve(v);
                  engine?.setEvolve(v);
                }}
                className="preset-morph-slider"
                title="How much the drone evolves itself during play. 0 = static · 0.4 = gentle atmosphere drift · 0.7 = + occasional tonic walks (P4/P5) · 1 = active drift + note walks."
              />
              <span className="preset-morph-value">{Math.round(state.evolve * 100)}%</span>
            </div>
          </div>

          <div className="preset-macros-col">
            <div className="panel-label">MACROS</div>
            <div className="panel-hint">Global tone shaping — drift, reverb, sub, attack, glide</div>
            <Macro
              label="DRIFT"
              value={state.drift}
              onChange={setDrift}
              icon={<IconDrift />}
              title="Drift — how much the partials wander in pitch. 0 = crystalline, 1 = floating"
            />
            <Macro
              label="AIR"
              value={state.air}
              onChange={setAir}
              icon={<IconAir />}
              title="Air — wet send into the atmosphere chain (reverb + space)"
            />
            <Macro
              label="TIME"
              value={state.time}
              onChange={setTime}
              icon={<IconTime />}
              title="Time — the rate of weather movement (LFO sweeping the filter). 0 = glacial, 1 = restless"
            />
            <Macro
              label="SUB"
              value={state.sub}
              onChange={setSub}
              icon={<IconSub />}
              title="Sub — adds a triangle voice one octave below the root. Weight without brightness"
            />
            <Macro
              label="BLOOM"
              value={state.bloom}
              onChange={setBloom}
              icon={<IconBloom />}
              displayValue={`${(0.3 + state.bloom * 9.7).toFixed(1)}s`}
              title="Bloom — attack time on the next HOLD. 0.3 s = immediate, 10 s = slow rise from silence"
            />
            <Macro
              label="GLIDE"
              value={state.glide}
              onChange={setGlide}
              icon={<IconGlide />}
              displayValue={`${(0.05 * Math.pow(160, state.glide)).toFixed(2)}s`}
              title="Glide — how slowly the drone retunes when you pick a new tonic. 50 ms = snap, 8 s = slowly flowing between notes"
            />
          </div>

          <div className="preset-breathe-col">
            <div className="panel-label">LFO · BREATHING</div>
            <div className="panel-hint">Slow volume swell — shape, speed, depth</div>
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
            <Macro
              label="RATE"
              value={(Math.log(state.lfoRate / 0.05) / Math.log(160))}
              onChange={(v) => setLfoRate(0.05 * Math.pow(160, v))}
              icon={<IconRate />}
              displayValue={`${state.lfoRate.toFixed(2)} Hz`}
              title="LFO rate — speed of the breathing/tremolo. 0.05 Hz (very slow) to 8 Hz (fluttering)"
            />
            <Macro
              label="DEPTH"
              value={state.lfoAmount}
              onChange={setLfoAmount}
              icon={<IconDepth />}
              title="LFO depth — how much it modulates the voice gain. 0 = off, 1 = full breathing"
            />
          </div>
        </div>
        )}
      </div>

      {/* ── Effects + Climate — collapsible ───── */}
      <div className="drone-right">
        <button className="disclosure-toggle disclosure-toggle-wide" onClick={() => toggle("effects")}>
          <span className="disclosure-arrow">{disclosed.effects ? "▾" : "▸"}</span>
          EFFECTS · serial chain
        </button>
        {disclosed.effects && (
          <FxBar engine={engine} states={state.effects} onToggle={toggleEffect} />
        )}

        <button className="disclosure-toggle disclosure-toggle-wide" onClick={() => toggle("climate")}>
          <span className="disclosure-arrow">{disclosed.climate ? "▾" : "▸"}</span>
          CLIMATE · XY surface
        </button>
        {disclosed.climate && (
        <div className="panel climate-panel">
          <div className="panel-hint">X: dark ↔ bright · Y: still ↔ motion</div>
          <div
            ref={xyRef}
            className="climate-xy"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onPointerLeave={handlePointerUp}
            title="Climate surface — X: DARK ↔ BRIGHT   Y: STILL ↔ MOTION"
          >
            <div
              className="climate-cursor"
              style={{ left: `${state.climateX * 100}%`, bottom: `${state.climateY * 100}%` }}
            />
            <span className="climate-axis climate-axis-x-left">DARK</span>
            <span className="climate-axis climate-axis-x-right">BRIGHT</span>
            <span className="climate-axis climate-axis-y-top">MOTION</span>
            <span className="climate-axis climate-axis-y-bot">STILL</span>
          </div>
        </div>
        )}
      </div>
    </div>
  );
});

/** Horizontal macro slider with icon + label + live value readout. */
function Macro({
  label,
  value,
  onChange,
  icon,
  title,
  displayValue,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  icon?: React.ReactNode;
  title: string;
  /** Optional pre-formatted value string; falls back to 0..100 %. */
  displayValue?: string;
}) {
  return (
    <div className="macro-row" title={title}>
      {icon && <span className="macro-icon">{icon}</span>}
      <span className="macro-label">{label}</span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.001}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="macro-slider"
      />
      <span className="macro-value">
        {displayValue ?? Math.round(value * 100)}
      </span>
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
