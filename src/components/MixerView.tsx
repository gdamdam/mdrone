/**
 * MixerView — ported from mloop (Option B master chain).
 * Signal flow: HPF → 3-band EQ → glue comp → drive → limiter → VOL
 *
 * Intentionally identical to mloop's mixer so the family reads as one
 * mastering vocabulary across all three apps.
 */

import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { AudioEngine } from "../engine/AudioEngine";

interface MixerViewProps {
  engine: AudioEngine | null;
  /** Controlled master volume — shared with the Header volume modal. */
  volume?: number;
  onVolumeChange?: (v: number) => void;
}

interface StripProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (v: number) => void;
  centre?: number;
  title?: string;
}

function Strip({ label, value, min, max, step, unit, onChange, centre, title }: StripProps) {
  const pct = ((value - min) / (max - min)) * 100;
  const centrePct = centre !== undefined ? ((centre - min) / (max - min)) * 100 : null;
  return (
    <div className="mixer-strip" title={title}>
      <div className="mixer-strip-label">{label}</div>
      <div className="mixer-strip-slider-wrap">
        {centrePct !== null && (
          <div className="mixer-strip-centre" style={{ "--centre": `${centrePct}%` } as CSSProperties} />
        )}
        <div className="mixer-strip-fill" style={{ "--fill": `${pct}%` } as CSSProperties} />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="mixer-strip-slider"
        />
      </div>
      <div className="mixer-strip-value">
        {value.toFixed(step < 1 ? 1 : 0)}{unit ? ` ${unit}` : ""}
      </div>
    </div>
  );
}

const HPF_STEPS = [10, 20, 30, 40] as const;
const hpfLabel = (hz: number) => (hz <= 10 ? "OFF" : `${hz}`);

export function MixerView({ engine, volume: volumeProp, onVolumeChange }: MixerViewProps) {
  const [hpfHz, setHpfHz] = useState(() => engine?.getHpfFreq() ?? 10);
  const [low, setLow] = useState(() => engine?.getEqLow().gain.value ?? 0);
  const [mid, setMid] = useState(() => engine?.getEqMid().gain.value ?? 0);
  const [high, setHigh] = useState(() => engine?.getEqHigh().gain.value ?? 0);
  const [glue, setGlue] = useState(() => engine?.getGlueAmount() ?? 0);
  const [drive, setDrive] = useState(() => engine?.getDrive() ?? 1);
  const [limiterOn, setLimiterOn] = useState(() => engine?.isLimiterEnabled() ?? true);
  const [ceiling, setCeiling] = useState(() => engine?.getLimiterCeiling() ?? -1);
  const [volumeInternal, setVolumeInternal] = useState(() => engine?.getOutputTrim().gain.value ?? 1);
  const volume = volumeProp ?? volumeInternal;

  // Clip LED — rAF loop against the master analyser
  const clipLedRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef(engine);
  useEffect(() => { engineRef.current = engine; });
  useEffect(() => {
    let raf = 0;
    let holdUntil = 0;
    let lastSample = -Infinity;
    const FRAME_MS = 1000 / 30;
    const buf = new Uint8Array(2048);
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (now - lastSample < FRAME_MS) return;
      lastSample = now;
      const el = clipLedRef.current;
      const eng = engineRef.current;
      if (!el || !eng) return;
      eng.getAnalyser().getByteTimeDomainData(buf);
      let peak = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = Math.abs(buf[i] - 128) / 127;
        if (v > peak) peak = v;
      }
      if (peak > 0.98) holdUntil = now + 120;
      el.classList.toggle("clip-on", now < holdUntil);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const cycleHpf = () => {
    const idx = HPF_STEPS.indexOf(hpfHz as typeof HPF_STEPS[number]);
    const next = HPF_STEPS[(idx + 1) % HPF_STEPS.length];
    setHpfHz(next);
    if (engine) engine.setHpfFreq(next);
  };

  const onLow = (v: number) => { setLow(v); if (engine) engine.getEqLow().gain.value = v; };
  const onMid = (v: number) => { setMid(v); if (engine) engine.getEqMid().gain.value = v; };
  const onHigh = (v: number) => { setHigh(v); if (engine) engine.getEqHigh().gain.value = v; };
  const onGlue = (v: number) => { setGlue(v); if (engine) engine.setGlueAmount(v); };
  const onDrive = (v: number) => { setDrive(v); if (engine) engine.setDrive(v); };
  const toggleLimiter = () => {
    const next = !limiterOn;
    setLimiterOn(next);
    if (engine) engine.setLimiterEnabled(next);
  };
  const onCeiling = (v: number) => { setCeiling(v); if (engine) engine.setLimiterCeiling(v); };
  const onVolume = (v: number) => {
    if (onVolumeChange) {
      onVolumeChange(v);
    } else {
      setVolumeInternal(v);
      if (engine) engine.setMasterVolume(v);
    }
  };

  const hpfOn = hpfHz > 10;

  return (
    <div className="mixer-layout">
      <div className="mixer-strips">
        {/* HPF toggle column */}
        <div className="mixer-strip" title="Highpass filter — click to cycle OFF / 20 / 30 / 40 Hz">
          <div className="mixer-strip-label">HPF</div>
          <button
            onClick={cycleHpf}
            className="mixer-limiter-btn"
            style={{
              background: hpfOn ? "var(--preview)" : "var(--bg)",
              color: hpfOn ? "#000" : "var(--text-dim)",
              borderColor: hpfOn ? "var(--preview)" : "var(--border)",
            }}
          >
            {hpfLabel(hpfHz)}
          </button>
          <div className="mixer-strip-value">{hpfOn ? "Hz" : "—"}</div>
        </div>

        <div className="mixer-divider" />

        <Strip label="LOW" value={low} min={-18} max={18} step={0.5} unit="dB" onChange={onLow} centre={0}
          title="Low shelf — boost or cut below ~250 Hz" />
        <Strip label="MID" value={mid} min={-18} max={18} step={0.5} unit="dB" onChange={onMid} centre={0}
          title="Mid peaking — boost or cut around 1 kHz" />
        <Strip label="HIGH" value={high} min={-18} max={18} step={0.5} unit="dB" onChange={onHigh} centre={0}
          title="High shelf — boost or cut above ~4 kHz" />

        <div className="mixer-divider" />

        <Strip label="GLUE" value={glue} min={0} max={1} step={0.01} unit="" onChange={onGlue}
          title="Glue compressor — gentle 2:1 bus compression with auto makeup gain" />
        <Strip label="DRIVE" value={drive} min={1} max={10} step={0.1} unit="×" onChange={onDrive}
          title="Soft-clip drive — tanh waveshaper for warmth and harmonics" />

        <div className="mixer-divider" />

        {/* Limiter column */}
        <div className="mixer-strip" title="Brick-wall limiter — protects against clipping">
          <div className="mixer-strip-label">LIMITER</div>
          <button
            onClick={toggleLimiter}
            className="mixer-limiter-btn"
            style={{
              background: limiterOn ? "var(--preview)" : "var(--bg)",
              color: limiterOn ? "#000" : "var(--text-dim)",
              borderColor: limiterOn ? "var(--preview)" : "var(--border)",
            }}
          >
            {limiterOn ? "ON" : "OFF"}
          </button>
          <div className="mixer-clip-row">
            <div ref={clipLedRef} className="mixer-clip-led" />
            <span className="mixer-clip-label">CLIP</span>
          </div>
        </div>

        <Strip label="CEIL" value={ceiling} min={-6} max={0} step={0.1} unit="dB" onChange={onCeiling}
          title="Limiter output ceiling — maximum peak level" />

        <div className="mixer-divider" />

        <Strip label="VOL" value={volume} min={0} max={1.5} step={0.01} unit="" onChange={onVolume}
          title="Master output trim — final volume, post-limiter" />
      </div>

      <div className="mixer-hint">
        Master bus: HPF → 3-band EQ → glue → drive → limiter → trim → out
      </div>
    </div>
  );
}
