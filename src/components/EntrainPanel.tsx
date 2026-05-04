/**
 * ENTRAIN panel — a pure-Hz modulation-rate control with zone-
 * coloured background, mode toggle (AM / DICHOTIC / BOTH), and a
 * HEADPHONES indicator for the dichotic path.
 *
 * Phase 1 scope: this component reads + writes `entrain` scene
 * state only. No audio wiring yet — the engine is updated in later
 * phases. The whole panel is hidden unless the user has opted in via
 * Settings → Advanced, so non-opted users see no change.
 */

import { useCallback } from "react";
import {
  clampDichoticCents,
  clampEntrainAmDepth,
  clampEntrainRate,
  DEFAULT_ENTRAIN,
  describeEntrain,
  ENTRAIN_AM_DEPTH_MAX,
  ENTRAIN_AM_DEPTH_MIN,
  ENTRAIN_DICHOTIC_MAX_CENTS,
  ENTRAIN_LANDMARKS,
  ENTRAIN_MAX_HZ,
  ENTRAIN_MIN_HZ,
  phaseLockedRate,
  zoneColorForHz,
  zoneGradientCss,
  type EntrainMode,
  type EntrainState,
} from "../entrain";

interface EntrainPanelProps {
  entrain: EntrainState | undefined;
  onChange: (next: EntrainState) => void;
  /** Current breathing LFO rate in Hz. Used to show the actual
   *  phase-locked rate the engine will emit — gives the user a hint
   *  that their requested rate is being quantized to a multiple of
   *  the breathing LFO so the two modulators don't drift. */
  breathingHz: number;
}

const MODES: Array<{ id: EntrainMode; label: string; title: string }> = [
  { id: "am",       label: "AM",       title: "Amplitude modulation only — works on speakers" },
  { id: "dichotic", label: "DICHOTIC", title: "Per-voice L/R detune — headphones required" },
  { id: "both",     label: "BOTH",     title: "Amplitude modulation plus dichotic detune" },
];

export function EntrainPanel({ entrain, onChange, breathingHz }: EntrainPanelProps) {
  const state = entrain ?? DEFAULT_ENTRAIN;

  const toggleEnabled = useCallback(() => {
    onChange({ ...state, enabled: !state.enabled });
  }, [state, onChange]);

  const setRate = useCallback((hz: number) => {
    onChange({ ...state, rateHz: clampEntrainRate(hz) });
  }, [state, onChange]);

  const setMode = useCallback((mode: EntrainMode) => {
    onChange({ ...state, mode });
  }, [state, onChange]);

  const setCents = useCallback((cents: number) => {
    onChange({ ...state, dichoticCents: clampDichoticCents(cents) });
  }, [state, onChange]);

  const setAmDepth = useCallback((d: number) => {
    onChange({ ...state, amDepth: clampEntrainAmDepth(d) });
  }, [state, onChange]);

  const lock = phaseLockedRate(breathingHz, state.rateHz);
  // Whether dichotic is *playing* (lights the HEADPHONES badge).
  // Gated on power so users don't see an "on" indicator when silent.
  const dichoticPlaying = state.enabled && (state.mode === "dichotic" || state.mode === "both");
  // Whether dichotic is the selected mode (shows the SPREAD slider).
  // Not gated on power — same rationale as the live subtitle: show
  // what the mode would do even when the power button is off.
  const dichoticMode = state.mode === "dichotic" || state.mode === "both";
  // Rate slider + zone colours only drive anything audible in AM and
  // BOTH modes — dichotic-only is controlled entirely by the SPREAD
  // cents. Grey out the slider so the UI is honest about what's live.
  const rateActive = state.mode !== "dichotic";
  const amActive = state.mode === "am" || state.mode === "both";
  const amDepth = state.amDepth ?? DEFAULT_ENTRAIN.amDepth;
  const trackColor = zoneColorForHz(state.rateHz);

  return (
    <div
      className={state.enabled ? "entrain-panel entrain-panel-on" : "entrain-panel"}
      aria-label="LFO 2 · FLICKER"
    >
      <div className="entrain-title">LFO 2 · FLICKER</div>
      <div className="entrain-header">
        <button
          type="button"
          className={state.enabled ? "entrain-power entrain-power-on" : "entrain-power"}
          onClick={toggleEnabled}
          aria-pressed={state.enabled}
          title={state.enabled ? "Turn FLICKER off" : "Turn FLICKER on"}
        >
          {state.enabled ? "● ON" : "OFF"}
        </button>
        <span
          className={dichoticPlaying ? "entrain-hp entrain-hp-on" : "entrain-hp"}
          title={dichoticPlaying
            ? "Dichotic mode active — use headphones for the L/R detune to fuse"
            : "Dichotic mode off or FLICKER disabled"}
        >
          HEADPHONES
        </span>
      </div>
      <div className="entrain-subtitle">
        {describeEntrain(state, breathingHz)}
      </div>

      <div className={rateActive ? "entrain-rate-row" : "entrain-rate-row entrain-rate-row-inactive"}>
        <div className="entrain-slider-col">
          <input
            type="range"
            className="entrain-rate-slider"
            min={ENTRAIN_MIN_HZ}
            max={ENTRAIN_MAX_HZ}
            step={0.1}
            value={state.rateHz}
            onChange={(e) => setRate(Number(e.currentTarget.value))}
            disabled={!rateActive}
            style={{
              // zone colors live on the track; the thumb picks up the
              // current-zone accent via the CSS variable below
              background: zoneGradientCss(),
              // consumed by entrain-rate-slider::-webkit-slider-thumb
              ["--entrain-thumb" as string]: trackColor,
            }}
            title={rateActive
              ? `Modulation rate: ${state.rateHz.toFixed(2)} Hz`
              : "Rate is parked in DICHOTIC mode — use SPREAD instead, or switch to AM / BOTH"}
            aria-label="Entrain rate"
          />
          <div className="entrain-ticks" aria-label="Landmark rates">
            {ENTRAIN_LANDMARKS.map((m) => {
              const pct = ((m.hz - ENTRAIN_MIN_HZ) / (ENTRAIN_MAX_HZ - ENTRAIN_MIN_HZ)) * 100;
              return (
                <button
                  key={m.hz}
                  type="button"
                  className={m.cultural ? "entrain-tick entrain-tick-cultural" : "entrain-tick"}
                  style={{ left: `${pct}%`, color: zoneColorForHz(m.hz) }}
                  onClick={() => setRate(m.hz)}
                  disabled={!rateActive}
                  title={m.title}
                >
                  <span className="entrain-tick-mark" />
                  <span className="entrain-tick-label">{m.label}</span>
                </button>
              );
            })}
          </div>
        </div>
        <span className="entrain-hz-readout" style={{ color: trackColor }}>
          {state.rateHz.toFixed(2)} Hz
        </span>
      </div>

      {!rateActive && (
        <div className="entrain-lock-line entrain-lock-line-inactive">
          rate parked — DICHOTIC mode is driven by SPREAD
        </div>
      )}
      {rateActive && lock.k === 0 && (
        <div className="entrain-lock-line">
          breathing stopped — FLICKER will free-run
        </div>
      )}

      <div className="entrain-mode-row">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            className={state.mode === m.id ? "entrain-mode-btn entrain-mode-btn-on" : "entrain-mode-btn"}
            onClick={() => setMode(m.id)}
            title={m.title}
          >
            {m.label}
          </button>
        ))}
      </div>

      {dichoticMode && (
        <div className="entrain-cents-row">
          <label className="entrain-cents-label" htmlFor="entrain-cents">SPREAD</label>
          <input
            id="entrain-cents"
            type="range"
            className="entrain-cents-slider"
            min={0}
            max={ENTRAIN_DICHOTIC_MAX_CENTS}
            step={0.5}
            value={state.dichoticCents}
            onChange={(e) => setCents(Number(e.currentTarget.value))}
            title={`Dichotic detune spread: ±${(state.dichoticCents / 2).toFixed(1)} ¢`}
            aria-label="Dichotic spread in cents"
          />
          <span className="entrain-cents-readout">±{(state.dichoticCents / 2).toFixed(1)} ¢</span>
        </div>
      )}

      {amActive && (
        <div className="entrain-cents-row">
          <label className="entrain-cents-label" htmlFor="entrain-amdepth">DEPTH</label>
          <input
            id="entrain-amdepth"
            type="range"
            className="entrain-cents-slider"
            min={ENTRAIN_AM_DEPTH_MIN}
            max={ENTRAIN_AM_DEPTH_MAX}
            step={0.05}
            value={amDepth}
            onChange={(e) => setAmDepth(Number(e.currentTarget.value))}
            title={`AM depth multiplier: ${amDepth.toFixed(2)}× preset baseline (1.00 = preset, lower = subtler, higher = pushes past safe baseline)`}
            aria-label="AM depth multiplier"
          />
          <span className="entrain-cents-readout">{amDepth.toFixed(2)}×</span>
        </div>
      )}

    </div>
  );
}
