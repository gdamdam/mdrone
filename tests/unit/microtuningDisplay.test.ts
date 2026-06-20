/**
 * ADVANCED → MICROTONAL display helpers — pure, framework-free.
 *
 * Covers the three helpers that back the new "hear & understand tunings"
 * affordances:
 *   - ratioForDegree:   known just-intonation ratio for a degree (or null)
 *   - resolveTuningRows: per-degree display rows (label + cents + ratio)
 *   - planSuggestedVoicing: voiceLayers/levels for the APPLY VOICING button
 *
 * Ratios are derived by matching a degree's cents against a canonical
 * just-ratio table within a tight tolerance, gated to genuinely
 * just-intonation tunings — so we never print a ratio for a tempered/EDO
 * degree and never invent one.
 */
import { describe, it, expect } from "vitest";
import {
  ratioForDegree,
  resolveTuningRows,
  planSuggestedVoicing,
  resolveTuning,
  relationById,
  DEGREE_LABELS,
  tuningById,
} from "../../src/microtuning";

describe("ratioForDegree", () => {
  it("returns known 5-limit ratios for the Just 5-limit tuning", () => {
    expect(ratioForDegree("just5", 0)).toBe("1/1");
    expect(ratioForDegree("just5", 4)).toBe("5/4"); // M3
    expect(ratioForDegree("just5", 5)).toBe("4/3"); // P4
    expect(ratioForDegree("just5", 7)).toBe("3/2"); // P5
    expect(ratioForDegree("just5", 12)).toBe("2/1"); // P8
  });

  it("matches the audible cents, not the (stale) source comment", () => {
    // just5 degree 6 is 582.51¢ = 7/5, even though the comment says 45/32.
    expect(tuningById("just5").degrees[6]).toBeCloseTo(582.51, 2);
    expect(ratioForDegree("just5", 6)).toBe("7/5");
  });

  it("exposes 7- and 11-limit ratios where the tuning is just", () => {
    expect(ratioForDegree("harmonics", 1)).toBe("17/16");
    expect(ratioForDegree("harmonics", 6)).toBe("11/8");
    expect(ratioForDegree("harmonics", 10)).toBe("7/4");
    expect(ratioForDegree("custom:just7", 3)).toBe("7/6");
    expect(ratioForDegree("custom:partch-11", 1)).toBe("11/10");
    expect(ratioForDegree("custom:pythagorean", 1)).toBe("256/243");
    expect(ratioForDegree("custom:pythagorean", 7)).toBe("3/2");
  });

  it("shows ratios only on the just slots of a hybrid tuning", () => {
    expect(ratioForDegree("custom:mdrone-signature", 7)).toBe("3/2"); // just slot
    expect(ratioForDegree("custom:mdrone-signature", 1)).toBeNull();  // 31-TET slot
  });

  it("never invents ratios for equal-temperament / EDO tunings", () => {
    for (let i = 0; i <= 12; i++) expect(ratioForDegree("equal", i)).toBeNull();
    expect(ratioForDegree("custom:19-tet", 7)).toBeNull();
    expect(ratioForDegree("meantone", 7)).toBeNull();
  });

  it("returns null for out-of-range degree indices", () => {
    expect(ratioForDegree("just5", -1)).toBeNull();
    expect(ratioForDegree("just5", 99)).toBeNull();
  });

  it("every non-null ratio it reports actually equals the degree cents", () => {
    // Guards against shipping a wrong/transcribed ratio.
    const ids = ["just5", "harmonics", "custom:just7", "custom:partch-11",
                 "custom:pythagorean", "custom:mdrone-signature"] as const;
    for (const id of ids) {
      const degrees = tuningById(id).degrees;
      for (let i = 0; i < degrees.length; i++) {
        const r = ratioForDegree(id, i);
        if (r === null) continue;
        const [n, d] = r.split("/").map(Number);
        const cents = 1200 * Math.log2(n / d);
        expect(Math.abs(cents - degrees[i])).toBeLessThanOrEqual(1.5);
      }
    }
  });
});

describe("resolveTuningRows", () => {
  it("returns one row per relation pick, consistent with resolveTuning", () => {
    const rows = resolveTuningRows("just5", "drone-triad");
    const picks = relationById("drone-triad").picks; // [0,4,7]
    const cents = resolveTuning("just5", "drone-triad");
    expect(rows.length).toBe(picks.length);
    rows.forEach((row, i) => {
      expect(row.degreeIndex).toBe(picks[i]);
      expect(row.label).toBe(DEGREE_LABELS[picks[i]]);
      expect(row.cents).toBe(cents[i]);
      expect(row.ratio).toBe(ratioForDegree("just5", picks[i]));
    });
  });

  it("labels and ratios a classic tonic+fifth reading", () => {
    const rows = resolveTuningRows("just5", "tonic-fifth"); // [0,7]
    expect(rows[0]).toMatchObject({ label: "P1", ratio: "1/1" });
    expect(rows[1]).toMatchObject({ label: "P5", ratio: "3/2" });
    expect(rows[1].cents).toBeCloseTo(701.96, 2);
  });
});

describe("planSuggestedVoicing", () => {
  const ALL = ["tanpura", "reed", "metal", "air", "piano", "fm", "amp", "noise"];

  it("turns suggested voices on and all others off", () => {
    const plan = planSuggestedVoicing(ALL, ["tanpura", "metal"], {});
    expect(plan.layers.tanpura).toBe(true);
    expect(plan.layers.metal).toBe(true);
    for (const v of ["reed", "air", "piano", "fm", "amp", "noise"]) {
      expect(plan.layers[v]).toBe(false);
    }
  });

  it("preserves an existing audible level for a suggested voice", () => {
    const plan = planSuggestedVoicing(ALL, ["tanpura", "metal"], { tanpura: 0.62, metal: 0 });
    expect(plan.levels.tanpura).toBe(0.62);      // preserved
    expect(plan.levels.metal).toBeGreaterThan(0); // bumped from ~0 to default
  });

  it("only sets levels for suggested voices (leaves the rest untouched)", () => {
    const plan = planSuggestedVoicing(ALL, ["reed"], { reed: 0.5, amp: 0.9 });
    expect(plan.levels.reed).toBe(0.5);
    expect("amp" in plan.levels).toBe(false);
  });

  it("ignores unknown voice ids in the suggestion", () => {
    const plan = planSuggestedVoicing(ALL, ["tanpura", "bogus"], {});
    expect(plan.layers.tanpura).toBe(true);
    expect("bogus" in plan.layers).toBe(false);
  });
});
