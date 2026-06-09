/**
 * Chrome AudioParam overlap semantics vs the rebuild crossfade.
 *
 * Field crash repro ("Something went wrong in the drone view"):
 *   Failed to execute 'setValueAtTime' on 'AudioParam':
 *   setValueAtTime(0.984, 12.229) overlaps setValueCurveAtTime(..., 11.557, 0.675)
 *
 * Root cause: the Web Audio spec says cancelScheduledValues(t) removes
 * an in-flight setValueCurveAtTime whose window contains t — but
 * Chrome does NOT implement that provision: a curve that started
 * before the cancel time survives, and the very next event scheduled
 * inside its window throws NotSupportedError. So the engine's
 * "cancel → re-anchor" hygiene is a no-op exactly when it matters:
 * any layer-gain write landing inside a 0.3–1.8 s rebuild crossfade
 * (level slider, mute, ATTUNE retrigger, motion tick) crashed the view.
 *
 * The fake param below reproduces Chrome's behavior, not the spec's.
 */
import { describe, it, expect, vi } from "vitest";
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

interface CurveEvent { kind: "curve"; time: number; dur: number; curve: Float32Array }
interface PointEvent { kind: "point"; time: number }
type ParamEvent = CurveEvent | PointEvent;

/** AudioParam fake with Chrome's (non-spec) timeline rules:
 *  - any event scheduled strictly inside a live curve window throws
 *    NotSupportedError (events exactly at the window end are legal);
 *  - cancelScheduledValues(t) only removes events with time >= t —
 *    an in-flight curve (start < t) SURVIVES, unlike the spec. */
function makeChromeParam(value = 0) {
  const events: ParamEvent[] = [];
  const insideCurve = (t: number): CurveEvent | undefined =>
    events.find(
      (e): e is CurveEvent => e.kind === "curve" && t > e.time && t < e.time + e.dur,
    );
  const assertFree = (label: string, t: number) => {
    const hit = insideCurve(t);
    if (hit) {
      throw new DOMException(
        `Failed to execute '${label}' on 'AudioParam': ${label}(..., ${t}) overlaps setValueCurveAtTime(..., ${hit.time}, ${hit.dur})`,
        "NotSupportedError",
      );
    }
  };
  const param = {
    value,
    events,
    setValueAtTime: vi.fn((v: number, t: number) => {
      assertFree("setValueAtTime", t);
      events.push({ kind: "point", time: t });
      param.value = v;
    }),
    setTargetAtTime: vi.fn((_v: number, t: number) => {
      assertFree("setTargetAtTime", t);
      events.push({ kind: "point", time: t });
    }),
    linearRampToValueAtTime: vi.fn((_v: number, t: number) => {
      assertFree("linearRampToValueAtTime", t);
      events.push({ kind: "point", time: t });
    }),
    exponentialRampToValueAtTime: vi.fn((_v: number, t: number) => {
      assertFree("exponentialRampToValueAtTime", t);
      events.push({ kind: "point", time: t });
    }),
    setValueCurveAtTime: vi.fn((curve: Float32Array, t: number, dur: number) => {
      assertFree("setValueCurveAtTime", t);
      // Chrome also rejects a curve whose window swallows existing events.
      for (const e of events) {
        if (e.time > t && e.time < t + dur) {
          throw new DOMException(
            `Failed to execute 'setValueCurveAtTime' on 'AudioParam': setValueCurveAtTime(..., ${t}, ${dur}) overlaps event at ${e.time}`,
            "NotSupportedError",
          );
        }
      }
      events.push({ kind: "curve", time: t, dur, curve });
    }),
    cancelScheduledValues: vi.fn((t: number) => {
      // Chrome divergence under test: >= only; in-flight curves survive.
      for (let i = events.length - 1; i >= 0; i--) {
        if (events[i].time >= t) events.splice(i, 1);
      }
    }),
  };
  return param;
}

function makeGain(value = 0) {
  return { gain: makeChromeParam(value), connect: vi.fn(), disconnect: vi.fn() };
}

function makeBiquad() {
  return {
    type: "",
    frequency: makeChromeParam(),
    Q: makeChromeParam(),
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
}

function rec<T>(v: T): Record<string, T> {
  return { tanpura: v, reed: v, metal: v, air: v, piano: v, fm: v, amp: v, noise: v };
}

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
    morphAmount: 0, // bloom = MIN_REBUILD_XFADE_SEC = 0.3 s
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

const BLOOM = 0.3;
const QUANTUM = 128 / 48000; // one render quantum ≈ 2.67 ms

describe("rebuild crossfade vs Chrome curve-overlap semantics", () => {
  it("a level write landing inside the crossfade window does not throw", () => {
    // Screenshot repro 1: level/mute/motion write ~0.67 s into a
    // 0.675 s crossfade → setValueAtTime inside the live curve window.
    const { ve, ctx, created } = makeEngine();
    ve.voiceLayers.tanpura = true;
    ve.layerLevels.tanpura = 0.8;
    ve.rebuildIntervals(); // bring-up curve on the new gain at [0, BLOOM)
    const newGain = created[0];
    expect(newGain.gain.setValueCurveAtTime).toHaveBeenCalled();

    ctx.currentTime = BLOOM * 0.93; // strictly inside the window
    expect(() => ve.setVoiceLevel("tanpura", 0.5)).not.toThrow();

    // No-jump anchoring: the re-anchor must sit on the curve's value at
    // the write time, not on a stale .value snapshot.
    const calls = newGain.gain.setValueAtTime.mock.calls;
    const anchored = calls[calls.length - 1][0] as number;
    const target = (ve as any).effectiveLayerLevel("tanpura"); // fix may re-read level
    void target;
    // sin fade-in from 0 → 0.8 at 93% progress ≈ 0.8·sin(0.93·π/2) ≈ 0.795
    expect(anchored).toBeGreaterThan(0.7);
    expect(anchored).toBeLessThanOrEqual(0.81);
  });

  it("a rebuild retrigger one quantum into the previous crossfade does not throw (ATTUNE spam)", () => {
    // Screenshot repro 2: rapid ATTUNE clicks → second rebuild lands
    // one render quantum after the first; Chrome's cancel keeps the
    // first curve, so both the retire re-anchor and killPendingRetire's
    // fast-fade throw today.
    const { ve, ctx } = makeEngine();
    ve.voiceLayers.tanpura = true;
    ve.layerLevels.tanpura = 0.8;
    ve.droneVoicesByLayer.set("tanpura", [makeFakeVoice(), makeFakeVoice()]);
    const oldGain = makeGain(0.8);
    ve.layerGains.set("tanpura", oldGain);
    ve.rebuildIntervals(); // retires oldGain with a fade-out curve at t=0

    ctx.currentTime = QUANTUM; // ATTUNE again, one quantum later
    ve.droneIntervalsCents = [0, 702];
    expect(() => ve.rebuildIntervals()).not.toThrow();
  });

  it("retriggering inside the window twice in a row stays clean", () => {
    // The fix must clear its curve bookkeeping as it goes — a stale
    // record would make the second retrigger cancel from the wrong
    // start time and resurrect the overlap.
    const { ve, ctx } = makeEngine();
    ve.voiceLayers.tanpura = true;
    ve.droneVoicesByLayer.set("tanpura", [makeFakeVoice(), makeFakeVoice()]);
    ve.layerGains.set("tanpura", makeGain(0.8));
    ve.rebuildIntervals();
    ctx.currentTime = QUANTUM;
    ve.droneIntervalsCents = [0, 702];
    ve.rebuildIntervals();
    ctx.currentTime = QUANTUM * 2;
    ve.droneIntervalsCents = [0, 386, 702];
    expect(() => ve.rebuildIntervals()).not.toThrow();
    ctx.currentTime = 0.2; // and a level write inside the latest fade
    expect(() => ve.setVoiceLevel("tanpura", 0.3)).not.toThrow();
  });
});
