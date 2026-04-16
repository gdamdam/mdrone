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
} as const;

export type WeatherVisual = "waveform" | "flow" | "minimal";
export const WEATHER_VISUAL_LABELS: Record<WeatherVisual, string> = {
  waveform: "WAVEFORM",
  flow: "FLOW FIELD",
  minimal: "MINIMAL",
};
