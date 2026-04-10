import test from "node:test";
import assert from "node:assert/strict";

globalThis.window = globalThis;

const { normalizePortableScene } = await import("../.test-dist/session.js");
const { saveAutosavedScene, loadAutosavedScene } = await import("../.test-dist/session.js");
const {
  decodeScenePayload,
  encodeScenePayload,
  extractScenePayloadFromUrl,
} = await import("../.test-dist/shareCodec.js");
const { PRESETS, applyPreset, getPresetMaterialProfile } = await import("../.test-dist/engine/presets.js");

test("normalizePortableScene clamps and sanitizes decoded scene data", () => {
  const scene = normalizePortableScene({
    name: "Shared",
    drone: {
      root: "H",
      octave: 99,
      scale: "mystery",
      tuningId: "bogus",
      relationId: "bogus",
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
  assert.equal(scene.drone.tuningId, null);
  assert.equal(scene.drone.relationId, null);
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
      tuningId: "just5",
      relationId: "tonic-fifth",
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
  assert.equal(decoded.drone.tuningId, "just5");
  assert.equal(decoded.drone.relationId, "tonic-fifth");
  assert.equal(decoded.ui.visualizer, "mandala");
});

test("autosaved scene round-trips through localStorage", () => {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.has(key) ? storage.get(key) : null,
    setItem: (key, value) => { storage.set(key, value); },
    removeItem: (key) => { storage.delete(key); },
  };

  saveAutosavedScene(normalizePortableScene({
    name: "Last Room",
    drone: {
      activePresetId: "tanpura-drone",
      playing: true,
      root: "D",
      octave: 2,
      scale: "drone",
      tuningId: null,
      relationId: null,
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
  }, "Fallback"));

  const restored = loadAutosavedScene();
  assert.equal(restored.scene.name, "Last Room");
  assert.equal(restored.scene.drone.root, "D");
});

test("applyPreset normalizes levels and clears unspecified effects", () => {
  const preset = PRESETS.find((item) => item.id === "stars-of-the-lid");
  const effectCalls = [];
  const uiState = {};
  const engineState = {};

  applyPreset({
    setPresetTrim: (value) => { engineState.presetTrim = value; },
    setPresetMotionProfile: (value) => { engineState.motionProfile = value; },
    setPresetMaterialProfile: (value) => { engineState.materialProfile = value; },
    setReedShape: (value) => { engineState.reedShape = value; },
    setParallelSends: (value) => { engineState.parallelSends = value; },
    applyDroneScene: (layers, levels, intervals) => {
      engineState.layers = layers;
      engineState.levels = levels;
      engineState.intervals = intervals;
    },
  }, preset, {
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
    setTuning: (value) => { uiState.tuningId = value; },
    setRelation: (value) => { uiState.relationId = value; },
    setEffectEnabled: (id, on) => effectCalls.push([id, on]),
  });

  // Stars of the Lid: reed(even) + air — no tanpura, no metal, no shimmer
  assert.equal(uiState.voiceLayers.reed, true);
  assert.equal(uiState.voiceLayers.tanpura, false);
  assert.ok(uiState.voiceLevels.reed > 0.8);
  assert.ok(effectCalls.some(([id, on]) => id === "tape" && on === true));
  assert.ok(effectCalls.some(([id, on]) => id === "shimmer" && on === false));
  assert.ok(effectCalls.some(([id, on]) => id === "delay" && on === false));
  assert.equal(engineState.presetTrim, preset.gain);
  assert.equal(engineState.motionProfile.tonicWalk, "rare");
  assert.equal(engineState.reedShape, "even");
  // Stars of the Lid is migrated to just5 + drone-triad
  assert.equal(uiState.tuningId, "just5");
  assert.equal(uiState.relationId, "drone-triad");
  // Engine intervals should be just5 drone-triad: [0, 386.31, 701.96]
  assert.deepEqual(engineState.intervals, [0, 386.31, 701.96]);
});

test("preset motion profiles preserve anchored vs unstable evolve behavior", () => {
  const dreamHouse = PRESETS.find((item) => item.id === "dream-house");
  const merzbient = PRESETS.find((item) => item.id === "merzbient");
  const airport = PRESETS.find((item) => item.id === "eno-airport");

  assert.equal(dreamHouse.motionProfile.tonicWalk, "none");
  assert.equal(merzbient.motionProfile.tonicWalk, "restless");
  assert.ok(merzbient.motionProfile.macroStep > dreamHouse.motionProfile.macroStep);
  assert.deepEqual(airport.motionProfile.tonicIntervals, [-5, 5]);
});

test("preset material profiles distinguish stable tones from unstable weather", () => {
  const dreamHouse = PRESETS.find((item) => item.id === "dream-house");
  const merzbient = PRESETS.find((item) => item.id === "merzbient");
  const tanpura = PRESETS.find((item) => item.id === "tanpura-drone");
  const dreamHouseMaterial = getPresetMaterialProfile(dreamHouse);
  const merzbientMaterial = getPresetMaterialProfile(merzbient);
  const tanpuraMaterial = getPresetMaterialProfile(tanpura);

  assert.ok((dreamHouseMaterial.levelWobble.reed ?? 0) < (merzbientMaterial.levelWobble.air ?? 0));
  assert.ok(merzbientMaterial.wobbleRate > dreamHouseMaterial.wobbleRate);
  assert.ok((tanpuraMaterial.pluckRange[1] - tanpuraMaterial.pluckRange[0]) > 0.1);
});

test("all presets carry tuningId and relationId", () => {
  const validTunings = new Set(["equal", "just5", "meantone", "harmonics", "maqam-rast", "slendro"]);
  const validRelations = new Set(["unison", "tonic-fifth", "tonic-fourth", "drone-triad", "harmonic-stack"]);
  for (const p of PRESETS) {
    assert.ok(validTunings.has(p.tuningId), `${p.id} has invalid tuningId: ${p.tuningId}`);
    assert.ok(validRelations.has(p.relationId), `${p.id} has invalid relationId: ${p.relationId}`);
  }
});

test("migrated preset tuning assignments match musical intent", () => {
  const check = (id, tuning, relation) => {
    const p = PRESETS.find((item) => item.id === id);
    assert.equal(p.tuningId, tuning, `${id} tuningId`);
    assert.equal(p.relationId, relation, `${id} relationId`);
  };
  // Just intonation presets
  check("tanpura-drone", "just5", "tonic-fifth");
  check("dream-house", "just5", "drone-triad");
  check("eno-airport", "just5", "drone-triad");
  check("lamb-prisma", "just5", "drone-triad");
  // Meantone presets
  check("malone-organ", "meantone", "drone-triad");
  check("arkbro-chords", "meantone", "drone-triad");
  // Harmonic series presets
  check("radigue-drift", "harmonics", "harmonic-stack");
  check("young-well-tuned", "harmonics", "harmonic-stack");
  check("tibetan-bowl", "harmonics", "unison");
  // Equal temperament / noise
  check("deep-listening", "equal", "unison");
  check("merzbient", "equal", "unison");
  check("doom-bloom", "equal", "tonic-fifth");
  check("windscape", "equal", "tonic-fourth");
});
