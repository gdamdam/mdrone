/**
 * The family's canonical tuning library, expressed as self-contained
 * `PortableTuning`s, plus pure bridge helpers to/from mdrone's legacy
 * 13-slot `TuningTable` shape.
 *
 * VENDOR-SAFE: this module imports ONLY `./model` (and a type from
 * `./scala`, which itself imports only `./model`). No `../microtuning`,
 * no DOM, no React, no localStorage. The cents values below are fixed
 * constants — the shared core CARRIES the library so consumers
 * (mchord/mkeys/mraga) inherit one tuning set instead of re-defining
 * their own and drifting. mdrone's `microtuning.ts` remains the source
 * of the 13-slot tables + metadata (ids, suggested relation/voicing);
 * a drift-guard test asserts the two builtin sets stay cents-equal.
 */

import { DEFAULT_PERIOD_CENTS, type PortableTuning } from "./model";
import type { SclData } from "./scala";

/** Default tonic when a tuning carries no absolute pitch: C4 (~261.63 Hz),
 *  matching mdrone's / mraga's default scene root (440·2^(-9/12)). */
export const DEFAULT_TONIC_HZ = 440 * Math.pow(2, -9 / 12);

/** Builtin tunings (the 12-note-per-octave core set). Cents mirror
 *  microtuning.ts BUILTIN_TUNINGS (slots P1..M7); the octave period is
 *  the table's P8. */
export const BUILTIN_PORTABLE_TUNINGS: readonly PortableTuning[] = [
  { tonicHz: DEFAULT_TONIC_HZ, scaleCents: [0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100], period: 1200, name: "Equal (12-TET)" },
  { tonicHz: DEFAULT_TONIC_HZ, scaleCents: [0, 111.73, 203.91, 315.64, 386.31, 498.04, 582.51, 701.96, 813.69, 884.36, 996.09, 1088.27], period: 1200, name: "Just 5-limit" },
  { tonicHz: DEFAULT_TONIC_HZ, scaleCents: [0, 76.05, 193.16, 310.26, 386.31, 503.42, 579.47, 696.58, 772.63, 889.74, 1006.84, 1082.89], period: 1200, name: "¼-comma Meantone" },
  { tonicHz: DEFAULT_TONIC_HZ, scaleCents: [0, 104.96, 203.91, 266.87, 386.31, 498.04, 551.32, 701.96, 813.69, 884.36, 968.83, 1088.27], period: 1200, name: "Harmonic Series" },
  { tonicHz: DEFAULT_TONIC_HZ, scaleCents: [0, 100, 200, 350, 400, 500, 600, 700, 800, 900, 1050, 1100], period: 1200, name: "Maqam Rast" },
  { tonicHz: DEFAULT_TONIC_HZ, scaleCents: [0, 80, 160, 240, 360, 480, 600, 720, 800, 880, 960, 1080], period: 1200, name: "Slendro" },
];

/** Authored / curated tunings shipped alongside the builtins. Cents
 *  mirror microtuning.ts AUTHORED_TUNINGS. */
export const AUTHORED_PORTABLE_TUNINGS: readonly PortableTuning[] = [
  { tonicHz: DEFAULT_TONIC_HZ, scaleCents: [0, 176.6, 203.9, 239.5, 444, 470.8, 674.6, 702, 737.7, 941.4, 968.8, 1172.7], period: 1200, name: "Young — Well-Tuned-Piano (7-limit)" },
  { tonicHz: DEFAULT_TONIC_HZ, scaleCents: [0, 111.73, 203.91, 266.87, 386.31, 498.04, 582.51, 701.96, 813.69, 884.36, 968.83, 1088.27], period: 1200, name: "Just 7-limit" },
  { tonicHz: DEFAULT_TONIC_HZ, scaleCents: [0, 165, 182.4, 266.87, 386.31, 498.04, 551.32, 701.96, 782.5, 884.36, 968.83, 1049.4], period: 1200, name: "Partch 11-limit subset" },
  { tonicHz: DEFAULT_TONIC_HZ, scaleCents: [0, 80, 240, 320, 400, 480, 560, 640, 720, 800, 880, 960], period: 1200, name: "Catler 12-of-15" },
  { tonicHz: DEFAULT_TONIC_HZ, scaleCents: [0, 90.2, 203.9, 294.1, 407.8, 498, 611.7, 702, 792.2, 905.9, 996.1, 1109.8], period: 1200, name: "Pythagorean (3-limit)" },
  { tonicHz: DEFAULT_TONIC_HZ, scaleCents: [0, 90.2, 193.2, 294.1, 386.3, 498, 590.2, 696.6, 792.2, 889.7, 996.1, 1088.3], period: 1200, name: "Kirnberger III (well-temp)" },
  { tonicHz: DEFAULT_TONIC_HZ, scaleCents: [0, 90.2, 192.2, 294.1, 390.2, 498, 588.3, 696.1, 792.2, 888.3, 996.1, 1092.2], period: 1200, name: "Werckmeister III (well-temp)" },
  { tonicHz: DEFAULT_TONIC_HZ, scaleCents: [0, 70.6, 211.8, 282.4, 352.9, 494.1, 564.7, 705.9, 776.5, 917.6, 988.2, 1129.4], period: 1200, name: "17-TET" },
  { tonicHz: DEFAULT_TONIC_HZ, scaleCents: [0, 126.3, 189.5, 315.8, 378.9, 505.3, 631.6, 694.7, 821.1, 884.2, 1010.5, 1073.7], period: 1200, name: "19-TET" },
  { tonicHz: DEFAULT_TONIC_HZ, scaleCents: [0, 109.1, 218.2, 272.7, 381.8, 490.9, 600, 709.1, 818.2, 927.3, 1036.4, 1090.9], period: 1200, name: "22-EDO (Paul Erlich)" },
  { tonicHz: DEFAULT_TONIC_HZ, scaleCents: [0, 116.1, 193.5, 309.7, 387.1, 503.2, 580.6, 696.8, 812.9, 890.3, 1006.5, 1083.9], period: 1200, name: "31-TET (Huygens)" },
  { tonicHz: DEFAULT_TONIC_HZ, scaleCents: [0, 111.7, 203.9, 315.6, 386.3, 498, 590.2, 702, 813.7, 905.9, 996.1, 1088.3], period: 1200, name: "Yaman (Hindustani)" },
  { tonicHz: DEFAULT_TONIC_HZ, scaleCents: [0, 120, 194, 258, 398, 538, 607, 675, 785, 864, 942, 1070], period: 1200, name: "Pelog (Javanese)" },
  { tonicHz: DEFAULT_TONIC_HZ, scaleCents: [0, 150, 203.9, 294.1, 386.3, 498, 582.5, 702, 792.2, 884.4, 996.1, 1088.3], period: 1200, name: "Bayati (Arabic maqam)" },
  { tonicHz: DEFAULT_TONIC_HZ, scaleCents: [0, 105, 203.9, 297.5, 386.3, 470.8, 551.3, 628.3, 702, 840.5, 968.8, 1088.3], period: 1200, name: "Otonal 16:32 (zero-beat reference)" },
  { tonicHz: DEFAULT_TONIC_HZ, scaleCents: [0, 105, 203.9, 297.5, 386.3, 470.8, 628.3, 702, 772.6, 905.9, 968.8, 1088.3], period: 1200, name: "Spectral Primes" },
  { tonicHz: DEFAULT_TONIC_HZ, scaleCents: [0, 82.2, 217.9, 283.1, 426.8, 492, 633.7, 689, 784.2, 922.9, 987.1, 1124.8], period: 1200, name: "Skewed (Pythagorean drift)" },
  { tonicHz: DEFAULT_TONIC_HZ, scaleCents: [0, 22.5, 45.1, 70.7, 92.2, 111.7, 133.2, 158.8, 182.4, 203.9, 223.5, 249.1], period: 1200, name: "Cluster (22-Sruti dense)" },
  { tonicHz: DEFAULT_TONIC_HZ, scaleCents: [0, 2, 4, 6, 8, 700, 702, 704, 706, 1194, 1196, 1198], period: 1200, name: "Hollow (open-fifth)" },
  { tonicHz: DEFAULT_TONIC_HZ, scaleCents: [0, 77.42, 193.55, 315.64, 386.31, 498.04, 619.35, 701.96, 774.19, 890.32, 968.83, 1122.58], period: 1200, name: "just × 31-TET" },
];

// ── Pure bridge helpers (input passed as arguments) ──────────────────

/** Minimal structural shape of a legacy 13-slot tuning table — avoids
 *  importing the `TuningTable` type so this stays pure and vendorable. */
interface TuningTableLike {
  label: string;
  degrees: readonly number[];
}

/**
 * Convert a 13-slot TuningTable to a canonical PortableTuning. The final
 * degree (slot 12) becomes the `period`; the leading degrees become
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
