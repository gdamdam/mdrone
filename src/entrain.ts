/**
 * ENTRAIN — modulation-rate state that can optionally drive the
 * voice engine at rates intended to overlap with known EEG bands
 * (delta..gamma). Not a therapeutic claim; the rate is a pure
 * number and the user decides what to do with it. UI uses pure Hz
 * + zone color (no band labels).
 *
 * This module is intentionally DSP-free: it holds state, constants,
 * and pure math. Phase-lock helper lets the engine derive an
 * entrain phase from the breathing LFO phase so the two modulators
 * do not drift against each other.
 */

export type EntrainMode = "am" | "dichotic" | "both";

export interface EntrainState {
  /** Master on/off for the ENTRAIN panel. When false the downstream
   *  engine treats the whole module as disabled regardless of rate/
   *  mode. Lets users keep a configured rate around without hearing
   *  it until they deliberately switch it on. */
  enabled: boolean;
  /** Target modulation rate in Hz. */
  rateHz: number;
  /** Which modulation path(s) are active when enabled is true. */
  mode: EntrainMode;
  /** L/R detune spread for DICHOTIC mode, in cents. Total spread is
   *  2× this value (±half on each ear). */
  dichoticCents: number;
  /** AM depth multiplier on the engine's built-in base depth. 1.0 =
   *  preset baseline (matches legacy behaviour), <1 attenuates,
   *  >1 pushes past the engine's slow-rate-safe baseline. The engine
   *  still applies its own slow-rate scaling on top, so this knob
   *  scales the curve rather than replacing it. Optional for
   *  backward-compat with older preset / share-URL payloads — engine
   *  treats absent as 1.0. */
  amDepth?: number;
}

export const ENTRAIN_MIN_HZ = 0.5;
export const ENTRAIN_MAX_HZ = 45;

/** Dichotic spread safety cap. Very large values defeat fusion and
 *  sound like two separate pitches. */
export const ENTRAIN_DICHOTIC_MIN_CENTS = 0;
export const ENTRAIN_DICHOTIC_MAX_CENTS = 40;

/** AM depth multiplier range. 1.0 is the legacy baseline; the upper
 *  cap leaves headroom without inviting distortion when stacked with
 *  other gain. */
export const ENTRAIN_AM_DEPTH_MIN = 0;
export const ENTRAIN_AM_DEPTH_MAX = 1.5;
export const DEFAULT_ENTRAIN_AM_DEPTH = 1;

export const DEFAULT_ENTRAIN: EntrainState = {
  enabled: false,
  rateHz: 8,
  mode: "am",
  dichoticCents: 8,
  amDepth: DEFAULT_ENTRAIN_AM_DEPTH,
};

export function clampEntrainRate(hz: number): number {
  if (!Number.isFinite(hz)) return DEFAULT_ENTRAIN.rateHz;
  return Math.max(ENTRAIN_MIN_HZ, Math.min(ENTRAIN_MAX_HZ, hz));
}

export function clampDichoticCents(cents: number): number {
  if (!Number.isFinite(cents)) return DEFAULT_ENTRAIN.dichoticCents;
  return Math.max(
    ENTRAIN_DICHOTIC_MIN_CENTS,
    Math.min(ENTRAIN_DICHOTIC_MAX_CENTS, cents),
  );
}

export function clampEntrainAmDepth(d: number): number {
  if (!Number.isFinite(d)) return DEFAULT_ENTRAIN_AM_DEPTH;
  return Math.max(ENTRAIN_AM_DEPTH_MIN, Math.min(ENTRAIN_AM_DEPTH_MAX, d));
}

/** Zone color for a given Hz. Discrete bands, matte palette to
 *  align with the project's heavy/photographic aesthetic. Returned
 *  as a CSS color string so callers can drop into style. */
export function zoneColorForHz(hz: number): string {
  if (hz < 4)  return "#3b4156"; // delta — slate
  if (hz < 8)  return "#4a3f5e"; // theta — violet slate
  if (hz < 12) return "#3e5a5a"; // alpha — teal slate
  if (hz < 15) return "#554a3e"; // SMR / beta edge
  if (hz < 30) return "#5a4a3e"; // beta  — amber
  return "#6a3e3e";              // gamma — red slate
}

/** CSS gradient stops mirroring zoneColorForHz across the full
 *  ENTRAIN_MIN_HZ..ENTRAIN_MAX_HZ slider range, for use as a slider
 *  track background. Stops are placed at each zone boundary. */
export function zoneGradientCss(): string {
  const stops: Array<[number, string]> = [
    [ENTRAIN_MIN_HZ, "#3b4156"],
    [4,              "#4a3f5e"],
    [8,              "#3e5a5a"],
    [12,             "#554a3e"],
    [15,             "#5a4a3e"],
    [30,             "#6a3e3e"],
    [ENTRAIN_MAX_HZ, "#6a3e3e"],
  ];
  const span = ENTRAIN_MAX_HZ - ENTRAIN_MIN_HZ;
  return (
    "linear-gradient(to right, " +
    stops
      .map(([hz, c]) => `${c} ${(((hz - ENTRAIN_MIN_HZ) / span) * 100).toFixed(2)}%`)
      .join(", ") +
    ")"
  );
}

export interface PhaseLockResult {
  /** Integer multiplier k such that entrain phase = breathing phase × k.
   *  0 when breathing is stopped (no lock possible). */
  k: number;
  /** The actual locked Hz that will play — may differ slightly from
   *  the requested Hz because k is rounded to an integer. */
  lockedHz: number;
}

/** Compute the integer phase multiplier that locks an entrain
 *  modulator to a slower breathing LFO. When breathingHz <= 0 the
 *  lock is undefined and we return k=0 (caller should free-run). */
export function phaseLockedRate(
  breathingHz: number,
  entrainHz: number,
): PhaseLockResult {
  const target = clampEntrainRate(entrainHz);
  if (!Number.isFinite(breathingHz) || breathingHz <= 0) {
    return { k: 0, lockedHz: target };
  }
  const raw = target / breathingHz;
  const k = Math.max(1, Math.round(raw));
  return { k, lockedHz: k * breathingHz };
}

/** Landmark rates to draw as ticks under the slider. Each marker
 *  carries a short label (band letter or reference name) and a
 *  `cultural` flag for rates that are culturally meaningful but
 *  scientifically spurious (e.g. 7.83 Hz Schumann) — renderers
 *  style those differently so users know the distinction. */
export interface EntrainLandmark {
  hz: number;
  label: string;
  title: string;
  cultural?: boolean;
}

export const ENTRAIN_LANDMARKS: readonly EntrainLandmark[] = [
  { hz: 2,    label: "δ 2",  title: "2 Hz — delta-band slow swell" },
  { hz: 6,    label: "θ 6",  title: "6 Hz — theta-band tremolo (meditative / hypnagogic range)" },
  { hz: 7.83, label: "7.83", title: "7.83 Hz — Schumann resonance (cultural reference, not scientifically established as a brainwave effect)", cultural: true },
  { hz: 10,   label: "α 10", title: "10 Hz — alpha-band pulse (relaxed wakefulness)" },
  { hz: 20,   label: "β 20", title: "20 Hz — low-beta flutter (alert / focused)" },
  { hz: 40,   label: "γ 40", title: "40 Hz — gamma-band buzz (perceptual binding; active research)" },
];

/** Human-readable description of what the current ENTRAIN state
 *  will sound like. Used as a live subtitle in the panel — updates
 *  as the user moves the slider / toggles modes. Pure function so
 *  it can be tested without mounting the component. */
export function describeEntrain(
  state: EntrainState | undefined | null,
  breathingHz: number,
): string {
  const s = state ?? DEFAULT_ENTRAIN;
  const r = clampEntrainRate(s.rateHz);
  const rateText = (() => {
    const hz = r.toFixed(2);
    if (r < 4)  return `slow swell at ${hz} Hz`;
    if (r < 8)  return `theta-band tremolo at ${hz} Hz`;
    if (r < 12) return `alpha-band pulse at ${hz} Hz`;
    if (r < 20) return `low-beta flutter at ${hz} Hz`;
    if (r < 30) return `beta-band flutter at ${hz} Hz`;
    return `gamma-band buzz at ${hz} Hz, heard as roughness`;
  })();
  const dichoticText = `L/R detune ±${(s.dichoticCents / 2).toFixed(1)} ¢ — headphones`;
  const lock = phaseLockedRate(breathingHz, r);
  const lockNote = lock.k > 0
    ? ` · locked ×${lock.k} to ${breathingHz.toFixed(2)} Hz breathing`
    : "";
  const core =
    s.mode === "dichotic" ? `${dichoticText}${lockNote}` :
    s.mode === "both"     ? `${rateText} · ${dichoticText}${lockNote}` :
                            `${rateText}${lockNote}`;
  // When ENTRAIN is disabled the description is still useful — it
  // tells the user what they'd hear if they flipped the power. Mark
  // it as off so they don't think the panel is already playing.
  return s.enabled ? core : `(off) ${core}`;
}

/** Normalize an unknown value into an EntrainState. Used when
 *  thawing share-URL / session payloads that may be missing fields
 *  or be from older clients. */
export function normalizeEntrain(value: unknown): EntrainState {
  if (!value || typeof value !== "object") return { ...DEFAULT_ENTRAIN };
  const v = value as Record<string, unknown>;
  const enabled =
    typeof v.enabled === "boolean" ? v.enabled : DEFAULT_ENTRAIN.enabled;
  const rate =
    typeof v.rateHz === "number" ? clampEntrainRate(v.rateHz) : DEFAULT_ENTRAIN.rateHz;
  const mode: EntrainMode =
    v.mode === "am" || v.mode === "dichotic" || v.mode === "both"
      ? v.mode
      : DEFAULT_ENTRAIN.mode;
  const cents =
    typeof v.dichoticCents === "number"
      ? clampDichoticCents(v.dichoticCents)
      : DEFAULT_ENTRAIN.dichoticCents;
  const amDepth =
    typeof v.amDepth === "number"
      ? clampEntrainAmDepth(v.amDepth)
      : DEFAULT_ENTRAIN.amDepth;
  return { enabled, rateHz: rate, mode, dichoticCents: cents, amDepth };
}
