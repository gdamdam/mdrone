/**
 * audioTrace — ring-buffer event log for diagnosing intermittent
 * crackles. Activated via `?audio-debug=trace` (see audioDebug.ts).
 *
 * Trace points are scattered through the audio engine at events that
 * could plausibly cause an audible discontinuity: voice layer toggles,
 * interval/root retunes, sub gain changes, convolver buffer swaps, FX
 * enable/disable, panic, and AudioContext state transitions.
 *
 * On every AudioLoadMonitor underrun the ring buffer is dumped to the
 * console — so when a glitch is detected, the surrounding ~3 s of
 * engine activity is right there. The buffer is also exposed as
 * `window.__mdroneDumpTrace()` for manual dumps when the user reports
 * a click that the load-monitor missed.
 *
 * Cost when disabled: one boolean check per trace call. No allocations.
 */
import type { AudioLoadMonitor, AudioLoadState } from "./AudioLoadMonitor";
import { hasAudioDebugFlag } from "./audioDebug";

export interface TraceEvent {
  /** performance.now() when the event was recorded. */
  tMs: number;
  /** AudioContext.currentTime in seconds at record time, or null if no ctx. */
  audioSec: number | null;
  /** Short event kind, e.g. "voiceLayer", "swapConv". */
  kind: string;
  /** Free-form structured payload — kept small (primitives only). */
  payload: Record<string, unknown> | undefined;
}

const RING_SIZE = 512; // ~3 s at typical event rates; tune if needed
let enabled = false;
let initialized = false;
let ring: TraceEvent[] = [];
let ringPos = 0;
let ringFull = false;
let traceCtx: AudioContext | null = null;

function ensureInit(): void {
  if (initialized) return;
  initialized = true;
  enabled = hasAudioDebugFlag("trace");
  if (!enabled) return;
  ring = new Array(RING_SIZE);
  console.warn("[mdrone/trace] enabled — ring buffer", RING_SIZE, "events");
  if (typeof window !== "undefined") {
    (window as unknown as { __mdroneDumpTrace?: (reason?: string) => void })
      .__mdroneDumpTrace = (reason?: string) => dumpTrace(reason ?? "manual");
    (window as unknown as { __mdroneTrace?: () => TraceEvent[] })
      .__mdroneTrace = () => snapshotTrace();
  }
}

export function isTraceEnabled(): boolean {
  ensureInit();
  return enabled;
}

export function setTraceContext(ctx: AudioContext): void {
  ensureInit();
  if (!enabled) return;
  traceCtx = ctx;
}

export function trace(kind: string, payload?: Record<string, unknown>): void {
  ensureInit();
  if (!enabled) return;
  const ev: TraceEvent = {
    tMs: performance.now(),
    audioSec: traceCtx ? traceCtx.currentTime : null,
    kind,
    payload,
  };
  ring[ringPos] = ev;
  ringPos = (ringPos + 1) % RING_SIZE;
  if (ringPos === 0) ringFull = true;
}

export function snapshotTrace(): TraceEvent[] {
  if (!enabled) return [];
  if (!ringFull) return ring.slice(0, ringPos);
  // Stitch in chronological order: oldest (ringPos) → wrap → ringPos-1.
  return ring.slice(ringPos).concat(ring.slice(0, ringPos));
}

export function dumpTrace(reason: string): void {
  if (!enabled) return;
  const events = snapshotTrace();
  // console.group keeps the dump collapsible — important because a
  // single underrun dump can be 100+ lines.
  try {
    console.groupCollapsed(`[mdrone/trace] dump (${reason}) — ${events.length} events`);
    for (const ev of events) {
      const t = ev.tMs.toFixed(1);
      const a = ev.audioSec !== null ? ev.audioSec.toFixed(3) : "—";
      if (ev.payload) {
        console.log(`t=${t}ms  a=${a}s  ${ev.kind}`, ev.payload);
      } else {
        console.log(`t=${t}ms  a=${a}s  ${ev.kind}`);
      }
    }
    console.groupEnd();
  } catch {
    // Some embeddings don't support console.group — fall back to flat log.
    for (const ev of events) console.log("[mdrone/trace]", ev);
  }
}

/** Subscribe to the load monitor and dump the ring buffer whenever a
 *  new underrun is detected. Single underrun = single dump (de-duped
 *  by underruns count). Disabled when trace flag is off. */
export function wireTraceToLoadMonitor(monitor: AudioLoadMonitor): void {
  ensureInit();
  if (!enabled) return;
  let lastUnderruns = 0;
  monitor.subscribe((state: AudioLoadState) => {
    if (state.underruns > lastUnderruns) {
      const delta = state.underruns - lastUnderruns;
      lastUnderruns = state.underruns;
      trace("underrun", {
        count: state.underruns,
        delta,
        driftMs: Math.round(state.driftMs * 10) / 10,
        struggling: state.struggling,
      });
      dumpTrace(`underrun #${state.underruns}, drift ${state.driftMs.toFixed(1)}ms`);
    }
  });
}
