/**
 * VisualizerPreview — compact, low-fps live preview of the current
 * MEDITATE visualizer, designed to live inside the DRONE surface.
 *
 * Reuses VISUALIZER_FNS so what you see here is what you get when
 * you expand to MEDITATE. Runs at 15 fps and at the analyser's
 * default fftSize (1024) — just enough motion to read as alive
 * without taxing the main render path.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { AudioEngine } from "../engine/AudioEngine";
import {
  VISUALIZER_FNS,
  VISUALIZER_GROUPS,
  VISUALIZER_LABELS,
  VISUALIZER_ORDER,
  resetVisualizerCaches,
  type AudioFrame,
  type PhaseClock,
  type Visualizer,
} from "./visualizers";
import { DropdownSelect } from "./DropdownSelect";

interface VisualizerPreviewProps {
  engine: AudioEngine | null;
  visualizer: Visualizer;
  /** Change the active visualizer from the inline selector. When
   *  omitted the tile reads as a plain display (no dropdown). */
  onChangeVisualizer?: (visualizer: Visualizer) => void;
  /** Tap/click on the canvas → expand to MEDITATE. */
  onOpen?: () => void;
  /** rAF cap. Defaults to 15 fps for this lightweight host. */
  fps?: number;
  /** Pause the rAF loop. Required while MEDITATE is open: many
   *  visualizers (illuminatedGlyphs, petroglyphs, etc.) keep a
   *  module-level offscreen canvas keyed on w×h. Two consumers at
   *  different sizes would thrash that singleton — recreating the
   *  offscreen every frame and wiping accumulated paint. */
  paused?: boolean;
}

export function VisualizerPreview({
  engine,
  visualizer,
  onChangeVisualizer,
  onOpen,
  fps = 15,
  paused = false,
}: VisualizerPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const visualizerRef = useRef(visualizer);
  // Set when the visualizer prop changes; the rAF tick consumes the
  // flag to clear the canvas + reset the transform before the new
  // draw fn paints. Without this the new visualizer inherits the
  // previous one's accumulated pixels and any stale ctx state
  // (alpha, lineWidth, transform, etc.), which reads as "broken".
  const dirtyRef = useRef(false);
  useEffect(() => {
    visualizerRef.current = visualizer;
    dirtyRef.current = true;
  }, [visualizer]);

  // Reset — bumping this counter re-mounts the rAF effect so the
  // phase clock, smoothing buffers, and canvas all start fresh.
  const [resetGen, setResetGen] = useState(0);
  const resetVisualizer = () => {
    resetVisualizerCaches();
    setResetGen((n) => n + 1);
  };

  const label = useMemo(() => VISUALIZER_LABELS[visualizer], [visualizer]);

  useEffect(() => {
    if (paused) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Wipe shared module-level state on (re)mount so the preview
    // never inherits a stale offscreen sized for MEDITATE (or
    // another visualizer). Same defensive reset MEDITATE does on
    // its mount — keeps the two consumers from carrying surprise
    // state across the paused/unpaused boundary.
    resetVisualizerCaches();

    let raf = 0;
    let lastNow = performance.now();
    let lastPaint = -Infinity;
    const FRAME_MS = 1000 / Math.max(1, fps);

    const analyser = engine?.getAnalyser() ?? null;
    const timeBuf = analyser ? new Uint8Array(analyser.fftSize) : null;
    const freqBuf = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;
    const rawSpectrum = new Float32Array(32);
    const spectrum = new Float32Array(32);
    const waveform = timeBuf ?? new Uint8Array(128);
    const frame: AudioFrame = { rms: 0, peak: 0, spectrum, waveform };
    const tmpPitchTarget = new Float32Array(12);

    let smoothedRms = 0;
    let smoothedPeak = 0;
    const phase: PhaseClock = {
      t: 0,
      slow: 0,
      hue: 30,
      growth: 0,
      pointer: null,
      pointerDown: false,
      mood: { hue: 30, warmth: 0.5, brightness: 0.5, density: 0.5 },
      activePitches: new Float32Array(12),
      voices: {
        tanpura: 0, reed: 0, metal: 0, air: 0,
        piano: 0, fm: 0, amp: 0, noise: 0,
      },
    };

    let activeT = 0;
    let activeGrowthT = 0;
    const SILENCE_RMS = 0.003;
    // Visibility easing — same shape as MeditateView so silent fades
    // feel identical between the inline preview and the expanded
    // overlay. Visualizers freeze at the last frame and the overlay
    // alpha eases toward black; resuming play eases back to the
    // accumulated state.
    let visibility = 0;
    const VIS_ATTACK = 0.012;
    const VIS_RELEASE = 0.018;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w === 0 || h === 0) return;
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    let specBuckets: Int32Array | null = null;
    const buildSpecBuckets = (fftBinCount: number, sampleRate: number) => {
      const lo = 30;
      const hi = Math.min(10000, sampleRate / 2 * 0.9);
      const logLo = Math.log(lo);
      const logHi = Math.log(hi);
      const binHz = sampleRate / (fftBinCount * 2);
      const table = new Int32Array(64);
      for (let b = 0; b < 32; b++) {
        const f0 = Math.exp(logLo + (logHi - logLo) * (b / 32));
        const f1 = Math.exp(logLo + (logHi - logLo) * ((b + 1) / 32));
        let i0 = Math.max(1, Math.floor(f0 / binHz));
        let i1 = Math.max(i0 + 1, Math.ceil(f1 / binHz));
        i0 = Math.min(fftBinCount - 1, i0);
        i1 = Math.min(fftBinCount, i1);
        table[b * 2] = i0;
        table[b * 2 + 1] = i1;
      }
      return table;
    };

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (document.hidden) return;
      if (now - lastPaint < FRAME_MS) return;
      lastPaint = now;
      const dtMs = Math.min(120, now - lastNow);
      lastNow = now;
      const dtScale = dtMs / 16.6667;
      const dtSec = dtMs / 1000;

      const playing = smoothedRms > SILENCE_RMS;
      if (playing) {
        activeT += dtSec;
        activeGrowthT += dtSec;
      }
      phase.t = activeT;
      phase.dtScale = dtScale;
      phase.slow = 0.5 + 0.5 * Math.sin(phase.t * (Math.PI * 2) / 60);
      phase.hue = (phase.mood.hue + phase.t * 2) % 360;
      const baseGrowth = 1 - Math.exp(-activeGrowthT / 60);
      const drift =
        0.02 * Math.sin(activeGrowthT / 40) +
        0.02 * Math.sin(activeGrowthT / 91) +
        0.02 * Math.cos(activeGrowthT / 173);
      phase.growth = Math.max(0, Math.min(1, baseGrowth + drift));

      if (engine) {
        const climateX = engine.getClimateX();
        const sub = engine.getSub();
        const air = engine.getAir();
        const layers = engine.getVoiceLayers();
        const activeLayers =
          (layers.tanpura ? 1 : 0) + (layers.reed ? 1 : 0) +
          (layers.metal ? 1 : 0) + (layers.air ? 1 : 0);
        const vs = phase.voices!;
        vs.tanpura = layers.tanpura ? engine.getVoiceLevel("tanpura") : 0;
        vs.reed    = layers.reed    ? engine.getVoiceLevel("reed")    : 0;
        vs.metal   = layers.metal   ? engine.getVoiceLevel("metal")   : 0;
        vs.air     = layers.air     ? engine.getVoiceLevel("air")     : 0;
        vs.piano   = layers.piano   ? engine.getVoiceLevel("piano")   : 0;
        vs.fm      = layers.fm      ? engine.getVoiceLevel("fm")      : 0;
        vs.amp     = layers.amp     ? engine.getVoiceLevel("amp")     : 0;
        vs.noise   = layers.noise   ? engine.getVoiceLevel("noise")   : 0;
        const targetHue = 340 - climateX * 70 - air * 30 + (1 - sub) * 20;
        const k = 1 - Math.pow(1 - 0.08, dtScale);
        phase.mood.hue = phase.mood.hue + ((targetHue + 360) % 360 - phase.mood.hue) * k;
        phase.mood.warmth = phase.mood.warmth + (climateX - phase.mood.warmth) * k;
        phase.mood.brightness = phase.mood.brightness + (climateX * (0.5 + air * 0.5) - phase.mood.brightness) * k;
        phase.mood.density = activeLayers / 4;

        const root = engine.getRootFreq();
        const intervals = engine.getIntervalsCents();
        const target = tmpPitchTarget;
        target.fill(0);
        if (root > 0 && intervals.length > 0) {
          for (let i = 0; i < intervals.length; i++) {
            const fundamentalHz = root * Math.pow(2, intervals[i] / 1200);
            const voiceWeight = Math.max(0.4, 1 - i * 0.08);
            for (let n = 1; n <= 8; n++) {
              const hz = fundamentalHz * n;
              if (hz > 8000) break;
              const midi = 12 * Math.log2(hz / 440) + 69;
              const pc = ((Math.round(midi) % 12) + 12) % 12;
              const weight = voiceWeight / n;
              if (target[pc] < weight) target[pc] = weight;
            }
          }
        }
        const ap = phase.activePitches;
        const attackK = 1 - Math.pow(1 - 0.22, dtScale);
        const releaseK = 1 - Math.pow(1 - 0.09, dtScale);
        for (let i = 0; i < 12; i++) {
          const k2 = target[i] > ap[i] ? attackK : releaseK;
          ap[i] += (target[i] - ap[i]) * k2;
        }
      }

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
        if (!specBuckets) {
          specBuckets = buildSpecBuckets(freqBuf.length, analyser.context.sampleRate);
        }
        for (let b = 0; b < 32; b++) {
          const i0 = specBuckets[b * 2];
          const i1 = specBuckets[b * 2 + 1];
          let s = 0;
          for (let i = i0; i < i1; i++) s += freqBuf[i];
          const width = Math.max(1, i1 - i0);
          rawSpectrum[b] = Math.min(1, (s / width) / 180);
        }
      }
      const rmsA = 1 - Math.pow(1 - 0.12, dtScale);
      smoothedRms += (rawRms - smoothedRms) * rmsA;
      if (rawPeak > smoothedPeak) {
        const a = 1 - Math.pow(1 - 0.35, dtScale);
        smoothedPeak += (rawPeak - smoothedPeak) * a;
      } else {
        const a = 1 - Math.pow(1 - 0.04, dtScale);
        smoothedPeak += (rawPeak - smoothedPeak) * a;
      }
      const specA = 1 - Math.pow(1 - 0.18, dtScale);
      for (let b = 0; b < 32; b++) {
        spectrum[b] += (rawSpectrum[b] - spectrum[b]) * specA;
      }
      frame.rms = smoothedRms;
      frame.peak = smoothedPeak;

      const cssW = canvas.clientWidth;
      const cssH = canvas.clientHeight;
      if (cssW === 0 || cssH === 0) return;

      if (dirtyRef.current) {
        dirtyRef.current = false;
        // Reset the ctx state and clear pixels so the new visualizer
        // starts clean. setTransform identity → clearRect raw buffer
        // → reapply the dpr scale that resize() established.
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }

      // Ease visibility toward 1 while playing, toward 0 when silent.
      const visTarget = playing ? 1 : 0;
      const visRate = playing ? VIS_ATTACK : VIS_RELEASE;
      visibility += (visTarget - visibility) * (1 - Math.pow(1 - visRate, dtScale));

      if (playing) {
        const draw = VISUALIZER_FNS[visualizerRef.current];
        draw(ctx, cssW, cssH, frame, phase);
      }

      // Overlay black at (1 - visibility) so the tile slowly fades
      // when music stops and emerges when it starts again.
      if (visibility < 0.999) {
        ctx.fillStyle = `rgba(0, 0, 0, ${1 - visibility})`;
        ctx.fillRect(0, 0, cssW, cssH);
      }
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [engine, fps, paused, resetGen]);

  const cyclePrev = () => {
    if (!onChangeVisualizer) return;
    const i = VISUALIZER_ORDER.indexOf(visualizer);
    onChangeVisualizer(VISUALIZER_ORDER[(i - 1 + VISUALIZER_ORDER.length) % VISUALIZER_ORDER.length]);
  };
  const cycleNext = () => {
    if (!onChangeVisualizer) return;
    const i = VISUALIZER_ORDER.indexOf(visualizer);
    onChangeVisualizer(VISUALIZER_ORDER[(i + 1) % VISUALIZER_ORDER.length]);
  };

  return (
    <div className="drone-visualizer-preview">
      <button
        type="button"
        className="drone-visualizer-preview-canvas-btn"
        onClick={onOpen}
        aria-label={`Open MEDITATE visualizer (${label})`}
      >
        <canvas ref={canvasRef} className="drone-visualizer-preview-canvas" />
      </button>
      <div className="drone-visualizer-preview-meta">
        <span className="drone-visualizer-preview-tag">MEDITATE</span>
        {onChangeVisualizer ? (
          <DropdownSelect<Visualizer>
            value={visualizer}
            groups={VISUALIZER_GROUPS.map((g) => ({
              label: g.label,
              items: g.items.map((v) => ({ value: v, label: VISUALIZER_LABELS[v] })),
            }))}
            onChange={onChangeVisualizer}
            className="drone-visualizer-preview-select"
            title="Choose visualizer"
            ariaLabel="Visualizer"
          />
        ) : (
          <span className="drone-visualizer-preview-name">{label}</span>
        )}
        <div className="drone-visualizer-preview-actions">
          {onChangeVisualizer && (
            <>
              <button
                type="button"
                className="drone-visualizer-preview-btn"
                onClick={cyclePrev}
                title="Previous visualizer"
                aria-label="Previous visualizer"
              >
                ◂
              </button>
              <button
                type="button"
                className="drone-visualizer-preview-btn"
                onClick={cycleNext}
                title="Next visualizer"
                aria-label="Next visualizer"
              >
                ▸
              </button>
            </>
          )}
          <button
            type="button"
            className="drone-visualizer-preview-btn"
            onClick={resetVisualizer}
            title="Reset visualizer state — clears accumulated paint and phase clock"
            aria-label="Reset visualizer"
          >
            ↻
          </button>
          <span className="drone-visualizer-preview-arrow" aria-hidden="true">↗</span>
        </div>
      </div>
    </div>
  );
}
