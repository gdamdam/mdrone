import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Vitest's node env provides a partial localStorage stub that the
// shared setup's `if (!g.localStorage)` skips over. Force-install a
// real Map-backed shim for this file only so setItem/getItem round-
// trip reliably.
beforeAll(() => {
  const store = new Map<string, string>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size; },
  };
});

import {
  addHoldTime,
  getHoldTime,
  HOLD_TIME_KEY,
  isFlowDone,
  markFlowDone,
  onCloseSettingsRequested,
  onExpandAdvancedRequested,
  onFlowRequested,
  onOfferRequested,
  requestCloseSettings,
  requestExpandAdvanced,
  requestFlow,
  requestOfferFlow,
  resetAllFlows,
  resetFlow,
} from "../../src/tutorial/state";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe("tutorial/state — flow done flags", () => {
  it("defaults every flow to not-done", () => {
    expect(isFlowDone("intro")).toBe(false);
    expect(isFlowDone("advanced")).toBe(false);
    expect(isFlowDone("share")).toBe(false);
  });

  it("marks and reads independently per flow", () => {
    markFlowDone("intro");
    expect(isFlowDone("intro")).toBe(true);
    expect(isFlowDone("advanced")).toBe(false);
    expect(isFlowDone("share")).toBe(false);
    markFlowDone("share");
    expect(isFlowDone("share")).toBe(true);
  });

  it("resetFlow clears only the requested flow", () => {
    markFlowDone("intro");
    markFlowDone("advanced");
    resetFlow("intro");
    expect(isFlowDone("intro")).toBe(false);
    expect(isFlowDone("advanced")).toBe(true);
  });

  it("resetAllFlows clears every flow", () => {
    markFlowDone("intro");
    markFlowDone("advanced");
    markFlowDone("share");
    resetAllFlows();
    expect(isFlowDone("intro")).toBe(false);
    expect(isFlowDone("advanced")).toBe(false);
    expect(isFlowDone("share")).toBe(false);
  });

  it("resetAllFlows wipes legacy keys from previous tutorial iterations", () => {
    localStorage.setItem("mdrone-tutorial-rnd-count", "9");
    localStorage.setItem("mdrone-tutorial-adv-v1", "{}");
    localStorage.setItem("mdrone-tutorial-sessions-v1", "3");
    resetAllFlows();
    expect(localStorage.getItem("mdrone-tutorial-rnd-count")).toBeNull();
    expect(localStorage.getItem("mdrone-tutorial-adv-v1")).toBeNull();
    expect(localStorage.getItem("mdrone-tutorial-sessions-v1")).toBeNull();
  });
});

describe("tutorial/state — HOLD-time accumulator", () => {
  it("starts at 0 and accumulates monotonically", () => {
    expect(getHoldTime()).toBe(0);
    expect(addHoldTime(1000)).toBe(1000);
    expect(addHoldTime(1500)).toBe(2500);
    expect(getHoldTime()).toBe(2500);
  });

  it("clamps negative increments to 0", () => {
    addHoldTime(1000);
    expect(addHoldTime(-500)).toBe(1000);
    expect(getHoldTime()).toBe(1000);
  });

  it("persists under the expected storage key", () => {
    addHoldTime(3000);
    expect(localStorage.getItem(HOLD_TIME_KEY)).toBe("3000");
  });
});

describe("tutorial/state — event buses", () => {
  it("requestFlow dispatches to every subscriber exactly once per call", () => {
    const seen: string[] = [];
    const off = onFlowRequested((id) => seen.push(id));
    requestFlow("intro");
    requestFlow("advanced");
    off();
    requestFlow("share"); // after off — should not arrive
    expect(seen).toEqual(["intro", "advanced"]);
  });

  it("a throwing flow listener does not break other listeners", () => {
    const seen: string[] = [];
    const offA = onFlowRequested(() => { throw new Error("boom"); });
    const offB = onFlowRequested((id) => seen.push(id));
    requestFlow("share");
    offA();
    offB();
    expect(seen).toEqual(["share"]);
  });

  it("requestOfferFlow is distinct from requestFlow", () => {
    const offerSeen: string[] = [];
    const flowSeen: string[] = [];
    const offA = onOfferRequested((id) => offerSeen.push(id));
    const offB = onFlowRequested((id) => flowSeen.push(id));
    requestOfferFlow("effects");
    requestFlow("share");
    offA();
    offB();
    // Offers go only to offer subscribers; full flow starts go only
    // to flow subscribers — no cross-talk.
    expect(offerSeen).toEqual(["effects"]);
    expect(flowSeen).toEqual(["share"]);
  });

  it("requestCloseSettings and requestExpandAdvanced fire their own channels", () => {
    let closeCount = 0;
    let expandCount = 0;
    const offA = onCloseSettingsRequested(() => { closeCount++; });
    const offB = onExpandAdvancedRequested(() => { expandCount++; });
    requestCloseSettings();
    requestExpandAdvanced();
    requestCloseSettings();
    offA();
    offB();
    requestCloseSettings();
    requestExpandAdvanced();
    expect(closeCount).toBe(2);
    expect(expandCount).toBe(1);
  });
});
