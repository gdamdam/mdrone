/**
 * Label-mode preference: the always-visible plain-language captions on
 * the primary Performance surface (HOLD / WEATHER / RND / ATTUNE /
 * MUTATE) are gated by a persisted "plain" | "poetic" preference. Plain
 * is the default so first-time / touch users (who never see hover
 * tooltips) get function labels; experts can switch to poetic to reclaim
 * the spare look. This covers the pure load/save logic; the DOM
 * reflection (applyLabelMode) is verified visually in the running app.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadLabelMode, saveLabelMode, applyLabelMode } from "../../src/labelMode";
import { STORAGE_KEYS } from "../../src/config";

// Node 25 ships a native (but non-functional, file-backed) localStorage
// that shadows tests/unit/setup.ts's mock. Install a working in-memory
// one for this suite, which is the first unit test to round-trip storage.
function installMemoryStorage() {
  const store = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k)! : null),
    setItem: (k, v) => void store.set(k, String(v)),
    removeItem: (k) => void store.delete(k),
    clear: () => store.clear(),
    key: (i) => [...store.keys()][i] ?? null,
    get length() { return store.size; },
  } as Storage;
}

describe("labelMode persistence", () => {
  beforeEach(() => installMemoryStorage());

  it("defaults to plain when nothing is stored", () => {
    expect(loadLabelMode()).toBe("plain");
  });

  it("round-trips a saved mode", () => {
    saveLabelMode("poetic");
    expect(loadLabelMode()).toBe("poetic");
    saveLabelMode("plain");
    expect(loadLabelMode()).toBe("plain");
  });

  it("falls back to plain on an invalid stored value", () => {
    localStorage.setItem(STORAGE_KEYS.labelMode, "garbage");
    expect(loadLabelMode()).toBe("plain");
  });

  it("applyLabelMode does not throw without a document (node env)", () => {
    expect(() => applyLabelMode("poetic")).not.toThrow();
  });
});
