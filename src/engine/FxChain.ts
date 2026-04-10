/**
 * FxChain — a TRUE serial effect chain for the drone bus.
 *
 * Signal flow (fixed order — see EFFECT_ORDER below for the canonical
 * definition; the chain is wired directly from that array so this
 * comment can never drift):
 *
 *   input → TAPE → WOW → SUB → COMB → RINGMOD → FORMANT → DELAY
 *         → PLATE → HALL → SHIMMER → FREEZE → CISTERN → GRANULAR → dryOut
 *
 * Every effect is wrapped in a "wet/bypass crossfade insert": when it
 * is off, its `bypassGain` is 1 and `wetGain` is 0, so the block passes
 * the signal through unchanged. When it is on, `bypassGain` is 0 and
 * `wetGain` is 1, and the signal is fully replaced by the processed
 * output of that effect. Crossfades use `setTargetAtTime` with a soft
 * time-constant so toggling never clicks.
 *
 * AIR macro — scales the wet level of the three reverb-family
 * inserts (PLATE / HALL / SHIMMER) only. Toggling any effect is still
 * a hard on/off; AIR just rides underneath them to set how much reverb
 * colour is present in the chain when enabled.
 *
 * Worklet-backed effects (PLATE, SHIMMER, FREEZE) are created lazily
 * in `onWorkletReady()` after the fxChainProcessor module registers.
 * Until that fires their wet path stays at 0.
 *
 * `wetOut` is retained as a public GainNode for backwards compat with
 * AudioEngine wiring, but it receives no signal — the entire chain
 * output lives on `dryOut`.
 */

export type EffectId =
  | "tape"
  | "wow"
  | "sub"
  | "comb"
  | "delay"
  | "plate"
  | "hall"
  | "shimmer"
  | "freeze"
  | "cistern"
  | "granular"
  | "ringmod"
  | "formant";

/**
 * Canonical serial-chain order. **This is the single source of truth
 * for effect ordering** — the serial chain is wired from this array
 * (see constructor) and the UI (FxBar.tsx) imports it to render
 * buttons, the active-chain preview, and the numeric badges. Do not
 * duplicate this list; if you need the order in another file, import
 * it from here.
 */
export const EFFECT_ORDER: readonly EffectId[] = [
  "tape", "wow", "sub", "comb", "ringmod", "formant", "delay",
  "plate", "hall", "shimmer", "freeze", "cistern", "granular",
] as const;

/** Base crossfade time-constant for the bypass/wet toggle. Scaled
 *  at runtime by the MORPH slider via setMorph() — at MORPH=0 the
 *  toggle is snappy (~0.15 s), at MORPH=1 it's glacial (~2.5 s). */
const XFADE_TC_BASE = 0.45;

/** Per-effect wet trim when the insert is fully engaged. Tweakable
 *  via setEffectLevel() for the settings modal. */
const ON_LEVELS: Record<EffectId, number> = {
  tape: 1.0,
  wow: 1.0,
  sub: 0.9,
  comb: 0.68,
  delay: 0.9,
  plate: 1.0,
  hall: 1.0,
  shimmer: 0.95,
  freeze: 1.0,
  cistern: 1.0,
  granular: 0.9,
  ringmod: 0.7,
  formant: 1.0,
};

interface Insert {
  insertIn: GainNode;
  insertOut: GainNode;
  bypassGain: GainNode;
  wetGain: GainNode;
}

export class FxChain {
  private ctx: AudioContext;
  public input: GainNode;
  public dryOut: GainNode;     // final output of the serial chain
  public wetOut: GainNode;     // retained for compat — silent, unused

  private inserts: Record<EffectId, Insert>;

  // Per-effect DSP references (for param tweaks & tail release)
  private delayNode!: DelayNode;
  private delayFbGain!: GainNode;
  private combDelay!: DelayNode;
  private combFbGain!: GainNode;
  private subBand!: BiquadFilterNode;
  private subLow!: BiquadFilterNode;
  private hallVerb!: ConvolverNode;
  private cisternVerb!: ConvolverNode;

  private plateWorklet: AudioWorkletNode | null = null;
  private shimmerWorklet: AudioWorkletNode | null = null;
  private freezeWorklet: AudioWorkletNode | null = null;
  private granularWorklet: AudioWorkletNode | null = null;

  private enabled: Record<EffectId, boolean> = {
    tape: false, wow: false, sub: false, comb: false, delay: false,
    plate: false, hall: false, shimmer: false, freeze: false,
    cistern: false, granular: false, ringmod: false, formant: false,
  };

  /** Parallel reverb send levels — 0..1 per reverb family effect. When
   *  non-zero, a parallel copy of the effect receives the raw pre-serial
   *  input and mixes its wet output directly into the dry bus. This lets
   *  presets run "dry + wet reverb" without routing the voice through
   *  every serial effect first. Only the big reverbs support parallel. */
  private parallelSendLevels: { plate: number; hall: number; cistern: number } = {
    plate: 0, hall: 0, cistern: 0,
  };
  private parallelBus!: GainNode;
  private parallelHallVerb!: ConvolverNode;
  private parallelHallWet!: GainNode;
  private parallelCisternVerb!: ConvolverNode;
  private parallelCisternWet!: GainNode;
  private parallelPlateWorklet: AudioWorkletNode | null = null;
  private parallelPlateWet!: GainNode;
  private levels: Record<EffectId, number> = { ...ON_LEVELS };
  private delayFeedback = 0.58;
  private combFeedback = 0.68;
  private freezeMix = ON_LEVELS.freeze;
  private airAmount = 0.6;
  private morphAmount = 0.25;
  private get xfadeTC(): number {
    // MORPH 0 → 0.15 s (snappy), MORPH 1 → 2.6 s (glacial)
    return XFADE_TC_BASE * (0.33 + this.morphAmount * 5.5);
  }
  setMorph(v: number): void {
    this.morphAmount = Math.max(0, Math.min(1, v));
  }

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.dryOut = ctx.createGain();
    this.wetOut = ctx.createGain(); // intentionally never sourced

    // Build empty inserts for all 9 effects first so we have the
    // connection points. Each insert's internal DSP is wired below.
    const makeInsert = (): Insert => {
      const insertIn = ctx.createGain();
      const insertOut = ctx.createGain();
      const bypassGain = ctx.createGain();
      const wetGain = ctx.createGain();
      bypassGain.gain.value = 1; // start bypassed
      wetGain.gain.value = 0;
      insertIn.connect(bypassGain).connect(insertOut);
      return { insertIn, insertOut, bypassGain, wetGain };
    };
    this.inserts = {
      tape: makeInsert(),
      wow: makeInsert(),
      sub: makeInsert(),
      comb: makeInsert(),
      delay: makeInsert(),
      plate: makeInsert(),
      hall: makeInsert(),
      shimmer: makeInsert(),
      freeze: makeInsert(),
      cistern: makeInsert(),
      granular: makeInsert(),
      ringmod: makeInsert(),
      formant: makeInsert(),
    };

    // Chain inserts in EFFECT_ORDER, ending with the last one feeding
    // dryOut. This is the one place that wires the DSP order — the
    // UI derives its view from the same exported array.
    this.input.connect(this.inserts[EFFECT_ORDER[0]].insertIn);
    for (let i = 0; i < EFFECT_ORDER.length - 1; i++) {
      this.inserts[EFFECT_ORDER[i]].insertOut.connect(
        this.inserts[EFFECT_ORDER[i + 1]].insertIn,
      );
    }
    this.inserts[EFFECT_ORDER[EFFECT_ORDER.length - 1]].insertOut.connect(this.dryOut);

    this.wireTape();
    this.wireWow();
    this.wireSub();
    this.wireComb();
    this.wireDelay();
    this.wireHall();
    this.wireCistern();
    this.wireRingmod();
    this.wireFormant();
    this.wireParallelReverbBus();
    // plate / shimmer / freeze / granular DSP is created in onWorkletReady()
  }

  /** RING MODULATOR — classic AM-style multiplier using GainNode with a
   *  zero-offset audio-rate oscillator on its .gain AudioParam. Input ×
   *  sin(2π f t) with f ≈ 80 Hz gives inharmonic metallic scrape,
   *  characteristic of Coil / NWW / industrial drones. */
  private wireRingmod(): void {
    const ctx = this.ctx;
    const ins = this.inserts.ringmod;
    const osc = ctx.createOscillator();
    osc.frequency.value = 80;
    osc.start();
    const ringGain = ctx.createGain();
    ringGain.gain.value = 0; // zero-offset = pure ring modulation
    osc.connect(ringGain.gain);
    ins.insertIn.connect(ringGain).connect(ins.wetGain).connect(ins.insertOut);
  }

  /** VOCAL FORMANT — three parallel resonant bandpasses at vowel formant
   *  centres, summed with the dry signal to add a vocal "ahh" accent
   *  without replacing the source spectrum. (Pure bandpass would mute
   *  low-fundamental drones because their energy falls outside the
   *  formant bands.) Tuned to the neutral "ah" vowel. */
  private wireFormant(): void {
    const ctx = this.ctx;
    const ins = this.inserts.formant;

    // Dry pass-through so the fundamental and its partials survive at
    // full level — the effect is purely additive formant colour.
    const dryTap = ctx.createGain();
    dryTap.gain.value = 1.0;
    ins.insertIn.connect(dryTap).connect(ins.wetGain);

    // Formant accent bank — lower Q and gain so it's an additive colour
    const formantGain = ctx.createGain();
    formantGain.gain.value = 0.55;

    const formants = [
      { freq: 700,  Q: 4.5 },
      { freq: 1220, Q: 5   },
      { freq: 2600, Q: 6   },
    ];
    for (const f of formants) {
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = f.freq;
      bp.Q.value = f.Q;
      ins.insertIn.connect(bp).connect(formantGain);
    }
    formantGain.connect(ins.wetGain);
    ins.wetGain.connect(ins.insertOut);
  }

  /** Parallel reverb bus — taps the raw input (pre-serial-chain) and
   *  sums parallel copies of the reverb family (hall, cistern, plate)
   *  back into the dry output. Each parallel reverb has its own wet gain
   *  controlled by `parallelSendLevels`. */
  private wireParallelReverbBus(): void {
    const ctx = this.ctx;
    this.parallelBus = ctx.createGain();
    this.parallelBus.gain.value = 1;
    this.parallelBus.connect(this.dryOut);

    // Parallel hall (native convolver, shares the hall IR generator)
    this.parallelHallVerb = ctx.createConvolver();
    this.parallelHallVerb.buffer = FxChain.makeHallImpulse(ctx, 4.8);
    this.parallelHallWet = ctx.createGain();
    this.parallelHallWet.gain.value = 0;
    this.input
      .connect(this.parallelHallVerb)
      .connect(this.parallelHallWet)
      .connect(this.parallelBus);

    // Parallel cistern (native convolver, shares the cistern IR)
    this.parallelCisternVerb = ctx.createConvolver();
    this.parallelCisternVerb.buffer = FxChain.makeCisternImpulse(ctx, 28);
    this.parallelCisternWet = ctx.createGain();
    this.parallelCisternWet.gain.value = 0;
    this.input
      .connect(this.parallelCisternVerb)
      .connect(this.parallelCisternWet)
      .connect(this.parallelBus);

    // Parallel plate wet gain exists now; the worklet is wired in
    // onWorkletReady() once the fxChainProcessor module has registered.
    this.parallelPlateWet = ctx.createGain();
    this.parallelPlateWet.gain.value = 0;
    this.parallelPlateWet.connect(this.parallelBus);
  }

  // ── Insert wiring helpers ───────────────────────────────────────────

  private wireTape(): void {
    const ctx = this.ctx;
    const ins = this.inserts.tape;
    const pre = ctx.createGain();
    pre.gain.value = 1.3;
    const sat = ctx.createWaveShaper();
    sat.curve = FxChain.makeTapeCurve(2.2);
    sat.oversample = "2x";
    const headBump = ctx.createBiquadFilter();
    headBump.type = "peaking";
    headBump.frequency.value = 82;
    headBump.Q.value = 1.1;
    headBump.gain.value = 3.5;
    const highCut = ctx.createBiquadFilter();
    highCut.type = "highshelf";
    highCut.frequency.value = 6500;
    highCut.gain.value = -5;
    ins.insertIn
      .connect(pre)
      .connect(sat)
      .connect(headBump)
      .connect(highCut)
      .connect(ins.wetGain)
      .connect(ins.insertOut);
  }

  private wireWow(): void {
    const ctx = this.ctx;
    const ins = this.inserts.wow;
    const wowDelay = ctx.createDelay(0.03);
    wowDelay.delayTime.value = 0.008;
    const wowLfo = ctx.createOscillator();
    wowLfo.type = "sine";
    wowLfo.frequency.value = 0.42;      // slower — more tape-era than mechanical
    const wowDepth = ctx.createGain();
    wowDepth.gain.value = 0.0013;       // halved — was too noticeable on drones
    wowLfo.connect(wowDepth).connect(wowDelay.delayTime);
    wowLfo.start();
    const flutterLfo = ctx.createOscillator();
    flutterLfo.type = "sine";
    flutterLfo.frequency.value = 5.4;
    const flutterDepth = ctx.createGain();
    flutterDepth.gain.value = 0.00035;  // softened
    flutterLfo.connect(flutterDepth).connect(wowDelay.delayTime);
    flutterLfo.start();
    ins.insertIn
      .connect(wowDelay)
      .connect(ins.wetGain)
      .connect(ins.insertOut);
  }

  private wireSub(): void {
    const ctx = this.ctx;
    const ins = this.inserts.sub;
    this.subBand = ctx.createBiquadFilter();
    this.subBand.type = "bandpass";
    this.subBand.frequency.value = 110;
    this.subBand.Q.value = 1.2;
    const shaper = ctx.createWaveShaper();
    shaper.curve = FxChain.makeTapeCurve(2.4);
    shaper.oversample = "2x";
    this.subLow = ctx.createBiquadFilter();
    this.subLow.type = "lowpass";
    this.subLow.frequency.value = 170;
    this.subLow.Q.value = 0.707;
    ins.insertIn
      .connect(this.subBand)
      .connect(shaper)
      .connect(this.subLow)
      .connect(ins.wetGain)
      .connect(ins.insertOut);
  }

  private wireComb(): void {
    const ctx = this.ctx;
    const ins = this.inserts.comb;
    this.combDelay = ctx.createDelay(0.05);
    this.combDelay.delayTime.value = 1 / 110;
    this.combFbGain = ctx.createGain();
    this.combFbGain.gain.value = 0; // live only while enabled

    const dcBlock = ctx.createBiquadFilter();
    dcBlock.type = "highpass";
    dcBlock.frequency.value = 25;

    // Soft clipper inside the feedback loop — prevents runaway energy
    // from re-entering the delay. Without this, the 0.85 fixed feedback
    // would let resonant peaks build exponentially until they clipped
    // the output chain. tanh at drive 1.8 catches anything above ~0.55
    // and compresses it smoothly.
    const fbClip = ctx.createWaveShaper();
    fbClip.curve = FxChain.makeTapeCurve(1.8);
    fbClip.oversample = "2x";

    const outFilter = ctx.createBiquadFilter();
    outFilter.type = "lowpass";
    outFilter.frequency.value = 5000;

    ins.insertIn.connect(this.combDelay);
    this.combDelay
      .connect(dcBlock)
      .connect(fbClip)
      .connect(this.combFbGain)
      .connect(this.combDelay);
    this.combDelay.connect(outFilter).connect(ins.wetGain).connect(ins.insertOut);
  }

  private wireDelay(): void {
    const ctx = this.ctx;
    const ins = this.inserts.delay;
    this.delayNode = ctx.createDelay(2.5);
    this.delayNode.delayTime.value = 0.55;
    const fbFilter = ctx.createBiquadFilter();
    fbFilter.type = "lowpass";
    fbFilter.frequency.value = 2600;
    const fbSat = ctx.createWaveShaper();
    fbSat.curve = FxChain.makeTapeCurve(1.5);
    fbSat.oversample = "2x";
    const dcBlock = ctx.createBiquadFilter();
    dcBlock.type = "highpass";
    dcBlock.frequency.value = 20;
    this.delayFbGain = ctx.createGain();
    this.delayFbGain.gain.value = 0;
    ins.insertIn.connect(this.delayNode);
    this.delayNode
      .connect(fbFilter)
      .connect(fbSat)
      .connect(dcBlock)
      .connect(this.delayFbGain)
      .connect(this.delayNode);
    this.delayNode.connect(ins.wetGain).connect(ins.insertOut);
  }

  private wireHall(): void {
    const ctx = this.ctx;
    const ins = this.inserts.hall;
    this.hallVerb = ctx.createConvolver();
    this.hallVerb.buffer = FxChain.makeHallImpulse(ctx, 4.8);
    ins.insertIn
      .connect(this.hallVerb)
      .connect(ins.wetGain)
      .connect(ins.insertOut);
  }

  /** CISTERN — the Fort Worden cistern / cathedral-scale convolver with
   *  a 30-second tail. Native ConvolverNode, same pattern as hall. The
   *  IR is a synthesized exponential-decay noise burst with stretched
   *  early reflections for a cavernous early-to-late transition. */
  private wireCistern(): void {
    const ctx = this.ctx;
    const ins = this.inserts.cistern;
    this.cisternVerb = ctx.createConvolver();
    this.cisternVerb.buffer = FxChain.makeCisternImpulse(ctx, 28);
    ins.insertIn
      .connect(this.cisternVerb)
      .connect(ins.wetGain)
      .connect(ins.insertOut);
  }

  /**
   * Create and wire the three worklet-backed effects once the worklet
   * module has registered its processors. Any effect that was toggled
   * on before the worklet was ready is re-applied here.
   */
  onWorkletReady(): void {
    const ctx = this.ctx;

    // PLATE
    this.plateWorklet = new AudioWorkletNode(ctx, "fx-plate", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    const plateIns = this.inserts.plate;
    plateIns.insertIn
      .connect(this.plateWorklet)
      .connect(plateIns.wetGain)
      .connect(plateIns.insertOut);

    // SHIMMER
    this.shimmerWorklet = new AudioWorkletNode(ctx, "fx-shimmer", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    const shimmerIns = this.inserts.shimmer;
    shimmerIns.insertIn
      .connect(this.shimmerWorklet)
      .connect(shimmerIns.wetGain)
      .connect(shimmerIns.insertOut);

    // FREEZE
    this.freezeWorklet = new AudioWorkletNode(ctx, "fx-freeze", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    this.freezeWorklet.parameters.get("active")!.setValueAtTime(0, ctx.currentTime);
    this.freezeWorklet.parameters.get("mix")!.setValueAtTime(1, ctx.currentTime);
    const freezeIns = this.inserts.freeze;
    freezeIns.insertIn
      .connect(this.freezeWorklet)
      .connect(freezeIns.wetGain)
      .connect(freezeIns.insertOut);

    // GRANULAR — tail processor that captures incoming audio into a ring
    // buffer and plays overlapping grains back with independent
    // pitch/position/pan. Used for Köner/Hecker/Fennesz/Basinski/Biosphere
    // textures.
    this.granularWorklet = new AudioWorkletNode(ctx, "fx-granular", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    const granularIns = this.inserts.granular;
    granularIns.insertIn
      .connect(this.granularWorklet)
      .connect(granularIns.wetGain)
      .connect(granularIns.insertOut);

    // PARALLEL PLATE — second plate worklet instance for the parallel
    // reverb bus. Shares the same DSP as the serial plate but fed by
    // raw input and mixed into the dry bus via parallelPlateWet.
    this.parallelPlateWorklet = new AudioWorkletNode(ctx, "fx-plate", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    this.input.connect(this.parallelPlateWorklet).connect(this.parallelPlateWet);

    // Reapply pending enables for worklet-backed effects
    for (const id of ["plate", "shimmer", "freeze", "granular"] as const) {
      if (this.enabled[id]) this.setEffect(id, true);
    }
    // Reapply parallel send levels (in case a preset was applied before
    // the worklet was ready and set non-zero parallel plate level).
    this.applyParallelSends();
  }

  /** Set per-reverb parallel send levels (0..1). Missing entries default
   *  to 0. Crossfades smoothly. */
  setParallelSends(sends: Partial<{ plate: number; hall: number; cistern: number }>): void {
    this.parallelSendLevels = {
      plate:   Math.max(0, Math.min(1, sends.plate ?? 0)),
      hall:    Math.max(0, Math.min(1, sends.hall ?? 0)),
      cistern: Math.max(0, Math.min(1, sends.cistern ?? 0)),
    };
    this.applyParallelSends();
  }

  private applyParallelSends(): void {
    const now = this.ctx.currentTime;
    const tc = 0.12;
    this.parallelHallWet.gain.setTargetAtTime(this.parallelSendLevels.hall, now, tc);
    this.parallelCisternWet.gain.setTargetAtTime(this.parallelSendLevels.cistern, now, tc);
    this.parallelPlateWet.gain.setTargetAtTime(this.parallelSendLevels.plate, now, tc);
  }

  /** Emergency silence — flush convolver buffers and worklet state so
   *  long tails die instantly. Called by AudioEngine.panic() while the
   *  output trim is ramped to 0. All effects keep running but their
   *  internal state is cleared. */
  panic(): void {
    // Swap convolver buffers to a 1-sample silent buffer to truncate
    // any in-flight reverb tail. Then swap back on the next tick.
    const ctx = this.ctx;
    const empty = ctx.createBuffer(2, 1, ctx.sampleRate);
    const hallBuf = this.hallVerb.buffer;
    const cisternBuf = this.cisternVerb.buffer;
    const parHallBuf = this.parallelHallVerb.buffer;
    const parCisternBuf = this.parallelCisternVerb.buffer;

    try { this.hallVerb.buffer = empty; } catch { /* noop */ }
    try { this.cisternVerb.buffer = empty; } catch { /* noop */ }
    try { this.parallelHallVerb.buffer = empty; } catch { /* noop */ }
    try { this.parallelCisternVerb.buffer = empty; } catch { /* noop */ }

    // Restore the real IRs after a short delay so the next start has
    // the full reverb available again.
    setTimeout(() => {
      try { if (hallBuf) this.hallVerb.buffer = hallBuf; } catch { /* noop */ }
      try { if (cisternBuf) this.cisternVerb.buffer = cisternBuf; } catch { /* noop */ }
      try { if (parHallBuf) this.parallelHallVerb.buffer = parHallBuf; } catch { /* noop */ }
      try { if (parCisternBuf) this.parallelCisternVerb.buffer = parCisternBuf; } catch { /* noop */ }
    }, 220);

    // Post clear messages to worklet-backed effects (plate, shimmer,
    // freeze, granular) so they reset their internal buffers too.
    const clearMsg = { type: "clear" };
    for (const w of [this.plateWorklet, this.shimmerWorklet, this.freezeWorklet, this.granularWorklet, this.parallelPlateWorklet]) {
      if (w) {
        try { w.port.postMessage(clearMsg); } catch { /* noop */ }
      }
    }

    // Zero the delay feedback so the delay line flushes
    const now = ctx.currentTime;
    this.delayFbGain.gain.cancelScheduledValues(now);
    this.delayFbGain.gain.setValueAtTime(0, now);
    // Zero the comb feedback briefly
    this.combFbGain.gain.cancelScheduledValues(now);
    this.combFbGain.gain.setValueAtTime(0, now);
  }

  // ── Public API ─────────────────────────────────────────────────────

  /** Toggle an effect on/off. Smooth-ramped via bypass/wet crossfade. */
  setEffect(id: EffectId, on: boolean): void {
    this.enabled[id] = on;
    const ins = this.inserts[id];
    const now = this.ctx.currentTime;

    // Apply the bypass / wet crossfade. Wet target is per-effect
    // level × (air for reverbs only).
    const wetTarget = on ? this.wetTargetFor(id) : 0;
    const bypassTarget = on ? 0 : 1;
    ins.bypassGain.gain.setTargetAtTime(bypassTarget, now, this.xfadeTC);
    ins.wetGain.gain.setTargetAtTime(wetTarget, now, this.xfadeTC);

    // Effects with persistent internal state need their feedback /
    // activity gates opened with the toggle so tails decay cleanly.
    if (id === "delay") {
      this.delayFbGain.gain.setTargetAtTime(on ? this.delayFeedback : 0, now, this.xfadeTC);
    } else if (id === "comb") {
      this.combFbGain.gain.setTargetAtTime(on ? this.combFeedback : 0, now, this.xfadeTC);
    } else if (id === "freeze" && this.freezeWorklet) {
      this.freezeWorklet.parameters
        .get("active")!
        .setTargetAtTime(on ? 1 : 0, now, 0.08);
    }
  }

  private wetTargetFor(id: EffectId): number {
    const base = this.levels[id];
    // AIR only rides the reverb-family inserts
    if (id === "plate" || id === "hall" || id === "shimmer") {
      return base * this.airAmount;
    }
    return base;
  }

  /** AIR macro — reverb-family wet multiplier (plate / hall / shimmer). */
  setAir(v: number): void {
    this.airAmount = Math.max(0, Math.min(1, v));
    const now = this.ctx.currentTime;
    for (const id of ["plate", "hall", "shimmer"] as const) {
      const target = this.enabled[id] ? this.wetTargetFor(id) : 0;
      this.inserts[id].wetGain.gain.setTargetAtTime(target, now, 0.2);
    }
  }

  isEffect(id: EffectId): boolean { return this.enabled[id]; }

  getEffectStates(): Record<EffectId, boolean> { return { ...this.enabled }; }

  // ── Per-effect parameter accessors (settings modal) ──────────────

  // DELAY
  setDelayTime(sec: number): void {
    this.delayNode.delayTime.setTargetAtTime(Math.max(0.05, Math.min(2, sec)), this.ctx.currentTime, 0.1);
  }
  getDelayTime(): number { return this.delayNode.delayTime.value; }
  setDelayFeedback(fb: number): void {
    this.delayFeedback = Math.max(0, Math.min(0.95, fb));
    this.delayFbGain.gain.setTargetAtTime(this.enabled.delay ? this.delayFeedback : 0, this.ctx.currentTime, 0.1);
  }
  getDelayFeedback(): number { return this.delayFeedback; }

  // COMB
  setCombFeedback(fb: number): void {
    this.combFeedback = Math.max(0, Math.min(0.98, fb));
    this.combFbGain.gain.setTargetAtTime(this.enabled.comb ? this.combFeedback : 0, this.ctx.currentTime, 0.1);
  }
  getCombFeedback(): number { return this.combFeedback; }

  // SUB
  setSubCenter(hz: number): void {
    const f = Math.max(40, Math.min(300, hz));
    this.subBand.frequency.setTargetAtTime(f, this.ctx.currentTime, 0.1);
    this.subLow.frequency.setTargetAtTime(f * 1.5, this.ctx.currentTime, 0.1);
  }
  getSubCenter(): number { return this.subBand.frequency.value; }

  // FREEZE — mix stays at 1 in the worklet; wet is gated by insert
  setFreezeFeedback(v: number): void {
    this.freezeMix = Math.max(0, Math.min(1, v));
    this.levels.freeze = this.freezeMix;
    // Re-apply wet target so the slider moves the audible level
    const now = this.ctx.currentTime;
    this.inserts.freeze.wetGain.gain.setTargetAtTime(
      this.enabled.freeze ? this.wetTargetFor("freeze") : 0, now, this.xfadeTC,
    );
  }
  getFreezeFeedback(): number { return this.freezeMix; }

  /** Set per-effect wet level (the modal's AMOUNT knob). */
  setEffectLevel(id: EffectId, level: number): void {
    const v = Math.max(0, Math.min(1, level));
    this.levels[id] = v;
    if (id === "freeze") this.freezeMix = v;
    const now = this.ctx.currentTime;
    const target = this.enabled[id] ? this.wetTargetFor(id) : 0;
    this.inserts[id].wetGain.gain.setTargetAtTime(target, now, this.xfadeTC);
  }

  getEffectLevel(id: EffectId): number {
    return this.levels[id];
  }

  releaseTails(): void {
    const now = this.ctx.currentTime;
    this.delayFbGain.gain.setTargetAtTime(0, now, 0.08);
    this.combFbGain.gain.setTargetAtTime(0, now, 0.08);
    if (this.freezeWorklet) {
      this.freezeWorklet.parameters.get("active")!.setTargetAtTime(0, now, 0.05);
    }
  }

  restoreEnabledEffects(): void {
    for (const id of EFFECT_ORDER) {
      if (this.enabled[id]) this.setEffect(id, true);
    }
  }

  /** Retune COMB to the root and re-center SUB band when the drone
   *  root changes. Called from AudioEngine.setDroneFreq(). */
  setRootFreq(freq: number): void {
    const now = this.ctx.currentTime;
    const combTime = Math.min(1 / Math.max(20, freq), 0.049);
    this.combDelay.delayTime.setTargetAtTime(combTime, now, 0.1);
    const subCenter = Math.max(40, Math.min(220, freq * 0.5));
    this.subBand.frequency.setTargetAtTime(subCenter, now, 0.1);
    this.subLow.frequency.setTargetAtTime(subCenter * 1.5, now, 0.1);
  }

  // ── Impulse + curve generators ────────────────────────────────────

  /**
   * Hand-authored hall impulse response: early reflections as a set
   * of discrete exponentially-weighted echoes in the first 90 ms,
   * then a diffuse noise tail that decays exponentially.
   */
  private static makeHallImpulse(ctx: AudioContext, seconds: number): AudioBuffer {
    const rate = ctx.sampleRate;
    const length = Math.floor(seconds * rate);
    const buffer = ctx.createBuffer(2, length, rate);

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

    const lateStart = Math.floor(0.09 * rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = lateStart; i < length; i++) {
        const t = (i - lateStart) / (length - lateStart);
        const env = Math.exp(-3.2 * t);
        data[i] = (Math.random() * 2 - 1) * env * 0.35;
      }
      const early = ch === 0 ? earlyL : earlyR;
      for (const ref of early) {
        const idx = Math.floor(ref.t * rate);
        if (idx < length) {
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

  /** Long-tail cistern IR — Fort Worden / cathedral scale, for
   *  Deep-Listening-style 20s+ reverb tails. Sparse early reflections
   *  (cavernous space = widely-spaced early arrivals) then dense
   *  exponential noise decay over the full length. */
  private static makeCisternImpulse(ctx: AudioContext, seconds: number): AudioBuffer {
    const rate = ctx.sampleRate;
    const length = Math.floor(seconds * rate);
    const buffer = ctx.createBuffer(2, length, rate);

    // Sparse widely-spaced early reflections — the "cavern" cue
    const earlyL = [
      { t: 0.04, a: 0.5 },
      { t: 0.11, a: 0.42 },
      { t: 0.22, a: 0.34 },
      { t: 0.38, a: 0.26 },
      { t: 0.58, a: 0.2 },
      { t: 0.82, a: 0.16 },
    ];
    const earlyR = [
      { t: 0.05, a: 0.48 },
      { t: 0.13, a: 0.4 },
      { t: 0.25, a: 0.32 },
      { t: 0.41, a: 0.25 },
      { t: 0.62, a: 0.19 },
      { t: 0.86, a: 0.15 },
    ];

    const lateStart = Math.floor(0.3 * rate);
    // Gentle exponential decay over the full length. 1.2 = very long
    // tail (30s effective RT60 on a 28s buffer).
    const decayCoef = 1.2;
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = lateStart; i < length; i++) {
        const t = (i - lateStart) / (length - lateStart);
        const env = Math.exp(-decayCoef * t);
        data[i] = (Math.random() * 2 - 1) * env * 0.28;
      }
      const early = ch === 0 ? earlyL : earlyR;
      for (const ref of early) {
        const idx = Math.floor(ref.t * rate);
        if (idx < length) {
          for (let j = 0; j < 8; j++) {
            const off = idx + j;
            if (off < length) {
              data[off] += ref.a * (1 - j * 0.11);
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
}
