/**
 * LiveSafeMode — explicit, user-initiated runtime reliability mode.
 *
 * Distinct from AdaptiveStabilityEngine: that controller reacts to
 * audio-thread struggle. LIVE SAFE is a deliberate "stability over
 * richness" choice the performer makes before stepping on stage. It:
 *
 *   - clamps the active voice cap to a conservative value (4)
 *   - bypasses the highest-risk FX (halo / granular / graincloud /
 *     shimmer / freeze) at runtime
 *   - engages a low-power visual overlay (engine-level, separate from
 *     the user's persisted low-power setting)
 *
 * On disable, the controller restores only what it changed and only if
 * the user hasn't re-touched it in the meantime — conservative revert
 * so we never fight a deliberate mid-mode user choice.
 *
 * Saved scenes / share URLs / persisted settings are not mutated. The
 * "live-safe" persisted bit lives at the Layout layer; this controller
 * is the engine-side mechanism, idempotent on repeat enable/disable.
 */
import type { EffectId } from "./FxChain";

/** Effects most likely to push a struggling box past the buffer
 *  budget. Tier ordering matches the adaptive engine's heavy-FX list,
 *  with halo first because it's the spendiest tail. Cistern joins the
 *  list because the long convolution tail is one of the heavier
 *  worklet reverbs — already mitigated by AdaptiveStabilityEngine
 *  stage-2 — and a deliberate stage choice should bypass it too. */
export const LIVE_SAFE_HEAVY_FX: readonly EffectId[] = [
  "halo", "granular", "graincloud", "shimmer", "freeze", "cistern",
];

/** Voice-layer ceiling under LIVE SAFE. Below 4 the drone loses
 *  characteristic stack thickness; above 4 we start risking under-runs
 *  on weaker hardware. */
export const LIVE_SAFE_VOICE_CAP = 4;

export type StageRisk = "low" | "medium" | "high";

/** Stage-readiness classifier — a derived helper, not preset metadata.
 *  Any new preset is auto-classified by its voice-layer count and the
 *  set of FX it asks to enable. The optional stageRiskOverride field
 *  on a preset is the rare escape hatch for "measures heavy but is fine
 *  in practice". Authoring stays low-friction: nothing to remember. */
export interface StageRiskInput {
  voiceLayers: readonly unknown[];
  effects: readonly EffectId[];
  stageRiskOverride?: StageRisk;
}

export function stageRiskOf(p: StageRiskInput): StageRisk {
  if (p.stageRiskOverride) return p.stageRiskOverride;
  const heavyOn = p.effects.filter((e) => LIVE_SAFE_HEAVY_FX.includes(e)).length;
  const dense = p.voiceLayers.length > LIVE_SAFE_VOICE_CAP;
  if (heavyOn >= 2 && dense) return "high";
  if (heavyOn >= 2 || (heavyOn >= 1 && dense)) return "medium";
  if (heavyOn >= 1 || dense) return "medium";
  return "low";
}

export interface LiveSafeAdapter {
  /** Toggle the engine-side LIVE-SAFE low-power overlay. Composed with
   *  the user's persisted low-power setting and the adaptive overlay
   *  inside AudioEngine.isLowPower(). */
  setLiveSafeLowPower(on: boolean): void;
  getEffectStates(): Record<EffectId, boolean>;
  setEffect(id: EffectId, on: boolean): void;
  getMaxVoiceLayers(): number;
  setMaxVoiceLayers(n: number): void;
  notify?(message: string, kind: "info" | "warning"): void;
}

export interface LiveSafeState {
  active: boolean;
  /** Effective voice cap currently being enforced, or null. */
  voiceCap: number | null;
  /** FX this controller has temporarily forced off. UI may render
   *  these as ON-but-suppressed similarly to adaptive mitigation. */
  suppressedFx: readonly EffectId[];
}

type Listener = (s: LiveSafeState) => void;

export class LiveSafeMode {
  private readonly adapter: LiveSafeAdapter;
  private active = false;

  // Saved pre-mode state. null = not currently overriding that knob.
  private savedVoiceMax: number | null = null;
  private suppressedFx: EffectId[] = [];

  private readonly listeners = new Set<Listener>();

  constructor(adapter: LiveSafeAdapter) {
    this.adapter = adapter;
  }

  isActive(): boolean { return this.active; }

  getState(): LiveSafeState {
    return {
      active: this.active,
      voiceCap: this.savedVoiceMax !== null ? LIVE_SAFE_VOICE_CAP : null,
      suppressedFx: [...this.suppressedFx],
    };
  }

  setActive(on: boolean): void {
    if (on === this.active) return;
    this.active = on;
    if (on) this.apply();
    else this.revert();
    this.adapter.notify?.(
      on
        ? "LIVE SAFE on — prioritizing audio stability."
        : "LIVE SAFE off.",
      "info",
    );
    this.emit();
  }

  private apply(): void {
    // Voice cap — clamp to ceiling, never raise. Save the previous cap
    // so a clean disable restores it.
    const cap = this.adapter.getMaxVoiceLayers();
    if (cap > LIVE_SAFE_VOICE_CAP) {
      this.savedVoiceMax = cap;
      this.adapter.setMaxVoiceLayers(LIVE_SAFE_VOICE_CAP);
    }
    // Heavy FX — only suppress those currently enabled, so the revert
    // list reflects user intent (won't enable a FX that was off).
    const states = this.adapter.getEffectStates();
    for (const id of LIVE_SAFE_HEAVY_FX) {
      if (states[id]) {
        this.adapter.setEffect(id, false);
        this.suppressedFx.push(id);
      }
    }
    // Visual throttle.
    this.adapter.setLiveSafeLowPower(true);
  }

  private revert(): void {
    // Voice cap — only restore if the cap is still where LIVE SAFE put
    // it. If the user moved it deliberately mid-mode, leave their
    // value alone.
    if (this.savedVoiceMax !== null) {
      if (this.adapter.getMaxVoiceLayers() === LIVE_SAFE_VOICE_CAP) {
        this.adapter.setMaxVoiceLayers(this.savedVoiceMax);
      }
      this.savedVoiceMax = null;
    }
    // FX — only re-enable those still off (user hasn't toggled mid-mode).
    const states = this.adapter.getEffectStates();
    for (const id of this.suppressedFx) {
      if (states[id] === false) this.adapter.setEffect(id, true);
    }
    this.suppressedFx = [];
    this.adapter.setLiveSafeLowPower(false);
  }

  /** True for FX the controller has currently forced off — used by UI
   *  to render the button as ON-but-suppressed instead of OFF. */
  isFxSuppressed(id: EffectId): boolean {
    return this.suppressedFx.includes(id);
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
}
