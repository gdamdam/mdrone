import { describe, it, expect } from "vitest";
import {
  PARTNER_RELATIONS,
  partnerCents,
  withPartnerIntervals,
  DEFAULT_PARTNER,
} from "../../src/partner";
import { normalizePortableScene } from "../../src/session";

describe("partnerCents", () => {
  it("returns the canonical cent offsets per relation", () => {
    expect(partnerCents("fifth")).toBe(702);
    expect(partnerCents("octave-up")).toBe(1200);
    expect(partnerCents("octave-down")).toBe(-1200);
    expect(partnerCents("beat-detune")).toBe(7);
  });

  it("returns a finite number for every shipped relation", () => {
    for (const r of PARTNER_RELATIONS) {
      const c = partnerCents(r);
      expect(Number.isFinite(c)).toBe(true);
    }
  });
});

describe("withPartnerIntervals", () => {
  it("returns a copy of the main intervals when partner disabled", () => {
    const main = [0, 700, 1200];
    const out = withPartnerIntervals(main, { enabled: false, relation: "fifth" });
    expect(out).toEqual(main);
    expect(out).not.toBe(main);
  });

  it("appends mirrored cents at the partner offset when enabled", () => {
    const main = [0, 700];
    const out = withPartnerIntervals(main, { enabled: true, relation: "fifth" });
    expect(out).toEqual([0, 700, 702, 1402]);
  });

  it("doubles the voice count when enabled", () => {
    const main = [0, 100, 200, 300];
    const out = withPartnerIntervals(main, { enabled: true, relation: "octave-up" });
    expect(out).toHaveLength(main.length * 2);
  });

  it("supports negative offsets (octave-down)", () => {
    const main = [0, 700];
    const out = withPartnerIntervals(main, { enabled: true, relation: "octave-down" });
    expect(out).toEqual([0, 700, -1200, -500]);
  });

  it("beat-detune adds a small +7 ¢ companion to each main interval", () => {
    const main = [0, 700];
    const out = withPartnerIntervals(main, { enabled: true, relation: "beat-detune" });
    expect(out).toEqual([0, 700, 7, 707]);
  });
});

describe("Partner share round-trip", () => {
  it("defaults to disabled when missing", () => {
    const scene = normalizePortableScene({ drone: {}, mixer: {} });
    expect(scene!.drone.partner).toEqual(DEFAULT_PARTNER);
  });

  it("preserves a custom partner config", () => {
    const scene = normalizePortableScene({
      drone: { partner: { enabled: true, relation: "octave-up" } },
      mixer: {},
    });
    expect(scene!.drone.partner.enabled).toBe(true);
    expect(scene!.drone.partner.relation).toBe("octave-up");
  });

  it("rejects unknown relation values and falls back to default", () => {
    const scene = normalizePortableScene({
      drone: { partner: { enabled: true, relation: "totally-invalid" } },
      mixer: {},
    });
    expect(scene!.drone.partner.enabled).toBe(true);
    expect(scene!.drone.partner.relation).toBe(DEFAULT_PARTNER.relation);
  });

  it("ignores partner field that isn't a record", () => {
    const scene = normalizePortableScene({
      drone: { partner: "nope" as unknown },
      mixer: {},
    });
    expect(scene!.drone.partner).toEqual(DEFAULT_PARTNER);
  });
});
