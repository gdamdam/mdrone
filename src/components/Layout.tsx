import { useEffect, useRef, useState } from "react";
import type { AudioEngine } from "../engine/AudioEngine";
import type { ViewMode } from "../types";
import { Header } from "./Header";
import { Footer } from "./Footer";
import { DroneView } from "./DroneView";
import { MixerView } from "./MixerView";

interface LayoutProps {
  engine: AudioEngine;
}

/**
 * Top-level app shell — header, view dispatch, footer. No hamburger
 * menus, no sheets, no modals in the prototype. Two views only.
 *
 * Engine lifecycle: `engine` is created eagerly in App so every
 * descendant receives it on first render. The AudioContext starts
 * suspended — we call `engine.resume()` on the first pointerdown
 * inside the layout so child click handlers on the same interaction
 * (e.g. HOLD button) get a live engine immediately.
 */
export function Layout({ engine }: LayoutProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("drone");
  const [isRec, setIsRec] = useState(false);
  const [recTimeMs, setRecTimeMs] = useState(0);
  const recStartRef = useRef(0);
  const resumedRef = useRef(false);

  // REC timer tick
  useEffect(() => {
    if (!isRec) {
      setRecTimeMs(0);
      return;
    }
    recStartRef.current = Date.now();
    const id = window.setInterval(
      () => setRecTimeMs(Date.now() - recStartRef.current),
      200
    );
    return () => window.clearInterval(id);
  }, [isRec]);

  const handleToggleRec = () => {
    if (!isRec) void engine.startMasterRecording();
    else void engine.stopMasterRecording();
    setIsRec((r) => !r);
  };

  /**
   * First pointerdown anywhere in the layout resumes the AudioContext.
   * Because the engine is always non-null now, descendant click
   * handlers on the SAME interaction (e.g. HOLD button click after
   * pointerdown) fire against a live engine — no "first click unlocks,
   * second click acts" bug.
   */
  const handleUnlock = () => {
    if (resumedRef.current) return;
    resumedRef.current = true;
    void engine.resume();
  };

  return (
    <div className="layout" onPointerDown={handleUnlock}>
      <Header
        viewMode={viewMode}
        setViewMode={setViewMode}
        onToggleRec={handleToggleRec}
        isRec={isRec}
        recTimeMs={recTimeMs}
      />

      <main className="view">
        {viewMode === "drone" ? (
          <DroneView engine={engine} />
        ) : (
          <MixerView engine={engine} />
        )}
      </main>

      <Footer />
    </div>
  );
}
