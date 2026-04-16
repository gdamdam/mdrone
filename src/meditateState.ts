import type { Visualizer } from "./components/visualizers";

const STORAGE_KEY = "mdrone.meditate.visualizer";

/** Only one visualizer exists now (pitch mandala). Legacy stored
 *  values from previous sessions are ignored — the loader always
 *  returns the canonical value. */
export function loadMeditateVisualizer(): Visualizer {
  return "pitchMandala";
}

export function saveMeditateVisualizer(_visualizer: Visualizer): void {
  try {
    localStorage.setItem(STORAGE_KEY, "pitchMandala");
  } catch {
    // ignore storage failures
  }
}
