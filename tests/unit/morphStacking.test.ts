/**
 * Regression: a second morphRun() arriving while the first is still fading
 * captured the transient (near-zero) master level as the volume to restore,
 * leaving the master quiet or silent after the second morph.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AudioEngine } from "../../src/engine/AudioEngine";

/* eslint-disable @typescript-eslint/no-explicit-any */

describe("AudioEngine.morphRun stacked morphs", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function makeSelf() {
    const trim = {
      value: 0.8,
      cancelScheduledValues: vi.fn(),
      setValueAtTime: vi.fn(),
      linearRampToValueAtTime: vi.fn(),
    };
    // AudioEngine's constructor needs a real AudioContext graph, so drive
    // the method against a hand-built receiver.
    const self: any = {
      ctx: { currentTime: 0 },
      masterBus: { getOutputTrim: () => ({ gain: trim }) },
      startMasterFade: vi.fn(),
      morphTimeout: null,
      morphRestore: null,
    };
    return { self, trim };
  }
  const morph = (self: any, seconds: number) =>
    (AudioEngine.prototype as any).morphRun.call(self, () => {}, seconds);

  it("restores the pre-morph level when re-triggered during the fade-out", () => {
    const { self, trim } = makeSelf();
    morph(self, 2);
    trim.value = 0.3; // mid fade-out
    self.ctx.currentTime = 0.5;
    morph(self, 2);
    trim.value = 0; // fade-out finished
    vi.advanceTimersByTime(1000);
    expect(trim.linearRampToValueAtTime).toHaveBeenLastCalledWith(0.8, expect.any(Number));
  });

  it("restores the pre-morph level when re-triggered during the fade-in", () => {
    const { self, trim } = makeSelf();
    morph(self, 2);
    trim.value = 0;
    vi.advanceTimersByTime(1000); // midpoint: fade-in to 0.8 scheduled
    self.ctx.currentTime = 0.2; // still inside the fade-in (ends at 1.0)
    trim.value = 0.1;
    morph(self, 2);
    trim.value = 0;
    vi.advanceTimersByTime(1000);
    expect(trim.linearRampToValueAtTime).toHaveBeenLastCalledWith(0.8, expect.any(Number));
  });
});
