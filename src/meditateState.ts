import type { Visualizer } from "./components/visualizers";
import { VISUALIZER_ORDER } from "./components/visualizers";

const STORAGE_KEY = "mdrone.meditate.visualizer";

export function loadMeditateVisualizer(): Visualizer {
  try {
    const value = localStorage.getItem(STORAGE_KEY) as Visualizer | null;
    if (value && VISUALIZER_ORDER.includes(value)) return value;
  } catch {
    // ignore storage failures
  }
  return "mandala";
}

export function saveMeditateVisualizer(visualizer: Visualizer): void {
  try {
    localStorage.setItem(STORAGE_KEY, visualizer);
  } catch {
    // ignore storage failures
  }
}
