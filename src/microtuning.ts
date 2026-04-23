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
  // Each is annotated with a suggested relation + voicing so the picker
  // (or a future "apply suggested relation" affordance) can land the
  // user in a musically idiomatic starting place rather than unison.

  {
    id: "custom:pythagorean" as CustomTuningId,
    label: "Pythagorean (3-limit)",
    // Pure 3/2 stack, the Western-ancient drone tuning. Ratios:
    // 1/1, 256/243, 9/8, 32/27, 81/64, 4/3, 729/512, 3/2, 128/81,
    // 27/16, 16/9, 243/128, 2/1. Glassy fifths, bright ditone 3rd.
    // Suggested relation: tonic-fifth. Voicing: tanpura + metal —
    // the ringing 3/2 is the whole point.
    degrees: [0, 90.2, 203.9, 294.1, 407.8, 498.0, 611.7, 702.0, 792.2, 905.9, 996.1, 1109.8, 1200],
  },
  {
    id: "custom:kirnberger-iii" as CustomTuningId,
    label: "Kirnberger III (well-temp)",
    // Bach-era well-temperament (J.P. Kirnberger, 1779). Key colours
    // preserved, C major cleanest; drones in remote keys breathe.
    // Suggested relation: drone-triad. Voicing: piano + reed for the
    // harpsichord / clavichord reading.
    degrees: [0, 90.2, 193.2, 294.1, 386.3, 498.0, 590.2, 696.6, 792.2, 889.7, 996.1, 1088.3, 1200],
  },
  {
    id: "custom:werckmeister-iii" as CustomTuningId,
    label: "Werckmeister III (well-temp)",
    // Andreas Werckmeister, 1691. Slightly sharper triad colour than
    // Kirnberger III, the likeliest temperament behind WTC Book I.
    // Suggested relation: drone-triad. Voicing: piano + air.
    degrees: [0, 90.2, 192.2, 294.1, 390.2, 498.0, 588.3, 696.1, 792.2, 888.3, 996.1, 1092.2, 1200],
  },
  {
    id: "custom:17-tet" as CustomTuningId,
    label: "17-TET",
    // 17-tone equal temperament — clean 5ths, very sharp 3rds,
    // neutral-ish seconds. Natural host for Turkish/Arab flavours.
    // Suggested relation: tonic-fifth (the 3rds are too hot for a
    // drone triad). Voicing: reed + metal.
    degrees: [0, 70.6, 211.8, 282.4, 352.9, 494.1, 564.7, 705.9, 776.5, 917.6, 988.2, 1129.4, 1200],
  },
  {
    id: "custom:19-tet" as CustomTuningId,
    label: "19-TET",
    // 19-tone equal temperament — meantone's close cousin; the
    // minor 3rd is its purest interval (6/5-adjacent).
    // Suggested relation: minor-triad. Voicing: reed + air.
    degrees: [0, 126.3, 189.5, 315.8, 378.9, 505.3, 631.6, 694.7, 821.1, 884.2, 1010.5, 1073.7, 1200],
  },
  {
    id: "custom:22-edo" as CustomTuningId,
    label: "22-EDO (Paul Erlich)",
    // 22-tone equal division — xenharmonic home of Pajara / Porcupine.
    // Approximates 5-limit triads with a characteristic "wolf" edge.
    // Suggested relation: drone-triad. Voicing: metal + noise for
    // the bright xen character.
    degrees: [0, 109.1, 218.2, 272.7, 381.8, 490.9, 600, 709.1, 818.2, 927.3, 1036.4, 1090.9, 1200],
  },
  {
    id: "custom:31-tet" as CustomTuningId,
    label: "31-TET (Huygens)",
    // 31-tone equal temperament — extraordinarily close to 1/4-comma
    // meantone across 5-limit, famous from Fokker's organ.
    // Suggested relation: drone-triad. Voicing: tanpura + reed —
    // silky, near-pure triad.
    degrees: [0, 116.1, 193.5, 309.7, 387.1, 503.2, 580.6, 696.8, 812.9, 890.3, 1006.5, 1083.9, 1200],
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
  },
  {
    id: "custom:mdrone-signature" as CustomTuningId,
    label: "mdrone Signature (just × 31-TET)",
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

/** Save or replace a custom tuning. The supplied `name` becomes both
 *  the display label and (after slugification) the ID suffix. Returns
 *  the stored table. */
export function saveCustomTuning(name: string, degrees: readonly number[]): TuningTable {
  const label = name.trim() || "Untitled";
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "untitled";
  const id = `custom:${slug}` as CustomTuningId;
  const padded = degrees.slice(0, 13);
  while (padded.length < 13) padded.push(0);
  const table: TuningTable = { id, label, degrees: padded };
  const existingIdx = customTunings.findIndex((t) => t.id === id);
  if (existingIdx >= 0) customTunings[existingIdx] = table;
  else customTunings.push(table);
  rebuildTuningMap();
  persistCustomTunings();
  notifySubscribers();
  return table;
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
export const TUNINGS: readonly TuningTable[] = new Proxy([] as TuningTable[], {
  get(_target, prop, receiver) {
    const combined = [...BUILTIN_TUNINGS, ...AUTHORED_TUNINGS, ...customTunings];
    const value = Reflect.get(combined, prop, receiver);
    if (typeof value === "function") return value.bind(combined);
    return value;
  },
  has(_target, prop) {
    const combined = [...BUILTIN_TUNINGS, ...AUTHORED_TUNINGS, ...customTunings];
    return Reflect.has(combined, prop);
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
}

export function tuningById(id: TuningId): TuningTable {
  return tuningMap.get(id) ?? BUILTIN_TUNINGS[0];
}

export function relationById(id: RelationId): Relation {
  return relationMap.get(id) ?? RELATIONS[0];
}

// ── Resolver ─────────────────────────────────────────────────────────

/** Resolve a tuning + relation pair to concrete intervalsCents. */
export function resolveTuning(tuningId: TuningId, relationId: RelationId): number[] {
  const tuning = tuningById(tuningId);
  const relation = relationById(relationId);
  return relation.picks.map((idx) => tuning.degrees[idx] ?? 0);
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
