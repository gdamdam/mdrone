import { useEffect, useRef, useState } from "react";
import type { PortableScene } from "../session";
import {
  renderSceneCardToCanvas,
  resolveSceneCardStyle,
  type SceneCardStyle,
  type SceneCardStyleChoice,
} from "../shareCard";
import { normaliseLegacyStyleChoice } from "../shareCard/svgBuilder";

interface SharedSceneGateProps {
  scene: PortableScene;
  onStart: () => Promise<void> | void;
}

/**
 * Splash shown when the user arrives from a shared link. Replaces the
 * generic StartGate for this case so the receiver sees the actual scene
 * card (matching the link unfurl card) plus a single PLAY button. The
 * AudioContext resume still needs to happen inside a user gesture, so the
 * button click is mandatory on Safari/Firefox.
 */
export function SharedSceneGate({ scene, onStart }: SharedSceneGateProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pick the card style from ?cs= if present, else auto. Legacy "fractal"
  // URLs are mapped to "tessera" (renamed 2026-04) so old shared links
  // continue to render with their intended style.
  const styleParam: SceneCardStyleChoice = (() => {
    try {
      const sp = new URL(window.location.href).searchParams.get("cs");
      return normaliseLegacyStyleChoice(sp) ?? "auto";
    } catch {
      return "auto";
    }
  })();
  const resolvedStyle: SceneCardStyle = resolveSceneCardStyle(styleParam, scene);

  useEffect(() => {
    if (!canvasRef.current) return;
    let cancelled = false;
    void (async () => {
      try {
        if (canvasRef.current && !cancelled) {
          await renderSceneCardToCanvas(canvasRef.current, scene, resolvedStyle);
        }
      } catch (err) {
        console.error("mdrone: shared scene card render failed", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [scene, resolvedStyle]);

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

        <div className="shared-scene-card">
          <canvas
            ref={canvasRef}
            className="share-card-canvas"
            aria-label={`Shared scene card: ${scene.name}`}
          />
        </div>

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
