import test from "node:test";
import assert from "node:assert/strict";

import {
  createInitialDroneScene,
  freqToPitch,
  liveDroneSceneReducer,
  pitchToFreq,
  resolveIntervals,
} from "../.test-dist/scene/droneSceneModel.js";
import {
  resolveTuning,
  TUNINGS,
  RELATIONS,
  tuningById,
  relationById,
} from "../.test-dist/microtuning.js";

test("pitch helpers round-trip concert A", () => {
  const freq = pitchToFreq("A", 4);
  assert.equal(Math.round(freq), 440);
  assert.deepEqual(freqToPitch(freq), { pitchClass: "A", octave: 4 });
});

test("createInitialDroneScene reads engine-backed defaults", () => {
  const fakeEngine = {
    getVoiceLayers: () => ({ tanpura: false, reed: true, metal: false, air: true }),
    getVoiceLevel: (voiceType) => ({ tanpura: 0.2, reed: 0.8, metal: 0.4, air: 0.6 })[voiceType],
    getEffectStates: () => ({
      tape: true,
      wow: false,
      plate: true,
      hall: false,
      shimmer: false,
      delay: true,
      sub: false,
      comb: true,
      freeze: false,
    }),
    getDrift: () => 0.11,
    getAir: () => 0.22,
    getTime: () => 0.33,
    getSub: () => 0.44,
    getBloom: () => 0.55,
    getGlide: () => 0.66,
    getClimateX: () => 0.77,
    getClimateY: () => 0.88,
    getLfoShape: () => "triangle",
    getLfoRate: () => 0.99,
    getLfoAmount: () => 0.12,
    getPresetMorph: () => 0.23,
    getEvolve: () => 0.34,
    getTanpuraPluckRate: () => 1.5,
    getPresetTrim: () => 0.91,
  };

  const scene = createInitialDroneScene(fakeEngine);
  assert.equal(scene.voiceLayers.reed, true);
  assert.equal(scene.voiceLevels.reed, 0.8);
  assert.equal(scene.effects.delay, true);
  assert.equal(scene.climateX, 0.77);
  assert.equal(scene.lfoShape, "triangle");
  assert.equal(scene.presetTrim, 0.91);
});

test("liveDroneSceneReducer updates focused scene slices", () => {
  const initial = createInitialDroneScene(null);
  const withRoot = liveDroneSceneReducer(initial, { type: "setRoot", root: "C#" });
  const withOctave = liveDroneSceneReducer(withRoot, { type: "setOctave", octave: 7 });
  const withVoice = liveDroneSceneReducer(withOctave, {
    type: "setVoiceLayer",
    voiceType: "metal",
    on: true,
  });
  const withClimate = liveDroneSceneReducer(withVoice, { type: "setClimate", x: 0.2, y: 0.9 });

  assert.equal(withRoot.root, "C#");
  assert.equal(withOctave.octave, 6);
  assert.equal(withVoice.voiceLayers.metal, true);
  assert.equal(withClimate.climateX, 0.2);
  assert.equal(withClimate.climateY, 0.9);
});

// ── Microtuning resolver tests ───────────────────────────────────────

test("resolveTuning returns correct intervals for equal + drone-triad", () => {
  const intervals = resolveTuning("equal", "drone-triad");
  assert.deepEqual(intervals, [0, 400, 700]);
});

test("resolveTuning returns correct intervals for just5 + tonic-fifth", () => {
  const intervals = resolveTuning("just5", "tonic-fifth");
  assert.deepEqual(intervals, [0, 701.96]);
});

test("resolveTuning returns single-note unison for any tuning", () => {
  for (const tuning of TUNINGS) {
    const intervals = resolveTuning(tuning.id, "unison");
    assert.deepEqual(intervals, [0], `${tuning.id} + unison should be [0]`);
  }
});

test("resolveTuning harmonic-stack picks 5 intervals", () => {
  const intervals = resolveTuning("harmonics", "harmonic-stack");
  assert.equal(intervals.length, 5);
  assert.equal(intervals[0], 0);
  assert.equal(intervals[4], 1200);
  // m7 in harmonic series is partial 7/4 = 968.83 cents
  assert.equal(intervals[3], 968.83);
});

test("resolveTuning slendro + tonic-fourth gives slendro fourth (~480)", () => {
  const intervals = resolveTuning("slendro", "tonic-fourth");
  assert.deepEqual(intervals, [0, 480]);
});

test("resolveTuning meantone + drone-triad differs from equal", () => {
  const equal = resolveTuning("equal", "drone-triad");
  const meantone = resolveTuning("meantone", "drone-triad");
  assert.notDeepEqual(equal, meantone);
  // Meantone M3 = 386.31 (pure), P5 = 696.58 (narrow)
  assert.equal(meantone[1], 386.31);
  assert.equal(meantone[2], 696.58);
});

test("resolveIntervals falls back to scale when no tuning/relation", () => {
  const intervals = resolveIntervals({ scale: "major", tuningId: null, relationId: null });
  assert.deepEqual(intervals, [0, 400, 700]);
});

test("resolveIntervals uses tuning+relation when both present", () => {
  const intervals = resolveIntervals({ scale: "major", tuningId: "just5", relationId: "drone-triad" });
  // just5 drone-triad: [0, 386.31, 701.96] — different from equal major [0, 400, 700]
  assert.deepEqual(intervals, [0, 386.31, 701.96]);
});

test("resolveIntervals ignores partial tuning (only tuningId, no relationId)", () => {
  const intervals = resolveIntervals({ scale: "drone", tuningId: "just5", relationId: null });
  assert.deepEqual(intervals, [0]);
});

test("all tuning tables have 13 degrees", () => {
  for (const tuning of TUNINGS) {
    assert.equal(tuning.degrees.length, 13, `${tuning.id} should have 13 degrees`);
    assert.equal(tuning.degrees[0], 0, `${tuning.id} should start at 0`);
    assert.equal(tuning.degrees[12], 1200, `${tuning.id} should end at 1200`);
  }
});

test("all relation picks are valid degree indices", () => {
  for (const relation of RELATIONS) {
    for (const pick of relation.picks) {
      assert.ok(pick >= 0 && pick <= 12, `${relation.id} pick ${pick} out of range`);
    }
  }
});

test("tuningById and relationById return defaults for unknown ids", () => {
  const tuning = tuningById("nonexistent");
  const relation = relationById("nonexistent");
  assert.equal(tuning.id, "equal");
  assert.equal(relation.id, "unison");
});

test("setTuning and setRelation reducer actions update state", () => {
  const initial = createInitialDroneScene(null);
  assert.equal(initial.tuningId, null);
  assert.equal(initial.relationId, null);

  const withTuning = liveDroneSceneReducer(initial, { type: "setTuning", tuningId: "just5" });
  assert.equal(withTuning.tuningId, "just5");

  const withRelation = liveDroneSceneReducer(withTuning, { type: "setRelation", relationId: "drone-triad" });
  assert.equal(withRelation.relationId, "drone-triad");

  // Clear back to null
  const cleared = liveDroneSceneReducer(withRelation, { type: "setTuning", tuningId: null });
  assert.equal(cleared.tuningId, null);
});
