/**
 * FxChain — the drone effects bus sitting between droneFilter and the
 * master gain. Nine effects, mixed topologies:
 *
 * AudioWorklet-based (loaded via fxChainProcessor.js):
 *   PLATE    — Jon Dattorro's classic plate reverb topology
 *   SHIMMER  — pitch-shift feedback reverb (real shimmer, not a fake)
 *   FREEZE   — ring buffer capture + crossfaded loop (real freeze)
 *
 * Native Web Audio nodes:
 *   TAPE     — tanh saturation + head bump peaking + highshelf cut
 *   WOW      — modulated short delay line (wow + flutter LFOs)
 *   HALL     — ConvolverNode with an early-reflections + late-diffuse IR
 *   DELAY    — DelayNode with lowpass + tanh + DC blocker feedback
 *   SUB      — bandpass → waveshaper → lowpass bass enhancer
 *   COMB     — DelayNode + feedback, delayTime tracks drone root
 *
 * Worklet nodes are created lazily by onWorkletReady() after the
 * fxChainProcessor.js module registers its processors. Before that,
 * the wet sends for PLATE/SHIMMER/FREEZE aren't connected — toggling
 * them has no audible effect for the first ~50 ms. The user won't
 * interact that fast in practice.
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
  plate: 0.75,
  hall: 0.7,
  shimmer: 0.65,
  delay: 0.65,
  tape: 1.0,    // serial insert — crossfade handles it
  wow: 1.0,     // serial insert — crossfade handles it
  sub: 0.7,
  comb: 0.6,
  freeze: 0.8,
};

export class FxChain {
  private ctx: AudioContext;
  public input: GainNode;
  public dryOut: GainNode;
  public wetOut: GainNode;
  // Atmospheric sub-bus — plate, hall and shimmer feed here so the
  // AIR macro only scales the reverb-family effects. Delay, sub,
  // comb, freeze and the serial inserts run at unity into wetOut.
  private airBus: GainNode;

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

  // Parallel sends — PLATE, SHIMMER, FREEZE are worklet-based and
  // created lazily once the fxChainProcessor module has loaded.
  private plateSend: GainNode;
  private plateWorklet: AudioWorkletNode | null = null;

  private hallSend: GainNode;
  private hallVerb: ConvolverNode;

  private shimmerSend: GainNode;
  private shimmerWorklet: AudioWorkletNode | null = null;

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
  private freezeWorklet: AudioWorkletNode | null = null;

  private enabled: Record<EffectId, boolean> = {
    plate: false, hall: false, shimmer: false, delay: false,
    tape: false, wow: false, sub: false, comb: false, freeze: false,
  };
  private levels: Record<EffectId, number> = { ...ON_LEVELS };
  private delayFeedback = 0.58;
  private combFeedback = 0.85;
  private freezeMix = ON_LEVELS.freeze;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.dryOut = ctx.createGain();
    this.wetOut = ctx.createGain();
    this.airBus = ctx.createGain();
    this.airBus.gain.value = 0.6;
    this.airBus.connect(this.wetOut);

    // ── TAPE serial insert ──────────────────────────────────────────
    this.tapeBypass = ctx.createGain();
    this.tapeBypass.gain.value = 1;
    this.tapeSend = ctx.createGain();
    this.tapeSend.gain.value = 0;
    this.tapeOut = ctx.createGain();

    // Tape chain: pre-drive → 2x-oversampled tanh saturation →
    // head bump (peaking around 80 Hz, the characteristic low-mid
    // lift of studio tape machines) → highshelf roll-off (analog-
    // era HF limitation).
    const tapePre = ctx.createGain();
    tapePre.gain.value = 1.3; // push slightly into the saturator
    const tapeSat = ctx.createWaveShaper();
    tapeSat.curve = FxChain.makeTapeCurve(2.2);
    tapeSat.oversample = "2x";
    const tapeHeadBump = ctx.createBiquadFilter();
    tapeHeadBump.type = "peaking";
    tapeHeadBump.frequency.value = 82;
    tapeHeadBump.Q.value = 1.1;
    tapeHeadBump.gain.value = 3.5;
    const tapeHighCut = ctx.createBiquadFilter();
    tapeHighCut.type = "highshelf";
    tapeHighCut.frequency.value = 6500;
    tapeHighCut.gain.value = -5;

    this.input.connect(this.tapeBypass).connect(this.tapeOut);
    this.input
      .connect(this.tapeSend)
      .connect(tapePre)
      .connect(tapeSat)
      .connect(tapeHeadBump)
      .connect(tapeHighCut)
      .connect(this.tapeOut);

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

    // ── PLATE (worklet — created in onWorkletReady) ─────────────────
    this.plateSend = ctx.createGain();
    this.plateSend.gain.value = 0;
    this.splitNode.connect(this.plateSend);
    // plateSend → plateWorklet → wetOut (wired after worklet loads)

    // ── HALL (native convolver with a richer impulse) ───────────────
    // Hand-authored IR: early reflections (4 discrete echo peaks in the
    // first 80 ms) blended with a late diffuse noise tail so it feels
    // like a real room rather than pure noise decay.
    this.hallVerb = ctx.createConvolver();
    this.hallVerb.buffer = FxChain.makeHallImpulse(ctx, 4.8);
    this.hallSend = ctx.createGain();
    this.hallSend.gain.value = 0;
    this.splitNode.connect(this.hallSend).connect(this.hallVerb).connect(this.airBus);

    // ── SHIMMER (worklet — created in onWorkletReady) ───────────────
    this.shimmerSend = ctx.createGain();
    this.shimmerSend.gain.value = 0;
    this.splitNode.connect(this.shimmerSend);
    // shimmerSend → shimmerWorklet → wetOut (wired after worklet loads)

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

    // ── FREEZE (worklet — created in onWorkletReady) ────────────────
    // The freezeSend gain gates input into the freeze worklet. The
    // worklet's own "active" AudioParam handles the capture/release.
    this.freezeSend = ctx.createGain();
    this.freezeSend.gain.value = 1; // always routed — worklet handles toggling
    // splitNode → freezeSend → freezeWorklet → wetOut (wired on ready)
    this.splitNode.connect(this.freezeSend);
  }

  /**
   * Called by AudioEngine once both worklet modules have loaded.
   * Creates the worklet-backed effect nodes (plate, shimmer, freeze)
   * and wires them into the already-built send graph.
   */
  onWorkletReady(): void {
    // ── Plate ────────────────────────────────────────────────────
    this.plateWorklet = new AudioWorkletNode(this.ctx, "fx-plate", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    this.plateSend.connect(this.plateWorklet).connect(this.airBus);

    // ── Shimmer ──────────────────────────────────────────────────
    this.shimmerWorklet = new AudioWorkletNode(this.ctx, "fx-shimmer", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    this.shimmerSend.connect(this.shimmerWorklet).connect(this.airBus);

    // ── Freeze ───────────────────────────────────────────────────
    this.freezeWorklet = new AudioWorkletNode(this.ctx, "fx-freeze", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    // Freeze starts inactive (active=0) — flip to 1 in setEffect
    this.freezeWorklet.parameters.get("active")!.setValueAtTime(0, this.ctx.currentTime);
    this.freezeWorklet.parameters.get("mix")!.setValueAtTime(0, this.ctx.currentTime);
    this.freezeSend.connect(this.freezeWorklet).connect(this.wetOut);

    // If any of these effects were toggled on before the worklet
    // loaded, reapply the state now so they actually produce sound.
    for (const id of ["plate", "shimmer", "freeze"] as const) {
      if (this.enabled[id]) this.setEffect(id, true);
    }
  }

  // ── Public API ─────────────────────────────────────────────────────

  /** Toggle an effect on/off. Smooth-ramped internally. */
  setEffect(id: EffectId, on: boolean): void {
    this.enabled[id] = on;
    const now = this.ctx.currentTime;
    const level = on ? this.levels[id] : 0;

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
        this.delayFb.gain.setTargetAtTime(on ? this.delayFeedback : 0, now, RAMP_TC);
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
        this.combFb.gain.setTargetAtTime(on ? this.combFeedback : 0, now, RAMP_TC);
        break;
      case "freeze":
        // Drive the worklet's `active` AudioParam — the processor
        // uses a ring buffer and handles capture/loop/crossfade
        // internally. When off, it bypasses and resumes writing.
        if (this.freezeWorklet) {
          this.freezeWorklet.parameters.get("active")!.setTargetAtTime(on ? 1 : 0, now, 0.05);
          this.freezeWorklet.parameters.get("mix")!.setTargetAtTime(on ? this.freezeMix : 0, now, RAMP_TC);
        }
        break;
    }
  }

  /** AIR macro — scales only the atmospheric sub-bus (plate/hall/shimmer).
   *  Delay/sub/comb/freeze/tape/wow run at unity so they're always audible
   *  when toggled on, independent of AIR. */
  setAir(v: number): void {
    const a = Math.max(0, Math.min(1, v));
    this.airBus.gain.setTargetAtTime(a, this.ctx.currentTime, 0.08);
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
    this.delayFeedback = Math.max(0, Math.min(0.95, fb));
    this.delayFb.gain.setTargetAtTime(this.enabled.delay ? this.delayFeedback : 0, this.ctx.currentTime, 0.05);
  }
  getDelayFeedback(): number { return this.delayFeedback; }

  // COMB
  setCombFeedback(fb: number): void {
    this.combFeedback = Math.max(0, Math.min(0.98, fb));
    this.combFb.gain.setTargetAtTime(this.enabled.comb ? this.combFeedback : 0, this.ctx.currentTime, 0.05);
  }
  getCombFeedback(): number { return this.combFeedback; }

  // SUB — center frequency (ignored if root-tracking kicks in afterwards)
  setSubCenter(hz: number): void {
    const f = Math.max(40, Math.min(300, hz));
    this.subBand.frequency.setTargetAtTime(f, this.ctx.currentTime, 0.05);
    this.subLow.frequency.setTargetAtTime(f * 1.5, this.ctx.currentTime, 0.05);
  }
  getSubCenter(): number { return this.subBand.frequency.value; }

  // FREEZE feedback — controls how "infinite" the loop is
  /** FREEZE has no feedback param in the worklet implementation
   *  (it's a real capture, not a decaying feedback loop). The HOLD
   *  slider in the modal now maps to the freeze wet mix. */
  setFreezeFeedback(v: number): void {
    this.freezeMix = Math.max(0, Math.min(1, v));
    this.levels.freeze = this.freezeMix;
    if (this.freezeWorklet) {
      this.freezeWorklet.parameters.get("mix")!.setTargetAtTime(
        this.enabled.freeze ? this.freezeMix : 0, this.ctx.currentTime, 0.08
      );
    }
  }
  getFreezeFeedback(): number {
    return this.freezeMix;
  }

  // Per-effect wet level override (so the modal can expose AMOUNT)
  setEffectLevel(id: EffectId, level: number): void {
    const v = Math.max(0, Math.min(1, level));
    this.levels[id] = v;
    if (id === "freeze") this.freezeMix = v;
    const now = this.ctx.currentTime;
    const audible = this.enabled[id] ? v : 0;
    switch (id) {
      case "plate":   this.plateSend.gain.setTargetAtTime(audible, now, RAMP_TC); break;
      case "hall":    this.hallSend.gain.setTargetAtTime(audible, now, RAMP_TC); break;
      case "shimmer": this.shimmerSend.gain.setTargetAtTime(audible, now, RAMP_TC); break;
      case "delay":   this.delaySend.gain.setTargetAtTime(audible, now, RAMP_TC); break;
      case "sub":     this.subSend.gain.setTargetAtTime(audible, now, RAMP_TC); break;
      case "comb":    this.combSend.gain.setTargetAtTime(audible, now, RAMP_TC); break;
      case "freeze":
        if (this.freezeWorklet) {
          this.freezeWorklet.parameters.get("mix")!.setTargetAtTime(audible, now, RAMP_TC);
        }
        break;
      // TAPE and WOW are serial inserts — no "wet level" concept.
      case "tape":
      case "wow":
        break;
    }
  }

  getEffectLevel(id: EffectId): number {
    return this.levels[id];
  }

  releaseTails(): void {
    const now = this.ctx.currentTime;
    this.delayFb.gain.setTargetAtTime(0, now, 0.05);
    this.combFb.gain.setTargetAtTime(0, now, 0.05);
    if (this.freezeWorklet) {
      this.freezeWorklet.parameters.get("active")!.setTargetAtTime(0, now, 0.03);
      this.freezeWorklet.parameters.get("mix")!.setTargetAtTime(0, now, 0.05);
    }
  }

  restoreEnabledEffects(): void {
    for (const id of ALL_EFFECTS) {
      if (this.enabled[id]) this.setEffect(id, true);
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

    // ── Impulse + curve generators ────────────────────────────────────

  /**
   * Hand-authored hall impulse response: early reflections as a set
   * of discrete exponentially-weighted echoes in the first 90 ms,
   * then a diffuse noise tail that decays exponentially over
   * `seconds`. The early reflections give the hall a "position" —
   * you hear walls and size — and the tail gives it depth.
   */
  private static makeHallImpulse(ctx: AudioContext, seconds: number): AudioBuffer {
    const rate = ctx.sampleRate;
    const length = Math.floor(seconds * rate);
    const buffer = ctx.createBuffer(2, length, rate);

    // Early reflection positions (seconds) and amplitudes per channel.
    // The L/R asymmetry gives stereo width without decorrelation.
    const earlyL = [
      { t: 0.012, a: 0.55 },
      { t: 0.024, a: 0.42 },
      { t: 0.041, a: 0.35 },
      { t: 0.063, a: 0.28 },
      { t: 0.082, a: 0.22 },
    ];
    const earlyR = [
      { t: 0.014, a: 0.52 },
      { t: 0.029, a: 0.38 },
      { t: 0.047, a: 0.33 },
      { t: 0.068, a: 0.25 },
      { t: 0.089, a: 0.20 },
    ];

    const lateStart = Math.floor(0.09 * rate); // tail begins at 90 ms
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      // Diffuse noise tail
      for (let i = lateStart; i < length; i++) {
        const t = (i - lateStart) / (length - lateStart);
        // Slightly curved decay — exp(-4t) gives a dense but natural fall
        const env = Math.exp(-3.2 * t);
        data[i] = (Math.random() * 2 - 1) * env * 0.35;
      }
      // Early reflections — add them on top
      const early = ch === 0 ? earlyL : earlyR;
      for (const ref of early) {
        const idx = Math.floor(ref.t * rate);
        if (idx < length) {
          // Small 5-sample burst at each early reflection point
          for (let j = 0; j < 5; j++) {
            const off = idx + j;
            if (off < length) {
              data[off] += ref.a * (1 - j * 0.15);
            }
          }
        }
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
