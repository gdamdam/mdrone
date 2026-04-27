/**
 * MeditateView — expanded performance layer over DRONE. One big canvas
 * running a chosen visualizer in a rAF loop with a floating HUD that
 * auto-fades when idle.
 *
 * Interaction model:
 *   - the canvas IS an expanded WEATHER pad. Single-click + drag both
 *     write climateX/climateY.
 *   - double-click cycles to the next visualizer (also reachable from
 *     the HUD ▸ button so the affordance is discoverable).
 *
 * The HUD lives inside the fullscreen target so it follows the canvas
 * into and out of fullscreen. It dims to a quiet idle state after 2.5s
 * of no pointer movement, restoring on hover/focus.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AudioEngine } from "../engine/AudioEngine";
import {
  VISUALIZER_FNS,
  VISUALIZER_LABELS,
  VISUALIZER_ORDER,
  resetVisualizerCaches,
  type AudioFrame,
  type PhaseClock,
  type Visualizer,
} from "./visualizers";
import { clearDeityPreview } from "./deities";

interface MeditateViewProps {
  engine: AudioEngine | null;
  active: boolean; // true when meditate tab is visible
  /** Low-power mode (Settings → SESSION). Hard-clamps the rAF loop
   *  to ~15 fps and disables the adaptive throttle's promotion
   *  arm — pure CPU saving for weaker hardware. */
  lowPowerMode?: boolean;
  visualizer: Visualizer;
  onChangeVisualizer: (visualizer: Visualizer) => void;
  /** Single click or drag on the canvas — the whole surface acts as
   *  an expanded WEATHER XY pad. (x01, y01) is normalized 0..1. */
  onWeather?: (x01: number, y01: number) => void;
  /** Close the overlay and return to DRONE. Rendered in the HUD as
   *  an explicit affordance (idiomatic Esc / header-toggle remain). */
  onClose?: () => void;
  /** Optional random-scene trigger. When provided the HUD grows a
   *  🎲 button that loads a gentle variation of a random preset —
   *  same behaviour as the header dice. */
  onRandomScene?: () => void;
  /** Bubble pop-out state up so Layout can keep the MEDITATE overlay
   *  composited while DRONE is active — otherwise the captured canvas
   *  stream goes stale. */
  onPopOutChange?: (isPopOut: boolean) => void;
}

const HUD_IDLE_MS = 2500;

export function MeditateView({
  engine,
  active,
  lowPowerMode = false,
  visualizer,
  onChangeVisualizer,
  onWeather,
  onClose,
  onRandomScene,
  onPopOutChange,
}: MeditateViewProps) {
  // Carry the latest low-power flag into the rAF closure without
  // re-mounting the loop on every toggle.
  const lowPowerRef = useRef(lowPowerMode);
  useEffect(() => { lowPowerRef.current = lowPowerMode; }, [lowPowerMode]);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Refs that carry the latest weather callback into the tick-loop
  // closure without re-creating the loop.
  const onWeatherRef = useRef(onWeather);
  useEffect(() => { onWeatherRef.current = onWeather; }, [onWeather]);

  const cycleVisualizerNext = useCallback(() => {
    const i = VISUALIZER_ORDER.indexOf(visualizer);
    onChangeVisualizer(VISUALIZER_ORDER[(i + 1) % VISUALIZER_ORDER.length]);
  }, [onChangeVisualizer, visualizer]);
  const cycleVisualizerPrev = useCallback(() => {
    const i = VISUALIZER_ORDER.indexOf(visualizer);
    const prev = (i - 1 + VISUALIZER_ORDER.length) % VISUALIZER_ORDER.length;
    onChangeVisualizer(VISUALIZER_ORDER[prev]);
  }, [onChangeVisualizer, visualizer]);

  // Reset — bumping this counter re-mounts the rAF effect so the
  // phase clock, smoothing buffers, and canvas all start fresh from
  // the visualizer's simple state. Useful when an accumulating
  // visualizer drifts into a busy/saturated state.
  const [resetGen, setResetGen] = useState(0);
  const resetVisualizer = useCallback(() => {
    // Wipe shared module-level state (offscreen canvases, live
    // overlay arrays, persistent scalars) so the visualizer rebuilds
    // from its first-paint state. Then bump resetGen to remount the
    // rAF effect — clears phase clock, smoothing buffers, transform.
    resetVisualizerCaches();
    setResetGen((n) => n + 1);
  }, []);

  const wrapRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Pop-out window — opens a same-origin browser popup (drag it to
  // monitor 2, then click ⛶ FULLSCREEN inside it for true second-
  // monitor immersion). The source canvas stays in this React tree
  // (no re-parenting → ctx + rAF loop survive); the popup just
  // renders a <video> mirroring `canvas.captureStream(30)`.
  const popWinRef = useRef<Window | null>(null);
  const popStreamRef = useRef<MediaStream | null>(null);
  const popPollRef = useRef<number | null>(null);
  const popWakeLockRef = useRef<WakeLockSentinel | null>(null);
  const [isPopOut, setIsPopOut] = useState(false);
  const onPopOutChangeRef = useRef(onPopOutChange);
  useEffect(() => { onPopOutChangeRef.current = onPopOutChange; }, [onPopOutChange]);
  useEffect(() => { onPopOutChangeRef.current?.(isPopOut); }, [isPopOut]);
  const closePopOut = useCallback(() => {
    if (popPollRef.current !== null) {
      window.clearInterval(popPollRef.current);
      popPollRef.current = null;
    }
    popStreamRef.current?.getTracks().forEach((t) => t.stop());
    popStreamRef.current = null;
    if (popWinRef.current && !popWinRef.current.closed) popWinRef.current.close();
    popWinRef.current = null;
    popWakeLockRef.current?.release().catch(() => { /* ok */ });
    popWakeLockRef.current = null;
    setIsPopOut(false);
  }, []);
  const togglePopOut = useCallback(() => {
    if (popWinRef.current && !popWinRef.current.closed) {
      closePopOut();
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    const stream = (canvas as HTMLCanvasElement & {
      captureStream?: (fps?: number) => MediaStream;
    }).captureStream?.(30);
    if (!stream) return;

    const pop = window.open("", "mdrone-meditate", "popup,width=1024,height=1024");
    if (!pop) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    popWinRef.current = pop;
    popStreamRef.current = stream;

    const doc = pop.document;
    doc.title = "mdrone · visualizer";
    const style = doc.createElement("style");
    style.textContent =
      "html,body{margin:0;padding:0;height:100%;background:#000;overflow:hidden;cursor:none}" +
      "video{width:100vw;height:100vh;object-fit:contain;background:#000;display:block}" +
      ".pop-fs-btn{position:fixed;top:10px;right:10px;background:rgba(0,0,0,0.55);color:#cfc;" +
      "border:1px solid rgba(200,255,200,0.4);font:11px/1 ui-monospace,monospace;" +
      "padding:8px 12px;letter-spacing:1px;cursor:pointer;opacity:0;transition:opacity 0.25s;" +
      "border-radius:3px;z-index:10}" +
      "body:hover .pop-fs-btn{opacity:0.9}";
    doc.head.appendChild(style);

    const video = doc.createElement("video");
    video.autoplay = true;
    video.muted = true;
    (video as HTMLVideoElement & { playsInline?: boolean }).playsInline = true;
    video.srcObject = stream;
    doc.body.appendChild(video);

    const fsBtn = doc.createElement("button");
    fsBtn.className = "pop-fs-btn";
    fsBtn.textContent = "⛶ FULLSCREEN";
    const goFs = () => {
      const el = doc.documentElement as HTMLElement & {
        webkitRequestFullscreen?: () => Promise<void> | void;
      };
      const req = el.requestFullscreen?.bind(el) ?? el.webkitRequestFullscreen?.bind(el);
      try { Promise.resolve(req?.()).catch(() => { /* ignore */ }); }
      catch { /* ignore */ }
    };
    fsBtn.addEventListener("click", goFs);
    doc.body.appendChild(fsBtn);

    popPollRef.current = window.setInterval(() => {
      if (popWinRef.current?.closed) closePopOut();
    }, 500);

    type WakeLockNav = Navigator & {
      wakeLock?: { request: (t: "screen") => Promise<WakeLockSentinel> };
    };
    const wakeLockNav = navigator as WakeLockNav;
    if (wakeLockNav.wakeLock?.request) {
      wakeLockNav.wakeLock
        .request("screen")
        .then((sentinel) => { popWakeLockRef.current = sentinel; })
        .catch(() => { /* denied / unsupported — ok */ });
    }

    setIsPopOut(true);
  }, [closePopOut]);
  useEffect(() => {
    return () => { closePopOut(); };
  }, [closePopOut]);
  useEffect(() => {
    const onFsChange = () => {
      const docAny = document as Document & {
        webkitFullscreenElement?: Element | null;
        msFullscreenElement?: Element | null;
      };
      setIsFullscreen(!!(
        document.fullscreenElement ||
        docAny.webkitFullscreenElement ||
        docAny.msFullscreenElement
      ));
    };
    document.addEventListener("fullscreenchange", onFsChange);
    document.addEventListener("webkitfullscreenchange", onFsChange);
    document.addEventListener("MSFullscreenChange", onFsChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFsChange);
      document.removeEventListener("webkitfullscreenchange", onFsChange);
      document.removeEventListener("MSFullscreenChange", onFsChange);
    };
  }, []);
  const toggleFullscreen = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const elAny = el as HTMLDivElement & {
      webkitRequestFullscreen?: () => Promise<void> | void;
      msRequestFullscreen?: () => Promise<void> | void;
    };
    const docAny = document as Document & {
      webkitFullscreenElement?: Element | null;
      msFullscreenElement?: Element | null;
      webkitExitFullscreen?: () => Promise<void> | void;
      msExitFullscreen?: () => Promise<void> | void;
    };
    const isFs = !!(
      document.fullscreenElement ||
      docAny.webkitFullscreenElement ||
      docAny.msFullscreenElement
    );
    if (!isFs) {
      const req =
        el.requestFullscreen?.bind(el) ??
        elAny.webkitRequestFullscreen?.bind(el) ??
        elAny.msRequestFullscreen?.bind(el);
      try { Promise.resolve(req?.()).catch(() => { /* ignore */ }); }
      catch { /* ignore */ }
    } else {
      const exit =
        document.exitFullscreen?.bind(document) ??
        docAny.webkitExitFullscreen?.bind(document) ??
        docAny.msExitFullscreen?.bind(document);
      try { Promise.resolve(exit?.()).catch(() => { /* ignore */ }); }
      catch { /* ignore */ }
    }
  }, []);

  // Idle-fade for the HUD. Pointer movement anywhere inside the wrap
  // (or pointer entering the HUD itself) wakes the chrome; after
  // HUD_IDLE_MS of no movement it dims back. The HUD is also held
  // awake while a dropdown is open or any HUD button has focus.
  const [hudIdle, setHudIdle] = useState(false);
  const hudHeldRef = useRef(false);
  useEffect(() => {
    // HUD lives inside the overlay — when MEDITATE is hidden the
    // HUD's visibility is irrelevant, so we just skip the timer.
    if (!active) return;
    const wrap = wrapRef.current;
    if (!wrap) return;
    let timer: number | null = null;
    const wake = () => {
      setHudIdle(false);
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (!hudHeldRef.current) setHudIdle(true);
      }, HUD_IDLE_MS);
    };
    wake();
    wrap.addEventListener("pointermove", wake);
    wrap.addEventListener("pointerdown", wake);
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      wrap.removeEventListener("pointermove", wake);
      wrap.removeEventListener("pointerdown", wake);
    };
  }, [active]);

  // Clear the legacy deity preview stub whenever the visualizer
  // changes. Harmless no-op now that the deity cycle is gone.
  useEffect(() => {
    clearDeityPreview();
  }, [visualizer]);

  // rAF loop — runs while visible OR a pop-out window is mirroring
  // the canvas to a detached window.
  const visualizerRef = useRef(visualizer);
  const phaseResetRef = useRef(0);
  useEffect(() => {
    visualizerRef.current = visualizer;
    phaseResetRef.current = performance.now();
  }, [visualizer]);

  useEffect(() => {
    if (!active && !isPopOut) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Wipe shared module-level state so every MEDITATE mount starts
    // clean. Without this, an offscreen accumulator left at the
    // preview's small size (or another visualizer's accumulated
    // strokes) can interleave with the new draws and read as
    // out-of-order layers — e.g. illuminatedGlyphs showing halos
    // beneath the rune layer because the offscreen wasn't sized to
    // match the main canvas yet.
    resetVisualizerCaches();

    let raf = 0;
    phaseResetRef.current = performance.now();
    let lastNow = phaseResetRef.current;
    const analyser = engine?.getAnalyser() ?? null;
    const prevFftSize = analyser?.fftSize ?? 1024;
    if (analyser) {
      try { analyser.fftSize = 2048; } catch { /* ok */ }
      try { analyser.smoothingTimeConstant = 0.82; } catch { /* ok */ }
    }
    const timeBuf = analyser ? new Uint8Array(analyser.fftSize) : null;
    const freqBuf = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;
    const rawSpectrum = new Float32Array(32);
    const spectrum = new Float32Array(32);
    const waveform = timeBuf ?? new Uint8Array(128);
    const frame: AudioFrame = { rms: 0, peak: 0, spectrum, waveform };
    let smoothedRms = 0;
    let smoothedPeak = 0;
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
      voices: {
        tanpura: 0, reed: 0, metal: 0, air: 0,
        piano: 0, fm: 0, amp: 0, noise: 0,
      },
    };
    const tmpPitchTarget = new Float32Array(12);

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
    let activeT = 0;
    let activeGrowthT = 0;
    const SILENCE_RMS = 0.003;
    let visibility = 0;
    const VIS_ATTACK = 0.012;
    const VIS_RELEASE = 0.018;

    // Pointer interactivity — the canvas is an expanded WEATHER pad.
    // Single short click writes climateXY at the click position; a
    // drag streams climateXY continuously. Double-click cycles the
    // visualizer (also exposed as a HUD button so it's discoverable).
    const DRAG_THRESHOLD_PX = 10;
    let dragStart: { x: number; y: number } | null = null;
    let dragLatched = false;
    const toXY = (localX: number, localY: number, rect: DOMRect) => {
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
        if (dragLatched) {
          const { x01, y01 } = toXY(localX, localY, rect);
          onWeatherRef.current?.(x01, y01);
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
      if (!wasClick) return;

      // Single click → set weather XY from position. Visualizer
      // cycling has moved to the HUD ◂ ▸ buttons; the canvas is now
      // a pure WEATHER pad.
      const rect = canvas.getBoundingClientRect();
      const { x01, y01 } = toXY(e.clientX - rect.left, e.clientY - rect.top, rect);
      onWeatherRef.current?.(x01, y01);
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

    let lastPaint = -Infinity;
    // Adaptive frame budget — starts at 30 fps. If draw() consistently
    // overruns ~85% of the budget we step down (30 → 20 → 15 → 10 fps);
    // if it stays comfortably under ~40% we step back up. Low-power
    // mode is a hard clamp at 15 fps with no promotion.
    const FPS_TIERS = [30, 20, 15, 10];
    let fpsTierIdx = 0;
    let FRAME_MS = 1000 / FPS_TIERS[fpsTierIdx];
    let drawEma = 0;
    let frameCount = 0;
    let slowCount = 0;
    const applyLowPowerClamp = () => {
      if (lowPowerRef.current) {
        const tier = FPS_TIERS.indexOf(15);
        if (fpsTierIdx < tier) fpsTierIdx = tier;
        FRAME_MS = 1000 / FPS_TIERS[fpsTierIdx];
      }
    };
    applyLowPowerClamp();

    const tick = (now: number) => {
      if (document.hidden && !isPopOut) return;
      applyLowPowerClamp();
      if (now - lastPaint < FRAME_MS) return;
      lastPaint = now;
      const dtMs = Math.min(80, now - lastNow);
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
          const k = target[i] > ap[i] ? attackK : releaseK;
          ap[i] += (target[i] - ap[i]) * k;
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
      } else {
        for (let i = 0; i < 32; i++) rawSpectrum[i] = 0;
      }

      const rmsA = 1 - Math.pow(1 - RMS_ALPHA, dtScale);
      smoothedRms += (rawRms - smoothedRms) * rmsA;
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

      const visTarget = playing ? 1 : 0;
      const visRate = playing ? VIS_ATTACK : VIS_RELEASE;
      visibility += (visTarget - visibility) * (1 - Math.pow(1 - visRate, dtScale));

      let drawMs = 0;
      if (playing) {
        const draw = VISUALIZER_FNS[visualizerRef.current];
        const drawStart = performance.now();
        draw(ctx, cssW, cssH, frame, phase);
        drawMs = performance.now() - drawStart;
      }

      if (visibility < 0.999) {
        ctx.fillStyle = `rgba(0, 0, 0, ${1 - visibility})`;
        ctx.fillRect(0, 0, cssW, cssH);
      }

      // Adaptive throttle — only when not low-power (low-power is a
      // hard floor). Sample 60 frames; demote if 30+ overran 85% of
      // the budget; promote if EMA stays under 40% of the budget.
      if (!lowPowerRef.current && playing) {
        drawEma = drawEma === 0 ? drawMs : drawEma * 0.9 + drawMs * 0.1;
        frameCount++;
        if (drawMs > FRAME_MS * 0.85) slowCount++;
        if (frameCount >= 60) {
          if (slowCount >= 30 && fpsTierIdx < FPS_TIERS.length - 1) {
            fpsTierIdx++;
            FRAME_MS = 1000 / FPS_TIERS[fpsTierIdx];
          } else if (drawEma < FRAME_MS * 0.4 && fpsTierIdx > 0) {
            fpsTierIdx--;
            FRAME_MS = 1000 / FPS_TIERS[fpsTierIdx];
          }
          frameCount = 0;
          slowCount = 0;
        }
      }
    };
    lastNow = performance.now();
    const rafTick = (now: number) => {
      raf = requestAnimationFrame(rafTick);
      tick(now);
    };
    raf = requestAnimationFrame(rafTick);

    let popTickInterval: number | null = null;
    if (isPopOut) {
      popTickInterval = window.setInterval(() => tick(performance.now()), FRAME_MS);
    }

    return () => {
      cancelAnimationFrame(raf);
      if (popTickInterval !== null) window.clearInterval(popTickInterval);
      if (analyser) {
        try { analyser.fftSize = prevFftSize; } catch { /* ok */ }
      }
      ro.disconnect();
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
    };
  }, [engine, active, isPopOut, resetGen]);

  const label = useMemo(() => VISUALIZER_LABELS[visualizer], [visualizer]);
  const hudClass = `meditate-hud${hudIdle ? " meditate-hud-idle" : ""}`;

  return (
    <div className="meditate-view">
      <div ref={wrapRef} className="meditate-canvas-wrap">
        <canvas
          ref={canvasRef}
          className="meditate-canvas"
          title={label}
        />
        {visualizer === "dreamMachine" && (
          <div className="meditate-warning" role="note">
            ⚠ DREAM MACHINE uses ~10 Hz flicker — close your eyes if photosensitive.
          </div>
        )}
        <div
          className={hudClass}
          onPointerEnter={() => { hudHeldRef.current = true; setHudIdle(false); }}
          onPointerLeave={() => { hudHeldRef.current = false; }}
          onFocusCapture={() => { hudHeldRef.current = true; setHudIdle(false); }}
          onBlurCapture={() => { hudHeldRef.current = false; }}
        >
          <span className="meditate-hud-name" aria-live="polite">{label}</span>
          <button
            type="button"
            className="meditate-hud-btn"
            onClick={cycleVisualizerPrev}
            title="Previous visualizer"
            aria-label="Previous visualizer"
          >
            ◂
          </button>
          <button
            type="button"
            className="meditate-hud-btn"
            onClick={cycleVisualizerNext}
            title="Next visualizer"
            aria-label="Next visualizer"
          >
            ▸
          </button>
          <button
            type="button"
            className="meditate-hud-btn"
            onClick={resetVisualizer}
            title="Reset visualizer state — clears accumulated paint and phase clock"
            aria-label="Reset visualizer"
          >
            ↻
          </button>
          {onRandomScene && (
            <button
              type="button"
              className="meditate-hud-btn"
              onClick={onRandomScene}
              title="Load a gentle variation of a random scene"
              aria-label="Random scene"
            >
              🎲
            </button>
          )}
          <button
            type="button"
            className="meditate-hud-btn"
            onClick={toggleFullscreen}
            title={isFullscreen ? "Exit fullscreen (Esc)" : "Enter fullscreen"}
            aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          >
            {isFullscreen ? "⤢" : "⛶"}
          </button>
          <button
            type="button"
            className="meditate-hud-btn"
            onClick={togglePopOut}
            title={isPopOut ? "Close pop-out window" : "Open visualizer in a separate window"}
            aria-label={isPopOut ? "Close pop-out" : "Pop out"}
          >
            {isPopOut ? "↙" : "↗"}
          </button>
          {onClose && (
            <button
              type="button"
              className="meditate-hud-btn meditate-hud-close"
              onClick={onClose}
              title="Back to DRONE (Esc)"
              aria-label="Close meditate"
            >
              ✕
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
