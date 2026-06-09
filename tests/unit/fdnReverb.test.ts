/**
 * FDN reverb (fx-fdn-reverb) — DSP behaviour tests for the true 8×8
 * Jot FDN that replaced the Freeverb-style comb bank (Tier-4 item E1).
 *
 * Harness mirrors fxWorkletLifecycle.test.ts: the worklet script is a
 * plain script (no imports/exports), so we evaluate it with stubbed
 * worklet globals and drive the registered class directly.
 *
 * Covered:
 *   1. impulse-response decay tracks the requested T60 (2 s and 15 s)
 *   2. stability — no NaN/Inf, bounded output after 30 s at T60 = 15 s
 *   3. determinism — same seed → bit-identical output
 *   4. different seeds → different outputs
 *   5. stop lifecycle — process() returns false after {type:"stop"}
 *   6. energy ballpark — wet RMS for a fixed noise burst within ±2 dB
 *      of the OLD Freeverb-style implementation (references measured
 *      from the pre-replacement code; see REF_RMS below)
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/* eslint-disable @typescript-eslint/no-explicit-any */

const SR = 48000;
const BLOCK = 128;

type Registry = Map<string, new (options?: any) => any>;

function loadProcessors(): Registry {
  const registry: Registry = new Map();
  class FakeAudioWorkletProcessor {
    port: { onmessage: ((e: any) => void) | null; postMessage: (m: any) => void; posted: any[] };
    constructor() {
      const posted: any[] = [];
      this.port = { onmessage: null, posted, postMessage: (m: any) => { posted.push(m); } };
    }
  }
  const src = readFileSync(
    path.resolve(__dirname, "../../src/engine/fxChainProcessor.js"),
    "utf8",
  );
  const evalScript = new Function("AudioWorkletProcessor", "registerProcessor", "sampleRate", src);
  evalScript(
    FakeAudioWorkletProcessor,
    (name: string, cls: any) => { registry.set(name, cls); },
    SR,
  );
  return registry;
}

function makeFdn(seed: number): any {
  const Fdn = loadProcessors().get("fx-fdn-reverb")!;
  return new Fdn({ processorOptions: { seed } });
}

const params = (size: number, damping: number, decay: number) => ({
  size: Float32Array.of(size),
  damping: Float32Array.of(damping),
  decay: Float32Array.of(decay),
  mix: Float32Array.of(1),
});

/** Render `blocks` blocks; input per-block via `fill` (default silence).
 *  Returns concatenated stereo output. */
function render(
  p: any,
  pp: any,
  blocks: number,
  fill?: (inL: Float32Array, inR: Float32Array, block: number) => void,
): { L: Float32Array; R: Float32Array } {
  const L = new Float32Array(blocks * BLOCK);
  const R = new Float32Array(blocks * BLOCK);
  for (let b = 0; b < blocks; b++) {
    const inL = new Float32Array(BLOCK);
    const inR = new Float32Array(BLOCK);
    fill?.(inL, inR, b);
    const outL = new Float32Array(BLOCK);
    const outR = new Float32Array(BLOCK);
    p.process([[inL, inR]], [[outL, outR]], pp);
    L.set(outL, b * BLOCK);
    R.set(outR, b * BLOCK);
  }
  return { L, R };
}

// Deterministic mulberry32 noise (same generator family as the worklet)
function makeNoise(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1);
  };
}

function windowEnergyDb(x: Float32Array, startSec: number, lenSec: number): number {
  const start = Math.round(startSec * SR);
  const len = Math.round(lenSec * SR);
  let s = 0;
  for (let i = start; i < start + len; i++) s += x[i] * x[i];
  return 10 * Math.log10(s / len + 1e-30);
}

/** Invert the processor's documented T60 mapping
 *    T60 = 3·meanDelaySec / −log10(decay)
 *  using the nominal (un-jittered) mean base length so the test stays
 *  independent of the seed (per-line jitter is ±3 %, mean ≪ that). */
const NOMINAL_BASE_MS = [25.3, 29.7, 35.1, 39.8, 46.9, 54.1, 63.7, 74.3];
const NOMINAL_MEAN_SAMPLES =
  NOMINAL_BASE_MS.reduce((s, ms) => s + Math.round(ms * 0.001 * SR), 0) / NOMINAL_BASE_MS.length;
function decayForT60(t60: number, size: number): number {
  const meanDelaySec = (NOMINAL_MEAN_SAMPLES * (0.3 + size)) / SR;
  return Math.pow(10, (-3 * meanDelaySec) / t60);
}

const impulseFill = (inL: Float32Array, inR: Float32Array, b: number) => {
  if (b === 0) { inL[0] = 1; inR[0] = 1; }
};

// ───────────────────────────────────────────────────────────────────────────

describe("fx-fdn-reverb impulse-response decay", () => {
  // damping=0 for both: the one-pole damping LP steepens broadband
  // energy decay beyond the per-line gains, which is exactly what we
  // don't want to fold into a T60-accuracy measurement.

  it("tracks T60 = 2 s within 20 %", () => {
    const t60 = 2;
    const decay = decayForT60(t60, 0.45);
    const { L } = render(makeFdn(1234), params(0.45, 0, decay), Math.round((SR * 3) / BLOCK), impulseFill);
    const e1 = windowEnergyDb(L, 0.5, 0.25);
    const e2 = windowEnergyDb(L, 1.5, 0.25);
    const t60Est = (60 * (1.5 - 0.5)) / (e1 - e2);
    expect(t60Est).toBeGreaterThan(t60 * 0.8);
    expect(t60Est).toBeLessThan(t60 * 1.2);
  });

  it("tracks T60 = 15 s within 20 %", () => {
    const t60 = 15;
    const decay = decayForT60(t60, 1.2);
    expect(decay).toBeLessThanOrEqual(0.98); // stays inside the param range
    const { L } = render(makeFdn(1234), params(1.2, 0, decay), Math.round((SR * 6) / BLOCK), impulseFill);
    const e1 = windowEnergyDb(L, 1.0, 0.5);
    const e2 = windowEnergyDb(L, 5.0, 0.5);
    const t60Est = (60 * (5.0 - 1.0)) / (e1 - e2);
    expect(t60Est).toBeGreaterThan(t60 * 0.8);
    expect(t60Est).toBeLessThan(t60 * 1.2);
  });
});

describe("fx-fdn-reverb stability", () => {
  it("stays finite and bounded after 30 s at T60 = 15 s", () => {
    const decay = decayForT60(15, 1.2);
    const p = makeFdn(0xC157);
    const pp = params(1.2, 0.3, decay);
    const noise = makeNoise(0xbeef);
    const burstBlocks = Math.round((SR * 0.5) / BLOCK);
    const totalBlocks = Math.round((SR * 30) / BLOCK);
    let peak = 0;
    let finite = true;
    for (let b = 0; b < totalBlocks; b++) {
      const inL = new Float32Array(BLOCK);
      const inR = new Float32Array(BLOCK);
      if (b < burstBlocks) {
        for (let i = 0; i < BLOCK; i++) { const v = noise() * 0.5; inL[i] = v; inR[i] = v; }
      }
      const outL = new Float32Array(BLOCK);
      const outR = new Float32Array(BLOCK);
      p.process([[inL, inR]], [[outL, outR]], pp);
      for (let i = 0; i < BLOCK; i++) {
        if (!Number.isFinite(outL[i]) || !Number.isFinite(outR[i])) { finite = false; break; }
        const m = Math.max(Math.abs(outL[i]), Math.abs(outR[i]));
        if (m > peak) peak = m;
      }
      if (!finite) break;
    }
    expect(finite).toBe(true);
    // Householder matrix is energy-preserving and per-line gains < 1,
    // so the tank can't blow up — peak stays in normal signal range.
    expect(peak).toBeLessThan(4);
  });
});

describe("fx-fdn-reverb determinism", () => {
  const SEED = 777;
  const BLOCKS = 60;

  it("same seed → identical output", () => {
    const a = render(makeFdn(SEED), params(0.45, 0.55, 0.84), BLOCKS, impulseFill);
    const b = render(makeFdn(SEED), params(0.45, 0.55, 0.84), BLOCKS, impulseFill);
    expect(a.L).toEqual(b.L);
    expect(a.R).toEqual(b.R);
  });

  it("different seeds → different output", () => {
    const a = render(makeFdn(SEED), params(0.45, 0.55, 0.84), BLOCKS, impulseFill);
    const b = render(makeFdn(SEED + 1), params(0.45, 0.55, 0.84), BLOCKS, impulseFill);
    let diff = 0;
    for (let i = 0; i < a.L.length; i++) diff += Math.abs(a.L[i] - b.L[i]);
    expect(diff).toBeGreaterThan(1e-3);
  });
});

describe("fx-fdn-reverb stop lifecycle", () => {
  it("process() returns false after {type:'stop'}", () => {
    const p = makeFdn(1234);
    const pp = params(0.5, 0.5, 0.84);
    const io = () => [[new Float32Array(BLOCK), new Float32Array(BLOCK)]];
    expect(p.process(io(), io(), pp)).toBe(true);
    p.port.onmessage!({ data: { type: "stop" } });
    expect(p.process(io(), io(), pp)).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Energy ballpark vs the OLD implementation. References measured from
// the pre-E1 Freeverb-style processor (HEAD at 80a1867) with this
// exact stimulus: mulberry32(0xBEEF) noise at ±0.5 into both channels
// for 1 s, then 2 s of silence; RMS over the full 3 s of both output
// channels at 48 kHz, seed 1234:
//   hall    (size=0.45 damping=0.55 decay=0.84): RMS = 5.574935e-2 (−25.08 dBFS)
//   cistern (size=1.20 damping=0.70 decay=0.94): RMS = 5.742286e-2 (−24.82 dBFS)
// The FxChain wet trims were listening-audited against those levels,
// so the FDN must land within ±2 dB of them (calibrated via IN_GAIN /
// OUT_GAIN inside the processor, NOT by touching FxChain trims).
const REF_RMS = { hall: 5.574935e-2, cistern: 5.742286e-2 };

function noiseBurstRms(p: any, pp: any): number {
  const noise = makeNoise(0xbeef);
  const burstBlocks = Math.round(SR / BLOCK);       // 1 s burst
  const totalBlocks = Math.round((SR * 3) / BLOCK); // + 2 s tail
  const { L, R } = render(p, pp, totalBlocks, (inL, inR, b) => {
    if (b >= burstBlocks) return;
    for (let i = 0; i < BLOCK; i++) {
      const v = noise() * 0.5;
      inL[i] = v;
      inR[i] = v;
    }
  });
  let s = 0;
  for (let i = 0; i < L.length; i++) s += L[i] * L[i] + R[i] * R[i];
  return Math.sqrt(s / (2 * L.length));
}

describe("fx-fdn-reverb energy ballpark vs old implementation", () => {
  it("hall preset wet RMS within ±2 dB of the comb-bank reference", () => {
    const rms = noiseBurstRms(makeFdn(1234), params(0.45, 0.55, 0.84));
    const dB = 20 * Math.log10(rms / REF_RMS.hall);
    expect(Math.abs(dB)).toBeLessThan(2);
  });

  it("cistern preset wet RMS within ±2 dB of the comb-bank reference", () => {
    const rms = noiseBurstRms(makeFdn(1234), params(1.2, 0.7, 0.94));
    const dB = 20 * Math.log10(rms / REF_RMS.cistern);
    expect(Math.abs(dB)).toBeLessThan(2);
  });
});
