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

  it("does NOT duck in effective low-power mode", () => {
    expect(
      shouldDuckOnEffectReorder(baseline, reordered, true, true),
    ).toBe(false);
  });

  it("ducks on a real reorder while playing in normal-power mode", () => {
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
