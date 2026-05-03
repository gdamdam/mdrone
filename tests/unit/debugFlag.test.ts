import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isDebugEnabled, DEBUG_STORAGE_KEY } from "../../src/devtools/debugFlag";

type WindowLike = {
  location: { search: string };
  localStorage: Storage;
  __mdroneDebug?: boolean;
};

class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length() { return this.store.size; }
  clear() { this.store.clear(); }
  getItem(key: string) { return this.store.has(key) ? this.store.get(key)! : null; }
  key(i: number) { return Array.from(this.store.keys())[i] ?? null; }
  removeItem(key: string) { this.store.delete(key); }
  setItem(key: string, value: string) { this.store.set(key, value); }
}

describe("debugFlag.isDebugEnabled", () => {
  let originalWindow: typeof globalThis.window | undefined;

  beforeEach(() => {
    originalWindow = (globalThis as { window?: typeof globalThis.window }).window;
    const fake: WindowLike = {
      location: { search: "" },
      localStorage: new MemoryStorage(),
    };
    (globalThis as unknown as { window: WindowLike }).window = fake;
  });

  afterEach(() => {
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window: typeof globalThis.window }).window = originalWindow;
    }
    vi.restoreAllMocks();
  });

  it("returns false with no signal", () => {
    expect(isDebugEnabled()).toBe(false);
  });

  it("respects ?debug query param (no value)", () => {
    (globalThis as unknown as { window: WindowLike }).window.location.search = "?debug";
    expect(isDebugEnabled()).toBe(true);
  });

  it("respects ?debug=1", () => {
    (globalThis as unknown as { window: WindowLike }).window.location.search = "?debug=1";
    expect(isDebugEnabled()).toBe(true);
  });

  it("ignores ?debug=0", () => {
    (globalThis as unknown as { window: WindowLike }).window.location.search = "?debug=0";
    expect(isDebugEnabled()).toBe(false);
  });

  it("respects localStorage opt-in", () => {
    (globalThis as unknown as { window: WindowLike }).window.localStorage.setItem(DEBUG_STORAGE_KEY, "1");
    expect(isDebugEnabled()).toBe(true);
  });

  it("respects window.__mdroneDebug = true", () => {
    (globalThis as unknown as { window: WindowLike }).window.__mdroneDebug = true;
    expect(isDebugEnabled()).toBe(true);
  });
});
