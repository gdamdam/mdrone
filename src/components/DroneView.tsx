import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AudioEngine } from "../engine/AudioEngine";
import type { VoiceType } from "../engine/VoiceBuilder";
import type { PitchClass, ScaleId } from "../types";
import { FxBar } from "./FxBar";

/** 12 pitch classes arranged around the tonic wheel. */
const PITCH_CLASSES: PitchClass[] = [
  "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
];

/** Frequency for a pitch class + octave — A4 = 440 Hz reference. */
function pitchToFreq(pc: PitchClass, octave: number): number {
  const idx = PITCH_CLASSES.indexOf(pc);
  const semitonesFromA4 = idx - 9 + (octave - 4) * 12;
  return 440 * Math.pow(2, semitonesFromA4 / 12);
}

/**
 * Curated mode list — each scale exposes a small set of intervals (in
 * CENTS from the root) that the drone stacks on top of the root voice.
 * Equal-tempered modes use 100 × semitones. Just 5-limit uses the
 * exact integer ratios (1/1, 5/4, 3/2) expressed in cents so you hear
 * the beatless purity instead of equal-tempered thirds/fifths.
 */
interface Scale {
  id: ScaleId;
  label: string;
  intervalsCents: number[]; // 0 (root) is always included
}

const SCALES: Scale[] = [
  { id: "major",      label: "Major",      intervalsCents: [0, 400, 700] },          // 1 · M3 · P5
  { id: "minor",      label: "Minor",      intervalsCents: [0, 300, 700] },          // 1 · m3 · P5
  { id: "dorian",     label: "Dorian",     intervalsCents: [0, 300, 700, 1000] },    // 1 · m3 · P5 · m7
  { id: "phrygian",   label: "Phrygian",   intervalsCents: [0, 100, 700] },          // 1 · m2 · P5 (tense)
  { id: "just5",      label: "Just 5-limit", intervalsCents: [0, 386.31, 701.96] },  // 1/1 · 5/4 · 3/2
  { id: "pentatonic", label: "Pentatonic", intervalsCents: [0, 200, 700] },          // 1 · M2 · P5
];

function scaleById(id: ScaleId): Scale {
  return SCALES.find((s) => s.id === id) ?? SCALES[0];
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
    hint: "Inharmonic partial stack (1, 2.01, 2.94, 4.21, 5.43, 6.85) with independent per-partial amplitude random walks and slow detune drift. Singing-bowl / bell metal character with stereo spread per partial.",
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
];

interface DroneViewProps {
  engine: AudioEngine | null;
}

/**
 * DroneView — the instrument. Prototype layout:
 *   [tonic dial + mode picker]        [climate XY surface]
 *   [DRIFT · AIR · TIME macros]
 *
 * No transport button — the drone is on whenever there's a root set.
 * Tap the tonic pitch to start/retune; tap again to stop.
 */
export function DroneView({ engine }: DroneViewProps) {
  const [root, setRoot] = useState<PitchClass>("A");
  const [octave, setOctave] = useState(3);
  const [scale, setScale] = useState<ScaleId>("dorian");
  const [voiceType, setVoiceTypeState] = useState<VoiceType>(() => engine?.getVoiceType() ?? "tanpura");
  const [playing, setPlaying] = useState(false);

  const setVoiceType = useCallback((type: VoiceType) => {
    setVoiceTypeState(type);
    engine?.setVoiceType(type);
  }, [engine]);

  const [drift, setDriftState] = useState(() => engine?.getDrift() ?? 0.3);
  const [air, setAirState] = useState(() => engine?.getAir() ?? 0.4);
  const [time, setTimeState] = useState(() => engine?.getTime() ?? 0.5);
  const [sub, setSubState] = useState(() => engine?.getSub() ?? 0);
  const [bloom, setBloomState] = useState(() => engine?.getBloom() ?? 0.15);
  const [glide, setGlideState] = useState(() => engine?.getGlide() ?? 0.15);

  // Push macros to the engine whenever they change or the engine arrives.
  const setDrift = useCallback((v: number) => {
    setDriftState(v);
    engine?.setDrift(v);
  }, [engine]);
  const setAir = useCallback((v: number) => {
    setAirState(v);
    engine?.setAir(v);
  }, [engine]);
  const setTime = useCallback((v: number) => {
    setTimeState(v);
    engine?.setTime(v);
  }, [engine]);
  const setSub = useCallback((v: number) => {
    setSubState(v);
    engine?.setSub(v);
  }, [engine]);
  const setBloom = useCallback((v: number) => {
    setBloomState(v);
    engine?.setBloom(v);
  }, [engine]);
  const setGlide = useCallback((v: number) => {
    setGlideState(v);
    engine?.setGlide(v);
  }, [engine]);

  // When the engine first becomes available, push current slider state down.
  useEffect(() => {
    if (!engine) return;
    engine.setDrift(drift);
    engine.setAir(air);
    engine.setTime(time);
    engine.setSub(sub);
    engine.setBloom(bloom);
    engine.setGlide(glide);
    engine.setClimateX(climate.x);
    engine.setClimateY(climate.y);
    engine.setLfoShape(lfoShape);
    engine.setLfoRate(lfoRate);
    engine.setLfoAmount(lfoAmount);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine]);

  // Climate XY position (0..1 on each axis) — pushed live into engine
  const [climate, setClimateState] = useState(() => ({
    x: engine?.getClimateX() ?? 0.5,
    y: engine?.getClimateY() ?? 0.5,
  }));
  const setClimate = useCallback((x: number, y: number) => {
    setClimateState({ x, y });
    engine?.setClimateX(x);
    engine?.setClimateY(y);
  }, [engine]);

  // LFO state
  const [lfoShape, setLfoShapeState] = useState<OscillatorType>(() => engine?.getLfoShape() ?? "sine");
  const [lfoRate, setLfoRateState] = useState(() => engine?.getLfoRate() ?? 0.4);
  const [lfoAmount, setLfoAmountState] = useState(() => engine?.getLfoAmount() ?? 0);
  const setLfoShape = useCallback((s: OscillatorType) => {
    setLfoShapeState(s);
    engine?.setLfoShape(s);
  }, [engine]);
  const setLfoRate = useCallback((v: number) => {
    setLfoRateState(v);
    engine?.setLfoRate(v);
  }, [engine]);
  const setLfoAmount = useCallback((v: number) => {
    setLfoAmountState(v);
    engine?.setLfoAmount(v);
  }, [engine]);

  const freq = useMemo(() => pitchToFreq(root, octave), [root, octave]);

  // Push tonic changes to the engine whenever root/octave change and the drone is on
  useEffect(() => {
    if (!engine || !playing) return;
    engine.setDroneFreq(freq);
  }, [engine, playing, freq]);

  // Push mode (interval set) changes to the engine live — rebuilds the
  // stack without dropping the root voice.
  useEffect(() => {
    if (!engine) return;
    engine.setIntervals(scaleById(scale).intervalsCents);
  }, [engine, scale]);

  const togglePlay = useCallback(() => {
    if (!engine) return;
    if (playing) {
      engine.stopDrone();
      setPlaying(false);
    } else {
      engine.startDrone(freq, scaleById(scale).intervalsCents);
      setPlaying(true);
    }
  }, [engine, playing, freq, scale]);

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

  return (
    <div className="drone-layout">
      {/* ── Left column: tonic + mode + macros ─────────────────── */}
      <div className="drone-left">
        <div className="panel">
          <div className="panel-label">TONIC</div>
          <div className="tonic-wheel">
            {PITCH_CLASSES.map((pc) => (
              <button
                key={pc}
                onClick={() => setRoot(pc)}
                className={pc === root ? "tonic-cell tonic-cell-active" : "tonic-cell"}
                title={`Set root to ${pc}${octave}`}
              >
                {pc}
              </button>
            ))}
          </div>

          <div className="tonic-meta">
            <div className="octave-group">
              <button className="octave-btn" onClick={() => setOctave((o) => Math.max(1, o - 1))}>−</button>
              <span className="octave-label">OCT {octave}</span>
              <button className="octave-btn" onClick={() => setOctave((o) => Math.min(6, o + 1))}>+</button>
            </div>
            <span className="freq-readout">{freq.toFixed(1)} Hz</span>
          </div>

          <button
            className={playing ? "play-btn play-btn-active" : "play-btn"}
            onClick={togglePlay}
            title={playing ? "Stop the drone (Space)" : "Start the drone at the selected tonic (Space)"}
          >
            {playing ? "■ HOLDING" : "▶ HOLD"}
          </button>
        </div>

        <div className="panel">
          <div className="panel-label">MODE</div>
          <div className="scale-grid">
            {SCALES.map((s) => (
              <button
                key={s.id}
                onClick={() => setScale(s.id)}
                className={s.id === scale ? "scale-btn scale-btn-active" : "scale-btn"}
                title={`Modal set: ${s.label} — biases the harmonic voices that fit the tonic`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="panel-label">TIMBRE</div>
          <div className="timbre-grid">
            {VOICES.map((v) => (
              <button
                key={v.id}
                onClick={() => setVoiceType(v.id)}
                className={v.id === voiceType ? "timbre-btn timbre-btn-active" : "timbre-btn"}
                title={v.hint}
              >
                <span className="timbre-btn-icon">{v.icon}</span>
                <span className="timbre-btn-label">{v.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="panel-label">MACROS</div>
          <Macro
            label="DRIFT"
            value={drift}
            onChange={setDrift}
            icon={<IconDrift />}
            title="Drift — how much the partials wander in pitch. 0 = crystalline, 1 = floating"
          />
          <Macro
            label="AIR"
            value={air}
            onChange={setAir}
            icon={<IconAir />}
            title="Air — wet send into the atmosphere chain (reverb + space)"
          />
          <Macro
            label="TIME"
            value={time}
            onChange={setTime}
            icon={<IconTime />}
            title="Time — the rate of weather movement (LFO sweeping the filter). 0 = glacial, 1 = restless"
          />
          <Macro
            label="SUB"
            value={sub}
            onChange={setSub}
            icon={<IconSub />}
            title="Sub — adds a triangle voice one octave below the root. Weight without brightness"
          />
          <Macro
            label="BLOOM"
            value={bloom}
            onChange={setBloom}
            icon={<IconBloom />}
            displayValue={`${(0.3 + bloom * 9.7).toFixed(1)}s`}
            title="Bloom — attack time on the next HOLD. 0.3 s = immediate, 10 s = slow rise from silence"
          />
          <Macro
            label="GLIDE"
            value={glide}
            onChange={setGlide}
            icon={<IconGlide />}
            displayValue={`${(0.05 * Math.pow(160, glide)).toFixed(2)}s`}
            title="Glide — how slowly the drone retunes when you pick a new tonic. 50 ms = snap, 8 s = slowly flowing between notes"
          />
        </div>

        <div className="panel">
          <div className="panel-label">LFO · BREATHING</div>
          <div className="lfo-shape-row">
            {(["sine", "triangle", "square", "sawtooth"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setLfoShape(s)}
                className={s === lfoShape ? "lfo-shape-btn lfo-shape-btn-active" : "lfo-shape-btn"}
                title={`LFO wave shape: ${s}`}
              >
                <IconShape shape={s} />
              </button>
            ))}
          </div>
          <Macro
            label="RATE"
            value={(Math.log(lfoRate / 0.05) / Math.log(160))}
            onChange={(v) => setLfoRate(0.05 * Math.pow(160, v))}
            icon={<IconRate />}
            displayValue={`${lfoRate.toFixed(2)} Hz`}
            title="LFO rate — speed of the breathing/tremolo. 0.05 Hz (very slow) to 8 Hz (fluttering)"
          />
          <Macro
            label="DEPTH"
            value={lfoAmount}
            onChange={setLfoAmount}
            icon={<IconDepth />}
            title="LFO depth — how much it modulates the voice gain. 0 = off, 1 = full breathing"
          />
        </div>
      </div>

      {/* ── Right column: large climate XY surface + effects ───── */}
      <div className="drone-right">
        <div className="panel climate-panel">
          <div className="panel-label">CLIMATE</div>
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
              style={{ left: `${climate.x * 100}%`, bottom: `${climate.y * 100}%` }}
            />
            <span className="climate-axis climate-axis-x-left">DARK</span>
            <span className="climate-axis climate-axis-x-right">BRIGHT</span>
            <span className="climate-axis climate-axis-y-top">MOTION</span>
            <span className="climate-axis climate-axis-y-bot">STILL</span>
          </div>
        </div>

        {/* Effects chain — mpump-kaos-style toggle row below the XY pad */}
        <FxBar engine={engine} />
      </div>
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
