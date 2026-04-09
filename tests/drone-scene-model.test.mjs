import test from "node:test";
import assert from "node:assert/strict";

import {
  createInitialDroneScene,
  freqToPitch,
  liveDroneSceneReducer,
  pitchToFreq,
} from "../.test-dist/scene/droneSceneModel.js";

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
