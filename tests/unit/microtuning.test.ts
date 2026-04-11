import { describe, it, expect } from "vitest";
import {
  TUNINGS,
  RELATIONS,
  DEGREE_LABELS,
  tuningById,
  relationById,
  resolveTuning,
} from "../../src/microtuning";

/**
 * Table-level invariants. Resolver behavior per-tuning is already
 * covered by tests/drone-scene-model.test.mjs — these tests only assert
 * structural properties the node suite doesn't check.
 */
describe("TUNINGS", () => {
  it("has at least one tuning and 13-entry DEGREE_LABELS", () => {
    expect(TUNINGS.length).toBeGreaterThan(0);
    expect(DEGREE_LABELS.length).toBe(13);
  });

  it("every tuning has 13 non-decreasing degrees spanning 0..1200", () => {
    // Non-decreasing (not strict) because sub-12-tone tunings like
    // `slendro` are padded with duplicate cent values to fill the
    // 13-entry table — this is intentional in src/microtuning.ts.
    for (const t of TUNINGS) {
      expect(t.degrees.length, `tuning "${t.id}"`).toBe(13);
      expect(t.degrees[0]).toBe(0);
      expect(t.degrees[12]).toBe(1200);
      for (let i = 1; i < t.degrees.length; i++) {
        expect(Number.isFinite(t.degrees[i])).toBe(true);
        expect(t.degrees[i]).toBeGreaterThanOrEqual(0);
        expect(t.degrees[i]).toBeLessThanOrEqual(1200);
        expect(
          t.degrees[i],
          `tuning "${t.id}" degree ${i} must be >= prev`,
        ).toBeGreaterThanOrEqual(t.degrees[i - 1]);
      }
    }
  });
});

describe("RELATIONS", () => {
  it("every relation picks are in [0,12], unique, non-empty", () => {
    for (const r of RELATIONS) {
      expect(r.picks.length, `relation "${r.id}"`).toBeGreaterThan(0);
      for (const p of r.picks) {
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThanOrEqual(12);
        expect(Number.isInteger(p)).toBe(true);
      }
      expect(new Set(r.picks).size, `relation "${r.id}" has duplicates`).toBe(
        r.picks.length,
      );
    }
  });
});

describe("resolver fallbacks & combinatorics", () => {
  it("tuningById falls back to a valid tuning for unknown ids", () => {
    const t = tuningById("nonsense-id" as never);
    expect(t.degrees.length).toBe(13);
    expect(t.degrees[0]).toBe(0);
  });

  it("relationById falls back to a valid relation for unknown ids", () => {
    const r = relationById("nonsense-id" as never);
    expect(r.picks.length).toBeGreaterThan(0);
  });

  it("resolveTuning returns finite cents for every tuning × relation combo", () => {
    for (const t of TUNINGS) {
      for (const r of RELATIONS) {
        const cents = resolveTuning(t.id, r.id);
        expect(cents.length, `${t.id} × ${r.id}`).toBe(r.picks.length);
        for (const c of cents) expect(Number.isFinite(c)).toBe(true);
      }
    }
  });
});
