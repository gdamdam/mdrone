/**
 * droneNames — deterministic drone-scene name generator.
 *
 * Produces an evocative 2–3 word name for a given scene, matched to
 * the preset's genre group. The same scene inputs always yield the
 * same name, so re-opening a shared link or an undone scene reads
 * consistently.
 *
 * Wordbanks are handcrafted per PresetGroup (Sacred / Minimal /
 * Organ / Ambient / Noise). A small template rotation adds variety
 * without looking mechanical. The seed is a stable FNV-1a hash of
 * the scene state's most salient structural fields (preset, tonic,
 * scale, tuning, effects) — enough that RND-style shakes produce
 * different names, but not so many that micro macro tweaks rename
 * the scene.
 *
 * Runs entirely offline — no network, no LLM.
 */

import type { PresetGroup } from "../engine/presets";
import type { DroneSessionSnapshot } from "../session";

interface Wordbank {
  adjectives: readonly string[];
  nouns: readonly string[];
}

const WORDBANKS: Record<PresetGroup, Wordbank> = {
  "Sacred / Ritual": {
    adjectives: ["Silent", "Inner", "Hidden", "Votive", "Shrouded", "Holy", "Still", "Dark"],
    nouns: ["Cathedral", "Vigil", "Eptaghon", "Antiphon", "Night"],
  },
  "Minimal / Just": {
    adjectives: ["Thin", "Slow", "Seven", "Lucent", "Pure", "Sparse", "Clean", "Quiet"],
    nouns: ["Horizon", "Span", "Ratio", "Lattice", "Filament", "Line", "Circle", "Plane"],
  },
  "Organ / Chamber": {
    adjectives: ["Brass", "Choral", "Oak", "Vaulted", "Pipe", "Low", "Vesper", "Gilded"],
    nouns: ["Antiphon", "Cloister", "Stone", "Gallery", "Bellows", "Nave", "Aisle", "Choir"],
  },
  "Ambient / Cinematic": {
    adjectives: ["Tidal", "Distant", "Weathered", "Glacial", "Open", "Pale", "Drifting", "Faint"],
    nouns: ["Shore", "Dust", "Meridian", "Aperture", "Horizon", "Drift", "Passage", "Field"],
  },
  "Noise / Industrial": {
    adjectives: ["Iron", "Corroded", "Broken", "Shortwave", "Rusted", "Grey", "Salvaged", "Stripped"],
    nouns: ["Signal", "Dust", "Relay", "Foundry", "Lattice", "Coil", "Transmitter", "Machine"],
  },
  "Pulse / Studies": {
    adjectives: ["Slow", "Steady", "Locked", "Rhythmic", "Quiet", "Tidal", "Measured", "Patient"],
    nouns: ["Pulse", "Flicker", "Cycle", "Band", "Phase", "Study", "Rhythm", "Interval"],
  },
};

/** Small template rotation. `n1` and `n2` are two independent noun
 *  picks — the "X of Y" template guards against the trivial "Y of Y"
 *  collision. */
const TEMPLATES: readonly ((a: string, n1: string, n2: string) => string)[] = [
  (a, n1) => `${a} ${n1}`,
  (_a, n1, n2) => (n1 === n2 ? n1 : `${n1} of ${n2}`),
];

/** Grammatical function words we never want to surface in a drone
 *  name. Tokens shorter than 4 characters are also dropped, which
 *  already filters most of these, but the explicit list covers
 *  4+ letter stopwords and makes the intent obvious. */
const STOPWORDS: ReadonlySet<string> = new Set([
  "and", "the", "with", "over", "under", "into", "through", "from",
  "this", "that", "these", "those", "your", "their", "very", "like",
  "more", "less", "much", "just", "also", "than", "then",
]);

/**
 * Pull evocative vocabulary out of a preset's attribution string
 * ("Jawari string drone · buzzing overtones" → ["Jawari", "String",
 * "Drone", "Buzzing", "Overtones"]). Each preset's attribution is
 * hand-written and dense with drone-relevant words, which is perfect
 * for giving the generator a preset-specific flavor on top of the
 * genre wordbank.
 */
function extractAttributionTokens(attr: string): string[] {
  return attr
    .split(/[^a-zA-Z]+/)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w.toLowerCase()))
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

/** Mulberry32 — tiny deterministic PRNG seeded from a uint32. */
function mulberry32(seed: number): () => number {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a 32-bit hash — stable, tiny, good enough for small wordbanks. */
function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Build a deterministic seed from the structural parts of a scene
 * snapshot. Covers preset / tonic / scale / tuning / relation /
 * effects — enough that RND shakes produce distinct names, but
 * stable under macro tweaks so "the scene I just named" keeps its
 * identity while you sculpt it.
 */
export function hashSceneSeed(
  snapshot: Pick<
    DroneSessionSnapshot,
    "activePresetId" | "root" | "octave" | "scale" | "tuningId" | "relationId" | "effects"
  >,
): number {
  const enabledFx = snapshot.effects
    ? Object.keys(snapshot.effects)
        .filter((k) => snapshot.effects[k as keyof typeof snapshot.effects])
        .sort()
        .join(",")
    : "";
  const parts = [
    snapshot.activePresetId ?? "",
    snapshot.root ?? "",
    String(snapshot.octave ?? ""),
    snapshot.scale ?? "",
    snapshot.tuningId ?? "",
    snapshot.relationId ?? "",
    enabledFx,
  ].join("|");
  return fnv1a(parts);
}

/**
 * Generate a drone-scene name matched to the preset's genre. Same
 * (group, seed, attribution) always yields the same name.
 *
 * When an `attribution` string is provided, its words are mixed into
 * both the adjective and noun pools so preset-specific flavor words
 * ("Jawari", "Liturgical", "Oxide", "Bellows") can surface in the
 * generated name. This keeps sacred scenes evoking sacred vocabulary
 * and noise scenes evoking noise vocabulary even when the wordbank
 * is shared across many presets in the same group.
 */
export function generateDroneName(
  group: PresetGroup,
  seed: number,
  attribution?: string,
): string {
  const bank = WORDBANKS[group];
  const extra = attribution ? extractAttributionTokens(attribution) : [];
  // Attribution tokens go into BOTH pools — we can't cheaply know
  // which are adjectives vs nouns, and most of them read fine in
  // either slot ("Buzzing Cathedral", "Dark Jawari", "Oxide Night").
  const adjectives: readonly string[] = [...bank.adjectives, ...extra];
  const nouns: readonly string[] = [...bank.nouns, ...extra];
  const rng = mulberry32(seed);
  const template = TEMPLATES[Math.floor(rng() * TEMPLATES.length)];
  const a = adjectives[Math.floor(rng() * adjectives.length)];
  const n1 = nouns[Math.floor(rng() * nouns.length)];
  const n2 = nouns[Math.floor(rng() * nouns.length)];
  return template(a, n1, n2);
}
