/**
 * AudioEngine — high-level coordinator for the drone instrument.
 *
 * Voice graph, motion/macros, master bus, and recording now live in
 * dedicated modules so this class mainly wires them together and
 * preserves the public API used by the UI/persistence layers.
 */

import { FxChain } from "./FxChain";
import type { EffectId } from "./FxChain";
import type { EngineSceneMutation } from "./EngineSceneMutation";
import { MasterBus } from "./MasterBus";
import { MasterRecorder, type RecordingSupport } from "./MasterRecorder";
import { MotionEngine } from "./MotionEngine";
import { VoiceEngine } from "./VoiceEngine";
import type { VoiceType } from "./VoiceBuilder";
import type { PresetMaterialProfile, PresetMotionProfile } from "./presets";
import droneWorkletUrl from "./droneVoiceProcessor.js?url";
import fxWorkletUrl from "./fxChainProcessor.js?url";

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
  private isWorkletReady = false;
  private pendingStart: { freq: number; intervalsCents: number[] } | null = null;

  constructor() {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AC({ sampleRate: 44100 });

    this.fxChain = new FxChain(this.ctx);
    this.wetSend = this.ctx.createGain();
    this.wetSend.gain.value = 1;

    this.presetTrim = this.ctx.createGain();
    this.presetTrim.gain.value = 1;

    this.voiceEngine = new VoiceEngine(this.ctx, this.fxChain, this.wetSend);
    this.voiceEngine.getFilterOutput().connect(this.presetTrim);
    this.voiceEngine.getShimmerOutput().connect(this.presetTrim);
    this.presetTrim.connect(this.fxChain.input);
    this.fxChain.wetOut.connect(this.wetSend);

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
    this.masterBus.connectInput(this.fxChain.dryOut);
    this.masterBus.connectInput(this.wetSend);

    this.masterRecorder = new MasterRecorder(this.ctx, this.masterBus.getAnalyser());

    const voiceReady = this.ctx.audioWorklet.addModule(droneWorkletUrl);
    const fxReady = this.ctx.audioWorklet.addModule(fxWorkletUrl);
    Promise.all([voiceReady, fxReady])
      .then(() => {
        this.isWorkletReady = true;
        this.fxChain.onWorkletReady();
        if (this.pendingStart) {
          const pending = this.pendingStart;
          this.pendingStart = null;
          this.startDrone(pending.freq, pending.intervalsCents);
        }
      })
      .catch((err) => {
        console.error("mdrone: worklet module(s) failed to load", err);
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

  async startMasterRecording(): Promise<void> {
    await this.masterRecorder.start();
  }

  async stopMasterRecording(): Promise<void> {
    await this.masterRecorder.stop();
  }

  isRecording(): boolean { return this.masterRecorder.isRecording(); }

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

  setReedShape(shape: import("./VoiceBuilder").ReedShape): void {
    this.voiceEngine.setReedShape(shape);
  }

  getReedShape(): import("./VoiceBuilder").ReedShape { return this.voiceEngine.getReedShape(); }

  setFmRatio(ratio: number): void { this.voiceEngine.setFmRatio(ratio); }
  getFmRatio(): number { return this.voiceEngine.getFmRatio(); }
  setFmIndex(index: number): void { this.voiceEngine.setFmIndex(index); }
  getFmIndex(): number { return this.voiceEngine.getFmIndex(); }

  setParallelSends(sends: Partial<{ plate: number; hall: number; cistern: number }>): void {
    this.fxChain.setParallelSends(sends);
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

  getPresetTrim(): number { return this.presetTrim.gain.value; }

  setEffect(id: EffectId, on: boolean): void {
    this.fxChain.setEffect(id, on);
    if (id === "shimmer") this.voiceEngine.setShimmerEnabled(on);
  }

  isEffect(id: EffectId): boolean { return this.fxChain.isEffect(id); }
  getEffectStates(): Record<EffectId, boolean> { return this.fxChain.getEffectStates(); }
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
  getEqLow(): BiquadFilterNode { return this.masterBus.getEqLow(); }
  getEqMid(): BiquadFilterNode { return this.masterBus.getEqMid(); }
  getEqHigh(): BiquadFilterNode { return this.masterBus.getEqHigh(); }
  getLimiter(): DynamicsCompressorNode { return this.masterBus.getLimiter(); }
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
}
