import test from "node:test";
import assert from "node:assert/strict";

import {
  centsToRatio,
  degreeToHz,
  normalizeScaleCents,
  normalizeTuning,
  isValidTuning,
  DEFAULT_PERIOD_CENTS,
} from "../.test-dist/tuning/model.js";

const TWELVE_TET = Array.from({ length: 12 }, (_, i) => i * 100);

test("12-TET degrees reproduce 440·2^((n-69)/12) exactly", () => {
  const tuning = { tonicHz: 440, scaleCents: TWELVE_TET, period: 1200, name: "12-TET" };
  for (let m = -24; m <= 24; m++) {
    const idx = ((m % 12) + 12) % 12;
    const oct = Math.floor(m / 12);
    const expected = 440 * Math.pow(2, m / 12);
    assert.ok(
      Math.abs(degreeToHz(tuning, idx, oct) - expected) < 1e-9,
      `MIDI offset ${m}`,
    );
  }
});

test("just major third (5/4) is beat-free against the tonic", () => {
  const thirdCents = 1200 * Math.log2(5 / 4); // 386.3137…
  const tuning = { tonicHz: 261.6256, scaleCents: [0, thirdCents], name: "JI M3" };
  const ratio = degreeToHz(tuning, 1, 0) / tuning.tonicHz;
  assert.ok(Math.abs(ratio - 1.25) < 1e-12, `ratio ${ratio}`);
});

test("period ≠ 1200 (Bohlen-Pierce tritave) resolves", () => {
  const tritave = 1200 * Math.log2(3); // 1901.955…
  const tuning = { tonicHz: 220, scaleCents: [0], period: tritave, name: "BP" };
  // one period up == ×3 the tonic
  assert.ok(Math.abs(degreeToHz(tuning, 0, 1) / 220 - 3) < 1e-9);
  // literal BP period value still resolves close to a tritave
  const bp = { tonicHz: 220, scaleCents: [0], period: 1901.955, name: "BP" };
  assert.ok(Math.abs(degreeToHz(bp, 0, 1) / 220 - 3) < 1e-2);
});

test("centsToRatio matches 2^(c/1200)", () => {
  assert.equal(centsToRatio(0), 1);
  assert.ok(Math.abs(centsToRatio(1200) - 2) < 1e-12);
  assert.ok(Math.abs(centsToRatio(700) - Math.pow(2, 700 / 1200)) < 1e-12);
});

test("DEFAULT_PERIOD_CENTS is an octave", () => {
  assert.equal(DEFAULT_PERIOD_CENTS, 1200);
});

test("degreeToHz defaults period to 1200 when omitted", () => {
  const tuning = { tonicHz: 100, scaleCents: [0, 500], name: "no-period" };
  assert.ok(Math.abs(degreeToHz(tuning, 0, 1) / 100 - 2) < 1e-9);
});

test("normalizeScaleCents shifts so [0] === 0", () => {
  assert.deepEqual(normalizeScaleCents([50, 150, 250]), [0, 100, 200]);
  assert.deepEqual(normalizeScaleCents([0, 100, 200]), [0, 100, 200]);
});

test("non-ascending scaleCents is rejected", () => {
  assert.throws(() => normalizeScaleCents([0, 200, 100]));
  assert.throws(() => normalizeScaleCents([]));
  assert.throws(() => normalizeScaleCents([0, 100, Number.NaN]));
});

test("normalizeTuning normalizes cents and defaults period", () => {
  const t = normalizeTuning({ tonicHz: 440, scaleCents: [10, 110, 210], name: "x" });
  assert.deepEqual(t.scaleCents, [0, 100, 200]);
  assert.equal(t.period, 1200);
});

test("isValidTuning rejects [0] !== 0 and non-ascending", () => {
  assert.equal(isValidTuning({ tonicHz: 440, scaleCents: [0, 100], name: "ok" }), true);
  assert.equal(isValidTuning({ tonicHz: 440, scaleCents: [5, 100], name: "bad" }), false);
  assert.equal(isValidTuning({ tonicHz: 440, scaleCents: [0, 100, 90], name: "bad" }), false);
  assert.equal(isValidTuning({ tonicHz: 0, scaleCents: [0, 100], name: "bad" }), false);
});

test("degreeToHz throws on out-of-range degreeIndex", () => {
  const tuning = { tonicHz: 440, scaleCents: [0, 100], name: "x" };
  assert.throws(() => degreeToHz(tuning, 2, 0));
  assert.throws(() => degreeToHz(tuning, -1, 0));
});
