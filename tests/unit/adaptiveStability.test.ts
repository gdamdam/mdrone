import { describe, it, expect, beforeEach } from "vitest";
import {
  AdaptiveStabilityEngine,
  type AdaptiveAdapter,
  type AdaptiveLoadSource,
} from "../../src/engine/AdaptiveStabilityEngine";
import { EFFECT_ORDER, type EffectId } from "../../src/engine/FxChain";

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

interface FakeAdapter extends AdaptiveAdapter {
  fakeNow: number;
  lowPower: boolean;
  effects: Record<EffectId, boolean>;
  voiceMax: number;
  notifications: { msg: string; kind: "info" | "warning" }[];
}

function makeAdapter(overrides: Partial<FakeAdapter> = {}): FakeAdapter {
  const effects: Record<EffectId, boolean> = {} as Record<EffectId, boolean>;
  for (const id of EFFECT_ORDER) effects[id] = false;
  // Enable all heavy fx so stage 2 has things to bypass.
  effects.shimmer = true;
  effects.granular = true;
  effects.graincloud = true;
  effects.halo = true;
  effects.freeze = true;
  effects.cistern = true;
  effects.hall = true;
  effects.plate = true;

  const a: FakeAdapter = {
    fakeNow: 0,
    lowPower: false,
    effects,
    voiceMax: 7,
    notifications: [],
    isLowPower() { return a.lowPower; },
    setLowPower(on) { a.lowPower = on; },
    getEffectStates() { return { ...a.effects }; },
    setEffect(id, on) { a.effects[id] = on; },
    getMaxVoiceLayers() { return a.voiceMax; },
    setMaxVoiceLayers(n) { a.voiceMax = n; },
    notify(msg, kind) { a.notifications.push({ msg, kind }); },
    now() { return a.fakeNow; },
    ...overrides,
  };
  return a;
}

describe("AdaptiveStabilityEngine", () => {
  let monitor: FakeMonitor;
  let adapter: FakeAdapter;
  let engine: AdaptiveStabilityEngine;

  beforeEach(() => {
    monitor = new FakeMonitor();
    adapter = makeAdapter();
    engine = new AdaptiveStabilityEngine(monitor, adapter, {
      cooldownMs: 1000,
      stableMs: 5000,
      voiceCapDelta: 2,
      fxStepCount: 4,
    });
  });

  it("starts at stage 0 with no overrides", () => {
    const s = engine.getState();
    expect(s.stage).toBe(0);
    expect(s.lowPower).toBe(false);
    expect(s.bypassedFx).toEqual([]);
    expect(s.voiceCap).toBe(null);
  });

  it("escalates to stage 1 (low-power) on first sustained struggle", () => {
    adapter.fakeNow = 10000;
    monitor.emit({ struggling: true, underruns: 3 });
    expect(engine.getState().stage).toBe(1);
    expect(adapter.lowPower).toBe(true);
    expect(adapter.notifications.at(-1)?.kind).toBe("warning");
  });

  it("respects cooldown — does not jump multiple stages on one signal", () => {
    adapter.fakeNow = 10000;
    monitor.emit({ struggling: true, underruns: 1 });
    expect(engine.getState().stage).toBe(1);
    // Only 500ms later, another struggle signal — should not escalate.
    adapter.fakeNow = 10500;
    monitor.emit({ struggling: true, underruns: 2 });
    expect(engine.getState().stage).toBe(1);
  });

  it("escalates through stages 1 -> 2 -> 3 across cooldowns", () => {
    adapter.fakeNow = 10000;
    monitor.emit({ struggling: true, underruns: 1 });
    expect(engine.getState().stage).toBe(1);

    adapter.fakeNow = 12000;
    monitor.emit({ struggling: true, underruns: 2 });
    expect(engine.getState().stage).toBe(2);
    expect(adapter.effects.shimmer).toBe(false);
    expect(adapter.effects.granular).toBe(false);
    expect(adapter.effects.graincloud).toBe(false);
    expect(adapter.effects.halo).toBe(false);
    // freeze/cistern/hall/plate should still be on (we only step 4).
    expect(adapter.effects.freeze).toBe(true);

    adapter.fakeNow = 14000;
    monitor.emit({ struggling: true, underruns: 3 });
    expect(engine.getState().stage).toBe(3);
    expect(adapter.voiceMax).toBe(5);
  });

  it("does not escalate on a single isolated drift event (monitor not struggling)", () => {
    adapter.fakeNow = 10000;
    // underrun bump but struggling=false (monitor's hysteresis hasn't tripped)
    monitor.emit({ struggling: false, underruns: 1 });
    expect(engine.getState().stage).toBe(0);
  });

  it("de-escalates after sustained stability and restores state", () => {
    // Climb to stage 2.
    adapter.fakeNow = 10000;
    monitor.emit({ struggling: true, underruns: 1 });
    adapter.fakeNow = 12000;
    monitor.emit({ struggling: true, underruns: 2 });
    expect(engine.getState().stage).toBe(2);

    // Stable now. lastUnderrunAt was 12000, stableMs=5000.
    // Need cooldown (1000) AND >=stableMs since last underrun.
    adapter.fakeNow = 17500;
    monitor.emit({ struggling: false, underruns: 2 });
    // First de-escalation: stage 2 -> 1 (restore fx).
    expect(engine.getState().stage).toBe(1);
    expect(adapter.effects.shimmer).toBe(true);
    expect(adapter.effects.granular).toBe(true);
    expect(adapter.effects.graincloud).toBe(true);
    expect(adapter.effects.halo).toBe(true);

    adapter.fakeNow = 19000;
    monitor.emit({ struggling: false, underruns: 2 });
    // Stage 1 -> 0 (restore low power).
    expect(engine.getState().stage).toBe(0);
    expect(adapter.lowPower).toBe(false);
    expect(adapter.notifications.at(-1)?.msg).toMatch(/recovered/i);
  });

  it("does not flap: a fresh underrun during recovery restarts the stable window", () => {
    adapter.fakeNow = 10000;
    monitor.emit({ struggling: true, underruns: 1 });
    expect(engine.getState().stage).toBe(1);

    // Almost recovered, then a new underrun.
    adapter.fakeNow = 14000;
    monitor.emit({ struggling: false, underruns: 2 });
    // Cooldown elapsed (4000 > 1000) but stableMs (5000) since last
    // underrun (just now) hasn't elapsed.
    expect(engine.getState().stage).toBe(1);
  });

  it("does not re-disable an effect the user turned back on during recovery", () => {
    adapter.fakeNow = 10000;
    monitor.emit({ struggling: true, underruns: 1 });
    adapter.fakeNow = 12000;
    monitor.emit({ struggling: true, underruns: 2 });
    expect(adapter.effects.shimmer).toBe(false);

    // User manually re-enables shimmer mid-recovery.
    adapter.effects.shimmer = true;
    adapter.fakeNow = 17500;
    monitor.emit({ struggling: false, underruns: 2 });
    // Recovery should leave the user's choice alone.
    expect(adapter.effects.shimmer).toBe(true);
  });

  it("preserves a low-power setting the user already had on", () => {
    adapter.lowPower = true;
    adapter.fakeNow = 10000;
    monitor.emit({ struggling: true, underruns: 1 });
    expect(adapter.lowPower).toBe(true);

    adapter.fakeNow = 17000;
    monitor.emit({ struggling: false, underruns: 1 });
    // We shouldn't turn off low-power: the user wanted it on.
    expect(adapter.lowPower).toBe(true);
  });

  it("emits state to subscribers on transitions", () => {
    const seen: number[] = [];
    engine.subscribe((s) => seen.push(s.stage));
    adapter.fakeNow = 10000;
    monitor.emit({ struggling: true, underruns: 1 });
    expect(seen).toContain(1);
  });
});
