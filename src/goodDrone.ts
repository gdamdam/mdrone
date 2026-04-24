/**
 * Good Drone — sample a constrained tuning state that produces
 * beautiful, usable drones instantly.
 *
 * Returns {tuningId, relationId, fineTuneOffsets} from a curated pool
 * of tuning+relation pairs known to sound consonant and stable on the
 * mdrone engine. Every result includes a subtle per-interval detune
 * (±2–5¢, one decimal) so the drone breathes — never enough to break
 * consonance, always enough to feel alive.
 *
 * The pool deliberately excludes structural/experimental tunings
 * (skewed, cluster, hollow, spectral-primes, 17-TET, 19-TET, 22-EDO):
 * those are authored character presets, not "good drone" material.
 */

import type { RelationId, TuningId } from "./microtuning";
import { relationById } from "./microtuning";

export interface GoodDroneResult {
  tuningId: TuningId;
  relationId: RelationId;
  fineTuneOffsets: number[];
}

interface PoolEntry {
  tuningId: TuningId;
  relations: readonly RelationId[];
}

const POOL: readonly PoolEntry[] = [
  // Built-in just / harmonic tunings — the app's core consonant pool.
  { tuningId: "just5", relations: ["tonic-fifth", "drone-triad", "harmonic-stack"] },
  { tuningId: "harmonics", relations: ["harmonic-stack", "tonic-fifth"] },
  { tuningId: "meantone", relations: ["drone-triad"] },
  { tuningId: "maqam-rast", relations: ["drone-triad", "tonic-fourth"] },
  { tuningId: "slendro", relations: ["drone-triad", "tonic-fifth"] },
  // Authored canon — historical and world scales that drone cleanly.
  { tuningId: "custom:pythagorean" as TuningId, relations: ["tonic-fifth", "harmonic-stack"] },
  { tuningId: "custom:kirnberger-iii" as TuningId, relations: ["drone-triad"] },
  { tuningId: "custom:werckmeister-iii" as TuningId, relations: ["drone-triad"] },
  { tuningId: "custom:31-tet" as TuningId, relations: ["drone-triad", "harmonic-stack"] },
  { tuningId: "custom:yaman" as TuningId, relations: ["drone-triad", "tonic-fifth"] },
  { tuningId: "custom:bayati" as TuningId, relations: ["tonic-fifth"] },
  { tuningId: "custom:young-wtp" as TuningId, relations: ["harmonic-stack"] },
  { tuningId: "custom:just7" as TuningId, relations: ["harmonic-stack", "drone-triad"] },
  { tuningId: "custom:otonal-16-32" as TuningId, relations: ["harmonic-stack", "tonic-fifth"] },
  // House signature — hybrid just × 31-TET tuned to the relation system.
  { tuningId: "custom:mdrone-signature" as TuningId, relations: ["harmonic-stack", "drone-triad", "tonic-fifth"] },
];

function pick<T>(arr: readonly T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)];
}

/** Subtle non-zero detune in cents: magnitude 2..5, random sign,
 *  rounded to 1 decimal. Never zero, never over ±5¢. */
function subtleOffset(rng: () => number): number {
  const magnitude = 2 + rng() * 3;
  const sign = rng() < 0.5 ? -1 : 1;
  return Math.round(magnitude * sign * 10) / 10;
}

/** Subtle per-interval detune array for a relation — root stays at 0,
 *  every other pick gets ±2–5¢. Shared between sampleGoodDrone and
 *  createArrivalScene so arrival presets "breathe" like a GOOD DRONE
 *  state does. */
export function sampleSubtleOffsets(
  relationId: RelationId,
  rng: () => number = Math.random,
): number[] {
  const relation = relationById(relationId);
  const out = new Array<number>(relation.picks.length).fill(0);
  for (let i = 1; i < out.length; i++) out[i] = subtleOffset(rng);
  return out;
}

/** Sample a good-drone tuning state. Accepts an injectable RNG for
 *  tests; defaults to Math.random. */
export function sampleGoodDrone(rng: () => number = Math.random): GoodDroneResult {
  const entry = pick(POOL, rng);
  const relationId = pick(entry.relations, rng);
  return { tuningId: entry.tuningId, relationId, fineTuneOffsets: sampleSubtleOffsets(relationId, rng) };
}

/** Exposed for tests: the valid tuning ids in the pool. */
export const GOOD_DRONE_TUNING_IDS: readonly TuningId[] = POOL.map((e) => e.tuningId);
