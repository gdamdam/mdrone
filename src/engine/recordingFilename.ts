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

/** Compose `mdrone-<slug>-<ts>.wav` with `mdrone-<ts>.wav` fallback
 *  when the slug is empty. */
export function buildWavFilename(
  rawName: string | null | undefined,
  d: Date = new Date(),
): string {
  const slug = sanitizeRecordingName(rawName);
  const ts = formatRecordingTimestamp(d);
  return slug ? `mdrone-${slug}-${ts}.wav` : `mdrone-${ts}.wav`;
}

/** "M:SS" — used in the REC button readout and the save toast. */
export function formatDurationMs(ms: number): string {
  const safe = Math.max(0, ms | 0);
  const totalSec = Math.floor(safe / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
