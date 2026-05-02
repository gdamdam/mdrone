import { useState } from "react";
import type { PortableScene } from "../session";

interface SharedSceneGateProps {
  scene: PortableScene;
  onStart: () => Promise<void> | void;
}

/**
 * Splash shown when the user arrives from a shared link. Replaces the
 * generic StartGate for this case so the receiver knows what they're
 * about to load and presses Play to satisfy the browser's autoplay
 * gesture requirement before audio begins.
 *
 * No visual scene-card — sharing is a utility (URL-as-bookmark), not
 * a content/social tool.
 */
export function SharedSceneGate({ scene, onStart }: SharedSceneGateProps) {
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePlay = async () => {
    setStarting(true);
    setError(null);
    try {
      await onStart();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start audio.");
      setStarting(false);
    }
  };

  return (
    <main className="start-gate">
      <div className="start-gate-inner shared-scene-gate">
        <div className="shared-scene-label">SHARED SCENE</div>
        <h2 className="shared-scene-title">{scene.name}</h2>

        <div className="start-gate-actions">
          <button className="start-btn" onClick={handlePlay} disabled={starting}>
            {starting ? "Starting…" : "▶  Play this scene"}
          </button>
        </div>

        {error && <p className="start-gate-error">{error}</p>}

        <div className="start-gate-meta">
          Opening this link plays the exact drone landscape the sender captured.
          <br />
          Press Play to resume the browser's audio and hear it.
        </div>
      </div>
    </main>
  );
}
