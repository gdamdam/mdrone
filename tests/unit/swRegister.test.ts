/**
 * Client-side SW lifecycle tests (src/swRegister.ts).
 *
 * Regression coverage for the first-install reload bug: clients.claim()
 * in sw.js fires `controllerchange` on the very FIRST install too, and
 * an unconditional reload there kills audio for a first-time visitor
 * who already started a drone. A reload is only correct when a
 * controller existed before registration (a genuine update takeover).
 *
 * navigator.serviceWorker / location / document are stubbed; the mock
 * captures listeners so tests can fire `controllerchange` directly.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { applyUpdateAndReload, registerServiceWorker } from "../../src/swRegister";

function makeServiceWorkerMock(controller: object | null) {
  const listeners: Record<string, Array<() => void>> = {};
  const reg = { waiting: null, installing: null, addEventListener: vi.fn() };
  const swc = {
    controller,
    register: vi.fn().mockResolvedValue(reg),
    getRegistration: vi.fn().mockResolvedValue(reg),
    addEventListener: (type: string, fn: () => void) => {
      (listeners[type] ||= []).push(fn);
    },
  };
  return {
    swc,
    fire: (type: string) => (listeners[type] ?? []).forEach((fn) => fn()),
  };
}

function stubBrowser(swc: object): { reload: ReturnType<typeof vi.fn> } {
  const reload = vi.fn();
  vi.stubGlobal("navigator", { serviceWorker: swc });
  // Non-dev hostname so registration isn't skipped; readyState complete
  // so run() executes synchronously instead of waiting for "load".
  vi.stubGlobal("location", {
    hostname: "mdrone.org",
    protocol: "https:",
    reload,
  });
  vi.stubGlobal("document", { readyState: "complete" });
  return { reload };
}

// register() resolves asynchronously; drain microtasks so the
// controllerchange listener is attached before tests fire the event.
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("swRegister controllerchange handling", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not reload on first-install controllerchange (no prior controller)", async () => {
    const { swc, fire } = makeServiceWorkerMock(null);
    const { reload } = stubBrowser(swc);

    registerServiceWorker();
    await flush();

    // clients.claim() on first activate: the page gains its first controller.
    swc.controller = {};
    fire("controllerchange");

    expect(reload).not.toHaveBeenCalled();
  });

  it("reloads once on controllerchange when a controller already existed (real update)", async () => {
    const { swc, fire } = makeServiceWorkerMock({});
    const { reload } = stubBrowser(swc);

    registerServiceWorker();
    await flush();

    fire("controllerchange");
    fire("controllerchange");

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("reloads after a user-requested update even when no controller existed at registration", async () => {
    // First-visit tab kept open for hours (typical drone session):
    // hadController was captured false at registration, but the user
    // explicitly clicked the update banner — SKIP_WAITING fires
    // controllerchange and the reload MUST happen, or the old page
    // keeps running against the new SW's cache.
    const { swc, fire } = makeServiceWorkerMock(null);
    const { reload } = stubBrowser(swc);

    registerServiceWorker();
    await flush();

    // First-install claim: no reload (still correct).
    swc.controller = {};
    fire("controllerchange");
    expect(reload).not.toHaveBeenCalled();

    // Hours later: update banner clicked; a waiting SW exists.
    (swc.getRegistration as ReturnType<typeof vi.fn>).mockResolvedValue({
      waiting: { postMessage: vi.fn() },
    });
    applyUpdateAndReload();
    await flush();

    fire("controllerchange");
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
