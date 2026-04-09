import { useEffect, useState } from "react";
import { AudioEngine } from "./engine/AudioEngine";
import { Layout } from "./components/Layout";
import { StartGate } from "./components/StartGate";
import { SharedSceneGate } from "./components/SharedSceneGate";
import { applyPalette, loadPaletteId, PALETTES } from "./themes";
import { loadAutosavedScene, type AutosavedScene, type PortableScene } from "./session";
import { loadSceneFromCurrentUrlOnce } from "./shareCodec";

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

type SharedSceneState =
  | { status: "loading" }
  | { status: "ready"; scene: PortableScene | null };

export function App() {
  const [started, setStarted] = useState(false);
  const [startupMode, setStartupMode] = useState<"continue" | "new">("new");
  const [autosavedScene] = useState<AutosavedScene | null>(() => loadAutosavedScene());
  const [sharedState, setSharedState] = useState<SharedSceneState>({ status: "loading" });

  useEffect(() => {
    const id = loadPaletteId();
    const palette = PALETTES.find((p) => p.id === id) ?? PALETTES[0];
    applyPalette(palette);
  }, []);

  // Probe the URL once for a shared scene. If present, we show the
  // scene-card gate instead of the generic splash. Layout.tsx later
  // reuses the same cached decode to apply the scene to the engine.
  useEffect(() => {
    let cancelled = false;
    loadSceneFromCurrentUrlOnce()
      .then((scene) => {
        if (cancelled) return;
        setSharedState({ status: "ready", scene });
      })
      .catch(() => {
        if (cancelled) return;
        setSharedState({ status: "ready", scene: null });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!started) {
    if (sharedState.status === "loading") {
      // Brief neutral state while the URL is probed — avoids flashing
      // the generic splash for shared links.
      return <div className="start-gate" aria-busy="true" />;
    }
    if (sharedState.scene) {
      return (
        <SharedSceneGate
          scene={sharedState.scene}
          onStart={async () => {
            const engine = getEngine();
            await engine.resume();
            setStarted(true);
          }}
        />
      );
    }
    return (
      <StartGate
        lastScene={autosavedScene}
        onStart={async (mode) => {
          setStartupMode(mode);
          const engine = getEngine();
          await engine.resume();
          setStarted(true);
        }}
      />
    );
  }

  const engine = getEngine();
  return <Layout engine={engine} startupMode={startupMode} />;
}
