import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetAnalyticsForTest,
  flickerZone,
  trackEvent,
  wasEventFired,
} from "../../src/analytics";

interface MockGc {
  count: ReturnType<typeof vi.fn>;
  filter?: () => string | false;
}

declare global {
  // eslint-disable-next-line no-var
  var goatcounter: MockGc | undefined;
}

beforeEach(() => {
  __resetAnalyticsForTest();
  globalThis.goatcounter = { count: vi.fn() };
});

afterEach(() => {
  delete globalThis.goatcounter;
});

describe("trackEvent: dedupe", () => {
  it("fires exactly once per (path) per page-load", () => {
    trackEvent("preset/dream-house");
    trackEvent("preset/dream-house");
    trackEvent("preset/dream-house");
    expect(globalThis.goatcounter!.count).toHaveBeenCalledTimes(1);
  });

  it("fires distinct events independently", () => {
    trackEvent("preset/dream-house");
    trackEvent("preset/stone-organ");
    expect(globalThis.goatcounter!.count).toHaveBeenCalledTimes(2);
  });

  it("exposes wasEventFired for call-site short-circuiting", () => {
    expect(wasEventFired("view/meditate")).toBe(false);
    trackEvent("view/meditate");
    expect(wasEventFired("view/meditate")).toBe(true);
  });
});

describe("trackEvent: guards", () => {
  it("is a no-op when goatcounter is absent", () => {
    delete globalThis.goatcounter;
    expect(() => trackEvent("preset/x")).not.toThrow();
  });

  it("is a no-op when path is empty", () => {
    trackEvent("");
    expect(globalThis.goatcounter!.count).not.toHaveBeenCalled();
  });

  it("respects goatcounter.filter() returning a reason", () => {
    globalThis.goatcounter!.filter = () => "bot";
    trackEvent("preset/y");
    expect(globalThis.goatcounter!.count).not.toHaveBeenCalled();
  });

  it("still counts when filter returns false (i.e. allow)", () => {
    globalThis.goatcounter!.filter = () => false;
    trackEvent("preset/z");
    expect(globalThis.goatcounter!.count).toHaveBeenCalledTimes(1);
  });

  it("swallows count() exceptions silently", () => {
    globalThis.goatcounter!.count = vi.fn(() => { throw new Error("boom"); });
    expect(() => trackEvent("preset/err")).not.toThrow();
  });

  it("passes event:true in the payload", () => {
    trackEvent("share/created", "Share URL created");
    expect(globalThis.goatcounter!.count).toHaveBeenCalledWith({
      path: "share/created",
      title: "Share URL created",
      event: true,
    });
  });

  it("defaults title to path when omitted", () => {
    trackEvent("share/loaded");
    expect(globalThis.goatcounter!.count).toHaveBeenCalledWith(
      expect.objectContaining({ title: "share/loaded" }),
    );
  });
});

describe("flickerZone", () => {
  it("maps Hz to the five EEG band labels", () => {
    expect(flickerZone(1)).toBe("delta");
    expect(flickerZone(3.99)).toBe("delta");
    expect(flickerZone(4)).toBe("theta");
    expect(flickerZone(6)).toBe("theta");
    expect(flickerZone(8)).toBe("alpha");
    expect(flickerZone(11.99)).toBe("alpha");
    expect(flickerZone(12)).toBe("beta");
    expect(flickerZone(20)).toBe("beta");
    expect(flickerZone(30)).toBe("gamma");
    expect(flickerZone(40)).toBe("gamma");
  });
});
