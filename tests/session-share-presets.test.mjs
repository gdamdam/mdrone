import test from "node:test";
import assert from "node:assert/strict";

globalThis.window = globalThis;

const { normalizePortableScene } = await import("../.test-dist/session.js");
const {
  decodeScenePayload,
  encodeScenePayload,
  extractScenePayloadFromUrl,
} = await import("../.test-dist/shareCodec.js");
const { PRESETS, applyPreset } = await import("../.test-dist/engine/presets.js");

test("normalizePortableScene clamps and sanitizes decoded scene data", () => {
  const scene = normalizePortableScene({
    name: "Shared",
    drone: {
      root: "H",
      octave: 99,
      scale: "mystery",
      voiceLayers: { tanpura: true },
      voiceLevels: { tanpura: 5 },
      effects: { tape: true },
      drift: 2,
      air: -1,
      time: 0.4,
      sub: 0.2,
      bloom: 0.5,
      glide: 0.6,
      climateX: 3,
      climateY: -2,
      lfoShape: "triangle",
      lfoRate: 99,
      lfoAmount: -1,
      presetMorph: 2,
      evolve: -2,
      pluckRate: 10,
      presetTrim: 20,
    },
    mixer: {
      hpfHz: 999,
      low: 100,
      mid: -100,
      high: 4,
      glue: 3,
      drive: 20,
      limiterOn: true,
      ceiling: -100,
      volume: 5,
    },
  });

  assert.equal(scene.name, "Shared");
  assert.equal(scene.drone.root, "A");
  assert.equal(scene.drone.octave, 6);
  assert.equal(scene.drone.scale, "dorian");
  assert.equal(scene.drone.voiceLevels.tanpura, 1);
  assert.equal(scene.drone.climateX, 1);
  assert.equal(scene.drone.climateY, 0);
  assert.equal(scene.mixer.hpfHz, 40);
  assert.equal(scene.mixer.volume, 1.5);
});

test("share codec round-trips a portable scene payload", async () => {
  const source = normalizePortableScene({
    name: "Share Me",
    drone: {
      activePresetId: "tanpura-drone",
      playing: true,
      root: "C",
      octave: 2,
      scale: "drone",
      voiceLayers: { tanpura: true, reed: false, metal: false, air: false },
      voiceLevels: { tanpura: 1, reed: 0, metal: 0, air: 0 },
      effects: {
        tape: false,
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
      evolve: 0.1,
      pluckRate: 1,
      presetTrim: 1,
    },
    mixer: {
      hpfHz: 20,
      low: 0,
      mid: 0,
      high: 0,
      glue: 0.2,
      drive: 1.5,
      limiterOn: true,
      ceiling: -1,
      volume: 1,
    },
    fx: {
      levels: {
        tape: 1,
        wow: 1,
        sub: 0.9,
        comb: 0.85,
        delay: 0.9,
        plate: 1,
        hall: 1,
        shimmer: 0.95,
        freeze: 1,
      },
      delayTime: 0.55,
      delayFeedback: 0.58,
      combFeedback: 0.85,
      subCenter: 110,
      freezeMix: 1,
    },
    ui: {
      paletteId: "ember",
      visualizer: "mandala",
    },
  });

  const encoded = await encodeScenePayload(source);
  const extracted = extractScenePayloadFromUrl(`https://mdrone.mpump.live/?${encoded.key}=${encoded.value}`);
  const decoded = await decodeScenePayload(extracted.payload, extracted.compressed);

  assert.equal(decoded.name, "Share Me");
  assert.equal(decoded.drone.root, "C");
  assert.equal(decoded.ui.visualizer, "mandala");
});

test("applyPreset normalizes levels and clears unspecified effects", () => {
  const preset = PRESETS.find((item) => item.id === "stars-of-the-lid");
  const effectCalls = [];
  const uiState = {};

  applyPreset(null, preset, {
    setVoiceLayers: (value) => { uiState.voiceLayers = value; },
    setVoiceLevels: (value) => { uiState.voiceLevels = value; },
    setDrift: (value) => { uiState.drift = value; },
    setAir: (value) => { uiState.air = value; },
    setTime: (value) => { uiState.time = value; },
    setSub: (value) => { uiState.sub = value; },
    setBloom: (value) => { uiState.bloom = value; },
    setGlide: (value) => { uiState.glide = value; },
    setLfoShape: (value) => { uiState.lfoShape = value; },
    setLfoRate: (value) => { uiState.lfoRate = value; },
    setLfoAmount: (value) => { uiState.lfoAmount = value; },
    setClimate: (x, y) => { uiState.climate = { x, y }; },
    setScale: (value) => { uiState.scale = value; },
    setEffectEnabled: (id, on) => effectCalls.push([id, on]),
  });

  const totalActiveLevel =
    uiState.voiceLevels.tanpura +
    uiState.voiceLevels.metal +
    uiState.voiceLevels.air;

  assert.equal(uiState.voiceLayers.reed, false);
  assert.ok(Math.abs(totalActiveLevel - 1.4) < 0.0001);
  assert.ok(effectCalls.some(([id, on]) => id === "shimmer" && on === true));
  assert.ok(effectCalls.some(([id, on]) => id === "delay" && on === false));
});
