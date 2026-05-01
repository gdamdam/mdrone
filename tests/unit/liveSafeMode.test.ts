import { describe, it, expect, beforeEach } from "vitest";
import {
  LiveSafeMode,
  LIVE_SAFE_HEAVY_FX,
  LIVE_SAFE_VOICE_CAP,
  stageRiskOf,
  type LiveSafeAdapter,
} from "../../src/engine/LiveSafeMode";
import { EFFECT_ORDER, type EffectId } from "../../src/engine/FxChain";

interface FakeAdapter extends LiveSafeAdapter {
  liveSafeLowPower: boolean;
  effects: Record<EffectId, boolean>;
  voiceMax: number;
  notifications: { msg: string; kind: "info" | "warning" }[];
}

function makeAdapter(): FakeAdapter {
  const effects: Record<EffectId, boolean> = {} as Record<EffectId, boolean>;
  for (const id of EFFECT_ORDER) effects[id] = false;
  // All heavy FX user-intended ON.
  for (const id of LIVE_SAFE_HEAVY_FX) effects[id] = true;
  // Plus a non-heavy FX (tape) — should be untouched.
  effects.tape = true;

  const a: FakeAdapter = {
    liveSafeLowPower: false,
    effects,
    voiceMax: 7,
    notifications: [],
    setLiveSafeLowPower(on) { a.liveSafeLowPower = on; },
    getEffectStates() { return { ...a.effects }; },
    setEffect(id, on) { a.effects[id] = on; },
    getMaxVoiceLayers() { return a.voiceMax; },
    setMaxVoiceLayers(n) { a.voiceMax = n; },
    notify(msg, kind) { a.notifications.push({ msg, kind }); },
  };
  return a;
}

describe("LiveSafeMode", () => {
  let adapter: FakeAdapter;
  let mode: LiveSafeMode;

  beforeEach(() => {
    adapter = makeAdapter();
    mode = new LiveSafeMode(adapter);
  });

  it("starts inactive with no overrides", () => {
    expect(mode.isActive()).toBe(false);
    const s = mode.getState();
    expect(s.active).toBe(false);
    expect(s.voiceCap).toBe(null);
    expect(s.suppressedFx).toEqual([]);
  });

  it("apply: clamps voice cap, suppresses heavy FX, engages low-power", () => {
    mode.setActive(true);
    expect(mode.isActive()).toBe(true);
    expect(adapter.voiceMax).toBe(LIVE_SAFE_VOICE_CAP);
    for (const id of LIVE_SAFE_HEAVY_FX) {
      expect(adapter.effects[id]).toBe(false);
    }
    expect(adapter.effects.tape).toBe(true); // non-heavy untouched
    expect(adapter.liveSafeLowPower).toBe(true);
  });

  it("apply: does not raise the voice cap if user is already lower", () => {
    adapter.voiceMax = 3;
    mode.setActive(true);
    expect(adapter.voiceMax).toBe(3);
    expect(mode.getState().voiceCap).toBe(null); // controller didn't override cap
  });

  it("apply: does not track FX that were already off", () => {
    adapter.effects.halo = false;
    adapter.effects.granular = false;
    mode.setActive(true);
    const tracked = mode.getState().suppressedFx;
    expect(tracked).not.toContain("halo");
    expect(tracked).not.toContain("granular");
    expect(tracked).toContain("shimmer");
  });

  it("apply twice is a no-op (idempotent)", () => {
    mode.setActive(true);
    const capAfterFirst = adapter.voiceMax;
    const trackedAfterFirst = [...mode.getState().suppressedFx];
    mode.setActive(true);
    expect(adapter.voiceMax).toBe(capAfterFirst);
    expect([...mode.getState().suppressedFx]).toEqual(trackedAfterFirst);
    // Only one notification per real transition.
    expect(adapter.notifications.filter((n) => n.msg.includes("LIVE SAFE on")).length).toBe(1);
  });

  it("revert: restores cap, FX, and clears low-power overlay", () => {
    mode.setActive(true);
    mode.setActive(false);
    expect(mode.isActive()).toBe(false);
    expect(adapter.voiceMax).toBe(7);
    for (const id of LIVE_SAFE_HEAVY_FX) {
      expect(adapter.effects[id]).toBe(true);
    }
    expect(adapter.liveSafeLowPower).toBe(false);
  });

  it("revert: does not restore voice cap if the user changed it mid-mode", () => {
    mode.setActive(true);
    expect(adapter.voiceMax).toBe(LIVE_SAFE_VOICE_CAP);
    // User deliberately sets a different cap mid-mode.
    adapter.voiceMax = 3;
    mode.setActive(false);
    // Don't fight the user — leave their value alone.
    expect(adapter.voiceMax).toBe(3);
  });

  it("revert: does not re-enable FX the user already turned back on", () => {
    mode.setActive(true);
    expect(adapter.effects.shimmer).toBe(false);
    // User toggles shimmer back on mid-mode.
    adapter.effects.shimmer = true;
    mode.setActive(false);
    expect(adapter.effects.shimmer).toBe(true); // unchanged
    expect(adapter.effects.halo).toBe(true);    // restored as expected
  });

  it("revert: does not re-enable FX the user turned off mid-mode", () => {
    mode.setActive(true);
    // User explicitly disabled (but it was already off — verify revert
    // logic only restores from "false" baseline). Set tape off (was on
    // before). LIVE SAFE never tracked tape, so this is just an
    // unrelated user change — must survive revert.
    adapter.effects.tape = false;
    mode.setActive(false);
    expect(adapter.effects.tape).toBe(false);
  });

  it("does not mutate persisted user settings — only its own runtime overlay", () => {
    // The adapter has no setUserLowPower / setLowPowerMode; the only
    // low-power knob this controller can touch is its own overlay.
    // Compile-time enforcement: TypeScript would reject .setLowPowerMode.
    mode.setActive(true);
    mode.setActive(false);
    // No notifications are misclassified.
    expect(adapter.notifications.every((n) => n.kind === "info")).toBe(true);
  });

  it("isFxSuppressed reflects current suppression set", () => {
    expect(mode.isFxSuppressed("shimmer")).toBe(false);
    mode.setActive(true);
    expect(mode.isFxSuppressed("shimmer")).toBe(true);
    expect(mode.isFxSuppressed("tape")).toBe(false);
    mode.setActive(false);
    expect(mode.isFxSuppressed("shimmer")).toBe(false);
  });

  it("emits state to subscribers on transitions", () => {
    const seen: boolean[] = [];
    mode.subscribe((s) => seen.push(s.active));
    mode.setActive(true);
    mode.setActive(false);
    expect(seen).toContain(true);
    expect(seen).toContain(false);
  });

  it("toggling enable then disable then enable again starts clean", () => {
    mode.setActive(true);
    adapter.effects.shimmer = true; // user re-toggled
    mode.setActive(false);
    expect(adapter.effects.shimmer).toBe(true);
    // Second enable: should re-suppress shimmer cleanly.
    mode.setActive(true);
    expect(adapter.effects.shimmer).toBe(false);
    expect(mode.getState().suppressedFx).toContain("shimmer");
  });

  it("LIVE_SAFE_HEAVY_FX includes cistern (stage parity with adaptive)", () => {
    expect(LIVE_SAFE_HEAVY_FX).toContain("cistern");
  });

  it("apply: bypasses cistern when user-intended on", () => {
    adapter.effects.cistern = true;
    mode.setActive(true);
    expect(adapter.effects.cistern).toBe(false);
    expect(mode.getState().suppressedFx).toContain("cistern");
    mode.setActive(false);
    expect(adapter.effects.cistern).toBe(true);
  });
});

describe("stageRiskOf", () => {
  it("low: lean voice, no heavy FX", () => {
    expect(stageRiskOf({
      voiceLayers: ["sine"],
      effects: ["tape"],
    })).toBe("low");
  });

  it("medium: dense voice alone", () => {
    expect(stageRiskOf({
      voiceLayers: ["sine", "saw", "noise", "reed", "fm"],
      effects: ["tape"],
    })).toBe("medium");
  });

  it("medium: one heavy FX with lean voice", () => {
    expect(stageRiskOf({
      voiceLayers: ["sine"],
      effects: ["shimmer"],
    })).toBe("medium");
  });

  it("high: dense voice + two heavy FX", () => {
    expect(stageRiskOf({
      voiceLayers: ["sine", "saw", "noise", "reed", "fm", "comb"],
      effects: ["shimmer", "halo", "tape"],
    })).toBe("high");
  });

  it("override: forces stageRiskOverride regardless of measured shape", () => {
    expect(stageRiskOf({
      voiceLayers: ["sine", "saw", "noise", "reed", "fm", "comb"],
      effects: ["shimmer", "halo"],
      stageRiskOverride: "low",
    })).toBe("low");
  });
});
