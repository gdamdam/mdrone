/**
 * Canonical portable tuning model — the shared runtime core.
 *
 * Generalized from mraga's `PortableTuning` (../mraga/src/tuning.ts,
 * ../mraga/src/linkImport.ts): arbitrary scale length N, an explicit
 * repeat period (so non-octave scales like Bohlen-Pierce resolve), and
 * the same length-agnostic `degreeToHz` resolver.
 *
 * Pure and framework-free — no DOM, no React, no localStorage — so it
 * is safe to unit-test under `node --test` and to vendor verbatim into
 * sibling apps.
 */

/** Frequency ratio spanning one repeat of the scale. 1200¢ = octave. */
export const DEFAULT_PERIOD_CENTS = 1200;

export interface PortableTuning {
  /** Absolute frequency of scale degree 0 (octave 0). */
  tonicHz: number;
  /** Cents above the tonic, ascending within one period. `[0]` is 0. */
  scaleCents: number[];
  /** Cents per repeat of the scale. Defaults to an octave (1200¢). */
  period?: number;
  /** Human-readable name. */
  name: string;
}

/** Linear frequency ratio for a cents interval: 2^(cents/1200). */
export function centsToRatio(cents: number): number {
  return Math.pow(2, cents / 1200);
}

/** Cents for a linear frequency ratio: 1200·log2(ratio). */
export function ratioToCents(ratio: number): number {
  return 1200 * Math.log2(ratio);
}

/** Effective repeat period of a tuning (its `period`, or the octave). */
export function periodCents(tuning: Pick<PortableTuning, "period">): number {
  return tuning.period ?? DEFAULT_PERIOD_CENTS;
}

/**
 * Resolve a scale degree to an absolute frequency (port of mraga's
 * `degreeToHz`, length-agnostic and period-aware):
 *   hz = tonicHz · 2^((scaleCents[i] + period·octave) / 1200)
 */
export function degreeToHz(
  tuning: PortableTuning,
  degreeIndex: number,
  octave: number,
): number {
  const { scaleCents, tonicHz } = tuning;
  if (
    !Number.isInteger(degreeIndex) ||
    degreeIndex < 0 ||
    degreeIndex >= scaleCents.length
  ) {
    throw new RangeError(
      `degreeToHz: degreeIndex ${degreeIndex} out of range [0, ${scaleCents.length})`,
    );
  }
  const cents = scaleCents[degreeIndex] + periodCents(tuning) * octave;
  return tonicHz * Math.pow(2, cents / 1200);
}

/**
 * Return a copy of `cents` shifted so the first entry is exactly 0.
 * Throws when the input is empty, non-finite, or not strictly ascending
 * — a non-ascending scale can't be repaired without discarding intent,
 * so it is rejected rather than silently reordered.
 */
export function normalizeScaleCents(cents: readonly number[]): number[] {
  if (!Array.isArray(cents) || cents.length === 0) {
    throw new RangeError("normalizeScaleCents: need a non-empty array");
  }
  if (!cents.every((c) => typeof c === "number" && Number.isFinite(c))) {
    throw new RangeError("normalizeScaleCents: all cents must be finite numbers");
  }
  const base = cents[0];
  const shifted = cents.map((c) => c - base);
  for (let i = 1; i < shifted.length; i++) {
    if (shifted[i] <= shifted[i - 1]) {
      throw new RangeError("normalizeScaleCents: cents must be strictly ascending");
    }
  }
  return shifted;
}

/** True when a value is a usable PortableTuning (finite positive tonic,
 *  ascending scale rooted at 0, positive period). Never throws. */
export function isValidTuning(t: unknown): t is PortableTuning {
  if (typeof t !== "object" || t === null) return false;
  const r = t as Partial<PortableTuning>;
  if (typeof r.tonicHz !== "number" || !Number.isFinite(r.tonicHz) || r.tonicHz <= 0) {
    return false;
  }
  if (!Array.isArray(r.scaleCents) || r.scaleCents.length === 0) return false;
  if (r.scaleCents[0] !== 0) return false;
  if (!r.scaleCents.every((c) => typeof c === "number" && Number.isFinite(c))) return false;
  for (let i = 1; i < r.scaleCents.length; i++) {
    if (r.scaleCents[i] <= r.scaleCents[i - 1]) return false;
  }
  if (r.period !== undefined && (!Number.isFinite(r.period) || r.period <= 0)) return false;
  return true;
}

/**
 * Return a normalized copy: scaleCents shifted to root at 0 (rejecting
 * non-ascending input) and an explicit period. Throws via
 * `normalizeScaleCents` on unrepairable input.
 */
export function normalizeTuning(t: PortableTuning): PortableTuning {
  return {
    tonicHz: t.tonicHz,
    scaleCents: normalizeScaleCents(t.scaleCents),
    period: periodCents(t),
    name: t.name,
  };
}
