import { FxChain } from "./FxChain";
import type { PresetMaterialProfile } from "./presets";
import { DEFAULT_PRESET_MATERIAL_PROFILE } from "./presets";
import { buildVoice, ALL_VOICE_TYPES, type ReedShape, type TanpuraTuningId, type Voice, type VoiceType } from "./VoiceBuilder";

export class VoiceEngine {
  private static readonly MIN_REBUILD_XFADE_SEC = 0.3;
  private static readonly MAX_REBUILD_XFADE_SEC = 1.8;
  private readonly ctx: AudioContext;
  private readonly fxChain: FxChain;
  private readonly wetSend: GainNode;
  private readonly droneVoiceGain: GainNode;
  private readonly droneFilter: BiquadFilterNode;
  private readonly subVoiceGain: GainNode;
  private readonly shimmerVoiceGain: GainNode;

  private droneVoicesByLayer: Map<VoiceType, Voice[]> = new Map();
  private layerGains: Map<VoiceType, GainNode> = new Map();
  // Retiring voices from a previous rebuild whose tail hasn't finished.
  // Tracked on the instance (not in a local inside rebuildIntervals) so
  // a fresh rebuild can fast-kill them and avoid voice stacking under
  // rapid preset / layer churn.
  private pendingRetire: { gain: GainNode; voices: Voice[]; stopTimeout: number }[] = [];
  private stopDroneTimeout: number | null = null;
  private voiceUpdateDepth = 0;
  private voiceRebuildPending = false;
  private layerLevels: Record<VoiceType, number> = {
    tanpura: 1, reed: 1, metal: 1, air: 1, piano: 1, fm: 1, amp: 1,
  };
  private voiceLayers: Record<VoiceType, boolean> = {
    tanpura: true, reed: false, metal: false, air: false, piano: false, fm: false, amp: false,
  };
  private droneIntervalsCents: number[] = [0];
  private droneRootFreq = 220;
  private subOscs: { a: OscillatorNode; b: OscillatorNode } | null = null;
  private droneOn = false;
  private drift = 0.3;
  private subAmount = 0;
  private bloomAmount = 0.15;
  private glideAmount = 0.15;
  private morphAmount = 0.25;
  private tanpuraPluckRate = 1;
  private reedShape: ReedShape = "odd";
  private fmRatio = 2.0;
  private fmIndex = 2.4;
  private fmFeedback = 0;
  // Tanpura string tuning (Sa Pa / Sa Ma / Sa Ni / all-four). Applied
  // at voice construction; setting it triggers a voice rebuild via
  // scheduleVoiceRebuild() so the KS delay lengths repick.
  private tanpuraTuning: TanpuraTuningId = "classic";
  /** Max active voice layers. Low-core devices (≤4 logical cores,
   *  typical mobile / small laptops) cap at 4 to prevent audio-thread
   *  overload when a preset asks for 6-7 simultaneous voices. Default
   *  is derived from `navigator.hardwareConcurrency` at construction.
   *  Setting this field to `ALL_VOICE_TYPES.length` (7) disables the
   *  cap for desktop / high-core systems. P3 — mobile auto-degrader. */
  private maxVoiceLayers: number = VoiceEngine.detectMaxVoiceLayers();
  private static detectMaxVoiceLayers(): number {
    if (typeof navigator === "undefined") return ALL_VOICE_TYPES.length;
    const cores = navigator.hardwareConcurrency;
    if (typeof cores === "number" && cores > 0 && cores <= 4) return 4;
    return ALL_VOICE_TYPES.length;
  }
  /** Priority order for auto-degradation — cheapest voices first so
   *  they survive when the cap is applied. Matches the relative CPU
   *  cost of each voice at default settings (tanpura = 4 KS loops +
   *  jawari, metal = 12-partial modal stack, etc.). */
  private static readonly VOICE_COST_PRIORITY: readonly VoiceType[] = [
    "tanpura", "air", "fm", "amp", "piano", "reed", "metal",
  ] as const;
  /** Apply the `maxVoiceLayers` cap — returns a copy of `layers` with
   *  the lowest-priority active layers turned off once the active
   *  count exceeds the cap. Called from rebuildIntervals / startDrone
   *  so the cap applies uniformly. */
  private capLayers(layers: Record<VoiceType, boolean>): Record<VoiceType, boolean> {
    const active = VoiceEngine.VOICE_COST_PRIORITY.filter((t) => layers[t]);
    if (active.length <= this.maxVoiceLayers) return layers;
    const keep = new Set(active.slice(0, this.maxVoiceLayers));
    const capped = { ...layers };
    for (const t of ALL_VOICE_TYPES) capped[t] = layers[t] && keep.has(t);
    return capped;
  }
  private readonly baseMacroTC = 0.4;

  private presetMaterialProfile: PresetMaterialProfile = DEFAULT_PRESET_MATERIAL_PROFILE;
  private evolveAmount = 0;
  private materialInterval: number | null = null;
  private materialStep = 0;
  private materialLevelOffsets: Record<VoiceType, number> = {
    tanpura: 0, reed: 0, metal: 0, air: 0, piano: 0, fm: 0, amp: 0,
  };
  private materialDriftScales: Record<VoiceType, number> = {
    tanpura: 1, reed: 1, metal: 1, air: 1, piano: 1, fm: 1, amp: 1,
  };
  private readonly materialPhaseOffsets: Record<VoiceType, number> = {
    tanpura: Math.random() * Math.PI * 2,
    reed: Math.random() * Math.PI * 2,
    metal: Math.random() * Math.PI * 2,
    air: Math.random() * Math.PI * 2,
    piano: Math.random() * Math.PI * 2,
    fm: Math.random() * Math.PI * 2,
    amp: Math.random() * Math.PI * 2,
  };
  private materialPluckFactor = 1;
  private materialSubFactor = 1;

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
  /** Current interval stack in cents, relative to the root. Length
   *  changes with tuning/relation switches; each value is consumed
   *  by the pitch-mandala visualizer to derive the active pitch
   *  classes from ground truth rather than guessing from the FFT. */
  getIntervalsCents(): readonly number[] { return this.droneIntervalsCents; }
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

    const capped = this.capLayers(this.voiceLayers);
    for (const type of ALL_VOICE_TYPES) {
      if (!capped[type]) continue;
      const layerGain = this.ensureLayerGain(type);
      const voices: Voice[] = [];
      for (const c of this.droneIntervalsCents) {
        const voice = buildVoice(type, this.ctx, layerGain, freq, c, this.drift, now, this.reedShape, this.fmRatio, this.fmIndex, this.fmFeedback, this.tanpuraTuning);
        if (type === "tanpura") voice.setPluckRate(this.effectivePluckRate());
        voice.setDrift(this.effectiveLayerDrift(type));
        voices.push(voice);
      }
      this.droneVoicesByLayer.set(type, voices);
    }

    this.subOscs = this.buildSubPair(freq * 0.5, now);
    const attack = this.bloomAttackTime();
    const stackTarget = this.voiceStackGain();
    this.droneVoiceGain.gain.cancelScheduledValues(now);
    this.droneVoiceGain.gain.setValueAtTime(0, now);
    this.droneVoiceGain.gain.linearRampToValueAtTime(stackTarget, now + attack);

    this.subVoiceGain.gain.cancelScheduledValues(now);
    this.subVoiceGain.gain.setValueAtTime(0, now);
    this.subVoiceGain.gain.linearRampToValueAtTime(this.effectiveSubGain(), now + attack);


    this.droneOn = true;
    this.updateMaterialMotion();
  }

  stopDrone(): void {
    if (!this.droneOn) return;
    const now = this.ctx.currentTime;
    const release = 0.6;

    for (const gain of [this.droneVoiceGain, this.subVoiceGain]) {
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(0, now + release);
    }

    this.wetSend.gain.cancelScheduledValues(now);
    this.wetSend.gain.setValueAtTime(this.wetSend.gain.value, now);
    this.wetSend.gain.linearRampToValueAtTime(0, now + release);
    this.fxChain.releaseTails();

    // Pull any still-retiring voices forward so they go silent with the
    // drone instead of lingering past it.
    this.killPendingRetire(now);

    const allVoices: Voice[] = [];
    for (const vs of this.droneVoicesByLayer.values()) {
      for (const v of vs) allVoices.push(v);
    }
    this.droneVoicesByLayer.clear();

    const sub = this.subOscs;
    this.subOscs = null;

    if (this.stopDroneTimeout != null) {
      clearTimeout(this.stopDroneTimeout);
    }
    this.stopDroneTimeout = window.setTimeout(() => {
      this.stopDroneTimeout = null;
      for (const v of allVoices) v.stop();
      if (sub) {
        try { sub.a.stop(); sub.a.disconnect(); } catch { /* ok */ }
        try { sub.b.stop(); sub.b.disconnect(); } catch { /* ok */ }
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
  }

  setIntervals(intervalsCents: number[]): void {
    const next = intervalsCents.length > 0 ? intervalsCents : [0];
    const prevLen = this.droneIntervalsCents.length;
    this.droneIntervalsCents = next;
    if (!this.droneOn) return;
    // Fast path: when the interval count is unchanged we retune the
    // existing voices via their setFreq() param ramp instead of doing
    // a full voice rebuild + bloom crossfade. This matters for real-
    // time use of the fine-tune sliders — a full rebuild would cost a
    // ≥300ms gain dip per slider tick and allocate ~30 AudioWorklet
    // voices per second during a drag. Retune-in-place is click-free
    // and near-zero-cost (one AudioParam ramp per voice per tick).
    if (next.length === prevLen) {
      this.retuneIntervalsInPlace(next);
    } else {
      this.rebuildIntervals();
    }
  }

  /** Retune live voices without rebuilding them. Assumes every layer
   *  already has `cents.length` voices — if the count ever drifts
   *  from that invariant we fall back to a full rebuild so we never
   *  leave stale voices pointing at the wrong frequencies. */
  private retuneIntervalsInPlace(cents: number[]): void {
    const glideSec = 0.02; // 20ms ramp — sub-perceptible, click-free
    for (const voices of this.droneVoicesByLayer.values()) {
      if (voices.length !== cents.length) {
        this.rebuildIntervals();
        return;
      }
      for (let i = 0; i < voices.length; i++) {
        const hz = this.droneRootFreq * Math.pow(2, cents[i] / 1200);
        voices[i].setFreq(hz, glideSec);
      }
    }
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

  /** Select the reed voice's harmonic-stack shape. Takes effect on the
   *  next voice rebuild (preset change / HOLD cycle) — live voices keep
   *  playing with the shape they were built with to avoid clicks. */
  setReedShape(shape: ReedShape): void {
    this.reedShape = shape;
  }

  getReedShape(): ReedShape { return this.reedShape; }

  setFmRatio(ratio: number): void {
    this.fmRatio = Math.max(0.5, Math.min(12, ratio));
  }

  getFmRatio(): number { return this.fmRatio; }

  setFmIndex(index: number): void {
    this.fmIndex = Math.max(0.1, Math.min(12, index));
  }

  getFmIndex(): number { return this.fmIndex; }

  setFmFeedback(fb: number): void {
    this.fmFeedback = Math.max(0, Math.min(1, fb));
  }

  getFmFeedback(): number { return this.fmFeedback; }

  /** Max active voice layers. Set to 7 on desktop, 4 on low-core
   *  devices. Called by AudioEngine once at construction and by the
   *  UI if the user overrides the auto-detected value. */
  setMaxVoiceLayers(n: number): void {
    this.maxVoiceLayers = Math.max(1, Math.min(ALL_VOICE_TYPES.length, Math.floor(n)));
    this.scheduleVoiceRebuild();
  }
  getMaxVoiceLayers(): number { return this.maxVoiceLayers; }

  setTanpuraTuning(id: TanpuraTuningId): void {
    if (this.tanpuraTuning === id) return;
    this.tanpuraTuning = id;
    // Rebuild so the new stringDetune array lands in the worklet —
    // the tuning is only read at voice construction. scheduleVoiceRebuild
    // is a no-op when the drone isn't playing (applies on next start).
    this.scheduleVoiceRebuild();
  }

  getTanpuraTuning(): TanpuraTuningId { return this.tanpuraTuning; }


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

    // Pull forward any still-retiring voices from a prior rebuild —
    // they are at 0.0001 gain but still burning AudioWorklet process()
    // slots. Without this, rapid rebuilds stack voices across the
    // whole bloom tail window and overload the audio thread.
    this.killPendingRetire(now);

    const morphMul = 0.4 + this.morphAmount * 3.6;
    const bloom = Math.min(
      VoiceEngine.MAX_REBUILD_XFADE_SEC,
      Math.max(
        VoiceEngine.MIN_REBUILD_XFADE_SEC,
        this.bloomAttackTime() * morphMul,
      ),
    );

    const targetIntervalCount = this.droneIntervalsCents.length;
    // Apply the mobile auto-degrader cap — pretend the capped-out
    // layers are disabled for this rebuild. Priority order in
    // capLayers keeps cheap voices (tanpura / air / fm) over the
    // expensive ones (reed / metal / piano).
    const capped = this.capLayers(this.voiceLayers);

    // Incremental diff: retire layers that should be off OR whose
    // voice count no longer matches the target interval count; keep
    // every other live layer untouched so unrelated layers don't dip.
    for (const [type, voices] of Array.from(this.droneVoicesByLayer.entries())) {
      const shouldKeep =
        capped[type] && voices.length === targetIntervalCount;
      if (shouldKeep) continue;

      const oldGain = this.layerGains.get(type);
      if (oldGain) {
        const cur = oldGain.gain.value;
        oldGain.gain.cancelScheduledValues(now);
        oldGain.gain.setValueAtTime(cur, now);
        oldGain.gain.linearRampToValueAtTime(0.0001, now + bloom);
        this.layerGains.delete(type);
        this.scheduleRetire(oldGain, voices, bloom);
      }
      this.droneVoicesByLayer.delete(type);
    }

    // Bring up layers that should be on but aren't currently live.
    for (const type of ALL_VOICE_TYPES) {
      if (!capped[type]) continue;
      if (this.droneVoicesByLayer.has(type)) continue;

      const layerGain = this.ctx.createGain();
      layerGain.gain.value = 0;
      layerGain.connect(this.droneVoiceGain);
      layerGain.gain.setValueAtTime(0, now);
      layerGain.gain.linearRampToValueAtTime(this.effectiveLayerLevel(type), now + bloom);
      this.layerGains.set(type, layerGain);

      const voices: Voice[] = [];
      for (const c of this.droneIntervalsCents) {
        const voice = buildVoice(type, this.ctx, layerGain, this.droneRootFreq, c, this.drift, now, this.reedShape, this.fmRatio, this.fmIndex, this.fmFeedback, this.tanpuraTuning);
        if (type === "tanpura") voice.setPluckRate(this.effectivePluckRate());
        voice.setDrift(this.effectiveLayerDrift(type));
        voices.push(voice);
      }
      this.droneVoicesByLayer.set(type, voices);
    }

    // Anchor the current value before setTargetAtTime so repeated
    // rebuilds don't drift (setTargetAtTime alone never converges).
    const vg = this.droneVoiceGain.gain;
    const curVg = vg.value;
    vg.cancelScheduledValues(now);
    vg.setValueAtTime(curVg, now);
    vg.setTargetAtTime(this.voiceStackGain(), now, 0.2);
  }

  private scheduleRetire(gain: GainNode, voices: Voice[], bloom: number): void {
    const stopAtMs = bloom * 1000 + 150;
    const entry: { gain: GainNode; voices: Voice[]; stopTimeout: number } = {
      gain,
      voices,
      stopTimeout: 0,
    };
    entry.stopTimeout = window.setTimeout(() => {
      const idx = this.pendingRetire.indexOf(entry);
      if (idx >= 0) this.pendingRetire.splice(idx, 1);
      for (const voice of voices) {
        try { voice.stop(); } catch { /* ok */ }
      }
      try { gain.disconnect(); } catch { /* ok */ }
    }, stopAtMs);
    this.pendingRetire.push(entry);
  }

  private killPendingRetire(now: number): void {
    if (this.pendingRetire.length === 0) return;
    const entries = this.pendingRetire;
    this.pendingRetire = [];
    for (const entry of entries) {
      clearTimeout(entry.stopTimeout);
      // Fast-fade over 30 ms to avoid a click, then stop + disconnect.
      try {
        const g = entry.gain.gain;
        g.cancelScheduledValues(now);
        g.setValueAtTime(g.value, now);
        g.linearRampToValueAtTime(0, now + 0.03);
      } catch { /* ok */ }
      const { voices, gain } = entry;
      window.setTimeout(() => {
        for (const voice of voices) {
          try { voice.stop(); } catch { /* ok */ }
        }
        try { gain.disconnect(); } catch { /* ok */ }
      }, 50);
    }
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
  }

  private resetMaterialState(): void {
    this.materialLevelOffsets = { tanpura: 0, reed: 0, metal: 0, air: 0, piano: 0, fm: 0, amp: 0 };
    this.materialDriftScales = { tanpura: 1, reed: 1, metal: 1, air: 1, piano: 1, fm: 1, amp: 1 };
    this.materialPluckFactor = 1;
    this.materialSubFactor = 1;
  }
}
