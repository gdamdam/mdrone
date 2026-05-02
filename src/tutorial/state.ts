/**
 * Tutorial state — one shared layer for every spotlight flow.
 *
 * Flows exist, each with its own persisted "done" flag:
 *   - "intro"    — 4-step first-run tour
 *   - "advanced" — 3-step walkthrough of the ADVANCED section
 *   - "effects"  — 2-step FX chain walkthrough
 *
 * Eligibility signals:
 *   - session count (bumped once per load)
 *   - accumulated HOLD-on time (counts only while the drone is sounding)
 *
 * All storage keys are versioned (-v1) so we can invalidate without
 * re-showing a tutorial to existing users.
 */

export type FlowId = "intro" | "advanced" | "effects";

/** Legacy flow id "share" is removed (the share-tour was scrapped
 *  alongside the talisman-card removal). Its localStorage key is
 *  cleaned up in resetAllFlows so reset wipes it from old installs. */
const LEGACY_SHARE_FLOW_KEY = "mdrone-tutorial-flow-done-v1:share";

const INTRO_STORAGE_KEY = "mdrone-tutorial-intro-v1";
const FLOW_DONE_PREFIX = "mdrone-tutorial-flow-done-v1:";
export const HOLD_TIME_KEY = "mdrone-tutorial-hold-ms-v1";
/** Legacy — removed with the session-count share trigger. Cleaned up
 *  in resetAllFlows so reset wipes it from old installs. */
const LEGACY_SESSION_COUNT_KEY = "mdrone-tutorial-sessions-v1";

/** Legacy RND counter — no longer read, cleaned up on next reset. */
const LEGACY_RND_COUNT_KEY = "mdrone-tutorial-rnd-count";
const LEGACY_ADV_KEY = "mdrone-tutorial-adv-v1";

function flowDoneKey(id: FlowId): string {
  // "intro" keeps its original key so already-onboarded users don't
  // see the intro again after this refactor.
  return id === "intro" ? INTRO_STORAGE_KEY : `${FLOW_DONE_PREFIX}${id}`;
}

function safeGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function safeSet(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* quota / private mode */ }
}
function safeRemove(key: string): void {
  try { localStorage.removeItem(key); } catch { /* noop */ }
}

/* ─────────── Flow done flags ─────────── */

export function isFlowDone(id: FlowId): boolean {
  return safeGet(flowDoneKey(id)) === "1";
}

export function markFlowDone(id: FlowId): void {
  safeSet(flowDoneKey(id), "1");
}

export function resetFlow(id: FlowId): void {
  safeRemove(flowDoneKey(id));
}

export function resetAllFlows(): void {
  resetFlow("intro");
  resetFlow("advanced");
  resetFlow("effects");
  // Also wipe legacy keys from previous iterations of the tutorial
  // system so people replaying flows don't have stale state.
  safeRemove(LEGACY_RND_COUNT_KEY);
  safeRemove(LEGACY_ADV_KEY);
  safeRemove(LEGACY_SESSION_COUNT_KEY);
  safeRemove(LEGACY_SHARE_FLOW_KEY);
}

/* ─────────── HOLD-time accumulator ─────────── */

export function addHoldTime(ms: number): number {
  const next = getHoldTime() + Math.max(0, ms | 0);
  safeSet(HOLD_TIME_KEY, String(next));
  return next;
}

export function getHoldTime(): number {
  return Number(safeGet(HOLD_TIME_KEY) ?? 0) || 0;
}

/* ─────────── Flow + offer request buses ─────────── */

type FlowListener = (id: FlowId) => void;
const flowListeners = new Set<FlowListener>();
const offerListeners = new Set<FlowListener>();

/** Start a flow immediately (TutorialFlow renderer shows the full
 *  spotlight tour). Used for explicit replays and for pill-opt-in.
 *  Fire-and-forget — renderer handles eligibility. */
export function requestFlow(id: FlowId): void {
  for (const fn of flowListeners) {
    try { fn(id); } catch { /* swallow listener errors */ }
  }
}

export function onFlowRequested(cb: FlowListener): () => void {
  flowListeners.add(cb);
  return () => { flowListeners.delete(cb); };
}

/** Offer a flow as a dismissible pill next to its anchor. The user
 *  has to tap the pill to start the tour, or × to mark it done.
 *  Automatic triggers (first SHAPE touch, HOLD-time threshold, etc.)
 *  should go through this — not `requestFlow` — so nothing is ever
 *  forced on the user. */
export function requestOfferFlow(id: FlowId): void {
  for (const fn of offerListeners) {
    try { fn(id); } catch { /* swallow */ }
  }
}

export function onOfferRequested(cb: FlowListener): () => void {
  offerListeners.add(cb);
  return () => { offerListeners.delete(cb); };
}

/* ─────────── Pre-flow hooks (UI setup before spotlight renders) ───────────
 *
 * The "advanced" flow teaches controls inside DroneView's ADVANCED
 * disclosure — which may be collapsed, and which is often occluded
 * by the Settings modal when the user clicked the Settings "Advanced"
 * tab. Two thin event buses let Header / DroneView react without
 * prop drilling: close the Settings modal, then expand the ADVANCED
 * disclosure in DroneView.
 */

type Cb = () => void;
const closeSettingsListeners = new Set<Cb>();
const expandAdvancedListeners = new Set<Cb>();

export function requestCloseSettings(): void {
  for (const fn of closeSettingsListeners) { try { fn(); } catch { /* noop */ } }
}
export function onCloseSettingsRequested(cb: Cb): () => void {
  closeSettingsListeners.add(cb);
  return () => { closeSettingsListeners.delete(cb); };
}

export function requestExpandAdvanced(): void {
  for (const fn of expandAdvancedListeners) { try { fn(); } catch { /* noop */ } }
}
export function onExpandAdvancedRequested(cb: Cb): () => void {
  expandAdvancedListeners.add(cb);
  return () => { expandAdvancedListeners.delete(cb); };
}
