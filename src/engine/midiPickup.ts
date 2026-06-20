/**
 * midiPickup — soft-takeover ("pickup") decision for continuous MIDI CC.
 *
 * Why
 * ---
 * A hardware knob/fader holds its own physical position. After a scene or
 * preset load the on-screen value can be anywhere, so the first CC message
 * from a knob that's parked elsewhere would slam the target to the knob's
 * position — a volume fader at 10% would yank a 80% mix down on first
 * touch. Stage-unsafe.
 *
 * Behaviour (Ableton "Takeover: Pick-Up" style)
 * ---------------------------------------------
 * A continuous target is held (no dispatch) until the incoming hardware
 * value either comes within {@link PICKUP_THRESHOLD} of the current
 * software value, or crosses it between two messages (coarse controllers
 * can skip the exact value). Once "caught" the target is armed and every
 * later message passes straight through.
 *
 * This module is pure — no engine, no React, no timers — so the decision
 * is unit-testable. The Layout dispatch owns the per-target state, reads
 * the current software value, applies the result, and resets arming on
 * scene/preset load.
 */

/** Arming window: hardware within this normalized distance of the
 *  software value "catches" it. ~3/127 ≈ one-and-a-half 7-bit steps —
 *  inside the 2/127..4/127 range that feels instant without being so
 *  tight a fast sweep skips past the catch point. */
export const PICKUP_THRESHOLD = 3 / 127;

export interface PickupEntry {
  /** True once the hardware has caught the software value; from then on
   *  every move passes straight through. */
  armed: boolean;
  /** Last hardware value seen (normalized 0..1), for crossing detection.
   *  Null before the first message. */
  lastHw: number | null;
}

/** Per-target pickup state, keyed by MIDI target id. */
export type PickupState = Record<string, PickupEntry>;

export interface PickupDecision {
  /** Next state for this target — store it back keyed by target id. */
  entry: PickupEntry;
  /** Whether the caller should dispatch `hw` to the target now. */
  dispatch: boolean;
}

/** Fresh, empty pickup state. Call on init and on scene/preset load so
 *  the next hardware move must re-catch the (possibly changed) value. */
export function initialPickupState(): PickupState {
  return {};
}

/**
 * Decide whether a continuous CC should take over the target.
 *
 * @param entry     prior pickup entry for this target (undefined = first message)
 * @param hw        incoming hardware value, normalized 0..1
 * @param sw        current software value normalized 0..1, or null if it
 *                  can't be read — in which case we fall back to the legacy
 *                  immediate behaviour rather than locking out the control
 * @param threshold arming window (defaults to {@link PICKUP_THRESHOLD})
 */
export function decidePickup(
  entry: PickupEntry | undefined,
  hw: number,
  sw: number | null,
  threshold: number = PICKUP_THRESHOLD,
): PickupDecision {
  // Already caught → transparent pass-through.
  if (entry?.armed) {
    return { entry: { armed: true, lastHw: hw }, dispatch: true };
  }
  // No readable software value → can't soft-takeover. Behave like the
  // legacy immediate path and arm so we don't re-evaluate every message.
  if (sw === null) {
    return { entry: { armed: true, lastHw: hw }, dispatch: true };
  }
  const near = Math.abs(hw - sw) <= threshold;
  const prevHw = entry?.lastHw ?? null;
  // Crossing: the hardware moved from one side of the software value to
  // the other between two messages (unarmed ⇒ prevHw is never exactly sw,
  // so both signs are ±1 when `near` is false).
  const crossed = prevHw !== null && Math.sign(hw - sw) !== Math.sign(prevHw - sw);
  if (near || crossed) {
    return { entry: { armed: true, lastHw: hw }, dispatch: true };
  }
  // Still chasing — hold output, but remember position for crossing.
  return { entry: { armed: false, lastHw: hw }, dispatch: false };
}
