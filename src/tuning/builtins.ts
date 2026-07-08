/**
 * Bridge from mdrone's legacy 13-slot `TuningTable`s (microtuning.ts)
 * to canonical `PortableTuning`s.
 *
 * A TuningTable stores 13 cents degrees P1..P8, where slot 12 is the
 * repeat interval (1200¢ for the octave scales that ship today). The
 * canonical form drops that trailing entry into `period` and keeps the
 * 12 sounding degrees as `scaleCents`.
 *
 * This module is the one part of `src/tuning/` that depends on the rest
 * of mdrone (it imports the builtin/authored tables). `model.ts` and
 * `scala.ts` are self-contained; the `tuningTableToPortable` bridge here
 * is itself pure (it takes a structural table argument).
 */

import { BUILTIN_TUNINGS, AUTHORED_TUNINGS } from "../microtuning";
import { DEFAULT_PERIOD_CENTS, type PortableTuning } from "./model";
import type { SclData } from "./scala";

/** Default tonic when a table carries no absolute pitch: C4 (~261.63 Hz),
 *  matching mdrone's / mraga's default scene root. */
export const DEFAULT_TONIC_HZ = 440 * Math.pow(2, -9 / 12);

/** Minimal structural shape of a legacy tuning table — avoids importing
 *  the `TuningTable` type so this stays a pure, vendorable function. */
interface TuningTableLike {
  label: string;
  degrees: readonly number[];
}

/**
 * Convert a 13-slot TuningTable to a canonical PortableTuning. The final
 * degree (slot 12) becomes the `period`; the leading 12 degrees become
 * `scaleCents`. Octave scales (slot 12 === 1200) yield a 12-note tuning.
 */
export function tuningTableToPortable(
  table: TuningTableLike,
  tonicHz: number = DEFAULT_TONIC_HZ,
): PortableTuning {
  const degrees = table.degrees;
  const period = degrees.length > 0 ? degrees[degrees.length - 1] : DEFAULT_PERIOD_CENTS;
  const scaleCents = degrees.slice(0, Math.max(0, degrees.length - 1));
  return {
    tonicHz,
    scaleCents: [...scaleCents],
    period,
    name: table.label,
  };
}

/** mdrone's builtin tunings as canonical PortableTunings. */
export const BUILTIN_PORTABLE_TUNINGS: readonly PortableTuning[] =
  BUILTIN_TUNINGS.map((t) => tuningTableToPortable(t));

/** mdrone's authored/curated tunings as canonical PortableTunings. */
export const AUTHORED_PORTABLE_TUNINGS: readonly PortableTuning[] =
  AUTHORED_TUNINGS.map((t) => tuningTableToPortable(t));

/** Number of degree slots in a legacy TuningTable (P1..P8). */
export const TUNING_TABLE_SLOTS = 13;

/**
 * Project a parsed `.scl` scale onto the legacy 13-slot degree array the
 * editor / share-scene store. Slot 12 holds the period; slots 0..11 hold
 * the sounding degrees. `lossy` is true when the scale can't be
 * represented without discarding data — i.e. it isn't a 12-note octave
 * scale (more than 12 notes per period, or a non-octave period). Callers
 * should surface `lossy` rather than silently forcing the fit.
 */
export function sclToTuningTableDegrees(scl: SclData): {
  degrees: number[];
  lossy: boolean;
} {
  const cents = scl.cents;
  const degrees: number[] = [];
  for (let i = 0; i < TUNING_TABLE_SLOTS - 1; i++) {
    degrees[i] = i < cents.length ? cents[i] : i > 0 ? degrees[i - 1] : 0;
  }
  degrees[TUNING_TABLE_SLOTS - 1] = scl.period;
  const lossy = cents.length !== 12 || Math.abs(scl.period - 1200) > 1e-6;
  return { degrees, lossy };
}
