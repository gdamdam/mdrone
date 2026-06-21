/**
 * linkClock — pure timing core that turns an Ableton Link snapshot
 * (tempo / beat / phase) into AudioContext times. These tests pin the
 * grid-boundary math, the peak-anchor (peak-on-downbeat) computation,
 * the generalised num/den sync-rate helper, and the quantize-delay
 * fallback. All functions are pure (snapshot + now in → number out), so
 * no audio nodes are involved — same pattern as sanitizeLinkMessage.
 */
import { describe, it, expect } from "vitest";
import {
  makeLinkClockSnapshot,
  nextDownbeatTime,
  nextBoundaryTime,
  nextPeakAnchor,
  lfoSyncedHz,
  quantizeDelaySec,
  type LinkClockSnapshot,
} from "../../src/engine/linkClock";
import type { LinkState } from "../../src/engine/linkBridge";

// 120 BPM, 4/4 → beatSec 0.5, barSec 2. beat 1 (phase 1) so 1-bar and
// 2-bar boundaries land at different times.
const s: LinkClockSnapshot = { bpm: 120, beat: 1, phase: 1, quantum: 4, tAtMsg: 10 };

describe("makeLinkClockSnapshot", () => {
  it("carries tempo/beat/phase and defaults quantum to 4", () => {
    const state = { tempo: 120, beat: 3, phase: 3, playing: true, peers: 1, clients: 1, connected: true } as LinkState;
    const snap = makeLinkClockSnapshot(state, 42);
    expect(snap).toEqual({ bpm: 120, beat: 3, phase: 3, quantum: 4, tAtMsg: 42 });
  });
});

describe("nextDownbeatTime", () => {
  it("returns the next bar-start ctx time", () => {
    // 3 beats to the next downbeat → 1.5 s after tAtMsg
    expect(nextDownbeatTime(s, 10)).toBeCloseTo(11.5, 6);
  });
  it("advances past now when the next downbeat is already behind", () => {
    expect(nextDownbeatTime(s, 12)).toBeCloseTo(13.5, 6);
  });
});

describe("nextBoundaryTime", () => {
  it("beat grid → next integer beat", () => {
    expect(nextBoundaryTime(s, "beat", 10)).toBeCloseTo(10.5, 6);
  });
  it("bar grid → next downbeat", () => {
    expect(nextBoundaryTime(s, "bar", 10)).toBeCloseTo(11.5, 6);
  });
  it("2bar grid uses absolute beat (differs from 1-bar)", () => {
    // beat 1, span 8 → 7 beats to the next 2-bar line → 3.5 s
    expect(nextBoundaryTime(s, "2bar", 10)).toBeCloseTo(13.5, 6);
  });
});

describe("nextPeakAnchor", () => {
  it("places the peak a quarter-cycle after start, on a downbeat", () => {
    const { startTime, peakAt } = nextPeakAnchor(s, 2, 10); // 1/4 → period 0.5
    expect(peakAt).toBeCloseTo(11.5, 6);
    expect(startTime).toBeCloseTo(peakAt - 0.5 / 4, 6);
  });
  it("steps to a later downbeat when a slow cycle's start would be in the past", () => {
    const periodSec = 1 / 0.0625; // 8/1 at 120 → 16 s, quarter = 4 s
    const { startTime, peakAt } = nextPeakAnchor(s, 0.0625, 10);
    expect(startTime).toBeGreaterThanOrEqual(10 + 0.03);
    expect(startTime).toBeCloseTo(peakAt - periodSec / 4, 6);
    // peakAt is still a downbeat (11.5 + k * barSec)
    expect(((peakAt - 11.5) / 2) % 1).toBeCloseTo(0, 6);
  });
});

describe("lfoSyncedHz", () => {
  it("keeps existing 1/n modes unchanged", () => {
    expect(lfoSyncedHz("1/4", 120)).toBeCloseTo(2, 6);
    expect(lfoSyncedHz("1/8", 120)).toBeCloseTo(4, 6);
    expect(lfoSyncedHz("1/16", 120)).toBeCloseTo(8, 6);
    expect(lfoSyncedHz("1/1", 120)).toBeCloseTo(0.5, 6);
  });
  it("computes new bar-multiple modes", () => {
    expect(lfoSyncedHz("2/1", 120)).toBeCloseTo(0.25, 6);
    expect(lfoSyncedHz("4/1", 120)).toBeCloseTo(0.125, 6);
    expect(lfoSyncedHz("8/1", 120)).toBeCloseTo(0.0625, 6);
  });
  it("returns 0 for free and malformed modes", () => {
    expect(lfoSyncedHz("free", 120)).toBe(0);
    expect(lfoSyncedHz("1/0", 120)).toBe(0);
    expect(lfoSyncedHz("x/y", 120)).toBe(0);
  });
});

describe("quantizeDelaySec", () => {
  it("is 0 (immediate) when off, disconnected, or no snapshot", () => {
    expect(quantizeDelaySec(s, "off", true, 10)).toBe(0);
    expect(quantizeDelaySec(s, "bar", false, 10)).toBe(0);
    expect(quantizeDelaySec(null, "bar", true, 10)).toBe(0);
  });
  it("returns time-to-boundary when on and connected", () => {
    expect(quantizeDelaySec(s, "bar", true, 10)).toBeCloseTo(1.5, 6);
    expect(quantizeDelaySec(s, "beat", true, 10)).toBeCloseTo(0.5, 6);
  });
});
