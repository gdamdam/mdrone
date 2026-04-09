/**
 * Deterministic PRNG + hash utilities for scene share cards.
 *
 * Rule: identical PortableScene payload → identical SVG bytes → identical
 * rasterised PNG. The same card must render pixel-equivalently on the
 * client preview and in the Cloudflare Worker unfurl so "what you see is
 * what gets shared" holds.
 *
 * All randomness in the style builders MUST flow through an RNG seeded
 * here — never use Math.random() in render code.
 */

/** 32-bit FNV-1a hash of a string. Cheap, deterministic, no deps. */
export function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 — fast, good distribution, 32-bit state. */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Convenience: integer in [0, n). */
export function rngInt(rng: () => number, n: number): number {
  return Math.floor(rng() * n) % n;
}

/** Convenience: float in [lo, hi). */
export function rngRange(rng: () => number, lo: number, hi: number): number {
  return lo + rng() * (hi - lo);
}

/** Convenience: pick one of `items`. */
export function rngPick<T>(rng: () => number, items: readonly T[]): T {
  return items[rngInt(rng, items.length)];
}
