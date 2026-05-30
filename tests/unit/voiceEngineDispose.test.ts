/**
 * Lifecycle teardown for VoiceEngine.
 *
 * Regression for the leak the engine-wide dispose() pass (commit 9d782cc)
 * missed: VoiceEngine owns a recurring `materialInterval` (the evolve
 * material-motion timer, started in updateMaterialMotion) plus one-shot
 * stop timeouts, and had no dispose(). AudioEngine.dispose() closed the
 * context but never tore VoiceEngine down, so after dispose/HMR the
 * interval kept firing setTargetAtTime against a dead graph and pinned
 * the whole voice engine in memory.
 *
 * This is a lifecycle/timer test, not an audio-graph test (those live in
 * the Playwright smoke suite). We mock the minimal AudioContext surface
 * the constructor + material-motion path touch, and reach the private
 * `droneOn` flag so we can arm the interval without standing up the full
 * worklet voice graph.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { VoiceEngine } from "../../src/engine/VoiceEngine";

/* eslint-disable @typescript-eslint/no-explicit-any */

function makeParam() {
  return {
    value: 0,
    setValueAtTime: vi.fn(),
    setTargetAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
    cancelScheduledValues: vi.fn(),
  };
}

function makeGain() {
  return { gain: makeParam(), connect: vi.fn(), disconnect: vi.fn() };
}

function makeBiquad() {
  return { type: "", frequency: makeParam(), Q: makeParam(), connect: vi.fn(), disconnect: vi.fn() };
}

/** Minimal fake AudioContext — just enough for the VoiceEngine ctor
 *  (3 gains + 1 biquad) and the material-motion timer callback. */
function makeFakeCtx() {
  const gains: ReturnType<typeof makeGain>[] = [];
  const ctx = {
    currentTime: 0,
    createGain: vi.fn(() => {
      const g = makeGain();
      gains.push(g);
      return g;
    }),
    createBiquadFilter: vi.fn(() => makeBiquad()),
    createAnalyser: vi.fn(() => ({ fftSize: 0, connect: vi.fn(), disconnect: vi.fn() })),
    close: vi.fn(() => Promise.resolve()),
  };
  return { ctx, gains };
}

describe("VoiceEngine.dispose()", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function armedEngine() {
    const { ctx, gains } = makeFakeCtx();
    const ve = new VoiceEngine(ctx as any, {} as any, makeGain() as any);
    // gains[0] = droneVoiceGain, gains[1] = subVoiceGain (touched by the
    // material-motion timer via applySecondaryVoiceTargets).
    const subGain = gains[1];
    // Reach the private droneOn flag: the interval only arms while the
    // drone is on, and startDrone() would require the full worklet graph.
    (ve as any).droneOn = true;
    ve.setEvolveAmount(0.5); // > 0.12 → arms materialInterval (2200ms)
    return { ve, ctx, gains, subGain };
  }

  it("arms the material-motion interval while playing (sanity)", () => {
    const { subGain } = armedEngine();
    expect(subGain.gain.setTargetAtTime).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2300);
    expect(subGain.gain.setTargetAtTime).toHaveBeenCalled();
  });

  it("stops the recurring material-motion interval", () => {
    const { ve, subGain } = armedEngine();
    vi.advanceTimersByTime(2300);
    const callsBefore = subGain.gain.setTargetAtTime.mock.calls.length;
    expect(callsBefore).toBeGreaterThan(0);

    ve.dispose();

    vi.advanceTimersByTime(10_000); // would be ~4 more fires without the fix
    expect(subGain.gain.setTargetAtTime.mock.calls.length).toBe(callsBefore);
  });

  it("does not close the shared AudioContext (AudioEngine owns it)", () => {
    const { ve, ctx } = armedEngine();
    ve.dispose();
    expect(ctx.close).not.toHaveBeenCalled();
  });

  it("disconnects its owned nodes", () => {
    const { ve, gains } = armedEngine();
    ve.dispose();
    expect(gains[0].disconnect).toHaveBeenCalled(); // droneVoiceGain
  });

  it("is idempotent", () => {
    const { ve } = armedEngine();
    ve.dispose();
    expect(() => ve.dispose()).not.toThrow();
  });
});
