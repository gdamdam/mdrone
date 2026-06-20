/**
 * Microtuning — tuning tables, interval relations, and resolver.
 *
 * A TuningTable defines cents values for 13 standard degree positions
 * (P1 through P8) within one octave. A Relation selects which of those
 * degree positions to sound simultaneously. The resolver combines the
 * two into a concrete intervalsCents array that the engine already
 * understands.
 *
 * Degree index mapping:
 *   0=P1  1=m2  2=M2  3=m3  4=M3  5=P4  6=TT
 *   7=P5  8=m6  9=M6  10=m7 11=M7 12=P8
 */

import type { ScaleId } from "./types";

export type BuiltinTuningId =
  | "equal"
  | "just5"
  | "meantone"
  | "harmonics"
  | "maqam-rast"
  | "slendro";

/** User-authored tunings stored in localStorage carry a `custom:` ID
 *  prefix so they never collide with builtins. They live alongside
 *  builtins in every lookup (tuningById, getAllTunings, the TUNINGS
 *  array) once loaded. */
export type CustomTuningId = `custom:${string}`;

export type TuningId = BuiltinTuningId | CustomTuningId;

export type RelationId =
  | "unison"
  | "tonic-fifth"
  | "tonic-fourth"
  | "minor-triad"
  | "drone-triad"
  | "harmonic-stack";

export interface TuningTable {
  id: TuningId;
  label: string;
  /** Cents for 13 degree positions (P1 through P8). */
  degrees: readonly number[];
  /** Authored starting-point metadata: the relation this tuning was
   *  designed to be heard through. Applied when the user explicitly
   *  picks the tuning in the picker (see relationForTuningPick) —
   *  never on scene/share/preset loads, which carry their own
   *  relation. Absent on builtins and unannotated entries. */
  suggestedRelationId?: RelationId;
  /** Companion voice-layer ids (DroneView VOICES) for the authored
   *  reading. Metadata only for now — not auto-applied, since
   *  rewriting the user's voice mix on a tuning pick would be
   *  destructive; reserved for a future "apply voicing" affordance. */
  suggestedVoicing?: readonly string[];
}

export interface Relation {
  id: RelationId;
  label: string;
  hint: string;
  /** Indices into the tuning table's degrees array. */
  picks: readonly number[];
}

export const DEGREE_LABELS: readonly string[] = [
  "P1", "m2", "M2", "m3", "M3", "P4", "TT", "P5", "m6", "M6", "m7", "M7", "P8",
];

// ── Tuning tables ────────────────────────────────────────────────────

export const BUILTIN_TUNINGS: readonly TuningTable[] = [
  {
    id: "equal",
    label: "Equal (12-TET)",
    degrees: [0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200],
  },
  {
    id: "just5",
    label: "Just 5-limit",
    // 5-limit ratios: 1/1, 16/15, 9/8, 6/5, 5/4, 4/3, 45/32, 3/2, 8/5, 5/3, 16/9, 15/8, 2/1
    degrees: [0, 111.73, 203.91, 315.64, 386.31, 498.04, 582.51, 701.96, 813.69, 884.36, 996.09, 1088.27, 1200],
  },
  {
    id: "meantone",
    label: "¼-comma Meantone",
    // 1/4-comma meantone temperament — Malone / Arkbro pipe organs
    degrees: [0, 76.05, 193.16, 310.26, 386.31, 503.42, 579.47, 696.58, 772.63, 889.74, 1006.84, 1082.89, 1200],
  },
  {
    id: "harmonics",
    label: "Harmonic Series",
    // Natural partials mapped to degree positions:
    // 17/16, 9/8, 7/6, 5/4, 4/3, 11/8, 3/2, 8/5, 5/3, 7/4, 15/8
    degrees: [0, 104.96, 203.91, 266.87, 386.31, 498.04, 551.32, 701.96, 813.69, 884.36, 968.83, 1088.27, 1200],
  },
  {
    id: "maqam-rast",
    label: "Maqam Rast",
    // Arabic Rast maqam — neutral third (~350) and neutral seventh (~1050)
    // Non-Rast positions use equal-temperament fallbacks
    degrees: [0, 100, 200, 350, 400, 500, 600, 700, 800, 900, 1050, 1100, 1200],
  },
  {
    id: "slendro",
    label: "Slendro",
    // Javanese gamelan 5-tone scale. The 5 slendro pitches
    // (0, 240, 480, 720, 960, +octave 1200) are placed at the degree
    // slots the relations actually pick (0, 3, 5, 7, 10, 12) so
    // unison / fourth / fifth / drone-triad / harmonic-stack all
    // resolve to real slendro intervals. The remaining 6 filler
    // slots are monotonically interpolated between anchors so every
    // degree yields a distinct pitch — no earlier bug where picking
    // different slendro degrees produced duplicate cents.
    degrees: [0, 80, 160, 240, 360, 480, 600, 720, 800, 880, 960, 1080, 1200],
  },
];

/** Authored / curated tunings shipped alongside builtins. Use the
 *  `custom:` ID prefix so they ride the existing custom-tuning infra
 *  (resolver fallback, share-URL embedding) without colliding with
 *  user-authored tables of the same slug — authored entries are
 *  added via code; user entries live in localStorage. */
export const AUTHORED_TUNINGS: readonly TuningTable[] = [
  {
    id: "custom:young-wtp" as CustomTuningId,
    label: "Young — Well-Tuned-Piano (7-limit)",
    // La Monte Young's Well-Tuned-Piano 7-limit just lattice (1964-
    // present). Ratios (rooted at 1/1, sorted ascending):
    // 1/1, 567/512, 9/8, 147/128, 1323/1024, 21/16, 189/128, 3/2,
    // 49/32, 441/256, 7/4, 63/32, 2/1. Cents rounded to 0.1.
    degrees: [0, 176.6, 203.9, 239.5, 444.0, 470.8, 674.6, 702.0, 737.7, 941.4, 968.8, 1172.7, 1200],
  },
  {
    id: "custom:just7" as CustomTuningId,
    label: "Just 7-limit",
    // 7-limit just intonation — adds the 7th partial (7/4, 7/6, 7/5)
    // to standard 5-limit. Ratios: 1/1, 16/15, 9/8, 7/6, 5/4, 4/3,
    // 7/5, 3/2, 8/5, 5/3, 7/4, 15/8, 2/1.
    degrees: [0, 111.73, 203.91, 266.87, 386.31, 498.04, 582.51, 701.96, 813.69, 884.36, 968.83, 1088.27, 1200],
  },
  {
    id: "custom:partch-11" as CustomTuningId,
    label: "Partch 11-limit subset",
    // 13-degree subset of Harry Partch's 43-tone just intonation
    // scale. Ratios: 1/1, 11/10, 10/9, 7/6, 5/4, 4/3, 11/8, 3/2,
    // 11/7, 5/3, 7/4, 11/6, 2/1.
    degrees: [0, 165.0, 182.4, 266.87, 386.31, 498.04, 551.32, 701.96, 782.5, 884.36, 968.83, 1049.4, 1200],
  },
  {
    id: "custom:15-tet" as CustomTuningId,
    label: "15-TET (Catler)",
    // 15-tone equal temperament — 80-cent steps. Used by Jon Catler
    // and others for microtonal guitar / pentadecaphonic harmony.
    // 13 ascending degrees from the 15-step ladder, bound to the
    // octave at P8.
    degrees: [0, 80, 240, 320, 400, 480, 560, 640, 720, 800, 880, 960, 1200],
  },

  // ── Curated additions: drone-forward scales from the wider canon ──
  // Each carries structured suggestedRelationId / suggestedVoicing
  // metadata so the picker can land the user in a musically idiomatic
  // starting place rather than unison (see relationForTuningPick).
  // The per-entry comments keep the musical *why* behind each pairing.

  {
    id: "custom:pythagorean" as CustomTuningId,
    label: "Pythagorean (3-limit)",
    // Pure 3/2 stack, the Western-ancient drone tuning. Ratios:
    // 1/1, 256/243, 9/8, 32/27, 81/64, 4/3, 729/512, 3/2, 128/81,
    // 27/16, 16/9, 243/128, 2/1. Glassy fifths, bright ditone 3rd.
    // Suggested relation: tonic-fifth. Voicing: tanpura + metal —
    // the ringing 3/2 is the whole point.
    degrees: [0, 90.2, 203.9, 294.1, 407.8, 498.0, 611.7, 702.0, 792.2, 905.9, 996.1, 1109.8, 1200],
    suggestedRelationId: "tonic-fifth",
    suggestedVoicing: ["tanpura", "metal"],
  },
  {
    id: "custom:kirnberger-iii" as CustomTuningId,
    label: "Kirnberger III (well-temp)",
    // Bach-era well-temperament (J.P. Kirnberger, 1779). Key colours
    // preserved, C major cleanest; drones in remote keys breathe.
    // Suggested relation: drone-triad. Voicing: piano + reed for the
    // harpsichord / clavichord reading.
    degrees: [0, 90.2, 193.2, 294.1, 386.3, 498.0, 590.2, 696.6, 792.2, 889.7, 996.1, 1088.3, 1200],
    suggestedRelationId: "drone-triad",
    suggestedVoicing: ["piano", "reed"],
  },
  {
    id: "custom:werckmeister-iii" as CustomTuningId,
    label: "Werckmeister III (well-temp)",
    // Andreas Werckmeister, 1691. Slightly sharper triad colour than
    // Kirnberger III, the likeliest temperament behind WTC Book I.
    // Suggested relation: drone-triad. Voicing: piano + air.
    degrees: [0, 90.2, 192.2, 294.1, 390.2, 498.0, 588.3, 696.1, 792.2, 888.3, 996.1, 1092.2, 1200],
    suggestedRelationId: "drone-triad",
    suggestedVoicing: ["piano", "air"],
  },
  {
    id: "custom:17-tet" as CustomTuningId,
    label: "17-TET",
    // 17-tone equal temperament — clean 5ths, very sharp 3rds,
    // neutral-ish seconds. Natural host for Turkish/Arab flavours.
    // Suggested relation: tonic-fifth (the 3rds are too hot for a
    // drone triad). Voicing: reed + metal.
    degrees: [0, 70.6, 211.8, 282.4, 352.9, 494.1, 564.7, 705.9, 776.5, 917.6, 988.2, 1129.4, 1200],
    suggestedRelationId: "tonic-fifth",
    suggestedVoicing: ["reed", "metal"],
  },
  {
    id: "custom:19-tet" as CustomTuningId,
    label: "19-TET",
    // 19-tone equal temperament — meantone's close cousin; the
    // minor 3rd is its purest interval (6/5-adjacent).
    // Suggested relation: minor-triad. Voicing: reed + air.
    degrees: [0, 126.3, 189.5, 315.8, 378.9, 505.3, 631.6, 694.7, 821.1, 884.2, 1010.5, 1073.7, 1200],
    suggestedRelationId: "minor-triad",
    suggestedVoicing: ["reed", "air"],
  },
  {
    id: "custom:22-edo" as CustomTuningId,
    label: "22-EDO (Paul Erlich)",
    // 22-tone equal division — xenharmonic home of Pajara / Porcupine.
    // Approximates 5-limit triads with a characteristic "wolf" edge.
    // Suggested relation: drone-triad. Voicing: metal + noise for
    // the bright xen character.
    degrees: [0, 109.1, 218.2, 272.7, 381.8, 490.9, 600, 709.1, 818.2, 927.3, 1036.4, 1090.9, 1200],
    suggestedRelationId: "drone-triad",
    suggestedVoicing: ["metal", "noise"],
  },
  {
    id: "custom:31-tet" as CustomTuningId,
    label: "31-TET (Huygens)",
    // 31-tone equal temperament — extraordinarily close to 1/4-comma
    // meantone across 5-limit, famous from Fokker's organ.
    // Suggested relation: drone-triad. Voicing: tanpura + reed —
    // silky, near-pure triad.
    degrees: [0, 116.1, 193.5, 309.7, 387.1, 503.2, 580.6, 696.8, 812.9, 890.3, 1006.5, 1083.9, 1200],
    suggestedRelationId: "drone-triad",
    suggestedVoicing: ["tanpura", "reed"],
  },
  {
    id: "custom:yaman" as CustomTuningId,
    label: "Yaman (Hindustani)",
    // Evening raga, Ionian with raised 4th (Ma teevra). Sa–Ga–Pa is
    // the harmonic skeleton. Ratios at the characteristic slots:
    // 1/1, 9/8 (re), 5/4 (ga), 45/32 (ma teevra), 3/2 (pa),
    // 27/16 (dha), 15/8 (ni). Filler slots use just-5 defaults so
    // all relations resolve to real Yaman tones.
    // Suggested relation: drone-triad. Voicing: tanpura + reed.
    degrees: [0, 111.7, 203.9, 315.6, 386.3, 498.0, 590.2, 702.0, 813.7, 905.9, 996.1, 1088.3, 1200],
    suggestedRelationId: "drone-triad",
    suggestedVoicing: ["tanpura", "reed"],
  },
  {
    id: "custom:pelog" as CustomTuningId,
    label: "Pelog (Javanese)",
    // Javanese gamelan 7-tone, companion to Slendro. Cents from
    // Barlow's 1980s measurements (pathet nem). Characteristic
    // anchors: 120, 258, 538, 675, 785, 942. Filler slots
    // monotonically interpolated so every degree slot yields a
    // distinct pitch.
    // Suggested relation: unison — gamelan drones are single-tone.
    // Voicing: metal + air.
    degrees: [0, 120, 194, 258, 398, 538, 607, 675, 785, 864, 942, 1070, 1200],
    suggestedRelationId: "unison",
    suggestedVoicing: ["metal", "air"],
  },
  {
    id: "custom:bayati" as CustomTuningId,
    label: "Bayati (Arabic maqam)",
    // Arabic maqam with neutral 2nd (~150¢) — melancholy, devotional.
    // Anchors: P1=0, m2=150 (sikah neutral), m3=32/27 (294.1),
    // P4=4/3, P5=3/2, m6=128/81 (792.2), m7=16/9 (996.1). Other
    // slots fall to just-5 defaults.
    // Suggested relation: tonic-fifth (sa–pa drone; neutral 2nd
    // sings in melody, not chord). Voicing: reed + air.
    degrees: [0, 150, 203.9, 294.1, 386.3, 498.0, 582.5, 702.0, 792.2, 884.4, 996.1, 1088.3, 1200],
    suggestedRelationId: "tonic-fifth",
    suggestedVoicing: ["reed", "air"],
  },

  // ── Concept tunings: reference, spectral, broken, cluster, sparse, house ──
  // Not historical scales — designed to cover specific drone-aesthetic
  // territory that the canon tunings above don't reach. Each was picked
  // to sound distinctly different from the others.

  {
    id: "custom:otonal-16-32" as CustomTuningId,
    label: "Otonal 16:32 (zero-beat reference)",
    // Partials 16 through 32 of one fundamental, picked 13-wide:
    // 16, 17, 18, 19, 20, 21, 22, 23, 24, 26, 28, 30, 32. Every
    // pitch is an exact integer multiple of the root — phases lock,
    // beats vanish. The purest reference the app can produce.
    // Suggested relation: harmonic-stack. Voicing: reed + air +
    // metal — spectral richness without interfering beats.
    degrees: [0, 105.0, 203.9, 297.5, 386.3, 470.8, 551.3, 628.3, 702.0, 840.5, 968.8, 1088.3, 1200],
    suggestedRelationId: "harmonic-stack",
    suggestedVoicing: ["reed", "air", "metal"],
  },
  {
    id: "custom:spectral-primes" as CustomTuningId,
    label: "Spectral Primes",
    // Extended harmonic series leaning on upper primes (19, 23, 25,
    // 27) instead of the safe 17/18/20/24 partials. Partials:
    // 16, 17, 18, 19, 20, 21, 23, 24, 25, 27, 28, 30, 32. Same
    // fundamental logic as Otonal 16:32 but with a weirder
    // spectral fingerprint — Sethares-adjacent territory.
    // Suggested relation: harmonic-stack. Voicing: metal + fm —
    // lets the upper-prime colour ring against bright partials.
    degrees: [0, 105.0, 203.9, 297.5, 386.3, 470.8, 628.3, 702.0, 772.6, 905.9, 968.8, 1088.3, 1200],
    suggestedRelationId: "harmonic-stack",
    suggestedVoicing: ["metal", "fm"],
  },
  {
    id: "custom:skewed-pythagorean" as CustomTuningId,
    label: "Skewed (Pythagorean drift)",
    // Pythagorean base with a seeded detune per degree (±5–25¢).
    // Pure-looking intervals beat slowly and irregularly; the
    // tonic–fifth drifts by ~13¢ so even the house relation has
    // motion baked in. Productive unease rather than error.
    // Suggested relation: tonic-fifth. Voicing: reed + noise —
    // the persistent beating reads as living texture.
    degrees: [0, 82.2, 217.9, 283.1, 426.8, 492.0, 633.7, 689.0, 784.2, 922.9, 987.1, 1124.8, 1200],
    suggestedRelationId: "tonic-fifth",
    suggestedVoicing: ["reed", "noise"],
  },
  {
    id: "custom:cluster-sruti" as CustomTuningId,
    label: "Cluster (22-Sruti dense)",
    // First 12 sruti of the 22-sruti Indian system packed into the
    // lower quarter-octave (0–249¢), then a hard jump to the octave
    // at P8. Any relation touching the low degrees yields a beating
    // cluster; tonic-fifth/tonic-fourth still resolve but on tightly
    // spaced pitches.
    // Suggested relation: unison — cluster relations easily overload.
    // Voicing: air + metal — quiet dense weather, not chordal mass.
    degrees: [0, 22.5, 45.1, 70.7, 92.2, 111.7, 133.2, 158.8, 182.4, 203.9, 223.5, 249.1, 1200],
    suggestedRelationId: "unison",
    suggestedVoicing: ["air", "metal"],
  },
  {
    id: "custom:hollow-fifth" as CustomTuningId,
    label: "Hollow (open-fifth)",
    // Only three harmonically real anchors: P1, P5 (pure 3/2 ≈ 702),
    // and P8. Interior slots cluster around each anchor with
    // sub-10¢ offsets so the picker stays strictly monotonic but
    // any relation collapses to near-unisons around {0, 702, 1200}.
    // The tuning itself imposes a power-chord identity regardless
    // of the chosen relation.
    // Suggested relation: tonic-fifth. Voicing: amp + tanpura —
    // the archetypal open-5th drone.
    degrees: [0, 2, 4, 6, 8, 700, 702, 704, 706, 1194, 1196, 1198, 1200],
    suggestedRelationId: "tonic-fifth",
    suggestedVoicing: ["amp", "tanpura"],
  },
  {
    id: "custom:mdrone-signature" as CustomTuningId,
    label: "just × 31-TET",
    // House tuning, built for this app's relation system rather than
    // borrowed from a tradition. The six relations (unison,
    // tonic-fourth, tonic-fifth, minor-triad, drone-triad,
    // harmonic-stack) collectively pick slots {0, 3, 4, 5, 7, 10, 12}
    // — those slots are locked to PURE JUST ratios so every
    // relation resolves beat-free:
    //   P1=1/1, m3=6/5, M3=5/4, P4=4/3, P5=3/2, m7=7/4, P8=2/1.
    // The remaining slots {1, 2, 6, 8, 9, 11} — only reachable via
    // custom relations or direct degree picking — carry 31-TET
    // meantone pitches (steps 2, 5, 16, 20, 23, 29):
    //   m2=77.4, M2=193.5, TT=619.4, m6=774.2, M6=890.3, M7=1122.6.
    // The result: just drones at every built-in relation, meantone
    // colour in the interstitial degrees. Hybrid by construction,
    // tuned to the app rather than to history.
    // Suggested relation: harmonic-stack (shows off the full just
    // skeleton). Voicing: tanpura + reed + air.
    degrees: [0, 77.42, 193.55, 315.64, 386.31, 498.04, 619.35, 701.96, 774.19, 890.32, 968.83, 1122.58, 1200],
    suggestedRelationId: "harmonic-stack",
    suggestedVoicing: ["tanpura", "reed", "air"],
  },
];

// ── Relation presets ─────────────────────────────────────────────────

export const RELATIONS: readonly Relation[] = [
  {
    id: "unison",
    label: "Unison",
    hint: "Single root tone",
    picks: [0],
  },
  {
    id: "tonic-fifth",
    label: "Tonic + Fifth",
    hint: "Root and fifth — classic drone",
    picks: [0, 7],
  },
  {
    id: "tonic-fourth",
    label: "Tonic + Fourth",
    hint: "Root and fourth — tanpura sa-pa",
    picks: [0, 5],
  },
  {
    id: "minor-triad",
    label: "Minor Triad",
    hint: "Root, minor third, fifth",
    picks: [0, 3, 7],
  },
  {
    id: "drone-triad",
    label: "Drone Triad",
    hint: "Root, major third, fifth",
    picks: [0, 4, 7],
  },
  {
    id: "harmonic-stack",
    label: "Harmonic Stack",
    hint: "Root through 7th partial + octave",
    picks: [0, 4, 7, 10, 12],
  },
];

// ── Custom tuning registry ───────────────────────────────────────────

const CUSTOM_STORAGE_KEY = "mdrone.customTunings";

function sanitizeTuningTable(raw: unknown): TuningTable | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as { id?: unknown; label?: unknown; degrees?: unknown };
  if (typeof r.id !== "string" || !r.id.startsWith("custom:")) return null;
  if (typeof r.label !== "string") return null;
  if (!Array.isArray(r.degrees) || r.degrees.length !== 13) return null;
  const degrees = r.degrees.map((d) =>
    typeof d === "number" && Number.isFinite(d) ? d : 0,
  );
  return { id: r.id as CustomTuningId, label: r.label, degrees };
}

function loadCustomTuningsFromStorage(): TuningTable[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(CUSTOM_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(sanitizeTuningTable)
      .filter((t): t is TuningTable => t !== null);
  } catch {
    return [];
  }
}

const customTunings: TuningTable[] = loadCustomTuningsFromStorage();
const subscribers = new Set<() => void>();

function persistCustomTunings(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(CUSTOM_STORAGE_KEY, JSON.stringify(customTunings));
  } catch {
    // ignore quota / private-mode failures
  }
}

function notifySubscribers(): void {
  subscribers.forEach((fn) => fn());
}

export function getCustomTunings(): readonly TuningTable[] {
  return customTunings;
}

export function getAllTunings(): readonly TuningTable[] {
  return [...BUILTIN_TUNINGS, ...AUTHORED_TUNINGS, ...customTunings];
}

/** Subscribe to custom-tuning registry changes. The callback fires
 *  synchronously after every save/delete. Returns an unsubscribe fn.
 *  React components use this via useSyncExternalStore so the tuning
 *  dropdown re-renders when the Scale Editor writes a new entry. */
export function subscribeToTunings(fn: () => void): () => void {
  subscribers.add(fn);
  return () => { subscribers.delete(fn); };
}

/** Save or replace a custom tuning at an EXPLICIT `custom:*` id.
 *  Used when applying a shared scene so the bundled cents land at
 *  the exact id the scene's `drone.tuningId` references, even when
 *  the label's slug doesn't match the id (authored tunings often
 *  have mismatched slugs, e.g. id `custom:31-tet` / label
 *  "31-TET (Huygens)"). Returns the stored table, or null if the id
 *  isn't a valid `custom:*` id or degrees aren't a 13-slot array. */
export function saveCustomTuningAtId(
  id: string,
  label: string,
  degrees: readonly number[],
): TuningTable | null {
  if (typeof id !== "string" || !id.startsWith("custom:")) return null;
  if (!Array.isArray(degrees) || degrees.length !== 13) return null;
  const customId = id as CustomTuningId;
  const cleanLabel = (typeof label === "string" && label.trim()) || "Untitled";
  const cleanDegrees = degrees.map((d) => (typeof d === "number" && Number.isFinite(d) ? d : 0));
  const table: TuningTable = { id: customId, label: cleanLabel, degrees: cleanDegrees };
  const existingIdx = customTunings.findIndex((t) => t.id === customId);
  if (existingIdx >= 0) customTunings[existingIdx] = table;
  else customTunings.push(table);
  rebuildTuningMap();
  persistCustomTunings();
  notifySubscribers();
  return table;
}

/** Save or replace a custom tuning. The supplied `name` becomes both
 *  the display label and (after slugification) the ID suffix. Returns
 *  the stored table. */
/** Compute the custom-tuning id a given user-facing name will be
 *  saved under. Pure — does not touch storage. Exposed so editor UI
 *  can warn about collisions before the user hits SAVE. */
export function customTuningIdForName(name: string): CustomTuningId {
  const label = name.trim() || "Untitled";
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "untitled";
  return `custom:${slug}` as CustomTuningId;
}

export function saveCustomTuning(name: string, degrees: readonly number[]): TuningTable {
  const label = name.trim() || "Untitled";
  const baseId = customTuningIdForName(label);
  // De-duplicate against every known id (builtin, authored `custom:*`,
  // previously saved) so e.g. a user save named "Pelog" can't silently
  // shadow the authored custom:pelog table. Suffixes are deterministic
  // (-2, -3, …); existing stored entries are never re-slugged, so old
  // saves keep loading at their original ids.
  let id = baseId;
  for (let n = 2; tuningMap.has(id); n++) {
    id = `${baseId}-${n}` as CustomTuningId;
  }
  const padded = degrees.slice(0, 13);
  while (padded.length < 13) padded.push(0);
  const table: TuningTable = { id, label, degrees: padded };
  customTunings.push(table);
  rebuildTuningMap();
  persistCustomTunings();
  notifySubscribers();
  return table;
}

/** Save flow for the scale editor. Slug de-duplication in
 *  `saveCustomTuning` means re-saving the tuning the editor was opened
 *  on would create a `-2` duplicate instead of updating it — so when
 *  the name still slugs to `currentTuningId`, replace in place via
 *  `saveCustomTuningAtId`; otherwise save as a new entry. */
export function saveOrUpdateCustomTuning(
  name: string,
  degrees: readonly number[],
  currentTuningId: string | null,
): TuningTable {
  const label = name.trim() || "Untitled";
  if (currentTuningId && customTuningIdForName(label) === currentTuningId) {
    const padded = degrees.slice(0, 13) as number[];
    while (padded.length < 13) padded.push(0);
    const replaced = saveCustomTuningAtId(currentTuningId, label, padded);
    if (replaced) return replaced;
  }
  return saveCustomTuning(name, degrees);
}

export function deleteCustomTuning(id: string): void {
  const idx = customTunings.findIndex((t) => t.id === id);
  if (idx < 0) return;
  customTunings.splice(idx, 1);
  rebuildTuningMap();
  persistCustomTunings();
  notifySubscribers();
}

/** Back-compat alias so existing call sites that imported `TUNINGS`
 *  keep working. Includes custom tunings, so the SHAPE tuning picker
 *  auto-lists them. Treat as readonly — mutations must go through
 *  saveCustomTuning / deleteCustomTuning. */
// The Proxy traps fire once per property access (`.length` plus every
// numeric index in render loops), so rebuilding the combined array in
// each trap was an O(n) allocation per access. Cache it and invalidate
// whenever the custom registry changes (rebuildTuningMap runs on every
// save/delete path).
let combinedTuningsCache: TuningTable[] | null = null;
function combinedTunings(): TuningTable[] {
  if (combinedTuningsCache === null) {
    combinedTuningsCache = [...BUILTIN_TUNINGS, ...AUTHORED_TUNINGS, ...customTunings];
  }
  return combinedTuningsCache;
}

export const TUNINGS: readonly TuningTable[] = new Proxy([] as TuningTable[], {
  get(_target, prop, receiver) {
    const combined = combinedTunings();
    const value = Reflect.get(combined, prop, receiver);
    if (typeof value === "function") return value.bind(combined);
    return value;
  },
  has(_target, prop) {
    return Reflect.has(combinedTunings(), prop);
  },
});

// ── Lookups ──────────────────────────────────────────────────────────

let tuningMap = new Map<string, TuningTable>(
  [...BUILTIN_TUNINGS, ...AUTHORED_TUNINGS, ...customTunings].map((t) => [t.id, t]),
);
const relationMap = new Map(RELATIONS.map((r) => [r.id, r]));

function rebuildTuningMap(): void {
  tuningMap = new Map<string, TuningTable>(
    [...BUILTIN_TUNINGS, ...AUTHORED_TUNINGS, ...customTunings].map((t) => [t.id, t]),
  );
  // customTunings changed — drop the TUNINGS proxy's combined snapshot
  // so the next access rebuilds it.
  combinedTuningsCache = null;
}

export function tuningById(id: TuningId): TuningTable {
  return tuningMap.get(id) ?? BUILTIN_TUNINGS[0];
}

export function relationById(id: RelationId): Relation {
  return relationMap.get(id) ?? RELATIONS[0];
}

/** Relation to dispatch when the user EXPLICITLY picks `tuningId` in
 *  the tuning picker: the tuning's authored suggestedRelationId when it
 *  has one, otherwise the relation they already had. Pure decision
 *  helper — callers must only invoke it on direct picker interaction,
 *  never on scene/share/preset loads (those carry their own relation). */
export function relationForTuningPick(
  tuningId: TuningId | null,
  currentRelationId: RelationId | null,
): RelationId | null {
  if (!tuningId) return currentRelationId;
  // Deliberately not tuningById(): its equal-temperament fallback for
  // unknown ids would wrongly surface equal's (absent) suggestion as a
  // real lookup; unknown tunings must leave the relation untouched.
  const tuning = tuningMap.get(tuningId);
  return tuning?.suggestedRelationId ?? currentRelationId;
}

// ── Resolver ─────────────────────────────────────────────────────────

/** Resolve a tuning + relation pair to concrete intervalsCents. */
export function resolveTuning(tuningId: TuningId, relationId: RelationId): number[] {
  const tuning = tuningById(tuningId);
  const relation = relationById(relationId);
  return relation.picks.map((idx) => tuning.degrees[idx] ?? 0);
}

// ── Ratio metadata + display rows ────────────────────────────────────
//
// Degrees are stored as cents. Rather than hand-transcribe a ratio string
// per slot (error-prone — e.g. just5's tritone is authored at 582.51¢ =
// 7/5, not the 45/32 its source comment names), we DERIVE the ratio by
// matching a degree's cents against a canonical just-ratio table within a
// tight tolerance, and only for tunings that are genuinely just/rational.
// So we never print a ratio for a tempered/EDO degree and never invent
// one; EDOs, well-temperaments, maqam and gamelan always return null.

const RATIO_TOLERANCE_CENTS = 1.5;

const JUST_INTONATION_TUNINGS: ReadonlySet<TuningId> = new Set<TuningId>([
  "just5",
  "harmonics",
  "custom:just7" as CustomTuningId,
  "custom:partch-11" as CustomTuningId,
  "custom:pythagorean" as CustomTuningId,
  "custom:mdrone-signature" as CustomTuningId,
]);

/** Canonical small-integer ratios with their cents. A just-tuning degree
 *  shows a ratio only when its cents land within RATIO_TOLERANCE_CENTS of
 *  one of these; the entries are all >3¢ apart, so a match is unambiguous. */
const JI_RATIOS: ReadonlyArray<{ ratio: string; cents: number }> = (
  [
    ["1", "1"], ["256", "243"], ["17", "16"], ["16", "15"], ["11", "10"],
    ["10", "9"], ["9", "8"], ["7", "6"], ["32", "27"], ["6", "5"],
    ["5", "4"], ["81", "64"], ["4", "3"], ["11", "8"], ["7", "5"],
    ["729", "512"], ["3", "2"], ["11", "7"], ["128", "81"], ["8", "5"],
    ["5", "3"], ["27", "16"], ["7", "4"], ["16", "9"], ["11", "6"],
    ["15", "8"], ["243", "128"], ["2", "1"],
  ] as ReadonlyArray<readonly [string, string]>
).map(([n, d]) => ({ ratio: `${n}/${d}`, cents: 1200 * Math.log2(Number(n) / Number(d)) }));

/** Known just-intonation ratio string for a tuning degree, or null when
 *  the tuning isn't just, the degree is tempered, or the index is out of
 *  range. Conservative: never approximates an EDO degree. */
export function ratioForDegree(tuningId: TuningId, degreeIndex: number): string | null {
  if (!JUST_INTONATION_TUNINGS.has(tuningId)) return null;
  const cents = tuningById(tuningId).degrees[degreeIndex];
  if (cents == null || !Number.isFinite(cents)) return null;
  let best: { ratio: string; delta: number } | null = null;
  for (const { ratio, cents: rc } of JI_RATIOS) {
    const delta = Math.abs(rc - cents);
    if (delta <= RATIO_TOLERANCE_CENTS && (best === null || delta < best.delta)) {
      best = { ratio, delta };
    }
  }
  return best?.ratio ?? null;
}

/** One resolved degree of a tuning+relation, ready for compact display:
 *  degree label (P1/m3/P5…), cents, and the known ratio (or null). */
export interface TuningDegreeRow {
  degreeIndex: number;
  label: string;
  cents: number;
  ratio: string | null;
}

/** Resolve a tuning+relation to display rows — the same picks as
 *  resolveTuning(), enriched with degree label + known ratio. */
export function resolveTuningRows(tuningId: TuningId, relationId: RelationId): TuningDegreeRow[] {
  const tuning = tuningById(tuningId);
  const relation = relationById(relationId);
  return relation.picks.map((idx) => ({
    degreeIndex: idx,
    label: DEGREE_LABELS[idx] ?? `°${idx}`,
    cents: tuning.degrees[idx] ?? 0,
    ratio: ratioForDegree(tuningId, idx),
  }));
}

// ── Suggested voicing ────────────────────────────────────────────────

export interface VoicingPlan {
  /** Full voiceLayers map: suggested voices on, all others off. */
  layers: Record<string, boolean>;
  /** Levels to set — only for the suggested voices (preserving an
   *  existing audible level, or a sensible default when near-silent).
   *  Non-suggested voices are left untouched, just switched off. */
  levels: Record<string, number>;
}

/** Plan the voice changes for the "apply suggested voicing" button. Pure:
 *  the caller applies the result as a single recorded (undoable) patch.
 *  Unknown ids in `suggested` are ignored. */
export function planSuggestedVoicing(
  allVoiceIds: readonly string[],
  suggested: readonly string[],
  currentLevels: Readonly<Record<string, number>>,
  opts?: { defaultLevel?: number; minLevel?: number },
): VoicingPlan {
  const defaultLevel = opts?.defaultLevel ?? 0.7;
  const minLevel = opts?.minLevel ?? 0.05;
  const wanted = new Set(suggested.filter((id) => allVoiceIds.includes(id)));
  const layers: Record<string, boolean> = {};
  const levels: Record<string, number> = {};
  for (const id of allVoiceIds) {
    const on = wanted.has(id);
    layers[id] = on;
    if (on) {
      const cur = currentLevels[id] ?? 0;
      levels[id] = cur > minLevel ? cur : defaultLevel;
    }
  }
  return { layers, levels };
}

export function relationLabels(relationId: RelationId): string[] {
  return relationById(relationId).picks.map((idx) => DEGREE_LABELS[idx] ?? `#${idx}`);
}

function applyFineTuneOffsets(intervals: readonly number[], offsets?: readonly number[]): number[] {
  return intervals.map((interval, index) => {
    if (index === 0) return 0;
    const offset = typeof offsets?.[index] === "number"
      ? Math.max(-25, Math.min(25, offsets[index]!))
      : 0;
    return interval + offset;
  });
}

// ── Valid-ID sets (for normalization) ────────────────────────────────

export const BUILTIN_TUNING_IDS: readonly BuiltinTuningId[] =
  BUILTIN_TUNINGS.map((t) => t.id as BuiltinTuningId);

/** Valid-ID check for session normalization. Accepts both builtin
 *  IDs and any `custom:*` ID (even if the referenced tuning hasn't
 *  been loaded yet — the resolver will fall back to equal if the
 *  table isn't found at resolve time). */
export function isValidTuningId(id: unknown): id is TuningId {
  if (typeof id !== "string") return false;
  if ((BUILTIN_TUNING_IDS as readonly string[]).includes(id)) return true;
  return id.startsWith("custom:");
}

/** True if `id` belongs to a tuning that ships with the app (builtin or
 *  authored). These live in the shared lookup map ahead of the user's
 *  `customTunings`, so a `customTunings` entry written at the same id
 *  would silently shadow the bundled table. `saveCustomTuning` already
 *  de-dups new saves against the full map; this predicate lets untrusted
 *  callers (shared-scene apply) make the same check before persisting a
 *  scene's bundled-id customTuning — the recipient already has the
 *  bundled table, so the scene resolves correctly without the write. */
const BUNDLED_TUNING_IDS = new Set<string>(
  [...BUILTIN_TUNINGS, ...AUTHORED_TUNINGS].map((t) => t.id),
);
export function isBundledTuningId(id: string): boolean {
  return BUNDLED_TUNING_IDS.has(id);
}

/** @deprecated Use `isValidTuningId` for validation or
 *  `BUILTIN_TUNING_IDS` when you specifically need builtins. This
 *  constant captures only builtins and is kept for back-compat. */
export const TUNING_IDS: readonly TuningId[] = BUILTIN_TUNING_IDS;
export const RELATION_IDS: readonly RelationId[] = RELATIONS.map((r) => r.id);

// ── Legacy ScaleId → intervalsCents fallback ─────────────────────────
// Kept here so the resolver module is the single source of truth for
// "state → intervalsCents". When tuningId+relationId are absent the
// caller falls through to the old scale-based lookup which lives in
// droneSceneModel.ts (scaleById).

/**
 * Resolve intervals from scene state. If tuningId + relationId are both
 * present, use the microtuning resolver. Otherwise fall back to the
 * legacy scaleById path.
 */
export function resolveIntervals(state: {
  scale: ScaleId;
  tuningId?: TuningId | null;
  relationId?: RelationId | null;
  fineTuneOffsets?: readonly number[];
}, scaleIntervalsFallback: (scaleId: ScaleId) => number[]): number[] {
  if (state.tuningId && state.relationId) {
    return applyFineTuneOffsets(
      resolveTuning(state.tuningId, state.relationId),
      state.fineTuneOffsets,
    );
  }
  return scaleIntervalsFallback(state.scale);
}

// ── Played-pitch layer (Option A) ────────────────────────────────────
// The QWERTY keyboard, in PLAY mode, adds sustained scale-degree voices
// ON TOP of the drone instead of moving the tonic. Each key is a degree
// of the ACTIVE tuning measured above the current root, so played notes
// are microtuning-native by construction — playing in Just 5-limit
// sounds just thirds, not 12-TET ones. The held degrees get merged into
// the same intervalsCents list the engine already consumes, so voice
// building, crossfades, COUPLE and partner all apply unchanged.

/** QWERTY key code → degree index (0..12) into the tuning table.
 *  Mirrors the tonic-controller layout (A=P1 … J=M7) and extends it
 *  with K=P8 so a full octave is reachable. */
export const PLAY_KEY_TO_DEGREE: Readonly<Record<string, number>> = {
  KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6,
  KeyG: 7, KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11, KeyK: 12,
};

/** Most simultaneous played notes. Each played interval spawns one
 *  worklet voice per active layer, so this bounds the extra DSP load
 *  and leaves headroom for the adaptive-stability engine. */
export const MAX_PLAYED_NOTES = 6;

/** Cents above the tonic for a played degree in the active tuning.
 *  Returns null for out-of-range / non-integer degrees so callers can
 *  ignore unmapped keys. A null tuningId falls back to equal (12-TET),
 *  matching the legacy scale path. */
export function playedDegreeToCents(
  degree: number,
  tuningId: TuningId | null,
): number | null {
  if (!Number.isInteger(degree) || degree < 0) return null;
  const cents = tuningById(tuningId ?? "equal").degrees[degree];
  return typeof cents === "number" ? cents : null;
}

/** Merge played-note cents into a base intervalsCents list. The base
 *  order is preserved (the engine treats index 0 as the root); played
 *  cents not already present (within 1¢) are appended in ascending
 *  order, capped at MAX_PLAYED_NOTES additions. */
export function mergePlayedIntervals(
  base: readonly number[],
  playedCents: readonly number[],
): number[] {
  const out = base.slice();
  const seen = new Set(out.map((c) => Math.round(c)));
  const additions: number[] = [];
  for (const c of [...playedCents].sort((a, b) => a - b)) {
    const key = Math.round(c);
    if (seen.has(key)) continue;
    seen.add(key);
    additions.push(c);
    if (additions.length >= MAX_PLAYED_NOTES) break;
  }
  return out.concat(additions);
}

/** A held played note: a degree (0..12) in the tuning table plus an
 *  octave register (relative to the tonic) chosen when it was added. A
 *  degree holds at most one octave at a time — see togglePlayedNote. */
export interface PlayedNote {
  degree: number;
  octave: number;
}

/** Absolute cents above the tonic for a played note: the degree's cents
 *  in the active tuning plus `octave × 1200`. So the octave register
 *  rides on top of whatever microtuning is active. Returns null when the
 *  degree is out of range. */
export function playedNoteCents(note: PlayedNote, tuningId: TuningId | null): number | null {
  const base = playedDegreeToCents(note.degree, tuningId);
  return base === null ? null : base + note.octave * 1200;
}

/** Toggle a played note in/out of the held set (for click/tap input,
 *  where momentary hold can't build a chord). Identity for REMOVAL is
 *  the degree alone — tapping a key that's held in any octave clears it,
 *  so a note can always be released by tapping its key (no dependence on
 *  the current register). Adding places the note at `note.octave` (the
 *  current register) and is refused at the `max` cap. Returns the SAME
 *  array reference when nothing changes so React skips a re-render. */
export function togglePlayedNote(
  prev: readonly PlayedNote[],
  note: PlayedNote,
  max: number = MAX_PLAYED_NOTES,
): PlayedNote[] {
  if (prev.some((n) => n.degree === note.degree)) {
    return prev.filter((n) => n.degree !== note.degree);
  }
  if (prev.length >= max) return prev as PlayedNote[];
  return [...prev, note].sort((a, b) => (a.octave - b.octave) || (a.degree - b.degree));
}
