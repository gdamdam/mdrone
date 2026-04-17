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
  // Reverb-family defaults halved now that plate/hall/shimmer/cistern
  // are additive (dry + wet) rather than wet-only. Previous 1.0 values
  // were calibrated for the old "replace dry with wet" behaviour —
  // applying them on top of the preserved dry was double-loud and
  // saturating any preset with reverb in the chain (Shruti Box,
  // Sevenfold, Tibetan Bowl, etc.).
  plate: 0.55,
  hall: 0.55,
  shimmer: 0.5,
  cistern: 0.55,
  freeze: 1.0,
  granular: 0.8,
  graincloud: 0.8,
  ringmod: 0.7,
  formant: 1.0,
};

/** Serial FDN hall/cistern trim. Previously 1.75 / 1.3 to compensate
 *  for the dry-loss when hall/cistern were wet-only inserts — now
 *  that they're additive (dry is preserved through the bypass path)
 *  the trim just scales the wet on top of dry. 1.0 keeps the reverb
 *  tail at unity; presets that want more wet can ride AIR or bump
 *  the effect level. */
const SERIAL_REVERB_TRIM = {
  hall: 1.0,
  cistern: 1.0,
} as const;

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
  /**
   * @deprecated Silent, unsourced. Kept as an export for backward-compat
   * with older `AudioEngine` wiring. Nothing feeds it and connecting it
   * to the master bus is a no-op. Use `dryOut` (which sums the parallel
   * reverb bus into the serial chain output) for all downstream routing.
   */
  public wetOut: GainNode;

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
  // HALL + CISTERN are now Freeverb-style FDN worklets (see
  // fxChainProcessor.js / `fx-fdn-reverb`). They are instantiated in
  // `onWorkletReady()` because AudioWorkletNode construction requires
  // the module to be registered first. The ConvolverNode IR path is
  // retained for the PARALLEL reverb bus (see parallelHall/Cistern
  // below) — presets with non-zero parallel sends still read from the
  // seeded impulse.
  private hallWorklet: AudioWorkletNode | null = null;
  private cisternWorklet: AudioWorkletNode | null = null;
  private hallSerialTrim!: GainNode;
  private cisternSerialTrim!: GainNode;
  private hallImpulse: AudioBuffer | null = null;
  private cisternImpulse: AudioBuffer | null = null;
  /** Seed for the deterministic reverb-IR PRNG. Changed via
   *  `setReverbSeed()` on preset apply so the same preset always
   *  produces the same hall / cistern impulse. */
  private reverbSeed = 0xC15ACE;

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
  /** User-customisable serial chain order. Defaults to EFFECT_ORDER.
   *  Mutated by `setEffectOrder` — the UI exposes drag-reorder via
   *  FxBar (P2). Every EffectId appears exactly once; a validator on
   *  setEffectOrder enforces this. */
  private currentOrder: EffectId[] = [...EFFECT_ORDER];
  /** Grain → plate excitation send (P3). Installed in onWorkletReady;
   *  routes the two granular worklets' output into the parallel plate
   *  tank so grains excite the reverb body directly. Default 0.3.
   *  Exposed via setGrainToPlateGain() so a preset or the UI can
   *  make the grain-excited plate louder (≤1). */
  private grainToPlateNode: GainNode | null = null;
  private grainToPlateGain = 0.3;

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

    // Chain inserts in currentOrder (defaults to EFFECT_ORDER on
    // construction). User reorder via setEffectOrder disconnects and
    // re-wires this same graph — the worklet instances stay alive.
    this.wireInsertChain(this.currentOrder);

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

  /** VOCAL FORMANT — parallel bandpass sum mixed against the dry signal.
   *  Three BPFs at F1/F2/F3 run in parallel off the insert input; their
   *  sum is mixed with the dry at a calibrated level so the vowel colour
   *  is audible without the serial-peaking gain stack (+20 dB midrange)
   *  the old topology produced. Dry passes at unity; the formant sum is
   *  scaled per-band so the perceptual vowel lands near 0 dB net.
   *
   *  Topology:
   *    insertIn ─┬─────────────────────────── dry tap ─┐
   *              ├─ BPF(F1) ─ g1 ─┐                     │
   *              ├─ BPF(F2) ─ g2 ─┼─ formantSum ─ trim ─┤
   *              └─ BPF(F3) ─ g3 ─┘                     │
   *                                                     ▼
   *                                                   wetGain → insertOut
   */
  private wireFormant(): void {
    const ctx = this.ctx;
    const ins = this.inserts.formant;

    const formants = [
      { freq: 700,  Q: 8, gain: 1.0 },  // F1
      { freq: 1220, Q: 10, gain: 0.85 }, // F2
      { freq: 2600, Q: 12, gain: 0.55 }, // F3 (rolled down — highs already ride tape highshelf)
    ];
    this.formantFilters = [];
    const formantSum = ctx.createGain();
    formantSum.gain.value = 1;

    for (const f of formants) {
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = f.freq;
      bp.Q.value = f.Q;
      const bandGain = ctx.createGain();
      bandGain.gain.value = f.gain;
      ins.insertIn.connect(bp).connect(bandGain).connect(formantSum);
      this.formantFilters.push(bp);
    }

    // Dry pass preserves the source spectrum so low-fundamental drones
    // don't get gutted when formant is on. Formant sum is mixed in at
    // 1.3× so the vowel colour reads through the dry — the earlier 0.9×
    // kept the level near 0 dB net but masked the vowel character on
    // sustained drones (user feedback: "formants are there but not
    // loud enough"). 1.3 puts the vowel slightly above unity against
    // dry, the limiter catches any overshoot on hot presets.
    const dryTap = ctx.createGain();
    dryTap.gain.value = 1;
    ins.insertIn.connect(dryTap).connect(ins.wetGain);

    const formantTrim = ctx.createGain();
    formantTrim.gain.value = 1.3;
    formantSum.connect(formantTrim).connect(ins.wetGain);

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

  /** Wire the serial chain: input → inserts[order[0]].insertIn,
   *  insertOut[i] → insertIn[i+1], insertOut[last] → dryOut. Called
   *  from the constructor and from setEffectOrder() after an
   *  unwireInsertChain(). */
  private wireInsertChain(order: readonly EffectId[]): void {
    const first = this.inserts[order[0]];
    this.input.connect(first.insertIn);
    for (let i = 0; i < order.length - 1; i++) {
      this.inserts[order[i]].insertOut.connect(this.inserts[order[i + 1]].insertIn);
    }
    this.inserts[order[order.length - 1]].insertOut.connect(this.dryOut);
  }

  /** Disconnect the links wireInsertChain() created. Leaves the
   *  inserts' internal DSP (worklets, biquads, delay lines) connected
   *  — only the insertIn/insertOut hookups between neighbours get
   *  cut so the new order can be wired fresh. */
  private unwireInsertChain(order: readonly EffectId[]): void {
    const first = this.inserts[order[0]];
    try { this.input.disconnect(first.insertIn); } catch { /* noop */ }
    for (let i = 0; i < order.length - 1; i++) {
      try {
        this.inserts[order[i]].insertOut.disconnect(
          this.inserts[order[i + 1]].insertIn,
        );
      } catch { /* noop */ }
    }
    try {
      this.inserts[order[order.length - 1]].insertOut.disconnect(this.dryOut);
    } catch { /* noop */ }
  }

  /** Reorder the serial effect chain. Validates that the new order
   *  contains every EffectId exactly once, then disconnects the
   *  current chain graph and rewires in the new order. Insert DSP
   *  (worklets, biquads) is preserved — only the inter-insert links
   *  are rewired. If `order` is invalid, no-op. */
  setEffectOrder(order: readonly EffectId[]): void {
    if (order.length !== EFFECT_ORDER.length) return;
    const seen = new Set<string>();
    for (const id of order) {
      if (!(id in this.inserts)) return;
      if (seen.has(id)) return;
      seen.add(id);
    }
    // No-op if the new order matches the current one.
    let same = true;
    for (let i = 0; i < order.length; i++) {
      if (order[i] !== this.currentOrder[i]) { same = false; break; }
    }
    if (same) return;
    this.unwireInsertChain(this.currentOrder);
    this.currentOrder = [...order];
    this.wireInsertChain(this.currentOrder);
  }

  /** Returns a copy of the current chain order. The UI reads this
   *  to render buttons + preview in the same sequence as the DSP. */
  getEffectOrder(): EffectId[] {
    return [...this.currentOrder];
  }

  /** Grain → parallel-plate excitation send level (0..1). Exposes
   *  the cross-bus send so presets and the UI can dial in how much
   *  "the grain cloud excites the reverb body." P3. */
  setGrainToPlateGain(v: number): void {
    const clamped = Math.max(0, Math.min(1, v));
    this.grainToPlateGain = clamped;
    if (this.grainToPlateNode) {
      this.grainToPlateNode.gain.setTargetAtTime(clamped, this.ctx.currentTime, 0.08);
    }
  }
  getGrainToPlateGain(): number { return this.grainToPlateGain; }

  /** HALL / CISTERN serial insert DSP is installed in `onWorkletReady`
   *  (see below) using the Freeverb-style `fx-fdn-reverb` worklet. Here
   *  we only reserve the insert's DSP slot as a silent passthrough
   *  until the worklet module loads — the insert wet gain is 0 while
   *  the effect is off, so nothing audible happens in the interim. */
  private wireHall(): void {
    // insertIn ──(pending worklet)──▶ wetGain ──▶ insertOut
    // wire the fallback dry passthrough so the insert graph is valid
    // even before `onWorkletReady` (defensive — no preset should enable
    // hall before worklets are ready, but this keeps state consistent).
    const ins = this.inserts.hall;
    ins.insertIn.connect(ins.wetGain);
    ins.wetGain.connect(ins.insertOut);
  }

  private wireCistern(): void {
    const ins = this.inserts.cistern;
    ins.insertIn.connect(ins.wetGain);
    ins.wetGain.connect(ins.insertOut);
  }

  private ensureHallImpulse(): AudioBuffer {
    if (!this.hallImpulse) {
      this.hallImpulse = FxChain.makeHallImpulse(
        this.ctx, 4.8, FxChain.makeSeededRng(this.reverbSeed ^ 0xA11),
      );
    }
    return this.hallImpulse;
  }

  private ensureCisternImpulse(): AudioBuffer {
    if (!this.cisternImpulse) {
      this.cisternImpulse = FxChain.makeCisternImpulse(
        this.ctx, 28, FxChain.makeSeededRng(this.reverbSeed ^ 0xC157),
      );
    }
    return this.cisternImpulse;
  }

  /** Deterministic Mulberry32 PRNG for reverb IR generation. Local to
   *  FxChain to avoid an import cycle with `presets.ts` (which also
   *  exports a copy for scene randomisation). */
  private static makeSeededRng(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** Seed the reverb PRNG. Invalidates the cached parallel hall +
   *  cistern impulses AND posts the new seed to the serial FDN
   *  worklets so their comb-length perturbation regenerates. Two
   *  loads of the same preset produce the same reverb colour across
   *  both the serial and parallel paths. */
  setReverbSeed(seed: number): void {
    const next = (seed >>> 0) || 1;
    if (next === this.reverbSeed) return;
    this.reverbSeed = next;
    this.hallImpulse = null;
    this.cisternImpulse = null;
    this.syncNativeReverbBuffers();
    // Rebuild the serial FDN worklets to pick up the new seed. This is
    // the simplest honest way — AudioWorkletNode takes processorOptions
    // only at construction, so we replace the nodes. Disconnect first
    // so we don't leak sources.
    if (this.hallWorklet) {
      try { this.hallWorklet.disconnect(); } catch { /* noop */ }
      const ins = this.inserts.hall;
      try { ins.insertIn.disconnect(this.hallWorklet); } catch { /* noop */ }
      this.hallWorklet = new AudioWorkletNode(this.ctx, "fx-fdn-reverb", {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
        processorOptions: { seed: this.reverbSeed ^ 0xA11 },
      });
      const hT = this.ctx.currentTime;
      this.hallWorklet.parameters.get("size")?.setValueAtTime(0.45, hT);
      this.hallWorklet.parameters.get("damping")?.setValueAtTime(0.55, hT);
      this.hallWorklet.parameters.get("decay")?.setValueAtTime(0.84, hT);
      this.hallWorklet.parameters.get("mix")?.setValueAtTime(1, hT);
      ins.insertIn.connect(this.hallWorklet);
      if (!this.hallSerialTrim) {
        this.hallSerialTrim = this.ctx.createGain();
        this.hallSerialTrim.gain.value = SERIAL_REVERB_TRIM.hall;
        this.hallSerialTrim.connect(ins.wetGain);
      }
      this.hallWorklet.connect(this.hallSerialTrim);
    }
    if (this.cisternWorklet) {
      try { this.cisternWorklet.disconnect(); } catch { /* noop */ }
      const ins = this.inserts.cistern;
      try { ins.insertIn.disconnect(this.cisternWorklet); } catch { /* noop */ }
      this.cisternWorklet = new AudioWorkletNode(this.ctx, "fx-fdn-reverb", {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
        processorOptions: { seed: this.reverbSeed ^ 0xC157 },
      });
      const cT = this.ctx.currentTime;
      this.cisternWorklet.parameters.get("size")?.setValueAtTime(1.2, cT);
      this.cisternWorklet.parameters.get("damping")?.setValueAtTime(0.7, cT);
      this.cisternWorklet.parameters.get("decay")?.setValueAtTime(0.94, cT);
      this.cisternWorklet.parameters.get("mix")?.setValueAtTime(1, cT);
      ins.insertIn.connect(this.cisternWorklet);
      if (!this.cisternSerialTrim) {
        this.cisternSerialTrim = this.ctx.createGain();
        this.cisternSerialTrim.gain.value = SERIAL_REVERB_TRIM.cistern;
        this.cisternSerialTrim.connect(ins.wetGain);
      }
      this.cisternWorklet.connect(this.cisternSerialTrim);
    }
  }

  private setConvolverBuffer(node: ConvolverNode, buffer: AudioBuffer | null): void {
    if (node.buffer === buffer) return;
    try {
      node.buffer = buffer;
    } catch {
      // Ignore transient buffer swap failures during panic/reconnect.
    }
  }

  /** Keep the seeded IRs loaded into the PARALLEL convolvers only. The
   *  SERIAL hall/cistern inserts run on the `fx-fdn-reverb` worklet
   *  now, so their buffers are not convolver-shaped. */
  private syncNativeReverbBuffers(): void {
    const anyHall = this.parallelSendLevels.hall > 0;
    const anyCistern = this.parallelSendLevels.cistern > 0;
    const hallBuffer = anyHall ? this.ensureHallImpulse() : null;
    const cisternBuffer = anyCistern ? this.ensureCisternImpulse() : null;

    this.setConvolverBuffer(
      this.parallelHallVerb,
      this.parallelSendLevels.hall > 0 ? hallBuffer : null,
    );
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

    // HALL — Freeverb-style FDN, medium room (size ≈ 0.5)
    this.hallWorklet = new AudioWorkletNode(ctx, "fx-fdn-reverb", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: { seed: this.reverbSeed ^ 0xA11 },
    });
    this.hallSerialTrim = ctx.createGain();
    this.hallSerialTrim.gain.value = SERIAL_REVERB_TRIM.hall;
    const hallT = ctx.currentTime;
    this.hallWorklet.parameters.get("size")?.setValueAtTime(0.45, hallT);
    this.hallWorklet.parameters.get("damping")?.setValueAtTime(0.55, hallT);
    this.hallWorklet.parameters.get("decay")?.setValueAtTime(0.84, hallT);
    this.hallWorklet.parameters.get("mix")?.setValueAtTime(1, hallT);
    const hallIns = this.inserts.hall;
    try { hallIns.insertIn.disconnect(hallIns.wetGain); } catch { /* noop */ }
    hallIns.insertIn.connect(this.hallWorklet);
    this.hallSerialTrim.connect(hallIns.wetGain);
    this.hallWorklet.connect(this.hallSerialTrim);

    // CISTERN — cathedral-scale FDN, large space (size ≈ 1.2) and
    // darker damping for the long, low tail the Deep-Listening
    // preset lineage asks for.
    this.cisternWorklet = new AudioWorkletNode(ctx, "fx-fdn-reverb", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: { seed: this.reverbSeed ^ 0xC157 },
    });
    this.cisternSerialTrim = ctx.createGain();
    this.cisternSerialTrim.gain.value = SERIAL_REVERB_TRIM.cistern;
    const cT = ctx.currentTime;
    this.cisternWorklet.parameters.get("size")?.setValueAtTime(1.2, cT);
    this.cisternWorklet.parameters.get("damping")?.setValueAtTime(0.7, cT);
    this.cisternWorklet.parameters.get("decay")?.setValueAtTime(0.94, cT);
    this.cisternWorklet.parameters.get("mix")?.setValueAtTime(1, cT);
    const cisternIns = this.inserts.cistern;
    try { cisternIns.insertIn.disconnect(cisternIns.wetGain); } catch { /* noop */ }
    cisternIns.insertIn.connect(this.cisternWorklet);
    this.cisternSerialTrim.connect(cisternIns.wetGain);
    this.cisternWorklet.connect(this.cisternSerialTrim);

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
    this.grainCloudWorklet.parameters.get("size")!.setValueAtTime(0.16, t0);
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

    // Grain → plate excitation — granular/graincloud outputs feed
    // into the parallel plate tank so grains excite the reverb body
    // directly. This creates "matter evolving inside a space" instead
    // of "effect pasted on top." The grain IS the excitation for the
    // reverb, like Eno's ambient architecture.
    const grainToPlate = ctx.createGain();
    grainToPlate.gain.value = this.grainToPlateGain;
    this.grainToPlateNode = grainToPlate;
    if (this.granularWorklet) {
      this.granularWorklet.connect(grainToPlate);
    }
    if (this.grainCloudWorklet) {
      this.grainCloudWorklet.connect(grainToPlate);
    }
    grainToPlate.connect(this.parallelPlateWorklet);

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
    // Swap PARALLEL convolver buffers to a 1-sample silent buffer to
    // truncate any in-flight reverb tail. Serial hall/cistern run on
    // worklets now — those get a `clear` port message below. Then
    // swap back on the next tick so the next start has the full reverb
    // available again.
    const ctx = this.ctx;
    const empty = ctx.createBuffer(2, 1, ctx.sampleRate);
    try { this.parallelHallVerb.buffer = empty; } catch { /* noop */ }
    try { this.parallelCisternVerb.buffer = empty; } catch { /* noop */ }

    setTimeout(() => {
      this.syncNativeReverbBuffers();
    }, 220);

    // Post clear messages to every worklet-backed effect so they reset
    // their internal buffers too (plate, shimmer, freeze, granular,
    // graincloud, parallel plate, FDN hall, FDN cistern).
    const clearMsg = { type: "clear" };
    for (const w of [
      this.plateWorklet, this.shimmerWorklet, this.freezeWorklet,
      this.granularWorklet, this.grainCloudWorklet, this.parallelPlateWorklet,
      this.hallWorklet, this.cisternWorklet,
    ]) {
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
    // Additive inserts: dry (bypass) path stays open when enabled and
    // the wet path just adds the effect output on top. Granular +
    // graincloud have always behaved this way (the grain cloud sits
    // on top of the drone). The reverb family (plate/hall/shimmer/
    // cistern) joined them — a wet-only reverb was deleting the dry
    // voice, which is why every preset with hall in the chain
    // sounded much quieter than neighbours. Serial reverbs in DAWs
    // are conventionally dry+wet mixes; this matches that expectation
    // and keeps preset levels aligned without a per-preset trim table.
    // For every other effect the insert is still a classic bypass↔wet
    // crossfade.
    const wetTarget = on ? this.wetTargetFor(id) : 0;
    const isAdditive =
      id === "granular" || id === "graincloud" ||
      id === "plate" || id === "hall" || id === "shimmer" || id === "cistern";
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
  // Default vowel — "oh" (F1 ≈ 400 Hz). Chest-heavy and throat-like,
  // sits naturally with drone fundamentals. Previous default was "ah"
  // (F1 ≈ 700 Hz) which read too speech-like / harmonium-bright for
  // chant-oriented presets. Per-preset override is planned but for
  // now a single default change fits most use.
  private formantVowelIdx = 2;
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
   * then a diffuse noise tail that decays exponentially. Uses a
   * seeded PRNG so the IR is deterministic per preset/session — two
   * loads of the same scene produce the same reverb.
   */
  private static makeHallImpulse(ctx: AudioContext, seconds: number, rand: () => number = Math.random): AudioBuffer {
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
        data[i] = (rand() * 2 - 1) * env * 0.35;
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
   *  exponential noise decay over the full length. Uses a seeded PRNG
   *  so the same preset always produces the same cistern IR. */
  private static makeCisternImpulse(ctx: AudioContext, seconds: number, rand: () => number = Math.random): AudioBuffer {
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
        data[i] = (rand() * 2 - 1) * env * 0.28;
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
