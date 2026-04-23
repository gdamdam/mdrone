import test from "node:test";
import assert from "node:assert/strict";

globalThis.window = globalThis;

const { sampleGoodDrone, GOOD_DRONE_TUNING_IDS } = await import("../.test-dist/goodDrone.js");
const { RELATIONS, relationById } = await import("../.test-dist/microtuning.js");

// Deterministic RNG driven by a scripted sequence of 0..1 floats.
// Values are consumed in the same order sampleGoodDrone needs them:
//   1. pick tuning from pool
//   2. pick relation from that tuning's list
//   3..n. per-non-root-slot: magnitude, sign
function scriptedRng(seq) {
  let i = 0;
  return () => seq[i++ % seq.length];
}

test("sampleGoodDrone picks from the curated pool", () => {
  const validRelations = new Set(RELATIONS.map((r) => r.id));
  // Run 40 samples with Math.random — every result must be in the pool.
  for (let i = 0; i < 40; i++) {
    const g = sampleGoodDrone();
    assert.ok(
      GOOD_DRONE_TUNING_IDS.includes(g.tuningId),
      `tuningId ${g.tuningId} not in curated pool`,
    );
    assert.ok(validRelations.has(g.relationId), `relationId ${g.relationId} invalid`);
  }
});

test("sampleGoodDrone detune is subtle on every non-root slot", () => {
  for (let i = 0; i < 40; i++) {
    const g = sampleGoodDrone();
    const picks = relationById(g.relationId).picks;
    assert.equal(
      g.fineTuneOffsets.length,
      picks.length,
      "offsets length matches relation picks",
    );
    assert.equal(g.fineTuneOffsets[0], 0, "root offset is zero");
    for (let j = 1; j < g.fineTuneOffsets.length; j++) {
      const d = g.fineTuneOffsets[j];
      assert.notEqual(d, 0, `slot ${j} is non-zero (always breathing)`);
      assert.ok(Math.abs(d) >= 2 && Math.abs(d) <= 5, `slot ${j} detune |${d}| in [2,5]`);
    }
  }
});

test("sampleGoodDrone is deterministic under an injected RNG", () => {
  // Fixed sequence: pool pick=0.0 (first entry just5), relation pick=0.0
  // (first "tonic-fifth"), then alternating magnitude/sign pairs.
  const rng = scriptedRng([0, 0, 0.5, 0.25, 0.5, 0.75]);
  const g = sampleGoodDrone(rng);
  assert.equal(g.tuningId, "just5");
  assert.equal(g.relationId, "tonic-fifth");
  // tonic-fifth picks [0, 7] → offsets length 2, slot 1 has detune.
  assert.equal(g.fineTuneOffsets.length, 2);
  assert.equal(g.fineTuneOffsets[0], 0);
  // magnitude 2 + 0.5*3 = 3.5, sign 0.25 < 0.5 → negative → -3.5
  assert.equal(g.fineTuneOffsets[1], -3.5);
});
