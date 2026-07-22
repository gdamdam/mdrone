/**
 * Scala interchange — `.scl` scale files and `.kbm` keyboard maps.
 *
 * Follows the Scala file-format spec exactly:
 *   .scl — `!` lines are comments; the first non-comment line is the
 *          description, the second is the note count, and each following
 *          pitch line is either cents (contains a `.`) or a ratio `n/m`
 *          (converted via 1200·log2(n/m)). The listed pitches run from
 *          the first step up to the period (the last entry); the implicit
 *          1/1 (0¢) is never listed.
 *   .kbm — a fixed sequence of integer/float parameter lines followed by
 *          the per-key degree mapping (`x`/`.` = unmapped).
 *
 * Everything crossing this file boundary is untrusted, so inputs are
 * validated and malformed files throw rather than resolve to garbage.
 *
 * Pure and framework-free — safe to vendor.
 */

import {
  DEFAULT_PERIOD_CENTS,
  periodCents,
  type PortableTuning,
} from "./model";

// ── .scl ─────────────────────────────────────────────────────────────

export interface SclData {
  name: string;
  /** Scale degrees in cents, rooted at 0 (`cents[0] === 0`), ascending
   *  within one period. Length equals the file's note count. */
  cents: number[];
  /** Cents per repeat (the file's final pitch — the interval of
   *  repetition / formal octave). */
  period: number;
}

/** Parse one `.scl` pitch token to cents. `n`, `n/m` → ratio; anything
 *  containing `.` → literal cents. */
function pitchLineToCents(token: string): number {
  if (token.includes(".")) {
    // Cents literal: the ENTIRE token must be a decimal number. parseFloat is
    // lenient ("12x.y" → 12), which would silently accept malformed files that
    // the header contract says must throw.
    if (!/^[+-]?(\d+\.\d*|\.\d+)$/.test(token)) {
      throw new Error(`parseScl: invalid cents value "${token}"`);
    }
    const cents = Number.parseFloat(token);
    if (!Number.isFinite(cents)) {
      throw new Error(`parseScl: invalid cents value "${token}"`);
    }
    return cents;
  }
  // Ratio: each side must be a bare positive integer. parseInt is lenient
  // ("3/2junk" → 2), so validate the raw strings before converting.
  const [nRaw, dRaw] = token.split("/");
  if (!/^\d+$/.test(nRaw) || (dRaw !== undefined && !/^\d+$/.test(dRaw))) {
    throw new Error(`parseScl: invalid ratio "${token}"`);
  }
  const n = Number.parseInt(nRaw, 10);
  const d = dRaw === undefined ? 1 : Number.parseInt(dRaw, 10);
  if (!Number.isFinite(n) || !Number.isFinite(d) || n <= 0 || d <= 0) {
    throw new Error(`parseScl: invalid ratio "${token}"`);
  }
  return 1200 * Math.log2(n / d);
}

/** Non-comment content lines (comments begin with `!`). Blank lines are
 *  preserved because a `.scl` description line may legitimately be blank. */
function sclContentLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith("!"));
}

export function parseScl(text: string): SclData {
  const lines = sclContentLines(text);
  if (lines.length < 2) {
    throw new Error("parseScl: file too short (need description + count)");
  }
  const name = lines[0].trim();
  const count = Number.parseInt(lines[1].trim(), 10);
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`parseScl: invalid note count "${lines[1].trim()}"`);
  }
  const pitchLines = lines.slice(2).map((l) => l.trim()).filter((l) => l.length > 0);
  if (pitchLines.length < count) {
    throw new Error(`parseScl: expected ${count} pitches, found ${pitchLines.length}`);
  }
  const listed = pitchLines
    .slice(0, count)
    .map((l) => pitchLineToCents(l.split(/\s+/)[0]));
  const period = listed[count - 1];
  // Root at 0, drop the final period entry from the sounding degrees.
  const cents = [0, ...listed.slice(0, count - 1)];
  return { name, cents, period };
}

function formatCentsValue(c: number): string {
  return c.toFixed(6);
}

export function formatScl(scl: SclData): string {
  const listed = [...scl.cents.slice(1), scl.period];
  const out = [
    `! ${(scl.name || "tuning").replace(/\s+/g, "-")}.scl`,
    "!",
    scl.name,
    ` ${listed.length}`,
    "!",
    ...listed.map((c) => ` ${formatCentsValue(c)}`),
  ];
  return out.join("\n") + "\n";
}

/** A PortableTuning as an `.scl` descriptor (lossless). */
export function portableToScl(tuning: PortableTuning): SclData {
  return {
    name: tuning.name,
    cents: [...tuning.scaleCents],
    period: periodCents(tuning),
  };
}

/** An `.scl` descriptor as a PortableTuning at `tonicHz`. */
export function sclToPortable(scl: SclData, tonicHz: number): PortableTuning {
  return {
    tonicHz,
    scaleCents: [...scl.cents],
    period: scl.period ?? DEFAULT_PERIOD_CENTS,
    name: scl.name,
  };
}

// ── .kbm ─────────────────────────────────────────────────────────────

export interface KbmData {
  mapSize: number;
  first: number;
  last: number;
  middle: number;
  refNote: number;
  refFreq: number;
  /** Per-key scale-degree indices; `-1` marks an unmapped key. */
  degrees: number[];
}

/** Sentinel for an unmapped keyboard key. */
export const KBM_UNMAPPED = -1;

function kbmContentLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("!"));
}

export function parseKbm(text: string): KbmData {
  const lines = kbmContentLines(text);
  // 7 header params (size, first, last, middle, ref note, ref freq,
  // formal octave) then `mapSize` mapping entries.
  if (lines.length < 7) {
    throw new Error("parseKbm: file too short (need 7 header lines)");
  }
  const mapSize = Number.parseInt(lines[0], 10);
  const first = Number.parseInt(lines[1], 10);
  const last = Number.parseInt(lines[2], 10);
  const middle = Number.parseInt(lines[3], 10);
  const refNote = Number.parseInt(lines[4], 10);
  const refFreq = Number.parseFloat(lines[5]);
  // lines[6] is the formal octave (scale degrees per period); reconstructed
  // as mapSize on format, so it is not surfaced in KbmData.
  if (
    !Number.isInteger(mapSize) || mapSize < 0 ||
    !Number.isInteger(first) || !Number.isInteger(last) ||
    !Number.isInteger(middle) || !Number.isInteger(refNote) ||
    !Number.isFinite(refFreq) || refFreq <= 0
  ) {
    throw new Error("parseKbm: malformed header");
  }
  const entryLines = lines.slice(7, 7 + mapSize);
  if (entryLines.length < mapSize) {
    throw new Error(`parseKbm: expected ${mapSize} map entries, found ${entryLines.length}`);
  }
  const degrees = entryLines.map((l) => {
    if (l === "x" || l === "X" || l === ".") return KBM_UNMAPPED;
    const d = Number.parseInt(l, 10);
    return Number.isInteger(d) ? d : KBM_UNMAPPED;
  });
  return { mapSize, first, last, middle, refNote, refFreq, degrees };
}

export function formatKbm(kbm: KbmData): string {
  const out = [
    "! Generated by mdrone",
    String(kbm.mapSize),
    String(kbm.first),
    String(kbm.last),
    String(kbm.middle),
    String(kbm.refNote),
    String(kbm.refFreq),
    // Formal octave: for a standard linear map this equals the map size.
    String(kbm.mapSize),
    ...kbm.degrees.map((d) => (d < 0 ? "x" : String(d))),
  ];
  return out.join("\n") + "\n";
}
