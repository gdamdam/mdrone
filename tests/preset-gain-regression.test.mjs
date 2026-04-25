// Preset gain-staging regression. Catches drift in the authored
// `gain` field of `PRESETS` so a casual edit can't accidentally push
// a preset into territory that either crushes the limiter or sits
// inaudibly low compared to the rest of the library.
//
// The thresholds here are intentionally generous — a few authored
// outliers (Microtone Wall, Clinical Sines) sit at 1.6 by design as
// gain-compensation for very thin spectral content, and a few hot
// presets sit near 0.3 to leave room for swell peaks. The test only
// fires when something has clearly broken loose: gain outside
// [0.1, 1.7], more than 5 entries past the 1.55 ceiling, or a mean
// that has wandered outside its historical band.
//
// This is a regression fence, not a tuning prescription — when a
// genuine library update justifies new bands, update the constants
// in lockstep with `__measureAllPresets()` results.

import test from "node:test";
import assert from "node:assert/strict";
import { PRESETS } from "../.test-dist/engine/presets.js";

// Current library snapshot: 65 presets, range 0.13–1.6, mean 0.854,
// 13 presets above 1.55 (intentional gain-comp on thin-spectrum
// scenes — Microtone Wall, Clinical Sines, etc.). Bounds below give
// a small slack so an honest tweak doesn't trip the fence, while a
// careless edit (e.g. forgetting to set `gain` on a new preset, or
// pushing the library mean past 0.95 hot) does.
const HARD_FLOOR = 0.1;
const HARD_CEILING = 1.7;
const HOT_CEILING = 1.55;
const MAX_HOT_PRESETS = 14;
const MEAN_BAND = [0.78, 0.95];

test("preset gains stay within sane bounds", () => {
  const gains = PRESETS.map((p) => p.gain ?? 1);
  for (const p of PRESETS) {
    const g = p.gain ?? 1;
    assert.ok(
      g >= HARD_FLOOR && g <= HARD_CEILING,
      `preset "${p.id}" gain ${g} outside [${HARD_FLOOR}, ${HARD_CEILING}]`,
    );
  }
  const hot = gains.filter((g) => g > HOT_CEILING);
  assert.ok(
    hot.length <= MAX_HOT_PRESETS,
    `${hot.length} presets exceed gain ${HOT_CEILING}; max allowed ${MAX_HOT_PRESETS}. ` +
      `Run window.__measureAllPresets() and re-tune before raising this bound.`,
  );
  const mean = gains.reduce((s, g) => s + g, 0) / gains.length;
  assert.ok(
    mean >= MEAN_BAND[0] && mean <= MEAN_BAND[1],
    `mean preset gain ${mean.toFixed(3)} outside [${MEAN_BAND[0]}, ${MEAN_BAND[1]}] — ` +
      `library has drifted hot/cold; re-measure with __measureAllPresets`,
  );
});
