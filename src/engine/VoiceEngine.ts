import { FxChain } from "./FxChain";
import type { PresetMaterialProfile } from "./presets";
import { DEFAULT_PRESET_MATERIAL_PROFILE } from "./presets";
import { buildVoice, ALL_VOICE_TYPES, type Voice, type VoiceType } from "./VoiceBuilder";

export class VoiceEngine {
  private readonly ctx: AudioContext;
  private readonly fxChain: FxChain;
  private readonly wetSend: GainNode;
  private readonly droneVoiceGain: GainNode;
  private readonly droneFilter: BiquadFilterNode;
  private readonly subVoiceGain: GainNode;
  private readonly shimmerVoiceGain: GainNode;

  private droneVoicesByLayer: Map<VoiceType, Voice[]> = new Map();
  private layerGains: Map<VoiceType, GainNode> = new Map();
  private voiceUpdateDepth = 0;
  private voiceRebuildPending = false;
  private layerLevels: Record<VoiceType, number> = {
    tanpura: 1, reed: 1, metal: 1, air: 1,
  };
  private voiceLayers: Record<VoiceType, boolean> = {
    tanpura: true, reed: false, metal: false, air: false,
  };
  private droneIntervalsCents: number[] = [0];
  private droneRootFreq = 220;
  private subOscs: { a: OscillatorNode; b: OscillatorNode } | null = null;
  private shimmerOscs: { a: OscillatorNode; b: OscillatorNode } | null = null;
  private droneOn = false;
  private drift = 0.3;
  private subAmount = 0;
  private bloomAmount = 0.15;
  private glideAmount = 0.15;
  private morphAmount = 0.25;
  private tanpuraPluckRate = 1;
  private readonly baseMacroTC = 0.4;

  private presetMaterialProfile: PresetMaterialProfile = DEFAULT_PRESET_MATERIAL_PROFILE;
  private evolveAmount = 0;
  private materialInterval: number | null = null;
  private materialStep = 0;
  private materialLevelOffsets: Record<VoiceType, number> = {
    tanpura: 0, reed: 0, metal: 0, air: 0,
  };
  private materialDriftScales: Record<VoiceType, number> = {
    tanpura: 1, reed: 1, metal: 1, air: 1,
  };
  private readonly materialPhaseOffsets: Record<VoiceType, number> = {
    tanpura: Math.random() * Math.PI * 2,
    reed: Math.random() * Math.PI * 2,
    metal: Math.random() * Math.PI * 2,
    air: Math.random() * Math.PI * 2,
  };
  private materialPluckFactor = 1;
  private materialSubFactor = 1;
  private materialShimmerFactor = 1;

  constructor(ctx: AudioContext, fxChain: FxChain, wetSend: GainNode) {
    this.ctx = ctx;
    this.fxChain = fxChain;
    this.wetSend = wetSend;

    this.droneVoiceGain = this.ctx.createGain();
    this.droneVoiceGain.gain.value = 0.25;

    this.droneFilter = this.ctx.createBiquadFilter();
    this.droneFilter.type = "lowpass";
    this.droneFilter.frequency.value = 2400;
    this.droneFilter.Q.value = 0.5;
    this.droneVoiceGain.connect(this.droneFilter);

    this.subVoiceGain = this.ctx.createGain();
    this.subVoiceGain.gain.value = 0;
    this.subVoiceGain.connect(this.droneFilter);

    this.shimmerVoiceGain = this.ctx.createGain();
    this.shimmerVoiceGain.gain.value = 0;
  }

  getFilterOutput(): AudioNode { return this.droneFilter; }
  getShimmerOutput(): AudioNode { return this.shimmerVoiceGain; }
  getFilterNode(): BiquadFilterNode { return this.droneFilter; }
  getVoiceGainNode(): GainNode { return this.droneVoiceGain; }
  getRootFreq(): number { return this.droneRootFreq; }
  isPlaying(): boolean { return this.droneOn; }

  startDrone(freq: number, intervalsCents: number[] = [0], air: number): void {
    this.droneRootFreq = freq;
    this.droneIntervalsCents = intervalsCents.length > 0 ? intervalsCents : [0];
    this.fxChain.setRootFreq(freq);

    if (this.droneOn) {
      this.setDroneFreq(freq);
      this.rebuildIntervals();
      return;
    }

    const now = this.ctx.currentTime;
    this.fxChain.restoreEnabledEffects();
    this.wetSend.gain.cancelScheduledValues(now);
    this.wetSend.gain.setTargetAtTime(air * 0.8, now, 0.05);

    for (const type of ALL_VOICE_TYPES) {
      if (!this.voiceLayers[type]) continue;
      const layerGain = this.ensureLayerGain(type);
      const voices: Voice[] = [];
      for (const c of this.droneIntervalsCents) {
        const voice = buildVoice(type, this.ctx, layerGain, freq, c, this.drift, now);
        if (type === "tanpura") voice.setPluckRate(this.effectivePluckRate());
        voice.setDrift(this.effectiveLayerDrift(type));
        voices.push(voice);
      }
      this.droneVoicesByLayer.set(type, voices);
    }

    this.subOscs = this.buildSubPair(freq * 0.5, now);
    this.shimmerOscs = this.buildShimmerPair(freq * 2, now);

    const attack = this.bloomAttackTime();
    const stackTarget = this.voiceStackGain();
    this.droneVoiceGain.gain.cancelScheduledValues(now);
    this.droneVoiceGain.gain.setValueAtTime(0, now);
    this.droneVoiceGain.gain.linearRampToValueAtTime(stackTarget, now + attack);

    this.subVoiceGain.gain.cancelScheduledValues(now);
    this.subVoiceGain.gain.setValueAtTime(0, now);
    this.subVoiceGain.gain.linearRampToValueAtTime(this.effectiveSubGain(), now + attack);

    this.shimmerVoiceGain.gain.cancelScheduledValues(now);
    this.shimmerVoiceGain.gain.setValueAtTime(0, now);
    if (this.fxChain.isEffect("shimmer")) {
      this.shimmerVoiceGain.gain.linearRampToValueAtTime(this.effectiveShimmerGain(), now + attack);
    }

    this.droneOn = true;
    this.updateMaterialMotion();
  }

  stopDrone(): void {
    if (!this.droneOn) return;
    const now = this.ctx.currentTime;
    const release = 0.6;

    for (const gain of [this.droneVoiceGain, this.subVoiceGain, this.shimmerVoiceGain]) {
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(0, now + release);
    }

    this.wetSend.gain.cancelScheduledValues(now);
    this.wetSend.gain.setValueAtTime(this.wetSend.gain.value, now);
    this.wetSend.gain.linearRampToValueAtTime(0, now + release);
    this.fxChain.releaseTails();

    const allVoices: Voice[] = [];
    for (const vs of this.droneVoicesByLayer.values()) {
      for (const v of vs) allVoices.push(v);
    }
    this.droneVoicesByLayer.clear();

    const sub = this.subOscs;
    const shimmer = this.shimmerOscs;
    this.subOscs = null;
    this.shimmerOscs = null;

    setTimeout(() => {
      for (const v of allVoices) v.stop();
      if (sub) {
        try { sub.a.stop(); sub.a.disconnect(); } catch { /* ok */ }
        try { sub.b.stop(); sub.b.disconnect(); } catch { /* ok */ }
      }
      if (shimmer) {
        try { shimmer.a.stop(); shimmer.a.disconnect(); } catch { /* ok */ }
        try { shimmer.b.stop(); shimmer.b.disconnect(); } catch { /* ok */ }
      }
    }, (release + 0.1) * 1000);

    this.droneOn = false;
    this.updateMaterialMotion();
  }

  setDroneFreq(freq: number): void {
    this.droneRootFreq = freq;
    this.fxChain.setRootFreq(freq);
    const now = this.ctx.currentTime;
    const glide = this.glideTime();

    for (const voices of this.droneVoicesByLayer.values()) {
      for (let i = 0; i < voices.length; i++) {
        const interval = this.droneIntervalsCents[i] ?? 0;
        const target = freq * Math.pow(2, interval / 1200);
        voices[i].setFreq(target, glide);
      }
    }

    if (this.subOscs) this.glideOscPair(this.subOscs, freq * 0.5, now, glide);
    if (this.shimmerOscs) this.glideOscPair(this.shimmerOscs, freq * 2, now, glide);
  }

  setIntervals(intervalsCents: number[]): void {
    this.droneIntervalsCents = intervalsCents.length > 0 ? intervalsCents : [0];
    if (this.droneOn) this.rebuildIntervals();
  }

  setVoiceLayer(type: VoiceType, on: boolean): void {
    if (this.voiceLayers[type] === on) return;
    this.voiceLayers[type] = on;
    this.scheduleVoiceRebuild();
  }

  getVoiceLayer(type: VoiceType): boolean { return this.voiceLayers[type]; }
  getVoiceLayers(): Record<VoiceType, boolean> { return { ...this.voiceLayers }; }

  setVoiceLevel(type: VoiceType, level: number): void {
    const v = Math.max(0, Math.min(1, level));
    this.layerLevels[type] = v;
    const gain = this.layerGains.get(type);
    if (gain) {
      gain.gain.setTargetAtTime(this.effectiveLayerLevel(type), this.ctx.currentTime, 0.08);
    }
  }

  getVoiceLevel(type: VoiceType): number { return this.layerLevels[type]; }

  applyVoiceState(
    layers: Record<VoiceType, boolean>,
    levels: Record<VoiceType, number>,
  ): void {
    this.voiceUpdateDepth++;
    try {
      for (const type of ALL_VOICE_TYPES) {
        this.voiceLayers[type] = layers[type];
        this.layerLevels[type] = Math.max(0, Math.min(1, levels[type]));
        const gain = this.layerGains.get(type);
        if (gain) {
          gain.gain.setTargetAtTime(this.effectiveLayerLevel(type), this.ctx.currentTime, 0.08);
        }
      }
      this.voiceRebuildPending = true;
    } finally {
      this.voiceUpdateDepth--;
      this.flushVoiceRebuild();
    }
  }

  applyDroneScene(
    layers: Record<VoiceType, boolean>,
    levels: Record<VoiceType, number>,
    intervalsCents: number[],
  ): void {
    this.voiceUpdateDepth++;
    try {
      this.droneIntervalsCents = intervalsCents.length > 0 ? [...intervalsCents] : [0];
      for (const type of ALL_VOICE_TYPES) {
        this.voiceLayers[type] = layers[type];
        this.layerLevels[type] = Math.max(0, Math.min(1, levels[type]));
        const gain = this.layerGains.get(type);
        if (gain) {
          gain.gain.setTargetAtTime(this.effectiveLayerLevel(type), this.ctx.currentTime, 0.08);
        }
      }
      this.voiceRebuildPending = true;
    } finally {
      this.voiceUpdateDepth--;
      this.flushVoiceRebuild();
    }
  }

  setVoiceType(type: VoiceType): void {
    for (const t of ALL_VOICE_TYPES) {
      this.voiceLayers[t] = t === type;
    }
    this.scheduleVoiceRebuild();
  }

  getVoiceType(): VoiceType {
    for (const t of ALL_VOICE_TYPES) {
      if (this.voiceLayers[t]) return t;
    }
    return "tanpura";
  }

  setDrift(v: number): void {
    this.drift = Math.max(0, Math.min(1, v));
    this.applyDriftTargets();
  }

  getDrift(): number { return this.drift; }

  setSub(v: number): void {
    this.subAmount = Math.max(0, Math.min(1, v));
    if (this.droneOn) {
      this.subVoiceGain.gain.setTargetAtTime(this.effectiveSubGain(), this.ctx.currentTime, this.MACRO_TC);
    }
  }

  getSub(): number { return this.subAmount; }

  setBloom(v: number): void {
    this.bloomAmount = Math.max(0, Math.min(1, v));
  }

  getBloom(): number { return this.bloomAmount; }

  setGlide(v: number): void {
    this.glideAmount = Math.max(0, Math.min(1, v));
  }

  getGlide(): number { return this.glideAmount; }

  setPresetMorph(v: number): void {
    this.morphAmount = Math.max(0, Math.min(1, v));
  }

  getPresetMorph(): number { return this.morphAmount; }

  setPresetMaterialProfile(profile: PresetMaterialProfile | null): void {
    this.presetMaterialProfile = profile ?? DEFAULT_PRESET_MATERIAL_PROFILE;
    this.resetMaterialState();
    this.updateMaterialMotion();
  }

  setEvolveAmount(v: number): void {
    this.evolveAmount = Math.max(0, Math.min(1, v));
    this.updateMaterialMotion();
  }

  setTanpuraPluckRate(v: number): void {
    this.tanpuraPluckRate = Math.max(0.2, Math.min(4, v));
    this.applyPluckTargets();
  }

  getTanpuraPluckRate(): number { return this.tanpuraPluckRate; }

  setShimmerEnabled(on: boolean): void {
    if (!this.droneOn) return;
    this.shimmerVoiceGain.gain.setTargetAtTime(on ? this.effectiveShimmerGain() : 0, this.ctx.currentTime, 0.15);
  }

  private get MACRO_TC(): number {
    return this.baseMacroTC * (0.3 + this.morphAmount * 5.7);
  }

  private bloomAttackTime(): number {
    return 0.3 + this.bloomAmount * 9.7;
  }

  private voiceStackGain(): number {
    return 0.25 / Math.sqrt(Math.max(1, this.droneIntervalsCents.length));
  }

  private glideTime(): number {
    return 0.05 * Math.pow(160, this.glideAmount);
  }

  private scheduleVoiceRebuild(): void {
    if (!this.droneOn) return;
    this.voiceRebuildPending = true;
    this.flushVoiceRebuild();
  }

  private flushVoiceRebuild(): void {
    if (this.voiceUpdateDepth > 0 || !this.voiceRebuildPending || !this.droneOn) return;
    this.voiceRebuildPending = false;
    this.rebuildIntervals();
  }

  private rebuildIntervals(): void {
    const now = this.ctx.currentTime;
    const morphMul = 0.4 + this.morphAmount * 3.6;
    const bloom = Math.max(0.3, this.bloomAttackTime() * morphMul);

    const retiring: { gain: GainNode; voices: Voice[] }[] = [];
    for (const [type, voices] of this.droneVoicesByLayer.entries()) {
      const oldGain = this.layerGains.get(type);
      if (oldGain) {
        const cur = oldGain.gain.value;
        oldGain.gain.cancelScheduledValues(now);
        oldGain.gain.setValueAtTime(cur, now);
        oldGain.gain.linearRampToValueAtTime(0.0001, now + bloom);
        this.layerGains.delete(type);
        retiring.push({ gain: oldGain, voices });
      }
    }
    this.droneVoicesByLayer.clear();

    for (const type of ALL_VOICE_TYPES) {
      if (!this.voiceLayers[type]) continue;
      const layerGain = this.ctx.createGain();
      layerGain.gain.value = 0;
      layerGain.connect(this.droneVoiceGain);
      layerGain.gain.setValueAtTime(0, now);
      layerGain.gain.linearRampToValueAtTime(this.effectiveLayerLevel(type), now + bloom);
      this.layerGains.set(type, layerGain);

      const voices: Voice[] = [];
      for (const c of this.droneIntervalsCents) {
        const voice = buildVoice(type, this.ctx, layerGain, this.droneRootFreq, c, this.drift, now);
        if (type === "tanpura") voice.setPluckRate(this.effectivePluckRate());
        voice.setDrift(this.effectiveLayerDrift(type));
        voices.push(voice);
      }
      this.droneVoicesByLayer.set(type, voices);
    }

    const stopAtMs = bloom * 1000 + 150;
    setTimeout(() => {
      for (const retiringLayer of retiring) {
        for (const voice of retiringLayer.voices) {
          try { voice.stop(); } catch { /* ok */ }
        }
        try { retiringLayer.gain.disconnect(); } catch { /* ok */ }
      }
    }, stopAtMs);

    this.droneVoiceGain.gain.cancelScheduledValues(now);
    this.droneVoiceGain.gain.setTargetAtTime(this.voiceStackGain(), now, 0.2);
  }

  private ensureLayerGain(type: VoiceType): GainNode {
    let gain = this.layerGains.get(type);
    if (!gain) {
      gain = this.ctx.createGain();
      gain.gain.value = this.effectiveLayerLevel(type);
      gain.connect(this.droneVoiceGain);
      this.layerGains.set(type, gain);
    }
    return gain;
  }

  private glideOscPair(
    pair: { a: OscillatorNode; b: OscillatorNode },
    target: number,
    now: number,
    glide: number,
  ): void {
    for (const osc of [pair.a, pair.b]) {
      osc.frequency.cancelScheduledValues(now);
      osc.frequency.setValueAtTime(osc.frequency.value, now);
      osc.frequency.linearRampToValueAtTime(target, now + glide);
    }
  }

  private buildSubPair(freq: number, startAt: number) {
    const spread = this.drift * 25;
    const a = this.ctx.createOscillator();
    a.type = "triangle";
    a.frequency.value = freq;
    a.detune.value = -spread;
    const b = this.ctx.createOscillator();
    b.type = "triangle";
    b.frequency.value = freq;
    b.detune.value = spread;
    a.connect(this.subVoiceGain);
    b.connect(this.subVoiceGain);
    a.start(startAt);
    b.start(startAt);
    return { a, b };
  }

  private buildShimmerPair(freq: number, startAt: number) {
    const spread = this.drift * 25;
    const a = this.ctx.createOscillator();
    a.type = "sawtooth";
    a.frequency.value = freq;
    a.detune.value = -spread;
    const b = this.ctx.createOscillator();
    b.type = "sawtooth";
    b.frequency.value = freq;
    b.detune.value = spread;
    a.connect(this.shimmerVoiceGain);
    b.connect(this.shimmerVoiceGain);
    a.start(startAt);
    b.start(startAt);
    return { a, b };
  }

  private effectiveLayerLevel(type: VoiceType): number {
    return Math.max(0, Math.min(1, this.layerLevels[type] + this.materialLevelOffsets[type]));
  }

  private effectiveLayerDrift(type: VoiceType): number {
    return Math.max(0, Math.min(1, this.drift * this.materialDriftScales[type]));
  }

  private effectivePluckRate(): number {
    return Math.max(0.2, Math.min(4, this.tanpuraPluckRate * this.materialPluckFactor));
  }

  private effectiveSubGain(): number {
    return this.subAmount * 0.3 * this.materialSubFactor;
  }

  private effectiveShimmerGain(): number {
    return 0.25 * this.materialShimmerFactor;
  }

  private applyLayerGainTargets(): void {
    const now = this.ctx.currentTime;
    for (const type of ALL_VOICE_TYPES) {
      const gain = this.layerGains.get(type);
      if (gain) gain.gain.setTargetAtTime(this.effectiveLayerLevel(type), now, 0.18);
    }
  }

  private applyDriftTargets(): void {
    const now = this.ctx.currentTime;
    for (const type of ALL_VOICE_TYPES) {
      const voices = this.droneVoicesByLayer.get(type);
      if (!voices) continue;
      const drift = this.effectiveLayerDrift(type);
      for (const voice of voices) voice.setDrift(drift);
    }
    const spread = this.drift * 25 * this.averageDriftScale();
    const apply = (pair: { a: OscillatorNode; b: OscillatorNode }) => {
      pair.a.detune.setTargetAtTime(-spread, now, 0.05);
      pair.b.detune.setTargetAtTime(spread, now, 0.05);
    };
    if (this.subOscs) apply(this.subOscs);
    if (this.shimmerOscs) apply(this.shimmerOscs);
  }

  private applyPluckTargets(): void {
    const tanpuraVoices = this.droneVoicesByLayer.get("tanpura");
    if (!tanpuraVoices) return;
    const rate = this.effectivePluckRate();
    for (const voice of tanpuraVoices) voice.setPluckRate(rate);
  }

  private applySecondaryVoiceTargets(): void {
    const now = this.ctx.currentTime;
    if (!this.droneOn) return;
    this.subVoiceGain.gain.setTargetAtTime(this.effectiveSubGain(), now, 0.22);
    if (this.fxChain.isEffect("shimmer")) {
      this.shimmerVoiceGain.gain.setTargetAtTime(this.effectiveShimmerGain(), now, 0.22);
    }
  }

  private averageDriftScale(): number {
    const values = ALL_VOICE_TYPES.map((type) => this.materialDriftScales[type]);
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  private updateMaterialMotion(): void {
    const shouldRun = this.droneOn && this.evolveAmount > 0.12;
    if (shouldRun && this.materialInterval == null) {
      this.materialInterval = window.setInterval(() => {
        this.materialStep++;
        this.computeMaterialState();
        this.applyLayerGainTargets();
        this.applyDriftTargets();
        this.applyPluckTargets();
        this.applySecondaryVoiceTargets();
      }, 2200);
      return;
    }

    if (!shouldRun && this.materialInterval != null) {
      window.clearInterval(this.materialInterval);
      this.materialInterval = null;
    }

    if (!shouldRun) {
      this.resetMaterialState();
      this.applyLayerGainTargets();
      this.applyDriftTargets();
      this.applyPluckTargets();
      this.applySecondaryVoiceTargets();
    }
  }

  private computeMaterialState(): void {
    const intensity = Math.max(0, Math.min(1, (this.evolveAmount - 0.12) / 0.88));
    const profile = this.presetMaterialProfile;

    for (const type of ALL_VOICE_TYPES) {
      const wobble = profile.levelWobble[type] ?? 0;
      const phase = this.materialPhaseOffsets[type] + this.materialStep * profile.wobbleRate;
      const randomNudge = (Math.random() - 0.5) * wobble * 0.4 * intensity;
      this.materialLevelOffsets[type] = Math.max(
        -wobble,
        Math.min(wobble, Math.sin(phase) * wobble * intensity + randomNudge),
      );

      const driftBias = profile.driftBias[type] ?? 1;
      const driftMotion = 1 + Math.sin(phase * 0.8 + 0.7) * 0.16 * intensity;
      this.materialDriftScales[type] = Math.max(0.35, Math.min(1.8, driftBias * driftMotion));
    }

    const [pluckMin, pluckMax] = profile.pluckRange;
    const pluckBlend = (Math.sin(this.materialStep * profile.wobbleRate * 0.85 + 0.4) + 1) * 0.5;
    const pluckMotion = pluckMin + (pluckMax - pluckMin) * pluckBlend;
    this.materialPluckFactor = 1 + (pluckMotion - 1) * intensity;

    this.materialSubFactor = 1 + Math.sin(this.materialStep * profile.wobbleRate * 0.52 + 1.1)
      * profile.subPulse * intensity;
    this.materialShimmerFactor = 1 + Math.sin(this.materialStep * profile.wobbleRate * 0.94 + 2.1)
      * profile.shimmerPulse * intensity;
  }

  private resetMaterialState(): void {
    this.materialLevelOffsets = { tanpura: 0, reed: 0, metal: 0, air: 0 };
    this.materialDriftScales = { tanpura: 1, reed: 1, metal: 1, air: 1 };
    this.materialPluckFactor = 1;
    this.materialSubFactor = 1;
    this.materialShimmerFactor = 1;
  }
}
