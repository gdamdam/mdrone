/** App version — sourced from package.json at build time via vite's
 * `define` (see vite.config.ts) so there's a single source of truth.
 * Bump package.json on release and the banner in Layout will prompt
 * existing clients to reload once the new build is deployed. */
export const APP_VERSION = "1.9.1";

/** LocalStorage keys, namespaced so mpump/mloop don't collide. */
export const STORAGE_KEYS = {
  palette: "mdrone-palette",
  darkMode: "mdrone-dark",
  sessions: "mdrone-sessions",
  currentSessionId: "mdrone-current-session-id",
  autosave: "mdrone-autosave",
  motionRecEnabled: "mdrone-motion-rec",
  weatherVisual: "mdrone-weather-visual",
  /** Persisted user-reordered effect chain (JSON array of EffectId).
   *  Absent → default EFFECT_ORDER. */
  effectOrder: "mdrone-effect-order",
  /** Headphone-safe output ceiling toggle (P3). When true, the
   *  output-trim path clamps to a conservative -6 dBFS ceiling
   *  regardless of the user's volume setting. */
  headphoneSafe: "mdrone-headphone-safe",
  /** Persisted MIDI-CC → macro bindings (P3). JSON map of CC# to
   *  macro name so `learn`d mappings survive reloads. */
  midiBindings: "mdrone-midi-bindings",
  /** Persisted tanpura string-tuning preset (P3). One of the
   *  TANPURA_TUNING_IDS. */
  tanpuraTuning: "mdrone-tanpura-tuning",
} as const;

export type WeatherVisual = "waveform" | "flow" | "minimal";
export const WEATHER_VISUAL_LABELS: Record<WeatherVisual, string> = {
  waveform: "WAVEFORM",
  flow: "FLOW FIELD",
  minimal: "MINIMAL",
};
