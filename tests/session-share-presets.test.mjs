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
const { PRESETS, applyPreset, getPresetMaterialProfile, createWelcomeScene } = await import("../.test-dist/engine/presets.js");
const { saveCustomTuningAtId, tuningById, resolveTuning } = await import("../.test-dist/microtuning.js");

test("normalizePortableScene clamps and sanitizes decoded scene data", () => {
  const scene = normalizePortableScene({
    name: "Shared",
    drone: {
      root: "H",
      octave: 99,
      scale: "mystery",
      tuningId: "bogus",
      relationId: "bogus",
      fineTuneOffsets: [99, -40, "bad"],
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
  assert.deepEqual(scene.drone.fineTuneOffsets, [25, -25, 0]);
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
      fineTuneOffsets: [0, 4.5],
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
  const extracted = extractScenePayloadFromUrl(`https://mdrone.org/?${encoded.key}=${encoded.value}`);
  const decoded = await decodeScenePayload(extracted.payload, extracted.compressed);

  assert.equal(decoded.name, "Share Me");
  assert.equal(decoded.drone.root, "C");
  assert.equal(decoded.drone.tuningId, "just5");
  assert.equal(decoded.drone.relationId, "tonic-fifth");
  assert.deepEqual(decoded.drone.fineTuneOffsets, [0, 4.5]);
  assert.equal(decoded.ui.visualizer, "mandala");
});

test("share codec round-trips a scene carrying a custom tuning table", async () => {
  // Simulate a recipient who has NEVER seen "custom:foreign-scale":
  // the scene's bundled customTuning must travel intact through the
  // codec and, when upserted at the scene's explicit id, resolve to
  // exactly the bundled cents. Non-standard label-slug / id mismatch
  // is deliberate — that's the authored-tuning case in the wild.
  const bundledDegrees = [0, 133.5, 218.8, 301.1, 392.4, 507.6, 612.9, 719.2, 805.1, 891.4, 997.7, 1104.0, 1200];
  const source = normalizePortableScene({
    name: "Xen Scene",
    drone: {
      root: "D",
      octave: 3,
      scale: "drone",
      tuningId: "custom:foreign-scale",
      relationId: "drone-triad",
      fineTuneOffsets: [0, 0, 0, 0, -3.2, 0, 0, 2.1],
      voiceLayers: { reed: true },
      voiceLevels: { reed: 1 },
      effects: { hall: true },
      drift: 0.2, air: 0.4, time: 0.1, sub: 0.2, bloom: 0.5, glide: 0.2,
      climateX: 0.5, climateY: 0.5,
      lfoShape: "sine", lfoRate: 0.2, lfoAmount: 0.05,
      presetMorph: 0.25, evolve: 0, pluckRate: 1, noiseColor: 0.3,
      presetTrim: 1, fmRatio: 2, fmIndex: 2.4, fmFeedback: 0, seed: 1,
    },
    mixer: {
      hpfHz: 30, low: 0, mid: 0, high: 0, glue: 0, drive: 0,
      limiterOn: true, ceiling: -1, volume: 0, headphoneSafe: false, width: 0,
    },
    fx: {
      enabled: { hall: true }, levels: { hall: 0.5 }, freezeOn: false,
      freezeMix: 0, freezeBlur: 0,
    },
    ui: { paletteId: "ember", visualizer: "mandala" },
    customTuning: {
      id: "custom:foreign-scale",
      label: "Foreign Scale (14-limit pentatonic)",
      degrees: bundledDegrees,
    },
  });

  assert.ok(source.customTuning, "normalizer preserves customTuning");

  const encoded = await encodeScenePayload(source);
  const extracted = extractScenePayloadFromUrl(`https://mdrone.org/?${encoded.key}=${encoded.value}`);
  const decoded = await decodeScenePayload(extracted.payload, extracted.compressed);

  assert.equal(decoded.drone.tuningId, "custom:foreign-scale");
  assert.equal(decoded.drone.relationId, "drone-triad");
  assert.deepEqual(decoded.drone.fineTuneOffsets, [0, 0, 0, 0, -3.2, 0, 0, 2.1]);
  assert.equal(decoded.customTuning.id, "custom:foreign-scale");
  assert.equal(decoded.customTuning.label, "Foreign Scale (14-limit pentatonic)");
  assert.deepEqual(decoded.customTuning.degrees, bundledDegrees);

  // Apply-path: saveCustomTuningAtId upserts at the EXACT id so
  // drone.tuningId resolves to the bundled cents, not a label-slug.
  globalThis.localStorage = {
    _m: new Map(),
    getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
    setItem(k, v) { this._m.set(k, v); },
    removeItem(k) { this._m.delete(k); },
  };
  const stored = saveCustomTuningAtId(
    decoded.customTuning.id,
    decoded.customTuning.label,
    decoded.customTuning.degrees,
  );
  assert.ok(stored, "saveCustomTuningAtId accepts a valid custom: id");
  assert.equal(stored.id, "custom:foreign-scale");

  const looked = tuningById("custom:foreign-scale");
  assert.equal(looked.id, "custom:foreign-scale");
  assert.deepEqual(looked.degrees, bundledDegrees);

  // Scene's drone-triad relation picks slots [0,4,7] = 0, bundled[4], bundled[7]
  const resolved = resolveTuning("custom:foreign-scale", "drone-triad");
  assert.deepEqual(resolved, [bundledDegrees[0], bundledDegrees[4], bundledDegrees[7]]);
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
      fineTuneOffsets: [],
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
    setNoiseColor: (value) => { uiState.noiseColor = value; },
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
    setFineTuneOffsets: (value) => { uiState.fineTuneOffsets = value; },
    setEffectEnabled: (id, on) => effectCalls.push([id, on]),
  });

  // Stars of the Lid: reed(even) + air — no tanpura, no metal, no shimmer
  assert.equal(uiState.voiceLayers.reed, true);
  assert.equal(uiState.voiceLayers.tanpura, false);
  // Budget was relaxed from 1.4 → 1.0 to stop default saturation;
  // reed level now lands at 1.0 / (1 + 0.45) = 0.69 for SOTL's
  // reed+air stack. Assert against the floor that still proves
  // normalization happened without over-boosting.
  assert.ok(uiState.voiceLevels.reed > 0.5);
  assert.ok(effectCalls.some(([id, on]) => id === "tape" && on === true));
  assert.ok(effectCalls.some(([id, on]) => id === "shimmer" && on === false));
  assert.ok(effectCalls.some(([id, on]) => id === "delay" && on === false));
  assert.equal(engineState.presetTrim, preset.gain);
  assert.equal(engineState.motionProfile.tonicWalk, "rare");
  assert.equal(engineState.reedShape, "even");
  // Stars of the Lid is migrated to just5 + minor-triad
  assert.equal(uiState.tuningId, "just5");
  assert.equal(uiState.relationId, "minor-triad");
  assert.deepEqual(uiState.fineTuneOffsets, []);
  // Engine intervals should be just5 minor-triad: [0, 315.64, 701.96]
  assert.deepEqual(engineState.intervals, [0, 315.64, 701.96]);
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
  const validBuiltinTunings = new Set(["equal", "just5", "meantone", "harmonics", "maqam-rast", "slendro"]);
  const validRelations = new Set(["unison", "tonic-fifth", "tonic-fourth", "minor-triad", "drone-triad", "harmonic-stack"]);
  for (const p of PRESETS) {
    const ok = validBuiltinTunings.has(p.tuningId) ||
      (typeof p.tuningId === "string" && p.tuningId.startsWith("custom:"));
    assert.ok(ok, `${p.id} has invalid tuningId: ${p.tuningId}`);
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
  check("lamb-prisma", "harmonics", "harmonic-stack");
  check("stars-of-the-lid", "just5", "minor-triad");
  // Meantone presets — malone kept on legacy meantone; arkbro-chords
  // migrated to 31-TET which IS meantone at higher precision.
  check("malone-organ", "meantone", "drone-triad");
  check("arkbro-chords", "custom:31-tet", "drone-triad");
  // Harmonic series presets
  check("radigue-drift", "harmonics", "harmonic-stack");
  // young-well-tuned now points at the actual Young 7-limit WTP
  // lattice (custom:young-wtp) rather than the generic harmonics
  // table, so the preset name and the underlying tuning agree.
  check("young-well-tuned", "custom:young-wtp", "harmonic-stack");
  check("tibetan-bowl", "harmonics", "unison");
  // Tuning-aware migrations — each preset's tuning now reveals its
  // character rather than sitting on a neutral fallback:
  //   deep-listening → Pythagorean (Oliveros / pipe-organ lineage)
  //   frahm-solo → Kirnberger III (felted piano, well-tempered)
  check("deep-listening", "custom:pythagorean", "unison");
  check("frahm-solo", "custom:kirnberger-iii", "minor-triad");
  // Equal temperament — noise / industrial kept on flat 12-TET
  // (merzbient, doom-bloom, windscape, hecker-ravedeath).
  check("merzbient", "equal", "unison");
  check("doom-bloom", "equal", "tonic-fifth");
  check("windscape", "equal", "tonic-fourth");
  check("hecker-ravedeath", "equal", "minor-triad");
});

test("welcome preset exists and createWelcomeScene serves it deterministically", () => {
  const welcome = PRESETS.find((p) => p.id === "welcome");
  assert.ok(welcome, "welcome preset registered in PRESETS");
  assert.equal(welcome.name, "Welcome");
  // Core arrival properties: instant just-5 consonance, WEATHER-ready.
  assert.equal(welcome.tuningId, "just5");
  assert.equal(welcome.relationId, "drone-triad");
  assert.ok(welcome.voiceLayers.includes("tanpura"), "tanpura carries the body");
  assert.ok(welcome.voiceLayers.includes("air"), "air tracks climateY");
  // Safe loudness ceiling — a fresh user shouldn't get blasted.
  assert.ok(welcome.gain <= 0.72, `gain ${welcome.gain} within safe ceiling`);
  // Audible motion by default so the room moves without user input.
  assert.ok(welcome.lfoAmount > 0 && welcome.lfoAmount <= 0.15, "gentle audible LFO");

  // Deterministic: every call returns the welcome preset at C3 (fixed
  // tonic, single-entry octaveRange). Random only picks within [3,3].
  const rng = () => 0;
  const a = createWelcomeScene([3, 3], rng);
  const b = createWelcomeScene([3, 3], rng);
  assert.equal(a.preset.id, "welcome");
  assert.equal(b.preset.id, "welcome");
  assert.equal(a.snapshot.root, "C");
  assert.equal(a.snapshot.octave, 3);
  assert.equal(a.snapshot.tuningId, "just5");
  assert.equal(a.snapshot.relationId, "drone-triad");
});
