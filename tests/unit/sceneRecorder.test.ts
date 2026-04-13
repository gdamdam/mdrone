import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  SceneRecorder,
  normalizeMotionEvents,
  scheduleMotionReplay,
  pitchClassToIndex,
  indexToPitchClass,
  MOTION_PARAM_IDS,
  MOTION_MAX_EVENTS,
  MOTION_MAX_DURATION_MS,
  MOTION_THROTTLE_MS,
} from "../../src/sceneRecorder";
import { normalizePortableScene } from "../../src/session";

describe("pitch class index round-trip", () => {
  it("round-trips every pitch class", () => {
    const all = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;
    for (const pc of all) {
      expect(indexToPitchClass(pitchClassToIndex(pc))).toBe(pc);
    }
  });

  it("clamps out-of-range indices into the legal pitch classes", () => {
    expect(indexToPitchClass(-5)).toBe("C");
    expect(indexToPitchClass(99)).toBe("B");
  });
});

describe("SceneRecorder", () => {
  let nowMs: number;
  beforeEach(() => {
    nowMs = 0;
    vi.spyOn(performance, "now").mockImplementation(() => nowMs);
  });

  it("captures events with monotonic timestamps", () => {
    const r = new SceneRecorder();
    r.start();
    nowMs = 100; r.record(MOTION_PARAM_IDS.drift, 0.5);
    nowMs = 400; r.record(MOTION_PARAM_IDS.air, 0.7);
    nowMs = 800; r.record(MOTION_PARAM_IDS.bloom, 0.4);
    const events = r.getEvents();
    // 3 events × 3 fields each = 9 numbers
    expect(events).toHaveLength(9);
    expect(events[0]).toBe(100);
    expect(events[3]).toBe(400);
    expect(events[6]).toBe(800);
    // monotonic
    expect(events[3]).toBeGreaterThan(events[0]);
    expect(events[6]).toBeGreaterThan(events[3]);
  });

  it("throttles same-param writes inside MOTION_THROTTLE_MS", () => {
    const r = new SceneRecorder();
    r.start();
    nowMs = 0;   r.record(MOTION_PARAM_IDS.drift, 0.1);
    nowMs = 50;  r.record(MOTION_PARAM_IDS.drift, 0.2); // dropped
    nowMs = 100; r.record(MOTION_PARAM_IDS.drift, 0.3); // dropped
    nowMs = MOTION_THROTTLE_MS + 1; r.record(MOTION_PARAM_IDS.drift, 0.4);
    expect(r.getEvents()).toHaveLength(6); // 2 events
  });

  it("does not throttle different params against each other", () => {
    const r = new SceneRecorder();
    r.start();
    nowMs = 0;
    r.record(MOTION_PARAM_IDS.drift, 0.1);
    r.record(MOTION_PARAM_IDS.air, 0.2);
    r.record(MOTION_PARAM_IDS.time, 0.3);
    expect(r.getEvents()).toHaveLength(9); // 3 events
  });

  it("stops recording at MOTION_MAX_EVENTS", () => {
    const r = new SceneRecorder();
    r.start();
    for (let i = 0; i < MOTION_MAX_EVENTS + 50; i++) {
      // Step time past throttle each iteration so we don't drop on dedup
      nowMs = i * (MOTION_THROTTLE_MS + 1);
      r.record(MOTION_PARAM_IDS.drift, i / 1000);
    }
    expect(r.getEvents().length / 3).toBeLessThanOrEqual(MOTION_MAX_EVENTS);
  });

  it("stops recording past MOTION_MAX_DURATION_MS", () => {
    const r = new SceneRecorder();
    r.start();
    nowMs = MOTION_MAX_DURATION_MS + 1;
    r.record(MOTION_PARAM_IDS.drift, 0.5);
    expect(r.getEvents()).toHaveLength(0);
    expect(r.isRecording()).toBe(false);
  });

  it("ignores non-finite values", () => {
    const r = new SceneRecorder();
    r.start();
    nowMs = 100;
    r.record(MOTION_PARAM_IDS.drift, NaN);
    r.record(MOTION_PARAM_IDS.air, Infinity);
    expect(r.getEvents()).toHaveLength(0);
  });

  it("returns empty events when not started", () => {
    const r = new SceneRecorder();
    nowMs = 100;
    r.record(MOTION_PARAM_IDS.drift, 0.5);
    expect(r.getEvents()).toEqual([]);
  });
});

describe("normalizeMotionEvents", () => {
  it("returns undefined for non-arrays and empty arrays", () => {
    expect(normalizeMotionEvents(null)).toBeUndefined();
    expect(normalizeMotionEvents("string")).toBeUndefined();
    expect(normalizeMotionEvents([])).toBeUndefined();
  });

  it("accepts a valid flat tuple list", () => {
    const events = [100, MOTION_PARAM_IDS.drift, 0.5, 200, MOTION_PARAM_IDS.air, 0.7];
    const out = normalizeMotionEvents(events);
    expect(out).toEqual(events);
  });

  it("drops events with non-monotonic time", () => {
    const events = [200, MOTION_PARAM_IDS.drift, 0.5, 100, MOTION_PARAM_IDS.air, 0.7];
    const out = normalizeMotionEvents(events);
    expect(out).toEqual([200, MOTION_PARAM_IDS.drift, 0.5]);
  });

  it("drops events with unknown param ids", () => {
    const events = [100, 999, 0.5, 200, MOTION_PARAM_IDS.air, 0.7];
    const out = normalizeMotionEvents(events);
    expect(out).toEqual([200, MOTION_PARAM_IDS.air, 0.7]);
  });

  it("drops events with non-finite values", () => {
    const events = [100, MOTION_PARAM_IDS.drift, NaN, 200, MOTION_PARAM_IDS.air, 0.7];
    const out = normalizeMotionEvents(events);
    expect(out).toEqual([200, MOTION_PARAM_IDS.air, 0.7]);
  });

  it("drops events with t outside [0, MOTION_MAX_DURATION_MS]", () => {
    const events = [
      -10, MOTION_PARAM_IDS.drift, 0.5,
      MOTION_MAX_DURATION_MS + 1, MOTION_PARAM_IDS.air, 0.7,
      500, MOTION_PARAM_IDS.bloom, 0.6,
    ];
    const out = normalizeMotionEvents(events);
    expect(out).toEqual([500, MOTION_PARAM_IDS.bloom, 0.6]);
  });

  it("caps the result at MOTION_MAX_EVENTS", () => {
    const events: number[] = [];
    for (let i = 0; i < MOTION_MAX_EVENTS + 50; i++) {
      events.push(i, MOTION_PARAM_IDS.drift, 0.5);
    }
    const out = normalizeMotionEvents(events);
    expect(out!.length / 3).toBeLessThanOrEqual(MOTION_MAX_EVENTS);
  });
});

describe("Motion share round-trip", () => {
  it("preserves a valid motion payload through normalizePortableScene", () => {
    const motion = [100, MOTION_PARAM_IDS.drift, 0.5, 300, MOTION_PARAM_IDS.air, 0.7];
    const scene = normalizePortableScene({
      drone: {},
      mixer: {},
      motion,
    });
    expect(scene!.motion).toEqual(motion);
  });

  it("legacy scenes without motion stay motion-free", () => {
    const scene = normalizePortableScene({ drone: {}, mixer: {} });
    expect(scene!.motion).toBeUndefined();
  });

  it("garbage motion payloads are silently dropped", () => {
    const scene = normalizePortableScene({
      drone: {},
      mixer: {},
      motion: "totally not an array",
    });
    expect(scene!.motion).toBeUndefined();
  });
});

describe("scheduleMotionReplay", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("dispatches each event at its scheduled time", () => {
    const calls: Array<[number, number]> = [];
    const dispatch = (id: number, v: number) => calls.push([id, v]);
    const events = [100, MOTION_PARAM_IDS.drift, 0.5, 250, MOTION_PARAM_IDS.air, 0.7];
    scheduleMotionReplay(events, dispatch);
    vi.advanceTimersByTime(50);
    expect(calls).toHaveLength(0);
    vi.advanceTimersByTime(60);
    expect(calls).toEqual([[MOTION_PARAM_IDS.drift, 0.5]]);
    vi.advanceTimersByTime(150);
    expect(calls).toEqual([
      [MOTION_PARAM_IDS.drift, 0.5],
      [MOTION_PARAM_IDS.air, 0.7],
    ]);
  });

  it("cancel handle clears every pending timer", () => {
    const calls: Array<[number, number]> = [];
    const dispatch = (id: number, v: number) => calls.push([id, v]);
    const events = [100, MOTION_PARAM_IDS.drift, 0.5, 250, MOTION_PARAM_IDS.air, 0.7];
    const cancel = scheduleMotionReplay(events, dispatch);
    cancel();
    vi.advanceTimersByTime(1000);
    expect(calls).toEqual([]);
  });

  it("noop on empty event list", () => {
    const cancel = scheduleMotionReplay([], () => { /* noop */ });
    expect(typeof cancel).toBe("function");
    cancel(); // should not throw
  });

  it("user cancel mid-replay stops remaining events", () => {
    const calls: Array<[number, number]> = [];
    const dispatch = (id: number, v: number) => calls.push([id, v]);
    const events = [
      100, MOTION_PARAM_IDS.drift, 0.5,
      500, MOTION_PARAM_IDS.air, 0.7,
      900, MOTION_PARAM_IDS.bloom, 0.3,
    ];
    const cancel = scheduleMotionReplay(events, dispatch);
    // Let first event fire, then cancel before the rest
    vi.advanceTimersByTime(150);
    expect(calls).toHaveLength(1);
    cancel();
    vi.advanceTimersByTime(2000);
    // Only the first event should have fired
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual([MOTION_PARAM_IDS.drift, 0.5]);
  });
});

describe("FM params in DroneSessionSnapshot", () => {
  it("round-trips FM params through normalizePortableScene", () => {
    const scene = normalizePortableScene({
      drone: { fmRatio: 3.5, fmIndex: 4.5 },
      mixer: {},
    });
    expect(scene!.drone.fmRatio).toBe(3.5);
    expect(scene!.drone.fmIndex).toBe(4.5);
  });

  it("defaults FM params for legacy scenes without them", () => {
    const scene = normalizePortableScene({
      drone: {},
      mixer: {},
    });
    expect(scene!.drone.fmRatio).toBe(2.0);
    expect(scene!.drone.fmIndex).toBe(2.4);
  });
});
