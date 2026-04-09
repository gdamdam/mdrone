/**
 * MeditateView — the third view. One big canvas running a chosen
 * visualizer in a rAF loop. Samples the master AnalyserNode each
 * frame for RMS, peak, and a tiny 32-bin spectrum. A slow phase
 * clock runs independently so the image breathes even in silence.
 *
 * Selecting a visualizer:
 *   - dropdown in the header strip
 *   - double-click anywhere on the canvas to cycle to the next one
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AudioEngine } from "../engine/AudioEngine";
import {
  VISUALIZER_FNS,
  VISUALIZER_LABELS,
  VISUALIZER_ORDER,
  type AudioFrame,
  type PhaseClock,
  type Visualizer,
} from "./visualizers";
import { clearDeityPreview } from "./deities";

interface MeditateViewProps {
  engine: AudioEngine | null;
  active: boolean; // true when meditate tab is visible
}

const STORAGE_KEY = "mdrone.meditate.visualizer";

export function MeditateView({ engine, active }: MeditateViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visualizer, setVisualizer] = useState<Visualizer>(() => {
    try {
      const v = localStorage.getItem(STORAGE_KEY) as Visualizer | null;
      if (v && VISUALIZER_ORDER.includes(v)) return v;
    } catch { /* ok */ }
    return "mandala";
  });

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, visualizer); } catch { /* ok */ }
  }, [visualizer]);

  const cycleVisualizer = useCallback(() => {
    setVisualizer((cur) => {
      const i = VISUALIZER_ORDER.indexOf(cur);
      return VISUALIZER_ORDER[(i + 1) % VISUALIZER_ORDER.length];
    });
  }, []);

  const wrapRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);
  const toggleFullscreen = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      el.requestFullscreen?.().catch(() => { /* ignore */ });
    } else {
      document.exitFullscreen?.().catch(() => { /* ignore */ });
    }
  }, []);

  // Clear the legacy deity preview stub whenever the visualizer
  // changes. Harmless no-op now that the deity cycle is gone.
  useEffect(() => {
    clearDeityPreview();
  }, [visualizer]);

  // rAF loop — only runs while visible
  const visualizerRef = useRef(visualizer);
  const phaseResetRef = useRef(0);
  useEffect(() => {
    visualizerRef.current = visualizer;
    // Reset the growth clock when switching visualizer so each one
    // starts from its simple state and unfolds from there.
    phaseResetRef.current = performance.now();
  }, [visualizer]);

  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    phaseResetRef.current = performance.now();
    let lastNow = phaseResetRef.current;
    const analyser = engine?.getAnalyser() ?? null;
    // Smooth the analyser output: enabling fftSmoothing on the node
    // itself is the cheapest one-pole LPF the browser can give us,
    // on top of our own exponential smoothing below. Values close
    // to 1 = smoother/slower; 0.82 is "felt but stable".
    if (analyser) {
      try { analyser.smoothingTimeConstant = 0.82; } catch { /* ok */ }
    }
    const timeBuf = analyser ? new Uint8Array(analyser.fftSize) : null;
    const freqBuf = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;
    const rawSpectrum = new Float32Array(32);
    const spectrum = new Float32Array(32); // smoothed copy handed to visualizers
    const frame: AudioFrame = { rms: 0, peak: 0, spectrum };
    // Persistent smoothing state — these accumulate across frames so
    // motion never jitters regardless of frame-rate hiccups.
    let smoothedRms = 0;
    let smoothedPeak = 0;
    // Peak uses fast attack, slow release so it feels organic.
    const RMS_ALPHA = 0.12;
    const PEAK_ATTACK = 0.35;
    const PEAK_RELEASE = 0.04;
    const SPECTRUM_ALPHA = 0.18;
    const phase: PhaseClock = {
      t: 0,
      slow: 0,
      hue: 30,
      growth: 0,
      pointer: null,
      pointerDown: false,
      mood: { hue: 30, warmth: 0.5, brightness: 0.5, density: 0.5 },
    };
    // Phase.t only advances when there is audible drone — visualizers
    // freeze in silence and resume from where they left off.
    let activeT = 0;
    // Growth clock is separate so it too pauses during silence.
    let activeGrowthT = 0;
    const SILENCE_RMS = 0.003;
    // Visibility easing — 0 when silent, 1 when playing. Separate
    // attack (fade-in ~2.5 s) and release (fade-out ~2 s) rates so
    // the visualizer slowly appears when the drone starts and gently
    // dissolves when it stops.
    let visibility = 0;
    const VIS_ATTACK = 0.012;
    const VIS_RELEASE = 0.018;

    // Pointer interactivity — track hover + press on the canvas.
    const onMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      phase.pointer = {
        x: (e.clientX - rect.left) / rect.width,
        y: (e.clientY - rect.top) / rect.height,
      };
    };
    const onLeave = () => { phase.pointer = null; phase.pointerDown = false; };
    const onDown = (e: PointerEvent) => { phase.pointerDown = true; onMove(e); };
    const onUp = () => { phase.pointerDown = false; };
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = parent.clientWidth;
      const h = parent.clientHeight;
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    if (canvas.parentElement) ro.observe(canvas.parentElement);

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      // Frame delta, clamped so huge stalls (tab switch) don't warp
      // the motion on resume.
      const dtMs = Math.min(80, now - lastNow);
      lastNow = now;
      const dtScale = dtMs / 16.6667; // 1.0 at 60 fps
      const dtSec = dtMs / 1000;

      // Active-time clocks only tick while there is audible drone.
      // When the drone is silent the visualizers freeze on their
      // current frame and resume exactly where they left off.
      const playing = smoothedRms > SILENCE_RMS;
      if (playing) {
        activeT += dtSec;
        activeGrowthT += dtSec;
      }
      phase.t = activeT;
      phase.slow = 0.5 + 0.5 * Math.sin(phase.t * (Math.PI * 2) / 60);
      // Hue anchor is pulled by the mood so the palette of every
      // visualizer shifts with the playing drone (dark presets drift
      // toward deep violet/red, bright presets toward amber).
      phase.hue = (phase.mood.hue + phase.t * 2) % 360;
      // Growth saturates near 1 but keeps breathing ±0.05 afterwards
      // via a long-period sine, so visualizers never fully "stop"
      // evolving — they keep getting small noticeable variations as
      // long as the drone plays. The sine uses three incommensurate
      // periods so the motion never exactly repeats.
      const baseGrowth = 1 - Math.exp(-activeGrowthT / 60);
      const drift =
        0.02 * Math.sin(activeGrowthT / 40) +
        0.02 * Math.sin(activeGrowthT / 91) +
        0.02 * Math.cos(activeGrowthT / 173);
      phase.growth = Math.max(0, Math.min(1, baseGrowth + drift));

      // Mood derived from engine macros. Remapped into hue/warmth/
      // brightness/density that visualizers can use to tint their
      // native palette.
      if (engine) {
        const climateX = engine.getClimateX();     // dark ↔ bright
        const sub = engine.getSub();               // 0..1
        const air = engine.getAir();               // 0..1
        const layers = engine.getVoiceLayers();
        const activeLayers =
          (layers.tanpura ? 1 : 0) + (layers.reed ? 1 : 0) +
          (layers.metal ? 1 : 0) + (layers.air ? 1 : 0);
        // Hue: dark/sub → deep red-violet (~340); bright/air → amber (~35)
        const targetHue = 340 - climateX * 70 - air * 30 + (1 - sub) * 20;
        // Smoothly approach the target so the palette drifts rather than snaps
        const k = 1 - Math.pow(1 - 0.08, dtScale);
        phase.mood.hue = phase.mood.hue + ((targetHue + 360) % 360 - phase.mood.hue) * k;
        phase.mood.warmth = phase.mood.warmth + (climateX - phase.mood.warmth) * k;
        phase.mood.brightness = phase.mood.brightness + (climateX * (0.5 + air * 0.5) - phase.mood.brightness) * k;
        phase.mood.density = activeLayers / 4;
      }

      // Compute raw audio features, then low-pass into smoothed
      // fields the visualizers actually read. Exponential filters
      // are adjusted by dtScale so smoothing is frame-rate independent.
      let rawRms = 0;
      let rawPeak = 0;
      if (analyser && timeBuf && freqBuf) {
        analyser.getByteTimeDomainData(timeBuf);
        let sum = 0;
        let peak = 0;
        for (let i = 0; i < timeBuf.length; i++) {
          const v = (timeBuf[i] - 128) / 128;
          const av = v < 0 ? -v : v;
          sum += v * v;
          if (av > peak) peak = av;
        }
        rawRms = Math.min(1, Math.sqrt(sum / timeBuf.length) * 2.5);
        rawPeak = Math.min(1, peak * 1.1);

        analyser.getByteFrequencyData(freqBuf);
        const bandW = Math.floor(freqBuf.length / 32);
        for (let b = 0; b < 32; b++) {
          let s = 0;
          for (let i = 0; i < bandW; i++) s += freqBuf[b * bandW + i];
          rawSpectrum[b] = Math.min(1, (s / bandW) / 200);
        }
      } else {
        for (let i = 0; i < 32; i++) rawSpectrum[i] = 0;
      }

      // Low-pass smoothing. dt-scaled α = 1 - (1 - base) ^ dtScale
      const rmsA = 1 - Math.pow(1 - RMS_ALPHA, dtScale);
      smoothedRms += (rawRms - smoothedRms) * rmsA;
      // Peak: fast attack, slow release
      if (rawPeak > smoothedPeak) {
        const a = 1 - Math.pow(1 - PEAK_ATTACK, dtScale);
        smoothedPeak += (rawPeak - smoothedPeak) * a;
      } else {
        const a = 1 - Math.pow(1 - PEAK_RELEASE, dtScale);
        smoothedPeak += (rawPeak - smoothedPeak) * a;
      }
      const specA = 1 - Math.pow(1 - SPECTRUM_ALPHA, dtScale);
      for (let b = 0; b < 32; b++) {
        spectrum[b] += (rawSpectrum[b] - spectrum[b]) * specA;
      }
      frame.rms = smoothedRms;
      frame.peak = smoothedPeak;

      const cssW = canvas.clientWidth;
      const cssH = canvas.clientHeight;

      // Ease visibility toward 1 while playing, toward 0 when silent.
      const visTarget = playing ? 1 : 0;
      const visRate = playing ? VIS_ATTACK : VIS_RELEASE;
      visibility += (visTarget - visibility) * (1 - Math.pow(1 - visRate, dtScale));

      // When music is on, run the visualizer as usual.
      if (playing) {
        const draw = VISUALIZER_FNS[visualizerRef.current];
        draw(ctx, cssW, cssH, frame, phase);
      }

      // Overlay black at (1 - visibility) so the scene slowly appears
      // when music starts and dissolves when it stops. At visibility
      // = 0 the canvas is fully black; at 1 it's untouched.
      if (visibility < 0.999) {
        ctx.fillStyle = `rgba(0, 0, 0, ${1 - visibility})`;
        ctx.fillRect(0, 0, cssW, cssH);
      }
    };
    lastNow = performance.now();
    tick(lastNow);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
    };
  }, [engine, active]);

  const label = useMemo(() => VISUALIZER_LABELS[visualizer], [visualizer]);

  return (
    <div className="meditate-view">
      <div className="meditate-toolbar">
        <span className="meditate-toolbar-label">VISUALIZER</span>
        <select
          value={visualizer}
          onChange={(e) => setVisualizer(e.target.value as Visualizer)}
          className="header-select"
          title="Choose visualizer — double-click the canvas to cycle"
        >
          {VISUALIZER_ORDER.map((v) => (
            <option key={v} value={v}>{VISUALIZER_LABELS[v]}</option>
          ))}
        </select>
        <button
          className="header-btn"
          onClick={toggleFullscreen}
          title={isFullscreen ? "Exit fullscreen (Esc)" : "Enter fullscreen"}
        >
          {isFullscreen ? "✕ EXIT" : "⛶ FULLSCREEN"}
        </button>
        <span className="meditate-toolbar-hint">· double-click to cycle ·</span>
      </div>
      {visualizer === "dreamMachine" && (
        <div className="meditate-warning">
          ⚠ DREAM MACHINE uses ~10 Hz flicker. Not recommended for anyone with
          photosensitive epilepsy. Classic usage: close your eyes and let the
          strobe light through your eyelids.
        </div>
      )}
      <div ref={wrapRef} className="meditate-canvas-wrap">
        <canvas
          ref={canvasRef}
          className="meditate-canvas"
          onDoubleClick={cycleVisualizer}
          title={`${label} · double-click to cycle`}
        />
      </div>
    </div>
  );
}
