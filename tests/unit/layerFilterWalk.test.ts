/**
 * Per-layer resonant filters with slow cutoff walks (Tier-4 / E3,
 * internal-only — no UI, no scene schema, no preset/share changes).
 *
 * Topology under test: each live LAYER (not each voice copy) gets one
 * lowpass BiquadFilterNode inserted between its voices and its layer
 * gain (voices → filter → layerGain → droneVoiceGain). Base cutoff is
 * 4–6× the drone root (per-layer multiplier), clamped to [600 Hz,
 * 12 kHz] so the filter is nearly transparent at rest; Q sits in the
 * gentle-resonance 1.2–2.5 band.
 *
 * The walk clock lives in MotionEngine (same home as the EVOLVE walk).
 * The two engines hold no reference to each other and AudioEngine
 * wiring is out of scope, so the hookup goes through a module-level
 * registry — the same latch pattern the ENTRAIN rate handoff uses.
 * Offsets are a pure deterministic function of (tick, layerIndex):
 * no PRNG draws, so the seeded evolve stream is untouched.
 *
 * Harness: fake-`this` over the engine prototypes (voiceCrossfade /
 * entrain style) with fake AudioParams that record scheduled calls
 * (voiceEngineDispose style). buildVoice is mocked — no worklets.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { VoiceEngine } from "../../src/engine/VoiceEngine";
import {
  MotionEngine,
  registerLayerFilterWalk,
  LAYER_FILTER_MIN_HZ,
  LAYER_FILTER_MAX_HZ,
} from "../../src/engine/MotionEngine";
import { buildVoice } from "../../src/engine/VoiceBuilder";

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
    setFreq: vi.fn(),
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
  return {
    type: "",
    frequency: makeParam(),
    Q: makeParam(),
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
}

function rec<T>(v: T): Record<string, T> {
  return { tanpura: v, reed: v, metal: v, air: v, piano: v, fm: v, amp: v, noise: v };
}

/** Fake `this` over VoiceEngine.prototype with every field the
 *  rebuild / retune / filter paths touch. morphAmount 0 → bloom 0.3 s. */
function makeEngine(rootFreq = 220) {
  const created: ReturnType<typeof makeGain>[] = [];
  const filters: ReturnType<typeof makeBiquad>[] = [];
  const ctx = {
    currentTime: 0,
    createGain: vi.fn(() => {
      const g = makeGain();
      created.push(g);
      return g;
    }),
    createBiquadFilter: vi.fn(() => {
      const f = makeBiquad();
      filters.push(f);
      return f;
    }),
    createAnalyser: vi.fn(() => ({ fftSize: 0, connect: vi.fn(), disconnect: vi.fn() })),
  };
  const ve = Object.assign(Object.create(VoiceEngine.prototype) as VoiceEngine, {
    ctx,
    fxChain: { setRootFreq: vi.fn() },
    droneOn: true,
    morphAmount: 0,
    glideAmount: 0,
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
    droneRootFreq: rootFreq,
    reedShape: "odd",
    fmRatio: 2,
    fmIndex: 2.4,
    fmFeedback: 0,
    tanpuraTuning: "classic",
    subOscs: null,
    droneVoicesByLayer: new Map(),
    layerGains: new Map(),
    layerAnalysers: new Map(),
    layerFilters: new Map(),
    layerFilterWalkStops: new Map(),
    pendingRetire: [],
    droneVoiceGain: makeGain(),
  });
  return { ve: ve as any, ctx, created, filters };
}

/** Fake `this` over MotionEngine.prototype — just the walk clock. */
function makeMotion(playing = true) {
  return Object.assign(Object.create(MotionEngine.prototype) as MotionEngine, {
    ctx: { currentTime: 0 },
    filterWalkTicks: 0,
    filterWalkInterval: null,
    isPlayingImpl: () => playing,
  }) as any;
}

function lastTarget(param: ReturnType<typeof makeParam>): number {
  const calls = param.setTargetAtTime.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1][0] as number;
}

const BLOOM = 0.3; // MIN_REBUILD_XFADE_SEC at morphAmount = 0

describe("per-layer resonant filters (E3)", () => {
  const cleanups: (() => void)[] = [];
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    for (const c of cleanups.splice(0)) c();
    vi.useRealTimers();
    vi.mocked(buildVoice).mockClear();
  });

  /** Drain a fake engine's registered walk targets so the module-level
   *  registry doesn't leak across tests. */
  function drain(ve: any) {
    cleanups.push(() => {
      for (const stop of ve.layerFilterWalkStops.values()) stop();
      ve.layerFilterWalkStops.clear();
    });
  }

  it("gives each layer its own lowpass filter (Q in 1.2–2.5) between voices and layer gain", () => {
    const { ve, created, filters } = makeEngine();
    drain(ve);
    ve.voiceLayers.tanpura = true;
    ve.voiceLayers.reed = true;
    ve.rebuildIntervals();

    // One filter per LAYER, not per voice copy.
    expect(filters.length).toBe(2);
    expect(filters[0]).not.toBe(filters[1]);
    for (const f of filters) {
      expect(f.type).toBe("lowpass");
      expect(f.Q.value).toBeGreaterThanOrEqual(1.2);
      expect(f.Q.value).toBeLessThanOrEqual(2.5);
    }

    // Chain: filter → layerGain (gains created in ALL_VOICE_TYPES
    // order: tanpura then reed), and voices target the filter.
    expect(filters[0].connect).toHaveBeenCalledWith(created[0]);
    expect(filters[1].connect).toHaveBeenCalledWith(created[1]);
    const buildCalls = vi.mocked(buildVoice).mock.calls;
    expect(buildCalls.length).toBe(2);
    expect(buildCalls[0][2]).toBe(filters[0]);
    expect(buildCalls[1][2]).toBe(filters[1]);
  });

  it("derives base cutoff at 4–6× the root, clamped to [600 Hz, 12 kHz]", () => {
    // Mid root: cutoff sits in the 4–6× band, no clamp.
    const mid = makeEngine(220);
    drain(mid.ve);
    mid.ve.voiceLayers.tanpura = true;
    mid.ve.voiceLayers.noise = true;
    mid.ve.rebuildIntervals();
    for (const f of mid.filters) {
      expect(f.frequency.value).toBeGreaterThanOrEqual(220 * 4);
      expect(f.frequency.value).toBeLessThanOrEqual(220 * 6);
    }
    // Two layers must not share the same resonance frequency.
    expect(mid.filters[0].frequency.value).not.toBe(mid.filters[1].frequency.value);

    // Low root: 4×50 = 200 Hz would choke the drone → clamps to 600.
    const low = makeEngine(50);
    drain(low.ve);
    low.ve.voiceLayers.tanpura = true;
    low.ve.rebuildIntervals();
    expect(low.filters[0].frequency.value).toBe(LAYER_FILTER_MIN_HZ);

    // High root: 6×5000 = 30 kHz → clamps to 12 kHz.
    const high = makeEngine(5000);
    drain(high.ve);
    high.ve.voiceLayers.noise = true;
    high.ve.rebuildIntervals();
    expect(high.filters[0].frequency.value).toBe(LAYER_FILTER_MAX_HZ);
  });

  it("re-derives the base cutoff when the root retunes (filter tracks pitch)", () => {
    const { ve, filters } = makeEngine(220);
    drain(ve);
    ve.voiceLayers.tanpura = true;
    ve.rebuildIntervals();
    const baseAt220 = filters[0].frequency.value;

    ve.setDroneFreq(440);
    const retuned = lastTarget(filters[0].frequency);
    expect(retuned).toBeCloseTo(baseAt220 * 2, 6);

    // And down again — must not stay parked high. 110 Hz × 4 = 440
    // would dull the drone, so the clamp floor applies instead.
    ve.setDroneFreq(110);
    expect(lastTarget(filters[0].frequency)).toBe(LAYER_FILTER_MIN_HZ);
  });

  it("walk ticks schedule setTargetAtTime within ±1 octave of base, with long time constants", () => {
    const me = makeMotion();
    const param = makeParam(880);
    const stop = registerLayerFilterWalk({
      layerIndex: 0,
      frequency: param as any,
      getBaseCutoffHz: () => 880,
    });
    cleanups.push(stop);

    for (let i = 0; i < 60; i++) me.tickLayerFilterWalk();
    const calls = param.setTargetAtTime.mock.calls;
    expect(calls.length).toBe(60);
    let min = Infinity;
    let max = -Infinity;
    for (const [hz, , tc] of calls) {
      expect(hz).toBeGreaterThanOrEqual(440); // base / 2
      expect(hz).toBeLessThanOrEqual(1760); // base * 2
      expect(tc).toBeGreaterThanOrEqual(2); // glacial, never a sweep
      min = Math.min(min, hz);
      max = Math.max(max, hz);
    }
    // It actually walks — not pinned to one value.
    expect(max / min).toBeGreaterThan(1.1);
  });

  it("walk targets clamp to the global [600, 12000] cutoff bounds", () => {
    const me = makeMotion();
    const param = makeParam(LAYER_FILTER_MAX_HZ);
    const stop = registerLayerFilterWalk({
      layerIndex: 3,
      frequency: param as any,
      getBaseCutoffHz: () => LAYER_FILTER_MAX_HZ,
    });
    cleanups.push(stop);
    for (let i = 0; i < 60; i++) me.tickLayerFilterWalk();
    for (const [hz] of param.setTargetAtTime.mock.calls) {
      expect(hz).toBeGreaterThanOrEqual(LAYER_FILTER_MIN_HZ);
      expect(hz).toBeLessThanOrEqual(LAYER_FILTER_MAX_HZ);
    }
  });

  it("desynchronizes layers: same base, different layer index → different walk targets", () => {
    const me = makeMotion();
    const a = makeParam(880);
    const b = makeParam(880);
    cleanups.push(registerLayerFilterWalk({
      layerIndex: 0, frequency: a as any, getBaseCutoffHz: () => 880,
    }));
    cleanups.push(registerLayerFilterWalk({
      layerIndex: 1, frequency: b as any, getBaseCutoffHz: () => 880,
    }));
    me.tickLayerFilterWalk();
    expect(lastTarget(a)).not.toBeCloseTo(lastTarget(b), 3);
  });

  it("is deterministic: two clocks at the same tick schedule identical targets", () => {
    const m1 = makeMotion();
    const m2 = makeMotion();
    const p1 = makeParam(880);
    const p2 = makeParam(880);
    const target = (p: any) => ({
      layerIndex: 2, frequency: p, getBaseCutoffHz: () => 880,
    });
    const s1 = registerLayerFilterWalk(target(p1));
    m1.tickLayerFilterWalk();
    m1.tickLayerFilterWalk();
    s1();
    cleanups.push(registerLayerFilterWalk(target(p2)));
    m2.tickLayerFilterWalk();
    m2.tickLayerFilterWalk();
    expect(p2.setTargetAtTime.mock.calls.map((c: any[]) => c[0]))
      .toEqual(p1.setTargetAtTime.mock.calls.map((c: any[]) => c[0]));
  });

  it("runs the walk clock on an interval, gated on isPlaying, stopped by dispose()", () => {
    const param = makeParam(880);
    cleanups.push(registerLayerFilterWalk({
      layerIndex: 0, frequency: param as any, getBaseCutoffHz: () => 880,
    }));

    // Not playing → ticks are inert.
    const idle = makeMotion(false);
    idle.startFilterWalkLoop();
    vi.advanceTimersByTime(30_000);
    expect(param.setTargetAtTime).not.toHaveBeenCalled();
    idle.dispose();

    // Playing → the interval schedules walk targets.
    const live = makeMotion(true);
    live.startFilterWalkLoop();
    vi.advanceTimersByTime(30_000);
    const fired = param.setTargetAtTime.mock.calls.length;
    expect(fired).toBeGreaterThan(0);

    // dispose() stops the clock (motion teardown stops the walks).
    live.dispose();
    vi.advanceTimersByTime(60_000);
    expect(param.setTargetAtTime.mock.calls.length).toBe(fired);
  });

  it("retiring a layer unregisters its walk and disconnects its filter after the fade", () => {
    const { ve, filters } = makeEngine();
    drain(ve);
    const me = makeMotion();
    ve.voiceLayers.tanpura = true;
    ve.rebuildIntervals();
    const filter = filters[0];

    // Live layer participates in the walk.
    me.tickLayerFilterWalk();
    const before = filter.frequency.setTargetAtTime.mock.calls.length;
    expect(before).toBeGreaterThan(0);

    // Retire the layer.
    ve.voiceLayers.tanpura = false;
    ve.rebuildIntervals();

    // Walk no longer touches the retired filter…
    me.tickLayerFilterWalk();
    expect(filter.frequency.setTargetAtTime.mock.calls.length).toBe(before);

    // …and the node is disconnected once the retire fade has elapsed.
    expect(filter.disconnect).not.toHaveBeenCalled();
    vi.advanceTimersByTime(BLOOM * 1000 + 200);
    expect(filter.disconnect).toHaveBeenCalled();
  });

  it("dispose() stops walks and disconnects all layer filters", () => {
    const { ve, filters } = makeEngine();
    const me = makeMotion();
    ve.voiceLayers.tanpura = true;
    ve.voiceLayers.reed = true;
    ve.rebuildIntervals();
    expect(filters.length).toBe(2);

    ve.dispose();

    me.tickLayerFilterWalk();
    for (const f of filters) {
      expect(f.frequency.setTargetAtTime).not.toHaveBeenCalled();
      expect(f.disconnect).toHaveBeenCalled();
    }
  });
});
