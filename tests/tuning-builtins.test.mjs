import test from "node:test";
import assert from "node:assert/strict";

import {
  tuningTableToPortable,
  sclToTuningTableDegrees,
  BUILTIN_PORTABLE_TUNINGS,
  AUTHORED_PORTABLE_TUNINGS,
  DEFAULT_TONIC_HZ,
} from "../.test-dist/tuning/builtins.js";
import { parseScl } from "../.test-dist/tuning/scala.js";
import { BUILTIN_TUNINGS, AUTHORED_TUNINGS } from "../.test-dist/microtuning.js";
import { degreeToHz, isValidTuning } from "../.test-dist/tuning/model.js";

test("tuningTableToPortable maps a 13-slot octave table to a 12-note PortableTuning", () => {
  const equal = {
    id: "equal",
    label: "Equal (12-TET)",
    degrees: [0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200],
  };
  const p = tuningTableToPortable(equal);
  assert.equal(p.scaleCents.length, 12);
  assert.equal(p.scaleCents[0], 0);
  assert.equal(p.period, 1200);
  assert.equal(p.name, "Equal (12-TET)");
  assert.ok(isValidTuning(p));
});

test("tuningTableToPortable carries a non-octave period from slot 12", () => {
  const t = {
    id: "custom:x",
    label: "weird",
    degrees: [0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 900],
  };
  const p = tuningTableToPortable(t);
  assert.equal(p.period, 900);
});

test("tuningTableToPortable accepts an explicit tonicHz", () => {
  const equal = {
    label: "e",
    degrees: [0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200],
  };
  const p = tuningTableToPortable(equal, 440);
  assert.equal(p.tonicHz, 440);
});

test("all BUILTIN_PORTABLE_TUNINGS are valid canonical tunings", () => {
  assert.ok(BUILTIN_PORTABLE_TUNINGS.length > 0);
  for (const p of BUILTIN_PORTABLE_TUNINGS) {
    assert.ok(isValidTuning(p), `${p.name} invalid`);
    assert.equal(p.scaleCents[0], 0);
  }
});

test("builtin equal tuning resolves a beat-free octave", () => {
  const equal = BUILTIN_PORTABLE_TUNINGS.find((p) => /equal/i.test(p.name));
  assert.ok(equal);
  assert.ok(Math.abs(degreeToHz(equal, 0, 1) / equal.tonicHz - 2) < 1e-9);
});

test("DEFAULT_TONIC_HZ is C4 (~261.63 Hz)", () => {
  assert.ok(Math.abs(DEFAULT_TONIC_HZ - 261.6256) < 1e-2);
});

test("sclToTuningTableDegrees maps a 12-note octave .scl losslessly", () => {
  const scl = parseScl("12tet\n 12\n 100.\n 200.\n 300.\n 400.\n 500.\n 600.\n 700.\n 800.\n 900.\n 1000.\n 1100.\n 2/1\n");
  const { degrees, lossy } = sclToTuningTableDegrees(scl);
  assert.equal(degrees.length, 13);
  assert.equal(degrees[0], 0);
  assert.equal(degrees[12], 1200);
  assert.equal(lossy, false);
});

test("sclToTuningTableDegrees flags a non-octave .scl as lossy", () => {
  const scl = parseScl("bp\n 3\n 435.084\n 884.359\n 3/1\n");
  const { degrees, lossy } = sclToTuningTableDegrees(scl);
  assert.equal(degrees.length, 13);
  assert.equal(lossy, true);
});

// ── Drift guard ──────────────────────────────────────────────────────
// builtins.ts now inlines its own copy of the library so it can be
// vendored without importing microtuning.ts. These tests fail if the
// two builtin sets ever diverge (name / cents / period), so the inlined
// vendor copy can't silently drift from mdrone's authoritative tables.

function assertAgree(portable, tables) {
  assert.equal(portable.length, tables.length);
  for (let i = 0; i < tables.length; i++) {
    const p = portable[i];
    const t = tables[i];
    assert.equal(p.name, t.label, `name at ${i}`);
    assert.equal(p.period, t.degrees[12], `period at ${i} (${t.label})`);
    assert.deepEqual(p.scaleCents, t.degrees.slice(0, 12), `cents at ${i} (${t.label})`);
  }
}

test("BUILTIN_PORTABLE_TUNINGS agree cents-for-cents with microtuning BUILTIN_TUNINGS", () => {
  assertAgree(BUILTIN_PORTABLE_TUNINGS, BUILTIN_TUNINGS);
});

test("AUTHORED_PORTABLE_TUNINGS agree cents-for-cents with microtuning AUTHORED_TUNINGS", () => {
  assertAgree(AUTHORED_PORTABLE_TUNINGS, AUTHORED_TUNINGS);
});
