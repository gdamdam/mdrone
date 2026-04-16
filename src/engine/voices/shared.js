// Shared DSP helpers for the mdrone voice worklet. This module is
// concatenated into `src/engine/droneVoiceProcessor.js` by
// `scripts/build-worklet.mjs` during the `prebuild` step. AudioWorklet
// does not yet universally support ES module imports, so we stage the
// split via physical file separation + build-time concatenation; the
// runtime worklet stays a single JS file the way Vite's `?url` loader
// expects.
//
// Runtime globals (sampleRate, AudioWorkletProcessor, registerProcessor,
// currentTime) are provided by AudioWorkletGlobalScope; they are used
// here purely for reference and are not redeclared.

/* global sampleRate */

// ─── Mulberry32 PRNG — seeded, deterministic, cheap ──────────────────
function makeRng(seed) {
  let state = (seed * 2654435761) | 0;
  return () => {
    state = (state + 1831565813) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── Sine wavetable — replaces per-sample Math.sin in hot loops ──
const SINE_TABLE_SIZE = 4096;
const SINE_TABLE = new Float32Array(SINE_TABLE_SIZE + 1); // +1 for lerp guard
for (let i = 0; i <= SINE_TABLE_SIZE; i++) {
  SINE_TABLE[i] = Math.sin((i / SINE_TABLE_SIZE) * Math.PI * 2);
}
const SINE_INC = SINE_TABLE_SIZE / (Math.PI * 2);
function fastSin(phase) {
  const idx = ((phase % 6.283185307179586) + 6.283185307179586) * SINE_INC;
  const i = idx | 0;
  return SINE_TABLE[i % SINE_TABLE_SIZE] + (idx - i) * (SINE_TABLE[(i + 1) % SINE_TABLE_SIZE] - SINE_TABLE[i % SINE_TABLE_SIZE]);
}

// ─── PolyBLEP — bandlimited discontinuity correction ────────────
// Used by the reed "even" (bowed-string) shape to produce a
// sawtooth with natural harmonic content instead of summing sines.
function polyblep(phase01, dt) {
  if (phase01 < dt) {
    const t = phase01 / dt;
    return t + t - t * t - 1;
  }
  if (phase01 > 1 - dt) {
    const t = (phase01 - 1) / dt;
    return t * t + t + t + 1;
  }
  return 0;
}

// ─── 2× polyphase IIR halfband oversampler ──────────────────────
// 4th-order Niemitalo minphase halfband: two parallel branches of
// 2 cascaded 1st-order allpasses each. Stopband ≈ -70 dB, CPU ≈ 8
// multiply-adds per input sample for the full up/down round-trip.
const HB_A0 = 0.07986641281610;
const HB_A1 = 0.54530488711;
const HB_B0 = 0.28393847843;
const HB_B1 = 0.86930964090;

class Halfband2x {
  constructor() {
    this.ua0x = 0; this.ua0y = 0;
    this.ua1x = 0; this.ua1y = 0;
    this.ub0x = 0; this.ub0y = 0;
    this.ub1x = 0; this.ub1y = 0;
    this.da0x = 0; this.da0y = 0;
    this.da1x = 0; this.da1y = 0;
    this.db0x = 0; this.db0y = 0;
    this.db1x = 0; this.db1y = 0;
  }

  process(x, fn) {
    let a = HB_A0 * x + this.ua0x - HB_A0 * this.ua0y;
    this.ua0x = x; this.ua0y = a;
    const aOut = HB_A1 * a + this.ua1x - HB_A1 * this.ua1y;
    this.ua1x = a; this.ua1y = aOut;
    let b = HB_B0 * x + this.ub0x - HB_B0 * this.ub0y;
    this.ub0x = x; this.ub0y = b;
    const bOut = HB_B1 * b + this.ub1x - HB_B1 * this.ub1y;
    this.ub1x = b; this.ub1y = bOut;

    const na = fn(aOut);
    const nb = fn(bOut);

    let da = HB_A0 * na + this.da0x - HB_A0 * this.da0y;
    this.da0x = na; this.da0y = da;
    const daOut = HB_A1 * da + this.da1x - HB_A1 * this.da1y;
    this.da1x = da; this.da1y = daOut;
    let db = HB_B0 * nb + this.db0x - HB_B0 * this.db0y;
    this.db0x = nb; this.db0y = db;
    const dbOut = HB_B1 * db + this.db1x - HB_B1 * this.db1y;
    this.db1x = db; this.db1y = dbOut;
    return 0.5 * (daOut + dbOut);
  }

  reset() {
    this.ua0x = this.ua0y = this.ua1x = this.ua1y = 0;
    this.ub0x = this.ub0y = this.ub1x = this.ub1y = 0;
    this.da0x = this.da0y = this.da1x = this.da1y = 0;
    this.db0x = this.db0y = this.db1x = this.db1y = 0;
  }

  sanitize() {
    const bad = !Number.isFinite(this.ua0y) || !Number.isFinite(this.ua1y)
             || !Number.isFinite(this.ub0y) || !Number.isFinite(this.ub1y)
             || !Number.isFinite(this.da0y) || !Number.isFinite(this.da1y)
             || !Number.isFinite(this.db0y) || !Number.isFinite(this.db1y);
    if (bad) this.reset();
  }
}
