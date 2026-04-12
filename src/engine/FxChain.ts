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
  | "graincloud"
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
  "plate", "hall", "shimmer", "freeze", "cistern", "granular", "graincloud",
] as const;

/**
 * Derive the ordered enabled-effect chain from a snapshot's
 * `effects` record. Returns the canonical EFFECT_ORDER-ordered list
 * of effect ids whose flag is true. The output is guaranteed to pass
 * `validateChain` by construction — this helper exists so callers
 * can convert the Record<EffectId, boolean> storage form into the
 * ordered-array form that validateChain (and any future chain
 * consumers) expect, without re-implementing the filter each time.
 */
export function enabledChainFromSnapshot(
  effects: Record<EffectId, boolean>,
): EffectId[] {
  return EFFECT_ORDER.filter((id) => effects[id] === true);
}

/**
 * Validate a serial chain of enabled effects.
 *
 * Returns true iff `chain`:
 * - is an array of known EffectId strings (no unknown entries)
 * - contains no duplicate effect types
 * - preserves EFFECT_ORDER order (each entry's EFFECT_ORDER index
 *   is strictly greater than the previous entry's)
 *
 * Cheap post-check for share-link loads and the mutation path — the
 * current Record<EffectId, boolean> storage form already satisfies all
 * three rules by construction, but this lets us validate arbitrary
 * external input and guards future shape changes.
 */
export function validateChain(chain: readonly unknown[]): chain is readonly EffectId[] {
  if (!Array.isArray(chain)) return false;
  const known = new Set<string>(EFFECT_ORDER);
  const seen = new Set<string>();
  let lastIdx = -1;
  for (const entry of chain) {
    if (typeof entry !== "string" || !known.has(entry)) return false;
    if (seen.has(entry)) return false;
    seen.add(entry);
    const idx = EFFECT_ORDER.indexOf(entry as EffectId);
    if (idx <= lastIdx) return false;
    lastIdx = idx;
  }
  return true;
}

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
  granular: 0.8,
  graincloud: 0.8,
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
  // SUB is now a true octave-down generator: a triangle oscillator at
  // half the drone root, amplitude-modulated by an envelope follower
  // of the input, summed in parallel with the dry. The old bandpass+
  // saturator "sub" was really a bass boost rather than a subharmonic.
  private subOsc!: OscillatorNode;
  private subEnvGain!: GainNode;
  private hallVerb!: ConvolverNode;
  private cisternVerb!: ConvolverNode;
  private hallImpulse: AudioBuffer | null = null;
  private cisternImpulse: AudioBuffer | null = null;

  private plateWorklet: AudioWorkletNode | null = null;
  private shimmerWorklet: AudioWorkletNode | null = null;
  private freezeWorklet: AudioWorkletNode | null = null;
  private granularWorklet: AudioWorkletNode | null = null;
  private ringmodOsc: OscillatorNode | null = null;
  private formantFilters: BiquadFilterNode[] = [];
  // Second fx-granular instance, initialised with classic-granular
  // defaults (short grains, high density, deeper pitch spread) so the
  // recognisable "chopped cloud" texture is reachable without
  // changing the drone-friendly defaults of the first granular slot.
  private grainCloudWorklet: AudioWorkletNode | null = null;

  private enabled: Record<EffectId, boolean> = {
    tape: false, wow: false, sub: false, comb: false, delay: false,
    plate: false, hall: false, shimmer: false, freeze: false,
    cistern: false, granular: false, graincloud: false, ringmod: false, formant: false,
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
      graincloud: makeInsert(),
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
    this.ringmodOsc = osc;
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

    // Formant accent bank — sharper Q and higher gain so vowel changes
    // are clearly audible. Dry signal is attenuated to let the formants
    // dominate the timbre instead of being buried underneath.
    dryTap.gain.value = 0.5;
    const formantGain = ctx.createGain();
    formantGain.gain.value = 1.2;

    const formants = [
      { freq: 700,  Q: 8 },
      { freq: 1220, Q: 8 },
      { freq: 2600, Q: 6 },
    ];
    this.formantFilters = [];
    for (const f of formants) {
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = f.freq;
      bp.Q.value = f.Q;
      ins.insertIn.connect(bp).connect(formantGain);
      this.formantFilters.push(bp);
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
    this.parallelHallWet = ctx.createGain();
    this.parallelHallWet.gain.value = 0;
    this.input
      .connect(this.parallelHallVerb)
      .connect(this.parallelHallWet)
      .connect(this.parallelBus);

    // Parallel cistern (native convolver, shares the cistern IR)
    this.parallelCisternVerb = ctx.createConvolver();
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

  /** SUB — true octave-down subharmonic. A triangle oscillator sits at
   *  half the drone root, amplitude-modulated by an envelope follower
   *  of the input signal. Dry passes through in parallel so the insert
   *  *adds* sub to the chain instead of replacing the full-band signal
   *  with bass-only content. Topology:
   *
   *    insertIn ─┬─ dryTap ───────────────────────────────┐
   *              │                                        │
   *              └─ absShaper ─ envLp ─┐                   │
   *                                    ▼                   ▼
   *                        subOsc ─ envGain ─ outLp ─ trim ─sum → wetGain
   *
   *  The sub oscillator tracks the drone root via setRootFreq(), or
   *  can be manually set via setSubCenter() (the modal's CENTER knob).
   */
  private wireSub(): void {
    const ctx = this.ctx;
    const ins = this.inserts.sub;

    // Dry pass — so the insert adds sub to the signal instead of
    // stripping the chain down to bass-only.
    const dryTap = ctx.createGain();
    dryTap.gain.value = 1.0;
    ins.insertIn.connect(dryTap).connect(ins.wetGain);

    // Sub oscillator — triangle at root/2. Default 55 Hz (for a
    // 110 Hz default root). Retuned on every setRootFreq() call.
    this.subOsc = ctx.createOscillator();
    this.subOsc.type = "triangle";
    this.subOsc.frequency.value = 55;
    this.subOsc.start();

    // Envelope follower: full-wave rectify the input (waveshaper
    // maps y = |x|) then smooth with a ~10 Hz lowpass.
    const absShaper = ctx.createWaveShaper();
    absShaper.curve = FxChain.makeAbsCurve();
    absShaper.oversample = "2x";
    const envLp = ctx.createBiquadFilter();
    envLp.type = "lowpass";
    envLp.frequency.value = 10;
    envLp.Q.value = 0.707;

    // Sub gain — base 0; the envelope follower drives it via the
    // a-rate gain param modulation so the sub oscillator's level
    // tracks the drone's amplitude envelope in real time.
    this.subEnvGain = ctx.createGain();
    this.subEnvGain.gain.value = 0;
    this.subOsc.connect(this.subEnvGain);
    ins.insertIn.connect(absShaper).connect(envLp).connect(this.subEnvGain.gain);

    // Output lowpass — removes triangle harmonics above ~180 Hz so
    // only the fundamental subharmonic reaches the chain.
    const outLp = ctx.createBiquadFilter();
    outLp.type = "lowpass";
    outLp.frequency.value = 180;
    outLp.Q.value = 0.707;

    // Trim — calibrate sub level relative to dry. 0.6 was chosen so
    // a full-amplitude drone produces roughly 40-50 % of its own
    // peak level as added sub energy.
    const subTrim = ctx.createGain();
    subTrim.gain.value = 0.6;

    this.subEnvGain.connect(outLp).connect(subTrim).connect(ins.wetGain);
    ins.wetGain.connect(ins.insertOut);
  }

  /** Waveshaper curve that maps y = |x| × 2. Used by the sub
   *  effect's envelope follower to full-wave rectify the input. */
  private static makeAbsCurve(): Float32Array<ArrayBuffer> {
    const n = 1024;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.abs(x) * 2;
    }
    return curve;
  }

  private wireComb(): void {
    const ctx = this.ctx;
    const ins = this.inserts.comb;
    // 60 ms max delay line gives headroom down to ~16.7 Hz root.
    // Previously 50 ms capped combTime at 0.049 — fine for typical
    // drones but tight for very low bass roots.
    this.combDelay = ctx.createDelay(0.06);
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
    ins.insertIn
      .connect(this.cisternVerb)
      .connect(ins.wetGain)
      .connect(ins.insertOut);
  }

  private ensureHallImpulse(): AudioBuffer {
    if (!this.hallImpulse) {
      this.hallImpulse = FxChain.makeHallImpulse(this.ctx, 4.8);
    }
    return this.hallImpulse;
  }

  private ensureCisternImpulse(): AudioBuffer {
    if (!this.cisternImpulse) {
      this.cisternImpulse = FxChain.makeCisternImpulse(this.ctx, 28);
    }
    return this.cisternImpulse;
  }

  private setConvolverBuffer(node: ConvolverNode, buffer: AudioBuffer | null): void {
    if (node.buffer === buffer) return;
    try {
      node.buffer = buffer;
    } catch {
      // Ignore transient buffer swap failures during panic/reconnect.
    }
  }

  private syncNativeReverbBuffers(): void {
    const anyHall = this.enabled.hall || this.parallelSendLevels.hall > 0;
    const anyCistern = this.enabled.cistern || this.parallelSendLevels.cistern > 0;
    const hallBuffer = anyHall ? this.ensureHallImpulse() : null;
    const cisternBuffer = anyCistern ? this.ensureCisternImpulse() : null;

    this.setConvolverBuffer(this.hallVerb, this.enabled.hall ? hallBuffer : null);
    this.setConvolverBuffer(
      this.parallelHallVerb,
      this.parallelSendLevels.hall > 0 ? hallBuffer : null,
    );
    this.setConvolverBuffer(this.cisternVerb, this.enabled.cistern ? cisternBuffer : null);
    this.setConvolverBuffer(
      this.parallelCisternVerb,
      this.parallelSendLevels.cistern > 0 ? cisternBuffer : null,
    );
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
    // textures. Uses the worklet's authored drone-smooth defaults
    // (size 0.8 s, density 3.5, pitchSpread 0.08).
    this.granularWorklet = new AudioWorkletNode(ctx, "fx-granular", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    // Pin internal mix to 1.0 (pure grain, no dry pass-through)
    // so the insert-level wet gain cleanly maps to "added grain
    // amount" without double attenuation with the worklet's dry mix.
    this.granularWorklet.parameters.get("mix")!.setValueAtTime(1, ctx.currentTime);
    const granularIns = this.inserts.granular;
    granularIns.insertIn
      .connect(this.granularWorklet)
      .connect(granularIns.wetGain)
      .connect(granularIns.insertOut);

    // GRAIN CLOUD — second fx-granular instance with classic-granular
    // defaults: short grains, high density, wider pitch scatter. This
    // is the texture people recognise as "granular" — audible grain
    // rattle, stuttered clouds, Fennesz / Hecker / Oval character.
    // Kept separate from `granular` so existing drone-smooth presets
    // don't flip sound.
    this.grainCloudWorklet = new AudioWorkletNode(ctx, "fx-granular", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    // Classic-granular defaults — very short grains (40 ms) at high
    // density (25 grains/s). Overlap = 1.0 — each grain lives just
    // long enough for the next one to start, so grain transitions
    // are audible as the "stutter rattle" that defines the classic
    // granular sound. Pitch scatter kept moderate (±0.15 octave ≈
    // ±180 cents) — wider spreads produce a "woobly-pitch" feel as
    // successive grains lurch between unrelated pitches. Wide pan
    // spread for the Fennesz / Oval / noisier-Hecker stereo image.
    // Worklet `mix` is pinned to 1.0 (pure grain, no internal dry)
    // — the insert's bypass/wet paths handle the dry/wet blend at
    // the chain level, so the modal AMOUNT knob maps cleanly to the
    // grain cloud's added level without double attenuation.
    const t0 = ctx.currentTime;
    this.grainCloudWorklet.parameters.get("size")!.setValueAtTime(0.04, t0);
    this.grainCloudWorklet.parameters.get("density")!.setValueAtTime(25, t0);
    this.grainCloudWorklet.parameters.get("pitchSpread")!.setValueAtTime(0.15, t0);
    this.grainCloudWorklet.parameters.get("panSpread")!.setValueAtTime(0.85, t0);
    this.grainCloudWorklet.parameters.get("position")!.setValueAtTime(0.25, t0);
    this.grainCloudWorklet.parameters.get("mix")!.setValueAtTime(1, t0);
    // Snap grain pitches to the drone scale so the cloud stays tonal
    // instead of woobling between random continuous offsets.
    this.grainCloudWorklet.parameters.get("pitchMode")!.setValueAtTime(1, t0);
    // Falling-exponential grain envelope — percussive attack + exp
    // decay — turns the smooth trapezoid grain edges into the
    // audible "stutter" that defines classic granular.
    this.grainCloudWorklet.parameters.get("envelope")!.setValueAtTime(1, t0);
    // Ordered spawn: grains read consecutive buffer chunks so the
    // cloud plays as a stretched replay of the drone rather than
    // scattering random positions.
    this.grainCloudWorklet.parameters.get("spawnMode")!.setValueAtTime(1, t0);
    const grainCloudIns = this.inserts.graincloud;
    grainCloudIns.insertIn
      .connect(this.grainCloudWorklet)
      .connect(grainCloudIns.wetGain)
      .connect(grainCloudIns.insertOut);

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
    for (const id of ["plate", "shimmer", "freeze", "granular", "graincloud"] as const) {
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
    this.syncNativeReverbBuffers();
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
    try { this.hallVerb.buffer = empty; } catch { /* noop */ }
    try { this.cisternVerb.buffer = empty; } catch { /* noop */ }
    try { this.parallelHallVerb.buffer = empty; } catch { /* noop */ }
    try { this.parallelCisternVerb.buffer = empty; } catch { /* noop */ }

    // Restore the real IRs after a short delay so the next start has
    // the full reverb available again.
    setTimeout(() => {
      this.syncNativeReverbBuffers();
    }, 220);

    // Post clear messages to worklet-backed effects (plate, shimmer,
    // freeze, granular) so they reset their internal buffers too.
    const clearMsg = { type: "clear" };
    for (const w of [this.plateWorklet, this.shimmerWorklet, this.freezeWorklet, this.granularWorklet, this.grainCloudWorklet, this.parallelPlateWorklet]) {
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
    // No-op if already in the requested state — callers (applyPreset,
    // scene restore) iterate every effect id unconditionally, and
    // re-triggering setTargetAtTime crossfades with no state change
    // produces audible wet-level flutter over long sessions.
    if (this.enabled[id] === on) return;
    this.enabled[id] = on;
    const ins = this.inserts[id];
    const now = this.ctx.currentTime;

    if (id === "hall" || id === "cistern") {
      this.syncNativeReverbBuffers();
    }

    // Apply the bypass / wet crossfade. Wet target is per-effect
    // level × (air for reverbs only).
    //
    // Granular / graincloud are **additive** inserts: the grain
    // cloud is meant to sit on top of the drone rather than replace
    // it, so the dry (bypass) path stays open even when enabled and
    // the wet path just adds the grain output. For every other
    // effect the insert is a classic bypass↔wet crossfade.
    const wetTarget = on ? this.wetTargetFor(id) : 0;
    const isAdditive = id === "granular" || id === "graincloud";
    const bypassTarget = isAdditive ? 1 : (on ? 0 : 1);
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

  /** Push the drone's current interval stack (in cents) to both
   *  granular worklets. Grains in quantised-pitch mode will snap to
   *  values from this list instead of picking random continuous
   *  offsets. Called by AudioEngine whenever the interval stack or
   *  root changes so the grain cloud stays tonal with the scene. */
  setGranularScale(cents: readonly number[]): void {
    if (cents.length === 0) return;
    const payload = { type: "setScale", cents: Array.from(cents) };
    if (this.granularWorklet) {
      try { this.granularWorklet.port.postMessage(payload); } catch { /* noop */ }
    }
    if (this.grainCloudWorklet) {
      try { this.grainCloudWorklet.port.postMessage(payload); } catch { /* noop */ }
    }
  }

  /** AIR macro — reverb-family wet multiplier (plate / hall / shimmer). */
  setAir(v: number): void {
    const next = Math.max(0, Math.min(1, v));
    if (next === this.airAmount) return;
    this.airAmount = next;
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

  // SHIMMER — worklet AudioParams
  setShimmerFeedback(v: number): void {
    this.shimmerWorklet?.parameters.get("feedback")
      ?.setTargetAtTime(Math.max(0, Math.min(0.85, v)), this.ctx.currentTime, 0.1);
  }
  getShimmerFeedback(): number {
    return this.shimmerWorklet?.parameters.get("feedback")?.value ?? 0.55;
  }
  setShimmerDecay(v: number): void {
    this.shimmerWorklet?.parameters.get("decay")
      ?.setTargetAtTime(Math.max(0, Math.min(0.95, v)), this.ctx.currentTime, 0.1);
  }
  getShimmerDecay(): number {
    return this.shimmerWorklet?.parameters.get("decay")?.value ?? 0.7;
  }
  setShimmerMix(v: number): void {
    const clamped = Math.max(0, Math.min(1, v));
    this.shimmerWorklet?.parameters.get("mix")
      ?.setTargetAtTime(clamped, this.ctx.currentTime, 0.1);
  }
  getShimmerMix(): number {
    return this.shimmerWorklet?.parameters.get("mix")?.value ?? 0.5;
  }

  // PLATE — worklet AudioParams
  setPlateDecay(v: number): void {
    this.plateWorklet?.parameters.get("decay")
      ?.setTargetAtTime(Math.max(0, Math.min(0.99, v)), this.ctx.currentTime, 0.1);
  }
  getPlateDecay(): number { return this.plateWorklet?.parameters.get("decay")?.value ?? 0.5; }
  setPlateDamping(v: number): void {
    this.plateWorklet?.parameters.get("damping")
      ?.setTargetAtTime(Math.max(0, Math.min(1, v)), this.ctx.currentTime, 0.1);
  }
  getPlateDamping(): number { return this.plateWorklet?.parameters.get("damping")?.value ?? 0.35; }
  setPlateDiffusion(v: number): void {
    this.plateWorklet?.parameters.get("diffusion")
      ?.setTargetAtTime(Math.max(0, Math.min(0.9, v)), this.ctx.currentTime, 0.1);
  }
  getPlateDiffusion(): number { return this.plateWorklet?.parameters.get("diffusion")?.value ?? 0.75; }
  setPlateMix(v: number): void {
    this.plateWorklet?.parameters.get("mix")
      ?.setTargetAtTime(Math.max(0, Math.min(1, v)), this.ctx.currentTime, 0.1);
  }
  getPlateMix(): number { return this.plateWorklet?.parameters.get("mix")?.value ?? 1; }

  // RINGMOD
  setRingmodFreq(hz: number): void {
    if (this.ringmodOsc) {
      this.ringmodOsc.frequency.setTargetAtTime(Math.max(10, Math.min(2000, hz)), this.ctx.currentTime, 0.05);
    }
  }
  getRingmodFreq(): number { return this.ringmodOsc?.frequency.value ?? 80; }

  // FORMANT — vowel presets + shift
  private static readonly VOWELS: [number, number, number][] = [
    [700, 1220, 2600],   // ah (default)
    [270, 2300, 3000],   // ee
    [400, 800, 2600],    // oh
    [300, 870, 2250],    // oo
    [530, 1850, 2500],   // eh
  ];
  private formantVowelIdx = 0;
  private formantShift = 1;

  setFormantVowel(idx: number): void {
    this.formantVowelIdx = Math.max(0, Math.min(FxChain.VOWELS.length - 1, Math.round(idx)));
    this.applyFormantFreqs();
  }
  getFormantVowel(): number { return this.formantVowelIdx; }

  setFormantShift(v: number): void {
    this.formantShift = Math.max(0.5, Math.min(2, v));
    this.applyFormantFreqs();
  }
  getFormantShift(): number { return this.formantShift; }

  private applyFormantFreqs(): void {
    const vowel = FxChain.VOWELS[this.formantVowelIdx];
    const now = this.ctx.currentTime;
    for (let i = 0; i < this.formantFilters.length && i < vowel.length; i++) {
      this.formantFilters[i].frequency.setTargetAtTime(
        vowel[i] * this.formantShift, now, 0.05,
      );
    }
  }

  // GRANULAR — worklet AudioParams
  setGranularSize(v: number): void {
    this.granularWorklet?.parameters.get("size")?.setTargetAtTime(Math.max(0.02, Math.min(2, v)), this.ctx.currentTime, 0.1);
  }
  getGranularSize(): number { return this.granularWorklet?.parameters.get("size")?.value ?? 0.2; }
  setGranularDensity(v: number): void {
    this.granularWorklet?.parameters.get("density")?.setTargetAtTime(Math.max(0.3, Math.min(40, v)), this.ctx.currentTime, 0.1);
  }
  getGranularDensity(): number { return this.granularWorklet?.parameters.get("density")?.value ?? 6; }
  setGranularPitchSpread(v: number): void {
    this.granularWorklet?.parameters.get("pitchSpread")?.setTargetAtTime(Math.max(0, Math.min(1, v)), this.ctx.currentTime, 0.1);
  }
  getGranularPitchSpread(): number { return this.granularWorklet?.parameters.get("pitchSpread")?.value ?? 0.2; }

  // GRAINCLOUD — second granular worklet instance
  setGrainCloudSize(v: number): void {
    this.grainCloudWorklet?.parameters.get("size")?.setTargetAtTime(Math.max(0.02, Math.min(2, v)), this.ctx.currentTime, 0.1);
  }
  getGrainCloudSize(): number { return this.grainCloudWorklet?.parameters.get("size")?.value ?? 0.06; }
  setGrainCloudDensity(v: number): void {
    this.grainCloudWorklet?.parameters.get("density")?.setTargetAtTime(Math.max(0.3, Math.min(40, v)), this.ctx.currentTime, 0.1);
  }
  getGrainCloudDensity(): number { return this.grainCloudWorklet?.parameters.get("density")?.value ?? 14; }
  setGrainCloudPitchSpread(v: number): void {
    this.grainCloudWorklet?.parameters.get("pitchSpread")?.setTargetAtTime(Math.max(0, Math.min(1, v)), this.ctx.currentTime, 0.1);
  }
  getGrainCloudPitchSpread(): number { return this.grainCloudWorklet?.parameters.get("pitchSpread")?.value ?? 0.05; }

  // SUB
  /** Manual override of the sub oscillator frequency. Will be
   *  reset to `root/2` on the next setRootFreq() call. */
  setSubCenter(hz: number): void {
    const f = Math.max(20, Math.min(300, hz));
    this.subOsc.frequency.setTargetAtTime(f, this.ctx.currentTime, 0.1);
  }
  getSubCenter(): number { return this.subOsc.frequency.value; }

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
    if (v === this.levels[id]) return;
    this.levels[id] = v;
    if (id === "freeze") this.freezeMix = v;
    const now = this.ctx.currentTime;
    const target = this.enabled[id] ? this.wetTargetFor(id) : 0;
    this.inserts[id].wetGain.gain.setTargetAtTime(target, now, this.xfadeTC);
    // Granular / graincloud: the worklet's internal `mix` is pinned
    // to 1.0 (pure grain). The dry/wet blend lives at the insert
    // level (bypass always 1, wet = amount), so the modal AMOUNT
    // knob cleanly controls the added grain level. No worklet-side
    // param update needed here.
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
    const combTime = Math.min(1 / Math.max(20, freq), 0.059);
    this.combDelay.delayTime.setTargetAtTime(combTime, now, 0.1);
    // Sub oscillator tracks half the drone root — a true octave-down.
    const subFreq = Math.max(20, Math.min(220, freq * 0.5));
    if (this.subOsc) {
      this.subOsc.frequency.setTargetAtTime(subFreq, now, 0.1);
    }
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
