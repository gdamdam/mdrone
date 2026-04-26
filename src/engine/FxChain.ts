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

import { readAudioDebugFlags } from "./audioDebug";

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
  | "formant"
  | "halo";

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
  "plate", "hall", "shimmer", "freeze", "cistern", "granular", "graincloud", "halo",
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
/** Per-effect wet-amplitude multiplier. User-facing AMOUNT is [0..1];
 *  the internal wet target is `levels[id] × WET_GAIN[id]` so reverb
 *  worklets (quiet output by nature) can still compete with the
 *  full-level dry signal when additive. Non-reverbs stay at 1×.
 *
 *  Reverb-family trims (plate / hall / shimmer / cistern) were
 *  previously 2.5–3.0 to compensate for a wet-only insert path
 *  where the dry signal was lost when the effect engaged. The
 *  current path keeps dry intact and adds the wet on top, so those
 *  high trims pushed the parallel reverb above unity dry and washed
 *  presets out. Halving them brings the wet-audible point to
 *  AMOUNT ≈ 0.4–0.5 with dry articulation preserved. Other trims
 *  (formant 1.5, granular/graincloud 1, freeze 1) are unchanged
 *  pending listening + measurement evidence. */
const WET_GAIN: Record<EffectId, number> = {
  tape: 1, wow: 1, sub: 1, comb: 1, delay: 1, ringmod: 1, formant: 1.5,
  plate: 1.5, hall: 1.5, shimmer: 1.5, cistern: 1.6,
  granular: 1, graincloud: 1, freeze: 1, halo: 1.4,
};

const ON_LEVELS: Record<EffectId, number> = {
  tape: 1.0,
  wow: 1.0,
  sub: 0.9,
  comb: 0.68,
  delay: 0.9,
  // Reverb-family defaults stay in the user-facing [0..1] AMOUNT range
  // (clamped by setEffectLevel). Actual wet amplitude is scaled by
  // WET_GAIN below so the wet contribution is audible over the dry
  // signal — the worklets output around -28 dB RMS, so a 1.0 amount
  // at unity wet gain was inaudible on top of full-level dry.
  plate: 0.55,
  hall: 0.55,
  shimmer: 0.5,
  cistern: 0.55,
  freeze: 1.0,
  granular: 0.8,
  graincloud: 0.8,
  ringmod: 0.7,
  // Default < max so the AMOUNT macro has audible headroom to push
  // the vowel harder. Internal wet at default ≈ 0.6 × 1.5 = 0.9 (just
  // below unity — natural vowel colour); at max ≈ 1.5 (noticeably
  // louder, limiter catches any overshoot).
  formant: 0.6,
  halo: 0.55,
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
  /** Input-side gate for worklet-backed inserts. Present only when the
   *  insert's wet path ends in an always-running AudioWorkletNode. When
   *  the effect is off we ramp this to 0 so the worklet sees silence
   *  and its internal DSP can settle to silence too — Safari's JSC
   *  produces signal-correlated low-level hash on zero-gain-output
   *  worklets if the input keeps driving real signal through them. */
  wetInGate?: GainNode;
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
  // HALL + CISTERN are now Freeverb-style reverb worklets (parallel
  // combs + series allpasses, see fxChainProcessor.js / processor id
  // `fx-fdn-reverb` — kept for backward-compat; not a Jot FDN). They
  // are instantiated in
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

  /** Plate reverb — was a Dattorro algorithmic worklet (`fx-plate`),
   *  now a ConvolverNode loaded with the Greg Hopkins EMT 140 IR
   *  (public/irs/plate.wav, CC-BY). The serial-chain insert wiring
   *  is unchanged because ConvolverNode connects identically to the
   *  worklet it replaced; the four plate-param setters
   *  (decay/damping/diffusion/mix) are kept as no-op stubs so old
   *  UI/preset code paths don't break — they just no longer affect
   *  the (now static) IR. */
  private plateWorklet: ConvolverNode | null = null;
  private shimmerWorklet: AudioWorkletNode | null = null;
  private freezeWorklet: AudioWorkletNode | null = null;
  private haloWorklet: AudioWorkletNode | null = null;
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
    halo: false,
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
  private parallelPlateWorklet: ConvolverNode | null = null;
  private parallelPlateWet!: GainNode;
  /** Input-side gate for the parallel-plate worklet — mirrors the
   *  `wetInGate` pattern on serial worklet inserts; follows
   *  `parallelSendLevels.plate`. */
  private parallelPlateInGate: GainNode | null = null;

  // (Removed lazy worklet graph management — broke wet paths. See
  //  misc/2026-04-19-safari-hiss-report.md for history.)

  private levels: Record<EffectId, number> = { ...ON_LEVELS };
  private delayFeedback = 0.58;
  private combFeedback = 0.68;
  /** Audio-context time at which the most recent comb retune-flush
   *  is scheduled to finish ramping its feedback back up. Used by
   *  `setRootFreq` as a rapid-retune guard: while we're still inside
   *  this window, additional retunes update the delay time directly
   *  but do not restart the flush sequence — otherwise a slider
   *  sweep would hold combFbGain at zero and the comb would vanish. */
  private combFlushUntilCtxTime = 0;
  private freezeMix = ON_LEVELS.freeze;
  /** FREEZE mode toggle. 0 = HOLD (rising-edge snapshot), 1 = INFINITE
   *  (continuously fold input into the held cloud). Persisted via
   *  scene snapshot; mirrored to the worklet's `mode` AudioParam. */
  private freezeMode: 0 | 1 = 0;
  private haloTilt = 0.5;
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
      halo: makeInsert(),
    };

    // Chain inserts in currentOrder (defaults to EFFECT_ORDER on
    // construction). User reorder via setEffectOrder disconnects and
    // re-wires this same graph — the worklet instances stay alive.
    this.wireInsertChain(this.currentOrder);

    // Debug: `no-insert-dsp` skips ALL serial-insert wiring —
    // inserts remain pure bypass passthroughs. `no-native-fx` and
    // `no-worklet-fx` are finer (native-node vs worklet-backed).
    const _fxDbg = readAudioDebugFlags();
    const skipNative = _fxDbg.has("no-insert-dsp") || _fxDbg.has("no-native-fx");
    const skipWorkletInserts = _fxDbg.has("no-insert-dsp") || _fxDbg.has("no-worklet-fx");
    if (!skipNative) {
      this.wireTape();
      this.wireWow();
      this.wireSub();
      this.wireComb();
      this.wireDelay();
      this.wireRingmod();
      this.wireFormant();
    }
    if (!skipWorkletInserts) {
      this.wireHall();
      this.wireCistern();
    }
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

    this.parallelHallVerb = ctx.createConvolver();
    this.parallelHallWet = ctx.createGain();
    this.parallelHallWet.gain.value = 0;
    this.parallelCisternVerb = ctx.createConvolver();
    this.parallelCisternWet = ctx.createGain();
    this.parallelCisternWet.gain.value = 0;
    this.parallelPlateWet = ctx.createGain();
    this.parallelPlateWet.gain.value = 0;

    // Debug: `?audio-debug=no-parallel` skips the feed from serial
    // input into the parallel reverbs — the ConvolverNodes + gains
    // still exist so API surface stays valid, they're just silent.
    if (readAudioDebugFlags().has("no-parallel")) return;

    this.input
      .connect(this.parallelHallVerb)
      .connect(this.parallelHallWet)
      .connect(this.parallelBus);
    this.input
      .connect(this.parallelCisternVerb)
      .connect(this.parallelCisternWet)
      .connect(this.parallelBus);
    // Parallel plate worklet is wired in onWorkletReady(); its wet
    // gain already connects here regardless.
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
    sat.oversample = "none";
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
   *  of the input signal. Additive insert: dry passes via bypassGain
   *  (handled by setEffect/setEffectLevel) and the wet path carries
   *  only the synthesised sub. Topology:
   *
   *    insertIn ── absShaper ── envLp ─┐
   *                                    ▼
   *                        subOsc ─ envGain ─ outLp ─ trim → wetGain
   *
   *  The sub oscillator tracks the drone root via setRootFreq(), or
   *  can be manually set via setSubCenter() (the modal's CENTER knob).
   */
  private wireSub(): void {
    const ctx = this.ctx;
    const ins = this.inserts.sub;

    // Sub is now an additive insert (bypass=1 when ON), so the dry
    // signal flows through `bypassGain` like every other additive
    // effect. wetGain only carries the synthesised sub-octave; the
    // modal AMOUNT knob scales just the added sub level.

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
    absShaper.oversample = "none";
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
    fbClip.oversample = "none";

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
    fbSat.oversample = "none";
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
   *  using the Freeverb-style `fx-fdn-reverb` worklet. Here we reserve
   *  the insert's DSP slot as a silent passthrough until the worklet
   *  loads. */
  private wireHall(): void {
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
    // Grain worklets support live re-seeding via port message, so
    // reuse the same seed-source here — no need to reconstruct the
    // node. This is what makes grain-heavy shared scenes sound the
    // same on reload instead of scattering grains differently each
    // time. Distinct XOR constants keep the two grain instances
    // decorrelated without needing independent seeds in the scene.
    this.granularWorklet?.port.postMessage({
      type: "setSeed",
      seed: this.reverbSeed ^ 0x6C51,
    });
    this.grainCloudWorklet?.port.postMessage({
      type: "setSeed",
      seed: this.reverbSeed ^ 0x9C51,
    });
    // Rebuild the serial FDN worklets to pick up the new seed. The
    // disconnect+reconnect severs the wet output mid-sample; if the
    // wet path was carrying audible reverb tail this would click
    // audibly on every preset change. Route through swapFdnReverb()
    // which fades the insert's wetGain to 0 first (when audible),
    // performs the swap during silence, then lets the caller's
    // subsequent setEffect/applyParallelSends ramp the wet back up.
    this.swapFdnReverb("hall");
    this.swapFdnReverb("cistern");
  }

  /** Replace the FDN reverb worklet for `hall` or `cistern` with a
   *  fresh one carrying the current reverbSeed. The disconnect /
   *  reconnect step is performed inside a brief wet-mute window so
   *  preset changes don't click on the in-flight tail. Caller is
   *  responsible for restoring wetGain afterwards via setEffect or
   *  setEffectLevel — this matches the applyPreset flow where the
   *  effects loop runs immediately after setReverbSeed and ramps
   *  wetGain to its new target. */
  private swapFdnReverb(kind: "hall" | "cistern"): void {
    const current = kind === "hall" ? this.hallWorklet : this.cisternWorklet;
    if (!current) return;
    const ins = this.inserts[kind];
    const wetParam = ins.wetGain.gain;
    const wetCur = wetParam.value;
    const FADE_SEC = 0.03;
    const audible = wetCur > 0.001;
    const now = this.ctx.currentTime;
    if (audible) {
      // Ramp wet to 0 over 30 ms before tearing down the worklet.
      // We do not restore here — applyPreset's effects loop will
      // call setEffect(kind, ...) which sets the new target.
      wetParam.cancelScheduledValues(now);
      wetParam.setValueAtTime(wetCur, now);
      wetParam.linearRampToValueAtTime(0, now + FADE_SEC);
    }
    const seedXor = kind === "hall" ? 0xA11 : 0xC157;
    const params = kind === "hall"
      ? { size: 0.45, damping: 0.55, decay: 0.84 }
      : { size: 1.2, damping: 0.7, decay: 0.94 };
    const performSwap = () => {
      const stale = kind === "hall" ? this.hallWorklet : this.cisternWorklet;
      if (stale) {
        try { stale.disconnect(); } catch { /* noop */ }
        try { ins.insertIn.disconnect(stale); } catch { /* noop */ }
      }
      const fresh = new AudioWorkletNode(this.ctx, "fx-fdn-reverb", {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
        processorOptions: { seed: this.reverbSeed ^ seedXor },
      });
      const t = this.ctx.currentTime;
      fresh.parameters.get("size")?.setValueAtTime(params.size, t);
      fresh.parameters.get("damping")?.setValueAtTime(params.damping, t);
      fresh.parameters.get("decay")?.setValueAtTime(params.decay, t);
      fresh.parameters.get("mix")?.setValueAtTime(1, t);
      ins.insertIn.connect(fresh);
      if (kind === "hall") {
        if (!this.hallSerialTrim) {
          this.hallSerialTrim = this.ctx.createGain();
          this.hallSerialTrim.gain.value = SERIAL_REVERB_TRIM.hall;
          this.hallSerialTrim.connect(ins.wetGain);
        }
        fresh.connect(this.hallSerialTrim);
        this.hallWorklet = fresh;
      } else {
        if (!this.cisternSerialTrim) {
          this.cisternSerialTrim = this.ctx.createGain();
          this.cisternSerialTrim.gain.value = SERIAL_REVERB_TRIM.cistern;
          this.cisternSerialTrim.connect(ins.wetGain);
        }
        fresh.connect(this.cisternSerialTrim);
        this.cisternWorklet = fresh;
      }
    };
    if (audible) {
      // Schedule the swap a few ms after the fade completes so the
      // disconnect lands on a silent wet path. setTimeout precision
      // is fine for a 30+ ms gate; the AudioParam ramp guarantees
      // the silence is sample-accurate.
      setTimeout(performSwap, Math.round(FADE_SEC * 1000) + 5);
    } else {
      // Wet was already silent — swap immediately, no audible click.
      performSwap();
    }
  }

  /** Async-load the EMT 140 plate IR into both plate ConvolverNodes
   *  (serial insert + parallel reverb bus). Both convolvers share
   *  the same AudioBuffer; ConvolverNode treats the buffer as
   *  read-only DSP state, so a single decoded buffer can be assigned
   *  to multiple convolver instances safely. Source: Greg Hopkins
   *  EMT 140 IR set, CC-BY (see public/irs/plate.attribution.txt).
   *  Falls through silently on failure — the convolver stays
   *  buffer-less and silent until the user enables plate, which
   *  is the same UX as a dropped fetch on any other reverb. */
  private loadPlateIR(): void {
    if (typeof fetch === "undefined") return;
    fetch("/irs/plate.wav")
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`plate ir HTTP ${r.status}`))))
      .then((bytes) => this.ctx.decodeAudioData(bytes))
      .then((buf) => {
        if (this.plateWorklet) this.setConvolverBuffer(this.plateWorklet, buf);
        if (this.parallelPlateWorklet) this.setConvolverBuffer(this.parallelPlateWorklet, buf);
        try { console.info(`[mdrone] plate IR loaded — ${buf.duration.toFixed(2)}s × ${buf.numberOfChannels}ch`); } catch { /* ok */ }
      })
      .catch((err) => {
        try { console.warn("[mdrone] plate IR fetch/decode failed:", err); } catch { /* ok */ }
      });
  }

  private setConvolverBuffer(node: ConvolverNode, buffer: AudioBuffer | null): void {
    if (node.buffer === buffer) return;
    try {
      node.buffer = buffer;
    } catch {
      // Ignore transient buffer swap failures during panic/reconnect.
    }
  }

  /** Click-safe variant for the parallel hall / cistern convolvers.
   *  Reassigning ConvolverNode.buffer mid-render truncates the in-
   *  flight tail to zero — that was an audible click on every preset
   *  change where the parallel send was active in both old and new
   *  presets. Fade the wet to 0, swap the buffer during silence, then
   *  ramp back to the caller's target. The target argument is what
   *  the wet should land on after the swap (typically
   *  parallelSendLevels[kind] for that kind). Idempotent: returns
   *  early when the buffer reference is unchanged. */
  private swapParallelConvBuffer(
    conv: ConvolverNode,
    wetParam: AudioParam,
    target: number,
    newBuffer: AudioBuffer | null,
  ): void {
    if (conv.buffer === newBuffer) return;
    const wetCur = wetParam.value;
    const FADE_SEC = 0.03;
    const audible = wetCur > 0.001;
    const now = this.ctx.currentTime;
    if (audible) {
      wetParam.cancelScheduledValues(now);
      wetParam.setValueAtTime(wetCur, now);
      wetParam.linearRampToValueAtTime(0, now + FADE_SEC);
    }
    const performSwap = () => {
      try {
        conv.buffer = newBuffer;
      } catch {
        // Ignore transient buffer swap failures during panic/reconnect.
      }
      // Restore wet toward the post-swap target. The caller
      // (applyParallelSends) will also schedule a setTargetAtTime to
      // the same target — duplicate is harmless, last-writer wins.
      const t = this.ctx.currentTime;
      wetParam.setTargetAtTime(target, t, 0.05);
    };
    if (audible) {
      setTimeout(performSwap, Math.round(FADE_SEC * 1000) + 5);
    } else {
      performSwap();
    }
  }

  /** Keep the seeded IRs loaded into the PARALLEL convolvers only. The
   *  SERIAL hall/cistern inserts run on the `fx-fdn-reverb` worklet
   *  now, so their buffers are not convolver-shaped. Buffer changes
   *  go through swapParallelConvBuffer so they don't click on preset
   *  change when the parallel send is active. */
  private syncNativeReverbBuffers(): void {
    const anyHall = this.parallelSendLevels.hall > 0;
    const anyCistern = this.parallelSendLevels.cistern > 0;
    const hallBuffer = anyHall ? this.ensureHallImpulse() : null;
    const cisternBuffer = anyCistern ? this.ensureCisternImpulse() : null;

    this.swapParallelConvBuffer(
      this.parallelHallVerb,
      this.parallelHallWet.gain,
      this.parallelSendLevels.hall,
      this.parallelSendLevels.hall > 0 ? hallBuffer : null,
    );
    this.swapParallelConvBuffer(
      this.parallelCisternVerb,
      this.parallelCisternWet.gain,
      this.parallelSendLevels.cistern,
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
    // Debug: skip all worklet-backed insert DSP — the inserts
    // remain pure bypass passthroughs; parallel plate worklet is
    // also skipped because this method wires it too.
    const _dbg = readAudioDebugFlags();
    if (_dbg.has("no-insert-dsp") || _dbg.has("no-worklet-fx")) return;

    // HALL — Freeverb-style FDN, medium room.
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
    hallIns.wetInGate = ctx.createGain();
    hallIns.wetInGate.gain.value = 0;
    hallIns.insertIn.connect(hallIns.wetInGate);
    hallIns.wetInGate.connect(this.hallWorklet);
    this.hallSerialTrim.connect(hallIns.wetGain);
    this.hallWorklet.connect(this.hallSerialTrim);

    // CISTERN — cathedral-scale FDN.
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
    cisternIns.wetInGate = ctx.createGain();
    cisternIns.wetInGate.gain.value = 0;
    cisternIns.insertIn.connect(cisternIns.wetInGate);
    cisternIns.wetInGate.connect(this.cisternWorklet);
    this.cisternSerialTrim.connect(cisternIns.wetGain);
    this.cisternWorklet.connect(this.cisternSerialTrim);

    // PLATE — ConvolverNode loaded with the EMT 140 IR
    // (public/irs/plate.wav). Swap-in for the previous Dattorro
    // worklet; same node interface (in/out AudioNode) so the rest
    // of the wiring is unchanged. Buffer is filled by loadPlateIR()
    // below; while pending the convolver is silent — acceptable
    // since plate is off by default until the user enables it.
    this.plateWorklet = ctx.createConvolver();
    this.plateWorklet.normalize = true;
    const plateIns = this.inserts.plate;
    plateIns.wetInGate = ctx.createGain();
    plateIns.wetInGate.gain.value = 0;
    plateIns.insertIn.connect(plateIns.wetInGate);
    plateIns.wetInGate
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
    shimmerIns.wetInGate = ctx.createGain();
    shimmerIns.wetInGate.gain.value = 0;
    shimmerIns.insertIn.connect(shimmerIns.wetInGate);
    shimmerIns.wetInGate
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
    freezeIns.wetInGate = ctx.createGain();
    // Freeze is unique among inserts: its phase-vocoder snapshots
    // whatever's in the ring buffer the moment `active` flips up.
    // Keep wetInGate fully open so the ring is continuously filled
    // with the live signal — when the user (or a preset) enables
    // freeze, the snapshot grabs real audio instead of the silent
    // capture that gated wetInGate would produce. Output is still
    // gated by wetGain, so disabled freeze never leaks any signal.
    freezeIns.wetInGate.gain.value = 1;
    freezeIns.insertIn.connect(freezeIns.wetInGate);
    freezeIns.wetInGate
      .connect(this.freezeWorklet)
      .connect(freezeIns.wetGain)
      .connect(freezeIns.insertOut);
    // Sync persisted mode (HOLD / INFINITE) to the worklet param.
    this.freezeWorklet.parameters.get("mode")!.setValueAtTime(this.freezeMode, ctx.currentTime);

    // HALO — multi-band partial bloom worklet. Continuously analyses
    // input bands and resynthesises an upper-partial cloud on top of
    // the dry signal. Insert pattern matches the other tail worklets:
    // input gated when off, output bounded by wetGain.
    this.haloWorklet = new AudioWorkletNode(ctx, "fx-halo", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    this.haloWorklet.parameters.get("tilt")!.setValueAtTime(this.haloTilt, ctx.currentTime);
    const haloIns = this.inserts.halo;
    haloIns.wetInGate = ctx.createGain();
    haloIns.wetInGate.gain.value = 0;
    haloIns.insertIn.connect(haloIns.wetInGate);
    haloIns.wetInGate
      .connect(this.haloWorklet)
      .connect(haloIns.wetGain)
      .connect(haloIns.insertOut);

    // GRANULAR — tail processor that captures incoming audio into a ring
    // buffer and plays overlapping grains back with independent
    // pitch/position/pan. Used for Köner/Hecker/Fennesz/Basinski/Biosphere
    // textures. Uses the worklet's authored drone-smooth defaults
    // (size 0.8 s, density 3.5, pitchSpread 0.08).
    this.granularWorklet = new AudioWorkletNode(ctx, "fx-granular", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: { seed: this.reverbSeed ^ 0x6C51 },
    });
    // Pin internal mix to 1.0 (pure grain, no dry pass-through)
    // so the insert-level wet gain cleanly maps to "added grain
    // amount" without double attenuation with the worklet's dry mix.
    this.granularWorklet.parameters.get("mix")!.setValueAtTime(1, ctx.currentTime);
    const granularIns = this.inserts.granular;
    granularIns.wetInGate = ctx.createGain();
    granularIns.wetInGate.gain.value = 0;
    granularIns.insertIn.connect(granularIns.wetInGate);
    granularIns.wetInGate
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
      processorOptions: { seed: this.reverbSeed ^ 0x9C51 },
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
    grainCloudIns.wetInGate = ctx.createGain();
    grainCloudIns.wetInGate.gain.value = 0;
    grainCloudIns.insertIn.connect(grainCloudIns.wetInGate);
    grainCloudIns.wetInGate
      .connect(this.grainCloudWorklet)
      .connect(grainCloudIns.wetGain)
      .connect(grainCloudIns.insertOut);

    // PARALLEL PLATE — second ConvolverNode instance for the parallel
    // reverb bus, loaded with the same EMT 140 IR. Fed by raw input
    // and mixed into the dry bus via parallelPlateWet.
    this.parallelPlateWorklet = ctx.createConvolver();
    this.parallelPlateWorklet.normalize = true;
    // Input-side gate for the same Safari-worklet-hash reason as the
    // serial worklet inserts. parallelSendLevels.plate drives both
    // this (input) and parallelPlateWet (output) together.
    this.parallelPlateInGate = ctx.createGain();
    this.parallelPlateInGate.gain.value = 0;
    this.input.connect(this.parallelPlateInGate);
    this.parallelPlateInGate
      .connect(this.parallelPlateWorklet)
      .connect(this.parallelPlateWet);

    // Kick the IR fetch now that both plate convolvers exist.
    this.loadPlateIR();

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
    for (const id of ["plate", "shimmer", "freeze", "granular", "graincloud", "halo"] as const) {
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
    if (this.parallelPlateInGate) {
      // Input gate: binary (1 when any send, 0 otherwise) so worklet
      // sees silence when the parallel plate is disengaged. Prevents
      // Safari's always-running-worklet hash from leaking through.
      const inTarget = this.parallelSendLevels.plate > 0 ? 1 : 0;
      this.parallelPlateInGate.gain.setTargetAtTime(inTarget, now, tc);
    }
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
    // plateWorklet / parallelPlateWorklet are ConvolverNodes now and
    // have no internal state to clear (and no `.port`); skip them.
    for (const w of [
      this.shimmerWorklet, this.freezeWorklet,
      this.granularWorklet, this.grainCloudWorklet,
      this.hallWorklet, this.cisternWorklet,
      this.haloWorklet,
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
    // When ON: additive inserts keep dry open (bypass=1) and add wet
    //          on top — reverbs, grain clouds, sub, delay sends, halo.
    //          Coloration inserts (tape, wow, comb, ringmod, formant)
    //          are a wet/dry crossfade — bypass tracks (1 - amount) so
    //          the modal AMOUNT knob actually controls the effect's
    //          contribution, not the chain volume. At amount=0 the
    //          slot passes the signal through clean.
    // When OFF: bypass=1, wet=0 (clean passthrough) regardless of kind.
    const additive = this.isAdditiveEffect(id);
    const bypassTarget = !on
      ? 1
      : additive
        ? 1
        : 1 - this.levels[id];
    ins.bypassGain.gain.setTargetAtTime(bypassTarget, now, this.xfadeTC);
    ins.wetGain.gain.setTargetAtTime(wetTarget, now, this.xfadeTC);
    // Input-side gate (worklet-backed inserts only) — silence the
    // worklet's input when the effect is off so its internal DSP can
    // settle to silence and Safari stops hashing low-level signal
    // through it. Binary target; the output-side `wetGain` still
    // carries the user-level amount.
    if (ins.wetInGate && id !== "freeze") {
      ins.wetInGate.gain.setTargetAtTime(on ? 1 : 0, now, this.xfadeTC);
    }

    // Effects with persistent internal state need their feedback /
    // activity gates opened with the toggle so tails decay cleanly.
    if (id === "delay") {
      this.delayFbGain.gain.setTargetAtTime(on ? this.delayFeedback : 0, now, this.xfadeTC);
    } else if (id === "comb") {
      // A retune flush can have a future "restore feedback" event queued.
      // Toggling COMB must own the feedback gate, so cancel that queue first
      // or an off-toggle during the flush could re-energize the internal loop.
      this.combFbGain.gain.cancelScheduledValues(now);
      if (!on) this.combFlushUntilCtxTime = 0;
      this.combFbGain.gain.setTargetAtTime(on ? this.combFeedback : 0, now, this.xfadeTC);
    } else if (id === "freeze" && this.freezeWorklet) {
      this.freezeWorklet.parameters
        .get("active")!
        .setTargetAtTime(on ? 1 : 0, now, 0.08);
    }
  }

  private wetTargetFor(id: EffectId): number {
    // levels[id] is the user-facing AMOUNT [0..1]; WET_GAIN[id]
    // scales reverb worklet output into an audible range over dry.
    const base = this.levels[id] * WET_GAIN[id];
    // AIR modulates plate/hall/shimmer wet level within an
    // always-audible range. `airAmount` [0..1] → factor [0.4..1].
    if (id === "plate" || id === "hall" || id === "shimmer") {
      return base * (0.4 + 0.6 * this.airAmount);
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
    // Cap at 0.92 (was 0.98). Root-tracked combs are particularly
    // prone to ringing on retunes because the buffer keeps energy
    // at the old root; 0.92 keeps the comb resonant without sitting
    // right on the runaway edge.
    this.combFeedback = Math.max(0, Math.min(0.92, fb));
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

  // PLATE — was algorithmic Dattorro, now a ConvolverNode loaded
  // with a real EMT 140 IR. The four setters below have no audible
  // effect on a static IR; kept as no-op stubs (with stored display
  // values) so existing FxModal sliders and preset round-trips don't
  // break, and so a future option to swap models can wire them back
  // in. Returned values are the persisted slider positions, not a
  // live convolver param.
  private plateDecayDisplay = 0.5;
  private plateDampingDisplay = 0.35;
  private plateDiffusionDisplay = 0.75;
  private plateMixDisplay = 1;
  setPlateDecay(v: number): void { this.plateDecayDisplay = Math.max(0, Math.min(0.99, v)); }
  getPlateDecay(): number { return this.plateDecayDisplay; }
  setPlateDamping(v: number): void { this.plateDampingDisplay = Math.max(0, Math.min(1, v)); }
  getPlateDamping(): number { return this.plateDampingDisplay; }
  setPlateDiffusion(v: number): void { this.plateDiffusionDisplay = Math.max(0, Math.min(0.9, v)); }
  getPlateDiffusion(): number { return this.plateDiffusionDisplay; }
  setPlateMix(v: number): void { this.plateMixDisplay = Math.max(0, Math.min(1, v)); }
  getPlateMix(): number { return this.plateMixDisplay; }

  // HALL — fx-fdn-reverb worklet params
  setHallSize(v: number): void {
    this.hallWorklet?.parameters.get("size")
      ?.setTargetAtTime(Math.max(0, Math.min(2, v)), this.ctx.currentTime, 0.1);
  }
  getHallSize(): number { return this.hallWorklet?.parameters.get("size")?.value ?? 0.45; }
  setHallDamping(v: number): void {
    this.hallWorklet?.parameters.get("damping")
      ?.setTargetAtTime(Math.max(0, Math.min(1, v)), this.ctx.currentTime, 0.1);
  }
  getHallDamping(): number { return this.hallWorklet?.parameters.get("damping")?.value ?? 0.55; }
  setHallDecay(v: number): void {
    this.hallWorklet?.parameters.get("decay")
      ?.setTargetAtTime(Math.max(0, Math.min(0.99, v)), this.ctx.currentTime, 0.1);
  }
  getHallDecay(): number { return this.hallWorklet?.parameters.get("decay")?.value ?? 0.84; }

  // CISTERN — same worklet as hall, separate instance
  setCisternSize(v: number): void {
    this.cisternWorklet?.parameters.get("size")
      ?.setTargetAtTime(Math.max(0, Math.min(2, v)), this.ctx.currentTime, 0.1);
  }
  getCisternSize(): number { return this.cisternWorklet?.parameters.get("size")?.value ?? 1.2; }
  setCisternDamping(v: number): void {
    this.cisternWorklet?.parameters.get("damping")
      ?.setTargetAtTime(Math.max(0, Math.min(1, v)), this.ctx.currentTime, 0.1);
  }
  getCisternDamping(): number { return this.cisternWorklet?.parameters.get("damping")?.value ?? 0.7; }
  setCisternDecay(v: number): void {
    this.cisternWorklet?.parameters.get("decay")
      ?.setTargetAtTime(Math.max(0, Math.min(0.99, v)), this.ctx.currentTime, 0.1);
  }
  getCisternDecay(): number { return this.cisternWorklet?.parameters.get("decay")?.value ?? 0.94; }

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

  /** FREEZE mode: 0 = HOLD (rising-edge snapshot), 1 = INFINITE
   *  (continuously fold input into the held cloud). */
  setFreezeMode(mode: 0 | 1): void {
    this.freezeMode = mode === 1 ? 1 : 0;
    if (this.freezeWorklet) {
      this.freezeWorklet.parameters
        .get("mode")!
        .setValueAtTime(this.freezeMode, this.ctx.currentTime);
    }
  }
  getFreezeMode(): 0 | 1 { return this.freezeMode; }

  /** HALO tilt — rolloff balance of synthesised upper partials.
   *  0 = mostly the 2× partial; 1 = full 2..6× stack. */
  setHaloTilt(v: number): void {
    this.haloTilt = Math.max(0, Math.min(1, v));
    if (this.haloWorklet) {
      this.haloWorklet.parameters
        .get("tilt")!
        .setTargetAtTime(this.haloTilt, this.ctx.currentTime, 0.05);
    }
  }
  getHaloTilt(): number { return this.haloTilt; }

  /** Set per-effect wet level (the modal's AMOUNT knob). */
  setEffectLevel(id: EffectId, level: number): void {
    const v = Math.max(0, Math.min(1, level));
    if (v === this.levels[id]) return;
    this.levels[id] = v;
    if (id === "freeze") this.freezeMix = v;
    const now = this.ctx.currentTime;
    const target = this.enabled[id] ? this.wetTargetFor(id) : 0;
    this.inserts[id].wetGain.gain.setTargetAtTime(target, now, this.xfadeTC);
    // Coloration effects do a wet/dry crossfade — bypass holds the
    // dry, wet holds the processed signal — so AMOUNT must drive
    // both gains. Without this update, lowering AMOUNT on tape /
    // wow / comb / ringmod / formant just attenuated the chain
    // (bypass stayed at 0). Additive inserts keep bypass at 1.
    if (this.enabled[id] && !this.isAdditiveEffect(id)) {
      this.inserts[id].bypassGain.gain.setTargetAtTime(1 - v, now, this.xfadeTC);
    }
  }

  /** Effects that *add* their wet on top of an open dry path
   *  (bypass=1 always when ON). Coloration / replacement inserts
   *  (tape, wow, comb, ringmod, formant) are NOT additive — for
   *  those the modal's AMOUNT crossfades dry↔wet. */
  private isAdditiveEffect(id: EffectId): boolean {
    return id === "granular" || id === "graincloud"
      || id === "plate" || id === "hall" || id === "shimmer" || id === "cistern"
      || id === "halo"
      || id === "delay"   // delay is a typical send — dry + tail
      || id === "sub";    // sub adds an octave-down on top of dry
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
   *  root changes. Called from AudioEngine.setDroneFreq().
   *
   *  When the comb is enabled, retuning the delay line alone is not
   *  safe: the buffer holds energy at the old root, the new root
   *  retunes that energy alongside the new content, and on
   *  feedback ≥ 0.6 root-tracked combs chirp during retune. To
   *  avoid that, briefly duck `combFbGain` around the delay-time
   *  ramp, then restore it. The flush window is guarded against
   *  rapid repeat retunes (a slider sweep) so we don't keep the
   *  comb silent for the duration of the sweep. */
  setRootFreq(freq: number): void {
    const now = this.ctx.currentTime;
    const combTime = Math.min(1 / Math.max(20, freq), 0.059);
    // Sub oscillator tracks half the drone root — a true octave-down.
    const subFreq = Math.max(20, Math.min(220, freq * 0.5));
    if (this.subOsc) {
      this.subOsc.frequency.setTargetAtTime(subFreq, now, 0.1);
    }
    // Rapid-retune guard: if we're already inside an active flush
    // window, just retune the delay time and leave the feedback
    // ramp alone. The comb is already de-energised by the
    // in-progress flush; the new delay time will take effect on the
    // same 0.1 s TC and the existing restore ramp will bring
    // combFbGain back up. This prevents back-to-back setRootFreq
    // calls from holding the comb at zero through a slider sweep.
    if (this.enabled.comb && now >= this.combFlushUntilCtxTime) {
      // Schedule sequence:
      //   t=0      : feedback → 0  (TC 30 ms)
      //   t=+60ms  : delay-time retune (TC 100 ms)
      //   t=+200ms : feedback → combFeedback (TC 80 ms)
      // The 60 ms gap is short enough to be inaudible on sustained
      // drone material but long enough for the feedback ramp to be
      // ~86 % of the way to zero, which breaks the resonance.
      this.combFbGain.gain.cancelScheduledValues(now);
      this.combFbGain.gain.setTargetAtTime(0, now, 0.03);
      this.combDelay.delayTime.setTargetAtTime(combTime, now + 0.06, 0.1);
      this.combFbGain.gain.setTargetAtTime(this.combFeedback, now + 0.20, 0.08);
      // Window expires once the restore ramp has had ~5 TCs to settle.
      this.combFlushUntilCtxTime = now + 0.20 + 0.08 * 5;
    } else {
      // Comb off, or rapid-retune inside an active flush window:
      // just retune the delay line. When comb is off, combFbGain
      // is 0 and there's nothing to flush.
      this.combDelay.delayTime.setTargetAtTime(combTime, now, 0.1);
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
