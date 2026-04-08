import { useEffect } from "react";
import { AudioEngine } from "./engine/AudioEngine";
import { Layout } from "./components/Layout";
import { applyPalette, loadPaletteId, PALETTES } from "./themes";

/**
 * Module-level singleton. React StrictMode double-mounts App in dev,
 * which would otherwise create two AudioEngines (two AudioContexts,
 * two LFO oscillators, two graphs) running in parallel and competing
 * for the audio clock — producing clicks and dropouts.
 *
 * Keeping the engine on the module scope guarantees exactly one is
 * ever created, regardless of how many times App mounts.
 */
let globalEngine: AudioEngine | null = null;
function getEngine(): AudioEngine {
  if (!globalEngine) globalEngine = new AudioEngine();
  return globalEngine;
}

export function App() {
  const engine = getEngine();

  useEffect(() => {
    const id = loadPaletteId();
    const palette = PALETTES.find((p) => p.id === id) ?? PALETTES[0];
    applyPalette(palette);
  }, []);

  return <Layout engine={engine} />;
}
