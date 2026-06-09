import { describe, it, expect, vi } from "vitest";
import {
  clampDichoticCents,
  clampEntrainRate,
  DEFAULT_ENTRAIN,
  describeEntrain,
  dichoticCentsForFrequency,
  ENTRAIN_LANDMARKS,
  ENTRAIN_MAX_HZ,
  ENTRAIN_MIN_HZ,
  normalizeEntrain,
  phaseLockedRate,
  zoneColorForHz,
  zoneGradientCss,
} from "../../src/entrain";
import { MotionEngine } from "../../src/engine/MotionEngine";
import { VoiceEngine } from "../../src/engine/VoiceEngine";

describe("entrain: clampEntrainRate", () => {
  it("clamps to the defined band", () => {
    expect(clampEntrainRate(-10)).toBe(ENTRAIN_MIN_HZ);
    expect(clampEntrainRate(0)).toBe(ENTRAIN_MIN_HZ);
    expect(clampEntrainRate(1000)).toBe(ENTRAIN_MAX_HZ);
  });
  it("returns finite values unchanged inside band", () => {
    expect(clampEntrainRate(10)).toBe(10);
    expect(clampEntrainRate(ENTRAIN_MIN_HZ)).toBe(ENTRAIN_MIN_HZ);
    expect(clampEntrainRate(ENTRAIN_MAX_HZ)).toBe(ENTRAIN_MAX_HZ);
  });
  it("falls back to default for NaN", () => {
    expect(clampEntrainRate(NaN)).toBe(DEFAULT_ENTRAIN.rateHz);
  });
});

describe("entrain: clampDichoticCents", () => {
  it("clamps negatives to zero and cap to 40", () => {
    expect(clampDichoticCents(-5)).toBe(0);
    expect(clampDichoticCents(100)).toBe(40);
  });
});

describe("entrain: zoneColorForHz", () => {
  it("returns distinct colors at zone centers", () => {
    const colors = new Set([
      zoneColorForHz(1),   // delta
      zoneColorForHz(6),   // theta
      zoneColorForHz(10),  // alpha
      zoneColorForHz(13),  // SMR/beta-edge
      zoneColorForHz(20),  // beta
      zoneColorForHz(40),  // gamma
    ]);
    expect(colors.size).toBe(6);
  });

  it("has sharp but well-defined band boundaries", () => {
    expect(zoneColorForHz(3.99)).toBe(zoneColorForHz(1));
    expect(zoneColorForHz(4)).toBe(zoneColorForHz(6));
    expect(zoneColorForHz(7.99)).toBe(zoneColorForHz(6));
    expect(zoneColorForHz(8)).toBe(zoneColorForHz(10));
    expect(zoneColorForHz(29.99)).toBe(zoneColorForHz(20));
    expect(zoneColorForHz(30)).toBe(zoneColorForHz(40));
  });
});

describe("entrain: zoneGradientCss", () => {
  it("emits a CSS linear-gradient covering 0..100% of the slider range", () => {
    const css = zoneGradientCss();
    expect(css.startsWith("linear-gradient(to right,")).toBe(true);
    expect(css).toContain("0.00%");
    expect(css).toContain("100.00%");
  });
});

describe("entrain: phaseLockedRate", () => {
  it("returns k=0 when breathing is stopped", () => {
    const r = phaseLockedRate(0, 10);
    expect(r.k).toBe(0);
    expect(r.lockedHz).toBe(10);
  });

  it("returns k=0 for negative / non-finite breathingHz", () => {
    expect(phaseLockedRate(-1, 5).k).toBe(0);
    expect(phaseLockedRate(NaN, 5).k).toBe(0);
  });

  it("integer-locks gamma to slow breathing", () => {
    const r = phaseLockedRate(2, 40);
    expect(r.k).toBe(20);
    expect(r.lockedHz).toBe(40);
  });

  it("snaps the entrain rate to the nearest breathing multiple", () => {
    // request 11 Hz against a 2 Hz breathing → k=6 → locked 12 Hz
    const r = phaseLockedRate(2, 11);
    expect(r.k).toBe(6);
    expect(r.lockedHz).toBe(12);
  });

  it("floors k at 1 when entrainHz < breathingHz", () => {
    const r = phaseLockedRate(5, 1);
    expect(r.k).toBe(1);
    expect(r.lockedHz).toBe(5);
  });

  it("clamps the requested entrain rate before locking", () => {
    const r = phaseLockedRate(1, 999);
    expect(r.lockedHz).toBeLessThanOrEqual(ENTRAIN_MAX_HZ + 1);
    expect(r.k).toBe(Math.round(ENTRAIN_MAX_HZ / 1));
  });
});

describe("entrain: dichoticCentsForFrequency", () => {
  it("matches 1200·log2(1 + Δf/f)", () => {
    const cases: Array<[number, number]> = [
      [1, 220], [8, 220], [8, 440], [4, 880], [40, 110],
    ];
    for (const [rateHz, f] of cases) {
      expect(dichoticCentsForFrequency(rateHz, f)).toBeCloseTo(
        1200 * Math.log2(1 + rateHz / f),
        9,
      );
    }
  });

  it("inverts back to a constant beat in Hz at any carrier", () => {
    const impliedBeatHz = (f: number, cents: number) =>
      f * (Math.pow(2, cents / 1200) - 1);
    for (const f of [55, 220, 440, 880]) {
      expect(impliedBeatHz(f, dichoticCentsForFrequency(8, f))).toBeCloseTo(8, 6);
    }
  });

  it("returns 0 for degenerate inputs", () => {
    expect(dichoticCentsForFrequency(NaN, 220)).toBe(0);
    expect(dichoticCentsForFrequency(8, NaN)).toBe(0);
    expect(dichoticCentsForFrequency(-1, 220)).toBe(0);
    expect(dichoticCentsForFrequency(0, 220)).toBe(0);
    expect(dichoticCentsForFrequency(8, 0)).toBe(0);
    expect(dichoticCentsForFrequency(8, -220)).toBe(0);
  });
});

/**
 * Engine-level dichotic fan-out — tested against the prototypes with a
 * minimal fake `this` (same spirit as engine.test.ts). AudioEngine's
 * call order is fixed: motionEngine.setEntrain(state) first, then
 * voiceEngine.setDichoticCents(gateCents); these harnesses mirror that.
 */
function makeFakeMotion() {
  return Object.assign(Object.create(MotionEngine.prototype) as MotionEngine, {
    entrainState: { ...DEFAULT_ENTRAIN },
    // null LFO → applyEntrain() early-returns; the AM path has its own
    // harness below.
    entrainLfo: null,
  });
}

function makeFakeVoiceEngine(rootHz: number, intervalsCents: number[]) {
  const voices = intervalsCents.map(() => ({ setDichoticCents: vi.fn() }));
  const ve = Object.assign(Object.create(VoiceEngine.prototype) as VoiceEngine, {
    droneRootFreq: rootHz,
    droneIntervalsCents: intervalsCents,
    droneVoicesByLayer: new Map([["reed", voices]]),
    dichoticCents: 0,
  });
  return { ve, voices };
}

describe("entrain: dichotic detune is fixed-Hz, not fixed-cents", () => {
  /** Cents the engine actually posts to a voice at `rootHz` after the
   *  AudioEngine.setEntrain fan-out sequence. */
  function appliedCents(rootHz: number, rateHz: number): number {
    const motion = makeFakeMotion();
    motion.setEntrain({
      ...DEFAULT_ENTRAIN, enabled: true, mode: "dichotic", rateHz,
    });
    const { ve, voices } = makeFakeVoiceEngine(rootHz, [0]);
    // The user's spread knob value AudioEngine fans out — it gates the
    // effect on/off; the magnitude must come from rateHz.
    ve.setDichoticCents(DEFAULT_ENTRAIN.dichoticCents);
    const calls = voices[0].setDichoticCents.mock.calls;
    return calls[calls.length - 1][0] as number;
  }

  const impliedBeatHz = (f: number, cents: number) =>
    f * (Math.pow(2, cents / 1200) - 1);

  it("implies the same interaural beat in Hz at 220 Hz and 880 Hz for the same rateHz", () => {
    // Repro for the fixed-cents bug: a constant ~8¢ detune beats at
    // ~1 Hz on a 220 Hz voice but ~4 Hz at 880 Hz, so the user's
    // chosen rate never governed the beat.
    const rateHz = 8;
    const beat220 = impliedBeatHz(220, appliedCents(220, rateHz));
    const beat880 = impliedBeatHz(880, appliedCents(880, rateHz));
    expect(beat220).toBeCloseTo(rateHz, 6);
    expect(beat880).toBeCloseTo(rateHz, 6);
    expect(beat220).toBeCloseTo(beat880, 6);
  });

  it("derives per-voice cents from each voice's own frequency, not just the root", () => {
    const motion = makeFakeMotion();
    motion.setEntrain({
      ...DEFAULT_ENTRAIN, enabled: true, mode: "dichotic", rateHz: 8,
    });
    // Root + a fifth (702¢): the upper voice needs proportionally
    // fewer cents to keep the same Hz difference.
    const { ve, voices } = makeFakeVoiceEngine(220, [0, 702]);
    ve.setDichoticCents(DEFAULT_ENTRAIN.dichoticCents);
    const upperHz = 220 * Math.pow(2, 702 / 1200);
    expect(voices[0].setDichoticCents).toHaveBeenLastCalledWith(
      dichoticCentsForFrequency(8, 220),
    );
    expect(voices[1].setDichoticCents).toHaveBeenLastCalledWith(
      dichoticCentsForFrequency(8, upperHz),
    );
    expect(impliedBeatHz(upperHz, dichoticCentsForFrequency(8, upperHz))).toBeCloseTo(8, 6);
  });

  it("still gates fully off when AudioEngine fans out 0", () => {
    const motion = makeFakeMotion();
    motion.setEntrain({
      ...DEFAULT_ENTRAIN, enabled: true, mode: "dichotic", rateHz: 8,
    });
    const { ve, voices } = makeFakeVoiceEngine(220, [0]);
    ve.setDichoticCents(0);
    expect(voices[0].setDichoticCents).toHaveBeenLastCalledWith(0);
  });
});

describe("entrain: AM mode engine outputs (regression guard)", () => {
  // AM behaviour must be byte-identical before/after the dichotic
  // fixed-Hz change — these pin the existing rate lock + depth curve.
  function makeFakeParam() {
    return { value: 0, setTargetAtTime: vi.fn() };
  }

  function makeAmMotion(userLfoRate = 0.4) {
    const freq = makeFakeParam();
    const depth = makeFakeParam();
    const motion = Object.assign(Object.create(MotionEngine.prototype) as MotionEngine, {
      ctx: { currentTime: 0 },
      entrainState: { ...DEFAULT_ENTRAIN },
      entrainLfo: { frequency: freq },
      entrainLfoDepth: { gain: depth },
      entrainBaseDepth: 0.15,
      baseMacroTC: 0.4,
      morphAmount: 0.25,
      userLfoRate,
    });
    return { motion, freq, depth };
  }

  it("integer-locks the AM rate to breathing and applies full base depth at 8 Hz", () => {
    const { motion, freq, depth } = makeAmMotion(0.4);
    motion.setEntrain({ enabled: true, rateHz: 8, mode: "am", dichoticCents: 8, amDepth: 1 });
    expect(freq.setTargetAtTime).toHaveBeenLastCalledWith(
      expect.closeTo(8, 9), 0, expect.any(Number),
    );
    expect(depth.setTargetAtTime).toHaveBeenLastCalledWith(
      expect.closeTo(0.15, 9), 0, expect.any(Number),
    );
  });

  it("scales AM depth down at slow rates (2 Hz → quarter depth)", () => {
    const { motion, depth } = makeAmMotion(0.4);
    motion.setEntrain({ enabled: true, rateHz: 2, mode: "am", dichoticCents: 8, amDepth: 1 });
    expect(depth.setTargetAtTime).toHaveBeenLastCalledWith(
      expect.closeTo(0.15 * 0.25, 9), 0, expect.any(Number),
    );
  });

  it("keeps AM depth at zero in dichotic-only mode", () => {
    const { motion, depth } = makeAmMotion(0.4);
    motion.setEntrain({ enabled: true, rateHz: 8, mode: "dichotic", dichoticCents: 8, amDepth: 1 });
    expect(depth.setTargetAtTime).toHaveBeenLastCalledWith(0, 0, expect.any(Number));
  });
});

describe("entrain: normalizeEntrain", () => {
  it("returns defaults for bogus input", () => {
    expect(normalizeEntrain(null)).toEqual(DEFAULT_ENTRAIN);
    expect(normalizeEntrain("nope")).toEqual(DEFAULT_ENTRAIN);
    expect(normalizeEntrain(42)).toEqual(DEFAULT_ENTRAIN);
  });

  it("salvages partial objects", () => {
    expect(normalizeEntrain({ rateHz: 10 })).toEqual({
      enabled: DEFAULT_ENTRAIN.enabled,
      rateHz: 10,
      mode: DEFAULT_ENTRAIN.mode,
      dichoticCents: DEFAULT_ENTRAIN.dichoticCents,
      amDepth: DEFAULT_ENTRAIN.amDepth,
    });
  });

  it("clamps out-of-range fields", () => {
    const s = normalizeEntrain({ rateHz: 9999, mode: "both", dichoticCents: 9999 });
    expect(s.rateHz).toBe(ENTRAIN_MAX_HZ);
    expect(s.mode).toBe("both");
    expect(s.dichoticCents).toBe(40);
  });

  it("preserves the enabled flag when present, defaults to off otherwise", () => {
    expect(normalizeEntrain({ enabled: true }).enabled).toBe(true);
    expect(normalizeEntrain({ enabled: false }).enabled).toBe(false);
    expect(normalizeEntrain({}).enabled).toBe(DEFAULT_ENTRAIN.enabled);
    expect(DEFAULT_ENTRAIN.enabled).toBe(false);
  });

  it("ignores non-boolean enabled values", () => {
    expect(normalizeEntrain({ enabled: "yes" as unknown }).enabled).toBe(DEFAULT_ENTRAIN.enabled);
    expect(normalizeEntrain({ enabled: 1 as unknown }).enabled).toBe(DEFAULT_ENTRAIN.enabled);
  });

  it("rejects unknown mode strings", () => {
    const s = normalizeEntrain({ mode: "wobble" });
    expect(s.mode).toBe(DEFAULT_ENTRAIN.mode);
  });
});

describe("entrain: ENTRAIN_LANDMARKS", () => {
  it("sits inside the slider range", () => {
    for (const m of ENTRAIN_LANDMARKS) {
      expect(m.hz).toBeGreaterThanOrEqual(ENTRAIN_MIN_HZ);
      expect(m.hz).toBeLessThanOrEqual(ENTRAIN_MAX_HZ);
    }
  });

  it("flags Schumann 7.83 as cultural, not scientific", () => {
    const schumann = ENTRAIN_LANDMARKS.find((m) => Math.abs(m.hz - 7.83) < 0.01);
    expect(schumann).toBeDefined();
    expect(schumann?.cultural).toBe(true);
  });
});

describe("entrain: describeEntrain", () => {
  const off = { ...DEFAULT_ENTRAIN, enabled: false };
  const on = (overrides: Partial<typeof DEFAULT_ENTRAIN> = {}) =>
    ({ ...DEFAULT_ENTRAIN, enabled: true, ...overrides });

  it("still describes the state when disabled, prefixed with (off)", () => {
    const text = describeEntrain({ ...off, rateHz: 10 }, 0.4);
    expect(text).toMatch(/\(off\)/);
    expect(text).toMatch(/alpha/);
  });

  it("omits the (off) marker when enabled", () => {
    const text = describeEntrain(on({ rateHz: 10 }), 0.4);
    expect(text).not.toMatch(/\(off\)/);
  });

  it("picks a rate descriptor that matches the band", () => {
    expect(describeEntrain(on({ rateHz: 2  }), 0.4)).toMatch(/slow swell/);
    expect(describeEntrain(on({ rateHz: 6  }), 0.4)).toMatch(/theta/);
    expect(describeEntrain(on({ rateHz: 10 }), 0.4)).toMatch(/alpha/);
    expect(describeEntrain(on({ rateHz: 16 }), 0.4)).toMatch(/low-beta/);
    expect(describeEntrain(on({ rateHz: 25 }), 0.4)).toMatch(/beta-band flutter/);
    expect(describeEntrain(on({ rateHz: 40 }), 0.4)).toMatch(/gamma/);
  });

  it("mentions headphones in dichotic mode", () => {
    const text = describeEntrain(on({ mode: "dichotic", dichoticCents: 8 }), 0.4);
    expect(text).toMatch(/headphones/);
    expect(text).toMatch(/±4\.0/);
  });

  it("composes both descriptors in BOTH mode", () => {
    const text = describeEntrain(on({ mode: "both", rateHz: 10, dichoticCents: 8 }), 0.4);
    expect(text).toMatch(/alpha/);
    expect(text).toMatch(/headphones/);
  });

  it("includes the lock multiplier when breathing is active", () => {
    const text = describeEntrain(on({ rateHz: 10 }), 2);
    expect(text).toMatch(/locked ×\d+/);
  });

  it("omits the lock note when breathing is stopped", () => {
    const text = describeEntrain(on({ rateHz: 10 }), 0);
    expect(text).not.toMatch(/locked/);
  });
});
