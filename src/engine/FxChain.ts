/**
 * FxChain — the drone effects bus sitting between droneFilter and the
 * master gain. Nine effects, two topologies:
 *
 *  SERIAL INSERTS (colour the whole signal — both dry and wet):
 *    TAPE   — tanh saturation + high-shelf cut (analog warmth)
 *    WOW    — slow wow LFO + fast flutter LFO on a short delay line
 *
 *  PARALLEL SENDS (summed into wetOut):
 *    PLATE  — short dense reverb (EMT-140-style)
 *    HALL   — long airy reverb with pre-delay
 *    SHIMMER— bright highpassed reverb tail
 *    DELAY  — tape-style delay with saturated feedback loop
 *    SUB    — psychoacoustic bass enhancer (bandpass → saturation → lowpass)
 *    COMB   — resonant comb filter tuned to the current drone root
 *    FREEZE — continuous delay-feedback loop, self-sustaining at 0.95 fb
 *
 * Signal flow:
 *
 *    input → TAPE insert → WOW insert → splitNode
 *                                        ├── dryOut ──────────────────►
 *                                        ├── PLATE   ┐
 *                                        ├── HALL    │
 *                                        ├── SHIMMER │
 *                                        ├── DELAY   ├─► wetOut ────►
 *                                        ├── SUB     │
 *                                        ├── COMB    │
 *                                        └── FREEZE  ┘
 *
 * Each effect is a simple on/off toggle in the prototype. When ON the
 * effect's send is at a sensible default; when OFF it's zero-ramped.
 * The AudioEngine's AIR macro scales wetOut before summing with dry.
 */

export type EffectId =
  | "plate"
  | "hall"
  | "shimmer"
  | "delay"
  | "tape"
  | "wow"
  | "sub"
  | "comb"
  | "freeze";

const ALL_EFFECTS: EffectId[] = [
  "plate", "hall", "shimmer", "delay", "tape", "wow", "sub", "comb", "freeze",
];

const RAMP_TC = 0.12;

const ON_LEVELS: Record<EffectId, number> = {
  plate: 0.55,
  hall: 0.45,
  shimmer: 0.5,
  delay: 0.42,
  tape: 1.0,    // serial insert — crossfade handles it
  wow: 1.0,     // serial insert — crossfade handles it
  sub: 0.6,
  comb: 0.4,
  freeze: 0.7,
};

export class FxChain {
  private ctx: AudioContext;
  public input: GainNode;
  public dryOut: GainNode;
  public wetOut: GainNode;

  // TAPE insert (serial)
  private tapeBypass: GainNode;
  private tapeSend: GainNode;
  private tapeOut: GainNode;

  // WOW insert (serial, after TAPE)
  private wowBypass: GainNode;
  private wowSend: GainNode;
  private wowOut: GainNode;

  // Split node — all parallel effects and dry tap from here
  private splitNode: GainNode;

  // Parallel sends
  private plateSend: GainNode;
  private plateVerb: ConvolverNode;

  private hallSend: GainNode;
  private hallVerb: ConvolverNode;

  private shimmerSend: GainNode;
  private shimmerVerb: ConvolverNode;

  private delaySend: GainNode;
  private delayNode: DelayNode;
  private delayFb: GainNode;

  private subSend: GainNode;
  private subBand: BiquadFilterNode;
  private subShaper: WaveShaperNode;
  private subLow: BiquadFilterNode;

  private combSend: GainNode;
  private combDelay: DelayNode;
  private combFb: GainNode;

  private freezeSend: GainNode;
  private freezeDelay: DelayNode;
  private freezeFb: GainNode;
  private freezeWet: GainNode;

  private enabled: Record<EffectId, boolean> = {
    plate: false, hall: false, shimmer: false, delay: false,
    tape: false, wow: false, sub: false, comb: false, freeze: false,
  };

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.dryOut = ctx.createGain();
    this.wetOut = ctx.createGain();

    // ── TAPE serial insert ──────────────────────────────────────────
    this.tapeBypass = ctx.createGain();
    this.tapeBypass.gain.value = 1;
    this.tapeSend = ctx.createGain();
    this.tapeSend.gain.value = 0;
    this.tapeOut = ctx.createGain();

    const tapeSat = ctx.createWaveShaper();
    tapeSat.curve = FxChain.makeTapeCurve(1.8);
    tapeSat.oversample = "2x";
    const tapeHighCut = ctx.createBiquadFilter();
    tapeHighCut.type = "highshelf";
    tapeHighCut.frequency.value = 7000;
    tapeHighCut.gain.value = -4;

    this.input.connect(this.tapeBypass).connect(this.tapeOut);
    this.input.connect(this.tapeSend).connect(tapeSat).connect(tapeHighCut).connect(this.tapeOut);

    // ── WOW serial insert ───────────────────────────────────────────
    this.wowBypass = ctx.createGain();
    this.wowBypass.gain.value = 1;
    this.wowSend = ctx.createGain();
    this.wowSend.gain.value = 0;
    this.wowOut = ctx.createGain();

    const wowDelay = ctx.createDelay(0.03);
    wowDelay.delayTime.value = 0.008;
    const wowLfo = ctx.createOscillator();
    wowLfo.type = "sine";
    wowLfo.frequency.value = 0.55;
    const wowDepth = ctx.createGain();
    wowDepth.gain.value = 0.0025; // ±2.5 ms
    wowLfo.connect(wowDepth).connect(wowDelay.delayTime);
    wowLfo.start();
    const flutterLfo = ctx.createOscillator();
    flutterLfo.type = "sine";
    flutterLfo.frequency.value = 6.2;
    const flutterDepth = ctx.createGain();
    flutterDepth.gain.value = 0.0006;
    flutterLfo.connect(flutterDepth).connect(wowDelay.delayTime);
    flutterLfo.start();

    this.tapeOut.connect(this.wowBypass).connect(this.wowOut);
    this.tapeOut.connect(this.wowSend).connect(wowDelay).connect(this.wowOut);

    // ── Split + dry tap ─────────────────────────────────────────────
    this.splitNode = ctx.createGain();
    this.wowOut.connect(this.splitNode);
    this.splitNode.connect(this.dryOut);

    // ── PLATE ───────────────────────────────────────────────────────
    this.plateVerb = ctx.createConvolver();
    this.plateVerb.buffer = FxChain.makeImpulse(ctx, 1.6, 4.2, 0.018);
    this.plateSend = ctx.createGain();
    this.plateSend.gain.value = 0;
    this.splitNode.connect(this.plateSend).connect(this.plateVerb).connect(this.wetOut);

    // ── HALL ────────────────────────────────────────────────────────
    this.hallVerb = ctx.createConvolver();
    this.hallVerb.buffer = FxChain.makeImpulse(ctx, 4.8, 2.2, 0.06);
    this.hallSend = ctx.createGain();
    this.hallSend.gain.value = 0;
    this.splitNode.connect(this.hallSend).connect(this.hallVerb).connect(this.wetOut);

    // ── SHIMMER ─────────────────────────────────────────────────────
    this.shimmerVerb = ctx.createConvolver();
    this.shimmerVerb.buffer = FxChain.makeImpulse(ctx, 3.5, 1.6, 0.08);
    const shimmerHp = ctx.createBiquadFilter();
    shimmerHp.type = "highpass";
    shimmerHp.frequency.value = 1200;
    this.shimmerSend = ctx.createGain();
    this.shimmerSend.gain.value = 0;
    this.splitNode
      .connect(this.shimmerSend)
      .connect(this.shimmerVerb)
      .connect(shimmerHp)
      .connect(this.wetOut);

    // ── TAPE DELAY ──────────────────────────────────────────────────
    this.delayNode = ctx.createDelay(2.5);
    this.delayNode.delayTime.value = 0.55;
    const delayFbFilter = ctx.createBiquadFilter();
    delayFbFilter.type = "lowpass";
    delayFbFilter.frequency.value = 2600;
    const delayFbSat = ctx.createWaveShaper();
    delayFbSat.curve = FxChain.makeTapeCurve(1.5);
    delayFbSat.oversample = "2x";
    // DC blocker — prevents slow build-up of DC offset in the feedback
    // loop that can appear as low-frequency thumping or clicks.
    const delayDcBlock = ctx.createBiquadFilter();
    delayDcBlock.type = "highpass";
    delayDcBlock.frequency.value = 20;
    // Feedback starts at 0 so the loop is truly silent when DELAY is
    // off. Denormals in a persistently-active feedback loop were the
    // source of the periodic clicks. Toggled up to 0.58 in setEffect.
    this.delayFb = ctx.createGain();
    this.delayFb.gain.value = 0;
    this.delaySend = ctx.createGain();
    this.delaySend.gain.value = 0;
    this.splitNode.connect(this.delaySend).connect(this.delayNode);
    this.delayNode
      .connect(delayFbFilter)
      .connect(delayFbSat)
      .connect(delayDcBlock)
      .connect(this.delayFb)
      .connect(this.delayNode);
    this.delayNode.connect(this.wetOut);

    // ── SUB HARMONIC (bass enhancer) ────────────────────────────────
    // Bandpass the bass region, saturate it, lowpass the result.
    // Psychoacoustic bass bloom — not a true flip-flop sub-octave but
    // the same technique used in MaxxBass / DBX-120-style enhancers.
    this.subBand = ctx.createBiquadFilter();
    this.subBand.type = "bandpass";
    this.subBand.frequency.value = 110;
    this.subBand.Q.value = 1.2;
    this.subShaper = ctx.createWaveShaper();
    this.subShaper.curve = FxChain.makeTapeCurve(2.4);
    this.subShaper.oversample = "2x";
    this.subLow = ctx.createBiquadFilter();
    this.subLow.type = "lowpass";
    this.subLow.frequency.value = 170;
    this.subLow.Q.value = 0.707;
    this.subSend = ctx.createGain();
    this.subSend.gain.value = 0;
    this.splitNode
      .connect(this.subSend)
      .connect(this.subBand)
      .connect(this.subShaper)
      .connect(this.subLow)
      .connect(this.wetOut);

    // ── COMB (resonant comb filter) ─────────────────────────────────
    // Short delay with high feedback = tuned resonance. delayTime is
    // retuned live via setRootFreq() so the comb sings with the drone.
    this.combDelay = ctx.createDelay(0.05);
    this.combDelay.delayTime.value = 1 / 110;
    // Same denormal-loop fix as DELAY — feedback starts at 0.
    this.combFb = ctx.createGain();
    this.combFb.gain.value = 0;
    // DC blocker on the feedback loop
    const combDcBlock = ctx.createBiquadFilter();
    combDcBlock.type = "highpass";
    combDcBlock.frequency.value = 25;
    const combOutFilter = ctx.createBiquadFilter();
    combOutFilter.type = "lowpass";
    combOutFilter.frequency.value = 5000;
    this.combSend = ctx.createGain();
    this.combSend.gain.value = 0;
    this.splitNode.connect(this.combSend).connect(this.combDelay);
    this.combDelay.connect(combDcBlock).connect(this.combFb).connect(this.combDelay);
    this.combDelay.connect(combOutFilter).connect(this.wetOut);

    // ── FREEZE ──────────────────────────────────────────────────────
    this.freezeDelay = ctx.createDelay(4);
    this.freezeDelay.delayTime.value = 1.6;
    this.freezeFb = ctx.createGain();
    this.freezeFb.gain.value = 0;
    // DC blocker on the feedback loop
    const freezeDcBlock = ctx.createBiquadFilter();
    freezeDcBlock.type = "highpass";
    freezeDcBlock.frequency.value = 20;
    this.freezeSend = ctx.createGain();
    this.freezeSend.gain.value = 0;
    this.freezeWet = ctx.createGain();
    this.freezeWet.gain.value = 0;
    this.splitNode.connect(this.freezeSend).connect(this.freezeDelay);
    this.freezeDelay.connect(freezeDcBlock).connect(this.freezeFb).connect(this.freezeDelay);
    this.freezeDelay.connect(this.freezeWet).connect(this.wetOut);
  }

  // ── Public API ─────────────────────────────────────────────────────

  /** Toggle an effect on/off. Smooth-ramped internally. */
  setEffect(id: EffectId, on: boolean): void {
    this.enabled[id] = on;
    const now = this.ctx.currentTime;
    const level = on ? ON_LEVELS[id] : 0;

    switch (id) {
      case "plate":
        this.plateSend.gain.setTargetAtTime(level, now, RAMP_TC);
        break;
      case "hall":
        this.hallSend.gain.setTargetAtTime(level, now, RAMP_TC);
        break;
      case "shimmer":
        this.shimmerSend.gain.setTargetAtTime(level, now, RAMP_TC);
        break;
      case "delay":
        this.delaySend.gain.setTargetAtTime(level, now, RAMP_TC);
        // Also ramp feedback — the loop is only "alive" when the
        // effect is on, which kills the denormal-click problem.
        this.delayFb.gain.setTargetAtTime(on ? 0.58 : 0, now, RAMP_TC);
        break;
      case "tape":
        this.tapeBypass.gain.setTargetAtTime(on ? 0 : 1, now, RAMP_TC);
        this.tapeSend.gain.setTargetAtTime(on ? 1 : 0, now, RAMP_TC);
        break;
      case "wow":
        this.wowBypass.gain.setTargetAtTime(on ? 0 : 1, now, RAMP_TC);
        this.wowSend.gain.setTargetAtTime(on ? 1 : 0, now, RAMP_TC);
        break;
      case "sub":
        this.subSend.gain.setTargetAtTime(level, now, RAMP_TC);
        break;
      case "comb":
        this.combSend.gain.setTargetAtTime(level, now, RAMP_TC);
        this.combFb.gain.setTargetAtTime(on ? 0.85 : 0, now, RAMP_TC);
        break;
      case "freeze":
        this.freezeSend.gain.setTargetAtTime(on ? 0.5 : 0, now, RAMP_TC);
        this.freezeFb.gain.setTargetAtTime(on ? 0.95 : 0, now, RAMP_TC);
        this.freezeWet.gain.setTargetAtTime(on ? level : 0, now, RAMP_TC);
        break;
    }
  }

  isEffect(id: EffectId): boolean { return this.enabled[id]; }

  getEffectStates(): Record<EffectId, boolean> { return { ...this.enabled }; }

  // ── Per-effect parameter accessors (for the settings modal) ───────
  // DELAY
  setDelayTime(sec: number): void {
    this.delayNode.delayTime.setTargetAtTime(Math.max(0.05, Math.min(2, sec)), this.ctx.currentTime, 0.05);
  }
  getDelayTime(): number { return this.delayNode.delayTime.value; }
  setDelayFeedback(fb: number): void {
    this.delayFb.gain.setTargetAtTime(Math.max(0, Math.min(0.95, fb)), this.ctx.currentTime, 0.05);
  }
  getDelayFeedback(): number { return this.delayFb.gain.value; }

  // COMB
  setCombFeedback(fb: number): void {
    this.combFb.gain.setTargetAtTime(Math.max(0, Math.min(0.98, fb)), this.ctx.currentTime, 0.05);
  }
  getCombFeedback(): number { return this.combFb.gain.value; }

  // SUB — center frequency (ignored if root-tracking kicks in afterwards)
  setSubCenter(hz: number): void {
    const f = Math.max(40, Math.min(300, hz));
    this.subBand.frequency.setTargetAtTime(f, this.ctx.currentTime, 0.05);
    this.subLow.frequency.setTargetAtTime(f * 1.5, this.ctx.currentTime, 0.05);
  }
  getSubCenter(): number { return this.subBand.frequency.value; }

  // FREEZE feedback — controls how "infinite" the loop is
  setFreezeFeedback(fb: number): void {
    this.freezeFb.gain.setTargetAtTime(Math.max(0, Math.min(0.99, fb)), this.ctx.currentTime, 0.08);
  }
  getFreezeFeedback(): number { return this.freezeFb.gain.value; }

  // Per-effect wet level override (so the modal can expose AMOUNT)
  setEffectLevel(id: EffectId, level: number): void {
    if (!this.enabled[id]) return;
    const v = Math.max(0, Math.min(1, level));
    const now = this.ctx.currentTime;
    switch (id) {
      case "plate":   this.plateSend.gain.setTargetAtTime(v, now, RAMP_TC); break;
      case "hall":    this.hallSend.gain.setTargetAtTime(v, now, RAMP_TC); break;
      case "shimmer": this.shimmerSend.gain.setTargetAtTime(v, now, RAMP_TC); break;
      case "delay":   this.delaySend.gain.setTargetAtTime(v, now, RAMP_TC); break;
      case "sub":     this.subSend.gain.setTargetAtTime(v, now, RAMP_TC); break;
      case "comb":    this.combSend.gain.setTargetAtTime(v, now, RAMP_TC); break;
      case "freeze":  this.freezeWet.gain.setTargetAtTime(v, now, RAMP_TC); break;
      // TAPE and WOW are serial inserts — no "wet level" concept.
      case "tape":
      case "wow":
        break;
    }
  }

  /**
   * Retune the COMB filter and (re-center the SUB bandpass) when the
   * drone root changes. Called by AudioEngine from setDroneFreq().
   */
  setRootFreq(freq: number): void {
    const now = this.ctx.currentTime;
    // Comb at root (caps at 49 ms to stay under max delay line)
    const combTime = Math.min(1 / Math.max(20, freq), 0.049);
    this.combDelay.delayTime.setTargetAtTime(combTime, now, 0.04);
    // Sub bandpass centered half an octave below the root for bloom
    const subCenter = Math.max(40, Math.min(220, freq * 0.5));
    this.subBand.frequency.setTargetAtTime(subCenter, now, 0.05);
    this.subLow.frequency.setTargetAtTime(subCenter * 1.5, now, 0.05);
  }

  // ── Impulse + curve generators ─────────────────────────────────────

  private static makeImpulse(
    ctx: AudioContext,
    seconds: number,
    decayExp: number,
    preDelay: number,
  ): AudioBuffer {
    const rate = ctx.sampleRate;
    const length = Math.floor(seconds * rate);
    const preSamples = Math.floor(preDelay * rate);
    const buffer = ctx.createBuffer(2, length, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        if (i < preSamples) { data[i] = 0; continue; }
        const t = (i - preSamples) / (length - preSamples);
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decayExp);
      }
    }
    return buffer;
  }

  private static makeTapeCurve(k: number): Float32Array<ArrayBuffer> {
    const n = 1024;
    const curve = new Float32Array(new ArrayBuffer(n * 4));
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1;
      curve[i] = Math.tanh(k * x);
    }
    return curve;
  }

  static readonly ALL: readonly EffectId[] = ALL_EFFECTS;
}
