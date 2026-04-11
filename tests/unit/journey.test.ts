import { describe, it, expect } from "vitest";
import {
  JOURNEYS,
  JOURNEY_IDS,
  applyJourneyTick,
  journeyDurationTicks,
  journeyProgressAt,
  type JourneyId,
} from "../../src/journey";
import { normalizePortableScene } from "../../src/session";

const baseDrone = () => {
  const scene = normalizePortableScene({ drone: {}, mixer: {} });
  if (!scene) throw new Error("normalizePortableScene returned null");
  return scene.drone;
};

describe("Journey definitions", () => {
  it("ships exactly four phases per journey", () => {
    for (const id of JOURNEY_IDS) {
      const phases = JOURNEYS[id].phases;
      expect(phases).toHaveLength(4);
      const names = phases.map((p) => p.name);
      expect(names).toEqual(["arrival", "bloom", "suspension", "dissolve"]);
    }
  });

  it("has positive integer phase durations", () => {
    for (const id of JOURNEY_IDS) {
      for (const phase of JOURNEYS[id].phases) {
        expect(phase.durationTicks).toBeGreaterThan(0);
        expect(Number.isInteger(phase.durationTicks)).toBe(true);
      }
    }
  });

  it("clamps every target value to a sane drone range", () => {
    // Targets are macros that the audio engine reads as 0..1 or
    // bounded — out-of-range targets would crash the lerp on load.
    for (const id of JOURNEY_IDS) {
      for (const phase of JOURNEYS[id].phases) {
        for (const [k, v] of Object.entries(phase.targets)) {
          expect(typeof v).toBe("number");
          expect(Number.isFinite(v as number)).toBe(true);
          expect(v as number, `${id}/${phase.name}/${k}`).toBeGreaterThanOrEqual(0);
          expect(v as number, `${id}/${phase.name}/${k}`).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});

describe("journeyProgressAt", () => {
  it("starts in the first phase at tick 0", () => {
    for (const id of JOURNEY_IDS) {
      const at = journeyProgressAt(id, 0);
      expect(at.phaseIndex).toBe(0);
      expect(at.phase.name).toBe("arrival");
      expect(at.progress).toBe(0);
    }
  });

  it("walks through every phase exactly once", () => {
    const seen: number[] = [];
    let lastIdx = -1;
    const total = journeyDurationTicks("morning");
    for (let t = 0; t < total + 5; t++) {
      const at = journeyProgressAt("morning", t);
      if (at.phaseIndex !== lastIdx) {
        seen.push(at.phaseIndex);
        lastIdx = at.phaseIndex;
      }
    }
    expect(seen).toEqual([0, 1, 2, 3]);
  });

  it("clamps to the final phase past the end", () => {
    const total = journeyDurationTicks("void");
    const at = journeyProgressAt("void", total + 1000);
    expect(at.phaseIndex).toBe(3);
    expect(at.phase.name).toBe("dissolve");
    expect(at.progress).toBe(1);
  });
});

describe("applyJourneyTick determinism", () => {
  it("is pure: same (snap, id, tick) ⇒ same output", () => {
    const snap = baseDrone();
    const a = applyJourneyTick(snap, "morning", 3);
    const b = applyJourneyTick(snap, "morning", 3);
    expect(a).toEqual(b);
  });

  it("converges toward the active phase target across many ticks", () => {
    let snap = baseDrone();
    snap = { ...snap, air: 0 }; // far from any morning target
    // Run enough ticks to fully traverse the morning journey.
    const total = journeyDurationTicks("morning");
    for (let t = 1; t <= total + 5; t++) {
      snap = applyJourneyTick(snap, "morning", t);
    }
    // Final dissolve target for morning has air ≈ 0.62. After 30+
    // ticks of 25% lerp the result should be inside ±0.02.
    const finalAir = JOURNEYS.morning.phases[3].targets.air;
    expect(finalAir).toBeDefined();
    expect(snap.air).toBeGreaterThan((finalAir as number) - 0.02);
    expect(snap.air).toBeLessThan((finalAir as number) + 0.02);
  });

  it("never produces NaN or non-finite output", () => {
    let snap = baseDrone();
    for (const id of JOURNEY_IDS) {
      for (let t = 0; t < 50; t++) {
        snap = applyJourneyTick(snap, id, t);
        for (const v of Object.values(snap)) {
          if (typeof v === "number") {
            expect(Number.isFinite(v)).toBe(true);
          }
        }
      }
    }
  });
});

describe("Journey share round-trip", () => {
  it("preserves the journey id through normalize", () => {
    const scene = normalizePortableScene({
      drone: { journey: "evening" },
      mixer: {},
    });
    expect(scene!.drone.journey).toBe("evening");
  });

  it("defaults to null when missing", () => {
    const scene = normalizePortableScene({ drone: {}, mixer: {} });
    expect(scene!.drone.journey).toBeNull();
  });

  it("rejects unknown journey ids and falls back to null", () => {
    const scene = normalizePortableScene({
      drone: { journey: "not-a-journey" as JourneyId },
      mixer: {},
    });
    expect(scene!.drone.journey).toBeNull();
  });

  it("accepts every shipped journey id", () => {
    for (const id of JOURNEY_IDS) {
      const scene = normalizePortableScene({
        drone: { journey: id },
        mixer: {},
      });
      expect(scene!.drone.journey).toBe(id);
    }
  });
});
