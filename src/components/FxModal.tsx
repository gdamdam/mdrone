/**
 * FxModal — settings sheet for a single effect. Opens on long-press
 * of an FxBar button. Each effect has:
 *   - A large SVG visualization at the top
 *   - A short description
 *   - 1–3 parameter sliders (per-effect)
 *   - Close button
 *
 * Serial inserts (TAPE, WOW) have no adjustable params in the
 * prototype — they show only the description and an on/off hint.
 */

import { useState, useEffect, useId, useRef } from "react";
import type { AudioEngine } from "../engine/AudioEngine";
import type { EffectId } from "../engine/FxChain";
import { TouchSlider } from "./TouchSlider";

interface FxModalProps {
  engine: AudioEngine | null;
  effectId: EffectId;
  onClose: () => void;
}

const EFFECT_TITLES: Record<EffectId, string> = {
  plate: "PLATE REVERB",
  hall: "HALL REVERB",
  shimmer: "SHIMMER REVERB",
  delay: "TAPE DELAY",
  tape: "TAPE",
  wow: "WOW & FLUTTER",
  sub: "SUB HARMONIC",
  comb: "RESONANT COMB",
  freeze: "FREEZE",
  cistern: "CISTERN REVERB",
  granular: "GRANULAR CLOUD",
  graincloud: "GRAIN STUTTER",
  ringmod: "RING MODULATOR",
  formant: "VOCAL FORMANT",
  halo: "HALO",
};

const EFFECT_DESCRIPTIONS: Record<EffectId, string> = {
  plate:
    "Dense metallic reverb modeled on the EMT 140 studio plate. Short decay (~1.6 s), high diffusion, bright mid-range. The classic ambient reverb — used on everything from Eno's Ambient 1 to Stars of the Lid.",
  hall:
    "Large concert-hall reverb with pre-delay. Long decay (~4.8 s), diffuse and airy. Turns a simple tone into a cathedral. Pair with SHIMMER for the Stars of the Lid sound.",
  shimmer:
    "Bright highpassed reverb tail that pairs with a +1 octave voice. When enabled, an octave-up saw pair joins the drone and both bloom in the bright reverb. The Brian Eno / Jonsi signature.",
  delay:
    "Tape-style delay with a warm, saturated feedback loop. Lowpass in the feedback path rolls off high frequencies on each repeat, creating the classic ghosting behind a sustained drone.",
  tape:
    "Serial insert. Tanh saturation plus a −4 dB high-shelf cut at 7 kHz. Makes digital signals feel physical — the warmth and compression of analog tape without the wobble.",
  wow:
    "Serial insert. Slow wow LFO at 0.55 Hz plus faster flutter LFO at 6.2 Hz, both modulating a short delay line. The pitch instability of degraded tape — Basinski's Disintegration Loops, Grouper, The Caretaker.",
  sub: "Psychoacoustic bass enhancer. Bandpass the bass region, saturate it, lowpass the result. Adds perceived low-end weight by generating sub-octave harmonics that the ear interprets as a stronger fundamental.",
  comb:
    "Resonant comb filter tuned to the drone root. Short delay with high feedback creates a pitched metallic ring that sings along with the tonic. Adds harmonic specificity and Karplus-Strong character.",
  freeze:
    "Captures the current moment as a self-sustaining loop. Toggle on to latch the buffer, toggle off to release it. The control here adjusts how strongly the frozen layer sits in the mix.",
  cistern:
    "Long-tail convolver with a ~28 second exponential decay. Models a Fort Worden cistern / cathedral scale — the reverb IS the instrument. Used by Deep Listening and other long-decay presets.",
  granular:
    "Grain-cloud tail processor. Long overlapping grains (~0.8 s) at low density give a smooth drone-friendly cloud. Used by Köner, Hecker, Fennesz, Basinski, Biosphere when a smooth textural haze is wanted.",
  graincloud:
    "Classic granular synthesis. Short grains (~80 ms) at high density (~15 grains/s) with wider pitch scatter. The audible grain-rattle texture — Fennesz, Oval, noisier Tim Hecker, the recognisable 'granular' sound.",
  ringmod:
    "Ring modulator — input multiplied by a fixed ~80 Hz sine carrier. Produces inharmonic sum + difference frequencies, the hallmark metallic scrape of Coil, NWW, and tape-era industrial drones.",
  formant:
    "Vocal formant bank — three resonant bandpasses at neutral 'ah' vowel frequencies (700 / 1220 / 2600 Hz). Adds a human vocal character to whatever flows through it.",
  halo:
    "Spectral partial bloom. Continuously tracks the energy in each frequency band of the dry signal and synthesises a slow, randomised cloud of upper harmonics (×2, ×3, ×4 …) on top. Tilt biases the bloom from a single octave-up shimmer toward a full string-section stack.",
};

export function FxModal({ engine, effectId, onClose }: FxModalProps) {
  // Close on Escape key
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      if (opener && typeof opener.focus === "function") {
        try { opener.focus(); } catch { /* ok */ }
      }
    };
  }, [onClose]);

  return (
    <div className="fx-modal-backdrop" onClick={onClose}>
      <div
        className="fx-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="fx-modal-header">
          <div className="fx-modal-title" id={titleId}>{EFFECT_TITLES[effectId]}</div>
          <button
            ref={closeRef}
            className="fx-modal-close"
            onClick={onClose}
            title="Close (Esc)"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="fx-modal-viz">
          <FxViz effectId={effectId} engine={engine} />
        </div>

        <p className="fx-modal-desc">{EFFECT_DESCRIPTIONS[effectId]}</p>

        <div className="fx-modal-params">
          <FxParams engine={engine} effectId={effectId} />
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Per-effect parameter panel
// ─────────────────────────────────────────────────────────────────────

function FxParams({ engine, effectId }: { engine: AudioEngine | null; effectId: EffectId }) {
  const fx = engine?.getFxChain();

  switch (effectId) {
    case "delay":
      return <DelayParams engine={engine} fx={fx} />;
    case "comb":
      return <CombParams engine={engine} fx={fx} />;
    case "sub":
      return <SubParams engine={engine} fx={fx} />;
    case "freeze":
      return <FreezeParams fx={fx} />;
    case "plate":
      return <PlateParams engine={engine} fx={fx} />;
    case "hall":
      return <HallParams engine={engine} fx={fx} />;
    case "cistern":
      return <CisternParams engine={engine} fx={fx} />;
    case "shimmer":
      return <ShimmerParams engine={engine} fx={fx} />;
    case "granular":
      return <GranularParams engine={engine} fx={fx} kind="granular" />;
    case "graincloud":
      return <GranularParams engine={engine} fx={fx} kind="graincloud" />;
    case "ringmod":
      return <RingmodParams engine={engine} fx={fx} />;
    case "formant":
      return <FormantParams engine={engine} fx={fx} />;
    case "halo":
      return <HaloParams engine={engine} fx={fx} />;
    case "tape":
    case "wow":
      return <AmountOnly engine={engine} effectId={effectId} fx={fx} defaultValue={0.7} />;
  }
}

type FxChainLike = ReturnType<NonNullable<AudioEngine["getFxChain"]>> | undefined;

function ParamSlider({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
  midiId,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (v: number) => void;
  midiId?: string;
}) {
  return (
    <div className="fx-param-row">
      <span className="fx-param-label">{label}</span>
      <TouchSlider
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={onChange}
        className="fx-param-slider"
        aria-label={label}
        midiId={midiId}
      />
      <span className="fx-param-value">
        {step < 0.01 ? value.toFixed(3) : step < 1 ? value.toFixed(2) : Math.round(value)}
        {unit}
      </span>
    </div>
  );
}

function AmountOnly({
  engine, effectId, fx, defaultValue,
}: {
  engine: AudioEngine | null;
  effectId: EffectId;
  fx: FxChainLike;
  defaultValue: number;
}) {
  const [amount, setAmount] = useState(() => fx?.getEffectLevel(effectId) ?? defaultValue);
  return (
    <ParamSlider
      label="AMOUNT"
      value={amount}
      min={0}
      max={1}
      step={0.01}
      unit=""
      onChange={(v) => {
        setAmount(v);
        if (engine && fx) fx.setEffectLevel(effectId, v);
      }}
      midiId={`fx.${effectId}`}
    />
  );
}

function DelayParams({ engine, fx }: { engine: AudioEngine | null; fx: FxChainLike }) {
  const [time, setTime] = useState(() => fx?.getDelayTime() ?? 0.55);
  const [fb, setFb] = useState(() => fx?.getDelayFeedback() ?? 0.58);
  return (
    <>
      <ParamSlider
        label="TIME"
        value={time}
        min={0.05}
        max={2}
        step={0.01}
        unit=" s"
        onChange={(v) => { setTime(v); fx?.setDelayTime(v); }}
      />
      <ParamSlider
        label="FEEDBACK"
        value={fb}
        min={0}
        max={0.95}
        step={0.01}
        unit=""
        onChange={(v) => { setFb(v); fx?.setDelayFeedback(v); }}
      />
      <AmountOnly engine={engine} effectId="delay" fx={fx} defaultValue={0.42} />
    </>
  );
}

function ShimmerParams({ engine, fx }: { engine: AudioEngine | null; fx: FxChainLike }) {
  const [fb, setFb] = useState(() => fx?.getShimmerFeedback() ?? 0.55);
  const [decay, setDecay] = useState(() => fx?.getShimmerDecay() ?? 0.7);
  const [mix, setMix] = useState(() => fx?.getShimmerMix() ?? 0.5);
  return (
    <>
      <ParamSlider
        label="FEEDBACK"
        value={fb}
        min={0}
        max={0.85}
        step={0.01}
        unit=""
        onChange={(v) => { setFb(v); fx?.setShimmerFeedback(v); }}
      />
      <ParamSlider
        label="DECAY"
        value={decay}
        min={0}
        max={0.95}
        step={0.01}
        unit=""
        onChange={(v) => { setDecay(v); fx?.setShimmerDecay(v); }}
      />
      <ParamSlider
        label="MIX"
        value={mix}
        min={0}
        max={1}
        step={0.01}
        unit=""
        onChange={(v) => { setMix(v); fx?.setShimmerMix(v); }}
      />
      <AmountOnly engine={engine} effectId="shimmer" fx={fx} defaultValue={0.5} />
    </>
  );
}

function HallParams({ engine, fx }: { engine: AudioEngine | null; fx: FxChainLike }) {
  const [size, setSize] = useState(() => fx?.getHallSize() ?? 0.45);
  const [damping, setDamping] = useState(() => fx?.getHallDamping() ?? 0.55);
  const [decay, setDecay] = useState(() => fx?.getHallDecay() ?? 0.84);
  return (
    <>
      <ParamSlider label="SIZE" value={size} min={0} max={2} step={0.01} unit=""
        onChange={(v) => { setSize(v); fx?.setHallSize(v); }} />
      <ParamSlider label="DAMPING" value={damping} min={0} max={1} step={0.01} unit=""
        onChange={(v) => { setDamping(v); fx?.setHallDamping(v); }} />
      <ParamSlider label="DECAY" value={decay} min={0} max={0.99} step={0.01} unit=""
        onChange={(v) => { setDecay(v); fx?.setHallDecay(v); }} />
      <AmountOnly engine={engine} effectId="hall" fx={fx} defaultValue={0.5} />
    </>
  );
}

function CisternParams({ engine, fx }: { engine: AudioEngine | null; fx: FxChainLike }) {
  const [size, setSize] = useState(() => fx?.getCisternSize() ?? 1.2);
  const [damping, setDamping] = useState(() => fx?.getCisternDamping() ?? 0.7);
  const [decay, setDecay] = useState(() => fx?.getCisternDecay() ?? 0.94);
  return (
    <>
      <ParamSlider label="SIZE" value={size} min={0} max={2} step={0.01} unit=""
        onChange={(v) => { setSize(v); fx?.setCisternSize(v); }} />
      <ParamSlider label="DAMPING" value={damping} min={0} max={1} step={0.01} unit=""
        onChange={(v) => { setDamping(v); fx?.setCisternDamping(v); }} />
      <ParamSlider label="DECAY" value={decay} min={0} max={0.99} step={0.01} unit=""
        onChange={(v) => { setDecay(v); fx?.setCisternDecay(v); }} />
      <AmountOnly engine={engine} effectId="cistern" fx={fx} defaultValue={0.6} />
    </>
  );
}

function PlateParams({ engine, fx }: { engine: AudioEngine | null; fx: FxChainLike }) {
  const [decay, setDecay] = useState(() => fx?.getPlateDecay() ?? 0.5);
  const [damping, setDamping] = useState(() => fx?.getPlateDamping() ?? 0.35);
  const [diffusion, setDiffusion] = useState(() => fx?.getPlateDiffusion() ?? 0.75);
  return (
    <>
      <ParamSlider label="DECAY" value={decay} min={0} max={0.99} step={0.01} unit=""
        onChange={(v) => { setDecay(v); fx?.setPlateDecay(v); }} />
      <ParamSlider label="DAMPING" value={damping} min={0} max={1} step={0.01} unit=""
        onChange={(v) => { setDamping(v); fx?.setPlateDamping(v); }} />
      <ParamSlider label="DIFFUSION" value={diffusion} min={0} max={0.9} step={0.01} unit=""
        onChange={(v) => { setDiffusion(v); fx?.setPlateDiffusion(v); }} />
      <AmountOnly engine={engine} effectId="plate" fx={fx} defaultValue={0.5} />
    </>
  );
}

function RingmodParams({ engine, fx }: { engine: AudioEngine | null; fx: FxChainLike }) {
  const [freq, setFreq] = useState(() => fx?.getRingmodFreq() ?? 80);
  return (
    <>
      <ParamSlider label="FREQUENCY" value={freq} min={10} max={2000} step={1} unit=" Hz"
        onChange={(v) => { setFreq(v); fx?.setRingmodFreq(v); }} />
      <AmountOnly engine={engine} effectId="ringmod" fx={fx} defaultValue={0.5} />
    </>
  );
}

function GranularParams({ engine, fx, kind }: { engine: AudioEngine | null; fx: FxChainLike; kind: "granular" | "graincloud" }) {
  const isCloud = kind === "graincloud";
  const [size, setSize] = useState(() => (isCloud ? fx?.getGrainCloudSize() : fx?.getGranularSize()) ?? (isCloud ? 0.06 : 0.2));
  const [density, setDensity] = useState(() => (isCloud ? fx?.getGrainCloudDensity() : fx?.getGranularDensity()) ?? (isCloud ? 14 : 6));
  const [pitch, setPitch] = useState(() => (isCloud ? fx?.getGrainCloudPitchSpread() : fx?.getGranularPitchSpread()) ?? (isCloud ? 0.05 : 0.2));
  const setS = isCloud ? (v: number) => fx?.setGrainCloudSize(v) : (v: number) => fx?.setGranularSize(v);
  const setD = isCloud ? (v: number) => fx?.setGrainCloudDensity(v) : (v: number) => fx?.setGranularDensity(v);
  const setP = isCloud ? (v: number) => fx?.setGrainCloudPitchSpread(v) : (v: number) => fx?.setGranularPitchSpread(v);
  return (
    <>
      <ParamSlider label="SIZE" value={size} min={0.02} max={2} step={0.01} unit=" s"
        onChange={(v) => { setSize(v); setS(v); }} />
      <ParamSlider label="DENSITY" value={density} min={0.3} max={40} step={0.1} unit="/s"
        onChange={(v) => { setDensity(v); setD(v); }} />
      <ParamSlider label="PITCH" value={pitch} min={0} max={1} step={0.01} unit=""
        onChange={(v) => { setPitch(v); setP(v); }} />
      <AmountOnly engine={engine} effectId={kind} fx={fx} defaultValue={isCloud ? 0.8 : 0.8} />
    </>
  );
}

const VOWEL_LABELS = ["AH", "EE", "OH", "OO", "EH"];

function FormantParams({ engine, fx }: { engine: AudioEngine | null; fx: FxChainLike }) {
  const [vowel, setVowel] = useState(() => fx?.getFormantVowel() ?? 0);
  const [shift, setShift] = useState(() => fx?.getFormantShift() ?? 1);
  return (
    <>
      <div className="fx-param-row">
        <span className="fx-param-label">VOWEL</span>
        <div className="fx-vowel-row">
          {VOWEL_LABELS.map((label, i) => (
            <button
              key={label}
              data-midi-id="fx.formant.vowel"
              className={`fx-vowel-btn${vowel === i ? " fx-vowel-btn-active" : ""}`}
              onClick={() => { setVowel(i); fx?.setFormantVowel(i); }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <ParamSlider
        label="SHIFT"
        value={shift}
        min={0.5}
        max={2}
        step={0.01}
        unit="x"
        onChange={(v) => { setShift(v); fx?.setFormantShift(v); }}
      />
      <AmountOnly engine={engine} effectId="formant" fx={fx} defaultValue={0.6} />
    </>
  );
}

function CombParams({ engine, fx }: { engine: AudioEngine | null; fx: FxChainLike }) {
  const [fb, setFb] = useState(() => fx?.getCombFeedback() ?? 0.85);
  return (
    <>
      <ParamSlider
        label="RESONANCE"
        value={fb}
        min={0}
        max={0.98}
        step={0.01}
        unit=""
        onChange={(v) => { setFb(v); fx?.setCombFeedback(v); }}
      />
      <AmountOnly engine={engine} effectId="comb" fx={fx} defaultValue={0.4} />
      <div className="fx-modal-hint">
        Comb frequency auto-tunes to the drone root. Raise resonance for a longer ring.
      </div>
    </>
  );
}

function SubParams({ engine, fx }: { engine: AudioEngine | null; fx: FxChainLike }) {
  const [center, setCenter] = useState(() => fx?.getSubCenter() ?? 110);
  return (
    <>
      <ParamSlider
        label="CENTER"
        value={center}
        min={40}
        max={220}
        step={1}
        unit=" Hz"
        onChange={(v) => { setCenter(v); fx?.setSubCenter(v); }}
      />
      <AmountOnly engine={engine} effectId="sub" fx={fx} defaultValue={0.6} />
    </>
  );
}

function FreezeParams({ fx }: { fx: FxChainLike }) {
  const [mix, setMix] = useState(() => fx?.getFreezeFeedback() ?? 0.7);
  const [mode, setMode] = useState<0 | 1>(() => fx?.getFreezeMode() ?? 0);
  return (
    <>
      <ParamSlider
        label="MIX"
        value={mix}
        min={0}
        max={1}
        step={0.01}
        unit=""
        onChange={(v) => { setMix(v); fx?.setFreezeFeedback(v); }}
      />
      <div className="fx-modal-mode-row">
        <span className="fx-modal-mode-label">MODE</span>
        <button
          type="button"
          className={`fx-modal-mode-btn${mode === 0 ? " is-active" : ""}`}
          onClick={() => { setMode(0); fx?.setFreezeMode(0); }}
        >
          HOLD
        </button>
        <button
          type="button"
          className={`fx-modal-mode-btn${mode === 1 ? " is-active" : ""}`}
          onClick={() => { setMode(1); fx?.setFreezeMode(1); }}
        >
          INFINITE
        </button>
      </div>
      <div className="fx-modal-hint">
        HOLD captures the buffer once on activation. INFINITE folds new
        input into the sustained cloud so chords build over time.
      </div>
    </>
  );
}

function HaloParams({ engine, fx }: { engine: AudioEngine | null; fx: FxChainLike }) {
  const [tilt, setTilt] = useState(() => fx?.getHaloTilt() ?? 0.5);
  return (
    <>
      <AmountOnly engine={engine} effectId="halo" fx={fx} defaultValue={0.55} />
      <ParamSlider
        label="TILT"
        value={tilt}
        min={0}
        max={1}
        step={0.01}
        unit=""
        onChange={(v) => { setTilt(v); fx?.setHaloTilt(v); }}
      />
      <div className="fx-modal-hint">
        Low TILT keeps the bloom near the 2× partial (octave halo). High
        TILT spreads energy through the 2..6× stack (string-section).
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Large SVG visualizations for each effect (modal header)
// ─────────────────────────────────────────────────────────────────────

function useFxViz() {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    // Frame-limit to ~20 fps. The original loop fired setPhase every
    // rAF tick (~60 fps), reconciling the entire FxModal subtree three
    // times as often as necessary and competing with audio scheduling
    // while the modal is open. 20 fps is still smooth for the SVG
    // vizzes and cuts React commit work to a third.
    let raf = 0;
    let phase = 0;
    let lastPaint = -Infinity;
    const FRAME_MS = 1000 / 20;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (now - lastPaint < FRAME_MS) return;
      const dt = lastPaint < 0 ? FRAME_MS : now - lastPaint;
      lastPaint = now;
      // Advance at the same angular rate as before (~1.2 rad/s) so
      // existing viz easing and periods are unchanged.
      phase = (phase + 0.02 * (dt / (1000 / 60))) % (Math.PI * 2);
      setPhase(phase);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return phase;
}

const vizProps = {
  width: "100%",
  height: 140,
  viewBox: "0 0 400 140",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function FxViz({ effectId, engine }: { effectId: EffectId; engine: AudioEngine | null }) {
  const phase = useFxViz();

  switch (effectId) {
    case "plate":
      return <VizPlate />;
    case "hall":
      return <VizHall />;
    case "shimmer":
      return <VizShimmer phase={phase} />;
    case "delay":
      return <VizDelay />;
    case "tape":
      return <VizTape phase={phase} />;
    case "wow":
      return <VizWow phase={phase} />;
    case "sub":
      return <VizSub />;
    case "comb":
      return <VizComb />;
    case "freeze":
      return <VizFreeze />;
    case "cistern":
      return <VizCistern />;
    case "granular":
    case "graincloud":
      return <VizGranular phase={phase} />;
    case "ringmod":
      return <VizRingmod phase={phase} />;
    case "formant":
      return <VizFormant engine={engine} />;
    case "halo":
      return <VizHalo phase={phase} />;
  }
}

/** HALO — central source with radiating concentric arcs (partial bloom). */
function VizHalo({ phase }: { phase: number }) {
  const t = phase * 0.0006;
  const breath = 0.5 + 0.5 * Math.sin(t * 2);
  return (
    <svg {...vizProps} className="fx-viz">
      <circle cx="200" cy="70" r="6" fill="currentColor" />
      <circle cx="200" cy="70" r="22" opacity={0.55 + 0.25 * breath} />
      <circle cx="200" cy="70" r="40" opacity={0.35 + 0.2 * (1 - breath)} />
      <circle cx="200" cy="70" r="60" opacity="0.2" />
      <path d="M120 70 L 280 70" opacity="0.18" strokeDasharray="2 4" />
      <path d="M200 20 L 200 120" opacity="0.18" strokeDasharray="2 4" />
    </svg>
  );
}

/** PLATE — a hanging metal plate with radiating lines. */
function VizPlate() {
  return (
    <svg {...vizProps} className="fx-viz">
      <rect x="120" y="30" width="160" height="80" rx="2" />
      <path d="M170 30 V 14" />
      <path d="M230 30 V 14" />
      <path d="M135 50 H 265" opacity="0.35" />
      <path d="M135 70 H 265" opacity="0.35" />
      <path d="M135 90 H 265" opacity="0.35" />
      <path d="M60 70 L 110 70" opacity="0.5" />
      <path d="M290 70 L 340 70" opacity="0.5" />
      <circle cx="55" cy="70" r="2.5" fill="currentColor" opacity="0.5" />
      <circle cx="345" cy="70" r="2.5" fill="currentColor" opacity="0.5" />
    </svg>
  );
}

/** HALL — cathedral arches in perspective. */
function VizHall() {
  return (
    <svg {...vizProps} className="fx-viz">
      <path d="M20 125 V 60 Q 20 20, 80 20 Q 140 20, 140 60 V 125" />
      <path d="M60 125 V 75 Q 60 50, 80 50 Q 100 50, 100 75 V 125" opacity="0.7" />
      <path d="M160 120 V 55 Q 160 18, 220 18 Q 280 18, 280 55 V 120" opacity="0.55" />
      <path d="M300 118 V 50 Q 300 16, 360 16 Q 380 16, 380 30" opacity="0.4" />
      <path d="M20 125 H 380" opacity="0.3" />
    </svg>
  );
}

/** SHIMMER — rising sparkle cluster, animated via phase. */
function VizShimmer({ phase }: { phase: number }) {
  const yOffset = Math.sin(phase) * 4;
  return (
    <svg {...vizProps} className="fx-viz">
      {[60, 120, 190, 260, 340].map((x, i) => (
        <g key={x} transform={`translate(${x}, ${70 + yOffset * (i % 2 === 0 ? 1 : -1)})`}>
          <path d="M0 -18 V 18 M-18 0 H 18" />
          <path d="M-12 -12 L 12 12 M-12 12 L 12 -12" opacity="0.5" />
        </g>
      ))}
    </svg>
  );
}

/** DELAY — three fading echoes. */
function VizDelay() {
  return (
    <svg {...vizProps} className="fx-viz">
      {[40, 120, 200, 280, 355].map((x, i) => (
        <g key={x} opacity={1 - i * 0.18}>
          <path d={`M${x} 70 L ${x + 22} 40 L ${x + 22} 100 Z`} />
        </g>
      ))}
    </svg>
  );
}

/** TAPE — reel-to-reel player, animated rotation. */
function VizTape({ phase }: { phase: number }) {
  const rot = (phase * 30) % 360;
  return (
    <svg {...vizProps} className="fx-viz">
      <g transform="translate(110 70)">
        <circle r="40" />
        <circle r="5" fill="currentColor" />
        <g transform={`rotate(${rot})`}>
          <line x1="0" y1="-35" x2="0" y2="35" opacity="0.35" />
          <line x1="-35" y1="0" x2="35" y2="0" opacity="0.35" />
        </g>
      </g>
      <g transform="translate(290 70)">
        <circle r="40" />
        <circle r="5" fill="currentColor" />
        <g transform={`rotate(${-rot})`}>
          <line x1="0" y1="-35" x2="0" y2="35" opacity="0.35" />
          <line x1="-35" y1="0" x2="35" y2="0" opacity="0.35" />
        </g>
      </g>
      <path d="M75 110 H 325" strokeWidth="2.2" />
    </svg>
  );
}

/** WOW — two sine waves at different rates. */
function VizWow({ phase }: { phase: number }) {
  const pts = (freq: number, amp: number, yOff: number) => {
    const out: string[] = [];
    for (let x = 0; x <= 400; x += 8) {
      const y = yOff + Math.sin((x * freq) / 50 + phase * 3) * amp;
      out.push(`${x === 0 ? "M" : "L"} ${x} ${y}`);
    }
    return out.join(" ");
  };
  return (
    <svg {...vizProps} className="fx-viz">
      <path d={pts(1, 18, 55)} />
      <path d={pts(4, 6, 95)} opacity="0.6" />
    </svg>
  );
}

/** SUB — a thick waveform bloom. */
function VizSub() {
  return (
    <svg {...vizProps} className="fx-viz">
      <path d="M20 70 Q 60 20, 100 70 T 180 70 T 260 70 T 340 70 T 380 70" strokeWidth="3" />
      <path d="M20 100 H 380" strokeWidth="5" opacity="0.35" />
      <path d="M40 120 H 360" strokeWidth="2" opacity="0.25" />
    </svg>
  );
}

/** COMB — resonance peaks at regular intervals. */
function VizComb() {
  return (
    <svg {...vizProps} className="fx-viz">
      <path d="M20 120 H 380" opacity="0.3" />
      {[60, 120, 180, 240, 300, 360].map((x, i) => {
        const h = 80 - i * 10;
        return <path key={x} d={`M ${x} 120 V ${120 - h}`} strokeWidth="2" />;
      })}
      <path d="M20 120 Q 60 40, 120 100 Q 180 60, 240 95 Q 300 80, 380 90" opacity="0.5" />
    </svg>
  );
}

/** FREEZE — a crystal/snowflake. */
function VizFreeze() {
  return (
    <svg {...vizProps} className="fx-viz">
      <g transform="translate(200 70)">
        <path d="M0 -50 V 50" />
        <path d="M-50 0 H 50" />
        <path d="M-36 -36 L 36 36" />
        <path d="M36 -36 L -36 36" />
        {[0, 60, 120, 180, 240, 300].map((a) => (
          <g key={a} transform={`rotate(${a})`}>
            <path d="M0 -30 L -6 -24" />
            <path d="M0 -30 L 6 -24" />
            <path d="M0 -40 L -5 -34" />
            <path d="M0 -40 L 5 -34" />
          </g>
        ))}
      </g>
    </svg>
  );
}

/** CISTERN — concentric arches representing a deep cylindrical space. */
function VizCistern() {
  return (
    <svg {...vizProps} className="fx-viz">
      {[0, 1, 2, 3, 4].map((i) => {
        const r = 30 + i * 18;
        return <path key={i} d={`M ${200 - r} 120 A ${r} ${r} 0 0 1 ${200 + r} 120`} opacity={1 - i * 0.15} />;
      })}
      <circle cx="200" cy="120" r="4" fill="currentColor" />
    </svg>
  );
}

/** GRANULAR / GRAINCLOUD — scattered dots with animated drift. */
function VizGranular({ phase }: { phase: number }) {
  const grains = [
    [60, 50], [110, 80], [160, 40], [200, 90], [250, 55],
    [290, 75], [340, 45], [80, 95], [180, 65], [320, 100],
  ];
  return (
    <svg {...vizProps} className="fx-viz">
      {grains.map(([x, y], i) => {
        const dx = Math.sin(phase + i * 1.3) * 8;
        const dy = Math.cos(phase * 0.7 + i * 0.9) * 6;
        const r = 3 + Math.sin(phase + i * 2) * 1.5;
        return <circle key={i} cx={x + dx} cy={y + dy} r={r} fill="currentColor" opacity={0.4 + Math.sin(phase + i) * 0.2} />;
      })}
    </svg>
  );
}

/** RINGMOD — two interlocking sine curves representing AM. */
function VizRingmod({ phase }: { phase: number }) {
  const pts1: string[] = [];
  const pts2: string[] = [];
  for (let x = 0; x <= 400; x += 4) {
    const t = x / 400;
    pts1.push(`${x},${70 + Math.sin(t * Math.PI * 6 + phase) * 30}`);
    pts2.push(`${x},${70 + Math.sin(t * Math.PI * 14 + phase * 2.3) * 20}`);
  }
  return (
    <svg {...vizProps} className="fx-viz">
      <polyline points={pts1.join(" ")} />
      <polyline points={pts2.join(" ")} opacity="0.5" />
    </svg>
  );
}

/** FORMANT — three resonant peaks that move with the current vowel. */
function VizFormant({ engine }: { engine: AudioEngine | null }) {
  const fx = engine?.getFxChain();
  const vowelIdx = fx?.getFormantVowel() ?? 0;
  const shift = fx?.getFormantShift() ?? 1;
  // Same vowel table as FxChain
  const VOWELS: [number, number, number][] = [
    [700, 1220, 2600], [270, 2300, 3000], [400, 800, 2600],
    [300, 870, 2250], [530, 1850, 2500],
  ];
  const freqs = VOWELS[vowelIdx] ?? VOWELS[0];
  // Map Hz to SVG x position (log scale, 100Hz→20, 4000Hz→380)
  const hzToX = (hz: number) => 20 + (Math.log(hz * shift / 100) / Math.log(4000 / 100)) * 360;

  return (
    <svg {...vizProps} className="fx-viz">
      {freqs.map((hz, i) => {
        const cx = hzToX(hz);
        const h = 55 - i * 10;
        const w = 28 - i * 4;
        return <path key={i} d={`M ${cx - w} 120 Q ${cx} ${120 - h} ${cx + w} 120`} strokeWidth={2} />;
      })}
      <line x1="20" y1="120" x2="380" y2="120" opacity="0.3" />
      {freqs.map((hz, i) => {
        const cx = hzToX(hz);
        return <text key={i} x={cx} y="135" textAnchor="middle" fontSize="10" fill="currentColor" opacity="0.5">F{i + 1}</text>;
      })}
    </svg>
  );
}
