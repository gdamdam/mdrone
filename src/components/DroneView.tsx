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
import { useDroneScene } from "../scene/useDroneScene";

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
  kbdActive: boolean;
  onToggleKbd: () => void;
}

export interface DroneViewHandle {
  getSnapshot(): DroneSessionSnapshot;
  applySnapshot(snapshot: DroneSessionSnapshot): void;
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
  { engine, onTransportChange, onTonicChange, onPresetChange, kbdActive, onToggleKbd }: DroneViewProps,
  ref,
) {
  const {
    state,
    setRoot,
    setOctave,
    setScale,
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
    startImmediate,
  } = useDroneScene({
    engine,
    onTransportChange,
    onTonicChange,
    onPresetChange,
  });

  // Active preset-group tab — defaults to the group of the active preset,
  // or the first group if no preset is selected.
  const activePresetGroup = state.activePresetId
    ? PRESETS.find((p) => p.id === state.activePresetId)?.group ?? PRESET_GROUPS[0]
    : PRESET_GROUPS[0];
  const [presetTab, setPresetTab] = useState<PresetGroup>(activePresetGroup);
  // Sync tab when the active preset changes externally (RND, continue
  // last scene, shared link) so the tab always shows the active preset.
  useEffect(() => {
    if (!state.activePresetId) return;
    const preset = PRESETS.find((p) => p.id === state.activePresetId);
    if (preset && preset.group !== presetTab) {
      setPresetTab(preset.group);
    }
  }, [state.activePresetId]); // eslint-disable-line react-hooks/exhaustive-deps
  const visiblePresets = PRESETS.filter((p) => p.group === presetTab);

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
    togglePlay,
    setRoot,
    setOctave,
    applyPresetById(presetId) {
      handlePreset(presetId);
    },
    startImmediate,
  }), [
    applySnapshot,
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
        <div className="panel-label">PRESETS · tap to load</div>
        {/* Genre tabs — one row of small group buttons */}
        <div className="preset-tabs" role="tablist">
          {PRESET_GROUPS.map((g) => (
            <button
              key={g}
              role="tab"
              aria-selected={presetTab === g}
              className={presetTab === g ? "preset-tab preset-tab-active" : "preset-tab"}
              onClick={() => setPresetTab(g)}
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
              onClick={() => { handlePreset(p.id); setPresetTab(p.group); }}
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
            <div className="panel-label">TIMBRE · tap to layer</div>
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
            {/* Per-layer level sliders — only shown for active layers. */}
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
              {/* PLUCK — tanpura-only, shown when tanpura layer is active */}
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
                    title="Tanpura re-pluck rate. 0.2× = ~15 s between strings (very slow), 1× = traditional ~3 s cycle, 4× = rapid plucking."
                  />
                  <span className="layer-level-value">{state.pluckRate.toFixed(1)}×</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Row 3 — MORPH/EVOLVE/PLUCK · MACROS · LFO */}
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
      </div>

      {/* ── Right column: large climate XY surface + effects ───── */}
      <div className="drone-right">
        {/* Effects chain — mpump-kaos-style toggle row above the XY pad */}
        <FxBar engine={engine} states={state.effects} onToggle={toggleEffect} />

        <div className="panel climate-panel">
          <div className="panel-label">CLIMATE</div>
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
