import test from "node:test";
import assert from "node:assert/strict";

import {
  applyFxSnapshot,
  applyMixerSnapshot,
  captureFxSnapshot,
  captureMixerSnapshot,
  capturePortableScene,
} from "../.test-dist/scene/sceneSnapshots.js";

function createFakeEngine() {
  const fxLevels = {
    tape: 0.1,
    wow: 0.2,
    sub: 0.3,
    comb: 0.4,
    delay: 0.5,
    plate: 0.6,
    hall: 0.7,
    shimmer: 0.8,
    freeze: 0.9,
  };

  const calls = [];

  const fxChain = {
    getEffectLevel: (id) => fxLevels[id],
    getDelayTime: () => 0.55,
    getDelayFeedback: () => 0.58,
    getCombFeedback: () => 0.85,
    getSubCenter: () => 110,
    getFreezeFeedback: () => 0.75,
    setDelayTime: (value) => calls.push(["delayTime", value]),
    setDelayFeedback: (value) => calls.push(["delayFeedback", value]),
    setCombFeedback: (value) => calls.push(["combFeedback", value]),
    setSubCenter: (value) => calls.push(["subCenter", value]),
    setFreezeFeedback: (value) => calls.push(["freezeMix", value]),
    setEffectLevel: (id, value) => calls.push([id, value]),
  };

  return {
    calls,
    engine: {
      getHpfFreq: () => 30,
      getEqLow: () => ({ gain: { value: -2 } }),
      getEqMid: () => ({ gain: { value: 1 } }),
      getEqHigh: () => ({ gain: { value: 3 } }),
      getGlueAmount: () => 0.4,
      getDrive: () => 2.5,
      isLimiterEnabled: () => true,
      getLimiterCeiling: () => -1.2,
      getOutputTrim: () => ({ gain: { value: 0.95 } }),
      isHeadphoneSafe: () => false,
      getWidth: () => 1,
      setWidth: (value) => calls.push(["width", value]),
      getEffectOrder: () => [
        "tape", "wow", "sub", "comb", "delay",
        "plate", "hall", "shimmer", "freeze", "cistern",
        "granular", "graincloud", "ringmod", "formant",
      ],
      setHpfFreq: (value) => calls.push(["hpf", value]),
      setGlueAmount: (value) => calls.push(["glue", value]),
      setDrive: (value) => calls.push(["drive", value]),
      setLimiterCeiling: (value) => calls.push(["ceiling", value]),
      setLimiterEnabled: (value) => calls.push(["limiter", value]),
      setHeadphoneSafe: (value) => calls.push(["headphoneSafe", value]),
      getFxChain: () => fxChain,
    },
  };
}

test("capture snapshot helpers serialize mixer and fx state", () => {
  const { engine } = createFakeEngine();
  const mixer = captureMixerSnapshot(engine);
  const fx = captureFxSnapshot(engine);

  assert.equal(mixer.hpfHz, 30);
  assert.equal(mixer.low, -2);
  assert.equal(mixer.volume, 0.95);
  assert.equal(fx.levels.shimmer, 0.8);
  assert.equal(fx.freezeMix, 0.75);
});

test("apply snapshot helpers push values back into the engine", () => {
  const { engine, calls } = createFakeEngine();

  applyMixerSnapshot(engine, {
    hpfHz: 20,
    low: -3,
    mid: 2,
    high: 4,
    glue: 0.6,
    drive: 3,
    limiterOn: false,
    ceiling: -2,
    volume: 1.1,
  });

  applyFxSnapshot(engine, {
    levels: {
      tape: 0.4,
      wow: 0.4,
      sub: 0.4,
      comb: 0.4,
      delay: 0.4,
      plate: 0.4,
      hall: 0.4,
      shimmer: 0.4,
      freeze: 0.4,
    },
    delayTime: 0.7,
    delayFeedback: 0.65,
    combFeedback: 0.75,
    subCenter: 90,
    freezeMix: 0.5,
  });

  assert.deepEqual(calls.slice(0, 5), [
    ["hpf", 20],
    ["glue", 0.6],
    ["drive", 3],
    ["ceiling", -2],
    ["limiter", false],
  ]);
  assert.ok(calls.some(([key, value]) => key === "delayTime" && value === 0.7));
  assert.ok(calls.some(([key, value]) => key === "freeze" && value === 0.4));
});

test("capturePortableScene packages drone, mixer, fx, and ui state", () => {
  globalThis.localStorage = {
    getItem: () => "ember",
    setItem: () => {},
    removeItem: () => {},
  };

  const { engine } = createFakeEngine();
  const scene = capturePortableScene(
    engine,
    {
      activePresetId: "test",
      playing: true,
      root: "D",
      octave: 3,
      scale: "minor",
      tuningId: null,
      relationId: null,
      fineTuneOffsets: [],
      voiceLayers: { tanpura: true, reed: true, metal: false, air: false },
      voiceLevels: { tanpura: 1, reed: 0.5, metal: 0, air: 0 },
      effects: {
        tape: true,
        wow: false,
        sub: false,
        comb: false,
        delay: false,
        plate: true,
        hall: false,
        shimmer: false,
        freeze: false,
      },
      drift: 0.2,
      air: 0.3,
      time: 0.4,
      sub: 0.1,
      bloom: 0.5,
      glide: 0.6,
      climateX: 0.7,
      climateY: 0.8,
      lfoShape: "sine",
      lfoRate: 0.4,
      lfoAmount: 0.2,
      presetMorph: 0.25,
      evolve: 0,
      pluckRate: 1,
      presetTrim: 1,
    },
    "mandala",
    "Scene Name",
  );

  assert.equal(scene.name, "Scene Name");
  assert.equal(scene.drone.root, "D");
  assert.equal(scene.mixer.hpfHz, 30);
  assert.equal(scene.fx.levels.freeze, 0.9);
  assert.equal(scene.ui.visualizer, "mandala");
});
