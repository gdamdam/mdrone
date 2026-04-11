// Shim browser globals that `src/session.ts` and friends touch at import
// time. We only need enough surface for module evaluation — the existing
// node --test suite applies the same workaround (see tests/session-share-presets.test.mjs).

/* eslint-disable @typescript-eslint/no-explicit-any */
const g = globalThis as any;

if (!g.window) g.window = globalThis;

if (!g.localStorage) {
  const store = new Map<string, string>();
  g.localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
  };
}
