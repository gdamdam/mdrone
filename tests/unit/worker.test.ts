import { describe, it, expect, beforeEach } from "vitest";
import worker from "../../worker/worker";

/**
 * Tests for the Cloudflare share Worker (worker/worker.ts).
 *
 * The worker is normally typechecked/bundled by wrangler (it's outside the
 * project's tsconfig references), so these run against the source module via
 * vitest's esbuild transform. Cloudflare ambient types (KVNamespace,
 * ExecutionContext) erase to nothing at runtime, so a Map-backed stub plus a
 * no-op ctx is enough to exercise the routed `fetch` entrypoint.
 */

// Minimal KV stub: a Map honoring get/put/list. `expirationTtl` is accepted
// but not enforced (the worker treats rate-limit counters as best-effort, and
// no test depends on real expiry).
function makeKv() {
  const store = new Map<string, { value: string; metadata?: unknown }>();
  return {
    store,
    async get(key: string) {
      return store.has(key) ? store.get(key)!.value : null;
    },
    async put(key: string, value: string, opts?: { metadata?: unknown }) {
      store.set(key, { value, metadata: opts?.metadata ?? null });
    },
    async list({ prefix, cursor: _cursor, limit: _limit }: { prefix?: string; cursor?: string; limit?: number } = {}) {
      const keys = [...store.keys()]
        .filter((k) => (prefix ? k.startsWith(prefix) : true))
        .map((name) => ({ name, metadata: store.get(name)!.metadata }));
      return { keys, list_complete: true, cursor: undefined };
    },
  };
}

function makeEnv() {
  return { SHORT: makeKv() } as unknown as Parameters<typeof worker.fetch>[1];
}

// ctx.waitUntil: collect promises so tests can await background KV writes
// (the rate-limit counter is written via waitUntil). awaitPending() drains them.
const pending: Promise<unknown>[] = [];
const ctx = {
  waitUntil: (p: Promise<unknown>) => { pending.push(p); },
  passThroughOnException: () => {},
} as unknown as Parameters<typeof worker.fetch>[2];
async function awaitPending() {
  while (pending.length) await pending.shift();
}

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`https://s.mdrone.org${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

const VALID_TARGET = "https://s.mdrone.org/?z=abc123";

describe("worker /shorten", () => {
  let env: ReturnType<typeof makeEnv>;
  beforeEach(() => {
    env = makeEnv();
  });

  it("happy path: returns a 6-char id, short url, and CORS header", async () => {
    const res = await worker.fetch(post("/shorten", { url: VALID_TARGET }, { "cf-connecting-ip": "1.1.1.1" }), env, ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    const json = await res.json() as { id: string; short: string };
    expect(json.id).toMatch(/^[a-z0-9]{6}$/);
    expect(json.short).toBe(`https://s.mdrone.org/${json.id}`);
  });

  it("dedupes the same URL to the same id", async () => {
    const first = await (await worker.fetch(post("/shorten", { url: VALID_TARGET }, { "cf-connecting-ip": "2.2.2.2" }), env, ctx)).json() as { id: string };
    const second = await (await worker.fetch(post("/shorten", { url: VALID_TARGET }, { "cf-connecting-ip": "2.2.2.3" }), env, ctx)).json() as { id: string };
    expect(second.id).toBe(first.id);
  });

  it("rejects a non-s.mdrone.org host", async () => {
    const res = await worker.fetch(post("/shorten", { url: "https://evil.example.com/?z=abc" }, { "cf-connecting-ip": "3.3.3.3" }), env, ctx);
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toMatch(/host/i);
  });

  it("rejects an oversized payload with 413", async () => {
    const huge = `https://s.mdrone.org/?z=${"A".repeat(40 * 1024)}`;
    const res = await worker.fetch(post("/shorten", { url: huge }, { "cf-connecting-ip": "4.4.4.4" }), env, ctx);
    expect(res.status).toBe(413);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect((await res.json() as { error: string }).error).toMatch(/large|big|size/i);
  });

  it("accepts a large-but-legitimate payload (under the cap)", async () => {
    const big = `https://s.mdrone.org/?z=${"A".repeat(8 * 1024)}`;
    const res = await worker.fetch(post("/shorten", { url: big }, { "cf-connecting-ip": "5.5.5.5" }), env, ctx);
    expect(res.status).toBe(200);
  });
});

describe("worker rate limiting", () => {
  let env: ReturnType<typeof makeEnv>;
  beforeEach(() => {
    env = makeEnv();
  });

  it("returns 429 once the per-IP threshold is exceeded on /shorten", async () => {
    const ip = "9.9.9.9";
    let last: Response | undefined;
    // Fire well past the threshold; once over, the worker must answer 429.
    for (let i = 0; i < 40; i++) {
      last = await worker.fetch(
        post("/shorten", { url: `https://s.mdrone.org/?z=req${i}` }, { "cf-connecting-ip": ip }),
        env,
        ctx,
      );
      await awaitPending(); // flush the counter write before the next request
      if (last.status === 429) break;
    }
    expect(last!.status).toBe(429);
    expect(last!.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect((await last!.json() as { error: string }).error).toMatch(/rate|many|limit/i);
  });

  it("rate-limits /track too", async () => {
    const ip = "8.8.8.8";
    let last: Response | undefined;
    for (let i = 0; i < 40; i++) {
      last = await worker.fetch(
        post("/track", { id: "abc123" }, { "cf-connecting-ip": ip }),
        env,
        ctx,
      );
      await awaitPending();
      if (last.status === 429) break;
    }
    expect(last!.status).toBe(429);
  });

  it("keeps separate counters per IP", async () => {
    // Exhaust one IP, then a fresh IP should still succeed.
    for (let i = 0; i < 40; i++) {
      await worker.fetch(post("/track", { id: "abc123" }, { "cf-connecting-ip": "7.7.7.7" }), env, ctx);
      await awaitPending();
    }
    const res = await worker.fetch(post("/track", { id: "abc123" }, { "cf-connecting-ip": "6.6.6.6" }), env, ctx);
    await awaitPending();
    expect(res.status).toBe(200);
  });
});
