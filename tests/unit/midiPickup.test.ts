/**
 * MIDI soft-takeover (pickup) decision logic — pure, framework-free.
 *
 * Stage-safety: when a hardware knob/fader is far from the current
 * on-screen value (after a scene/preset load), the first move must NOT
 * jump the target. The control only "takes over" once the hardware value
 * crosses or comes within a small threshold of the software value.
 */
import { describe, it, expect } from "vitest";
import {
  decidePickup,
  PICKUP_THRESHOLD,
  type PickupEntry,
} from "../../src/engine/midiPickup";

describe("decidePickup — soft takeover", () => {
  it("does not dispatch when first move is far below the software value", () => {
    // sw=0.8, hw=0.1 → must hold (no jump down).
    const r = decidePickup(undefined, 0.1, 0.8);
    expect(r.dispatch).toBe(false);
    expect(r.entry.armed).toBe(false);
  });

  it("does not dispatch when first move is far above the software value", () => {
    const r = decidePickup(undefined, 0.95, 0.2);
    expect(r.dispatch).toBe(false);
    expect(r.entry.armed).toBe(false);
  });

  it("takes over once the hardware comes within threshold of the software value", () => {
    // Sweep up toward 0.8; arms when |hw-sw| <= threshold.
    let entry: PickupEntry | undefined;
    const sw = 0.8;
    let armedAt = -1;
    for (let v = 0.1; v <= 0.8 + 1e-9; v += 1 / 127) {
      const r = decidePickup(entry, v, sw);
      entry = r.entry;
      if (r.dispatch && armedAt < 0) armedAt = v;
    }
    expect(armedAt).toBeGreaterThan(0);
    expect(Math.abs(armedAt - sw)).toBeLessThanOrEqual(PICKUP_THRESHOLD + 1 / 127);
  });

  it("takes over when the hardware crosses the software value between messages", () => {
    // Jump from just below to just above sw (coarse controller) → crossing.
    const sw = 0.5;
    const first = decidePickup(undefined, 0.45, sw); // far enough to hold
    expect(first.dispatch).toBe(false);
    const second = decidePickup(first.entry, 0.62, sw); // crossed 0.5
    expect(second.dispatch).toBe(true);
    expect(second.entry.armed).toBe(true);
  });

  it("passes through every value once armed", () => {
    let { entry } = decidePickup(undefined, 0.8, 0.8); // arms immediately (near)
    expect(entry.armed).toBe(true);
    for (const v of [0.1, 0.9, 0.3, 0.0, 1.0]) {
      const r = decidePickup(entry, v, /* sw drifted, irrelevant once armed */ 0.5);
      expect(r.dispatch).toBe(true);
      entry = r.entry;
    }
  });

  it("falls back to immediate dispatch when the software value is unreadable (null)", () => {
    const r = decidePickup(undefined, 0.1, null);
    expect(r.dispatch).toBe(true);
    expect(r.entry.armed).toBe(true); // stays armed → no surprise re-evaluation
  });

  it("arms immediately when hardware already equals software", () => {
    const r = decidePickup(undefined, 0.42, 0.42);
    expect(r.dispatch).toBe(true);
    expect(r.entry.armed).toBe(true);
  });
});
