import { describe, it, expect, beforeEach } from "vitest";
import {
  loadCcMap,
  saveCcMap,
  removeCc,
  assignCc,
} from "../../src/engine/midiMapping";

const STORAGE_KEY = "mdrone-midi-cc-map";

// Node 25 ships a native (but non-functional, file-backed) localStorage
// that shadows tests/unit/setup.ts's mock. Install a working in-memory
// one per test, matching labelMode.test.ts.
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

beforeEach(() => installMemoryStorage());

describe("midiMapping persistence", () => {
  it("keeps a removed default mapping removed across save/load", () => {
    // CC 71 → drift is a builtin default; unmapping it must survive reload.
    const map = removeCc(loadCcMap(), 71);
    saveCcMap(map);
    expect(loadCcMap()[71]).toBeUndefined();
  });

  it("does not resurrect a default CC after its target moves elsewhere", () => {
    let map = loadCcMap();
    map = removeCc(map, 71);
    map = assignCc(map, 20, "drift");
    saveCcMap(map);
    const loaded = loadCcMap();
    expect(loaded[71]).toBeUndefined();
    expect(loaded[20]).toBe("drift");
  });

  it("round-trips non-default assignments with defaults merged back in", () => {
    const map = assignCc(loadCcMap(), 20, "fx.hall");
    saveCcMap(map);
    const loaded = loadCcMap();
    expect(loaded[20]).toBe("fx.hall");
    expect(loaded[71]).toBe("drift");
    expect(loaded[7]).toBe("volume");
  });

  it("loads legacy stored diffs (no tombstones) exactly as before", () => {
    // Pre-tombstone format: bare diff object, defaults merged on load.
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ 20: "fx.hall" }));
    const loaded = loadCcMap();
    expect(loaded[20]).toBe("fx.hall");
    expect(loaded[71]).toBe("drift");
    expect(loaded[64]).toBe("hold");
  });

  it("clears storage when the map equals the defaults", () => {
    saveCcMap(loadCcMap());
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
