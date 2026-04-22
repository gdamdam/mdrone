import { describe, it, expect } from "vitest";
import {
  clampDichoticCents,
  clampEntrainRate,
  DEFAULT_ENTRAIN,
  describeEntrain,
  ENTRAIN_LANDMARKS,
  ENTRAIN_MAX_HZ,
  ENTRAIN_MIN_HZ,
  normalizeEntrain,
  phaseLockedRate,
  zoneColorForHz,
  zoneGradientCss,
} from "../../src/entrain";

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
