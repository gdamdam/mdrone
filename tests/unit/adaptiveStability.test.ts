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
  adaptiveLowPower: boolean;
  effects: Record<EffectId, boolean>;
  voiceMax: number;
  notifications: { msg: string; kind: "info" | "warning" }[];
}

function makeAdapter(): FakeAdapter {
  const effects: Record<EffectId, boolean> = {} as Record<EffectId, boolean>;
  for (const id of EFFECT_ORDER) effects[id] = false;
  // Heavy FX user-intended ON so stage 2 has things to bypass.
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
    adaptiveLowPower: false,
    effects,
    voiceMax: 7,
    notifications: [],
    setAdaptiveLowPower(on) { a.adaptiveLowPower = on; },
    getEffectStates() { return { ...a.effects }; },
    setEffect(id, on) { a.effects[id] = on; },
    getMaxVoiceLayers() { return a.voiceMax; },
    setMaxVoiceLayers(n) { a.voiceMax = n; },
    notify(msg, kind) { a.notifications.push({ msg, kind }); },
    now() { return a.fakeNow; },
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
      cooldownEscalateMs: 1000,
      cooldownRecoverMs: 4000,
      stableMs: 8000,
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

  it("escalates to stage 1 (adaptive low-power overlay) on sustained struggle", () => {
    adapter.fakeNow = 10000;
    monitor.emit({ struggling: true, underruns: 3 });
    expect(engine.getState().stage).toBe(1);
    expect(adapter.adaptiveLowPower).toBe(true);
    // The controller never observes user low-power — only writes adaptive overlay.
    expect(engine.getState().lowPower).toBe(true);
  });

  it("respects escalation cooldown", () => {
    adapter.fakeNow = 10000;
    monitor.emit({ struggling: true, underruns: 1 });
    expect(engine.getState().stage).toBe(1);
    adapter.fakeNow = 10500;
    monitor.emit({ struggling: true, underruns: 2 });
    expect(engine.getState().stage).toBe(1);
  });

  it("escalates 1 -> 2 -> 3 across cooldowns", () => {
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
    expect(adapter.effects.freeze).toBe(true);

    adapter.fakeNow = 14000;
    monitor.emit({ struggling: true, underruns: 3 });
    expect(engine.getState().stage).toBe(3);
    // First-entry stage 3 is decisive: 7 → 4 (clamped to ceiling).
    expect(adapter.voiceMax).toBe(4);
  });

  it("does not escalate on a single isolated drift event", () => {
    adapter.fakeNow = 10000;
    monitor.emit({ struggling: false, underruns: 1 });
    expect(engine.getState().stage).toBe(0);
  });

  it("recovery is slower than mitigation (uses cooldownRecoverMs + stableMs)", () => {
    // Climb to stage 2.
    adapter.fakeNow = 10000;
    monitor.emit({ struggling: true, underruns: 1 });
    adapter.fakeNow = 12000;
    monitor.emit({ struggling: true, underruns: 2 });
    expect(engine.getState().stage).toBe(2);

    // 4s after last underrun: cooldown (4s) just met but stableMs (8s) not yet.
    adapter.fakeNow = 16000;
    monitor.emit({ struggling: false, underruns: 2 });
    expect(engine.getState().stage).toBe(2);

    // 8s after last underrun: stable window met. Stage 2 -> 1.
    adapter.fakeNow = 20000;
    monitor.emit({ struggling: false, underruns: 2 });
    expect(engine.getState().stage).toBe(1);
    // Bypassed FX restored.
    expect(adapter.effects.shimmer).toBe(true);
    expect(adapter.effects.granular).toBe(true);
    expect(adapter.effects.graincloud).toBe(true);
    expect(adapter.effects.halo).toBe(true);
    expect(engine.isFxSuppressed("shimmer")).toBe(false);

    // Recovery cooldown is 4s, so next step needs 4s past last stage change (20000).
    adapter.fakeNow = 24000;
    monitor.emit({ struggling: false, underruns: 2 });
    expect(engine.getState().stage).toBe(0);
    expect(adapter.adaptiveLowPower).toBe(false);
    expect(adapter.notifications.at(-1)?.msg).toMatch(/recovered/i);
  });

  it("a fresh underrun during the stable window restarts recovery", () => {
    adapter.fakeNow = 10000;
    monitor.emit({ struggling: true, underruns: 1 });
    expect(engine.getState().stage).toBe(1);

    // Almost recovered, then a new underrun resets stableSince.
    adapter.fakeNow = 17000;
    monitor.emit({ struggling: false, underruns: 2 });
    // Cooldown elapsed but stableMs (8s) since latest underrun (17000) hasn't.
    expect(engine.getState().stage).toBe(1);
  });

  it("does not re-disable an FX the user turned back on during recovery", () => {
    adapter.fakeNow = 10000;
    monitor.emit({ struggling: true, underruns: 1 });
    adapter.fakeNow = 12000;
    monitor.emit({ struggling: true, underruns: 2 });
    expect(adapter.effects.shimmer).toBe(false);

    adapter.effects.shimmer = true; // user re-enables mid-recovery
    adapter.fakeNow = 20000;
    monitor.emit({ struggling: false, underruns: 2 });
    expect(adapter.effects.shimmer).toBe(true);
  });

  it("never observes or stomps the user's persisted low-power setting", () => {
    // The split adapter has no isLowPower/setLowPower — only adaptive overlay.
    // Adapter starts with adaptiveLowPower=false; recovery should leave it at false.
    adapter.fakeNow = 10000;
    monitor.emit({ struggling: true, underruns: 1 });
    expect(adapter.adaptiveLowPower).toBe(true);

    adapter.fakeNow = 22000;
    monitor.emit({ struggling: false, underruns: 1 });
    // Recovery cleared the adaptive overlay; nothing about user state was touched.
    expect(adapter.adaptiveLowPower).toBe(false);
  });

  it("exposes suppressed FX via state for UI consumption", () => {
    adapter.fakeNow = 10000;
    monitor.emit({ struggling: true, underruns: 1 });
    adapter.fakeNow = 12000;
    monitor.emit({ struggling: true, underruns: 2 });
    const s = engine.getState();
    expect(s.bypassedFx).toContain("shimmer");
    expect(s.bypassedFx).toContain("granular");
    expect(engine.isFxSuppressed("shimmer")).toBe(true);
    expect(engine.isFxSuppressed("freeze")).toBe(false);
  });

  it("emits state to subscribers on transitions", () => {
    const seen: number[] = [];
    engine.subscribe((s) => seen.push(s.stage));
    adapter.fakeNow = 10000;
    monitor.emit({ struggling: true, underruns: 1 });
    expect(seen).toContain(1);
  });

  describe("progressive Stage 3", () => {
    function climbToStage3(): void {
      adapter.fakeNow = 10000;
      monitor.emit({ struggling: true, underruns: 1 });
      adapter.fakeNow = 12000;
      monitor.emit({ struggling: true, underruns: 2 });
      adapter.fakeNow = 14000;
      monitor.emit({ struggling: true, underruns: 3 });
      expect(engine.getState().stage).toBe(3);
    }

    it("first cap reduction is decisive: 7 → 4", () => {
      adapter.voiceMax = 7;
      climbToStage3();
      expect(adapter.voiceMax).toBe(4);
    });

    it("first cap reduction clamps high caps to the initial ceiling", () => {
      adapter.voiceMax = 6;
      climbToStage3();
      expect(adapter.voiceMax).toBe(4);
      // savedVoiceMax should reflect the user's original cap (6), not 4.
      // Recovery test below proves this.
    });

    it("first reduction from the ceiling drops to the floor: 4 → 3", () => {
      adapter.voiceMax = 4;
      climbToStage3();
      expect(adapter.voiceMax).toBe(3);
    });

    it("first reduction at floor is a no-op (3 → 3) and does not transition stage 3", () => {
      adapter.voiceMax = 3;
      adapter.fakeNow = 10000;
      monitor.emit({ struggling: true, underruns: 1 });
      adapter.fakeNow = 12000;
      monitor.emit({ struggling: true, underruns: 2 });
      adapter.fakeNow = 14000;
      monitor.emit({ struggling: true, underruns: 3 });
      // Cannot reduce — stage stays at 2, no false notification.
      expect(engine.getState().stage).toBe(2);
      expect(adapter.voiceMax).toBe(3);
      const stage3Notice = adapter.notifications.find(
        (n) => n.msg.includes("voice density"),
      );
      expect(stage3Notice).toBeUndefined();
    });

    it("continued struggling past cooldown steps further: 7 → 4 → 3", () => {
      adapter.voiceMax = 7;
      climbToStage3();
      expect(adapter.voiceMax).toBe(4);
      // Push past cooldown — another struggle tick steps cap by 1.
      adapter.fakeNow = 16000;
      monitor.emit({ struggling: true, underruns: 4 });
      expect(adapter.voiceMax).toBe(3);
      expect(engine.getState().stage).toBe(3);
    });

    it("does not reduce below 3", () => {
      adapter.voiceMax = 7;
      climbToStage3();
      adapter.fakeNow = 16000;
      monitor.emit({ struggling: true, underruns: 4 });
      expect(adapter.voiceMax).toBe(3);
      // Further struggle — still at 3.
      adapter.fakeNow = 18000;
      monitor.emit({ struggling: true, underruns: 5 });
      expect(adapter.voiceMax).toBe(3);
      adapter.fakeNow = 20000;
      monitor.emit({ struggling: true, underruns: 6 });
      expect(adapter.voiceMax).toBe(3);
    });

    it("respects escalation cooldown between cap steps", () => {
      adapter.voiceMax = 7;
      climbToStage3();
      expect(adapter.voiceMax).toBe(4);
      // Within cooldown (1000 ms) — no further step.
      adapter.fakeNow = 14500;
      monitor.emit({ struggling: true, underruns: 4 });
      expect(adapter.voiceMax).toBe(4);
    });

    it("recovery restores the original user cap in one shot", () => {
      adapter.voiceMax = 7;
      climbToStage3();
      adapter.fakeNow = 16000;
      monitor.emit({ struggling: true, underruns: 4 });
      expect(adapter.voiceMax).toBe(3);

      // Recovery — stable window + cooldown.
      adapter.fakeNow = 26000;
      monitor.emit({ struggling: false, underruns: 4 });
      // Stage 3 → 2 should restore the original cap, not just step up.
      expect(engine.getState().stage).toBe(2);
      expect(adapter.voiceMax).toBe(7);
    });

    it("only notifies once per meaningful cap reduction", () => {
      adapter.voiceMax = 7;
      climbToStage3();
      const afterFirst = adapter.notifications.filter(
        (n) => n.msg.includes("voice density"),
      ).length;
      expect(afterFirst).toBe(1);

      adapter.fakeNow = 16000;
      monitor.emit({ struggling: true, underruns: 4 });
      const afterSecond = adapter.notifications.filter(
        (n) => n.msg.includes("voice density"),
      ).length;
      expect(afterSecond).toBe(2);

      // At floor — no further notification.
      adapter.fakeNow = 18000;
      monitor.emit({ struggling: true, underruns: 5 });
      const afterFloor = adapter.notifications.filter(
        (n) => n.msg.includes("voice density"),
      ).length;
      expect(afterFloor).toBe(2);
    });
  });

  it("notification copy is calm and instrument-like", () => {
    adapter.fakeNow = 10000;
    monitor.emit({ struggling: true, underruns: 1 });
    expect(adapter.notifications.at(-1)?.msg).toBe(
      "Audio under load — reducing visuals.",
    );
    adapter.fakeNow = 12000;
    monitor.emit({ struggling: true, underruns: 2 });
    expect(adapter.notifications.at(-1)?.msg).toBe(
      "Audio under load — simplifying FX.",
    );
    adapter.fakeNow = 14000;
    monitor.emit({ struggling: true, underruns: 3 });
    expect(adapter.notifications.at(-1)?.msg).toBe(
      "Audio under load — reducing voice density.",
    );
  });
});
