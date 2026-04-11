/**
 * Sympathetic Partner — optional second drone layer that follows the
 * main scene by a fixed musical relation. Implemented as an interval
 * extension: when enabled, partner cents are appended to the main
 * interval list before pushing to the audio engine, so each main voice
 * gets a parallel partner voice without any new engine API.
 *
 * Constrained by design: a small enum of relations, no per-relation
 * parameters, no second editor surface. The partner is always
 * subordinate to the main drone.
 */

export type PartnerRelation =
  | "fifth"
  | "octave-up"
  | "octave-down"
  | "beat-detune";

export const PARTNER_RELATIONS: readonly PartnerRelation[] = [
  "fifth",
  "octave-up",
  "octave-down",
  "beat-detune",
] as const;

export interface PartnerState {
  enabled: boolean;
  relation: PartnerRelation;
}

export const DEFAULT_PARTNER: PartnerState = {
  enabled: false,
  relation: "fifth",
};

/**
 * Cents offset applied to every main interval to derive the parallel
 * partner intervals.
 *
 * - fifth        = +702 ¢ (just-intonation perfect fifth)
 * - octave-up    = +1200 ¢
 * - octave-down  = -1200 ¢
 * - beat-detune  = +7 ¢ (slow audible beating against the main voice)
 */
export function partnerCents(relation: PartnerRelation): number {
  switch (relation) {
    case "fifth": return 702;
    case "octave-up": return 1200;
    case "octave-down": return -1200;
    case "beat-detune": return 7;
  }
}

/**
 * Apply the partner extension to a main interval list. When the
 * partner is disabled or contains no relation override, returns the
 * input unchanged. Otherwise returns a new array with each main
 * interval mirrored at the partner offset.
 */
export function withPartnerIntervals(
  mainCents: readonly number[],
  partner: PartnerState,
): number[] {
  if (!partner.enabled) return [...mainCents];
  const offset = partnerCents(partner.relation);
  return [...mainCents, ...mainCents.map((c) => c + offset)];
}
