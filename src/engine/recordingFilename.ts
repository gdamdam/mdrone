/**
 * Recording filename + duration helpers — shared between master-WAV
 * and loop-bounce export paths so download names look consistent and
 * carry useful scene context.
 *
 * Pure functions, no DOM/AudioContext deps; covered by unit tests.
 */

/** Filesystem-safe slug: lowercase, ASCII, hyphen-separated. Empty
 *  input collapses to empty string so callers can decide whether to
 *  fall back. */
export function sanitizeRecordingName(input: string | null | undefined): string {
  if (!input) return "";
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

/** "YYYY-MM-DD-HHMM" — short, sortable, locale-independent. Uses
 *  the supplied Date so tests can pin a moment. */
export function formatRecordingTimestamp(d: Date = new Date()): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}-${hh}${mi}`;
}

/** Convert a tonic label like "F#2" or "A3" to a filesystem-safe
 *  token: sharp becomes "s", flats become "b", everything lowercase
 *  ASCII. "F#2" → "fs2", "Bb3" → "bb3", "A2" → "a2". Returns "" for
 *  null/undefined/non-musical input. */
export function sanitizeTonicLabel(input: string | null | undefined): string {
  if (!input) return "";
  return input
    .replace(/♯/g, "#")
    .replace(/♭/g, "b")
    .replace(/#/g, "s")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 8);
}

/** Compose a filename like `mdrone-<slug>[-<tonic>][-<preset>]-<ts>.wav`.
 *  All metadata fields are optional; when omitted the segment is
 *  skipped so legacy callers (and tests) keep getting the simple
 *  `mdrone-<slug>-<ts>.wav` shape. The preset slug is suppressed when
 *  it would just duplicate `rawName` (the common case where no
 *  session is named and the scene name *is* the preset name). */
export function buildWavFilename(
  rawName: string | null | undefined,
  d: Date = new Date(),
  tonicLabel?: string | null,
  presetName?: string | null,
): string {
  const slug = sanitizeRecordingName(rawName);
  const tonic = sanitizeTonicLabel(tonicLabel);
  const presetSlug = sanitizeRecordingName(presetName);
  const presetSegment = presetSlug && presetSlug !== slug ? presetSlug : "";
  const ts = formatRecordingTimestamp(d);
  const parts = ["mdrone", slug, tonic, presetSegment, ts].filter(Boolean);
  return `${parts.join("-")}.wav`;
}

/** Same as buildWavFilename but inserts a `-loop-<N>s-` segment so
 *  BOUNCE LOOP files self-describe their loop length in a sampler /
 *  DAW import dialog (`...-loop-30s-2026-04-29-1422.wav`). */
export function buildLoopWavFilename(
  rawName: string | null | undefined,
  lengthSec: number,
  d: Date = new Date(),
  tonicLabel?: string | null,
  presetName?: string | null,
): string {
  const slug = sanitizeRecordingName(rawName);
  const tonic = sanitizeTonicLabel(tonicLabel);
  const presetSlug = sanitizeRecordingName(presetName);
  const presetSegment = presetSlug && presetSlug !== slug ? presetSlug : "";
  const lengthSafe = Math.max(1, Math.floor(lengthSec));
  const ts = formatRecordingTimestamp(d);
  const parts = ["mdrone", slug, tonic, presetSegment, "loop", `${lengthSafe}s`, ts].filter(Boolean);
  return `${parts.join("-")}.wav`;
}

/** Same as buildWavFilename but inserts a `-take-<label>-` segment so
 *  TIMED REC files self-describe their fixed duration in a DAW import
 *  dialog (`...-take-1m-2026-04-29-1422.wav`). */
export function buildTakeWavFilename(
  rawName: string | null | undefined,
  durationLabel: string,
  d: Date = new Date(),
  tonicLabel?: string | null,
  presetName?: string | null,
): string {
  const slug = sanitizeRecordingName(rawName);
  const label = sanitizeRecordingName(durationLabel) || "take";
  const tonic = sanitizeTonicLabel(tonicLabel);
  const presetSlug = sanitizeRecordingName(presetName);
  const presetSegment = presetSlug && presetSlug !== slug ? presetSlug : "";
  const ts = formatRecordingTimestamp(d);
  const parts = ["mdrone", slug, tonic, presetSegment, "take", label, ts].filter(Boolean);
  return `${parts.join("-")}.wav`;
}

/** "M:SS" — used in the REC button readout and the save toast. */
export function formatDurationMs(ms: number): string {
  const safe = Math.max(0, ms | 0);
  const totalSec = Math.floor(safe / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
