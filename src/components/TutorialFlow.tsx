import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import {
  type FlowId,
  isFlowDone,
  markFlowDone,
  onFlowRequested,
} from "../tutorial/state";
import { FLOWS } from "../tutorial/flows";

/**
 * TutorialFlow — generic spotlight tutorial renderer.
 *
 * Owns all three flows (intro / advanced / share). Components outside
 * the tutorial system only ever call `requestFlow(id)`; this component
 * decides eligibility (not already done, no other flow active) and
 * which renderer to use:
 *   - Desktop: clip-path spotlight + anchored card
 *   - Mobile:  docked bottom sheet + soft ring on target
 *
 * Persistence is per-flow — completing the intro does not mark advanced
 * as done. Dismissing (skip / ×) marks the flow done. Replays come via
 * `requestFlow` from HelpModal.
 */

const MOBILE_MAX_WIDTH = 720;
const SPOTLIGHT_PAD = 10;
const CARD_GAP = 14;

function isMobileViewport(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.(`(max-width: ${MOBILE_MAX_WIDTH}px)`).matches ?? window.innerWidth <= MOBILE_MAX_WIDTH;
}

/** clip-path polygon with a rectangular hole — outer rect clockwise,
 *  inner counter-clockwise so the hole is cut out. */
function buildClipPath(rect: DOMRect | null): string | undefined {
  if (!rect) return undefined;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const x = Math.max(0, rect.left - SPOTLIGHT_PAD);
  const y = Math.max(0, rect.top - SPOTLIGHT_PAD);
  const r = Math.min(vw, rect.right + SPOTLIGHT_PAD);
  const b = Math.min(vh, rect.bottom + SPOTLIGHT_PAD);
  return `polygon(evenodd,0 0,${vw}px 0,${vw}px ${vh}px,0 ${vh}px,0 0,${x}px ${y}px,${x}px ${b}px,${r}px ${b}px,${r}px ${y}px,${x}px ${y}px)`;
}

export function TutorialFlow() {
  // Flows are always explicitly requested — intro via the IntroPrompt
  // pill, advanced via disclosure click, share via accumulated HOLD
  // time. No flow auto-starts on mount.
  const [activeFlow, setActiveFlow] = useState<FlowId | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [mobile, setMobile] = useState<boolean>(isMobileViewport);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [cardStyle, setCardStyle] = useState<CSSProperties>({});
  const cardRef = useRef<HTMLDivElement>(null);

  const flow = activeFlow ? FLOWS[activeFlow] : null;
  const step = flow ? flow.steps[stepIndex] : null;

  // Request handler — owns the eligibility gates. Flows requested
  // while another is active are dropped (no queueing to keep the UX
  // calm; HelpModal replay is always available).
  useEffect(() => {
    const off = onFlowRequested((id) => {
      if (activeFlow) return;
      // Replays from Help reset the done flag before requesting, so
      // this check cleanly no-ops for auto-triggers that race a
      // completed flow without disrupting explicit replays.
      if (isFlowDone(id)) return;
      setStepIndex(0);
      setActiveFlow(id);
    });
    return off;
  }, [activeFlow]);

  // Track viewport class.
  useEffect(() => {
    if (!activeFlow) return;
    const onResize = () => setMobile(isMobileViewport());
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, [activeFlow]);

  // Measure target. Re-query on step change, resize, scroll, and on
  // a 120ms poll for ~2s — covers late-mounting targets (e.g. the
  // ADVANCED section expanding, MICROTONAL tab unhiding content).
  useLayoutEffect(() => {
    if (!step) return;
    let raf = 0;
    let cancelled = false;
    const measure = () => {
      if (cancelled) return;
      const el = document.querySelector(step.selector) as HTMLElement | null;
      const next = el?.getBoundingClientRect() ?? null;
      setRect((prev) => {
        if (!prev && !next) return prev;
        if (prev && next && prev.top === next.top && prev.left === next.left && prev.width === next.width && prev.height === next.height) {
          return prev;
        }
        return next;
      });
    };
    measure();
    const onScroll = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(measure); };
    window.addEventListener("resize", onScroll);
    window.addEventListener("scroll", onScroll, true);
    const poll = window.setInterval(measure, 120);
    const stop = window.setTimeout(() => window.clearInterval(poll), 2000);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.clearInterval(poll);
      window.clearTimeout(stop);
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [step]);

  // Position desktop card near the target. Prefer below; fall back
  // above; then centre.
  useLayoutEffect(() => {
    if (!activeFlow || mobile) return;
    const card = cardRef.current;
    if (!card) return;
    const cardH = card.offsetHeight || 180;
    const cardW = card.offsetWidth || 320;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (!rect) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- layout-measure-driven fallback position
      setCardStyle({ left: vw / 2 - cardW / 2, top: vh / 2 - cardH / 2 });
      return;
    }
    const below = rect.bottom + CARD_GAP;
    const above = rect.top - CARD_GAP - cardH;
    const top = below + cardH < vh ? below : above > 8 ? above : Math.max(8, vh - cardH - 8);
    const left = Math.min(Math.max(8, rect.left + rect.width / 2 - cardW / 2), vw - cardW - 8);
    setCardStyle({ left, top });
  }, [activeFlow, mobile, rect, stepIndex]);

  const close = useCallback(() => {
    if (activeFlow) markFlowDone(activeFlow);
    setActiveFlow(null);
  }, [activeFlow]);

  const next = useCallback(() => {
    if (!flow) return;
    if (stepIndex >= flow.steps.length - 1) close();
    else setStepIndex((i) => i + 1);
  }, [flow, stepIndex, close]);

  const prev = useCallback(() => {
    if (stepIndex > 0) setStepIndex((i) => i - 1);
  }, [stepIndex]);

  useEffect(() => {
    if (!activeFlow) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight" || e.key === "Enter") { e.preventDefault(); next(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); prev(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeFlow, next, prev, close]);

  if (!flow || !step) return null;

  const stepNumLabel = `${stepIndex + 1} / ${flow.steps.length}`;

  const card = (
    <div
      ref={cardRef}
      className={mobile ? "tutorial-card tutorial-card-mobile" : "tutorial-card tutorial-card-desktop"}
      style={mobile ? undefined : cardStyle}
      role="dialog"
      aria-modal="true"
      aria-labelledby="tutorial-title"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="tutorial-card-head">
        <span className="tutorial-card-step">{stepNumLabel}</span>
        <button
          type="button"
          className="tutorial-card-skip"
          onClick={close}
          aria-label="Skip tutorial"
        >
          Skip
        </button>
      </div>
      <h3 id="tutorial-title" className="tutorial-card-title">{step.title}</h3>
      <p className="tutorial-card-body">{step.body}</p>
      <div className="tutorial-card-actions">
        <button
          type="button"
          className="tutorial-btn tutorial-btn-ghost"
          onClick={prev}
          disabled={stepIndex === 0}
        >
          Back
        </button>
        <button
          type="button"
          className="tutorial-btn tutorial-btn-primary"
          onClick={next}
        >
          {stepIndex === flow.steps.length - 1 ? "Got it" : "Next"}
        </button>
      </div>
    </div>
  );

  if (mobile) {
    const ringStyle: CSSProperties = rect
      ? {
          position: "fixed",
          left: rect.left - SPOTLIGHT_PAD,
          top: rect.top - SPOTLIGHT_PAD,
          width: rect.width + SPOTLIGHT_PAD * 2,
          height: rect.height + SPOTLIGHT_PAD * 2,
          pointerEvents: "none",
          zIndex: 9998,
        }
      : { display: "none" };
    return createPortal(
      <>
        <div className="tutorial-ring" style={ringStyle} aria-hidden="true" />
        {card}
      </>,
      document.body,
    );
  }

  const clipPath = buildClipPath(rect);
  return createPortal(
    <>
      <div
        className="tutorial-overlay"
        style={clipPath ? { clipPath } : undefined}
        onClick={close}
        aria-hidden="true"
      />
      {card}
    </>,
    document.body,
  );
}
