/**
 * AudioEngine — high-level coordinator for the drone instrument.
 *
 * Voice graph, motion/macros, master bus, and recording now live in
 * dedicated modules so this class mainly wires them together and
 * preserves the public API used by the UI/persistence layers.
 */

import { AudioLoadMonitor } from "./AudioLoadMonitor";
import {
  AdaptiveStabilityEngine,
  type AdaptiveStabilityState,
} from "./AdaptiveStabilityEngine";
import { LiveSafeMode, type LiveSafeState } from "./LiveSafeMode";
import { FxChain } from "./FxChain";
import type { EffectId } from "./FxChain";
import type { EngineSceneMutation } from "./EngineSceneMutation";
import { MasterBus } from "./MasterBus";
import { MasterRecorder, type RecordingSupport, type MasterRecorderStartOptions } from "./MasterRecorder";
import { LoopBouncer, type BounceOptions, type BounceResult } from "./LoopBouncer";
import { MotionEngine } from "./MotionEngine";
import { VoiceEngine } from "./VoiceEngine";
import type { VoiceType } from "./VoiceBuilder";
import type { PresetMaterialProfile, PresetMotionProfile } from "./presets";
import droneWorkletUrl from "./droneVoiceProcessor.js?url";
import fxWorkletUrl from "./fxChainProcessor.js?url";
import { showNotification } from "../notifications";
import { readAudioDebugFlags } from "./audioDebug";
import { setTraceContext, trace, wireTraceToLoadMonitor } from "./audioTrace";

export type { EngineSceneMutation } from "./EngineSceneMutation";

export class AudioEngine {
  ctx: AudioContext;

  private readonly fxChain: FxChain;
  private readonly wetSend: GainNode;
  private readonly presetTrim: GainNode;
  private readonly voiceEngine: VoiceEngine;
  private readonly motionEngine: MotionEngine;
  private readonly masterBus: MasterBus;
  private readonly masterRecorder: MasterRecorder;
  private readonly loopBouncer: LoopBouncer;
  private readonly loadMonitor: AudioLoadMonitor;
  private readonly adaptiveStability: AdaptiveStabilityEngine;
  private readonly liveSafe: LiveSafeMode;
  private isWorkletReady = false;
  private pendingStart: { freq: number; intervalsCents: number[] } | null = null;

  constructor() {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) {
      // Very old Safari / pre-Chromium Edge / sandboxed iframes can land
      // here. Surface a clear message instead of crashing with
      // "AC is not a constructor" deep in the stack.
      showNotification(
        "Your browser doesn't support Web Audio. Try a recent version of Chrome, Firefox, or Safari.",
        "error",
      );
      throw new Error("Web Audio API unavailable");
    }
    // Let the device pick its native rate. Forcing 44.1 kHz wasted headroom
    // on 48 k hardware and added unnecessary resampling aliasing.
    // latencyHint "balanced" — matches mpump's Safari-clean pattern.
    // Gives browsers a larger output buffer than the default/interactive,
    // preventing crackling under heavy effect chains. "interactive" was
    // tried and caused Safari + AirPods under-run hash. "playback" is
    // even larger but adds user-perceived latency on controls.
    this.ctx = new AC({ latencyHint: "balanced" });
    setTraceContext(this.ctx);
    trace("ctxCreate", {
      sampleRate: this.ctx.sampleRate,
      baseLatencyMs: Math.round((this.ctx.baseLatency ?? 0) * 1000),
      outputLatencyMs: Math.round((this.ctx.outputLatency ?? 0) * 1000),
      state: this.ctx.state,
    });
    this.ctx.addEventListener("statechange", () => {
      trace("ctxState", { state: this.ctx.state });
    });
    this.loadMonitor = new AudioLoadMonitor(this.ctx);
    wireTraceToLoadMonitor(this.loadMonitor);

    this.fxChain = new FxChain(this.ctx);
    this.wetSend = this.ctx.createGain();
    this.wetSend.gain.value = 1;

    this.presetTrim = this.ctx.createGain();
    this.presetTrim.gain.value = 1;

    this.voiceEngine = new VoiceEngine(this.ctx, this.fxChain, this.wetSend);
    this.voiceEngine.getFilterOutput().connect(this.presetTrim);
    const debugFlags = readAudioDebugFlags();
    const skipFx = debugFlags.has("no-fx");
    const skipMaster = debugFlags.has("no-master");
    if (!skipFx) {
      this.presetTrim.connect(this.fxChain.input);
    }
    // NOTE: fxChain.wetOut is intentionally unsourced (see FxChain.ts).
    // The parallel reverb bus drives dryOut directly; wetSend carries only
    // the air macro scaling path applied to reverb sends inside FxChain.

    this.motionEngine = new MotionEngine({
      ctx: this.ctx,
      fxChain: this.fxChain,
      droneFilter: this.voiceEngine.getFilterNode(),
      droneVoiceGain: this.voiceEngine.getVoiceGainNode(),
      setDroneFreq: (freq) => this.voiceEngine.setDroneFreq(freq),
      getDroneFreq: () => this.voiceEngine.getRootFreq(),
      isPlaying: () => this.voiceEngine.isPlaying(),
      setDrift: (v) => this.voiceEngine.setDrift(v),
      getDrift: () => this.voiceEngine.getDrift(),
      setSub: (v) => this.voiceEngine.setSub(v),
      getSub: () => this.voiceEngine.getSub(),
      setBloom: (v) => this.voiceEngine.setBloom(v),
      getBloom: () => this.voiceEngine.getBloom(),
    });

    this.masterBus = new MasterBus(this.ctx);
    if (skipMaster) {
      // Debug bypass: route whatever feeds the masterBus straight to
      // the context destination, skipping HPF/EQ/glue/drive/limiter/
      // width/analyser. Volume control is lost; keep system volume low.
      const dest = this.ctx.destination;
      if (skipFx) {
        this.presetTrim.connect(dest);
      } else {
        this.fxChain.dryOut.connect(dest);
        this.wetSend.connect(dest);
      }
    } else if (skipFx) {
      // FX chain skipped but master still engaged — route presetTrim
      // directly into masterBus input (masterGain).
      this.masterBus.connectInput(this.presetTrim);
    } else {
      this.masterBus.connectInput(this.fxChain.dryOut);
      this.masterBus.connectInput(this.wetSend);
    }

    this.masterRecorder = new MasterRecorder(this.ctx, this.masterBus.getAnalyser());
    this.loopBouncer = new LoopBouncer(this.ctx, this.masterBus.getAnalyser());

    // Adaptive stability — staged mitigation under sustained audio load.
    // The controller keeps its own runtime overlay; the engine composes
    // user intent and adaptive overlay before reporting effective state,
    // so saved scenes / share URLs / persisted settings stay clean.
    this.adaptiveStability = new AdaptiveStabilityEngine(this.loadMonitor, {
      setAdaptiveLowPower: (on) => this.setAdaptiveLowPower(on),
      getEffectStates: () => this.fxChain.getEffectStates(),
      setEffect: (id, on) => this.fxChain.setEffect(id, on),
      getMaxVoiceLayers: () => this.voiceEngine.getMaxVoiceLayers(),
      setMaxVoiceLayers: (n) => this.voiceEngine.setMaxVoiceLayers(n),
      notify: (msg, kind) => showNotification(msg, kind),
      now: () => performance.now(),
    });

    // LIVE SAFE — explicit user-initiated reliability mode. Persisted at
    // the Layout layer; the controller is the engine-side mechanism.
    this.liveSafe = new LiveSafeMode({
      setLiveSafeLowPower: (on) => this.setLiveSafeLowPower(on),
      getEffectStates: () => this.fxChain.getEffectStates(),
      setEffect: (id, on) => this.fxChain.setEffect(id, on),
      getMaxVoiceLayers: () => this.voiceEngine.getMaxVoiceLayers(),
      setMaxVoiceLayers: (n) => this.voiceEngine.setMaxVoiceLayers(n),
      notify: (msg, kind) => showNotification(msg, kind),
    });

    // Auto-resume after sleep/wake — browsers suspend the AudioContext
    // when the device sleeps or the tab is backgrounded for too long.
    // No event fires on the context itself, so we listen for the page
    // becoming visible again and nudge the context back to "running".
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && this.ctx.state === "suspended") {
        this.ctx.resume().catch(() => { /* user gesture may be needed */ });
      }
    });

    if (typeof this.ctx.audioWorklet === "undefined") {
      // AudioWorklet shipped in Chrome 66 / Firefox 76 / Safari 14.1.
      // Browsers older than that hit this path and would otherwise
      // throw a synchronous TypeError on .addModule that the Promise
      // .catch() below cannot catch — leaving the user with a dead
      // app and only a console error.
      showNotification(
        "This browser is too old for the audio engine (AudioWorklet required). Please upgrade to a recent Chrome, Firefox, or Safari.",
        "error",
      );
      return;
    }
    const voiceReady = this.ctx.audioWorklet.addModule(droneWorkletUrl);
    const fxReady = this.ctx.audioWorklet.addModule(fxWorkletUrl);
    Promise.all([voiceReady, fxReady])
      .then(() => {
        this.isWorkletReady = true;
        this.fxChain.onWorkletReady();
        this.masterBus.onWorkletReady();
        if (this.pendingStart) {
          const pending = this.pendingStart;
          this.pendingStart = null;
          this.startDrone(pending.freq, pending.intervalsCents);
        }
      })
      .catch((err) => {
        console.error("mdrone: worklet module(s) failed to load", err);
        // Audible failure — the instrument won't produce sound until
        // this resolves, and silent console logging guarantees the
        // user stares at a dead HOLD button wondering what's wrong.
        showNotification(
          "Audio engine failed to start. Some DSP features may be unavailable — try reloading the page.",
          "error",
        );
      });
  }

  /** Push the current interval stack to the granular worklets so
   *  their quantised-pitch mode stays aligned with the scene scale. */
  private syncGranularScale(): void {
    this.fxChain.setGranularScale(this.voiceEngine.getIntervalsCents());
  }

  startDrone(freq: number, intervalsCents: number[] = [0]): void {
    if (!this.isWorkletReady) {
      this.pendingStart = { freq, intervalsCents: [...intervalsCents] };
      return;
    }

    this.voiceEngine.startDrone(freq, intervalsCents, this.motionEngine.getAir());
    this.syncGranularScale();
  }

  stopDrone(): void {
    this.pendingStart = null;
    this.voiceEngine.stopDrone();
  }

  /**
   * Panic — MIDI-style emergency silence. Stops the drone and kills all
   * lingering effect tails (convolver impulse responses, delay buffers,
   * granular ring buffer, freeze worklet). Briefly ramps the output to
   * zero while the internal buffers are flushed, then ramps back up to
   * the user's previous volume. Total silence window: ~250 ms.
   */
  panic(): void {
    const now = this.ctx.currentTime;
    const outputTrim = this.masterBus.getOutputTrim();
    const previousGain = outputTrim.gain.value;

    // Ramp out fast
    outputTrim.gain.cancelScheduledValues(now);
    outputTrim.gain.setValueAtTime(previousGain, now);
    outputTrim.gain.linearRampToValueAtTime(0, now + 0.04);

    // Stop drone voices so nothing keeps feeding the effects chain
    this.voiceEngine.stopDrone();

    // Flush effect internal state (convolver buffers, worklet buffers)
    this.fxChain.panic();

    // Ramp back up after the flush settles
    outputTrim.gain.setValueAtTime(0, now + 0.24);
    outputTrim.gain.linearRampToValueAtTime(previousGain, now + 0.3);
  }

  setDroneFreq(freq: number): void {
    this.voiceEngine.setDroneFreq(freq);
    // Pitch-locked LFO divisions follow the root when it changes.
    this.motionEngine.notifyRootChanged();
  }

  setIntervals(intervalsCents: number[]): void {
    this.voiceEngine.setIntervals(intervalsCents);
    this.syncGranularScale();
  }

  /** Ground-truth reads used by the meditate-view pitch mandala to
   *  derive active pitch classes directly from the engine state
   *  instead of guessing from a coarse FFT. */
  getRootFreq(): number { return this.voiceEngine.getRootFreq(); }
  getIntervalsCents(): readonly number[] { return this.voiceEngine.getIntervalsCents(); }

  isPlaying(): boolean { return this.voiceEngine.isPlaying(); }

  resume(): Promise<void> {
    if (this.ctx.state === "suspended") return this.ctx.resume();
    return Promise.resolve();
  }

  getRecordingSupport(): RecordingSupport {
    return this.masterRecorder.getRecordingSupport();
  }

  async startMasterRecording(opts: MasterRecorderStartOptions = {}): Promise<void> {
    await this.masterRecorder.start(opts);
  }

  /** Stop the master recording and return the encoded WAV bytes plus
   *  the capture duration in ms. Caller handles filename + download. */
  async stopMasterRecording(): Promise<import("./MasterRecorder").MasterRecordingResult | null> {
    return this.masterRecorder.stop();
  }

  /** Discard a recording in progress without producing a WAV. */
  async cancelMasterRecording(): Promise<void> {
    await this.masterRecorder.cancel();
  }

  /** Subscribe to a one-shot long-recording memory warning. Returns
   *  an unsubscribe. The warning fires at most once per recording. */
  setMasterRecordingMemoryWarning(thresholdMs: number, listener: () => void): () => void {
    return this.masterRecorder.setMemoryWarning(thresholdMs, listener);
  }

  isRecording(): boolean { return this.masterRecorder.isRecording(); }
  /** Live elapsed / size accessors for record-button UI. Cheap reads. */
  recordingElapsedMs(): number { return this.masterRecorder.elapsedMs(); }
  recordingApproxBytes(): number { return this.masterRecorder.approxBytes(); }

  /** Bounce a seamless-loop WAV from the live master output. */
  async bounceLoop(opts: BounceOptions): Promise<BounceResult> {
    return this.loopBouncer.bounce(opts);
  }

  /** Abort an in-progress loop bounce (the pending promise rejects
   *  with BounceCancelledError). No-op if no bounce is running. */
  cancelBounceLoop(): void { this.loopBouncer.cancel(); }

  isBouncingLoop(): boolean { return this.loopBouncer.isBouncing(); }

  setVoiceLayer(type: VoiceType, on: boolean): void {
    this.voiceEngine.setVoiceLayer(type, on);
  }

  getVoiceLayer(type: VoiceType): boolean { return this.voiceEngine.getVoiceLayer(type); }
  getVoiceLayers(): Record<VoiceType, boolean> { return this.voiceEngine.getVoiceLayers(); }

  setVoiceLevel(type: VoiceType, level: number): void {
    this.voiceEngine.setVoiceLevel(type, level);
  }

  getVoiceLevel(type: VoiceType): number { return this.voiceEngine.getVoiceLevel(type); }

  applyVoiceState(
    layers: Record<VoiceType, boolean>,
    levels: Record<VoiceType, number>,
  ): void {
    this.voiceEngine.applyVoiceState(layers, levels);
  }

  applyDroneScene(
    layers: Record<VoiceType, boolean>,
    levels: Record<VoiceType, number>,
    intervalsCents: number[],
  ): void {
    this.voiceEngine.applyDroneScene(layers, levels, intervalsCents);
    this.syncGranularScale();
  }

  setVoiceType(type: VoiceType): void {
    this.voiceEngine.setVoiceType(type);
  }

  getVoiceType(): VoiceType { return this.voiceEngine.getVoiceType(); }

  setPresetMorph(v: number): void {
    const next = Math.max(0, Math.min(1, v));
    this.voiceEngine.setPresetMorph(next);
    this.motionEngine.setPresetMorph(next);
    this.fxChain.setMorph(next);
  }

  getPresetMorph(): number { return this.motionEngine.getPresetMorph(); }

  setPresetMotionProfile(profile: PresetMotionProfile | null): void {
    this.motionEngine.setPresetMotionProfile(profile);
  }

  setPresetMaterialProfile(profile: PresetMaterialProfile | null): void {
    this.voiceEngine.setPresetMaterialProfile(profile);
  }

  setEvolve(v: number): void {
    this.voiceEngine.setEvolveAmount(v);
    this.motionEngine.setEvolve(v);
  }

  getEvolve(): number { return this.motionEngine.getEvolve(); }

  subscribeSceneMutations(listener: (mutation: EngineSceneMutation) => void): () => void {
    return this.motionEngine.subscribeSceneMutations(listener);
  }

  setTanpuraPluckRate(v: number): void {
    this.voiceEngine.setTanpuraPluckRate(v);
  }

  getTanpuraPluckRate(): number { return this.voiceEngine.getTanpuraPluckRate(); }

  setNoiseColor(v: number): void {
    this.voiceEngine.setNoiseColor(v);
  }

  getNoiseColor(): number { return this.voiceEngine.getNoiseColor(); }

  setReedShape(shape: import("./VoiceBuilder").ReedShape): void {
    this.voiceEngine.setReedShape(shape);
  }

  getReedShape(): import("./VoiceBuilder").ReedShape { return this.voiceEngine.getReedShape(); }

  setFmRatio(ratio: number): void { this.voiceEngine.setFmRatio(ratio); }
  getFmRatio(): number { return this.voiceEngine.getFmRatio(); }
  setFmIndex(index: number): void { this.voiceEngine.setFmIndex(index); }
  getFmIndex(): number { return this.voiceEngine.getFmIndex(); }
  setFmFeedback(fb: number): void { this.voiceEngine.setFmFeedback(fb); }
  getFmFeedback(): number { return this.voiceEngine.getFmFeedback(); }

  setTanpuraTuning(id: import("./VoiceBuilder").TanpuraTuningId): void {
    this.voiceEngine.setTanpuraTuning(id);
  }
  getTanpuraTuning(): import("./VoiceBuilder").TanpuraTuningId {
    return this.voiceEngine.getTanpuraTuning();
  }

  /** Maximum active voice layers. On mobile / low-core devices the
   *  default is auto-capped at 4; desktop defaults to 7 (all voices).
   *  See VoiceEngine.detectMaxVoiceLayers. P3 — auto-degrader. */
  setMaxVoiceLayers(n: number): void { this.voiceEngine.setMaxVoiceLayers(n); }
  getMaxVoiceLayers(): number { return this.voiceEngine.getMaxVoiceLayers(); }

  getParallelSends(): { plate: number; hall: number; cistern: number } {
    return this.fxChain.getParallelSends();
  }

  setParallelSends(sends: Partial<{ plate: number; hall: number; cistern: number }>): void {
    this.fxChain.setParallelSends(sends);
  }

  /** Resonant comb filter feedback (0..0.98). Presets with strong comb
   *  character + high-feedback default (0.68) can self-amplify into the
   *  limiter; per-preset override lets structural outliers like
   *  Permafrost / Closed Doors / Sarangi run a tamer resonance. */
  setCombFeedback(fb: number): void {
    this.fxChain.setCombFeedback(fb);
  }

  /** Serial effect-chain order. UI (FxBar) persists the user's
   *  reorder via localStorage and replays it on every engine spin-up
   *  so the saved chain order survives reloads.
   *
   *  Drag-reorder while audio is hot triggers a synchronous
   *  disconnect/reconnect of every serial-insert link inside FxChain
   *  — a click without protection on long reverb tails. We dip the
   *  master ~6 dB for ~130 ms (same envelope used by preset-change)
   *  before applying so the swap lands under silence. Skipped when
   *  the rewire is a no-op, when the drone isn't playing, or in
   *  low-power mode (matches the applyPreset duck policy). */
  setEffectOrder(order: readonly EffectId[]): void {
    // Use *user* low-power, not effective. Adaptive overlay raises
    // lowPower precisely when the thread is struggling — exactly when
    // we want the duck firing. See parallel fix in presets.ts.
    if (shouldDuckOnEffectReorder(
      this.fxChain.getEffectOrder(),
      order,
      this.voiceEngine.isPlaying(),
      this.isUserLowPower(),
    )) {
      this.masterBus.duckForPresetChange();
    }
    this.fxChain.setEffectOrder(order);
  }

  getEffectOrder(): EffectId[] {
    return this.fxChain.getEffectOrder();
  }

  /** Grain → parallel-plate excitation send (0..1). See FxChain. */
  setGrainToPlateGain(v: number): void {
    this.fxChain.setGrainToPlateGain(v);
  }
  getGrainToPlateGain(): number {
    return this.fxChain.getGrainToPlateGain();
  }

  /** Seed the deterministic reverb IR PRNG — so the same preset id
   *  always produces the same hall / cistern impulse across reloads.
   *  Callers should hash a stable identifier (preset id, scene id) to
   *  a 32-bit integer before passing it in. */
  setReverbSeed(seed: number): void {
    this.fxChain.setReverbSeed(seed);
  }

  setDrift(v: number): void {
    this.voiceEngine.setDrift(v);
  }

  getDrift(): number { return this.voiceEngine.getDrift(); }

  setAir(v: number): void {
    this.motionEngine.setAir(v);
  }

  getAir(): number { return this.motionEngine.getAir(); }

  setPresetTrim(v: number): void {
    const trim = Math.max(0.1, Math.min(4, v));
    this.presetTrim.gain.setTargetAtTime(trim, this.ctx.currentTime, 0.08);
  }

  /** Soft master-bus duck to mask preset-change artefacts. Callers
   *  should fire this immediately before swapping voices / fx so the
   *  swap happens under the dip. No-op when masterBus is bypassed
   *  (debug-only path). */
  duckForPresetChange(): void {
    this.masterBus.duckForPresetChange();
  }

  /** Two layers compose into the effective low-power state applied to
   *  the master bus / visuals: a persisted user setting (Layout owns it,
   *  re-syncs on every render via setLowPowerMode) and a runtime
   *  adaptive overlay (Stage 1 mitigation). User layer is what shows in
   *  the UI and what survives across sessions; adaptive layer is
   *  transient and never persisted. */
  private userLowPower = false;
  private adaptiveLowPower = false;
  private liveSafeLowPower = false;
  isLowPower(): boolean {
    return this.userLowPower || this.adaptiveLowPower || this.liveSafeLowPower;
  }
  isUserLowPower(): boolean { return this.userLowPower; }
  setLowPowerMode(on: boolean): void {
    if (this.userLowPower === on) return;
    this.userLowPower = on;
    this.masterBus.setLowPowerMode(this.isLowPower());
  }
  setAdaptiveLowPower(on: boolean): void {
    if (this.adaptiveLowPower === on) return;
    this.adaptiveLowPower = on;
    this.masterBus.setLowPowerMode(this.isLowPower());
  }
  setLiveSafeLowPower(on: boolean): void {
    if (this.liveSafeLowPower === on) return;
    this.liveSafeLowPower = on;
    this.masterBus.setLowPowerMode(this.isLowPower());
  }

  getPresetTrim(): number { return this.presetTrim.gain.value; }

  setEffect(id: EffectId, on: boolean): void {
    this.fxChain.setEffect(id, on);
  }

  isEffect(id: EffectId): boolean { return this.fxChain.isEffect(id); }
  getEffectStates(): Record<EffectId, boolean> { return this.fxChain.getEffectStates(); }
  /** User-intent effect states — overlays adaptive-suppressed FX as ON.
   *  Snapshot/share/autosave code paths must read this, not
   *  getEffectStates(), so a snapshot taken during adaptive mitigation
   *  preserves the user's intended FX configuration. */
  getUserEffectStates(): Record<EffectId, boolean> {
    const live = this.fxChain.getEffectStates();
    for (const id of Object.keys(live) as EffectId[]) {
      if (
        this.adaptiveStability.isFxSuppressed(id) ||
        this.liveSafe.isFxSuppressed(id)
      ) {
        live[id] = true;
      }
    }
    return live;
  }
  getFxChain(): FxChain { return this.fxChain; }

  setTime(v: number): void {
    this.motionEngine.setTime(v);
  }

  getTime(): number { return this.motionEngine.getTime(); }

  setClimateX(v: number): void {
    this.motionEngine.setClimateX(v);
  }

  getClimateX(): number { return this.motionEngine.getClimateX(); }

  setClimateY(v: number): void {
    this.motionEngine.setClimateY(v);
  }

  getClimateY(): number { return this.motionEngine.getClimateY(); }

  setLfoShape(shape: OscillatorType): void {
    this.motionEngine.setLfoShape(shape);
  }

  getLfoShape(): OscillatorType { return this.motionEngine.getLfoShape(); }

  setLfoRate(hz: number): void {
    this.motionEngine.setLfoRate(hz);
  }

  getLfoRate(): number { return this.motionEngine.getLfoRate(); }

  setLfoAmount(amt: number): void {
    this.motionEngine.setLfoAmount(amt);
  }

  getLfoAmount(): number { return this.motionEngine.getLfoAmount(); }

  setEntrain(state: import("../entrain").EntrainState): void {
    this.motionEngine.setEntrain(state);
    // Route dichotic cents to the voice engine. The panel stores the
    // full spread; we apply it only when ENTRAIN is enabled AND the
    // mode asks for dichotic behaviour. 0 otherwise so toggling the
    // mode or the power button is an instant on/off.
    const dichoticOn =
      state.enabled && (state.mode === "dichotic" || state.mode === "both");
    this.voiceEngine.setDichoticCents(dichoticOn ? state.dichoticCents : 0);
  }

  getEntrain(): import("../entrain").EntrainState { return this.motionEngine.getEntrain(); }

  setSub(v: number): void {
    this.voiceEngine.setSub(v);
  }

  getSub(): number { return this.voiceEngine.getSub(); }

  setBloom(v: number): void {
    this.voiceEngine.setBloom(v);
  }

  getBloom(): number { return this.voiceEngine.getBloom(); }

  setGlide(v: number): void {
    this.voiceEngine.setGlide(v);
  }

  getGlide(): number { return this.voiceEngine.getGlide(); }

  getMasterNode(): GainNode { return this.masterBus.getMasterNode(); }
  getAnalyser(): AnalyserNode { return this.masterBus.getAnalyser(); }
  getPreLimiterAnalyser(): AnalyserNode { return this.masterBus.getPreLimiterAnalyser(); }
  getEqLow(): BiquadFilterNode { return this.masterBus.getEqLow(); }
  getEqMid(): BiquadFilterNode { return this.masterBus.getEqMid(); }
  getEqHigh(): BiquadFilterNode { return this.masterBus.getEqHigh(); }
  /** @deprecated Native compressor is no longer the limiter. Returns
   *  the worklet node (or null while the worklet loads) for callers
   *  that need to inspect state. */
  getLimiter(): AudioWorkletNode | null { return this.masterBus.getLimiter(); }
  getOutputTrim(): GainNode { return this.masterBus.getOutputTrim(); }

  setMasterVolume(v: number): void {
    this.masterBus.setMasterVolume(v);
  }

  getMasterVolume(): number { return this.masterBus.getMasterVolume(); }

  setHpfFreq(hz: number): void { this.masterBus.setHpfFreq(hz); }
  getHpfFreq(): number { return this.masterBus.getHpfFreq(); }

  setGlueAmount(amount: number): void { this.masterBus.setGlueAmount(amount); }
  getGlueAmount(): number { return this.masterBus.getGlueAmount(); }

  setLimiterEnabled(on: boolean): void { this.masterBus.setLimiterEnabled(on); }
  isLimiterEnabled(): boolean { return this.masterBus.isLimiterEnabled(); }

  setLimiterCeiling(dB: number): void { this.masterBus.setLimiterCeiling(dB); }
  getLimiterCeiling(): number { return this.masterBus.getLimiterCeiling(); }

  setDrive(amount: number): void { this.masterBus.setDrive(amount); }
  getDrive(): number { return this.masterBus.getDrive(); }

  setHeadphoneSafe(on: boolean): void { this.masterBus.setHeadphoneSafe(on); }
  isHeadphoneSafe(): boolean { return this.masterBus.isHeadphoneSafe(); }

  setWidth(w: number): void { this.masterBus.setWidth(w); }
  getWidth(): number { return this.masterBus.getWidth(); }

  setMudTrimEnabled(on: boolean): void { this.masterBus.setMudTrimEnabled(on); }
  isMudTrimEnabled(): boolean { return this.masterBus.isMudTrimEnabled(); }

  /** Master room — parallel cathedral-IR send. 0..1, default 0. */
  setRoomAmount(a: number): void { this.masterBus.setRoomAmount(a); }
  getRoomAmount(): number { return this.masterBus.getRoomAmount(); }

  /** Loudness-aware leveler. Resets the master loudness trim to 1.0,
   *  collects LUFS-S samples for `settleSec` seconds (skipping the
   *  first 1.5 s while the new preset blooms in), then ramps the
   *  trim to land the median observed LUFS on `targetLufs`. Used by
   *  RND so a string of random presets reads as equal-loudness
   *  rather than jumping ±6 dB between picks.
   *
   *  No-op if the loudness meter worklet hasn't loaded yet, or if
   *  fewer than 5 valid samples arrive — better to leave the trim
   *  alone than to commit to a bad measurement. */
  private levelLoudnessTimer: number | null = null;
  private levelLoudnessUnsub: (() => void) | null = null;
  levelLoudnessAfterRnd(targetLufs: number = -15, settleSec: number = 3): void {
    // Cancel any in-flight leveling cycle from the previous RND.
    if (this.levelLoudnessTimer !== null) {
      window.clearTimeout(this.levelLoudnessTimer);
      this.levelLoudnessTimer = null;
    }
    if (this.levelLoudnessUnsub) {
      this.levelLoudnessUnsub();
      this.levelLoudnessUnsub = null;
    }
    // Reset to neutral so the new preset starts at its authored gain
    // and the leveler nudges from there.
    this.masterBus.setLoudnessTrim(1.0, 0.4);
    const samples: number[] = [];
    const startedAt = this.ctx.currentTime;
    const collectAfter = 1.5;
    this.levelLoudnessUnsub = this.masterBus.onLoudnessUpdate(({ lufsShort }) => {
      if (!Number.isFinite(lufsShort)) return;
      if (this.ctx.currentTime - startedAt < collectAfter) return;
      samples.push(lufsShort);
    });
    this.levelLoudnessTimer = window.setTimeout(() => {
      if (this.levelLoudnessUnsub) { this.levelLoudnessUnsub(); this.levelLoudnessUnsub = null; }
      this.levelLoudnessTimer = null;
      if (samples.length < 5) return;
      const sorted = samples.slice().sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      const trim = Math.pow(10, (targetLufs - median) / 20);
      this.masterBus.setLoudnessTrim(trim, 1.5);
    }, settleSec * 1000);
  }

  /** COLOR — single user-facing knob that drives parallel saturation
   *  and the air-band exciter together. They live on the same
   *  perceptual axis (analog density / openness) so most users will
   *  ride them in tandem; exposing two separate knobs creates
   *  decision fatigue without a meaningful mix difference. Internal
   *  ratio: exciter = sat × 0.8 (the air band needs slightly less
   *  send to read than the broadband saturation does). */
  private colorAmount = 0;
  setColorAmount(a: number): void {
    const clamped = Math.max(0, Math.min(1, a));
    this.colorAmount = clamped;
    this.masterBus.setSaturationAmount(clamped);
    this.masterBus.setExciterAmount(clamped * 0.8);
  }
  getColorAmount(): number { return this.colorAmount; }

  /** Start a slow master-gain fade to the given linear target over
   *  `seconds` (clamped 1..3600). Transient performance gesture —
   *  not persisted in saved scenes. */
  startMasterFade(targetLinear: number, seconds: number): void {
    this.motionEngine.startFade(
      this.masterBus.getOutputTrim().gain,
      targetLinear,
      seconds,
    );
  }
  cancelMasterFade(): void { this.motionEngine.cancelFade(); }

  private morphTimeout: ReturnType<typeof setTimeout> | null = null;

  /** Scene-chain crossfade: fade outputTrim to silence over the first
   *  half of `seconds`, snap-apply the caller's scene change at the
   *  midpoint, then ramp back up over the second half. The honest
   *  lightweight version of a scene crossfade — no second audio
   *  graph, no two-bus sum, just a silence-gap morph that gets you
   *  90% of the musical feeling for 10% of the complexity. Two
   *  morph calls in flight stack correctly: the second cancels the
   *  first's pending swap + ramp. */
  morphRun(apply: () => void, seconds: number): void {
    const dur = Math.max(1, Math.min(300, seconds));
    const half = dur / 2;
    const trim = this.masterBus.getOutputTrim().gain;
    const savedLinear = trim.value;
    if (this.morphTimeout !== null) {
      clearTimeout(this.morphTimeout);
      this.morphTimeout = null;
    }
    // Ramp to silence
    this.startMasterFade(0, half);
    this.morphTimeout = setTimeout(() => {
      this.morphTimeout = null;
      try { apply(); } catch (err) { console.error("mdrone: morph apply failed", err); }
      // Choose the fade-in target:
      //   - if apply() set a new output volume (applyMixerSnapshot
      //     writes trim.value = mixer.volume), use that as the new
      //     target — the user's intended scene-B volume;
      //   - otherwise restore the pre-morph volume.
      // Force the ramp to start from 0 even if apply() stomped the
      // trim value, so we get a clean silence-gap crossfade without
      // a click at the midpoint.
      let target = trim.value;
      if (target < 0.01) target = savedLinear;
      const now = this.ctx.currentTime;
      try { trim.cancelScheduledValues(now); } catch { /* noop */ }
      try {
        trim.setValueAtTime(0, now);
        trim.linearRampToValueAtTime(Math.max(0, target), now + half);
      } catch { /* noop */ }
    }, Math.round(half * 1000));
  }

  /** Pitch-locked LFO: rate = rootHz / N. 0 disables. */
  setLfoDivision(n: number): void { this.motionEngine.setLfoDivision(n); }
  getLfoDivision(): number { return this.motionEngine.getLfoDivision(); }

  /** Seed the evolve PRNG — makes evolve reproducible across loads. */
  setEvolveSeed(seed: number): void { this.motionEngine.setEvolveSeed(seed); }

  /** Subscribe to LUFS-S + true-peak readings from the loudness
   *  worklet. Returns an unsubscribe function. The callback fires at
   *  ~30 Hz with the EBU R128 short-term LUFS and the decaying
   *  sample-peak (dB). P3. */
  onLoudnessUpdate(cb: (m: { lufsShort: number; peakDb: number }) => void): () => void {
    return this.masterBus.onLoudnessUpdate(cb);
  }

  getLoadMonitor(): AudioLoadMonitor { return this.loadMonitor; }

  /** Current adaptive stability state — what the runtime mitigation
   *  controller has temporarily overridden, if anything. */
  getAdaptiveStabilityState(): AdaptiveStabilityState {
    return this.adaptiveStability.getState();
  }

  subscribeAdaptiveStability(
    listener: (s: AdaptiveStabilityState) => void,
  ): () => void {
    return this.adaptiveStability.subscribe(listener);
  }

  /** LIVE SAFE — explicit user-initiated stability mode. Idempotent;
   *  Layout owns the persisted bit and pushes it on hydrate / on every
   *  toggle. */
  setLiveSafeMode(on: boolean): void { this.liveSafe.setActive(on); }
  isLiveSafeMode(): boolean { return this.liveSafe.isActive(); }
  getLiveSafeState(): LiveSafeState { return this.liveSafe.getState(); }
  subscribeLiveSafe(listener: (s: LiveSafeState) => void): () => void {
    return this.liveSafe.subscribe(listener);
  }
}

/** Decide whether a serial-chain reorder warrants firing the master
 *  preset duck before FxChain rewires the graph. Pure helper extracted
 *  for unit testing — see tests/unit/audioEngineEffectOrder.test.ts.
 *
 *  Skip the duck when:
 *    - the new order is identical to the current one (no rewire),
 *    - the drone isn't playing (no audible signal to protect),
 *    - the user has explicitly opted into low-power (deliberate
 *      weak-hardware setting). Adaptive lowPower overlay does NOT
 *      skip the duck — see presets.ts for the same policy.
 */
export function shouldDuckOnEffectReorder(
  currentOrder: readonly EffectId[],
  newOrder: readonly EffectId[],
  isPlaying: boolean,
  isUserLowPower: boolean,
): boolean {
  if (!isPlaying || isUserLowPower) return false;
  if (currentOrder.length !== newOrder.length) return true;
  for (let i = 0; i < currentOrder.length; i++) {
    if (currentOrder[i] !== newOrder[i]) return true;
  }
  return false;
}
