/**
 * AdaptiveStabilityEngine — staged audio-load mitigation.
 *
 * Subscribes to AudioLoadMonitor. When the audio thread is sustainedly
 * struggling, escalates through three stages of recovery, each separated
 * by a cooldown so the graph isn't flapped on noisy monitor signals:
 *
 *   stage 0  normal — no mitigation
 *   stage 1  visual / low-power mitigation (engine.setLowPowerMode(true))
 *   stage 2  heavy-FX mitigation (bypass shimmer/granular/graincloud/halo,
 *            then freeze/cistern/hall/plate as needed)
 *   stage 3  voice mitigation (lower max active voice layers)
 *
 * When the monitor reports no new underruns for a sustained window,
 * de-escalates one stage at a time and restores the saved runtime state.
 * Saved state is kept in the controller — saved scenes / share URLs /
 * persisted user settings are never mutated.
 */
import type { EffectId } from "./FxChain";

export type AdaptiveStage = 0 | 1 | 2 | 3;

export interface AdaptiveStabilityState {
  stage: AdaptiveStage;
  lowPower: boolean;
  /** Effects this controller has temporarily forced off (in order). */
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
  isLowPower(): boolean;
  setLowPower(on: boolean): void;
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
  /** Min ms between stage changes (escalation or de-escalation). */
  cooldownMs: 9000,
  /** Underrun-free window required to begin recovery. */
  stableMs: 18000,
  /** Voice-layer reduction when stage 3 engages. */
  voiceCapDelta: 2,
  /** How many heavy FX to bypass per escalation step into stage 2. */
  fxStepCount: 4,
} as const;

export interface AdaptiveStabilityOptions {
  cooldownMs?: number;
  stableMs?: number;
  voiceCapDelta?: number;
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

  // Saved runtime state — only what the controller itself overrode.
  private savedLowPower: boolean | null = null;
  private bypassedFx: EffectId[] = [];
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
      cooldownMs: opts.cooldownMs ?? DEFAULTS.cooldownMs,
      stableMs: opts.stableMs ?? DEFAULTS.stableMs,
      voiceCapDelta: opts.voiceCapDelta ?? DEFAULTS.voiceCapDelta,
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
    if (sinceStage < this.opts.cooldownMs) return;

    if (s.struggling && this.stage < 3) {
      this.escalate(now);
      return;
    }

    if (
      !s.struggling &&
      this.stage > 0 &&
      now - this.lastUnderrunAt >= this.opts.stableMs
    ) {
      this.deescalate(now);
    }
  }

  private escalate(now: number): void {
    const next = (this.stage + 1) as AdaptiveStage;
    if (next === 1) this.applyStage1();
    else if (next === 2) this.applyStage2();
    else if (next === 3) this.applyStage3();
    this.stage = next;
    this.lastStageChangeAt = now;
    this.hasMitigated = true;
    this.emit();
    if (next === 1) {
      this.adapter.notify(
        "Audio under load — reducing visual load.",
        "warning",
      );
    } else if (next === 2) {
      this.adapter.notify(
        "Audio still under load — bypassing heavy effects.",
        "warning",
      );
    } else {
      this.adapter.notify(
        "Audio still under load — reducing voice layers.",
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
    if (this.savedLowPower === null) {
      this.savedLowPower = this.adapter.isLowPower();
    }
    if (!this.adapter.isLowPower()) this.adapter.setLowPower(true);
  }

  private revertStage1(): void {
    if (this.savedLowPower !== null) {
      // Only restore if we were the one who toggled it on.
      if (!this.savedLowPower && this.adapter.isLowPower()) {
        this.adapter.setLowPower(false);
      }
      this.savedLowPower = null;
    }
  }

  private applyStage2(): void {
    const enabled = this.adapter.getEffectStates();
    const targets = HEAVY_FX_PRIORITY
      .filter((id) => enabled[id])
      .slice(0, this.opts.fxStepCount);
    for (const id of targets) {
      this.adapter.setEffect(id, false);
      this.bypassedFx.push(id);
    }
  }

  private revertStage2(): void {
    while (this.bypassedFx.length) {
      const id = this.bypassedFx.pop()!;
      // Only re-enable if the user hasn't manually changed it back on
      // (or off) in the meantime — getEffectStates() reflects current
      // user intent.
      const states = this.adapter.getEffectStates();
      if (states[id] === false) this.adapter.setEffect(id, true);
    }
  }

  private applyStage3(): void {
    const current = this.adapter.getMaxVoiceLayers();
    if (this.savedVoiceMax === null) this.savedVoiceMax = current;
    const target = Math.max(1, current - this.opts.voiceCapDelta);
    if (target < current) this.adapter.setMaxVoiceLayers(target);
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
      lowPower: this.savedLowPower !== null,
      bypassedFx: [...this.bypassedFx],
      voiceCap: this.savedVoiceMax !== null
        ? this.adapter.getMaxVoiceLayers()
        : null,
    };
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
