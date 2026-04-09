import { FxChain } from "./FxChain";
import type { EngineSceneMutation } from "./EngineSceneMutation";
import type { PresetMotionProfile } from "./presets";
import { DEFAULT_PRESET_MOTION_PROFILE } from "./presets";

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

  constructor(options: MotionEngineOptions) {
    this.ctx = options.ctx;
    this.fxChain = options.fxChain;
    this.droneFilter = options.droneFilter;
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
    const target = 400 * Math.pow(15, this.climateX);
    this.droneFilter.frequency.setTargetAtTime(target, this.ctx.currentTime, this.MACRO_TC);
  }

  getClimateX(): number { return this.climateX; }

  setClimateY(v: number): void {
    this.climateY = Math.max(0, Math.min(1, v));
    this.lfoDepth.gain.setTargetAtTime(this.climateY * 1200, this.ctx.currentTime, this.MACRO_TC);
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
  }

  getLfoRate(): number { return this.userLfoRate; }

  setLfoAmount(amt: number): void {
    this.userLfoAmount = Math.max(0, Math.min(1, amt));
    this.userLfoDepth.gain.setTargetAtTime(this.userLfoAmount * 0.12, this.ctx.currentTime, this.MACRO_TC);
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
      const walk = (
        cur: number,
        range: readonly [number, number],
        weight = 1,
      ) => {
        const step = (0.012 + amt * 0.028) * profile.macroStep * weight;
        return MotionEngine.clamp(cur + (Math.random() - 0.5) * step * 2, range[0], range[1]);
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
        const delta = steps[Math.floor(Math.random() * steps.length)];
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
