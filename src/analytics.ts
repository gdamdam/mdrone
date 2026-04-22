/**
 * Lightweight GoatCounter custom-event wrapper.
 *
 * All events are deduped per page-load: the first fire for a given
 * key wins, later fires of the same key are silently dropped. A
 * user hitting a preset ten times therefore contributes one event,
 * not ten — keeping the GoatCounter dashboard meaningful at the
 * aggregate level and avoiding any per-user behavioural shape.
 *
 * No-op when:
 *   - the goatcounter script isn't loaded (dev, offline, blocked),
 *   - goatcounter.filter() returns a reason (DNT, localhost,
 *     #toggle-goatcounter, iframe, etc.),
 *   - the supplied path is empty.
 *
 * Design notes:
 *   - No PII, no IDs, no free-text. Paths are curated constants
 *     composed with preset IDs / enum values.
 *   - No timings, no session correlation. GoatCounter hits are
 *     fired independently and aren't linked to the pageview.
 */

interface GoatCounter {
  count?: (vars: { path: string; title?: string; event: boolean }) => void;
  filter?: () => string | false;
}

const fired = new Set<string>();

function gc(): GoatCounter | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { goatcounter?: GoatCounter }).goatcounter;
}

/** Fire a custom GoatCounter event. De-duped per page-load. */
export function trackEvent(path: string, title?: string): void {
  if (!path || fired.has(path)) return;
  fired.add(path);
  const g = gc();
  if (!g?.count) return;
  if (g.filter && g.filter()) return;
  try {
    g.count({ path, title: title ?? path, event: true });
  } catch {
    /* never surface analytics errors to the user */
  }
}

/** Whether a given event key has already been fired in this page-
 *  load. Useful for call sites that want to avoid preparing the
 *  payload when it wouldn't fire anyway. */
export function wasEventFired(path: string): boolean {
  return fired.has(path);
}

/** Coarse zone label for a FLICKER rate, matching the slider's
 *  visual bands. Keeps the event path cardinality bounded to 5
 *  values instead of a full Hz float. */
export function flickerZone(rateHz: number): "delta" | "theta" | "alpha" | "beta" | "gamma" {
  if (rateHz < 4) return "delta";
  if (rateHz < 8) return "theta";
  if (rateHz < 12) return "alpha";
  if (rateHz < 30) return "beta";
  return "gamma";
}

/** Test-only: reset the dedupe cache between tests so each can
 *  assert its own fire-pattern independently. */
export function __resetAnalyticsForTest(): void {
  fired.clear();
}
