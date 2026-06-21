/** App version — sourced from package.json at build time via vite's
 * `define` (see vite.config.ts) so there's a single source of truth.
 * Bump package.json on release and the banner in Layout will prompt
 * existing clients to reload once the new build is deployed. */
declare const __APP_VERSION__: string;
export const APP_VERSION = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "0.0.0";

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
  /** Ableton Link explicit opt-in. When true, the Link Bridge
   *  client keeps retrying until connected. Auto-detect still runs
   *  at startup regardless. */
  linkEnabled: "mdrone-link-enabled",
  /** LFO rate sync mode. "free" | bar multiples ("8/1".."2/1") |
   *  "1/1".."1/16". */
  lfoSyncMode: "mdrone-lfo-sync-mode",
  /** Grid-quantize changes to the Link grid. "off" | "beat" | "bar" |
   *  "2bar". Opt-in; default off keeps the immediate behaviour. Only the
   *  performance-grid changes (root/chord/preset/sync-mode + drone start)
   *  are deferred to the boundary; emergency controls never are. */
  quantizeGrid: "mdrone-quantize-grid",
  /** Low-power mode opt-in. When true: MEDITATE clamps to 15 fps,
   *  the LUFS meter publishes at ~5 Hz instead of ~30 Hz, and the
   *  master-bus duck on preset change is skipped. Off by default. */
  lowPowerMode: "mdrone-low-power",
  /** LIVE SAFE — explicit stability mode for stage / pro use. Clamps
   *  voice cap, suppresses heavy FX, engages low-power visuals. Off
   *  by default. */
  liveSafeMode: "mdrone-live-safe",
  /** LIVE SAFE header opt-in — display preference, distinct from the
   *  mode itself. When true, the experimental shield control is shown
   *  in the header (clickable to toggle the mode on/off). Off by
   *  default so the header stays uncluttered for people not using it.
   *  Turning this off also forces the mode off (no invisible active
   *  state). */
  liveSafeInHeader: "mdrone-live-safe-in-header",
  /** Mutation intensity (0..1) — controls how much MUTATE perturbs
   *  the current scene per click. Was an inline slider in the perform
   *  row; lives in Settings → GENERAL now. Default 0.25. */
  mutateIntensity: "mdrone-mutate-intensity",
  /** Evolution indicator opt-in. When true, a small HELD STEADY /
   *  DRIFTING / JOURNEY status line shows under the VU meter. Off by
   *  default to keep the surface calm. */
  evolutionIndicator: "mdrone-evolution-indicator",
  /** UI label mode — "plain" shows always-visible plain-language
   *  captions under the coined primary controls (HOLD / WEATHER / RND /
   *  ATTUNE / MUTATE) so first-time and touch users (no hover tooltips)
   *  can read what each does; "poetic" hides them for the spare look.
   *  Default plain. See src/labelMode.ts. */
  labelMode: "mdrone-label-mode",
} as const;

export type WeatherVisual = "waveform" | "flow" | "minimal";
export const WEATHER_VISUAL_LABELS: Record<WeatherVisual, string> = {
  waveform: "WAVEFORM",
  flow: "FLOW FIELD",
  minimal: "MINIMAL",
};
