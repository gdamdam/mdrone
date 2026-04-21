/**
 * Share relay client — URL shortener for scene share links.
 * Relay: s.mdrone.org (same Cloudflare Worker that serves OG cards).
 */

const RELAY = import.meta.env.DEV ? "http://localhost:8787" : "https://s.mdrone.org";

let healthCache: boolean | null = null;
let healthCheckedAt = 0;
const HEALTH_TTL = 60_000;

export async function checkRelayHealth(): Promise<boolean> {
  const now = Date.now();
  if (healthCache !== null && now - healthCheckedAt < HEALTH_TTL) return healthCache;
  try {
    const r = await fetch(`${RELAY}/health`, { signal: AbortSignal.timeout(3000) });
    healthCache = r.ok;
  } catch {
    healthCache = false;
  }
  healthCheckedAt = now;
  return healthCache;
}

/** Create a short URL for a scene share link. Returns null if relay is unreachable. */
export async function shortenSceneUrl(
  url: string,
): Promise<{ id: string; short: string } | null> {
  try {
    const r = await fetch(`${RELAY}/shorten`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) return null;
    return r.json();
  } catch {
    return null;
  }
}

/**
 * Bump the share counter for a short link (admin-only metric, surfaced at
 * /mddashboard). Fire-and-forget — never blocks the share/copy UI and never
 * surfaces failures to the user.
 */
export function trackShare(id: string): void {
  void fetch(`${RELAY}/track`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
    signal: AbortSignal.timeout(3000),
  }).catch(() => {});
}
