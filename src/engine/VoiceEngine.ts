import { FxChain } from "./FxChain";
import type { PresetMaterialProfile } from "./presets";
import { DEFAULT_PRESET_MATERIAL_PROFILE, mulberry32 } from "./presets";
import { buildVoice, ALL_VOICE_TYPES, type ReedShape, type TanpuraTuningId, type Voice, type VoiceType } from "./VoiceBuilder";
import { LAYER_FILTER_MAX_HZ, LAYER_FILTER_MIN_HZ, registerLayerFilterWalk } from "./MotionEngine";
import { readAudioDebugFlags } from "./audioDebug";
import { trace } from "./audioTrace";
import { dichoticCentsForFrequency, latchedEntrainRateHz } from "../entrain";

/** Spread a layer's voices across the stereo field. With N copies of
 *  the same voice timbre at different intervals, panning each copy
 *  to a distinct position turns a mono-sounding stack into a true
 *  ensemble. ±0.6 keeps everything within the perceptually safe
 *  inner field — full hard-pan ±1 sounds gimmicky on headphones. */
function layerVoicePan(i: number, n: number): number {
  if (n <= 1) return 0;
  return ((i / (n - 1)) - 0.5) * 1.2;
}

/** Equal-power crossfade shapes for voice rebuilds. The retiring and
 *  incoming layers are UNCORRELATED sources, so their *powers* add —
 *  a paired linear ramp keeps summed amplitude constant but dips
 *  summed power to 50% (−3 dB) at the midpoint of every rebuild.
 *  Quarter-cycle cos/sin shapes keep g_out² + g_in² ≈ constant.
 *  Stored as fade *progress* (0 → 1) so one scaler covers both
 *  directions; precomputed once, scaled per rebuild by the actual
 *  start/target gains. */
const XFADE_CURVE_POINTS = 128;
const XFADE_OUT_PROGRESS = new Float32Array(XFADE_CURVE_POINTS); // 1 − cos
const XFADE_IN_PROGRESS = new Float32Array(XFADE_CURVE_POINTS);  // sin
for (let i = 0; i < XFADE_CURVE_POINTS; i++) {
  const phase = (i / (XFADE_CURVE_POINTS - 1)) * (Math.PI / 2);
  XFADE_OUT_PROGRESS[i] = 1 - Math.cos(phase);
  XFADE_IN_PROGRESS[i] = Math.sin(phase);
}

/** Scale a unit progress shape into an absolute gain curve from→to.
 *  First point equals `from` (the param's current value — required so
 *  a retriggered fade picks up where the last one left off) and the
 *  last point is pinned to `to` exactly so the post-curve
 *  setValueAtTime anchor can't step. */
function scaleXfadeCurve(progress: Float32Array, from: number, to: number): Float32Array {
  const curve = new Float32Array(XFADE_CURVE_POINTS);
  for (let i = 0; i < XFADE_CURVE_POINTS; i++) {
    curve[i] = from + (to - from) * progress[i];
  }
  curve[XFADE_CURVE_POINTS - 1] = to;
  return curve;
}

/** Cross-voice coupling (Tier-4 / E4): cap on the TOTAL feedback feed
 *  at coupleAmount = 1. Each layer's injection gain is
 *  coupleAmount × this / N (N = layers on the bus), so the summed
 *  cross-feed can never exceed 0.15 of the bus signal. Worst-case
 *  loop gain is 0.15 × the layer lowpass's resonance peak
 *  (Q ≤ 2.24 ≈ ×2.24) ≈ 0.34 — more than 9 dB below unity, so the
 *  loop can never run away and the FxChain-style soft clipper
 *  (FxChain.ts feedback paths) is unnecessary at these gains. */
export const COUPLE_MAX_TOTAL_INJECTION = 0.15;
/** Coupling-loop delay. Web Audio silently mutes graph cycles unless
 *  they pass through a DelayNode; 15 ms is also physically motivated —
 *  the acoustic coupling distance (~5 m) between instrument bodies. */
export const COUPLE_DELAY_SEC = 0.015;
/** Gentle bandpass on the cross-feed so coupling thickens the mids
 *  instead of doubling the low fundamentals into mud. 700 Hz at
 *  Q 0.5 is a broad (~2-octave) mid window; the receiving layer's own
 *  lowpass then shapes the top end per layer. Fixed rather than
 *  root-tracked — at injection gains ≤ 0.15/N the exact band placement
 *  is a colour choice, not a stability one. */
const COUPLE_TONE_HZ = 700;
const COUPLE_TONE_Q = 0.5;

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
  /** Live rebuild-crossfade windows, keyed by the layer-gain param.
   *  Chrome does not implement the spec provision that
   *  cancelScheduledValues(t) removes an in-flight setValueCurveAtTime
   *  whose window contains t — the curve survives and the next event
   *  scheduled inside its window throws NotSupportedError (field
   *  crash: level/ATTUNE writes landing inside a crossfade). Tracking
   *  the window lets anchorLayerGainNow() cancel from the curve's
   *  *start* (>= start removes it in every browser) and re-anchor at
   *  the curve's sampled value, click-free. */
  private activeGainCurves: Map<AudioParam, { start: number; dur: number; curve: Float32Array }> = new Map();
  // Per-voice analyser taps for UI metering. Created lazily alongside
  // each layerGain. Connecting an AnalyserNode is a passthrough probe;
  // it doesn't sink the audio path (gain still flows through to
  // droneVoiceGain), it just lets JS read time-domain samples.
  private layerAnalysers: Map<VoiceType, AnalyserNode> = new Map();
  // Per-layer resonant lowpass (Tier-4 / E3): one BiquadFilterNode per
  // LAYER (not per voice copy — keeps node count flat), inserted
  // between the layer's voices and its layerGain so the rebuild
  // crossfade curves on the gain are untouched. Cutoff walks slowly
  // under MotionEngine's walk clock via the registry in MotionEngine.ts.
  private layerFilters: Map<VoiceType, BiquadFilterNode> = new Map();
  /** Unregister handles for each layer's cutoff-walk target — called
   *  on layer retire / dispose so walks stop with the layer. */
  private layerFilterWalkStops: Map<VoiceType, () => void> = new Map();
  /** Cross-voice COUPLE amount (0..1, default 0 = off). One global
   *  knob — see COUPLE_MAX_TOTAL_INJECTION for the gain math. */
  private coupleAmount = 0;
  /** Shared coupling core, created lazily on the first non-zero
   *  setCoupleAmount so the default graph stays byte-identical to the
   *  pre-E4 one: every live layerGain taps into `bus`, which feeds
   *  `delay` (the mandatory cycle-breaker) then `tone` (bandpass),
   *  which fans out through the per-layer injection gains below. */
  private coupling: { bus: GainNode; delay: DelayNode; tone: BiquadFilterNode } | null = null;
  /** Per-layer injection gains: coupling.tone → injection → that
   *  layer's layerFilter input. NOTE the layer's own contribution is
   *  deliberately NOT subtracted from its injection — at ≤ 0.15/N the
   *  self-feed reads as mild resonant thickening (Lyra-adjacent),
   *  and subtracting it would cost an inverted summing node per layer
   *  for no audible benefit. */
  private couplingInjections: Map<VoiceType, GainNode> = new Map();
  // Retiring voices from a previous rebuild whose tail hasn't finished.
  // Tracked on the instance (not in a local inside rebuildIntervals) so
  // a fresh rebuild can fast-kill them and avoid voice stacking under
  // rapid preset / layer churn.
  private pendingRetire: { gain: GainNode; voices: Voice[]; stopTimeout: number; filter: BiquadFilterNode | null }[] = [];
  private stopDroneTimeout: number | null = null;
  private disposed = false;
  private voiceUpdateDepth = 0;
  private voiceRebuildPending = false;
  private layerLevels: Record<VoiceType, number> = {
    tanpura: 1, reed: 1, metal: 1, air: 1, piano: 1, fm: 1, amp: 1, noise: 1,
  };
  private voiceLayers: Record<VoiceType, boolean> = {
    tanpura: true, reed: false, metal: false, air: false, piano: false, fm: false, amp: false, noise: false,
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
  // NOISE voice COLOR (0..1): 0 = white, 0.3 = pink, 0.6 = brown,
  // 1 = sub-rumble. Broadcast to live noise voices via setColor
  // and picked up by newly-spawned voices at build time.
  private noiseColor = 0.3;
  private reedShape: ReedShape = "odd";
  private fmRatio = 2.0;
  private fmIndex = 2.4;
  private fmFeedback = 0;
  // Tanpura string tuning (Sa Pa / Sa Ma / Sa Ni / all-four). Applied
  // at voice construction; setting it triggers a voice rebuild via
  // scheduleVoiceRebuild() so the KS delay lengths repick.
  private tanpuraTuning: TanpuraTuningId = "classic";
  /** ENTRAIN dichotic spread on the R channel, in cents. 0 = no
   *  effect. Broadcast to each active voice via its setDichoticCents
   *  setter; newly-spawned voices inherit this value at build time. */
  private dichoticCents = 0;
  /** Max active voice layers. Low-core devices (≤4 logical cores,
   *  typical mobile / small laptops) cap at 4 to prevent audio-thread
   *  overload when a preset asks for 6-7 simultaneous voices. Default
   *  is derived from `navigator.hardwareConcurrency` at construction.
   *  Setting this field to `ALL_VOICE_TYPES.length` (8) disables the
   *  cap for desktop / high-core systems. P3 — mobile auto-degrader. */
  private maxVoiceLayers: number = VoiceEngine.detectMaxVoiceLayers();
  private static detectMaxVoiceLayers(): number {
    if (typeof navigator === "undefined") return ALL_VOICE_TYPES.length;
    const cores = navigator.hardwareConcurrency;
    if (typeof cores === "number" && cores > 0 && cores <= 4) return 4;
    return ALL_VOICE_TYPES.length;
  }
  /** Build the per-voice material phase-offset table from an RNG. Static
   *  so it can run from a field initializer and be re-run by
   *  setMaterialSeed() with a seeded source. */
  private static makeMaterialPhaseOffsets(rng: () => number): Record<VoiceType, number> {
    const offsets = {} as Record<VoiceType, number>;
    for (const type of ALL_VOICE_TYPES) offsets[type] = rng() * Math.PI * 2;
    return offsets;
  }
  /** Priority order for auto-degradation — cheapest voices first so
   *  they survive when the cap is applied. Matches the relative CPU
   *  cost of each voice at default settings (tanpura = 4 KS loops +
   *  jawari, metal = 12-partial modal stack, etc.). */
  private static readonly VOICE_COST_PRIORITY: readonly VoiceType[] = [
    // NOISE is cheapest (one-pole LPF + tiny LFO, no per-partial
    // loop) so it keeps highest priority — dropping noise mid-preset
    // would change the drone's *kind*, not just its weight.
    "tanpura", "noise", "air", "fm", "amp", "piano", "reed", "metal",
  ] as const;
  /** Apply the `maxVoiceLayers` cap — returns a copy of `layers` with
   *  the lowest-priority active layers turned off once the active
   *  count exceeds the cap. Called from rebuildIntervals / startDrone
   *  so the cap applies uniformly. */
  private capLayers(layers: Record<VoiceType, boolean>): Record<VoiceType, boolean> {
    const debugMono = readAudioDebugFlags().has("mono-voice");
    const cap = debugMono ? 1 : this.maxVoiceLayers;
    const active = VoiceEngine.VOICE_COST_PRIORITY.filter((t) => layers[t]);
    if (active.length <= cap) return layers;
    const keep = new Set(active.slice(0, cap));
    const capped = { ...layers };
    for (const t of ALL_VOICE_TYPES) capped[t] = layers[t] && keep.has(t);
    return capped;
  }

  /** Debug-aware interval list — `mono-voice` collapses the chord
   *  to a single interval so only one `drone-voice` worklet spawns
   *  per active layer. */
  private debugIntervals(): readonly number[] {
    if (readAudioDebugFlags().has("mono-voice") && this.droneIntervalsCents.length > 0) {
      return [this.droneIntervalsCents[0]];
    }
    return this.droneIntervalsCents;
  }
  private readonly baseMacroTC = 0.4;

  private presetMaterialProfile: PresetMaterialProfile = DEFAULT_PRESET_MATERIAL_PROFILE;
  private evolveAmount = 0;
  private materialInterval: number | null = null;
  private materialStep = 0;
  private materialLevelOffsets: Record<VoiceType, number> = {
    tanpura: 0, reed: 0, metal: 0, air: 0, piano: 0, fm: 0, amp: 0, noise: 0,
  };
  private materialDriftScales: Record<VoiceType, number> = {
    tanpura: 1, reed: 1, metal: 1, air: 1, piano: 1, fm: 1, amp: 1, noise: 1,
  };
  /** RNG for per-voice material motion (the phase offsets below + the
   *  per-tick nudge in computeMaterialState). Defaults to Math.random so
   *  ad-hoc playback stays naturally varied; setMaterialSeed() swaps in a
   *  seeded mulberry32 so a shared scene reproduces the same subtle layer
   *  motion on every load — matching the already-seeded evolve walk. */
  private materialRng: () => number = Math.random;
  private materialPhaseOffsets: Record<VoiceType, number> =
    VoiceEngine.makeMaterialPhaseOffsets(this.materialRng);
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
    this.fxChain.armParallelBus();
    this.wetSend.gain.cancelScheduledValues(now);
    this.wetSend.gain.setTargetAtTime(air * 0.8, now, 0.05);

    const capped = this.capLayers(this.voiceLayers);
    const intervals = this.debugIntervals();
    for (const type of ALL_VOICE_TYPES) {
      if (!capped[type]) continue;
      const layerGain = this.ensureLayerGain(type);
      const layerFilter = this.ensureLayerFilter(type, layerGain);
      const voices: Voice[] = [];
      for (let i = 0; i < intervals.length; i++) {
        const c = intervals[i];
        const pan = layerVoicePan(i, intervals.length);
        const voice = buildVoice(type, this.ctx, layerFilter, freq, c, this.drift, now, this.reedShape, this.fmRatio, this.fmIndex, this.fmFeedback, this.tanpuraTuning, pan);
        if (type === "tanpura") voice.setPluckRate(this.effectivePluckRate());
        if (type === "noise") voice.setColor(this.noiseColor);
        voice.setDrift(this.effectiveLayerDrift(type));
        voice.setDichoticCents(this.voiceDichoticCents(c));
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
    this.fxChain.releaseTails(release);

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
    trace("setDroneFreq", {
      freq,
      prev: this.droneRootFreq,
      hasSub: !!this.subOscs,
      glideMs: Math.round(this.glideTime() * 1000),
    });
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
    // Per-layer filter base cutoffs are derived from the root —
    // re-derive on retune so a transposed-up drone isn't choked (and a
    // transposed-down one isn't left with the filter parked uselessly
    // high). The MotionEngine walk re-centers on the new base on its
    // next tick; this keeps the intervening seconds sensible.
    for (const [type, filter] of this.layerFilters) {
      filter.frequency.setTargetAtTime(this.layerFilterBaseCutoff(type), now, Math.max(0.25, glide * 0.5));
    }
    // Dichotic cents depend on each voice's absolute frequency —
    // re-derive after a root change so the interaural beat stays at
    // the chosen entrain rate instead of tracking the old pitch.
    if (this.dichoticCents > 0) this.applyDichoticTargets();

    if (this.subOscs) this.glideOscPair(this.subOscs, freq * 0.5, now, glide);
  }

  setIntervals(intervalsCents: number[]): void {
    const next = intervalsCents.length > 0 ? intervalsCents : [0];
    const prevLen = this.droneIntervalsCents.length;
    this.droneIntervalsCents = next;
    trace("setIntervals", {
      n: next.length,
      prevN: prevLen,
      first3: next.slice(0, 3),
      droneOn: this.droneOn,
      path: !this.droneOn ? "skip" : next.length === prevLen ? "retune" : "rebuild",
    });
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
    // Same rationale as setDroneFreq: per-voice dichotic cents track
    // the voice's absolute frequency, so a retune must re-derive them.
    if (this.dichoticCents > 0) this.applyDichoticTargets();
  }

  setVoiceLayer(type: VoiceType, on: boolean): void {
    if (this.voiceLayers[type] === on) return;
    this.voiceLayers[type] = on;
    trace("voiceLayer", { type, on });
    this.scheduleVoiceRebuild();
  }

  getVoiceLayer(type: VoiceType): boolean { return this.voiceLayers[type]; }
  getVoiceLayers(): Record<VoiceType, boolean> { return { ...this.voiceLayers }; }

  setVoiceLevel(type: VoiceType, level: number): void {
    const v = Math.max(0, Math.min(1, level));
    this.layerLevels[type] = v;
    const gain = this.layerGains.get(type);
    if (gain) this.glideLayerGain(gain, this.effectiveLayerLevel(type), 0.08);
  }

  /** Sample a tracked crossfade curve at time t (linear interpolation
   *  between points, matching browser curve rendering). */
  private static sampleXfadeCurve(
    rec: { start: number; dur: number; curve: Float32Array },
    t: number,
  ): number {
    const n = rec.curve.length;
    const pos = Math.min(1, Math.max(0, (t - rec.start) / rec.dur)) * (n - 1);
    const i = Math.floor(pos);
    if (i >= n - 1) return rec.curve[n - 1];
    return rec.curve[i] + (rec.curve[i + 1] - rec.curve[i]) * (pos - i);
  }

  /** Cancel a layer gain's schedule and re-anchor it Chrome-safely,
   *  returning the anchored value. If our bookkeeping says a rebuild
   *  crossfade curve is still running, cancelScheduledValues(now)
   *  would NOT remove it in Chrome and the re-anchor would throw
   *  NotSupportedError — so cancel from the curve's start instead and
   *  anchor at the curve's sampled value (the level the fade had
   *  reached; no audible step). The stored start is the *nominal*
   *  schedule time; if Chrome clamped the curve later (start time
   *  already past when scheduled), the actual start is >= nominal, so
   *  cancelling from the nominal start still removes it. */
  private anchorLayerGainNow(gain: GainNode, now: number): number {
    const g = gain.gain;
    const rec = this.activeGainCurves.get(g);
    this.activeGainCurves.delete(g);
    if (rec && now < rec.start + rec.dur) {
      const v = VoiceEngine.sampleXfadeCurve(rec, now);
      g.cancelScheduledValues(rec.start);
      g.setValueAtTime(v, now);
      return v;
    }
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    return g.value;
  }

  /** Pad past a tracked curve window when deferring a glide behind it.
   *  Covers Chrome's start-time clamping: a curve scheduled with a
   *  just-past start is clamped to currentTime, shifting its real
   *  window slightly later than our nominal record (~1–2 render quanta
   *  under normal load); 50 ms ≈ 19 quanta absorbs heavy jank too. */
  private static readonly GLIDE_DEFER_PAD_SEC = 0.05;

  /** setTargetAtTime on a layer gain, safe against an in-flight
   *  rebuild crossfade. If a crossfade curve is running, do NOT cancel
   *  it — the material-motion tick fires every 2.2 s under EVOLVE, and
   *  cancelling would truncate the equal-power fade to a plain glide
   *  in exactly the evolving-drone case. Defer the glide to just past
   *  the curve's end instead (≤1.8 s late, inaudible on a drone). */
  private glideLayerGain(gain: GainNode, target: number, tc: number): void {
    const now = this.ctx.currentTime;
    const rec = this.activeGainCurves.get(gain.gain);
    if (rec && now < rec.start + rec.dur) {
      const after = rec.start + rec.dur + VoiceEngine.GLIDE_DEFER_PAD_SEC;
      try {
        // Clears any previously deferred glide without touching the
        // curve (its start is before the boundary).
        gain.gain.cancelScheduledValues(after);
        gain.gain.setTargetAtTime(target, after, tc);
        return;
      } catch {
        // Ultimate fallback: if the deferred schedule still collides
        // (pathological clamp drift), sacrifice the curve rather than
        // crash the view — the pre-audit behavior.
      }
    }
    this.anchorLayerGainNow(gain, now);
    gain.gain.setTargetAtTime(target, now, tc);
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
        if (gain) this.glideLayerGain(gain, this.effectiveLayerLevel(type), 0.08);
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
        if (gain) this.glideLayerGain(gain, this.effectiveLayerLevel(type), 0.08);
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
    const clamped = Math.max(0, Math.min(1, v));
    trace("setSub", { v: clamped, prev: this.subAmount, on: this.droneOn });
    this.subAmount = clamped;
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

  /** Global cross-voice COUPLE amount (0..1, default 0 = off). Builds
   *  the coupling core on first non-zero use and attaches any layers
   *  that were already live; per-layer injection gains then ramp to
   *  coupleAmount × COUPLE_MAX_TOTAL_INJECTION / N. */
  setCoupleAmount(v: number): void {
    const clamped = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
    this.coupleAmount = clamped;
    if (clamped > 0) {
      this.ensureCouplingCore();
      // Attach every layer that predates coupling activation —
      // attachCoupling is idempotent per layer.
      for (const [type, filter] of this.layerFilters) {
        const gain = this.layerGains.get(type);
        if (gain) this.attachCoupling(type, filter, gain);
      }
    }
    this.applyCouplingTargets();
  }

  getCoupleAmount(): number { return this.coupleAmount; }

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

  setNoiseColor(v: number): void {
    this.noiseColor = Math.max(0, Math.min(1, v));
    const voices = this.droneVoicesByLayer.get("noise");
    if (!voices) return;
    for (const voice of voices) voice.setColor(this.noiseColor);
  }

  getNoiseColor(): number { return this.noiseColor; }

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

  /** Max active voice layers. Set to 8 (all voices) on desktop, 4 on
   *  low-core devices. Called by AudioEngine once at construction and by
   *  the UI if the user overrides the auto-detected value. */
  setMaxVoiceLayers(n: number): void {
    this.maxVoiceLayers = Math.max(1, Math.min(ALL_VOICE_TYPES.length, Math.floor(n)));
    this.scheduleVoiceRebuild();
  }
  getMaxVoiceLayers(): number { return this.maxVoiceLayers; }

  /** Intended voices (scene/user-enabled) that the active voice cap is
   *  currently silencing — drives the "intended but capped" UI cue.
   *  Mirrors the FX suppressed-by-protection treatment in FxBar. */
  getSuppressedVoices(): VoiceType[] {
    const capped = this.capLayers(this.voiceLayers);
    return ALL_VOICE_TYPES.filter((t) => this.voiceLayers[t] && !capped[t]);
  }

  /** Seed the material-motion RNG from the scene so per-voice phase
   *  offsets + per-tick nudges reproduce across loads of a shared scene.
   *  Decorrelated from the evolve seed (XOR a constant) so the two seeded
   *  streams don't lock-step. Mirrors AudioEngine.setEvolveSeed. */
  setMaterialSeed(seed: number): void {
    this.materialRng = mulberry32((seed ^ 0x9e3779b9) >>> 0);
    this.materialPhaseOffsets = VoiceEngine.makeMaterialPhaseOffsets(this.materialRng);
  }

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
    // Pinned to baseMacroTC. Previously scaled by morphAmount, but
    // CROSSFADE (formerly MORPH) is now strictly the preset/scale
    // rebuild crossfade time — see rebuildIntervals() — so macro
    // smoothings are independent and predictable.
    return this.baseMacroTC;
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

    // CROSSFADE (morphAmount) is now the *only* input to the rebuild
    // crossfade time — ATTACK (bloomAmount) is reserved for the
    // silence→drone HOLD attack, see startDrone(). Linear map across
    // the clamped [MIN, MAX] range so 0 = quick (0.3 s) and
    // 1 = glacial (1.8 s); the knob is now predictable end-to-end.
    const bloom =
      VoiceEngine.MIN_REBUILD_XFADE_SEC +
      this.morphAmount *
        (VoiceEngine.MAX_REBUILD_XFADE_SEC - VoiceEngine.MIN_REBUILD_XFADE_SEC);

    const intervals = this.debugIntervals();
    const targetIntervalCount = intervals.length;
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

      // Stop the layer's cutoff walk now (the registry must not keep
      // nudging a retiring filter); the node itself is disconnected
      // with its gain after the fade, via scheduleRetire.
      const oldFilter = this.retireLayerFilter(type);
      const oldGain = this.layerGains.get(type);
      if (oldGain) {
        // Chrome-safe cancel + re-anchor (see anchorLayerGainNow) —
        // a retriggered rebuild lands inside the previous crossfade's
        // curve window, where a plain cancelScheduledValues(now) does
        // not protect the writes below.
        const cur = this.anchorLayerGainNow(oldGain, now);
        // Equal-power fade-out (cos shape) paired with the sin-shaped
        // fade-in below — see XFADE_OUT_PROGRESS. No setValueAtTime
        // anchor after the curve: the curve's last point is pinned to
        // the target already, and a post-curve anchor at now + bloom
        // can land inside the curve's own window when Chrome clamps a
        // just-past start time to currentTime (field crash).
        const outCurve = scaleXfadeCurve(XFADE_OUT_PROGRESS, cur, 0.0001);
        oldGain.gain.setValueCurveAtTime(outCurve, now, bloom);
        this.activeGainCurves.set(oldGain.gain, { start: now, dur: bloom, curve: outCurve });
        this.layerGains.delete(type);
        // Tear down the analyser tap too — the gain it was probing is
        // about to be retired/disconnected, so the tap would otherwise
        // linger as a stale entry pointing at a dead bus and the UI
        // meter would freeze at 0 once a fresh bus comes up.
        const oldAn = this.layerAnalysers.get(type);
        if (oldAn) {
          try { oldAn.disconnect(); } catch { /* ok */ }
          this.layerAnalysers.delete(type);
        }
        this.scheduleRetire(oldGain, voices, bloom, oldFilter);
      } else if (oldFilter) {
        try { oldFilter.disconnect(); } catch { /* ok */ }
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
      // Equal-power fade-in (sin shape), complement of the retiring
      // layer's cos fade-out above: g_out² + g_in² ≈ const, no −3 dB
      // mid-crossfade dip. End value pinned to the exact target by the
      // curve's last point; no post-curve anchor (see fade-out above).
      const layerTarget = this.effectiveLayerLevel(type);
      const inCurve = scaleXfadeCurve(XFADE_IN_PROGRESS, 0, layerTarget);
      layerGain.gain.setValueCurveAtTime(inCurve, now, bloom);
      this.activeGainCurves.set(layerGain.gain, { start: now, dur: bloom, curve: inCurve });
      this.layerGains.set(type, layerGain);
      // Re-attach the analyser tap to this freshly built bus so the
      // UI meter resumes after a layer rebuild. This path runs in
      // parallel with ensureLayerGain (which has its own tap setup);
      // both share the same teardown above.
      const an = this.ctx.createAnalyser();
      an.fftSize = 256;
      layerGain.connect(an);
      this.layerAnalysers.set(type, an);

      const layerFilter = this.ensureLayerFilter(type, layerGain);
      const voices: Voice[] = [];
      for (let i = 0; i < intervals.length; i++) {
        const c = intervals[i];
        const pan = layerVoicePan(i, intervals.length);
        const voice = buildVoice(type, this.ctx, layerFilter, this.droneRootFreq, c, this.drift, now, this.reedShape, this.fmRatio, this.fmIndex, this.fmFeedback, this.tanpuraTuning, pan);
        if (type === "tanpura") voice.setPluckRate(this.effectivePluckRate());
        if (type === "noise") voice.setColor(this.noiseColor);
        voice.setDrift(this.effectiveLayerDrift(type));
        voice.setDichoticCents(this.voiceDichoticCents(c));
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

  private scheduleRetire(gain: GainNode, voices: Voice[], bloom: number, filter: BiquadFilterNode | null = null): void {
    const stopAtMs = bloom * 1000 + 150;
    const entry: { gain: GainNode; voices: Voice[]; stopTimeout: number; filter: BiquadFilterNode | null } = {
      gain,
      voices,
      stopTimeout: 0,
      filter,
    };
    entry.stopTimeout = window.setTimeout(() => {
      const idx = this.pendingRetire.indexOf(entry);
      if (idx >= 0) this.pendingRetire.splice(idx, 1);
      this.activeGainCurves.delete(gain.gain);
      for (const voice of voices) {
        try { voice.stop(); } catch { /* ok */ }
      }
      try { gain.disconnect(); } catch { /* ok */ }
      if (filter) {
        try { filter.disconnect(); } catch { /* ok */ }
      }
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
      // anchorLayerGainNow: the retiring gain usually still has its
      // fade-out curve in flight, which a plain cancel(now) would not
      // remove in Chrome (the ramp below would throw).
      try {
        this.anchorLayerGainNow(entry.gain, now);
        entry.gain.gain.linearRampToValueAtTime(0, now + 0.03);
      } catch { /* ok */ }
      const { voices, gain, filter } = entry;
      window.setTimeout(() => {
        for (const voice of voices) {
          try { voice.stop(); } catch { /* ok */ }
        }
        try { gain.disconnect(); } catch { /* ok */ }
        if (filter) {
          try { filter.disconnect(); } catch { /* ok */ }
        }
      }, 50);
    }
  }

  /** Base cutoff for a layer's resonant lowpass: 4–6× the drone root
   *  (per-layer multiplier so no two layers share a resonance),
   *  clamped to [600 Hz, 12 kHz]. 4–6× the root sits above the strong
   *  partials of every voice model, so the filter is nearly
   *  transparent at rest — an idle walk ≈ the pre-E3 sound and the
   *  LUFS-audited preset balance survives. Re-derived on retune (see
   *  setDroneFreq) so the filter tracks pitch instead of choking a
   *  transposed-up drone. */
  private layerFilterBaseCutoff(type: VoiceType): number {
    const i = ALL_VOICE_TYPES.indexOf(type);
    const mult = 4 + 2 * (i / Math.max(1, ALL_VOICE_TYPES.length - 1));
    return Math.min(LAYER_FILTER_MAX_HZ, Math.max(LAYER_FILTER_MIN_HZ, this.droneRootFreq * mult));
  }

  /** Per-layer lowpass between the layer's voices and its layerGain.
   *  Q spreads 1.4 → 2.24 across the layer index — a gentle shelfy
   *  resonance bump, far below self-oscillation. Registers the
   *  filter's cutoff as a MotionEngine walk target; the unregister
   *  handle is kept so retiring the layer stops its walk. */
  private ensureLayerFilter(type: VoiceType, layerGain: GainNode): BiquadFilterNode {
    let filter = this.layerFilters.get(type);
    if (!filter) {
      const layerIndex = ALL_VOICE_TYPES.indexOf(type);
      filter = this.ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = this.layerFilterBaseCutoff(type);
      filter.Q.value = 1.4 + layerIndex * 0.12;
      filter.connect(layerGain);
      this.layerFilters.set(type, filter);
      this.layerFilterWalkStops.set(type, registerLayerFilterWalk({
        layerIndex,
        frequency: filter.frequency,
        getBaseCutoffHz: () => this.layerFilterBaseCutoff(type),
      }));
      // New layers join the coupling bus at build time (when COUPLE is
      // active) and everyone re-scales to the new 1/N.
      if (this.coupling) {
        this.attachCoupling(type, filter, layerGain);
        this.applyCouplingTargets();
      }
    }
    return filter;
  }

  /** Stop a layer's cutoff walk and drop the filter from the live
   *  maps. Returns the node so the caller can disconnect it — either
   *  immediately (dispose) or after the retire fade (rebuild). */
  private retireLayerFilter(type: VoiceType): BiquadFilterNode | null {
    const filter = this.layerFilters.get(type) ?? null;
    if (filter) this.layerFilters.delete(type);
    const stop = this.layerFilterWalkStops.get(type);
    if (stop) {
      stop();
      this.layerFilterWalkStops.delete(type);
    }
    // Drop the layer's coupling injection now. Cutting a ≤ 0.15/N
    // ambience feed mid-retire-fade is inaudible (the layer itself is
    // fading out at the same moment), and waiting for the fade would
    // mean threading the injection through pendingRetire for nothing.
    // (Optional chaining: fake-`this` test harnesses predating E4
    // don't carry the coupling fields.)
    const inj = this.couplingInjections?.get(type);
    if (inj) {
      this.couplingInjections.delete(type);
      try { inj.disconnect(); } catch { /* ok */ }
      if (this.coupling) {
        try { this.coupling.tone.disconnect(inj); } catch { /* ok */ }
      }
      // Survivors re-scale: 1/N just changed.
      this.applyCouplingTargets();
    }
    return filter;
  }

  /** Lazily build the shared coupling spine: bus → delay → tone.
   *  Nothing here makes sound until a per-layer injection gain rises
   *  above 0, so an idle core is acoustically free. */
  private ensureCouplingCore(): { bus: GainNode; delay: DelayNode; tone: BiquadFilterNode } {
    if (this.coupling) return this.coupling;
    const bus = this.ctx.createGain();
    bus.gain.value = 1;
    const delay = this.ctx.createDelay();
    delay.delayTime.value = COUPLE_DELAY_SEC;
    const tone = this.ctx.createBiquadFilter();
    tone.type = "bandpass";
    tone.frequency.value = COUPLE_TONE_HZ;
    tone.Q.value = COUPLE_TONE_Q;
    bus.connect(delay);
    delay.connect(tone);
    this.coupling = { bus, delay, tone };
    return this.coupling;
  }

  /** Join a layer to the coupling loop: tap its layerGain (post-filter,
   *  post-level — so crossfades and layer levels scale its bus
   *  contribution) into the bus, and feed the delayed/filtered bus back
   *  into the layer's filter input through a per-layer injection gain.
   *  Idempotent per layer; no-op until the coupling core exists. */
  private attachCoupling(type: VoiceType, filter: BiquadFilterNode, layerGain: GainNode): void {
    if (!this.coupling || this.couplingInjections.has(type)) return;
    layerGain.connect(this.coupling.bus);
    const inj = this.ctx.createGain();
    inj.gain.value = 0;
    this.coupling.tone.connect(inj);
    inj.connect(filter);
    this.couplingInjections.set(type, inj);
  }

  /** Ramp every injection gain to coupleAmount × cap / N. Anchor +
   *  setTargetAtTime per house style so retriggered knob moves and
   *  N-changes glide instead of stepping. */
  private applyCouplingTargets(): void {
    if (!this.couplingInjections || this.couplingInjections.size === 0) return;
    const n = this.couplingInjections.size;
    const target = (this.coupleAmount * COUPLE_MAX_TOTAL_INJECTION) / n;
    const now = this.ctx.currentTime;
    for (const inj of this.couplingInjections.values()) {
      inj.gain.cancelScheduledValues(now);
      inj.gain.setValueAtTime(inj.gain.value, now);
      inj.gain.setTargetAtTime(target, now, 0.12);
    }
  }

  private ensureLayerGain(type: VoiceType): GainNode {
    let gain = this.layerGains.get(type);
    if (!gain) {
      gain = this.ctx.createGain();
      gain.gain.value = this.effectiveLayerLevel(type);
      gain.connect(this.droneVoiceGain);
      this.layerGains.set(type, gain);
      // Attach the analyser tap once per voice. fftSize=256 gives a
      // 256-sample window — plenty for an RMS readout, cheap to scan
      // every frame. Smoothing is irrelevant for time-domain reads.
      const an = this.ctx.createAnalyser();
      an.fftSize = 256;
      gain.connect(an);
      this.layerAnalysers.set(type, an);
    }
    return gain;
  }

  getVoiceAnalyser(type: VoiceType): AnalyserNode | null {
    return this.layerAnalysers.get(type) ?? null;
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
    // Stagger note-on by a random fraction of one period so the
    // pair doesn't comb-filter into a peak at every drone start.
    // OscillatorNode.start(t) always aligns to phase 0 at t, so we
    // simulate phase randomization by offsetting `b` by 0..1/freq
    // seconds (one full cycle of jitter). At sub frequencies this
    // is a few milliseconds — perceptually instant, sonically
    // a fresh phase relationship every time.
    const period = 1 / Math.max(freq, 1);
    a.start(startAt + Math.random() * period);
    b.start(startAt + Math.random() * period);
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
    for (const type of ALL_VOICE_TYPES) {
      const gain = this.layerGains.get(type);
      if (gain) this.glideLayerGain(gain, this.effectiveLayerLevel(type), 0.18);
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

  /** Per-voice DICHOTIC detune. The L/R offset must be re-derived from
   *  each voice's own frequency so the interaural difference stays at
   *  the entrain rate in Hz — a fixed-cents offset makes the beat
   *  scale with pitch (~8 ¢ ≈ 1 Hz at 220 Hz but ≈ 4 Hz at 880 Hz),
   *  silently detaching the audible beat from the rate the user chose,
   *  which is the one parameter binaural-beat practice specifies.
   *  The cents AudioEngine fans out act as the on/off gate (0 = off);
   *  the magnitude comes from the latched entrain rate. */
  private voiceDichoticCents(intervalCents: number): number {
    if (!(this.dichoticCents > 0)) return 0;
    const voiceHz = this.droneRootFreq * Math.pow(2, intervalCents / 1200);
    return dichoticCentsForFrequency(latchedEntrainRateHz(), voiceHz);
  }

  /** Push the current ENTRAIN dichotic detune to every live voice.
   *  Cheap — each voice forwards a single postMessage to its worklet.
   *  Voices were built index-parallel to the interval list, so
   *  intervals[i] is voice i's offset from the root. */
  private applyDichoticTargets(): void {
    const intervals = this.debugIntervals();
    for (const type of ALL_VOICE_TYPES) {
      const voices = this.droneVoicesByLayer.get(type);
      if (!voices) continue;
      for (let i = 0; i < voices.length; i++) {
        voices[i].setDichoticCents(this.voiceDichoticCents(intervals[i] ?? 0));
      }
    }
  }

  /** Set the dichotic L/R spread gate in cents (0 = off). Broadcasts
   *  the per-voice frequency-dependent detune to live voices and
   *  stores the gate so newly-spawned voices inherit it. */
  setDichoticCents(cents: number): void {
    const clamped = Number.isFinite(cents) ? Math.max(0, Math.min(100, cents)) : 0;
    this.dichoticCents = clamped;
    this.applyDichoticTargets();
  }

  getDichoticCents(): number { return this.dichoticCents; }

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
      const randomNudge = (this.materialRng() - 0.5) * wobble * 0.4 * intensity;
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
    this.materialLevelOffsets = { tanpura: 0, reed: 0, metal: 0, air: 0, piano: 0, fm: 0, amp: 0, noise: 0 };
    this.materialDriftScales = { tanpura: 1, reed: 1, metal: 1, air: 1, piano: 1, fm: 1, amp: 1, noise: 1 };
    this.materialPluckFactor = 1;
    this.materialSubFactor = 1;
  }

  /** Release all long-lived resources owned by this voice engine:
   *  the recurring material-motion interval, any pending one-shot stop
   *  timeouts, all live + retiring voices, the sub oscillator pair, and
   *  the owned gain/filter/analyser nodes. Does NOT close the
   *  AudioContext — that is owned by AudioEngine. Called from
   *  AudioEngine.dispose(); without it the material-motion interval kept
   *  firing setTargetAtTime against a closed context and pinned the whole
   *  voice graph in memory after dispose/HMR. Best-effort and idempotent. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.activeGainCurves.clear();

    if (this.materialInterval != null) {
      window.clearInterval(this.materialInterval);
      this.materialInterval = null;
    }
    if (this.stopDroneTimeout != null) {
      clearTimeout(this.stopDroneTimeout);
      this.stopDroneTimeout = null;
    }

    // Pending-retire voices from in-flight rebuilds: cancel their delayed
    // stop and tear them down immediately.
    for (const entry of this.pendingRetire.splice(0)) {
      clearTimeout(entry.stopTimeout);
      for (const v of entry.voices) {
        try { v.stop(); } catch { /* best-effort */ }
      }
      try { entry.gain.disconnect(); } catch { /* best-effort */ }
      if (entry.filter) {
        try { entry.filter.disconnect(); } catch { /* best-effort */ }
      }
    }

    // Live voices.
    for (const voices of this.droneVoicesByLayer.values()) {
      for (const v of voices) {
        try { v.stop(); } catch { /* best-effort */ }
      }
    }
    this.droneVoicesByLayer.clear();

    if (this.subOscs) {
      try { this.subOscs.a.stop(); this.subOscs.a.disconnect(); } catch { /* best-effort */ }
      try { this.subOscs.b.stop(); this.subOscs.b.disconnect(); } catch { /* best-effort */ }
      this.subOscs = null;
    }

    // Layer filters: unregister every cutoff-walk target first (the
    // MotionEngine registry must not keep scheduling against a dead
    // graph), then disconnect the nodes.
    for (const stop of this.layerFilterWalkStops.values()) stop();
    this.layerFilterWalkStops.clear();
    for (const f of this.layerFilters.values()) {
      try { f.disconnect(); } catch { /* best-effort */ }
    }
    this.layerFilters.clear();

    // Coupling graph (E4): injections first (they hold the only
    // references back into the layer filters), then the shared spine.
    // Guards exist for fake-`this` test harnesses predating E4.
    if (this.couplingInjections) {
      for (const inj of this.couplingInjections.values()) {
        try { inj.disconnect(); } catch { /* best-effort */ }
      }
      this.couplingInjections.clear();
    }
    if (this.coupling) {
      for (const node of [this.coupling.bus, this.coupling.delay, this.coupling.tone]) {
        try { node.disconnect(); } catch { /* best-effort */ }
      }
      this.coupling = null;
    }

    for (const g of this.layerGains.values()) {
      try { g.disconnect(); } catch { /* best-effort */ }
    }
    this.layerGains.clear();
    for (const an of this.layerAnalysers.values()) {
      try { an.disconnect(); } catch { /* best-effort */ }
    }
    this.layerAnalysers.clear();

    for (const node of [this.droneVoiceGain, this.subVoiceGain, this.shimmerVoiceGain, this.droneFilter]) {
      try { node.disconnect(); } catch { /* best-effort */ }
    }

    this.droneOn = false;
  }
}
