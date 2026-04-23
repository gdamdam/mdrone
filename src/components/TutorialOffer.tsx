import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import {
  type FlowId,
  isFlowDone,
  markFlowDone,
  onOfferRequested,
  requestFlow,
  requestOfferFlow,
} from "../tutorial/state";
import { FLOWS } from "../tutorial/flows";

/**
 * TutorialOffer — one pill at a time, persistent until the user
 * chooses.
 *
 * Flows are never auto-started. Engagement signals (first SHAPE
 * touch, first FX toggle, 2 min of HOLD, ADVANCED expand, etc.)
 * call `requestOfferFlow(id)` which queues a small pill docked near
 * the feature's anchor. The pill has two buttons:
 *   - body → `requestFlow(id)` runs the full spotlight tour
 *   - ×    → `markFlowDone(id)` dismisses forever
 *
 * Nothing else dismisses the pill: scrolling, clicking elsewhere,
 * playing the drone — all no-ops. Multiple offers queue; only one
 * pill is ever on screen.
 *
 * The component also self-triggers the intro offer on mount, so
 * Layout doesn't need a separate dispatch for first-run.
 */

const FALLBACK_STYLE: CSSProperties = { right: 16, bottom: 72 };

export function TutorialOffer() {
  const [queue, setQueue] = useState<FlowId[]>([]);
  const [style, setStyle] = useState<CSSProperties>(FALLBACK_STYLE);
  const pillRef = useRef<HTMLDivElement>(null);

  const current: FlowId | null = queue[0] ?? null;
  const currentFlow = current ? FLOWS[current] : null;

  // Subscribe first, THEN self-trigger the intro offer — otherwise
  // the mount-time intro request fires before the listener exists
  // and the offer is lost. The two concerns live in one effect so
  // ordering is explicit.
  useEffect(() => {
    const off = onOfferRequested((id) => {
      if (isFlowDone(id)) return;
      setQueue((q) => (q.includes(id) ? q : [...q, id]));
    });
    // Auto-offer the intro on first-ever load. Eligibility (done
    // flag) is checked by the listener above, so this is safe to
    // call unconditionally.
    requestOfferFlow("intro");
    return off;
  }, []);

  // Measure the current anchor and park the pill under it. We poll
  // briefly because anchors may mount late (e.g. ADVANCED section
  // expanding). Falls back to a corner dock when the anchor is
  // missing entirely.
  useLayoutEffect(() => {
    if (!currentFlow) return;
    let cancelled = false;
    const measure = () => {
      if (cancelled) return;
      const anchor = document.querySelector(currentFlow.offerAnchor) as HTMLElement | null;
      const pill = pillRef.current;
      if (!pill) return;
      if (!anchor) {
        setStyle(FALLBACK_STYLE);
        return;
      }
      const r = anchor.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return;
      const pillW = pill.offsetWidth || 180;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const pillH = pill.offsetHeight || 32;
      const preferBelow = r.bottom + pillH + 12 < vh;
      const top = preferBelow ? r.bottom + 10 : Math.max(8, r.top - pillH - 10);
      const left = Math.min(Math.max(8, r.left + r.width / 2 - pillW / 2), vw - pillW - 8);
      setStyle({ position: "fixed", left, top });
    };
    measure();
    const poll = window.setInterval(measure, 160);
    const stop = window.setTimeout(() => window.clearInterval(poll), 1500);
    const onResize = () => measure();
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);
    return () => {
      cancelled = true;
      window.clearInterval(poll);
      window.clearTimeout(stop);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
    };
  }, [currentFlow]);

  if (!current || !currentFlow) return null;

  const advance = () => setQueue((q) => q.slice(1));

  const handleStart = () => {
    // User opted in — hand off to the full spotlight flow. Flow marks
    // itself done on skip / complete. Remove from the queue now so
    // the next offer (if any) surfaces after this one resolves.
    advance();
    requestFlow(current);
  };

  const handleDismiss = (e: React.MouseEvent) => {
    e.stopPropagation();
    markFlowDone(current);
    advance();
  };

  return createPortal(
    <div
      ref={pillRef}
      className="intro-prompt"
      style={style}
      role="group"
      aria-label={`Tutorial offer: ${currentFlow.offerLabel}`}
    >
      <button
        type="button"
        className="intro-prompt-body"
        onClick={handleStart}
        title={`Quick tour — ${currentFlow.steps.length} steps`}
      >
        <span className="intro-prompt-icon" aria-hidden="true">?</span>
        <span className="intro-prompt-text">{currentFlow.offerLabel}</span>
      </button>
      <button
        type="button"
        className="intro-prompt-close"
        onClick={handleDismiss}
        aria-label="Dismiss — don't show again"
        title="Dismiss — don't show again"
      >
        ×
      </button>
    </div>,
    document.body,
  );
}
