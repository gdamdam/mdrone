/**
 * midiMapping — MIDI CC → parameter registry + mapping persistence.
 *
 * Design
 * ------
 * Rather than a hardcoded enum of ~10 mappable parameters, mdrone
 * exposes a registry of every target a performer might want to drive
 * from a hardware controller. The registry is pure metadata (id,
 * label, group, kind). The actual dispatch — turning a CC value into
 * a setter call — lives in Layout.tsx because the setters need refs
 * to the live engine + DroneView handle.
 *
 * Target IDs
 * ----------
 * Strings. Builtin macros keep their short names (`drift`, `air`,
 * `weatherX`, …) so existing saved `CcMap`s still resolve. Newer
 * targets use dotted namespaces to avoid collisions between concepts
 * that happen to share a word (`sub` the voice macro vs `fx.sub` the
 * octave-down effect).
 *
 * Persistence
 * -----------
 * A CcMap is a plain `{ [cc]: targetId }` object. Existing mapping
 * files round-trip unchanged: they reference the builtin ids that
 * still exist. Any CC that points at an unknown id (e.g. a future
 * mdrone removes a target) is dropped on load.
 */

export type MidiTargetKind =
  | "continuous" // 0..127 CC value is mapped via the Layout handler
  | "trigger"    // >=64 = fire (once while in the "on" zone)
  | "enum";      // CC value 0..127 split into N equal bands → option index

export interface MidiTarget {
  id: string;
  label: string;
  /** Group heading shown in the Settings MIDI panel. */
  group: string;
  kind: MidiTargetKind;
  /** Only set for kind === "enum" — option labels in selection order. */
  options?: readonly string[];
}

/** Map a 0..127 CC value to an enum option index by band-splitting,
 *  matching Ableton's value-list MIDI mapping convention. */
export function enumIndexFromCc(value: number, optionCount: number): number {
  if (optionCount <= 1) return 0;
  const v = Math.max(0, Math.min(127, value));
  const idx = Math.floor((v / 128) * optionCount);
  return Math.min(optionCount - 1, idx);
}

/** Vowel labels shared with the Formant FX modal — keep in sync. */
export const FORMANT_VOWEL_LABELS = ["AH", "EE", "OH", "OO", "EH"] as const;

/** Full registry. Ordered — the UI renders in this order within each
 *  group. Adding a new target is a single entry here plus a case in
 *  the Layout dispatch switch (see components/Layout.tsx). */
export const MIDI_TARGETS: readonly MidiTarget[] = [
  // ── Macros ───────────────────────────────────────────────────────
  { id: "drift",    label: "DETUNE",   group: "Macros",   kind: "continuous" },
  { id: "air",      label: "AIR",      group: "Macros",   kind: "continuous" },
  { id: "time",     label: "TIME",     group: "Macros",   kind: "continuous" },
  { id: "sub",      label: "SUB",      group: "Macros",   kind: "continuous" },
  { id: "bloom",    label: "ATTACK",   group: "Macros",   kind: "continuous" },
  { id: "glide",    label: "GLIDE",    group: "Macros",   kind: "continuous" },
  { id: "morph",    label: "CROSSFADE", group: "Macros",  kind: "continuous" },
  { id: "evolve",   label: "EVOLVE",   group: "Macros",   kind: "continuous" },
  { id: "pluck",    label: "PLUCK",    group: "Macros",   kind: "continuous" },
  { id: "tilt",     label: "TILT",     group: "Macros",   kind: "continuous" },
  { id: "width",    label: "WIDTH",    group: "Macros",   kind: "continuous" },

  // ── Weather + LFO ────────────────────────────────────────────────
  { id: "weatherX",  label: "WEATHER X",  group: "Weather", kind: "continuous" },
  { id: "weatherY",  label: "WEATHER Y",  group: "Weather", kind: "continuous" },
  { id: "lfoRate",   label: "LFO RATE",   group: "Weather", kind: "continuous" },
  { id: "lfoAmount", label: "LFO DEPTH",  group: "Weather", kind: "continuous" },

  // ── Mixer ────────────────────────────────────────────────────────
  { id: "volume",  label: "VOL",     group: "Mixer", kind: "continuous" },
  { id: "hpf",     label: "HPF",     group: "Mixer", kind: "continuous" },
  { id: "eqLow",   label: "EQ LOW",  group: "Mixer", kind: "continuous" },
  { id: "eqMid",   label: "EQ MID",  group: "Mixer", kind: "continuous" },
  { id: "eqHigh",  label: "EQ HIGH", group: "Mixer", kind: "continuous" },
  { id: "glue",    label: "GLUE",    group: "Mixer", kind: "continuous" },
  { id: "drive",   label: "DRIVE",   group: "Mixer", kind: "continuous" },
  { id: "ceiling", label: "CEILING", group: "Mixer", kind: "continuous" },

  // ── Voice levels ─────────────────────────────────────────────────
  { id: "voice.tanpura", label: "TANPURA", group: "Voices", kind: "continuous" },
  { id: "voice.reed",    label: "REED",    group: "Voices", kind: "continuous" },
  { id: "voice.metal",   label: "METAL",   group: "Voices", kind: "continuous" },
  { id: "voice.air",     label: "AIR VX",  group: "Voices", kind: "continuous" },
  { id: "voice.piano",   label: "PIANO",   group: "Voices", kind: "continuous" },
  { id: "voice.fm",      label: "FM",      group: "Voices", kind: "continuous" },
  { id: "voice.amp",     label: "AMP",     group: "Voices", kind: "continuous" },

  // ── Effect levels ────────────────────────────────────────────────
  { id: "fx.tape",        label: "TAPE",       group: "Effects", kind: "continuous" },
  { id: "fx.wow",         label: "WOW",        group: "Effects", kind: "continuous" },
  { id: "fx.sub",         label: "SUB (fx)",   group: "Effects", kind: "continuous" },
  { id: "fx.comb",        label: "COMB",       group: "Effects", kind: "continuous" },
  { id: "fx.delay",       label: "DELAY",      group: "Effects", kind: "continuous" },
  { id: "fx.plate",       label: "PLATE",      group: "Effects", kind: "continuous" },
  { id: "fx.hall",        label: "HALL",       group: "Effects", kind: "continuous" },
  { id: "fx.shimmer",     label: "SHIMMER",    group: "Effects", kind: "continuous" },
  { id: "fx.freeze",      label: "FREEZE",     group: "Effects", kind: "continuous" },
  { id: "fx.cistern",     label: "CISTERN",    group: "Effects", kind: "continuous" },
  { id: "fx.granular",    label: "GRANULAR",   group: "Effects", kind: "continuous" },
  { id: "fx.graincloud",  label: "GRAINCLOUD", group: "Effects", kind: "continuous" },
  { id: "fx.ringmod",     label: "RINGMOD",    group: "Effects", kind: "continuous" },
  { id: "fx.formant",       label: "FORMANT",       group: "Effects", kind: "continuous" },
  { id: "fx.formant.vowel", label: "FORMANT VOWEL", group: "Effects", kind: "enum",
    options: FORMANT_VOWEL_LABELS },
  { id: "fx.halo",          label: "HALO",          group: "Effects", kind: "continuous" },

  // ── Triggers ─────────────────────────────────────────────────────
  { id: "hold",   label: "HOLD",   group: "Triggers", kind: "trigger" },
  { id: "panic",  label: "PANIC",  group: "Triggers", kind: "trigger" },
  { id: "rnd",    label: "RND",    group: "Triggers", kind: "trigger" },
  { id: "mutate", label: "MUTATE", group: "Triggers", kind: "trigger" },

  // ── Preset recall (cycle) ────────────────────────────────────────
  // Bank-less cycling by default — an artist with four pads can map
  // prev / next / group-prev / group-next and walk the whole library.
  // Slot-style direct recall (`preset.slot.1..N`) is intentionally
  // deferred until there's a UI for slot→preset assignment.
  { id: "preset.prev",       label: "PRESET ◀",   group: "Presets", kind: "trigger" },
  { id: "preset.next",       label: "PRESET ▶",   group: "Presets", kind: "trigger" },
  { id: "preset.group.prev", label: "GROUP ◀",    group: "Presets", kind: "trigger" },
  { id: "preset.group.next", label: "GROUP ▶",    group: "Presets", kind: "trigger" },
];

export const MIDI_TARGETS_BY_ID: Map<string, MidiTarget> = new Map(
  MIDI_TARGETS.map((t) => [t.id, t]),
);

export const MIDI_TARGET_GROUPS: readonly string[] = Array.from(
  new Set(MIDI_TARGETS.map((t) => t.group)),
);

/** Back-compat — legacy codepaths referenced a `MidiTarget` union
 *  type that matched the builtin short names. Consumers should move
 *  to plain strings; this alias keeps older code compiling. */
export type LegacyMidiTarget = string;

export const MIDI_TARGET_LABELS: Record<string, string> = Object.fromEntries(
  MIDI_TARGETS.map((t) => [t.id, t.label]),
);

/** CC number → target id. */
export type CcMap = Record<number, string>;

const STORAGE_KEY = "mdrone-midi-cc-map";

/** Defaults — work out of the box with most controllers. Only the
 *  builtin macros / weather / volume / hold are defaulted, so hardware
 *  with unlabeled pots doesn't accidentally mass-assign every target. */
const DEFAULT_CC_MAP: CcMap = {
  1:  "weatherY",   // mod wheel
  2:  "weatherX",   // breath
  7:  "volume",     // channel volume
  64: "hold",       // sustain pedal
  71: "drift",
  72: "air",
  73: "time",
  74: "bloom",
  75: "glide",
  76: "sub",
};

function isValidTargetId(id: unknown): id is string {
  return typeof id === "string" && MIDI_TARGETS_BY_ID.has(id);
}

export function loadCcMap(): CcMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const map: CcMap = {};
      for (const [k, v] of Object.entries(parsed)) {
        const cc = parseInt(k, 10);
        if (!isNaN(cc) && cc >= 0 && cc <= 127 && isValidTargetId(v)) {
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
    const overrides: CcMap = {};
    for (const [k, v] of Object.entries(map)) {
      const cc = parseInt(k, 10);
      // Persist entries that differ from default or weren't defaulted.
      if (DEFAULT_CC_MAP[cc] !== v) overrides[cc] = v;
    }
    if (Object.keys(overrides).length > 0) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch { /* noop */ }
}

/** Assign a CC to a target. Removes any existing mapping for that CC. */
export function assignCc(map: CcMap, cc: number, targetId: string): CcMap {
  const next: CcMap = {};
  for (const [k, v] of Object.entries(map)) {
    const existingCc = parseInt(k, 10);
    if (existingCc !== cc) next[existingCc] = v;
  }
  next[cc] = targetId;
  return next;
}

/** Remove a CC mapping. */
export function removeCc(map: CcMap, cc: number): CcMap {
  const next: CcMap = {};
  for (const [k, v] of Object.entries(map)) {
    const existingCc = parseInt(k, 10);
    if (existingCc !== cc) next[existingCc] = v;
  }
  return next;
}

/** Find the CC currently assigned to a given target id, or null. */
export function ccForTarget(map: CcMap, targetId: string): number | null {
  for (const [k, v] of Object.entries(map)) {
    if (v === targetId) return parseInt(k, 10);
  }
  return null;
}

export function resetCcMap(): CcMap {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* noop */ }
  return { ...DEFAULT_CC_MAP };
}

/* ── Templates + import/export ────────────────────────────────────────
 *
 * Performers often want multiple controller layouts: e.g. a Launch
 * Control bank for live, a small fader pad for studio. Templates are
 * named CcMap snapshots saved to localStorage. Import/export uses a
 * tiny JSON wrapper so files round-trip across versions.
 */

const TEMPLATES_KEY = "mdrone-midi-cc-templates";

export type MidiTemplates = Record<string, CcMap>;

function sanitizeMap(raw: Record<string, unknown>): CcMap {
  const map: CcMap = {};
  for (const [k, v] of Object.entries(raw)) {
    const cc = parseInt(k, 10);
    if (!isNaN(cc) && cc >= 0 && cc <= 127 && isValidTargetId(v)) {
      map[cc] = v;
    }
  }
  return map;
}

export function loadTemplates(): MidiTemplates {
  try {
    const raw = localStorage.getItem(TEMPLATES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: MidiTemplates = {};
    for (const [name, val] of Object.entries(parsed)) {
      if (val && typeof val === "object") {
        out[name] = sanitizeMap(val as Record<string, unknown>);
      }
    }
    return out;
  } catch { return {}; }
}

export function saveTemplate(name: string, map: CcMap): MidiTemplates {
  const all = loadTemplates();
  all[name] = { ...map };
  try { localStorage.setItem(TEMPLATES_KEY, JSON.stringify(all)); } catch { /* noop */ }
  return all;
}

export function deleteTemplate(name: string): MidiTemplates {
  const all = loadTemplates();
  delete all[name];
  try {
    if (Object.keys(all).length === 0) localStorage.removeItem(TEMPLATES_KEY);
    else localStorage.setItem(TEMPLATES_KEY, JSON.stringify(all));
  } catch { /* noop */ }
  return all;
}

/** JSON wrapper for export files. Includes a format tag so future
 *  versions can migrate without guessing what they're reading. */
export function exportCcMap(map: CcMap, name = "mdrone-midi"): string {
  return JSON.stringify(
    { format: "mdrone-midi-cc", version: 1, name, map },
    null, 2,
  );
}

/** Accept either the wrapped format or a bare `{cc: targetId}` blob.
 *  Returns null if no valid entries are found. */
export function parseImportedCcMap(text: string): CcMap | null {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const raw = parsed && typeof parsed === "object" && "map" in parsed
                && typeof parsed.map === "object" && parsed.map !== null
      ? parsed.map as Record<string, unknown>
      : parsed as Record<string, unknown>;
    const map = sanitizeMap(raw);
    return Object.keys(map).length ? map : null;
  } catch { return null; }
}
