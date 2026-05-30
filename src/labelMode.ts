/**
 * UI label mode — the plain-language scaffolding for the coined primary
 * controls.
 *
 * The Performance surface speaks in invented vocabulary (HOLD, WEATHER,
 * RND, ATTUNE, MUTATE). Hover `title` tooltips explain them, but ~half
 * the audience is on touch and never sees a tooltip. In "plain" mode
 * (the default) a small always-visible caption renders under each of
 * those controls; in "poetic" mode the captions are hidden to reclaim
 * the deliberately spare look.
 *
 * Visibility is driven entirely by CSS keyed on a `data-labels` attribute
 * on the document root (see globals.css), so the caption markup is static
 * and no React state needs to be threaded down to WeatherPad / DroneView.
 */
import { STORAGE_KEYS } from "./config";

export type LabelMode = "plain" | "poetic";

const DEFAULT_LABEL_MODE: LabelMode = "plain";

export function loadLabelMode(): LabelMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.labelMode);
    if (stored === "plain" || stored === "poetic") return stored;
  } catch {
    // ignore storage failures
  }
  return DEFAULT_LABEL_MODE;
}

export function saveLabelMode(mode: LabelMode): void {
  try {
    localStorage.setItem(STORAGE_KEYS.labelMode, mode);
  } catch {
    // ignore storage failures
  }
}

/** Reflect the mode onto the document root so CSS can show/hide the
 *  control captions. Safe to call before/without a DOM (SSR, tests). */
export function applyLabelMode(mode: LabelMode): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.labels = mode;
}
