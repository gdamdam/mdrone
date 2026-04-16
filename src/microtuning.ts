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
    // Javanese gamelan 5-tone (~240 cent steps) mapped to nearest degree slots
    // Tones: 0, 240, 480, 720, 960 — assigned to m2, M3, TT/P5, M6 positions
    degrees: [0, 240, 240, 480, 480, 480, 720, 720, 720, 960, 960, 960, 1200],
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
  return [...BUILTIN_TUNINGS, ...customTunings];
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
    const combined = [...BUILTIN_TUNINGS, ...customTunings];
    const value = Reflect.get(combined, prop, receiver);
    if (typeof value === "function") return value.bind(combined);
    return value;
  },
  has(_target, prop) {
    const combined = [...BUILTIN_TUNINGS, ...customTunings];
    return Reflect.has(combined, prop);
  },
});

// ── Lookups ──────────────────────────────────────────────────────────

let tuningMap = new Map<string, TuningTable>(
  [...BUILTIN_TUNINGS, ...customTunings].map((t) => [t.id, t]),
);
const relationMap = new Map(RELATIONS.map((r) => [r.id, r]));

function rebuildTuningMap(): void {
  tuningMap = new Map<string, TuningTable>(
    [...BUILTIN_TUNINGS, ...customTunings].map((t) => [t.id, t]),
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
