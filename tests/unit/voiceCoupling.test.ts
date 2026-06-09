/**
 * Cross-voice coupling (Tier-4 / E4) — one global COUPLE amount that
 * feeds each layer a little of the other layers' sound, Lyra-8-adjacent
 * but conservative.
 *
 * Topology under test (native nodes, no worklet changes):
 *
 *   layerGain (post-filter, post-level tap)
 *     → couplingBus (GainNode, unity)
 *     → DelayNode (~15 ms — Web Audio only allows graph cycles through
 *       a DelayNode; physically an acoustic-coupling distance of ~5 m)
 *     → bandpass tone filter (keeps the cross-feed out of the lows)
 *     → per-layer injection GainNode (coupleAmount × 0.15 / N)
 *     → that layer's layerFilter input.
 *
 * Each layer's own contribution is NOT subtracted from its injection —
 * at these gains self-feed is mild resonant thickening (documented
 * choice). Worst-case loop gain at coupleAmount = 1 is
 * 0.15 × layer-lowpass peak (Q ≤ 2.24 ≈ ×2.24) ≈ 0.34 — far below
 * unity, so no soft clipper is needed in this path.
 *
 * At coupleAmount = 0 (default) NO coupling nodes are created — the
 * graph is byte-identical to today and LUFS-audited presets are
 * untouched.
 *
 * Harness: fake-`this` over VoiceEngine.prototype (layerFilterWalk /
 * voiceCrossfade style); buildVoice mocked — no worklets.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  VoiceEngine,
  COUPLE_MAX_TOTAL_INJECTION,
  COUPLE_DELAY_SEC,
} from "../../src/engine/VoiceEngine";
import { AudioEngine } from "../../src/engine/AudioEngine";
import { buildVoice } from "../../src/engine/VoiceBuilder";
import { normalizeDroneSnapshot, normalizePortableScene } from "../../src/session";

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

function makeDelay() {
  return { delayTime: makeParam(), connect: vi.fn(), disconnect: vi.fn() };
}

function rec<T>(v: T): Record<string, T> {
  return { tanpura: v, reed: v, metal: v, air: v, piano: v, fm: v, amp: v, noise: v };
}

/** Fake `this` over VoiceEngine.prototype with every field the
 *  rebuild / retune / filter / coupling paths touch. */
function makeEngine(rootFreq = 220) {
  const created: ReturnType<typeof makeGain>[] = [];
  const filters: ReturnType<typeof makeBiquad>[] = [];
  const delays: ReturnType<typeof makeDelay>[] = [];
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
    createDelay: vi.fn(() => {
      const d = makeDelay();
      delays.push(d);
      return d;
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
    coupleAmount: 0,
    coupling: null,
    couplingInjections: new Map(),
    pendingRetire: [],
    droneVoiceGain: makeGain(),
  });
  return { ve: ve as any, ctx, created, filters, delays };
}

function lastTarget(param: ReturnType<typeof makeParam>): number {
  const calls = param.setTargetAtTime.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1][0] as number;
}

const BLOOM = 0.3; // MIN_REBUILD_XFADE_SEC at morphAmount = 0

describe("cross-voice coupling (E4)", () => {
  const cleanups: (() => void)[] = [];
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    for (const c of cleanups.splice(0)) c();
    vi.useRealTimers();
    vi.mocked(buildVoice).mockClear();
  });

  /** Drain a fake engine's registered walk targets so the module-level
   *  MotionEngine registry doesn't leak across tests. */
  function drain(ve: any) {
    cleanups.push(() => {
      for (const stop of ve.layerFilterWalkStops.values()) stop();
      ve.layerFilterWalkStops.clear();
    });
  }

  it("creates NO coupling nodes at coupleAmount = 0 (graph identical to today)", () => {
    const { ve, ctx } = makeEngine();
    drain(ve);
    ve.voiceLayers.tanpura = true;
    ve.voiceLayers.reed = true;
    ve.rebuildIntervals();

    expect(ctx.createDelay).not.toHaveBeenCalled();
    expect(ve.coupling).toBeNull();
    expect(ve.couplingInjections.size).toBe(0);
    expect(ve.getCoupleAmount()).toBe(0);
  });

  it("setCoupleAmount ramps each injection to coupleAmount × 0.15 / N", () => {
    const { ve } = makeEngine();
    drain(ve);
    ve.voiceLayers.tanpura = true;
    ve.voiceLayers.reed = true;
    ve.rebuildIntervals();

    ve.setCoupleAmount(1);
    expect(ve.couplingInjections.size).toBe(2);
    for (const inj of ve.couplingInjections.values()) {
      expect(lastTarget(inj.gain)).toBeCloseTo(COUPLE_MAX_TOTAL_INJECTION / 2, 9);
      // Anchored before the ramp — house style for retrigger safety.
      expect(inj.gain.cancelScheduledValues).toHaveBeenCalled();
      expect(inj.gain.setValueAtTime).toHaveBeenCalled();
    }

    ve.setCoupleAmount(0.5);
    for (const inj of ve.couplingInjections.values()) {
      expect(lastTarget(inj.gain)).toBeCloseTo(0.5 * COUPLE_MAX_TOTAL_INJECTION / 2, 9);
    }

    // The cap: even at full COUPLE, total injected feed stays ≤ 0.15.
    let total = 0;
    ve.setCoupleAmount(1);
    for (const inj of ve.couplingInjections.values()) total += lastTarget(inj.gain);
    expect(total).toBeLessThanOrEqual(COUPLE_MAX_TOTAL_INJECTION + 1e-9);
  });

  it("clamps the amount to [0, 1] and rejects non-finite values", () => {
    const { ve } = makeEngine();
    drain(ve);
    ve.setCoupleAmount(3);
    expect(ve.getCoupleAmount()).toBe(1);
    ve.setCoupleAmount(-1);
    expect(ve.getCoupleAmount()).toBe(0);
    ve.setCoupleAmount(NaN);
    expect(ve.getCoupleAmount()).toBe(0);
  });

  it("routes the cross-feed through a DelayNode (cycle safety) and a tone filter", () => {
    const { ve, created, filters, delays } = makeEngine();
    drain(ve);
    ve.voiceLayers.tanpura = true;
    ve.rebuildIntervals();
    // Creation order so far: layerGain = created[0], layerFilter = filters[0].
    const layerGain = created[0];
    const layerFilter = filters[0];

    ve.setCoupleAmount(1);
    // Coupling core: bus = created[1], delay = delays[0], tone = filters[1],
    // injection = created[2].
    expect(delays.length).toBe(1);
    const bus = created[1];
    const delay = delays[0];
    const tone = filters[1];
    const inj = created[2];

    // tap → bus → delay → tone → injection → back into the layer filter.
    expect(layerGain.connect).toHaveBeenCalledWith(bus);
    expect(bus.connect).toHaveBeenCalledWith(delay);
    expect(delay.connect).toHaveBeenCalledWith(tone);
    expect(tone.connect).toHaveBeenCalledWith(inj);
    expect(inj.connect).toHaveBeenCalledWith(layerFilter);

    // The delay is the cycle-breaker — 10–30 ms acoustic-coupling range.
    expect(delay.delayTime.value).toBe(COUPLE_DELAY_SEC);
    expect(COUPLE_DELAY_SEC).toBeGreaterThanOrEqual(0.01);
    expect(COUPLE_DELAY_SEC).toBeLessThanOrEqual(0.03);

    // Tone filter keeps the cross-feed out of the lows.
    expect(tone.type).toBe("bandpass");
  });

  it("new layers join the bus on build and 1/N rescales", () => {
    const { ve } = makeEngine();
    drain(ve);
    ve.voiceLayers.tanpura = true;
    ve.rebuildIntervals();
    ve.setCoupleAmount(1);
    const first = ve.couplingInjections.get("tanpura");
    expect(lastTarget(first.gain)).toBeCloseTo(COUPLE_MAX_TOTAL_INJECTION, 9);

    // A layer joining the bus mid-flight rescales everyone to 1/2.
    ve.voiceLayers.reed = true;
    ve.rebuildIntervals();
    expect(ve.couplingInjections.size).toBe(2);
    for (const inj of ve.couplingInjections.values()) {
      expect(lastTarget(inj.gain)).toBeCloseTo(COUPLE_MAX_TOTAL_INJECTION / 2, 9);
    }
  });

  it("retiring a layer disconnects its injection and rescales the survivors", () => {
    const { ve } = makeEngine();
    drain(ve);
    ve.voiceLayers.tanpura = true;
    ve.voiceLayers.reed = true;
    ve.rebuildIntervals();
    ve.setCoupleAmount(1);
    const reedInj = ve.couplingInjections.get("reed");

    ve.voiceLayers.reed = false;
    ve.rebuildIntervals();

    expect(reedInj.disconnect).toHaveBeenCalled();
    expect(ve.couplingInjections.has("reed")).toBe(false);
    const survivor = ve.couplingInjections.get("tanpura");
    expect(lastTarget(survivor.gain)).toBeCloseTo(COUPLE_MAX_TOTAL_INJECTION, 9);
    vi.advanceTimersByTime(BLOOM * 1000 + 200);
  });

  it("activating COUPLE after layers are already live attaches them all", () => {
    const { ve } = makeEngine();
    drain(ve);
    ve.voiceLayers.tanpura = true;
    ve.voiceLayers.reed = true;
    ve.voiceLayers.air = true;
    ve.rebuildIntervals();
    expect(ve.couplingInjections.size).toBe(0);

    ve.setCoupleAmount(0.8);
    expect(ve.couplingInjections.size).toBe(3);
    for (const inj of ve.couplingInjections.values()) {
      expect(lastTarget(inj.gain)).toBeCloseTo(0.8 * COUPLE_MAX_TOTAL_INJECTION / 3, 9);
    }
  });

  it("turning COUPLE back to 0 ramps every injection gain to 0 (acoustically off)", () => {
    const { ve } = makeEngine();
    drain(ve);
    ve.voiceLayers.tanpura = true;
    ve.voiceLayers.reed = true;
    ve.rebuildIntervals();
    ve.setCoupleAmount(1);

    ve.setCoupleAmount(0);
    for (const inj of ve.couplingInjections.values()) {
      expect(lastTarget(inj.gain)).toBe(0);
    }
  });

  it("dispose() tears the coupling graph down", () => {
    const { ve, delays } = makeEngine();
    ve.voiceLayers.tanpura = true;
    ve.voiceLayers.reed = true;
    ve.rebuildIntervals();
    ve.setCoupleAmount(1);
    const injections = [...ve.couplingInjections.values()];
    const { bus, tone } = ve.coupling;

    ve.dispose();

    for (const inj of injections) expect(inj.disconnect).toHaveBeenCalled();
    expect(bus.disconnect).toHaveBeenCalled();
    expect(delays[0].disconnect).toHaveBeenCalled();
    expect(tone.disconnect).toHaveBeenCalled();
    expect(ve.coupling).toBeNull();
    expect(ve.couplingInjections.size).toBe(0);
  });

  it("AudioEngine delegates setCoupleAmount/getCoupleAmount to VoiceEngine", () => {
    const voiceEngine = { setCoupleAmount: vi.fn(), getCoupleAmount: vi.fn(() => 0.4) };
    const ae = Object.assign(Object.create(AudioEngine.prototype) as AudioEngine, {
      voiceEngine,
    }) as any;
    ae.setCoupleAmount(0.4);
    expect(voiceEngine.setCoupleAmount).toHaveBeenCalledWith(0.4);
    expect(ae.getCoupleAmount()).toBe(0.4);
  });
});

describe("coupleAmount session normalization", () => {
  it("clamps to [0, 1]", () => {
    expect(normalizeDroneSnapshot({ coupleAmount: 2 })?.coupleAmount).toBe(1);
    expect(normalizeDroneSnapshot({ coupleAmount: -0.5 })?.coupleAmount).toBe(0);
    expect(normalizeDroneSnapshot({ coupleAmount: 0.4 })?.coupleAmount).toBe(0.4);
  });

  it("omits the field when missing or malformed (old scenes unchanged)", () => {
    expect("coupleAmount" in (normalizeDroneSnapshot({}) as object)).toBe(false);
    expect("coupleAmount" in (normalizeDroneSnapshot({ coupleAmount: "x" }) as object)).toBe(false);
    expect("coupleAmount" in (normalizeDroneSnapshot({ coupleAmount: NaN }) as object)).toBe(false);
  });

  it("round-trips through normalizePortableScene", () => {
    const scene = normalizePortableScene({
      version: 1,
      name: "couple",
      drone: { coupleAmount: 0.4 },
      mixer: {},
    });
    expect(scene?.drone.coupleAmount).toBe(0.4);
    // Idempotent: re-normalizing the normalized scene keeps the value.
    const again = normalizePortableScene(JSON.parse(JSON.stringify(scene)));
    expect(again?.drone.coupleAmount).toBe(0.4);
  });
});
