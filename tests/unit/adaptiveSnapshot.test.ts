import { describe, it, expect } from "vitest";
import {
  AdaptiveStabilityEngine,
  type AdaptiveAdapter,
  type AdaptiveLoadSource,
} from "../../src/engine/AdaptiveStabilityEngine";
import { EFFECT_ORDER, type EffectId } from "../../src/engine/FxChain";

/**
 * Persistence-boundary guard. The adaptive controller writes to the
 * live FxChain, but snapshot/share/autosave code paths must read user
 * intent — not the suppressed runtime state — so a snapshot taken
 * during mitigation preserves the user's intended FX configuration.
 *
 * AudioEngine.getUserEffectStates() is the single public read for
 * those paths. We model it here against a minimal composition so the
 * contract is locked in without spinning a full AudioContext.
 */
class FakeMonitor implements AdaptiveLoadSource {
  private listeners = new Set<(s: { struggling: boolean; underruns: number }) => void>();
  state = { struggling: false, underruns: 0 };
  getState() { return this.state; }
  subscribe(l: (s: { struggling: boolean; underruns: number }) => void) {
    this.listeners.add(l);
    return () => { this.listeners.delete(l); };
  }
  emit(next: Partial<{ struggling: boolean; underruns: number }>) {
    this.state = { ...this.state, ...next };
    for (const l of this.listeners) l(this.state);
  }
}

function getUserEffectStates(
  liveStates: Record<EffectId, boolean>,
  ctrl: AdaptiveStabilityEngine,
): Record<EffectId, boolean> {
  const out = { ...liveStates };
  for (const id of Object.keys(out) as EffectId[]) {
    if (ctrl.isFxSuppressed(id)) out[id] = true;
  }
  return out;
}

describe("snapshot persistence boundary", () => {
  it("preserves user-intended FX-on for adaptive-suppressed effects", () => {
    const monitor = new FakeMonitor();
    const liveEffects: Record<EffectId, boolean> = {} as Record<EffectId, boolean>;
    for (const id of EFFECT_ORDER) liveEffects[id] = false;
    liveEffects.shimmer = true;
    liveEffects.granular = true;
    liveEffects.tape = true; // not heavy — should be unaffected

    let now = 0;
    const adapter: AdaptiveAdapter = {
      setAdaptiveLowPower: () => {},
      getEffectStates: () => ({ ...liveEffects }),
      setEffect: (id, on) => { liveEffects[id] = on; },
      getMaxVoiceLayers: () => 7,
      setMaxVoiceLayers: () => {},
      notify: () => {},
      now: () => now,
    };
    const ctrl = new AdaptiveStabilityEngine(monitor, adapter, {
      cooldownEscalateMs: 1000,
      cooldownRecoverMs: 4000,
      stableMs: 8000,
    });

    // Drive into stage 2 — heavy FX get suppressed in the live record.
    now = 10000;
    monitor.emit({ struggling: true, underruns: 1 });
    now = 12000;
    monitor.emit({ struggling: true, underruns: 2 });
    expect(liveEffects.shimmer).toBe(false);
    expect(liveEffects.granular).toBe(false);

    // Live read leaks suppression — snapshot must NOT use this.
    expect(liveEffects.shimmer).toBe(false);

    // User-intent read — what snapshot/share/autosave should use.
    const snapshot = getUserEffectStates(liveEffects, ctrl);
    expect(snapshot.shimmer).toBe(true);
    expect(snapshot.granular).toBe(true);
    expect(snapshot.tape).toBe(true);
    expect(snapshot.halo).toBe(false); // user-intent OFF stays OFF
  });

  it("does not promote OFF effects to ON (booleans, not OR-merge)", () => {
    const monitor = new FakeMonitor();
    const liveEffects: Record<EffectId, boolean> = {} as Record<EffectId, boolean>;
    for (const id of EFFECT_ORDER) liveEffects[id] = false;
    // No heavy fx are on, so stage 2 will find nothing to bypass.
    let now = 0;
    const adapter: AdaptiveAdapter = {
      setAdaptiveLowPower: () => {},
      getEffectStates: () => ({ ...liveEffects }),
      setEffect: (id, on) => { liveEffects[id] = on; },
      getMaxVoiceLayers: () => 7,
      setMaxVoiceLayers: () => {},
      notify: () => {},
      now: () => now,
    };
    const ctrl = new AdaptiveStabilityEngine(monitor, adapter, {
      cooldownEscalateMs: 1000,
      cooldownRecoverMs: 4000,
      stableMs: 8000,
    });
    now = 10000;
    monitor.emit({ struggling: true, underruns: 1 });
    now = 12000;
    monitor.emit({ struggling: true, underruns: 2 });
    const snapshot = getUserEffectStates(liveEffects, ctrl);
    for (const id of EFFECT_ORDER) {
      expect(snapshot[id]).toBe(false);
    }
  });
});
