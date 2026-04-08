/** App version — bump on release. */
export const APP_VERSION = "0.0.1";

/** LocalStorage keys, namespaced so mpump/mloop don't collide. */
export const STORAGE_KEYS = {
  palette: "mdrone-palette",
  darkMode: "mdrone-dark",
} as const;
