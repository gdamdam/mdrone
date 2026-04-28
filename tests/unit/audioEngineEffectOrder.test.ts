import { describe, it, expect } from "vitest";
import { shouldDuckOnEffectReorder } from "../../src/engine/AudioEngine";
import { EFFECT_ORDER, type EffectId } from "../../src/engine/FxChain";

const baseline = [...EFFECT_ORDER];
const reordered: EffectId[] = [...baseline];
// Swap two adjacent ids to make a real reorder.
[reordered[0], reordered[1]] = [reordered[1], reordered[0]];

describe("shouldDuckOnEffectReorder", () => {
  it("does NOT duck when the order is identical (no-op rewire)", () => {
    expect(
      shouldDuckOnEffectReorder(baseline, [...baseline], true, false),
    ).toBe(false);
  });

  it("does NOT duck when the drone isn't playing", () => {
    expect(
      shouldDuckOnEffectReorder(baseline, reordered, false, false),
    ).toBe(false);
  });

  it("does NOT duck when the user opted into low-power", () => {
    expect(
      shouldDuckOnEffectReorder(baseline, reordered, true, true),
    ).toBe(false);
  });

  it("DUCKS even when adaptive lowPower is engaged — that flag is the wrong gate", () => {
    // The third arg models USER lowPower only. When adaptive engaged,
    // user lowPower stays false; the duck must still fire — adaptive
    // engages precisely when the audio thread is struggling.
    expect(
      shouldDuckOnEffectReorder(baseline, reordered, true, /* userLowPower */ false),
    ).toBe(true);
  });

  it("ducks on a real reorder while playing and user lowPower is off", () => {
    expect(
      shouldDuckOnEffectReorder(baseline, reordered, true, false),
    ).toBe(true);
  });

  it("ducks when the array length differs (defensive — should be impossible)", () => {
    const shorter = baseline.slice(0, baseline.length - 1);
    expect(
      shouldDuckOnEffectReorder(baseline, shorter, true, false),
    ).toBe(true);
  });

  it("ducks when only the last entry moves", () => {
    const trail: EffectId[] = [...baseline];
    [trail[trail.length - 1], trail[trail.length - 2]] =
      [trail[trail.length - 2], trail[trail.length - 1]];
    expect(
      shouldDuckOnEffectReorder(baseline, trail, true, false),
    ).toBe(true);
  });
});
