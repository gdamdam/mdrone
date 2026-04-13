import { describe, it, expect } from "vitest";
import { normalizePortableScene } from "../../src/session";

/**
 * Regression tests for the share-link normaliser. The Cloudflare Worker
 * (worker/worker.ts) used to duplicate this logic with different
 * defaults and clamps, which let malformed payloads render one scene in
 * the worker's OG card and load a different one in the app. These
 * tests pin the shared clamps so any drift (worker OR app) gets caught.
 *
 * See worker/worker.ts `normalizeScene` — it now delegates to this
 * exact function via a small wrapper that fills `drone`/`mixer` with
 * empty records when they're missing, so the worker keeps its
 * forgiving behavior while still using the client's clamps.
 */

// Mirror of worker's wrapper: guarantees non-null by supplying empty
// record defaults when drone/mixer are missing.
const normalizeSharedScene = (decoded: unknown) => {
  const record = (decoded && typeof decoded === "object")
    ? (decoded as Record<string, unknown>)
    : {};
  const droneIn = (record as { drone?: unknown }).drone;
  const mixerIn = (record as { mixer?: unknown }).mixer;
  return normalizePortableScene({
    ...record,
    drone: droneIn && typeof droneIn === "object" ? droneIn : {},
    mixer: mixerIn && typeof mixerIn === "object" ? mixerIn : {},
  });
};

describe("shared share-link normaliser", () => {
  it("clamps octave to [1,6] (worker used to allow 0..7)", () => {
    const below = normalizeSharedScene({ drone: { octave: 0 } });
    const above = normalizeSharedScene({ drone: { octave: 7 } });
    expect(below?.drone.octave).toBe(1);
    expect(above?.drone.octave).toBe(6);
  });

  it("fills defaults when drone and mixer are absent", () => {
    const scene = normalizeSharedScene({ name: "Bare" });
    expect(scene).not.toBeNull();
    expect(scene!.name).toBe("Bare");
    // Both snapshots populated from DEFAULT_* without throwing.
    expect(typeof scene!.drone.root).toBe("string");
    expect(typeof scene!.drone.scale).toBe("string");
    expect(typeof scene!.mixer.hpfHz).toBe("number");
    expect(Number.isFinite(scene!.mixer.volume)).toBe(true);
  });

  it("returns a full scene for totally empty input", () => {
    const scene = normalizeSharedScene({});
    expect(scene).not.toBeNull();
    expect(scene!.drone.octave).toBeGreaterThanOrEqual(1);
    expect(scene!.drone.octave).toBeLessThanOrEqual(6);
  });

  it("rejects unknown scale / root and falls back to client defaults", () => {
    const scene = normalizeSharedScene({
      drone: { root: "H", scale: "mystery-mode" },
    });
    expect(scene).not.toBeNull();
    // Exact fallback values come from DEFAULT_DRONE_SNAPSHOT — we only
    // assert they're members of the client's known whitelists, not
    // specific values, so the test doesn't re-encode the defaults.
    expect(["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]).toContain(
      scene!.drone.root,
    );
    expect([
      "drone",
      "major",
      "minor",
      "dorian",
      "phrygian",
      "just5",
      "pentatonic",
      "meantone",
      "harmonics",
      "maqam-rast",
      "slendro",
    ]).toContain(scene!.drone.scale);
  });

  it("clamps mixer params to client ranges (worker used hardcoded inline)", () => {
    const scene = normalizeSharedScene({
      mixer: {
        hpfHz: 9999, // client clamps to [10, 40]
        low: 999, // client clamps to [-18, 18]
        drive: 999, // client clamps to [1, 10]
        ceiling: 50, // client clamps to [-24, 0]
        volume: 99, // client clamps to [0, 1.5]
      },
    });
    expect(scene!.mixer.hpfHz).toBeLessThanOrEqual(40);
    expect(scene!.mixer.hpfHz).toBeGreaterThanOrEqual(10);
    expect(scene!.mixer.low).toBeLessThanOrEqual(18);
    expect(scene!.mixer.drive).toBeLessThanOrEqual(10);
    expect(scene!.mixer.ceiling).toBeLessThanOrEqual(0);
    expect(scene!.mixer.volume).toBeLessThanOrEqual(1.5);
  });

  it("passes valid fields through unchanged", () => {
    const scene = normalizeSharedScene({
      name: "Valid",
      drone: { root: "D", octave: 3, scale: "dorian" },
      mixer: { hpfHz: 25, volume: 0.7 },
    });
    expect(scene!.drone.root).toBe("D");
    expect(scene!.drone.octave).toBe(3);
    expect(scene!.drone.scale).toBe("dorian");
    expect(scene!.mixer.hpfHz).toBe(25);
    expect(scene!.mixer.volume).toBeCloseTo(0.7);
  });

  it("preserves FM params through normalisation", () => {
    const scene = normalizeSharedScene({
      drone: { fmRatio: 3.5, fmIndex: 4.5 },
    });
    expect(scene!.drone.fmRatio).toBe(3.5);
    expect(scene!.drone.fmIndex).toBe(4.5);
  });

  it("falls back to FM defaults when absent (backward compat)", () => {
    const scene = normalizeSharedScene({ drone: {} });
    expect(scene!.drone.fmRatio).toBe(2.0);
    expect(scene!.drone.fmIndex).toBe(2.4);
  });

  it("clamps FM params to engine-valid range", () => {
    const scene = normalizeSharedScene({
      drone: { fmRatio: 0, fmIndex: 999 },
    });
    expect(scene!.drone.fmRatio).toBe(0.5);
    expect(scene!.drone.fmIndex).toBe(12);
  });
});
