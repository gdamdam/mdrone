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
  VISUALIZER_GROUPS,
  VISUALIZER_LABELS,
  VISUALIZER_ORDER,
  type AudioFrame,
  type PhaseClock,
  type Visualizer,
} from "./visualizers";
import { clearDeityPreview } from "./deities";
import { DropdownSelect } from "./DropdownSelect";

interface MeditateViewProps {
  engine: AudioEngine | null;
  active: boolean; // true when meditate tab is visible
  visualizer: Visualizer;
  onChangeVisualizer: (visualizer: Visualizer) => void;
  /** Called on single click or drag in fullscreen — the whole screen
   *  acts as a WEATHER XY pad. (x01, y01) is normalized 0..1.
   *  Layout maps it to climateX/climateY. */
  onFullscreenClick?: (x01: number, y01: number) => void;
  /** Called on double click in fullscreen — cycle to next visualizer. */
  onFullscreenDoubleClick?: () => void;
  /** Called on every pointermove while pointerdown in fullscreen
   *  (drag). Same XY mapping as click. */
  onFullscreenDrag?: (x01: number, y01: number) => void;
}

export function MeditateView({
  engine,
  active,
  visualizer,
  onChangeVisualizer,
  onFullscreenClick,
  onFullscreenDoubleClick,
  onFullscreenDrag,
}: MeditateViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Refs that carry the latest click / drag callbacks + fullscreen
  // state into the tick-loop closure without re-creating the loop.
  // The useEffect that mounts the rAF tick only runs once; if we
  // captured the props directly we'd stop seeing prop updates.
  const onFullscreenClickRef = useRef(onFullscreenClick);
  const onFullscreenDblClickRef = useRef(onFullscreenDoubleClick);
  const onFullscreenDragRef = useRef(onFullscreenDrag);
  const isFullscreenRef = useRef(false);
  useEffect(() => { onFullscreenClickRef.current = onFullscreenClick; }, [onFullscreenClick]);
  useEffect(() => { onFullscreenDblClickRef.current = onFullscreenDoubleClick; }, [onFullscreenDoubleClick]);
  useEffect(() => { onFullscreenDragRef.current = onFullscreenDrag; }, [onFullscreenDrag]);

  const cycleVisualizer = useCallback(() => {
    const i = VISUALIZER_ORDER.indexOf(visualizer);
    onChangeVisualizer(VISUALIZER_ORDER[(i + 1) % VISUALIZER_ORDER.length]);
  }, [onChangeVisualizer, visualizer]);

  const wrapRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => { isFullscreenRef.current = isFullscreen; }, [isFullscreen]);
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
    const waveform = timeBuf ?? new Uint8Array(128);
    const frame: AudioFrame = { rms: 0, peak: 0, spectrum, waveform };
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
      activePitches: new Float32Array(12),
    };
    // Scratch buffer the tick loop fills each frame with the
    // instantaneous pitch-class targets before smoothing them into
    // phase.activePitches. Hoisted out of tick to avoid allocation.
    const tmpPitchTarget = new Float32Array(12);

    // Log-scale FFT bucket table. The raw AnalyserNode spectrum is
    // linear in frequency, which wastes 27/32 reduced-bins on the
    // silent top half of the spectrum since drone content lives
    // almost entirely in the low and low-mid bands. We precompute a
    // table mapping each of the 32 visualizer bins to a range of
    // underlying fft bins spaced logarithmically from ~30 Hz to
    // ~10 kHz — 8 octaves, about 4 reduced bins per octave — so
    // the visualizer slots are densely populated across the range
    // where drones actually put energy.
    //
    // specBuckets[b] = [fftStart, fftEnd] inclusive-exclusive.
    // Built lazily on first tick because we need the analyser to
    // know its fftSize / sample rate.
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

    // Pointer interactivity — track hover + press on the canvas
    // AND distinguish a short click (which fires the fullscreen
    // click callback for cycle-preset) from a drag (which streams
    // normalized coords to the drag callback for tonic/octave).
    //
    // dragStart holds the pointerdown position + time; once the
    // pointer has moved more than DRAG_THRESHOLD_PX away the
    // interaction is latched as a drag and the short-click will
    // not fire on pointerup. During drag we call onFullscreenDrag
    // on every move. Both callbacks are gated on isFullscreenRef
    // so normal (non-fullscreen) interaction keeps the old
    // hover/press semantics untouched.
    const DRAG_THRESHOLD_PX = 10;
    let dragStart: { x: number; y: number } | null = null;
    let dragLatched = false;
    let lastClickTime = 0;
    const toXY = (localX: number, localY: number, rect: DOMRect) => {
      // X: left=0 (dark) right=1 (bright). Y: bottom=0 (still) top=1 (moving)
      const x01 = Math.max(0, Math.min(1, localX / rect.width));
      const y01 = Math.max(0, Math.min(1, 1 - localY / rect.height));
      return { x01, y01 };
    };
    const onMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const localX = e.clientX - rect.left;
      const localY = e.clientY - rect.top;
      phase.pointer = { x: localX / rect.width, y: localY / rect.height };

      if (dragStart && phase.pointerDown) {
        const dx = localX - dragStart.x;
        const dy = localY - dragStart.y;
        if (!dragLatched && (dx * dx + dy * dy) > DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) {
          dragLatched = true;
        }
        if (dragLatched && isFullscreenRef.current) {
          const { x01, y01 } = toXY(localX, localY, rect);
          onFullscreenDragRef.current?.(x01, y01);
        }
      }
    };
    const onLeave = () => {
      phase.pointer = null;
      phase.pointerDown = false;
      dragStart = null;
      dragLatched = false;
    };
    const onDown = (e: PointerEvent) => {
      phase.pointerDown = true;
      const rect = canvas.getBoundingClientRect();
      const localX = e.clientX - rect.left;
      const localY = e.clientY - rect.top;
      dragStart = { x: localX, y: localY };
      dragLatched = false;
      phase.pointer = { x: localX / rect.width, y: localY / rect.height };
    };
    const onUp = (e: PointerEvent) => {
      const wasClick = dragStart !== null && !dragLatched;
      phase.pointerDown = false;
      dragStart = null;
      dragLatched = false;
      if (!wasClick || !isFullscreenRef.current) return;

      const now = Date.now();
      if (now - lastClickTime < 350) {
        // Double click → cycle visualizer
        lastClickTime = 0;
        onFullscreenDblClickRef.current?.();
      } else {
        // Single click → set weather XY from position
        lastClickTime = now;
        const rect = canvas.getBoundingClientRect();
        const { x01, y01 } = toXY(e.clientX - rect.left, e.clientY - rect.top, rect);
        onFullscreenClickRef.current?.(x01, y01);
      }
    };
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

        // Ground-truth pitch-class energies for the pitch mandala.
        // For each sounding voice we accumulate 8 harmonics with a
        // 1/n natural rolloff — real drones aren't just fundamentals,
        // their upper partials spray energy across many pitch classes
        // (a single D fundamental audibly produces D, A, F#, C via
        // partials 1-8). This turns the mandala from a static "3
        // notes lit" readout into a rich, multi-sector display that
        // still reflects what the instrument is truly playing.
        //
        // Smoothing is asymmetric: slow release on a darkening class
        // (so preset switches don't flicker) but near-instant attack
        // on a brightening class (so new pitches light immediately).
        const root = engine.getRootFreq();
        const intervals = engine.getIntervalsCents();
        const target = tmpPitchTarget;
        target.fill(0);
        if (root > 0 && intervals.length > 0) {
          for (let i = 0; i < intervals.length; i++) {
            const fundamentalHz = root * Math.pow(2, intervals[i] / 1200);
            // Later voices in the stack are slightly quieter so the
            // root voice dominates the visual.
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
          const k = target[i] > ap[i] ? attackK : releaseK;
          ap[i] += (target[i] - ap[i]) * k;
        }
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
        if (!specBuckets) {
          specBuckets = buildSpecBuckets(freqBuf.length, analyser.context.sampleRate);
        }
        for (let b = 0; b < 32; b++) {
          const i0 = specBuckets[b * 2];
          const i1 = specBuckets[b * 2 + 1];
          let s = 0;
          for (let i = i0; i < i1; i++) s += freqBuf[i];
          const width = Math.max(1, i1 - i0);
          // Divisor 180 (was 200) gives a tiny boost that matches
          // the log bucketing's slightly lower per-bin average.
          rawSpectrum[b] = Math.min(1, (s / width) / 180);
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
        <DropdownSelect<Visualizer>
          value={visualizer}
          groups={VISUALIZER_GROUPS.map((g) => ({
            label: g.label,
            items: g.items.map((v) => ({ value: v, label: VISUALIZER_LABELS[v] })),
          }))}
          onChange={onChangeVisualizer}
          className="header-select"
          title="Choose visualizer — double-click the canvas to cycle"
          ariaLabel="Visualizer"
        />
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
