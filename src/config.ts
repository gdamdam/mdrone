/** App version — bump on release. */
export const APP_VERSION = "1.0.0";

/** LocalStorage keys, namespaced so mpump/mloop don't collide. */
export const STORAGE_KEYS = {
  palette: "mdrone-palette",
  darkMode: "mdrone-dark",
  sessions: "mdrone-sessions",
  currentSessionId: "mdrone-current-session-id",
} as const;
