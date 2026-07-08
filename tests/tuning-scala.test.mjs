import test from "node:test";
import assert from "node:assert/strict";

import {
  parseScl,
  formatScl,
  parseKbm,
  formatKbm,
  portableToScl,
} from "../.test-dist/tuning/scala.js";

// ── .scl fixtures ────────────────────────────────────────────────────

const SCL_12TET = `! 12tet.scl
!
12-tone equal temperament
 12
!
 100.0
 200.0
 300.0
 400.0
 500.0
 600.0
 700.0
 800.0
 900.0
 1000.0
 1100.0
 2/1
`;

const SCL_JUST5 = `! just.scl
5-limit just major
 7
 9/8
 5/4
 4/3
 3/2
 5/3
 15/8
 2/1
`;

const SCL_BP = `! bp.scl
Bohlen-Pierce (non-octave)
 3
 435.084
 884.359
 3/1
`;

test("parseScl reads a 12-TET .scl: [0]=0, ascending, octave period", () => {
  const scl = parseScl(SCL_12TET);
  assert.equal(scl.name, "12-tone equal temperament");
  assert.equal(scl.period, 1200);
  assert.equal(scl.cents.length, 12);
  assert.equal(scl.cents[0], 0);
  assert.ok(Math.abs(scl.cents[7] - 700) < 1e-9);
});

test("parseScl converts ratio lines to cents (5-limit just)", () => {
  const scl = parseScl(SCL_JUST5);
  assert.equal(scl.name, "5-limit just major");
  assert.ok(Math.abs(scl.period - 1200) < 1e-9); // 2/1
  assert.ok(Math.abs(scl.cents[1] - 1200 * Math.log2(9 / 8)) < 1e-9);
  assert.ok(Math.abs(scl.cents[2] - 1200 * Math.log2(5 / 4)) < 1e-9);
  assert.ok(Math.abs(scl.cents[3] - 1200 * Math.log2(4 / 3)) < 1e-9);
});

test("parseScl handles a non-octave scale", () => {
  const scl = parseScl(SCL_BP);
  assert.ok(Math.abs(scl.period - 1200 * Math.log2(3)) < 1e-9);
  assert.equal(scl.cents.length, 3);
  assert.equal(scl.cents[0], 0);
});

test("round-trip parse → format → parse is stable (12-TET)", () => {
  const a = parseScl(SCL_12TET);
  const b = parseScl(formatScl(a));
  assert.equal(b.cents.length, a.cents.length);
  assert.ok(Math.abs(b.period - a.period) < 1e-6);
  for (let i = 0; i < a.cents.length; i++) {
    assert.ok(Math.abs(b.cents[i] - a.cents[i]) < 1e-6);
  }
});

test("round-trip parse → format → parse is stable (non-octave)", () => {
  const a = parseScl(SCL_BP);
  const b = parseScl(formatScl(a));
  assert.ok(Math.abs(b.period - a.period) < 1e-6);
  assert.equal(b.cents.length, a.cents.length);
});

test("parseScl rejects a malformed count", () => {
  assert.throws(() => parseScl("desc\n notanumber\n 100.0\n"));
});

test("portableToScl produces a formattable descriptor", () => {
  const scl = portableToScl({ tonicHz: 440, scaleCents: [0, 700], period: 1200, name: "fifth" });
  assert.equal(scl.name, "fifth");
  assert.equal(scl.cents[0], 0);
  const round = parseScl(formatScl(scl));
  assert.ok(Math.abs(round.period - 1200) < 1e-6);
});

// ── .kbm fixtures ────────────────────────────────────────────────────

// A 12-note linear map referenced at A4 = 440 Hz (non-C reference).
const KBM_A440 = `! a440.kbm
! map size
12
! first / last MIDI note
0
127
! middle note (degree 0)
60
! reference note
69
! reference frequency
440.0
! formal octave (scale degrees per period)
12
! mapping
0
1
2
3
4
5
6
7
8
9
10
11
`;

test("parseKbm reads a non-C reference map", () => {
  const kbm = parseKbm(KBM_A440);
  assert.equal(kbm.mapSize, 12);
  assert.equal(kbm.first, 0);
  assert.equal(kbm.last, 127);
  assert.equal(kbm.middle, 60);
  assert.equal(kbm.refNote, 69);
  assert.ok(Math.abs(kbm.refFreq - 440) < 1e-9);
  assert.deepEqual(kbm.degrees, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
});

test("parseKbm handles unmapped 'x' entries", () => {
  const kbm = parseKbm("2\n0\n127\n60\n69\n440.0\n2\n0\nx\n");
  assert.equal(kbm.mapSize, 2);
  assert.equal(kbm.degrees[0], 0);
  assert.ok(kbm.degrees[1] < 0); // unmapped sentinel
});

test("round-trip parse → format → parse is stable (.kbm)", () => {
  const a = parseKbm(KBM_A440);
  const b = parseKbm(formatKbm(a));
  assert.deepEqual(b, a);
});
