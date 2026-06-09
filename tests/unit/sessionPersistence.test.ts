import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  autosaveSceneTick,
  normalizePortableScene,
  resetAllLocalStorage,
  saveAutosavedScene,
  saveSessions,
  withSnapshotDefaults,
  type DroneSessionSnapshot,
  type PortableScene,
  type SavedSession,
} from "../../src/session";
import { STORAGE_KEYS } from "../../src/config";

/**
 * Persistence regression tests:
 * - localStorage writes must not throw on quota/private-mode failures
 *   and must report success so callers can retry (autosave lost-write).
 * - factory reset must sweep the dot-namespaced meditate key.
 * - normalizePortableScene must reject scenes from a newer client
 *   (version > 1) instead of silently coercing them.
 */

// Node 25 ships a native (but non-functional, file-backed) localStorage
// that shadows tests/unit/setup.ts's mock. Install a working in-memory
// one per test (same pattern as labelMode.test.ts).
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

function makeScene(name = "Test Scene"): PortableScene {
  const scene = normalizePortableScene({ name, drone: {}, mixer: {} });
  if (!scene) throw new Error("fixture scene failed to normalize");
  return scene;
}

function makeSession(id: string): SavedSession {
  return {
    id,
    name: "Test Session",
    savedAt: new Date().toISOString(),
    version: 2,
    scene: makeScene("Test Session"),
  };
}

beforeEach(() => installMemoryStorage());
afterEach(() => vi.restoreAllMocks());

describe("guarded localStorage writes", () => {
  it("saveSessions returns true on success", () => {
    expect(saveSessions([makeSession("a")])).toBe(true);
    expect(localStorage.getItem(STORAGE_KEYS.sessions)).not.toBeNull();
  });

  it("saveSessions returns false instead of throwing when setItem fails", () => {
    vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new DOMException("quota exceeded", "QuotaExceededError");
    });
    expect(() => saveSessions([makeSession("a")])).not.toThrow();
    expect(saveSessions([makeSession("a")])).toBe(false);
  });

  it("saveAutosavedScene returns true on success", () => {
    expect(saveAutosavedScene(makeScene())).toBe(true);
    expect(localStorage.getItem(STORAGE_KEYS.autosave)).not.toBeNull();
  });

  it("saveAutosavedScene returns false instead of throwing when setItem fails", () => {
    vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new DOMException("quota exceeded", "QuotaExceededError");
    });
    expect(() => saveAutosavedScene(makeScene())).not.toThrow();
    expect(saveAutosavedScene(makeScene())).toBe(false);
  });
});

describe("autosaveSceneTick (dirty-check + retry on failure)", () => {
  it("advances the marker after a successful write", () => {
    const scene = makeScene();
    const result = autosaveSceneTick(scene, "");
    expect(result.failed).toBe(false);
    expect(result.marker).toBe(JSON.stringify(scene));
    expect(localStorage.getItem(STORAGE_KEYS.autosave)).not.toBeNull();
  });

  it("skips the write when the scene is unchanged and not forced", () => {
    const scene = makeScene();
    const marker = JSON.stringify(scene);
    const setItem = vi.spyOn(localStorage, "setItem");
    const result = autosaveSceneTick(scene, marker);
    expect(setItem).not.toHaveBeenCalled();
    expect(result).toEqual({ marker, failed: false });
  });

  it("writes even when unchanged if forced", () => {
    const scene = makeScene();
    const marker = JSON.stringify(scene);
    const setItem = vi.spyOn(localStorage, "setItem");
    autosaveSceneTick(scene, marker, true);
    expect(setItem).toHaveBeenCalled();
  });

  it("keeps the dirty marker on write failure so the next tick retries", () => {
    const scene = makeScene();
    const setItem = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new DOMException("quota exceeded", "QuotaExceededError");
    });
    const failed = autosaveSceneTick(scene, "");
    expect(failed.failed).toBe(true);
    // Marker must NOT advance — advancing it before a successful write
    // is the lost-write bug: one quota failure made the loop believe
    // the save succeeded and it never retried.
    expect(failed.marker).toBe("");

    // Storage recovers → the next tick (same scene, same marker) retries
    // and the write lands.
    setItem.mockRestore();
    const retried = autosaveSceneTick(scene, failed.marker);
    expect(retried.failed).toBe(false);
    expect(retried.marker).toBe(JSON.stringify(scene));
    expect(localStorage.getItem(STORAGE_KEYS.autosave)).not.toBeNull();
  });
});

describe("resetAllLocalStorage", () => {
  it("removes dot-namespaced mdrone.* keys (meditate visualizer)", () => {
    localStorage.setItem("mdrone.meditate.visualizer", "rothko");
    localStorage.setItem(STORAGE_KEYS.autosave, "{}");
    localStorage.setItem("unrelated-key", "keep me");
    resetAllLocalStorage();
    expect(localStorage.getItem("mdrone.meditate.visualizer")).toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.autosave)).toBeNull();
    expect(localStorage.getItem("unrelated-key")).toBe("keep me");
  });

  it("still sweeps legacy mdrone-* stragglers", () => {
    localStorage.setItem("mdrone-old-straggler", "x");
    resetAllLocalStorage();
    expect(localStorage.getItem("mdrone-old-straggler")).toBeNull();
  });
});

describe("withSnapshotDefaults (engine/state divergence guard)", () => {
  // applySnapshot pushes engine defaults for optional fields
  // (engine.setCoupleAmount(snapshot.coupleAmount ?? 0)) but the scene
  // reducer is merge-based, so a snapshot MISSING the key would leave
  // the previous scene's value in React state — slider shows COUPLE,
  // audio has none. Every optional field the engine defaults on apply
  // must be defaulted here too, so state and engine cannot diverge.
  it("defaults coupleAmount to 0 when the snapshot omits it (RND/preset/legacy loads)", () => {
    const out = withSnapshotDefaults({ playing: true } as Partial<DroneSessionSnapshot> as DroneSessionSnapshot);
    expect(out.coupleAmount).toBe(0);
  });

  it("preserves an explicit coupleAmount", () => {
    const out = withSnapshotDefaults({ coupleAmount: 0.6 } as Partial<DroneSessionSnapshot> as DroneSessionSnapshot);
    expect(out.coupleAmount).toBe(0.6);
  });

  it("does not invent values for fields the engine does not default (entrain)", () => {
    const out = withSnapshotDefaults({} as Partial<DroneSessionSnapshot> as DroneSessionSnapshot);
    expect(out.entrain).toBeUndefined();
  });
});

describe("normalizePortableScene version gate", () => {
  it("rejects scenes with a numeric version above the supported one", () => {
    expect(normalizePortableScene({ version: 2, drone: {}, mixer: {} })).toBeNull();
    expect(normalizePortableScene({ version: 99, drone: {}, mixer: {} })).toBeNull();
  });

  it("accepts version 1 and stamps it", () => {
    const scene = normalizePortableScene({ version: 1, drone: {}, mixer: {} });
    expect(scene?.version).toBe(1);
  });

  it("stays lenient for missing or invalid versions (legacy links)", () => {
    expect(normalizePortableScene({ drone: {}, mixer: {} })?.version).toBe(1);
    expect(normalizePortableScene({ version: "2", drone: {}, mixer: {} })?.version).toBe(1);
    expect(normalizePortableScene({ version: NaN, drone: {}, mixer: {} })?.version).toBe(1);
  });
});
