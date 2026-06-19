/**
 * Equal-power crossfades on voice rebuilds (Tier-4 / E5).
 *
 * Repro: rebuildIntervals() used a paired linearRampToValueAtTime for
 * the retiring layer (out) and the incoming layer (in). Two linear
 * ramps sum to constant *amplitude*, but the two layers are
 * UNCORRELATED sources, so their powers add: at the midpoint each is
 * at 0.5 gain → total power 0.25 + 0.25 = 0.5 of target → a −3 dB
 * loudness dip in the middle of every rebuild crossfade.
 *
 * Fix under test: cos/sin quarter-cycle curves via setValueCurveAtTime
 * so g_out² + g_in² stays ≈ constant across the fade.
 *
 * Harness: fake-`this` over VoiceEngine.prototype (same spirit as
 * entrain.test.ts) with fake AudioParams that record scheduled calls
 * (same shape as voiceEngineDispose.test.ts). buildVoice is mocked so
 * no worklet graph is needed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { VoiceEngine } from "../../src/engine/VoiceEngine";

/* eslint-disable @typescript-eslint/no-explicit-any */

vi.mock("../../src/engine/VoiceBuilder", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/engine/VoiceBuilder")>();
  return {
    ...actual,
    buildVoice: vi.fn(() => makeFakeVoice()),
  };
});

function makeFakeVoice() {
  return {
    setPluckRate: vi.fn(),
    setColor: vi.fn(),
    setDrift: vi.fn(),
    setDichoticCents: vi.fn(),
    stop: vi.fn(),
  };
}

function makeParam(value = 0) {
  return {
    value,
    setValueAtTime: vi.fn(),
    setTargetAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
    setValueCurveAtTime: vi.fn(),
    cancelScheduledValues: vi.fn(),
  };
}

function makeGain(value = 0) {
  return { gain: makeParam(value), connect: vi.fn(), disconnect: vi.fn() };
}

function makeBiquad() {
  return { type: "", frequency: makeParam(), Q: makeParam(), connect: vi.fn(), disconnect: vi.fn() };
}

function rec<T>(v: T): Record<string, T> {
  return { tanpura: v, reed: v, metal: v, air: v, piano: v, fm: v, amp: v, noise: v };
}

/** Fake `this` with every field rebuildIntervals() touches.
 *  morphAmount 0 → bloom = MIN_REBUILD_XFADE_SEC = 0.3 s. */
function makeEngine() {
  const created: ReturnType<typeof makeGain>[] = [];
  const ctx = {
    currentTime: 0,
    createGain: vi.fn(() => {
      const g = makeGain();
      created.push(g);
      return g;
    }),
    createAnalyser: vi.fn(() => ({ fftSize: 0, connect: vi.fn(), disconnect: vi.fn() })),
    createBiquadFilter: vi.fn(() => makeBiquad()),
  };
  const ve = Object.assign(Object.create(VoiceEngine.prototype) as VoiceEngine, {
    ctx,
    droneOn: true,
    morphAmount: 0,
    droneIntervalsCents: [0],
    maxVoiceLayers: 8,
    voiceLayers: rec(false),
    layerLevels: rec(1),
    materialLevelOffsets: rec(0),
    materialDriftScales: rec(1),
    materialPluckFactor: 1,
    drift: 0.3,
    tanpuraPluckRate: 1,
    noiseColor: 0.3,
    dichoticCents: 0,
    droneRootFreq: 220,
    reedShape: "odd",
    fmRatio: 2,
    fmIndex: 2.4,
    fmFeedback: 0,
    tanpuraTuning: "classic",
    droneVoicesByLayer: new Map(),
    layerGains: new Map(),
    layerAnalysers: new Map(),
    layerFilters: new Map(),
    layerFilterWalkStops: new Map(),
    activeGainCurves: new Map(),
    pendingRetire: [],
    droneVoiceGain: makeGain(),
  });
  return { ve: ve as any, ctx, created };
}

const BLOOM = 0.3; // MIN_REBUILD_XFADE_SEC at morphAmount = 0
const LEVEL = 0.8; // layer level used in the crossfade scenario
const FLOOR = 0.0001; // retire floor the engine fades out to

/** Rebuild that both retires a live tanpura layer (voice-count
 *  mismatch: 2 live voices vs 1 target interval) and brings the layer
 *  back up — i.e. a genuine out/in crossfade on uncorrelated buses. */
function runCrossfadeRebuild() {
  const { ve, created } = makeEngine();
  ve.voiceLayers.tanpura = true;
  ve.layerLevels.tanpura = LEVEL;
  const oldGain = makeGain(LEVEL);
  ve.layerGains.set("tanpura", oldGain);
  ve.droneVoicesByLayer.set("tanpura", [makeFakeVoice(), makeFakeVoice()]);
  ve.rebuildIntervals();
  const newGain = created[0]; // first gain built in the bring-up pass
  return { ve, oldGain, newGain };
}

function lastCurveCall(param: ReturnType<typeof makeParam>) {
  const calls = param.setValueCurveAtTime.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1] as [Float32Array, number, number];
}

describe("VoiceEngine rebuild crossfade is equal-power", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("schedules cos/sin setValueCurveAtTime pairs whose powers sum to a constant (±1%)", () => {
    const { oldGain, newGain } = runCrossfadeRebuild();

    // Repro assertion: before the fix these are linearRampToValueAtTime
    // and setValueCurveAtTime is never called at all.
    const [outCurve, outAt, outDur] = lastCurveCall(oldGain.gain);
    const [inCurve, inAt, inDur] = lastCurveCall(newGain.gain);
    expect(outAt).toBe(0);
    expect(inAt).toBe(0);
    expect(outDur).toBeCloseTo(BLOOM, 9);
    expect(inDur).toBeCloseTo(BLOOM, 9);
    expect(outCurve.length).toBe(inCurve.length);
    expect(outCurve.length).toBeGreaterThanOrEqual(64);

    // Equal-power: (g_out/L)² + (g_in/L)² ≈ 1 at every curve point.
    for (let i = 0; i < outCurve.length; i++) {
      const power = (outCurve[i] / LEVEL) ** 2 + (inCurve[i] / LEVEL) ** 2;
      expect(power).toBeGreaterThan(0.99);
      expect(power).toBeLessThan(1.01);
    }
  });

  it("starts each curve at the param's current value and ends exactly on target", () => {
    const { oldGain, newGain } = runCrossfadeRebuild();
    const [outCurve] = lastCurveCall(oldGain.gain);
    const [inCurve] = lastCurveCall(newGain.gain);

    // Start points: out from the live gain value, in from silence.
    expect(outCurve[0]).toBe(Math.fround(LEVEL));
    expect(inCurve[0]).toBe(0);

    // End points pinned exactly to the targets (float32-exact).
    expect(outCurve[outCurve.length - 1]).toBe(Math.fround(FLOOR));
    expect(inCurve[inCurve.length - 1]).toBe(Math.fround(LEVEL));

    // NO post-curve setValueAtTime anchor: Chrome clamps a just-past
    // curve start to currentTime, so an anchor at now + bloom can land
    // inside the curve's own (clamped) window and throw
    // NotSupportedError (field crash). The pinned last curve point is
    // the end-value guarantee instead — asserted above.
    expect(oldGain.gain.setValueAtTime).not.toHaveBeenCalledWith(FLOOR, BLOOM);
    expect(newGain.gain.setValueAtTime).not.toHaveBeenCalledWith(LEVEL, BLOOM);
  });

  it("holds ≈ full power at the fade midpoint (linear pair dips to 50% power)", () => {
    const { oldGain, newGain } = runCrossfadeRebuild();
    const [outCurve] = lastCurveCall(oldGain.gain);
    const [inCurve] = lastCurveCall(newGain.gain);
    const mid = Math.floor(outCurve.length / 2);

    // Each side sits near LEVEL/√2 ≈ 0.566 at the crossing — NOT the
    // 0.4 (= LEVEL/2) a linear pair gives.
    expect(outCurve[mid]).toBeGreaterThan(0.54);
    expect(outCurve[mid]).toBeLessThan(0.59);
    expect(inCurve[mid]).toBeGreaterThan(0.54);
    expect(inCurve[mid]).toBeLessThan(0.59);

    // Summed power ≈ LEVEL² (the linear pair sums to 0.5·LEVEL²).
    const midPower = outCurve[mid] ** 2 + inCurve[mid] ** 2;
    expect(midPower).toBeGreaterThan(LEVEL * LEVEL * 0.99);
    expect(midPower).toBeLessThan(LEVEL * LEVEL * 1.01);
  });

  it("retrigger mid-fade does not throw and re-anchors (cancel → anchor → curve)", () => {
    const { ve, ctx, created } = makeEngine();
    ve.voiceLayers.tanpura = true;

    // First rebuild: fresh bring-up, fade-in curve now in flight.
    ve.rebuildIntervals();
    const liveGain = created[0];
    expect(liveGain.gain.setValueCurveAtTime).toHaveBeenCalledTimes(1);

    // Retrigger mid-curve: retire the layer while its fade-in window
    // (0..BLOOM) is still active. setValueCurveAtTime makes that whole
    // window exclusive, so the engine must cancel before rescheduling.
    ctx.currentTime = BLOOM / 2;
    ve.voiceLayers.tanpura = false;
    expect(() => ve.rebuildIntervals()).not.toThrow();

    // Scheduling hygiene on the retired param, in order:
    // cancelScheduledValues → setValueAtTime(current) → curve.
    // The cancel targets the in-flight curve's START (0), not `now`:
    // Chrome's cancelScheduledValues does not remove a running curve
    // (spec divergence), so cancelling from the start is the only
    // cross-browser way to clear its exclusive window.
    const cancelOrder = liveGain.gain.cancelScheduledValues.mock.invocationCallOrder.at(-1)!;
    const curveOrder = liveGain.gain.setValueCurveAtTime.mock.invocationCallOrder.at(-1)!;
    const anchorOrders = liveGain.gain.setValueAtTime.mock.invocationCallOrder
      .filter((o: number) => o > cancelOrder && o < curveOrder);
    expect(liveGain.gain.cancelScheduledValues).toHaveBeenCalledWith(0);
    expect(anchorOrders.length).toBeGreaterThan(0);
    expect(liveGain.gain.setValueCurveAtTime).toHaveBeenCalledTimes(2);
    const [, at, dur] = lastCurveCall(liveGain.gain);
    expect(at).toBe(BLOOM / 2);
    expect(dur).toBeCloseTo(BLOOM, 9);
  });
});

describe("VoiceEngine.killPendingRetire teardown + throw-fallback", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function retireEntry() {
    return {
      gain: makeGain(0.8),
      voices: [makeFakeVoice(), makeFakeVoice()],
      filter: makeBiquad(),
      stopTimeout: setTimeout(() => {}, 99999),
    };
  }

  it("fades, then stops + disconnects the retired voices after the 50 ms window", () => {
    const { ve } = makeEngine();
    const entry = retireEntry();
    ve.pendingRetire = [entry];
    (ve as any).killPendingRetire(0);
    expect(ve.pendingRetire.length).toBe(0);
    expect(entry.gain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, 0.03);
    expect(entry.voices[0].stop).not.toHaveBeenCalled(); // deferred 50 ms
    vi.advanceTimersByTime(50);
    for (const v of entry.voices) expect(v.stop).toHaveBeenCalled();
    expect(entry.gain.disconnect).toHaveBeenCalled();
    expect(entry.filter.disconnect).toHaveBeenCalled();
  });

  it("still tears down voices when the anti-click ramp throws (click, never a leak)", () => {
    // The try/catch around the fast-fade exists for the Chrome clamp edge.
    // If it ever fires, the +50 ms stop MUST still run — otherwise the
    // worklet voices keep rendering forever. Degrading to a click is fine.
    const { ve } = makeEngine();
    const entry = retireEntry();
    entry.gain.gain.linearRampToValueAtTime = vi.fn(() => { throw new Error("NotSupportedError"); });
    ve.pendingRetire = [entry];
    expect(() => (ve as any).killPendingRetire(0)).not.toThrow();
    vi.advanceTimersByTime(50);
    for (const v of entry.voices) expect(v.stop).toHaveBeenCalled();
    expect(entry.gain.disconnect).toHaveBeenCalled();
  });
});
