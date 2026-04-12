/**
 * midiMapping — CC-to-parameter mapping with hardcoded defaults
 * and user-overridable learn mode. Persisted to localStorage.
 *
 * Default map (works out of the box with most controllers):
 *   CC1  (mod wheel)    → WEATHER Y
 *   CC2  (breath)       → WEATHER X
 *   CC7  (volume)       → VOL
 *   CC64 (sustain)      → HOLD toggle
 *   CC71 (resonance)    → DRIFT
 *   CC72 (release)      → AIR
 *   CC73 (attack)       → TIME
 *   CC74 (brightness)   → BLOOM
 *   CC75                → GLIDE
 *   CC76                → SUB
 */

export type MidiTarget =
  | "weatherX"
  | "weatherY"
  | "drift"
  | "air"
  | "time"
  | "bloom"
  | "glide"
  | "sub"
  | "volume"
  | "hold";

export const MIDI_TARGET_LABELS: Record<MidiTarget, string> = {
  weatherX: "WEATHER X",
  weatherY: "WEATHER Y",
  drift: "DRIFT",
  air: "AIR",
  time: "TIME",
  bloom: "BLOOM",
  glide: "GLIDE",
  sub: "SUB",
  volume: "VOL",
  hold: "HOLD",
};

export const ALL_MIDI_TARGETS: readonly MidiTarget[] = [
  "weatherX", "weatherY", "drift", "air", "time",
  "bloom", "glide", "sub", "volume", "hold",
] as const;

/** CC number → target parameter */
export type CcMap = Record<number, MidiTarget>;

const STORAGE_KEY = "mdrone-midi-cc-map";

const DEFAULT_CC_MAP: CcMap = {
  1: "weatherY",   // mod wheel
  2: "weatherX",   // breath controller
  7: "volume",     // channel volume
  64: "hold",      // sustain pedal
  71: "drift",     // resonance / filter resonance
  72: "air",       // release time
  73: "time",      // attack time
  74: "bloom",     // brightness / cutoff
  75: "glide",
  76: "sub",
};

export function loadCcMap(): CcMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, MidiTarget>;
      const map: CcMap = {};
      for (const [k, v] of Object.entries(parsed)) {
        const cc = parseInt(k, 10);
        if (!isNaN(cc) && cc >= 0 && cc <= 127 && ALL_MIDI_TARGETS.includes(v)) {
          map[cc] = v;
        }
      }
      return { ...DEFAULT_CC_MAP, ...map };
    }
  } catch { /* noop */ }
  return { ...DEFAULT_CC_MAP };
}

export function saveCcMap(map: CcMap): void {
  try {
    // Only persist user overrides (entries that differ from defaults)
    const overrides: Record<number, MidiTarget> = {};
    for (const [k, v] of Object.entries(map)) {
      const cc = parseInt(k, 10);
      if (DEFAULT_CC_MAP[cc] !== v) {
        overrides[cc] = v;
      }
    }
    // Also persist new mappings not in defaults
    for (const [k, v] of Object.entries(map)) {
      const cc = parseInt(k, 10);
      if (!(cc in DEFAULT_CC_MAP)) {
        overrides[cc] = v;
      }
    }
    if (Object.keys(overrides).length > 0) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch { /* noop */ }
}

/** Assign a CC to a target. Removes any existing mapping for that CC first. */
export function assignCc(map: CcMap, cc: number, target: MidiTarget): CcMap {
  const next: CcMap = {};
  // Copy existing, removing any prior assignment of this CC
  for (const [k, v] of Object.entries(map)) {
    const existingCc = parseInt(k, 10);
    if (existingCc !== cc) next[existingCc] = v;
  }
  next[cc] = target;
  return next;
}

/** Remove a CC mapping */
export function removeCc(map: CcMap, cc: number): CcMap {
  const next: CcMap = {};
  for (const [k, v] of Object.entries(map)) {
    const existingCc = parseInt(k, 10);
    if (existingCc !== cc) next[existingCc] = v;
  }
  return next;
}

/** Reset to defaults */
export function resetCcMap(): CcMap {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* noop */ }
  return { ...DEFAULT_CC_MAP };
}
