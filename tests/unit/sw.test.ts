/**
 * Service worker (public/sw.js) navigation strategy tests.
 *
 * sw.js is hand-written plain JS, so — like root-router.test.ts — it is
 * evaluated in a vm sandbox with mocked self/caches/fetch and the fetch
 * handler is captured for direct invocation.
 *
 * Regression coverage for the lie-fi bug: a navigation fetch that hangs
 * indefinitely must fall back to the cached app shell after the timeout
 * budget instead of leaving the user on a blank page.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import vm from "node:vm";
import fs from "node:fs";

const SW_SOURCE = fs.readFileSync(
  new URL("../../public/sw.js", import.meta.url),
  "utf8",
);

/* eslint-disable @typescript-eslint/no-explicit-any */

function loadSw(opts: {
  fetchImpl: (req: unknown) => Promise<Response>;
  matchImpl: (key: unknown) => Promise<Response | undefined>;
}) {
  const listeners = new Map<string, (event: any) => void>();
  const sandbox = {
    self: {
      addEventListener: (type: string, fn: (e: any) => void) =>
        listeners.set(type, fn),
      location: { origin: "https://mdrone.org" },
      clients: { claim: async () => {} },
      skipWaiting: () => {},
    },
    caches: {
      open: async () => ({
        match: async () => undefined,
        put: async () => {},
        add: async () => {},
      }),
      match: opts.matchImpl,
      keys: async () => [],
      delete: async () => true,
    },
    fetch: opts.fetchImpl,
    URL,
    Response,
    // Route timers through the host so vi.useFakeTimers() controls them.
    setTimeout: (fn: () => void, ms?: number) => setTimeout(fn, ms),
    clearTimeout: (id: unknown) => clearTimeout(id as NodeJS.Timeout),
  };
  vm.createContext(sandbox);
  vm.runInContext(SW_SOURCE, sandbox);
  return { listeners };
}

// Fires the captured fetch handler and reports the response it settles with.
function dispatchFetch(
  listeners: Map<string, (event: any) => void>,
  request: unknown,
): { get: () => Response | null } {
  let resolved: Response | null = null;
  listeners.get("fetch")!({
    request,
    respondWith: (p: Promise<Response>) => {
      void p.then((r) => {
        resolved = r;
      });
    },
  });
  return { get: () => resolved };
}

describe("sw.js navigation handler", () => {
  const navRequest = {
    method: "GET",
    url: "https://mdrone.org/app.html",
    mode: "navigate",
  };

  afterEach(() => {
    vi.useRealTimers();
  });

  it("falls back to the cached shell when the network exceeds the timeout (lie-fi)", async () => {
    vi.useFakeTimers();
    const shell = new Response("<html>shell</html>");
    const { listeners } = loadSw({
      // Lie-fi: the request never settles — neither success nor failure.
      fetchImpl: () => new Promise<Response>(() => {}),
      matchImpl: async (key) => (key === "./app.html" ? shell : undefined),
    });

    const answer = dispatchFetch(listeners, navRequest);
    // Well past any reasonable network budget the SW must have answered.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(answer.get()).toBe(shell);
  });

  it("returns the network response when the network answers in time", async () => {
    vi.useFakeTimers();
    const fresh = new Response("fresh");
    const { listeners } = loadSw({
      fetchImpl: async () => fresh,
      matchImpl: async () => undefined,
    });

    const answer = dispatchFetch(listeners, navRequest);
    await vi.advanceTimersByTimeAsync(1);
    expect(answer.get()).toBe(fresh);
  });
});
