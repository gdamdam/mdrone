import { describe, it, expect } from "vitest";
import {
  TUNINGS,
  RELATIONS,
  DEGREE_LABELS,
  tuningById,
  relationById,
  resolveTuning,
  saveCustomTuning,
  saveOrUpdateCustomTuning,
  deleteCustomTuning,
  relationForTuningPick,
  PLAY_KEY_TO_DEGREE,
  MAX_PLAYED_NOTES,
  playedDegreeToCents,
  playedNoteCents,
  mergePlayedIntervals,
  togglePlayedNote,
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
    // Non-decreasing (not strict) to stay tolerant of future sub-12-
    // tone tables; current tables all have 13 strictly-ascending
    // distinct degrees so picks never collapse to duplicates.
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

  it("slendro degrees are strictly ascending (no picks collapse to dupes)", () => {
    const slendro = tuningById("slendro");
    for (let i = 1; i < slendro.degrees.length; i++) {
      expect(slendro.degrees[i], `slendro degree ${i}`).toBeGreaterThan(
        slendro.degrees[i - 1],
      );
    }
  });

  it("authored custom tunings are resolvable by id", () => {
    for (const id of [
      "custom:young-wtp",
      "custom:just7",
      "custom:partch-11",
      "custom:15-tet",
    ] as const) {
      const t = tuningById(id);
      expect(t.id, `authored tuning "${id}" should be present`).toBe(id);
      expect(t.degrees.length).toBe(13);
      expect(t.degrees[0]).toBe(0);
      expect(t.degrees[12]).toBe(1200);
    }
  });
});

// Valid 13-slot degree table (12-TET) for save tests.
const TEST_DEGREES = Array.from({ length: 13 }, (_, i) => i * 100);

describe("saveCustomTuning slug collisions", () => {
  it("de-duplicates the slug when it collides with an authored custom id", () => {
    // "Pelog" slugs to custom:pelog, which is an authored tuning id —
    // before the fix the user save silently shadowed the authored table.
    const authored = tuningById("custom:pelog");
    expect(authored.id).toBe("custom:pelog");

    const saved = saveCustomTuning("Pelog", TEST_DEGREES);
    try {
      expect(saved.id).not.toBe("custom:pelog");
      // Both must remain resolvable: authored at its original id…
      expect(tuningById("custom:pelog")).toBe(authored);
      // …and the user save at its de-duplicated id.
      expect(tuningById(saved.id).label).toBe("Pelog");
      expect(tuningById(saved.id).degrees).toEqual(TEST_DEGREES);
    } finally {
      deleteCustomTuning(saved.id);
    }
  });

  it("two saves with the same name get distinct ids", () => {
    const a = saveCustomTuning("My Drone Scale", TEST_DEGREES);
    const b = saveCustomTuning("My Drone Scale", TEST_DEGREES);
    try {
      expect(a.id).not.toBe(b.id);
      expect(tuningById(a.id).id).toBe(a.id);
      expect(tuningById(b.id).id).toBe(b.id);
    } finally {
      deleteCustomTuning(a.id);
      deleteCustomTuning(b.id);
    }
  });
});

describe("saveOrUpdateCustomTuning (scale editor save flow)", () => {
  it("edits in place when the name still slugs to the opened tuning", () => {
    // The editor's "edit in place" flow: re-saving the tuning the
    // editor was opened on must update it, not create a -2 duplicate
    // (which slug de-duplication in saveCustomTuning would otherwise do).
    const original = saveCustomTuning("Editor Probe", TEST_DEGREES);
    const editedDegrees = TEST_DEGREES.map((d, i) => (i === 1 ? d + 1 : d));
    const updated = saveOrUpdateCustomTuning("Editor Probe", editedDegrees, original.id);
    try {
      expect(updated.id).toBe(original.id);
      expect(tuningById(original.id).degrees).toEqual(editedDegrees);
      // No duplicate left behind at a suffixed id.
      expect(TUNINGS.some((t) => t.id === `${original.id}-2`)).toBe(false);
    } finally {
      deleteCustomTuning(original.id);
    }
  });

  it("creates a new de-duplicated entry when the name no longer matches", () => {
    const original = saveCustomTuning("Editor Probe", TEST_DEGREES);
    const renamed = saveOrUpdateCustomTuning("Editor Probe Two", TEST_DEGREES, original.id);
    try {
      expect(renamed.id).not.toBe(original.id);
      expect(tuningById(original.id).id).toBe(original.id);
      expect(tuningById(renamed.id).label).toBe("Editor Probe Two");
    } finally {
      deleteCustomTuning(original.id);
      deleteCustomTuning(renamed.id);
    }
  });

  it("saves as new when opened with no current tuning", () => {
    const saved = saveOrUpdateCustomTuning("Editor Probe", TEST_DEGREES, null);
    try {
      expect(tuningById(saved.id).label).toBe("Editor Probe");
    } finally {
      deleteCustomTuning(saved.id);
    }
  });
});

describe("TUNINGS proxy cache", () => {
  it("reflects a save immediately and a delete immediately after", () => {
    const before = TUNINGS.length;
    const saved = saveCustomTuning("Cache Probe", TEST_DEGREES);
    try {
      // Mutate-after-save visibility: a stale cache would still report
      // the old length / miss the new entry here.
      expect(TUNINGS.length).toBe(before + 1);
      expect(TUNINGS[TUNINGS.length - 1].id).toBe(saved.id);
      expect(TUNINGS.some((t) => t.id === saved.id)).toBe(true);
    } finally {
      deleteCustomTuning(saved.id);
    }
    expect(TUNINGS.length).toBe(before);
    expect(TUNINGS.some((t) => t.id === saved.id)).toBe(false);
  });

  it("element identity is stable across repeated accesses", () => {
    // Observable contract: indexing twice yields the same object, so
    // identity-based lookups (indexOf, Set membership) work on TUNINGS.
    expect(TUNINGS[0]).toBe(TUNINGS[0]);
    expect(TUNINGS.indexOf(TUNINGS[0])).toBe(0);
    const last = TUNINGS[TUNINGS.length - 1];
    expect(TUNINGS.includes(last)).toBe(true);
  });
});

describe("suggested-relation metadata (U4)", () => {
  it("relationForTuningPick returns the suggested relation for an annotated tuning", () => {
    expect(relationForTuningPick("custom:pythagorean", "unison")).toBe("tonic-fifth");
    expect(relationForTuningPick("custom:pelog", "tonic-fifth")).toBe("unison");
    expect(relationForTuningPick("custom:otonal-16-32", null)).toBe("harmonic-stack");
  });

  it("relationForTuningPick keeps the current relation for unannotated tunings", () => {
    // Builtins and the first authored batch carry no suggestion.
    expect(relationForTuningPick("just5", "minor-triad")).toBe("minor-triad");
    expect(relationForTuningPick("custom:just7", "unison")).toBe("unison");
    expect(relationForTuningPick("equal", null)).toBe(null);
  });

  it("relationForTuningPick keeps the current relation for unknown / null ids", () => {
    expect(relationForTuningPick("custom:does-not-exist", "tonic-fourth")).toBe("tonic-fourth");
    expect(relationForTuningPick(null, "drone-triad")).toBe("drone-triad");
  });

  it("every suggestedRelationId references a real relation", () => {
    for (const t of TUNINGS) {
      if (t.suggestedRelationId !== undefined) {
        expect(
          RELATIONS.some((r) => r.id === t.suggestedRelationId),
          `tuning "${t.id}" suggests unknown relation "${t.suggestedRelationId}"`,
        ).toBe(true);
      }
    }
  });

  it("every suggestedVoicing entry is a known voice id", () => {
    // Mirror of the voice timbre ids in DroneView's VOICES list — kept
    // in sync by hand; this test catches typos in authored metadata.
    const VOICE_IDS = new Set(["tanpura", "reed", "metal", "air", "piano", "fm", "amp", "noise"]);
    for (const t of TUNINGS) {
      if (t.suggestedVoicing !== undefined) {
        expect(t.suggestedVoicing.length, `tuning "${t.id}"`).toBeGreaterThan(0);
        for (const v of t.suggestedVoicing) {
          expect(VOICE_IDS.has(v), `tuning "${t.id}" voicing "${v}"`).toBe(true);
        }
      }
    }
  });
});

/**
 * Played-pitch layer (Option A). The QWERTY keyboard, in PLAY mode,
 * adds sustained scale-degree voices above the tonic instead of moving
 * the root. These pure helpers turn key presses into intervalsCents the
 * engine already consumes, snapped to the active tuning.
 */
describe("played-pitch layer", () => {
  it("maps the QWERTY play keys to ascending degree indices", () => {
    expect(PLAY_KEY_TO_DEGREE.KeyA).toBe(0);
    expect(PLAY_KEY_TO_DEGREE.KeyJ).toBe(11);
    expect(PLAY_KEY_TO_DEGREE.KeyK).toBe(12);
    // 13 keys covering one octave (P1..P8 inclusive).
    expect(Object.keys(PLAY_KEY_TO_DEGREE).length).toBe(13);
    const degrees = Object.values(PLAY_KEY_TO_DEGREE);
    expect(new Set(degrees).size).toBe(degrees.length); // no duplicate degrees
  });

  it("exposes a positive integer note cap", () => {
    expect(Number.isInteger(MAX_PLAYED_NOTES)).toBe(true);
    expect(MAX_PLAYED_NOTES).toBeGreaterThan(0);
  });

  it("resolves a played degree to cents in equal temperament", () => {
    expect(playedDegreeToCents(0, "equal")).toBe(0);
    expect(playedDegreeToCents(7, "equal")).toBe(700);
    expect(playedDegreeToCents(12, "equal")).toBe(1200);
  });

  it("snaps played degrees to the ACTIVE tuning, not 12-TET", () => {
    // Just 5-limit major third is 386.31¢, not 400¢.
    expect(playedDegreeToCents(4, "just5")).toBeCloseTo(386.31, 2);
    expect(playedDegreeToCents(7, "just5")).toBeCloseTo(701.96, 2);
  });

  it("falls back to equal temperament when tuning is null", () => {
    expect(playedDegreeToCents(3, null)).toBe(300);
  });

  it("returns null for out-of-range or invalid degrees", () => {
    expect(playedDegreeToCents(13, "equal")).toBeNull();
    expect(playedDegreeToCents(-1, "equal")).toBeNull();
    expect(playedDegreeToCents(1.5, "equal")).toBeNull();
  });

  it("leaves base intervals untouched when nothing is played", () => {
    expect(mergePlayedIntervals([0, 700], [])).toEqual([0, 700]);
  });

  it("appends played cents not already present, base order preserved", () => {
    expect(mergePlayedIntervals([0, 700], [400])).toEqual([0, 700, 400]);
  });

  it("dedupes played cents that collide (within 1¢) with the base", () => {
    expect(mergePlayedIntervals([0, 700], [700.2])).toEqual([0, 700]);
  });

  it("sorts the appended played additions ascending", () => {
    expect(mergePlayedIntervals([0], [900, 300, 600])).toEqual([0, 300, 600, 900]);
  });

  it("caps the number of played additions at MAX_PLAYED_NOTES", () => {
    const played = [100, 200, 300, 400, 500, 600, 700, 800]; // 8 distinct
    const merged = mergePlayedIntervals([0], played);
    expect(merged.length).toBe(1 + MAX_PLAYED_NOTES);
  });

  it("resolves a played note to cents including its octave register", () => {
    expect(playedNoteCents({ degree: 7, octave: 0 }, "equal")).toBe(700);
    expect(playedNoteCents({ degree: 7, octave: 1 }, "equal")).toBe(1900); // +1 octave
    expect(playedNoteCents({ degree: 0, octave: -1 }, "equal")).toBe(-1200); // below the tonic
  });

  it("octave offset rides on top of the active microtuning", () => {
    // Just-5 fifth (701.96¢) one octave up.
    expect(playedNoteCents({ degree: 7, octave: 1 }, "just5")).toBeCloseTo(1901.96, 2);
  });

  it("returns null for a note with an out-of-range degree", () => {
    expect(playedNoteCents({ degree: 13, octave: 0 }, "equal")).toBeNull();
  });

  it("toggle adds a note not yet held, sorted by octave then degree", () => {
    expect(togglePlayedNote([{ degree: 5, octave: 0 }], { degree: 2, octave: 0 }))
      .toEqual([{ degree: 2, octave: 0 }, { degree: 5, octave: 0 }]);
  });

  it("toggle removes a held degree regardless of which octave it's in", () => {
    // The held note is degree 4 at octave 0; toggling degree 4 at the
    // current register (+1) still removes it — removal is register-
    // agnostic so a note can always be cleared by tapping its key.
    expect(togglePlayedNote([{ degree: 0, octave: 0 }, { degree: 4, octave: 0 }], { degree: 4, octave: 1 }))
      .toEqual([{ degree: 0, octave: 0 }]);
  });

  it("a degree holds at most one octave — re-toggling clears it, doesn't double it", () => {
    // Holding degree 0 at octave 0, then toggling degree 0 at octave +1
    // removes the held one rather than stacking a second.
    expect(togglePlayedNote([{ degree: 0, octave: 0 }], { degree: 0, octave: 1 }))
      .toEqual([]);
  });

  it("toggle refuses to add past the cap, returning the same reference", () => {
    const full = [0, 1, 2, 3, 4, 5].map((degree) => ({ degree, octave: 0 }));
    const result = togglePlayedNote(full, { degree: 6, octave: 0 }, 6);
    expect(result).toBe(full); // unchanged reference → no re-render
  });

  it("toggle still removes when already at the cap", () => {
    const full = [0, 1, 2, 3, 4, 5].map((degree) => ({ degree, octave: 0 }));
    expect(togglePlayedNote(full, { degree: 2, octave: 0 }, 6))
      .toEqual([0, 1, 3, 4, 5].map((degree) => ({ degree, octave: 0 })));
  });
});
