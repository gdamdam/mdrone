import { FxChain } from "./FxChain";
import type { EngineSceneMutation } from "./EngineSceneMutation";
import type { PresetMotionProfile } from "./presets";
import { DEFAULT_PRESET_MOTION_PROFILE } from "./presets";
import {
  DEFAULT_ENTRAIN,
  ENTRAIN_MAX_HZ,
  ENTRAIN_MIN_HZ,
  type EntrainState,
} from "../entrain";

interface MotionEngineOptions {
  ctx: AudioContext;
  fxChain: FxChain;
  droneFilter: BiquadFilterNode;
  droneVoiceGain: GainNode;
  setDroneFreq: (freq: number) => void;
  getDroneFreq: () => number;
  isPlaying: () => boolean;
  setDrift: (v: number) => void;
  getDrift: () => number;
  setSub: (v: number) => void;
  getSub: () => number;
  setBloom: (v: number) => void;
  getBloom: () => number;
}

export class MotionEngine {
  private readonly ctx: AudioContext;
  private readonly fxChain: FxChain;
  private readonly droneFilter: BiquadFilterNode;
  private readonly droneVoiceGain: GainNode;
  private readonly lfoDepth: GainNode;
  private readonly userLfoDepth: GainNode;
  private readonly setDroneFreqImpl: (freq: number) => void;
  private readonly getDroneFreqImpl: () => number;
  private readonly isPlayingImpl: () => boolean;
  private readonly setDriftImpl: (v: number) => void;
  private readonly getDriftImpl: () => number;
  private readonly setSubImpl: (v: number) => void;
  private readonly getSubImpl: () => number;
  private readonly setBloomImpl: (v: number) => void;
  private readonly getBloomImpl: () => number;
  private readonly sceneMutationListeners = new Set<(mutation: EngineSceneMutation) => void>();

  private lfo: OscillatorNode | null = null;
  private userLfo: OscillatorNode | null = null;
  /** ENTRAIN AM path — a second amplitude modulator that sums into
   *  droneVoiceGain.gain alongside the breathing LFO. Frequency is
   *  integer-locked to the breathing LFO (k = round(rate / breath))
   *  so the two modulators stay in constant relative phase. */
  private entrainLfo: OscillatorNode | null = null;
  private readonly entrainLfoDepth: GainNode;
  private entrainState: EntrainState = { ...DEFAULT_ENTRAIN };
  /** Hardcoded AM depth contribution when ENTRAIN is on. Audible but
   *  not violent — can be surfaced as a user control later. */
  private readonly entrainBaseDepth = 0.15;
  private air = 0.6;
  private time = 0.5;
  private climateX = 0.5;
  private climateY = 0.5;
  private userLfoShape: OscillatorType = "sine";
  private userLfoRate = 0.4;
  private userLfoAmount = 0;
  private readonly baseMacroTC = 0.4;
  private morphAmount = 0.25;
  private evolveAmount = 0;
  private evolveTicks = 0;
  private evolveInterval: number | null = null;
  private presetMotionProfile: PresetMotionProfile = DEFAULT_PRESET_MOTION_PROFILE;

  /** Seeded PRNG state for the evolve loop. Using a seeded source
   *  (instead of Math.random) means a scene + evolve amount + tick
   *  count reproduces the same macro-form across loads — required
   *  for share-scene determinism. */
  private evolveRngState = 0x9e3779b1;

  /** Pitch-locked LFO division. 0 = off (user-set Hz rate applies).
   *  N > 0 locks the user LFO to rootFreq / N so tuning or octave
   *  changes retune the LFO proportionally — Radigue / Éliane-style
   *  beat modulation that tracks the drone. Typical divisions
   *  (1024 / 2048 / 4096) give 0.05–0.5 Hz rates in the normal
   *  drone root range. */
  private lfoDivision = 0;

  /** Active master-gain fade controller. Each call to startFade()
   *  supersedes the previous one (we cancel scheduled values on the
   *  target param). Null means no fade in flight. */
  private fadeCancel: (() => void) | null = null;

  constructor(options: MotionEngineOptions) {
    this.ctx = options.ctx;
    this.fxChain = options.fxChain;
    this.droneFilter = options.droneFilter;
    this.droneVoiceGain = options.droneVoiceGain;
    this.setDroneFreqImpl = options.setDroneFreq;
    this.getDroneFreqImpl = options.getDroneFreq;
    this.isPlayingImpl = options.isPlaying;
    this.setDriftImpl = options.setDrift;
    this.getDriftImpl = options.getDrift;
    this.setSubImpl = options.setSub;
    this.getSubImpl = options.getSub;
    this.setBloomImpl = options.setBloom;
    this.getBloomImpl = options.getBloom;

    this.lfoDepth = this.ctx.createGain();
    this.lfoDepth.gain.value = 600;
    this.lfoDepth.connect(this.droneFilter.frequency);

    this.userLfoDepth = this.ctx.createGain();
    this.userLfoDepth.gain.value = 0;
    this.userLfoDepth.connect(options.droneVoiceGain.gain);

    this.lfo = this.ctx.createOscillator();
    this.lfo.type = "sine";
    this.lfo.frequency.value = MotionEngine.mapTimeToRate(this.time);
    this.lfo.connect(this.lfoDepth);
    this.lfo.start();

    this.userLfo = this.ctx.createOscillator();
    this.userLfo.type = this.userLfoShape;
    this.userLfo.frequency.value = this.userLfoRate;
    this.userLfo.connect(this.userLfoDepth);
    this.userLfo.start();

    // ENTRAIN AM — parallel oscillator whose output sums into the
    // same voice-gain param. Depth stays at 0 until the user enables
    // ENTRAIN via setEntrain(), so the added node is a no-op by
    // default.
    this.entrainLfoDepth = this.ctx.createGain();
    this.entrainLfoDepth.gain.value = 0;
    this.entrainLfoDepth.connect(options.droneVoiceGain.gain);

    this.entrainLfo = this.ctx.createOscillator();
    this.entrainLfo.type = "sine";
    this.entrainLfo.frequency.value = this.computeEntrainHz();
    this.entrainLfo.connect(this.entrainLfoDepth);
    this.entrainLfo.start();

    this.fxChain.setAir(this.air);
  }

  setPresetMorph(v: number): void {
    this.morphAmount = Math.max(0, Math.min(1, v));
  }

  getPresetMorph(): number { return this.morphAmount; }

  setPresetMotionProfile(profile: PresetMotionProfile | null): void {
    this.presetMotionProfile = profile ?? DEFAULT_PRESET_MOTION_PROFILE;
  }

  setEvolve(v: number): void {
    const next = Math.max(0, Math.min(1, v));
    this.evolveAmount = next;
    if (next > 0 && this.evolveInterval == null) {
      this.startEvolveLoop();
    } else if (next === 0 && this.evolveInterval != null) {
      window.clearInterval(this.evolveInterval);
      this.evolveInterval = null;
    }
  }

  getEvolve(): number { return this.evolveAmount; }

  /** Re-seed the evolve PRNG so subsequent walk steps are
   *  deterministic. Called from applyDroneSnapshot with the scene's
   *  stored seed so reloads reproduce the same long-form trajectory. */
  setEvolveSeed(seed: number): void {
    this.evolveRngState = (seed >>> 0) || 0x9e3779b1;
    this.evolveTicks = 0;
  }

  /** Start a master-gain fade to targetLinear over `seconds`.
   *  Cancels any previous fade first so back-to-back fade-in/out
   *  presses don't leave the gain in a surprising state. Returns a
   *  cancel function the caller can stash if it wants to interrupt
   *  mid-ramp. */
  startFade(outputTrimParam: AudioParam, targetLinear: number, seconds: number): () => void {
    if (this.fadeCancel) this.fadeCancel();
    const now = this.ctx.currentTime;
    const dur = Math.max(1, Math.min(3600, seconds));
    try { outputTrimParam.cancelScheduledValues(now); } catch { /* noop */ }
    try {
      outputTrimParam.setValueAtTime(outputTrimParam.value, now);
      // linearRampToValueAtTime over minutes is exactly what we want
      // for a fade-in/out gesture — the browser handles sample-accurate
      // smoothing and we don't need a rAF.
      outputTrimParam.linearRampToValueAtTime(Math.max(0, targetLinear), now + dur);
    } catch { /* noop */ }
    const cancel = () => {
      try { outputTrimParam.cancelScheduledValues(this.ctx.currentTime); } catch { /* noop */ }
    };
    this.fadeCancel = cancel;
    return cancel;
  }

  cancelFade(): void {
    if (this.fadeCancel) {
      this.fadeCancel();
      this.fadeCancel = null;
    }
  }

  /** Lock the user LFO rate to a root-frequency division. 0 = off. */
  setLfoDivision(n: number): void {
    this.lfoDivision = Math.max(0, Math.floor(n));
    this.applyLfoDivision();
  }

  getLfoDivision(): number { return this.lfoDivision; }

  /** Called by AudioEngine whenever the root frequency changes so the
   *  pitch-locked LFO tracks it. No-op when division is 0. */
  notifyRootChanged(): void {
    this.applyLfoDivision();
  }

  private applyLfoDivision(): void {
    if (!this.userLfo || this.lfoDivision <= 0) return;
    const rootHz = this.getDroneFreqImpl();
    const targetHz = Math.max(0.02, Math.min(8, rootHz / this.lfoDivision));
    this.userLfo.frequency.setTargetAtTime(targetHz, this.ctx.currentTime, 0.1);
  }

  // mulberry32 — deterministic PRNG used by the evolve walk.
  private rand(): number {
    let t = (this.evolveRngState = (this.evolveRngState + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Multi-timescale step generator. The classic single-timescale
   *  random walk rattles inside its own range without a macro arc
   *  because every step is the same size. This sums three timescales
   *  (slow → medium → fast) so the trajectory has both fine-grain
   *  wobble AND a slow drift over minutes — the long-form arc drone
   *  audiences expect from a 30–60 minute piece. Weights normalised
   *  so the overall step magnitude matches the old walk at
   *  amplitude 1. */
  private multiScaleStep(): number {
    // Three-octave sum of LF sinusoids, phase-driven by tick count
    // so no wall-clock dependency. Each LFO reads a different
    // fraction of the tick counter with a seeded phase offset.
    const t = this.evolveTicks;
    const phase1 = (this.rand() * 2 - 1);
    const slow = Math.sin(t * 0.018 + phase1 * 3.14) * 0.55;
    const med  = Math.sin(t * 0.072 + phase1 * 1.9) * 0.30;
    const fast = (this.rand() - 0.5) * 0.30;
    return slow + med + fast;
  }

  subscribeSceneMutations(listener: (mutation: EngineSceneMutation) => void): () => void {
    this.sceneMutationListeners.add(listener);
    return () => {
      this.sceneMutationListeners.delete(listener);
    };
  }

  setAir(v: number): void {
    this.air = Math.max(0, Math.min(1, v));
    this.fxChain.setAir(this.air);
  }

  getAir(): number { return this.air; }

  setTime(v: number): void {
    this.time = Math.max(0, Math.min(1, v));
    if (this.lfo) {
      this.lfo.frequency.setTargetAtTime(MotionEngine.mapTimeToRate(this.time), this.ctx.currentTime, this.MACRO_TC);
    }
  }

  getTime(): number { return this.time; }

  setClimateX(v: number): void {
    this.climateX = Math.max(0, Math.min(1, v));
    const now = this.ctx.currentTime;
    const tc = this.MACRO_TC;
    // Filter cutoff: 800 Hz (dark) → 6000 Hz (bright)
    const target = 800 * Math.pow(7.5, this.climateX);
    this.droneFilter.frequency.setTargetAtTime(target, now, tc);
    // Voice gain boost: brighter side slightly louder for presence
    this.droneVoiceGain.gain.setTargetAtTime(
      0.22 + this.climateX * 0.06, now, tc,
    );
  }

  getClimateX(): number { return this.climateX; }

  setClimateY(v: number): void {
    this.climateY = Math.max(0, Math.min(1, v));
    const now = this.ctx.currentTime;
    const tc = this.MACRO_TC;
    // LFO depth: still → motion
    this.lfoDepth.gain.setTargetAtTime(this.climateY * 1200, now, tc);
  }

  getClimateY(): number { return this.climateY; }

  setLfoShape(shape: OscillatorType): void {
    this.userLfoShape = shape;
    if (this.userLfo) this.userLfo.type = shape;
  }

  getLfoShape(): OscillatorType { return this.userLfoShape; }

  setLfoRate(hz: number): void {
    this.userLfoRate = Math.max(0.05, Math.min(8, hz));
    if (this.userLfo) {
      this.userLfo.frequency.setTargetAtTime(this.userLfoRate, this.ctx.currentTime, 0.05);
    }
    // ENTRAIN rate is a multiple of the breathing rate; recompute.
    this.applyEntrain();
  }

  getLfoRate(): number { return this.userLfoRate; }

  /** Push the full ENTRAIN state in one call. Keeps the engine-side
   *  policy (when to modulate, how to quantize the rate) in one
   *  place so useDroneScene only has to forward React state. */
  setEntrain(state: EntrainState): void {
    this.entrainState = { ...state };
    this.applyEntrain();
  }

  getEntrain(): EntrainState { return { ...this.entrainState }; }

  /** Integer-phase-locked entrain rate derived from the breathing
   *  LFO rate. Returns a safe value when breathing is at or below 0. */
  private computeEntrainHz(): number {
    const target = Math.max(ENTRAIN_MIN_HZ, Math.min(ENTRAIN_MAX_HZ, this.entrainState.rateHz));
    const breathing = this.userLfoRate;
    if (!(breathing > 0)) return target;
    const k = Math.max(1, Math.round(target / breathing));
    return k * breathing;
  }

  /** Applies the current entrainState to the ENTRAIN oscillator +
   *  depth gain. Depth is only non-zero when the panel is enabled
   *  AND the mode includes AM ("am" or "both"). "dichotic" on its
   *  own routes through a different path (phase 3). */
  private applyEntrain(): void {
    if (!this.entrainLfo) return;
    const now = this.ctx.currentTime;
    const tc = this.MACRO_TC;
    const hz = this.computeEntrainHz();
    this.entrainLfo.frequency.setTargetAtTime(hz, now, tc);
    const amActive =
      this.entrainState.enabled &&
      (this.entrainState.mode === "am" || this.entrainState.mode === "both");
    this.entrainLfoDepth.gain.setTargetAtTime(amActive ? this.entrainBaseDepth : 0, now, tc);
  }

  setLfoAmount(amt: number): void {
    this.userLfoAmount = Math.max(0, Math.min(1, amt));
    // Scale 0..1 → 0..0.7 of voice gain modulation depth. The old
    // multiplier (0.12) was inaudible at typical preset values (0.03–
    // 0.08 × 0.12 = <1% swing). 0.7 means lfoAmount=1 gives ±70%
    // volume swing (dramatic pumping), and lfoAmount=0.1 gives ±7%
    // (gentle perceptible breathing).
    this.userLfoDepth.gain.setTargetAtTime(this.userLfoAmount * 0.7, this.ctx.currentTime, this.MACRO_TC);
  }

  getLfoAmount(): number { return this.userLfoAmount; }

  private get MACRO_TC(): number {
    return this.baseMacroTC * (0.3 + this.morphAmount * 5.7);
  }

  private emitSceneMutation(mutation: EngineSceneMutation): void {
    if (this.sceneMutationListeners.size === 0) return;
    for (const listener of this.sceneMutationListeners) {
      listener(mutation);
    }
  }

  private startEvolveLoop(): void {
    this.evolveInterval = window.setInterval(() => {
      if (!this.isPlayingImpl() || this.evolveAmount === 0) return;
      this.evolveTicks++;
      const amt = this.evolveAmount;
      const profile = this.presetMotionProfile;
      const mutation: EngineSceneMutation = {};
      // Multi-timescale seeded step. The old walk was a uniform
      // random-walk on 8 s ticks; over 30-60 min listening it rattled
      // ±range without a macro arc. multiScaleStep() sums three
      // timescales (slow drift + medium wobble + fast jitter) and
      // pulls from a seeded PRNG so the arc is reproducible across
      // share-scene reloads.
      const walk = (
        cur: number,
        range: readonly [number, number],
        weight = 1,
      ) => {
        const step = (0.012 + amt * 0.028) * profile.macroStep * weight;
        return MotionEngine.clamp(cur + this.multiScaleStep() * step, range[0], range[1]);
      };

      this.setClimateX(walk(this.climateX, profile.climateXRange, 1));
      mutation.climateX = this.climateX;
      this.setClimateY(walk(this.climateY, profile.climateYRange, 1.1));
      mutation.climateY = this.climateY;
      this.setTime(walk(this.time, profile.timeRange, 0.85));
      mutation.time = this.time;

      const nextBloom = walk(this.getBloomImpl(), profile.bloomRange, 0.8);
      this.setBloomImpl(nextBloom);
      mutation.bloom = this.getBloomImpl();

      const walkPeriod = MotionEngine.resolveWalkPeriod(profile.tonicWalk, amt);
      if (
        profile.tonicWalk !== "none" &&
        profile.tonicIntervals.length > 0 &&
        amt > profile.tonicFloor &&
        this.evolveTicks % walkPeriod === 0
      ) {
        const steps = profile.tonicIntervals;
        const delta = steps[Math.floor(this.rand() * steps.length)];
        const newFreq = this.getDroneFreqImpl() * Math.pow(2, delta / 12);
        if (newFreq >= 40 && newFreq <= 440) {
          this.setDroneFreqImpl(newFreq);
          mutation.rootFreq = this.getDroneFreqImpl();
        }
      }

      if (amt > profile.textureFloor && this.evolveTicks % profile.texturePeriod === 0) {
        const nextDrift = walk(this.getDriftImpl(), profile.driftRange, 0.72);
        this.setDriftImpl(nextDrift);
        mutation.drift = this.getDriftImpl();

        const nextSub = walk(this.getSubImpl(), profile.subRange, 0.6);
        this.setSubImpl(nextSub);
        mutation.sub = this.getSubImpl();
      }

      this.emitSceneMutation(mutation);
    }, 8000);
  }

  private static mapTimeToRate(t: number): number {
    return 0.02 * Math.pow(100, Math.max(0, Math.min(1, t)));
  }

  private static clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  private static resolveWalkPeriod(
    walkMode: PresetMotionProfile["tonicWalk"],
    amount: number,
  ): number {
    if (walkMode === "restless") return Math.max(3, Math.round(8 - amount * 5));
    if (walkMode === "gentle") return Math.max(4, Math.round(11 - amount * 5));
    return Math.max(5, Math.round(14 - amount * 5));
  }
}
