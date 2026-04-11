import { describe, it, expect } from "vitest";
import {
  mulberry32,
  mutateScene,
  createPresetVariation,
  PRESETS,
} from "../../src/engine/presets";
import { validateChain } from "../../src/engine/FxChain";
import { normalizePortableScene } from "../../src/session";

const baseScene = () => createPresetVariation(PRESETS[0], "A", 2, mulberry32(1));

describe("mulberry32 (seeded PRNG)", () => {
  it("produces identical sequences for identical seeds", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    expect([a(), a(), a(), a()]).toEqual([b(), b(), b(), b()]);
  });

  it("returns finite values in [0, 1)", () => {
    const r = mulberry32(12345);
    for (let i = 0; i < 200; i++) {
      const v = r();
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("produces different sequences for different seeds", () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    expect(a()).not.toBe(b());
  });
});

describe("mutateScene", () => {
  it("returns a valid scene with no NaN anywhere", () => {
    const mutated = mutateScene(baseScene(), 0.5, mulberry32(42));
    const walk = (v: unknown): void => {
      if (typeof v === "number") expect(Number.isFinite(v)).toBe(true);
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") Object.values(v).forEach(walk);
    };
    walk(mutated);
  });

  it("clamps perturbed values to each field's natural range", () => {
    // Start from an extreme scene (all near-zero) and mutate hard
    // enough that unclamped output would go negative.
    const scene = { ...baseScene(), drift: 0, air: 0, lfoRate: 0.05, pluckRate: 0.2 };
    const mutated = mutateScene(scene, 1, mulberry32(99));
    expect(mutated.drift).toBeGreaterThanOrEqual(0);
    expect(mutated.drift).toBeLessThanOrEqual(1);
    expect(mutated.air).toBeGreaterThanOrEqual(0);
    expect(mutated.air).toBeLessThanOrEqual(1);
    expect(mutated.lfoRate).toBeGreaterThanOrEqual(0.05);
    expect(mutated.lfoRate).toBeLessThanOrEqual(8);
    expect(mutated.pluckRate).toBeGreaterThanOrEqual(0.2);
    expect(mutated.pluckRate).toBeLessThanOrEqual(4);
  });

  it("is deterministic for the same seed and scene", () => {
    const scene = baseScene();
    const a = mutateScene(scene, 0.5, mulberry32(777));
    const b = mutateScene(scene, 0.5, mulberry32(777));
    expect(a).toEqual(b);
  });

  it("intensity=0 is a no-op for numeric fields", () => {
    const scene = baseScene();
    const mutated = mutateScene(scene, 0, mulberry32(1));
    expect(mutated.drift).toBe(scene.drift);
    expect(mutated.air).toBe(scene.air);
    expect(mutated.lfoRate).toBe(scene.lfoRate);
    expect(mutated.pluckRate).toBe(scene.pluckRate);
  });

  it("leaves booleans and categoricals untouched at full intensity", () => {
    const scene = baseScene();
    const mutated = mutateScene(scene, 1, mulberry32(7));
    expect(mutated.effects).toEqual(scene.effects);
    expect(mutated.voiceLayers).toEqual(scene.voiceLayers);
    expect(mutated.lfoShape).toBe(scene.lfoShape);
    expect(mutated.scale).toBe(scene.scale);
  });
});

describe("validateChain", () => {
  it("accepts an empty chain", () => {
    expect(validateChain([])).toBe(true);
  });

  it("accepts a valid EFFECT_ORDER-ordered subsequence", () => {
    expect(validateChain(["tape", "delay", "hall"])).toBe(true);
    expect(validateChain(["wow", "ringmod", "granular"])).toBe(true);
  });

  it("accepts the full canonical chain", () => {
    expect(
      validateChain([
        "tape", "wow", "sub", "comb", "ringmod", "formant", "delay",
        "plate", "hall", "shimmer", "freeze", "cistern", "granular",
      ]),
    ).toBe(true);
  });

  it("rejects unknown effect ids", () => {
    expect(validateChain(["tape", "nonsense", "hall"])).toBe(false);
  });

  it("rejects out-of-order entries", () => {
    // "hall" is after "delay" in EFFECT_ORDER, so reversed is invalid.
    expect(validateChain(["hall", "delay"])).toBe(false);
  });

  it("rejects duplicates", () => {
    expect(validateChain(["tape", "tape"])).toBe(false);
  });

  it("rejects non-string entries", () => {
    expect(validateChain([1, "tape"] as unknown[])).toBe(false);
  });

  it("rejects non-arrays", () => {
    expect(validateChain(null as unknown as unknown[])).toBe(false);
  });
});

describe("seed share round-trip", () => {
  it("preserves seed through normalizePortableScene", () => {
    const scene = normalizePortableScene({
      drone: { seed: 12345 },
      mixer: {},
    });
    expect(scene!.drone.seed).toBe(12345);
  });

  it("defaults to 0 for legacy URLs without a seed field", () => {
    const scene = normalizePortableScene({ drone: {}, mixer: {} });
    expect(scene!.drone.seed).toBe(0);
  });

  it("clamps out-of-range seeds", () => {
    const neg = normalizePortableScene({ drone: { seed: -5 }, mixer: {} });
    const huge = normalizePortableScene({
      drone: { seed: 0x1_FFFFFFFF },
      mixer: {},
    });
    expect(neg!.drone.seed).toBe(0);
    expect(huge!.drone.seed).toBeLessThanOrEqual(0xFFFFFFFF);
  });
});
