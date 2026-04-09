/**
 * AudioEngine — mdrone master bus. Prototype version.
 *
 * Signal flow (same Option B master chain as mloop so MixerView ports cleanly):
 *   droneVoice → masterGain → hpf → eqLow → eqMid → eqHigh
 *              → glueComp → glueMakeup
 *              → drivePre → drive → drivePost
 *              → limiter → outputTrim → analyser → destination
 *
 * The drone voice itself is a placeholder additive stack — two detuned
 * sawtooth oscillators summed through a gentle lowpass. The real
 * additive-sine-partial engine lands in v1 of the instrument; this is
 * just enough to let the layout prototype actually make sound.
 *
 * FxChain owns the 9 drone-specific effects (PLATE/HALL/SHIMMER/DELAY/
 * TAPE/WOW/SUB/COMB/FREEZE) and sits between droneFilter and masterGain.
 */

import { FxChain } from "./FxChain";
import type { EffectId } from "./FxChain";
import { buildVoice, ALL_VOICE_TYPES, type Voice, type VoiceType } from "./VoiceBuilder";
// Vite `?url` import — returns a content-addressable URL at build time,
// served directly in dev. Used with audioWorklet.addModule() to register
// the DroneVoiceProcessor.
import droneWorkletUrl from "./droneVoiceProcessor.js?url";
import fxWorkletUrl from "./fxChainProcessor.js?url";

export class AudioEngine {
  ctx: AudioContext;

  // Drone voice stack — one Voice per interval from the root, PER
  // active voice layer. Any combination of voice types can play
  // simultaneously (Stars of the Lid layering, Eno multi-loop).
  // Each active layer has its own level gain node feeding into
  // droneVoiceGain, so layers can be mixed independently.
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
  private droneVoiceGain: GainNode;

  // Worklet readiness — loaded once in the constructor; startDrone
  // queues if the user interacts before the module registers.
  private isWorkletReady = false;
  private pendingStart: { freq: number; intervalsCents: number[] } | null = null;

  // Sub octave voice (DEPTH macro) — one triangle pair at root/2.
  private subOscs: { a: OscillatorNode; b: OscillatorNode } | null = null;
  private subVoiceGain: GainNode;
  private subAmount = 0;

  // Shimmer voice — octave-up saw pair that feeds the FX chain. Its
  // level is tied to the SHIMMER *effect* toggle (no separate macro):
  // enable the effect and the octave voice rises with it.
  private shimmerOscs: { a: OscillatorNode; b: OscillatorNode } | null = null;
  private shimmerVoiceGain: GainNode;

  // BLOOM — attack time on the voice-stack fade-in. 0.3..10 s.
  private bloomAmount = 0.15; // ≈0.8 s attack by default
  private droneFilter: BiquadFilterNode;
  private droneOn = false;

  // Macro state — audible even without proper weather engine
  private drift = 0.3;                        // 0..1 → ±25¢ detune spread
  private air = 0.6;                          // 0..1 → wet reverb send
  private time = 0.5;                         // 0..1 → LFO rate 0.02..2 Hz
  private glideAmount = 0.15;                 // 0..1 → 0.05..8 s tonic glide

  // Atmosphere send — drives the FxChain wet output level (AIR macro)
  private wetSend: GainNode;
  private fxChain: FxChain;
  private presetTrim!: GainNode;

  // Slow LFO modulating the drone filter for movement
  private lfo: OscillatorNode | null = null;
  private lfoDepth: GainNode;

  // Climate XY state — X=brightness (filter base freq), Y=motion (LFO depth mult)
  private climateX = 0.5;
  private climateY = 0.5;

  // Optional user LFO that modulates the drone voice gain for a
  // breathing/tremolo effect. Off (depth=0) by default.
  private userLfo: OscillatorNode | null = null;
  private userLfoDepth: GainNode;
  private userLfoTarget: GainNode;     // summing node → droneVoiceGain.gain
  private userLfoShape: OscillatorType = "sine";
  private userLfoRate = 0.4;
  private userLfoAmount = 0;

  // Master chain (mirror of mloop's Option B)
  private masterGain: GainNode;
  private hpf: BiquadFilterNode;
  private eqLow: BiquadFilterNode;
  private eqMid: BiquadFilterNode;
  private eqHigh: BiquadFilterNode;
  private glueComp: DynamicsCompressorNode;
  private glueMakeup: GainNode;
  private drivePre: GainNode;
  private drive: WaveShaperNode;
  private drivePost: GainNode;
  private limiter: DynamicsCompressorNode;
  private limiterEnabled = true;
  private limiterCeiling = -1;
  private outputTrim: GainNode;
  private analyser: AnalyserNode;

  constructor() {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AC({ sampleRate: 44100 });

    // ── Drone voice stack ────────────────────────────────────────────
    this.droneVoiceGain = this.ctx.createGain();
    this.droneVoiceGain.gain.value = 0.25; // conservative — drones stack
    this.droneFilter = this.ctx.createBiquadFilter();
    this.droneFilter.type = "lowpass";
    this.droneFilter.frequency.value = 2400;
    this.droneFilter.Q.value = 0.5;
    this.droneVoiceGain.connect(this.droneFilter);

    // Sub voice — joins the main filter path, so DEPTH feels like the
    // same instrument getting heavier rather than a separate layer.
    this.subVoiceGain = this.ctx.createGain();
    this.subVoiceGain.gain.value = 0;
    this.subVoiceGain.connect(this.droneFilter);

    // Shimmer voice — bypasses the main filter and goes straight to
    // the reverb input, so the shimmer is the reverb "tail octave"
    // rather than the dry sound getting brighter.
    this.shimmerVoiceGain = this.ctx.createGain();
    this.shimmerVoiceGain.gain.value = 0;

    // ── Atmosphere send (AIR macro) ─────────────────────────────────
    // FxChain handles all 9 drone effects. AIR scales its wet output.
    this.fxChain = new FxChain(this.ctx);
    this.wetSend = this.ctx.createGain();
    this.wetSend.gain.value = 1;
    this.fxChain.setAir(this.air);
    // Preset trim — per-preset loudness normalization (A). Sits just
    // before the FxChain input so it scales dry + wet together.
    this.presetTrim = this.ctx.createGain();
    this.presetTrim.gain.value = 1;
    // Drone voice + shimmer voice both feed the FxChain input via trim
    this.droneFilter.connect(this.presetTrim);
    this.shimmerVoiceGain.connect(this.presetTrim);
    this.presetTrim.connect(this.fxChain.input);
    this.fxChain.wetOut.connect(this.wetSend);

    // ── LFO on drone filter (TIME macro drives rate) ────────────────
    this.lfoDepth = this.ctx.createGain();
    this.lfoDepth.gain.value = 600; // modulates filter cutoff by ±600 Hz
    this.lfoDepth.connect(this.droneFilter.frequency);

    // ── User LFO (tremolo on voice gain) ─────────────────────────────
    this.userLfoDepth = this.ctx.createGain();
    this.userLfoDepth.gain.value = 0; // amount = 0 by default
    this.userLfoTarget = this.ctx.createGain();
    this.userLfoTarget.gain.value = 1;
    // Sum: userLfoTarget directly drives an offset on the voice gain
    this.userLfoDepth.connect(this.droneVoiceGain.gain);

    // ── Master chain ────────────────────────────────────────────────
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 1;

    this.hpf = this.ctx.createBiquadFilter();
    this.hpf.type = "highpass";
    this.hpf.frequency.value = 10; // effectively off
    this.hpf.Q.value = 0.707;

    this.eqLow = this.ctx.createBiquadFilter();
    this.eqLow.type = "lowshelf";
    this.eqLow.frequency.value = 250;
    this.eqLow.gain.value = 0;

    this.eqMid = this.ctx.createBiquadFilter();
    this.eqMid.type = "peaking";
    this.eqMid.frequency.value = 1000;
    this.eqMid.Q.value = 1;
    this.eqMid.gain.value = 0;

    this.eqHigh = this.ctx.createBiquadFilter();
    this.eqHigh.type = "highshelf";
    this.eqHigh.frequency.value = 4000;
    this.eqHigh.gain.value = 0;

    this.glueComp = this.ctx.createDynamicsCompressor();
    this.glueComp.threshold.value = 0;
    this.glueComp.ratio.value = 2;
    this.glueComp.attack.value = 0.03;
    this.glueComp.release.value = 0.25;
    this.glueComp.knee.value = 6;
    this.glueMakeup = this.ctx.createGain();
    this.glueMakeup.gain.value = 1;

    this.drivePre = this.ctx.createGain();
    this.drivePre.gain.value = 1;
    this.drive = this.ctx.createWaveShaper();
    this.drive.curve = AudioEngine.makeDriveCurve(1);
    this.drive.oversample = "2x";
    this.drivePost = this.ctx.createGain();
    this.drivePost.gain.value = 1;

    this.limiter = this.ctx.createDynamicsCompressor();
    this.limiter.threshold.value = this.limiterCeiling;
    this.limiter.ratio.value = 12;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.1;
    this.limiter.knee.value = 6;

    this.outputTrim = this.ctx.createGain();
    this.outputTrim.gain.value = 1;

    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;

    // Wire it all up
    this.fxChain.dryOut.connect(this.masterGain); // dry (post TAPE/WOW insert)
    this.wetSend.connect(this.masterGain);        // wet (all parallel sends × AIR)
    this.masterGain.connect(this.hpf);

    // Start the slow LFO running continuously (its depth gates whether
    // it's audible). TIME macro retunes its frequency.
    this.lfo = this.ctx.createOscillator();
    this.lfo.type = "sine";
    this.lfo.frequency.value = AudioEngine.mapTimeToRate(this.time);
    this.lfo.connect(this.lfoDepth);
    this.lfo.start();

    // Start the user LFO too — depth=0 means inaudible until user raises AMOUNT.
    this.userLfo = this.ctx.createOscillator();
    this.userLfo.type = this.userLfoShape;
    this.userLfo.frequency.value = this.userLfoRate;
    this.userLfo.connect(this.userLfoDepth);
    this.userLfo.start();

    // Load the drone voice worklet asynchronously. The user won't
    // interact for at least a few hundred ms so this normally lands
    // before the first startDrone call; if it doesn't, startDrone
    // queues via workletReady.
    // Load both worklet modules in parallel. FxChain needs the fx
    // module to be registered before its AudioWorkletNodes can be
    // constructed — AudioEngine forwards the readiness promise to it.
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

    this.hpf.connect(this.eqLow);
    this.eqLow.connect(this.eqMid);
    this.eqMid.connect(this.eqHigh);
    this.eqHigh.connect(this.glueComp);
    this.glueComp.connect(this.glueMakeup);
    this.glueMakeup.connect(this.drivePre);
    this.drivePre.connect(this.drive);
    this.drive.connect(this.drivePost);
    this.drivePost.connect(this.limiter);
    this.limiter.connect(this.outputTrim);
    this.outputTrim.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);
  }

  // ── Drone voice control ───────────────────────────────────────────
  /**
   * Start the drone at a root frequency with a list of interval offsets
   * in cents. Each interval spawns a detuned oscillator pair and the
   * whole stack fades in together. If the drone is already playing, the
   * root is retuned and the interval stack is rebuilt in place.
   */
  startDrone(freq: number, intervalsCents: number[] = [0]): void {
    this.droneRootFreq = freq;
    this.droneIntervalsCents = intervalsCents.length > 0 ? intervalsCents : [0];
    this.fxChain.setRootFreq(freq);

    if (!this.isWorkletReady) {
      this.pendingStart = {
        freq,
        intervalsCents: [...this.droneIntervalsCents],
      };
      return;
    }

    if (this.droneOn) {
      this.setDroneFreq(freq);
      this.rebuildIntervals();
      return;
    }

    const now = this.ctx.currentTime;
    this.fxChain.restoreEnabledEffects();
    this.wetSend.gain.cancelScheduledValues(now);
    this.wetSend.gain.setTargetAtTime(this.air * 0.8, now, 0.05);

    // Build voices for every active layer. Each layer gets its own
    // per-layer gain node so levels can be set independently, and each
    // layer contributes one voice per interval in the current chord.
    for (const type of ALL_VOICE_TYPES) {
      if (!this.voiceLayers[type]) continue;
      const layerGain = this.ensureLayerGain(type);
      const voices: Voice[] = [];
      for (const c of this.droneIntervalsCents) {
        voices.push(
          buildVoice(type, this.ctx, layerGain, freq, c, this.drift, now)
        );
      }
      this.droneVoicesByLayer.set(type, voices);
    }

    // Sub octave — a separate triangle pair one octave below the root
    this.subOscs = this.buildSubPair(freq * 0.5, now);

    // Shimmer octave — saw pair one octave above the root, routed to reverb
    this.shimmerOscs = this.buildShimmerPair(freq * 2, now);

    // Fade in — BLOOM controls how long. Maps 0..1 to 0.3..10 s.
    const attack = this.bloomAttackTime();
    const stackTarget = this.voiceStackGain();
    this.droneVoiceGain.gain.cancelScheduledValues(now);
    this.droneVoiceGain.gain.setValueAtTime(0, now);
    this.droneVoiceGain.gain.linearRampToValueAtTime(stackTarget, now + attack);

    // Sub / shimmer follow the same bloom so everything rises together,
    // but their *target* is the user's amount setting.
    this.subVoiceGain.gain.cancelScheduledValues(now);
    this.subVoiceGain.gain.setValueAtTime(0, now);
    this.subVoiceGain.gain.linearRampToValueAtTime(this.subAmount * 0.3, now + attack);

    // Shimmer voice gain stays 0 until the SHIMMER effect is toggled on.
    this.shimmerVoiceGain.gain.cancelScheduledValues(now);
    this.shimmerVoiceGain.gain.setValueAtTime(0, now);
    if (this.fxChain.isEffect("shimmer")) {
      this.shimmerVoiceGain.gain.linearRampToValueAtTime(0.25, now + attack);
    }

    this.droneOn = true;
  }

  stopDrone(): void {
    this.pendingStart = null;
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

    // Snapshot all layer voices and clear the maps so a re-entrant
    // startDrone doesn't collide with the still-fading voices.
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
  }

  /** Retune every layer's voice stack to a new root frequency.
   *  Glide time is driven by the GLIDE macro. */
  setDroneFreq(freq: number): void {
    this.droneRootFreq = freq;
    this.fxChain.setRootFreq(freq);
    const now = this.ctx.currentTime;
    const glide = this.glideTime();

    // Every layer — each Voice in that layer retunes to its interval
    for (const voices of this.droneVoicesByLayer.values()) {
      for (let i = 0; i < voices.length; i++) {
        const interval = this.droneIntervalsCents[i] ?? 0;
        const target = freq * Math.pow(2, interval / 1200);
        voices[i].setFreq(target, glide);
      }
    }
    // Sub / shimmer are still plain osc pairs (fixed type by design)
    if (this.subOscs) this.glideOscPair(this.subOscs, freq * 0.5, now, glide);
    if (this.shimmerOscs) this.glideOscPair(this.shimmerOscs, freq * 2, now, glide);
  }

  private glideOscPair(
    pair: { a: OscillatorNode; b: OscillatorNode },
    target: number,
    now: number,
    glide: number,
  ): void {
    for (const o of [pair.a, pair.b]) {
      o.frequency.cancelScheduledValues(now);
      o.frequency.setValueAtTime(o.frequency.value, now);
      o.frequency.linearRampToValueAtTime(target, now + glide);
    }
  }

  /**
   * Swap in a new interval set while playing. Called by DroneView when
   * the user changes mode — recomputes the oscillator stack without
   * interrupting the root voice.
   */
  setIntervals(intervalsCents: number[]): void {
    this.droneIntervalsCents = intervalsCents.length > 0 ? intervalsCents : [0];
    if (this.droneOn) this.rebuildIntervals();
  }

  /**
   * Rebuild the oscillator pairs in place: gracefully stop the old
   * stack and start a new one. Uses a very short crossfade so mode
   * changes feel like breathing rather than cutting.
   */
  private rebuildIntervals(): void {
    const now = this.ctx.currentTime;
    // MORPH slider scales the rebuild bloom: at morph=0 the voice
    // crossfade is still honoured by BLOOM but capped to 0.3 s; at
    // morph=1 the crossfade stretches up to 4× the normal bloom,
    // making preset swaps glacial.
    const morphMul = 0.4 + this.morphAmount * 3.6;
    const bloom = Math.max(0.3, this.bloomAttackTime() * morphMul);

    // Retire the current layer gains with a fade-out. Each retiring
    // gain keeps the old voices alive through the fade so we get a
    // real per-voice cross-fade rather than a 400 ms hard swap.
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

    // Build fresh layer gains and voices with a matching fade-in.
    for (const type of ALL_VOICE_TYPES) {
      if (!this.voiceLayers[type]) continue;
      const layerGain = this.ctx.createGain();
      layerGain.gain.value = 0;
      layerGain.connect(this.droneVoiceGain);
      layerGain.gain.setValueAtTime(0, now);
      layerGain.gain.linearRampToValueAtTime(this.layerLevels[type], now + bloom);
      this.layerGains.set(type, layerGain);

      const voices: Voice[] = [];
      for (const c of this.droneIntervalsCents) {
        const v = buildVoice(type, this.ctx, layerGain, this.droneRootFreq, c, this.drift, now);
        if (type === "tanpura") v.setPluckRate(this.tanpuraPluckRate);
        voices.push(v);
      }
      this.droneVoicesByLayer.set(type, voices);
    }

    // After the fade completes, stop the retired voices and drop
    // their gain nodes. Small tail margin so the ramp fully lands.
    const stopAtMs = bloom * 1000 + 150;
    setTimeout(() => {
      for (const r of retiring) {
        for (const v of r.voices) {
          try { v.stop(); } catch { /* ok */ }
        }
        try { r.gain.disconnect(); } catch { /* ok */ }
      }
    }, stopAtMs);

    this.droneVoiceGain.gain.cancelScheduledValues(now);
    this.droneVoiceGain.gain.setTargetAtTime(this.voiceStackGain(), now, 0.2);
  }

  // ── Voice layering API ────────────────────────────────────────────
  /** Enable or disable a voice layer. Any combination can be active. */
  setVoiceLayer(type: VoiceType, on: boolean): void {
    if (this.voiceLayers[type] === on) return;
    this.voiceLayers[type] = on;
    this.scheduleVoiceRebuild();
  }
  getVoiceLayer(type: VoiceType): boolean { return this.voiceLayers[type]; }
  getVoiceLayers(): Record<VoiceType, boolean> { return { ...this.voiceLayers }; }

  /** Set a layer's mix level 0..1 (live, ramped). */
  setVoiceLevel(type: VoiceType, level: number): void {
    const v = Math.max(0, Math.min(1, level));
    this.layerLevels[type] = v;
    const gain = this.layerGains.get(type);
    if (gain) {
      const now = this.ctx.currentTime;
      gain.gain.setTargetAtTime(v, now, 0.08);
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
          gain.gain.setTargetAtTime(this.layerLevels[type], this.ctx.currentTime, 0.08);
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
          gain.gain.setTargetAtTime(this.layerLevels[type], this.ctx.currentTime, 0.08);
        }
      }
      this.voiceRebuildPending = true;
    } finally {
      this.voiceUpdateDepth--;
      this.flushVoiceRebuild();
    }
  }

  /** Ensure a GainNode exists for a layer and is wired to droneVoiceGain. */
  private ensureLayerGain(type: VoiceType): GainNode {
    let g = this.layerGains.get(type);
    if (!g) {
      g = this.ctx.createGain();
      g.gain.value = this.layerLevels[type];
      g.connect(this.droneVoiceGain);
      this.layerGains.set(type, g);
    }
    return g;
  }

  /** Compatibility shim — pick a single voice, turning off the others. */
  setVoiceType(type: VoiceType): void {
    for (const t of ALL_VOICE_TYPES) {
      this.voiceLayers[t] = t === type;
    }
    this.scheduleVoiceRebuild();
  }
  /** First active layer, for legacy callers that still want a scalar. */
  getVoiceType(): VoiceType {
    for (const t of ALL_VOICE_TYPES) {
      if (this.voiceLayers[t]) return t;
    }
    return "tanpura";
  }

  /** Sub pair — triangle waves one octave below for a clean low-end bloom. */
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

  /** Shimmer pair — saw one octave up, routed straight into the reverb. */
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

  /** Bloom attack time in seconds — 0.3 s at bloom=0, 10 s at bloom=1. */
  private bloomAttackTime(): number {
    return 0.3 + this.bloomAmount * 9.7;
  }

  /** Total stack gain scaled down as more intervals are added. */
  private voiceStackGain(): number {
    return 0.25 / Math.sqrt(Math.max(1, this.droneIntervalsCents.length));
  }

  isPlaying(): boolean { return this.droneOn; }

  /**
   * Resume the underlying AudioContext if it's suspended. Modern
   * browsers create contexts in "suspended" state until a user gesture
   * — call this from the first pointerdown so audio starts flowing.
   * Safe to call repeatedly.
   */
  resume(): Promise<void> {
    if (this.ctx.state === "suspended") return this.ctx.resume();
    return Promise.resolve();
  }

  getRecordingSupport(): { supported: boolean; reason?: string } {
    if (typeof MediaRecorder === "undefined") {
      return { supported: false, reason: "This browser does not support MediaRecorder." };
    }
    const supportsWebm =
      MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ||
      MediaRecorder.isTypeSupported("audio/webm");
    if (!supportsWebm) {
      return {
        supported: false,
        reason: "This browser cannot export the WebM audio stream mdrone uses for WAV rendering.",
      };
    }
    return { supported: true };
  }

  // ── Master WAV recording ──────────────────────────────────────────
  private recDest: MediaStreamAudioDestinationNode | null = null;
  private recorder: MediaRecorder | null = null;
  private recChunks: Blob[] = [];

  /**
   * Start capturing the master output to a WAV file. Taps the analyser
   * via a MediaStreamAudioDestinationNode + MediaRecorder. On stop, the
   * captured WebM/Opus is decoded back to an AudioBuffer, encoded to
   * 16-bit PCM WAV, and downloaded with a timestamped filename.
   *
   * This path captures the FINAL master output (post-limiter, post-trim)
   * because we tap `analyser` which sits at the end of the chain.
   */
  async startMasterRecording(): Promise<void> {
    if (this.recorder) return;
    const support = this.getRecordingSupport();
    if (!support.supported) {
      throw new Error(support.reason ?? "Master recording is unavailable in this browser.");
    }
    if (this.ctx.state === "suspended") await this.ctx.resume();
    this.recDest = this.ctx.createMediaStreamDestination();
    this.analyser.connect(this.recDest);
    this.recChunks = [];

    // Browser MediaRecorder produces WebM/Opus — we'll decode+re-encode to WAV on stop.
    const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : "audio/webm";
    this.recorder = new MediaRecorder(this.recDest.stream, { mimeType: mime });
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.recChunks.push(e.data);
    };
    this.recorder.start(200);
  }

  /**
   * Stop the recording, decode the captured Blob, encode as 16-bit PCM
   * WAV, and trigger a download in the browser.
   */
  async stopMasterRecording(): Promise<void> {
    if (!this.recorder || !this.recDest) return;
    const chunks = this.recChunks;
    const rec = this.recorder;

    const stopPromise = new Promise<void>((resolve) => {
      rec.onstop = () => resolve();
    });
    rec.stop();
    await stopPromise;

    try { this.analyser.disconnect(this.recDest); } catch { /* ok */ }
    this.recorder = null;
    this.recDest = null;

    const blob = new Blob(chunks, { type: chunks[0]?.type ?? "audio/webm" });
    if (blob.size === 0) return;

    // Decode the WebM/Opus blob back to a raw AudioBuffer, then write a WAV.
    const arrayBuf = await blob.arrayBuffer();
    const decoded = await this.ctx.decodeAudioData(arrayBuf.slice(0));
    const wav = AudioEngine.encodeWav(decoded);
    const wavBlob = new Blob([wav], { type: "audio/wav" });

    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(wavBlob);
    a.download = `mdrone-${ts}.wav`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  isRecording(): boolean { return this.recorder !== null; }

  /** 16-bit PCM WAV encoder for an AudioBuffer. */
  private static encodeWav(buffer: AudioBuffer): ArrayBuffer {
    const numCh = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const length = buffer.length;
    const bytesPerSample = 2;
    const blockAlign = numCh * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = length * blockAlign;
    const totalSize = 44 + dataSize;

    const ab = new ArrayBuffer(totalSize);
    const view = new DataView(ab);
    const writeString = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    };

    // RIFF header
    writeString(0, "RIFF");
    view.setUint32(4, totalSize - 8, true);
    writeString(8, "WAVE");
    // fmt chunk
    writeString(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);          // PCM
    view.setUint16(22, numCh, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true);         // bits per sample
    // data chunk
    writeString(36, "data");
    view.setUint32(40, dataSize, true);

    // Interleave channels, convert Float32 → Int16
    const chans: Float32Array[] = [];
    for (let c = 0; c < numCh; c++) chans.push(buffer.getChannelData(c));
    let offset = 44;
    for (let i = 0; i < length; i++) {
      for (let c = 0; c < numCh; c++) {
        const s = Math.max(-1, Math.min(1, chans[c][i]));
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        offset += 2;
      }
    }
    return ab;
  }

  // ── Macro setters ─────────────────────────────────────────────────
  // Macro ramp time-constant. Slower than "instant" so preset swaps
  // feel like a gentle morph. Scaled by the morph multiplier below.
  private baseMacroTC = 0.4;
  /** 0..1 from the MORPH slider in the DroneView presets panel.
   *  Scales both the macro TC and the voice-rebuild bloom so preset
   *  transitions can glide from ~0.3 s up to ~6 s per macro and from
   *  the preset's bloomAttackTime() up to 4× that on the voice stack. */
  private morphAmount = 0.25;
  private get MACRO_TC(): number {
    // morph 0 → 0.12 s (snappy), 1 → 2.4 s (glacial)
    return this.baseMacroTC * (0.3 + this.morphAmount * 5.7);
  }
  setPresetMorph(v: number): void {
    this.morphAmount = Math.max(0, Math.min(1, v));
    this.fxChain.setMorph(this.morphAmount);
  }
  getPresetMorph(): number { return this.morphAmount; }

  // ── Preset self-evolution ────────────────────────────────────────
  /** 0..1 — how strongly the drone drifts and walks while playing.
   *   0       = static
   *   0..0.4  = gentle macro drift (climate, bloom meander ±0.15)
   *   0.4..0.7 = + tonic walk (±P4/P5) every ~75 s
   *   0.7..1  = + drift rate climbs, walks more often */
  private evolveAmount = 0;
  private evolveTicks = 0;
  private evolveInterval: number | null = null;
  setEvolve(v: number): void {
    const next = Math.max(0, Math.min(1, v));
    this.evolveAmount = next;
    if (next > 0 && this.evolveInterval == null) {
      this.startEvolveLoop();
    } else if (next === 0 && this.evolveInterval != null) {
      clearInterval(this.evolveInterval);
      this.evolveInterval = null;
    }
  }
  getEvolve(): number { return this.evolveAmount; }

  /** Tanpura re-pluck rate multiplier 0.2..4. Applies to every active
   *  tanpura voice immediately and to any voices built afterward. */
  private tanpuraPluckRate = 1;
  setTanpuraPluckRate(v: number): void {
    this.tanpuraPluckRate = Math.max(0.2, Math.min(4, v));
    for (const voices of this.droneVoicesByLayer.values()) {
      for (const voice of voices) voice.setPluckRate(this.tanpuraPluckRate);
    }
  }
  getTanpuraPluckRate(): number { return this.tanpuraPluckRate; }

  private startEvolveLoop(): void {
    // 8 s tick. Clearly audible but still meditative-slow. All param
    // changes glide through MACRO_TC so each tick itself is a smooth
    // movement rather than a step.
    this.evolveInterval = window.setInterval(() => {
      if (!this.droneOn || this.evolveAmount === 0) return;
      this.evolveTicks++;
      const amt = this.evolveAmount;

      // 1. Macro drift — bigger enough random walks that changes
      //    are clearly audible within ~1 minute. Accumulates across
      //    many ticks into long drifts.
      const step = 0.02 + amt * 0.05;
      const walk = (cur: number) =>
        Math.max(0, Math.min(1, cur + (Math.random() - 0.5) * step));
      this.setClimateX(walk(this.climateX));
      this.setClimateY(walk(this.climateY));
      this.setBloom(walk(this.bloomAmount));

      // 2. Tonic walk — at evolve > 0.4, walk ±P4/P5. Period
      //    shortens with amount: amt=0.4 → ~90 s; amt=1 → ~40 s.
      const walkPeriod = Math.max(5, Math.round(12 - amt * 7));
      if (amt > 0.4 && this.evolveTicks % walkPeriod === 0) {
        const steps = [-7, -5, 5, 7];
        const delta = steps[Math.floor(Math.random() * steps.length)];
        const newFreq = this.droneRootFreq * Math.pow(2, delta / 12);
        if (newFreq >= 40 && newFreq <= 440) {
          this.setDroneFreq(newFreq);
        }
      }

      // 3. At evolve > 0.7 — perturb drift + sub every ~40 s
      if (amt > 0.7 && this.evolveTicks % 5 === 0) {
        this.setDrift(walk(this.drift));
        this.setSub(walk(this.subAmount));
      }
    }, 8000);
  }


  /** DRIFT 0..1 — normalized drift amount. Voices across all active
   *  layers get the new drift; sub/shimmer keep the legacy cent spread. */
  setDrift(v: number): void {
    this.drift = Math.max(0, Math.min(1, v));
    const spread = this.drift * 25;
    const now = this.ctx.currentTime;
    for (const voices of this.droneVoicesByLayer.values()) {
      for (const voice of voices) voice.setDrift(this.drift);
    }
    const apply = (pair: { a: OscillatorNode; b: OscillatorNode }) => {
      pair.a.detune.setTargetAtTime(-spread, now, 0.05);
      pair.b.detune.setTargetAtTime(spread, now, 0.05);
    };
    if (this.subOscs) apply(this.subOscs);
    if (this.shimmerOscs) apply(this.shimmerOscs);
  }
  getDrift(): number { return this.drift; }

  /** AIR 0..1 — global wet mix for all FxChain parallel effects. */
  setAir(v: number): void {
    this.air = Math.max(0, Math.min(1, v));
    this.fxChain.setAir(this.air);
  }
  getAir(): number { return this.air; }

  /** Per-preset loudness trim (A). 1.0 = unity; <1 quieter, >1 louder.
   *  Clamped to a safe range so a broken preset can't blow the limiter. */
  setPresetTrim(v: number): void {
    const trim = Math.max(0.1, Math.min(4, v));
    this.presetTrim.gain.setTargetAtTime(trim, this.ctx.currentTime, 0.08);
  }

  // ── FxChain passthrough API ───────────────────────────────────────
  /**
   * Toggle a drone effect by id. SHIMMER is special: it also drives
   * the octave-up voice gain so the effect button both enables the
   * bright reverb *and* raises the octave source.
   */
  setEffect(id: EffectId, on: boolean): void {
    this.fxChain.setEffect(id, on);
    if (id === "shimmer" && this.droneOn) {
      const now = this.ctx.currentTime;
      this.shimmerVoiceGain.gain.setTargetAtTime(on ? 0.25 : 0, now, 0.15);
    }
  }
  isEffect(id: EffectId): boolean { return this.fxChain.isEffect(id); }
  getEffectStates(): Record<EffectId, boolean> { return this.fxChain.getEffectStates(); }

  /** Expose FxChain directly for the effect config modals. */
  getFxChain(): FxChain { return this.fxChain; }

  /** TIME 0..1 — LFO rate (0.02..2 Hz) driving the filter sweep. */
  setTime(v: number): void {
    this.time = Math.max(0, Math.min(1, v));
    if (this.lfo) {
      const now = this.ctx.currentTime;
      this.lfo.frequency.setTargetAtTime(AudioEngine.mapTimeToRate(this.time), now, this.MACRO_TC);
    }
  }
  getTime(): number { return this.time; }

  // ── Climate XY ────────────────────────────────────────────────────
  /** Climate X 0..1 — DARK ↔ BRIGHT. Tilts the drone filter cutoff. */
  setClimateX(v: number): void {
    this.climateX = Math.max(0, Math.min(1, v));
    // 400 Hz (dark) → 6000 Hz (bright), exponential
    const target = 400 * Math.pow(15, this.climateX);
    const now = this.ctx.currentTime;
    this.droneFilter.frequency.setTargetAtTime(target, now, this.MACRO_TC);
  }
  getClimateX(): number { return this.climateX; }

  /** Climate Y 0..1 — STILL ↔ MOTION. Scales the filter-sweep LFO depth. */
  setClimateY(v: number): void {
    this.climateY = Math.max(0, Math.min(1, v));
    const now = this.ctx.currentTime;
    // 0 = no sweep, 1 = ±1200 Hz filter sweep
    this.lfoDepth.gain.setTargetAtTime(this.climateY * 1200, now, this.MACRO_TC);
  }
  getClimateY(): number { return this.climateY; }

  // ── User LFO (breathing / tremolo) ───────────────────────────────
  /** LFO shape — sine / triangle / square / sawtooth. */
  setLfoShape(shape: OscillatorType): void {
    this.userLfoShape = shape;
    if (this.userLfo) this.userLfo.type = shape;
  }
  getLfoShape(): OscillatorType { return this.userLfoShape; }

  /** LFO rate in Hz (0.05..8). */
  setLfoRate(hz: number): void {
    this.userLfoRate = Math.max(0.05, Math.min(8, hz));
    if (this.userLfo) {
      const now = this.ctx.currentTime;
      this.userLfo.frequency.setTargetAtTime(this.userLfoRate, now, 0.05);
    }
  }
  getLfoRate(): number { return this.userLfoRate; }

  /** LFO amount 0..1 — how much it modulates the drone voice gain. */
  setLfoAmount(amt: number): void {
    this.userLfoAmount = Math.max(0, Math.min(1, amt));
    const now = this.ctx.currentTime;
    // Max depth ±0.12 on voice gain — subtle breathing at full, never silent.
    this.userLfoDepth.gain.setTargetAtTime(this.userLfoAmount * 0.12, now, this.MACRO_TC);
  }
  getLfoAmount(): number { return this.userLfoAmount; }

  // ── Sub / Bloom macros ───────────────────────────────────────────
  /** DEPTH / SUB 0..1 — level of the −1 octave triangle voice. */
  setSub(v: number): void {
    this.subAmount = Math.max(0, Math.min(1, v));
    if (this.droneOn) {
      const now = this.ctx.currentTime;
      this.subVoiceGain.gain.setTargetAtTime(this.subAmount * 0.3, now, this.MACRO_TC);
    }
  }
  getSub(): number { return this.subAmount; }

  /** BLOOM 0..1 — slow-attack time on next startDrone(). */
  setBloom(v: number): void {
    this.bloomAmount = Math.max(0, Math.min(1, v));
  }
  getBloom(): number { return this.bloomAmount; }

  /** GLIDE 0..1 — how slowly the drone retunes when the tonic changes.
   *  0 = almost instant (50 ms), 1 = very slow (8 s). Exponential curve
   *  so the middle of the slider sits around a musical 0.6 s. */
  setGlide(v: number): void {
    this.glideAmount = Math.max(0, Math.min(1, v));
  }
  getGlide(): number { return this.glideAmount; }

  /** Current glide time in seconds (read by setDroneFreq). */
  private glideTime(): number {
    return 0.05 * Math.pow(160, this.glideAmount); // 0.05..8 s exponential
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

  // ── Master accessors (same API shape as mloop) ───────────────────
  getMasterNode(): GainNode { return this.masterGain; }
  getAnalyser(): AnalyserNode { return this.analyser; }
  getEqLow(): BiquadFilterNode { return this.eqLow; }
  getEqMid(): BiquadFilterNode { return this.eqMid; }
  getEqHigh(): BiquadFilterNode { return this.eqHigh; }
  getLimiter(): DynamicsCompressorNode { return this.limiter; }
  getOutputTrim(): GainNode { return this.outputTrim; }

  /** Master output volume 0..1.5 (linear), smooth-ramped. Matches the
   *  mixer VOL strip range so both controls share the same scale. */
  setMasterVolume(v: number): void {
    const vol = Math.max(0, Math.min(1.5, v));
    this.outputTrim.gain.setTargetAtTime(vol, this.ctx.currentTime, 0.05);
  }
  getMasterVolume(): number { return this.outputTrim.gain.value; }

  setHpfFreq(hz: number): void { this.hpf.frequency.value = Math.max(10, hz); }
  getHpfFreq(): number { return this.hpf.frequency.value; }

  setGlueAmount(amount: number): void {
    const a = Math.max(0, Math.min(1, amount));
    this.glueComp.threshold.value = -18 * a;
    this.glueMakeup.gain.value = 1 + a * 0.5;
  }
  getGlueAmount(): number { return -this.glueComp.threshold.value / 18; }

  setLimiterEnabled(on: boolean): void {
    this.limiterEnabled = on;
    if (on) {
      this.limiter.threshold.value = this.limiterCeiling;
      this.limiter.ratio.value = 12;
    } else {
      this.limiter.threshold.value = 0;
      this.limiter.ratio.value = 1;
    }
  }
  isLimiterEnabled(): boolean { return this.limiterEnabled; }

  setLimiterCeiling(dB: number): void {
    this.limiterCeiling = Math.max(-24, Math.min(0, dB));
    if (this.limiterEnabled) this.limiter.threshold.value = this.limiterCeiling;
  }
  getLimiterCeiling(): number { return this.limiterCeiling; }

  setDrive(amount: number): void {
    const a = Math.max(1, Math.min(10, amount));
    this.drivePre.gain.value = a;
    this.drive.curve = AudioEngine.makeDriveCurve(a);
    this.drivePost.gain.value = 1 / Math.sqrt(a);
  }
  getDrive(): number { return this.drivePre.gain.value; }

  /** Map TIME (0..1) exponentially to LFO rate 0.02..2 Hz. */
  private static mapTimeToRate(t: number): number {
    // Exponential so the middle of the slider feels musical.
    return 0.02 * Math.pow(100, Math.max(0, Math.min(1, t)));
  }

  private static makeDriveCurve(amount: number): Float32Array<ArrayBuffer> {
    const n = 1024;
    const curve = new Float32Array(new ArrayBuffer(n * 4));
    const k = amount;
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1;
      curve[i] = Math.tanh(k * x);
    }
    return curve;
  }
}
