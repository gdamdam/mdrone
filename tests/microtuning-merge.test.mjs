import test from "node:test";
import assert from "node:assert/strict";

import {
  mergePlayedIntervals,
  MAX_PLAYED_NOTES,
} from "../.test-dist/microtuning.js";

// mergePlayedIntervals dedupes played cents "within 1¢" of retained
// values. The original implementation bucketed on Math.round(cents),
// which split same-pitch pairs across a rounding boundary (0.4 vs 0.6
// rounded to different buckets) and never actually measured distance.
// These tests pin the true ±1¢ window from both sides.

test("dedupes a played cent within 1¢ below a base value (across the round boundary)", () => {
  // round(699.4) = 699 ≠ 700 — the bucket version appended this duplicate.
  assert.deepEqual(mergePlayedIntervals([0, 700], [699.4]), [0, 700]);
});

test("dedupes a played cent within 1¢ above a base value (across the round boundary)", () => {
  // round(700.6) = 701 ≠ 700 — the bucket version appended this duplicate.
  assert.deepEqual(mergePlayedIntervals([0, 700], [700.6]), [0, 700]);
});

test("keeps a played cent exactly 1¢ away (window is strict < 1)", () => {
  assert.deepEqual(mergePlayedIntervals([0, 700], [701]), [0, 700, 701]);
});

test("keeps a played cent just outside the window", () => {
  assert.deepEqual(mergePlayedIntervals([0, 700], [701.2]), [0, 700, 701.2]);
});

test("dedupes played cents against earlier retained additions, both sides", () => {
  // Sorted ascending, 399.5 is kept first; 400.0 (+0.5) and 400.4 (+0.9)
  // fall inside its window; 400.6 is within 1¢ of 400.0/400.4 but those
  // were *dropped* — it is 1.1¢ from the retained 399.5, so it stays.
  assert.deepEqual(
    mergePlayedIntervals([0], [400.0, 399.5, 400.4, 400.6]),
    [0, 399.5, 400.6],
  );
});

test("cap on additions counts retained values only, not dropped duplicates", () => {
  const played = [100, 100.4, 200, 300, 400, 500, 600, 700, 800];
  const merged = mergePlayedIntervals([0], played);
  assert.equal(merged.length, 1 + MAX_PLAYED_NOTES);
  assert.deepEqual(merged, [0, 100, 200, 300, 400, 500, 600]);
});
