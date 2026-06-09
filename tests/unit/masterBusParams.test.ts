/**
 * Param-smoothing regression for MasterBus.setHpfFreq / setGlueAmount.
 *
 * Every other MasterBus setter (setMasterVolume, setWidth, setTilt, …)
 * schedules with setTargetAtTime so audible params glide instead of
 * jumping. setHpfFreq and setGlueAmount used to assign AudioParam.value
 * directly, which causes zipper noise/clicks when the knob moves while
 * audio is running. These tests pin the scheduled-ramp behaviour.
 *
 * Uses the fake-`this` prototype pattern (see voiceEngineDispose.test.ts):
 * we never construct MasterBus (its ctor needs a full AudioContext graph),
 * we just call the setters against a minimal fake `this`.
 */
import { describe, it, expect, vi } from "vitest";
import { MasterBus } from "../../src/engine/MasterBus";

/* eslint-disable @typescript-eslint/no-explicit-any */

function makeParam(initial = 0) {
  return {
    value: initial,
    setValueAtTime: vi.fn(),
    setTargetAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
    cancelScheduledValues: vi.fn(),
  };
}

function makeFakeBus() {
  return {
    ctx: { currentTime: 1.5 },
    hpf: { frequency: makeParam(18) },
    glueComp: { threshold: makeParam(0) },
    glueMakeup: { gain: makeParam(1) },
  };
}

describe("MasterBus.setHpfFreq", () => {
  it("schedules a ramp instead of assigning .value directly", () => {
    const bus = makeFakeBus();
    MasterBus.prototype.setHpfFreq.call(bus as any, 80);
    // Direct .value writes mid-flight are the zipper-noise bug.
    expect(bus.hpf.frequency.value).toBe(18);
    expect(bus.hpf.frequency.setTargetAtTime).toHaveBeenCalledTimes(1);
    const [target, when, tc] = bus.hpf.frequency.setTargetAtTime.mock.calls[0];
    expect(target).toBe(80);
    expect(when).toBe(1.5);
    expect(tc).toBeGreaterThan(0);
  });

  it("clamps to the 10 Hz floor before scheduling", () => {
    const bus = makeFakeBus();
    MasterBus.prototype.setHpfFreq.call(bus as any, 5);
    expect(bus.hpf.frequency.setTargetAtTime).toHaveBeenCalledWith(
      10, expect.any(Number), expect.any(Number),
    );
  });
});

describe("MasterBus.setGlueAmount", () => {
  it("schedules ramps on threshold and makeup instead of assigning .value", () => {
    const bus = makeFakeBus();
    MasterBus.prototype.setGlueAmount.call(bus as any, 0.5);
    expect(bus.glueComp.threshold.value).toBe(0);
    expect(bus.glueMakeup.gain.value).toBe(1);
    expect(bus.glueComp.threshold.setTargetAtTime).toHaveBeenCalledWith(
      -9, 1.5, expect.any(Number),
    );
    expect(bus.glueMakeup.gain.setTargetAtTime).toHaveBeenCalledWith(
      1.25, 1.5, expect.any(Number),
    );
  });

  it("clamps amount to [0, 1] before scheduling", () => {
    const bus = makeFakeBus();
    MasterBus.prototype.setGlueAmount.call(bus as any, 2);
    expect(bus.glueComp.threshold.setTargetAtTime).toHaveBeenCalledWith(
      -18, expect.any(Number), expect.any(Number),
    );
    expect(bus.glueMakeup.gain.setTargetAtTime).toHaveBeenCalledWith(
      1.5, expect.any(Number), expect.any(Number),
    );
  });
});
