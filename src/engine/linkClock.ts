/**
 * linkClock — pure timing core for Ableton Link sync.
 *
 * Turns a Link session snapshot (tempo / beat / phase from the bridge,
 * see linkBridge.ts) into AudioContext times: grid boundaries (for
 * quantized changes) and a peak-on-downbeat anchor (for phase-locking
 * the breathing LFO). Everything here is pure — a snapshot value plus a
 * `now` time go in, a number comes out — so it is unit-testable without
 * any audio nodes (same split as sanitizeLinkMessage / the WS glue).
 *
 * The stateful glue (React/engine) builds a snapshot from each Link
 * message and holds the latest one in a ref; these functions never
 * store anything.
 */
import type { LinkState } from "./linkBridge";

export interface LinkClockSnapshot {
  /** Session tempo (BPM). */
  bpm: number;
  /** Absolute beat position. Needed (not just `phase`) to know which bar
   *  we're in within a multi-bar cycle, e.g. for true 2-bar boundaries. */
  beat: number;
  /** Phase within the current bar (0..quantum). */
  phase: number;
  /** Beats per bar (Link quantum). The bridge only reports 4/4 today. */
  quantum: number;
  /** ctx.currentTime captured when the Link message arrived. */
  tAtMsg: number;
}

export type QuantizeGrid = "beat" | "bar" | "2bar";

/** Build an immutable snapshot from a Link state + the AudioContext time
 *  at which the message was processed. `quantum` defaults to 4 (the only
 *  metre the bridge reports); non-finite/non-positive falls back to 4. */
export function makeLinkClockSnapshot(
  state: LinkState,
  tAtMsg: number,
  quantum = 4,
): LinkClockSnapshot {
  const q = Number.isFinite(quantum) && quantum > 0 ? quantum : 4;
  return { bpm: state.tempo, beat: state.beat, phase: state.phase, quantum: q, tAtMsg };
}

function beatSec(s: LinkClockSnapshot): number {
  return 60 / s.bpm;
}

/** Bar length in seconds. */
export function barSec(s: LinkClockSnapshot): number {
  return s.quantum * beatSec(s);
}

function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

/** ctx-time of the next downbeat ≥ `now`. */
export function nextDownbeatTime(s: LinkClockSnapshot, now: number): number {
  const bar = barSec(s);
  let t = s.tAtMsg + (s.quantum - s.phase) * beatSec(s);
  while (t < now) t += bar;
  return t;
}

/** ctx-time of the next `beat` / `bar` / `2bar` boundary ≥ `now`.
 *  The 2-bar boundary is derived from the absolute `beat` (multiples of
 *  `2 * quantum`), since `phase` alone can't tell odd bars from even. */
export function nextBoundaryTime(s: LinkClockSnapshot, grid: QuantizeGrid, now: number): number {
  const bs = beatSec(s);
  if (grid === "beat") {
    const frac = s.phase - Math.floor(s.phase);
    let t = s.tAtMsg + (1 - frac) * bs;
    while (t < now) t += bs;
    return t;
  }
  if (grid === "bar") return nextDownbeatTime(s, now);
  // 2bar: next time the absolute beat reaches a multiple of 2*quantum.
  const span = 2 * s.quantum;
  const spanSec = span * bs;
  let t = s.tAtMsg + (span - mod(s.beat, span)) * bs;
  while (t < now) t += spanSec;
  return t;
}

/** Compute the start time for a fresh sine oscillator so its first peak
 *  lands on a downbeat. Phase 0 of an OscillatorNode is a zero-crossing,
 *  and the positive peak is a quarter-cycle later, so
 *  `startTime = downbeat - periodSec/4`. That start time must be safely
 *  in the future; for slow modes (large periodSec) the next downbeat is
 *  too soon, so step forward to a later downbeat until the start clears a
 *  small `lead`. */
export function nextPeakAnchor(
  s: LinkClockSnapshot,
  freqHz: number,
  now: number,
  lead = 0.03,
): { startTime: number; peakAt: number } {
  const periodSec = 1 / freqHz;
  const bar = barSec(s);
  let D = nextDownbeatTime(s, now);
  while (D - periodSec / 4 < now + lead) D += bar;
  return { startTime: D - periodSec / 4, peakAt: D };
}

/** LFO rate (Hz) for a `num/den` sync-mode label, read as a period in
 *  whole-notes: `hz = bpm * den / (240 * num)`. Existing `1/n` modes are
 *  unchanged (num = 1); bar multiples `2/1`,`4/1`,`8/1` give multi-bar
 *  cycles. "free" or any malformed label → 0. */
export function lfoSyncedHz(mode: string, bpm: number): number {
  if (mode === "free") return 0;
  const [a, b] = mode.split("/");
  const num = Number(a);
  const den = Number(b);
  if (!Number.isFinite(num) || !Number.isFinite(den) || num <= 0 || den <= 0) return 0;
  return (bpm * den) / (240 * num);
}

/** Seconds to defer a quantized change. 0 (apply immediately) when the
 *  grid is off, Link is disconnected, or there's no snapshot yet — these
 *  are also the fallback when Link drops mid-change. */
export function quantizeDelaySec(
  snapshot: LinkClockSnapshot | null,
  grid: QuantizeGrid | "off",
  connected: boolean,
  now: number,
): number {
  if (grid === "off" || !connected || !snapshot) return 0;
  return Math.max(0, nextBoundaryTime(snapshot, grid, now) - now);
}
