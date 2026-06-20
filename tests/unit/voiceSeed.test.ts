/**
 * #4 — shared-scene determinism for per-voice BUILD randomness.
 *   buildVoice drew the worklet RNG seed and the drift-LFO rate from raw
 *   Math.random, so a shared scene reproduced the macro arc (already
 *   seeded) but a different per-voice micro-timbre/phase every load.
 *   deriveVoiceSeed(sceneSeed, type, index) threads the scene's stored
 *   seed into buildVoice so those draws reproduce across loads, while
 *   sceneSeed === 0 ("no explicit seed") keeps Math.random for naturally
 *   varied ad-hoc playback.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { buildVoice, deriveVoiceSeed } from "../../src/engine/VoiceBuilder";

/* eslint-disable @typescript-eslint/no-explicit-any */

describe("deriveVoiceSeed (pure)", () => {
  it("is deterministic for the same scene seed + type + index", () => {
    expect(deriveVoiceSeed(123456, "reed", 0)).toBe(deriveVoiceSeed(123456, "reed", 0));
    expect(deriveVoiceSeed(123456, "tanpura", 3)).toBe(deriveVoiceSeed(123456, "tanpura", 3));
  });

  it("returns undefined when the scene has no explicit seed (0)", () => {
    expect(deriveVoiceSeed(0, "reed", 0)).toBeUndefined();
    expect(deriveVoiceSeed(0, "metal", 2)).toBeUndefined();
  });

  it("decorrelates by stack index", () => {
    expect(deriveVoiceSeed(123456, "reed", 0)).not.toBe(deriveVoiceSeed(123456, "reed", 1));
  });

  it("decorrelates by voice type — including the air/amp same-first-letter pair", () => {
    // A charCodeAt(0)-only scheme would collide air↔amp (both 'a'); the
    // full-name hash must keep them distinct so two active layers at the
    // same index don't share an RNG stream.
    expect(deriveVoiceSeed(123456, "air", 0)).not.toBe(deriveVoiceSeed(123456, "amp", 0));
    expect(deriveVoiceSeed(123456, "reed", 0)).not.toBe(deriveVoiceSeed(123456, "metal", 0));
  });

  it("returns a positive 32-bit integer (valid mulberry32 seed)", () => {
    const s = deriveVoiceSeed(123456, "piano", 1)!;
    expect(Number.isInteger(s)).toBe(true);
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThanOrEqual(0xffffffff);
  });
});

// ── buildVoice: seeded vs random draw ────────────────────────────────

function makeParam(value = 0) {
  return {
    value,
    setValueAtTime() {},
    setTargetAtTime() {},
    linearRampToValueAtTime() {},
    exponentialRampToValueAtTime() {},
    cancelScheduledValues() {},
  };
}

/** Build one voice against a minimal Web Audio mock and capture the two
 *  build-time random draws: the worklet RNG `seed` (processorOptions) and
 *  the drift-LFO rate (the pitch LFO oscillator's frequency). */
function runBuildVoice(seed?: number): { workletSeed: number; lfoHz: number } {
  const captured: any = {};
  let lastOsc: any;
  class FakeWorkletNode {
    parameters = new Map<string, any>([
      ["freq", makeParam()],
      ["drift", makeParam()],
      ["amp", makeParam()],
      ["pluckRate", makeParam()],
      ["color", makeParam()],
    ]);
    port: any = { onmessage: null, postMessage() {} };
    constructor(_ctx: any, _name: string, opts: any) {
      captured.processorOptions = opts.processorOptions;
    }
    connect(d: any) { return d; }
    disconnect() {}
  }
  vi.stubGlobal("AudioWorkletNode", FakeWorkletNode);
  const ctx: any = {
    currentTime: 0,
    createOscillator: () =>
      (lastOsc = {
        type: "",
        frequency: { value: 0 },
        detune: { value: 0 },
        connect: (d: any) => d,
        start() {},
        stop() {},
        disconnect() {},
      }),
    createGain: () => ({
      gain: {
        value: 0,
        setValueAtTime() {},
        setTargetAtTime() {},
        cancelScheduledValues() {},
        linearRampToValueAtTime() {},
      },
      connect: (d: any) => d,
      disconnect() {},
    }),
    createStereoPanner: () => ({ pan: { value: 0 }, connect: (d: any) => d, disconnect() {} }),
  };
  buildVoice("reed", ctx, {} as any, 110, 0, 0.5, 0, "odd", 2, 2.4, 0, "classic", 0, seed);
  return { workletSeed: captured.processorOptions.seed, lfoHz: lastOsc.frequency.value };
}

describe("buildVoice — seeded build randomness", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("same seed → identical worklet seed AND drift-LFO rate", () => {
    const a = runBuildVoice(42);
    const b = runBuildVoice(42);
    expect(b.workletSeed).toBe(a.workletSeed);
    expect(b.lfoHz).toBe(a.lfoHz);
  });

  it("different seed → different worklet seed and rate", () => {
    const a = runBuildVoice(42);
    const c = runBuildVoice(43);
    expect(c.workletSeed).not.toBe(a.workletSeed);
    expect(c.lfoHz).not.toBe(a.lfoHz);
  });

  it("seeded worklet seed is a valid positive integer in range", () => {
    const { workletSeed } = runBuildVoice(42);
    expect(Number.isInteger(workletSeed)).toBe(true);
    expect(workletSeed).toBeGreaterThanOrEqual(1);
    expect(workletSeed).toBeLessThan(0x80000000);
  });

  it("drift-LFO rate stays in the documented 0.05–0.30 Hz band", () => {
    const { lfoHz } = runBuildVoice(42);
    expect(lfoHz).toBeGreaterThanOrEqual(0.05);
    expect(lfoHz).toBeLessThanOrEqual(0.30);
  });

  it("omitting the seed falls back to Math.random", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const { workletSeed, lfoHz } = runBuildVoice(undefined);
    expect(workletSeed).toBe(Math.floor(0.5 * 0x7fffffff) + 1);
    expect(lfoHz).toBeCloseTo(0.05 + 0.5 * 0.25, 10);
  });
});
