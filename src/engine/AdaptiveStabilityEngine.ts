/**
 * AdaptiveStabilityEngine — staged audio-load mitigation.
 *
 * Subscribes to AudioLoadMonitor. When the audio thread is sustainedly
 * struggling, escalates through three stages of recovery, each separated
 * by a cooldown so the graph isn't flapped on noisy monitor signals:
 *
 *   stage 0  normal — no mitigation
 *   stage 1  visual / low-power overlay (adaptive flag, OR'd with the
 *            user's persisted low-power setting inside AudioEngine)
 *   stage 2  heavy-FX mitigation — temporarily forces shimmer / granular
 *            / graincloud / halo off (the user-intent layer is preserved
 *            so snapshots and the FxBar still report them as ON)
 *   stage 3  voice mitigation — progressive: first cap step is decisive
 *            (e.g. 7→4 / 5→4 / 4→3), subsequent struggle past cooldown
 *            steps the cap down by 1 until the musical floor (3)
 *
 * Mitigation is fast (≈9 s cooldown). Recovery is slow (≈20 s cooldown
 * + a 30 s underrun-free window) — performances shouldn't bounce back
 * into danger after a brief lull. Stages unwind one at a time.
 *
 * Saved scenes / share URLs / persisted user settings are never mutated.
 * The controller keeps its own runtime overlay; the engine composes
 * user intent and adaptive overlay when reporting effective state.
 */
import type { EffectId } from "./FxChain";

export type AdaptiveStage = 0 | 1 | 2 | 3;

export interface AdaptiveStabilityState {
  stage: AdaptiveStage;
  /** Adaptive low-power overlay is currently active. */
  lowPower: boolean;
  /** Effects this controller has temporarily forced off. UI should
   *  render these as "ON, suppressed" rather than OFF. */
  bypassedFx: readonly EffectId[];
  /** Voice cap currently being enforced by the controller, or null. */
  voiceCap: number | null;
}

interface LoadSnapshot {
  struggling: boolean;
  underruns: number;
}

export interface AdaptiveLoadSource {
  getState(): LoadSnapshot;
  subscribe(listener: (s: LoadSnapshot) => void): () => void;
}

/** Minimal surface the controller needs from the engine. Kept small so
 *  tests can drive it with a plain object instead of a live AudioEngine. */
export interface AdaptiveAdapter {
  /** Set the adaptive low-power overlay. The engine OR's this with the
   *  user's persisted low-power setting before applying — so this never
   *  observes or stomps user intent. */
  setAdaptiveLowPower(on: boolean): void;
  getEffectStates(): Record<EffectId, boolean>;
  setEffect(id: EffectId, on: boolean): void;
  getMaxVoiceLayers(): number;
  setMaxVoiceLayers(n: number): void;
  notify(message: string, kind: "info" | "warning"): void;
  now(): number;
}

/** Order matters: drop the most expensive tails first. Restored in
 *  reverse order so the gentler effects come back before the heaviest. */
const HEAVY_FX_PRIORITY: readonly EffectId[] = [
  "shimmer", "granular", "graincloud", "halo",
  "freeze", "cistern", "hall", "plate",
];

const DEFAULTS = {
  /** Min ms between escalation stage changes. Mitigation is fast. */
  cooldownEscalateMs: 9000,
  /** Min ms between recovery stage changes. Recovery is slow — a brief
   *  lull shouldn't bounce a performance back into the danger zone. */
  cooldownRecoverMs: 20000,
  /** Underrun-free window required to begin recovery. */
  stableMs: 30000,
  /** Floor for stage-3 progressive cap reduction. Below 3 voices the
   *  drone loses its core stack — a musical limit, not just a CPU one. */
  minVoiceCap: 3,
  /** First-entry stage 3 ceiling — the initial reduction is decisive
   *  (clamps high caps straight to 4) so we don't crawl down from 7→6
   *  while the audio is still struggling. */
  voiceCapInitialCeiling: 4,
  /** How many heavy FX to bypass per escalation step into stage 2. */
  fxStepCount: 4,
} as const;

export interface AdaptiveStabilityOptions {
  cooldownEscalateMs?: number;
  cooldownRecoverMs?: number;
  stableMs?: number;
  minVoiceCap?: number;
  voiceCapInitialCeiling?: number;
  fxStepCount?: number;
}

type Listener = (s: AdaptiveStabilityState) => void;

export class AdaptiveStabilityEngine {
  private readonly adapter: AdaptiveAdapter;
  private readonly opts: Required<AdaptiveStabilityOptions>;

  private stage: AdaptiveStage = 0;
  private lastStageChangeAt = -Infinity;
  private lastUnderruns = 0;
  private lastUnderrunAt = -Infinity;

  // Adaptive overlays — the engine composes these with user intent.
  private adaptiveLowPower = false;
  private bypassedFx: EffectId[] = [];
  private bypassedFxSet: Set<EffectId> = new Set();
  private savedVoiceMax: number | null = null;

  /** Suppresses the immediate "Audio recovered" toast on first init when
   *  there has been no mitigation. */
  private hasMitigated = false;

  private readonly listeners = new Set<Listener>();
  private unsubSource: (() => void) | null = null;

  constructor(
    source: AdaptiveLoadSource,
    adapter: AdaptiveAdapter,
    opts: AdaptiveStabilityOptions = {},
  ) {
    this.adapter = adapter;
    this.opts = {
      cooldownEscalateMs: opts.cooldownEscalateMs ?? DEFAULTS.cooldownEscalateMs,
      cooldownRecoverMs: opts.cooldownRecoverMs ?? DEFAULTS.cooldownRecoverMs,
      stableMs: opts.stableMs ?? DEFAULTS.stableMs,
      minVoiceCap: opts.minVoiceCap ?? DEFAULTS.minVoiceCap,
      voiceCapInitialCeiling: opts.voiceCapInitialCeiling ?? DEFAULTS.voiceCapInitialCeiling,
      fxStepCount: opts.fxStepCount ?? DEFAULTS.fxStepCount,
    };
    this.lastUnderruns = source.getState().underruns;
    this.unsubSource = source.subscribe((s) => this.onLoad(s));
  }

  private onLoad(s: LoadSnapshot): void {
    const now = this.adapter.now();
    if (s.underruns > this.lastUnderruns) {
      this.lastUnderrunAt = now;
      this.lastUnderruns = s.underruns;
    }

    const sinceStage = now - this.lastStageChangeAt;
    // Stage 3 keeps escalating *within* the stage by stepping the voice
    // cap down further on each cooldown tick, until the musical floor.
    const canStepStage3 = this.stage === 3 && this.canReduceVoiceCap();
    const escalating = s.struggling && (this.stage < 3 || canStepStage3);
    const recovering = !s.struggling
      && this.stage > 0
      && now - this.lastUnderrunAt >= this.opts.stableMs;

    const cooldown = escalating
      ? this.opts.cooldownEscalateMs
      : this.opts.cooldownRecoverMs;
    if (sinceStage < cooldown) return;

    if (escalating) this.escalate(now);
    else if (recovering) this.deescalate(now);
  }

  private escalate(now: number): void {
    if (this.stage === 3) {
      // Progressive in-stage step — already at stage 3, push the voice
      // cap one step lower (no stage transition, no extra mitigations).
      if (!this.stepVoiceCap()) return;
      this.lastStageChangeAt = now;
      this.emit();
      this.adapter.notify(
        "Audio under load — reducing voice density.",
        "warning",
      );
      return;
    }

    const next = (this.stage + 1) as AdaptiveStage;
    if (next === 1) this.applyStage1();
    else if (next === 2) this.applyStage2();
    else if (next === 3) {
      if (!this.stepVoiceCap()) {
        // Already at the floor (or no headroom) — don't pretend to
        // mitigate. Leave the stage where it is so the cooldown isn't
        // reset on a no-op.
        return;
      }
    }
    this.stage = next;
    this.lastStageChangeAt = now;
    this.hasMitigated = true;
    this.emit();
    if (next === 1) {
      this.adapter.notify("Audio under load — reducing visuals.", "warning");
    } else if (next === 2) {
      this.adapter.notify("Audio under load — simplifying FX.", "warning");
    } else {
      this.adapter.notify(
        "Audio under load — reducing voice density.",
        "warning",
      );
    }
  }

  private deescalate(now: number): void {
    const prev = this.stage;
    if (prev === 3) this.revertStage3();
    else if (prev === 2) this.revertStage2();
    else if (prev === 1) this.revertStage1();
    this.stage = (prev - 1) as AdaptiveStage;
    this.lastStageChangeAt = now;
    this.emit();
    if (this.stage === 0 && this.hasMitigated) {
      this.hasMitigated = false;
      this.adapter.notify("Audio recovered.", "info");
    }
  }

  private applyStage1(): void {
    this.adaptiveLowPower = true;
    this.adapter.setAdaptiveLowPower(true);
  }

  private revertStage1(): void {
    this.adaptiveLowPower = false;
    this.adapter.setAdaptiveLowPower(false);
  }

  private applyStage2(): void {
    const enabled = this.adapter.getEffectStates();
    const targets = HEAVY_FX_PRIORITY
      .filter((id) => enabled[id])
      .slice(0, this.opts.fxStepCount);
    for (const id of targets) {
      this.adapter.setEffect(id, false);
      this.bypassedFx.push(id);
      this.bypassedFxSet.add(id);
    }
  }

  private revertStage2(): void {
    while (this.bypassedFx.length) {
      const id = this.bypassedFx.pop()!;
      this.bypassedFxSet.delete(id);
      // Only re-enable if the user hasn't manually changed it back on
      // (or off) in the meantime — getEffectStates() reflects the live
      // FxChain state, which the user can have re-toggled while
      // mitigation was active.
      const states = this.adapter.getEffectStates();
      if (states[id] === false) this.adapter.setEffect(id, true);
    }
  }

  /** Compute the next voice cap given the current cap. First-entry
   *  reduction is decisive (clamps high caps to voiceCapInitialCeiling);
   *  subsequent steps drop by 1, never below minVoiceCap. */
  private nextVoiceCap(current: number): number {
    const floor = this.opts.minVoiceCap;
    if (this.savedVoiceMax === null) {
      // First entry into stage 3.
      return Math.max(floor, Math.min(current - 1, this.opts.voiceCapInitialCeiling));
    }
    return Math.max(floor, current - 1);
  }

  private canReduceVoiceCap(): boolean {
    const current = this.adapter.getMaxVoiceLayers();
    return this.nextVoiceCap(current) < current;
  }

  /** Step the voice cap one progressive notch toward the floor. Returns
   *  true if the cap actually changed. Saves the original cap on first
   *  call so recovery can restore it in one shot. */
  private stepVoiceCap(): boolean {
    const current = this.adapter.getMaxVoiceLayers();
    const target = this.nextVoiceCap(current);
    if (target >= current) return false;
    if (this.savedVoiceMax === null) this.savedVoiceMax = current;
    this.adapter.setMaxVoiceLayers(target);
    return true;
  }

  private revertStage3(): void {
    if (this.savedVoiceMax !== null) {
      this.adapter.setMaxVoiceLayers(this.savedVoiceMax);
      this.savedVoiceMax = null;
    }
  }

  getState(): AdaptiveStabilityState {
    return {
      stage: this.stage,
      lowPower: this.adaptiveLowPower,
      bypassedFx: [...this.bypassedFx],
      voiceCap: this.savedVoiceMax !== null
        ? this.adapter.getMaxVoiceLayers()
        : null,
    };
  }

  /** True when the given effect id is currently being suppressed by
   *  the controller (user-intent ON, runtime OFF). Used by AudioEngine
   *  to compose getUserEffectStates() without exposing internal state. */
  isFxSuppressed(id: EffectId): boolean {
    return this.bypassedFxSet.has(id);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => { this.listeners.delete(listener); };
  }

  private emit(): void {
    const s = this.getState();
    for (const l of this.listeners) l(s);
  }

  dispose(): void {
    if (this.unsubSource) this.unsubSource();
    this.unsubSource = null;
    this.listeners.clear();
  }
}
