import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// shareRelay caches health state at module scope, so each test re-imports
// a fresh copy via vi.resetModules() + dynamic import to start clean.
async function freshRelay() {
  vi.resetModules();
  return import("../../src/shareRelay");
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("checkRelayHealth caching", () => {
  it("retries shortly after a transient failure instead of negative-caching for 60s", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("network blip"))
      .mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    const { checkRelayHealth } = await freshRelay();

    expect(await checkRelayHealth()).toBe(false);
    // Well past a short negative TTL, well short of the 60s positive TTL.
    vi.advanceTimersByTime(10_000);
    expect(await checkRelayHealth()).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps a healthy result cached for the positive TTL", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    const { checkRelayHealth } = await freshRelay();

    expect(await checkRelayHealth()).toBe(true);
    vi.advanceTimersByTime(30_000);
    expect(await checkRelayHealth()).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("still caches an unhealthy result briefly (no hammering within the negative TTL)", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("down"));
    vi.stubGlobal("fetch", fetchMock);
    const { checkRelayHealth } = await freshRelay();

    expect(await checkRelayHealth()).toBe(false);
    vi.advanceTimersByTime(1_000);
    expect(await checkRelayHealth()).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
