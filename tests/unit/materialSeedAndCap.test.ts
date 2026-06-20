/**
 * P1 — shared-scene determinism for per-voice material motion.
 *   The evolve walk is already seeded via MotionEngine.setEvolveSeed, but
 *   VoiceEngine's material motion (per-voice phase offsets + per-tick
 *   nudge) drew from raw Math.random, so the same shared scene reproduced
 *   macro drift while subtle layer gain/drift motion differed per load.
 *   VoiceEngine.setMaterialSeed(seed) must make that motion reproducible.
 *
 * P2 — voice-cap visibility.
 *   Low-core devices cap active voices; the UI showed intended voices as
 *   "currently sounding" regardless. VoiceEngine.getSuppressedVoices()
 *   reports intended voices the active cap is silencing so the UI can show
 *   an "intended but capped" cue (mirrors FX suppressed-by-protection).
 */
import { describe, it, expect } from "vitest";
import { VoiceEngine } from "../../src/engine/VoiceEngine";
import { ALL_VOICE_TYPES, type VoiceType } from "../../src/engine/VoiceBuilder";

/* eslint-disable @typescript-eslint/no-explicit-any */

function makeParam() {
  return {
    value: 0,
    setValueAtTime: () => {},
    setTargetAtTime: () => {},
    linearRampToValueAtTime: () => {},
    exponentialRampToValueAtTime: () => {},
    cancelScheduledValues: () => {},
  };
}
function makeGain() {
  return { gain: makeParam(), connect: () => {}, disconnect: () => {} };
}
function makeBiquad() {
  return { type: "", frequency: makeParam(), Q: makeParam(), connect: () => {}, disconnect: () => {} };
}
function makeCtx() {
  return {
    currentTime: 0,
    createGain: () => makeGain(),
    createBiquadFilter: () => makeBiquad(),
    createAnalyser: () => ({ fftSize: 0, connect: () => {}, disconnect: () => {} }),
    close: () => Promise.resolve(),
  };
}
function makeEngine(): VoiceEngine {
  return new VoiceEngine(makeCtx() as any, {} as any, makeGain() as any);
}

describe("VoiceEngine.setMaterialSeed (P1 — shared-scene determinism)", () => {
  it("same seed → identical material phase offsets across instances", () => {
    const a = makeEngine();
    const b = makeEngine();
    a.setMaterialSeed(123456);
    b.setMaterialSeed(123456);
    expect((a as any).materialPhaseOffsets).toEqual((b as any).materialPhaseOffsets);
  });

  it("different seeds → different phase offsets", () => {
    const a = makeEngine();
    const b = makeEngine();
    a.setMaterialSeed(1);
    b.setMaterialSeed(2);
    expect((a as any).materialPhaseOffsets).not.toEqual((b as any).materialPhaseOffsets);
  });

  it("seeds the per-tick nudge RNG too (post-seed draw streams match)", () => {
    const a = makeEngine();
    const b = makeEngine();
    a.setMaterialSeed(777);
    b.setMaterialSeed(777);
    const drawsA = [(a as any).materialRng(), (a as any).materialRng(), (a as any).materialRng()];
    const drawsB = [(b as any).materialRng(), (b as any).materialRng(), (b as any).materialRng()];
    expect(drawsA).toEqual(drawsB);
  });

  it("phase offsets cover all voice types and stay in [0, 2π)", () => {
    const a = makeEngine();
    a.setMaterialSeed(42);
    const offs = (a as any).materialPhaseOffsets as Record<VoiceType, number>;
    for (const t of ALL_VOICE_TYPES) {
      expect(typeof offs[t]).toBe("number");
      expect(offs[t]).toBeGreaterThanOrEqual(0);
      expect(offs[t]).toBeLessThan(Math.PI * 2);
    }
  });
});

describe("VoiceEngine.getSuppressedVoices (P2 — voice-cap cue)", () => {
  function withLayers(ve: VoiceEngine, on: VoiceType[], cap: number) {
    const layers: Record<string, boolean> = {};
    for (const t of ALL_VOICE_TYPES) layers[t] = on.includes(t);
    (ve as any).voiceLayers = layers;
    (ve as any).maxVoiceLayers = cap;
  }

  it("reports nothing when the cap >= intended voice count", () => {
    const ve = makeEngine();
    withLayers(ve, ["tanpura", "reed", "metal", "air"], 4);
    expect(ve.getSuppressedVoices()).toEqual([]);
  });

  it("suppresses (intended - cap) voices when over the cap", () => {
    const ve = makeEngine();
    withLayers(ve, ["tanpura", "reed", "metal", "air", "piano"], 2);
    const sup = ve.getSuppressedVoices();
    expect(sup.length).toBe(3);
    for (const t of sup) expect((ve as any).voiceLayers[t]).toBe(true);
  });

  it("only reports intended (enabled) voices as suppressed", () => {
    const ve = makeEngine();
    withLayers(ve, ["tanpura", "reed"], 1);
    const sup = ve.getSuppressedVoices();
    expect(sup.length).toBe(1);
    expect(["tanpura", "reed"]).toContain(sup[0]);
  });
});
