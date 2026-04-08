import { useEffect, useRef, useState } from "react";
import type { AudioEngine } from "../engine/AudioEngine";
import type { ViewMode } from "../types";
import { Header } from "./Header";
import { Footer } from "./Footer";
import { DroneView, type DroneViewHandle } from "./DroneView";
import { MixerView } from "./MixerView";
import {
  loadCurrentSessionId,
  loadSessions,
  makeSessionId,
  saveCurrentSessionId,
  saveSessions,
  type MixerSessionSnapshot,
  type SavedSession,
} from "../session";

interface LayoutProps {
  engine: AudioEngine;
}

const DEFAULT_SESSION_NAME = "Untitled Session";

function captureMixerSnapshot(engine: AudioEngine): MixerSessionSnapshot {
  return {
    hpfHz: engine.getHpfFreq(),
    low: engine.getEqLow().gain.value,
    mid: engine.getEqMid().gain.value,
    high: engine.getEqHigh().gain.value,
    glue: engine.getGlueAmount(),
    drive: engine.getDrive(),
    limiterOn: engine.isLimiterEnabled(),
    ceiling: engine.getLimiterCeiling(),
    volume: engine.getOutputTrim().gain.value,
  };
}

function applyMixerSnapshot(engine: AudioEngine, mixer: MixerSessionSnapshot): void {
  engine.setHpfFreq(mixer.hpfHz);
  engine.getEqLow().gain.value = mixer.low;
  engine.getEqMid().gain.value = mixer.mid;
  engine.getEqHigh().gain.value = mixer.high;
  engine.setGlueAmount(mixer.glue);
  engine.setDrive(mixer.drive);
  engine.setLimiterCeiling(mixer.ceiling);
  engine.setLimiterEnabled(mixer.limiterOn);
  engine.getOutputTrim().gain.value = mixer.volume;
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
  const [recBusy, setRecBusy] = useState(false);
  const [savedSessions, setSavedSessions] = useState<SavedSession[]>(loadSessions);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(() => loadCurrentSessionId());
  const [currentSessionName, setCurrentSessionName] = useState(DEFAULT_SESSION_NAME);
  const [mixerSyncToken, setMixerSyncToken] = useState(0);
  const recStartRef = useRef(0);
  const resumedRef = useRef(false);
  const initSessionRef = useRef(false);
  const droneViewRef = useRef<DroneViewHandle | null>(null);

  // REC timer tick — sync to external timer (Date.now). When isRec flips
  // off, the timer interval is cleared and we reset in the next frame via
  // a cleanup setter to avoid setState-in-effect lint warning.
  useEffect(() => {
    if (!isRec) return;
    recStartRef.current = Date.now();
    const id = window.setInterval(
      () => setRecTimeMs(Date.now() - recStartRef.current),
      200
    );
    return () => {
      window.clearInterval(id);
      setRecTimeMs(0);
    };
  }, [isRec]);

  useEffect(() => {
    if (initSessionRef.current) return;
    initSessionRef.current = true;

    if (!currentSessionId) {
      saveCurrentSessionId(null);
      return;
    }

    const session = loadSessions().find((item) => item.id === currentSessionId);
    if (!session) {
      setCurrentSessionId(null);
      setCurrentSessionName(DEFAULT_SESSION_NAME);
      saveCurrentSessionId(null);
      return;
    }

    droneViewRef.current?.applySnapshot(session.drone);
    applyMixerSnapshot(engine, session.mixer);
    setMixerSyncToken((value) => value + 1);
    setCurrentSessionName(session.name);
  }, [currentSessionId, engine]);

  const persistSessions = (sessions: SavedSession[]) => {
    setSavedSessions(sessions);
    saveSessions(sessions);
  };

  const captureSession = (id: string, name: string): SavedSession | null => {
    const drone = droneViewRef.current?.getSnapshot();
    if (!drone) {
      window.alert("mdrone could not read the current drone state yet. Try again in a moment.");
      return null;
    }
    return {
      id,
      name,
      savedAt: new Date().toISOString(),
      version: 1,
      drone,
      mixer: captureMixerSnapshot(engine),
    };
  };

  const storeSession = (id: string, name: string) => {
    const cleanName = name.trim();
    if (!cleanName) return;
    const nextSession = captureSession(id, cleanName);
    if (!nextSession) return;

    const nextSessions = [
      nextSession,
      ...savedSessions.filter((session) => session.id !== id),
    ].sort((a, b) => b.savedAt.localeCompare(a.savedAt));

    persistSessions(nextSessions);
    setCurrentSessionId(id);
    setCurrentSessionName(cleanName);
    saveCurrentSessionId(id);
  };

  const handleSaveSession = () => {
    if (currentSessionId) {
      storeSession(currentSessionId, currentSessionName);
      return;
    }

    const proposed = window.prompt("Save session as:", currentSessionName);
    if (!proposed) return;
    storeSession(makeSessionId(), proposed);
  };

  const handleRenameSession = () => {
    const proposed = window.prompt("Rename session:", currentSessionName);
    if (!proposed) return;
    const cleanName = proposed.trim();
    if (!cleanName) return;

    if (!currentSessionId) {
      storeSession(makeSessionId(), cleanName);
      return;
    }

    storeSession(currentSessionId, cleanName);
  };

  const handleLoadSession = (id: string) => {
    const session = savedSessions.find((item) => item.id === id);
    if (!session) return;
    droneViewRef.current?.applySnapshot(session.drone);
    applyMixerSnapshot(engine, session.mixer);
    setMixerSyncToken((value) => value + 1);
    setCurrentSessionId(session.id);
    setCurrentSessionName(session.name);
    saveCurrentSessionId(session.id);
  };

  const recordingSupport = engine.getRecordingSupport();
  const recordingTitle = !recordingSupport.supported
    ? (recordingSupport.reason ?? "Recording is unavailable in this browser.")
    : isRec
      ? "Stop master recording and download the WAV"
      : "Record the full master output as a WAV file";

  const handleToggleRec = async () => {
    if (recBusy) return;
    setRecBusy(true);
    try {
      if (!isRec) {
        await engine.startMasterRecording();
        setIsRec(true);
      } else {
        await engine.stopMasterRecording();
        setIsRec(false);
      }
    } catch (error) {
      console.error("mdrone: recording failed", error);
      const message = error instanceof Error ? error.message : "Unknown recording error.";
      window.alert(`Recording failed: ${message}`);
      setIsRec(false);
    } finally {
      setRecBusy(false);
    }
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
        sessions={savedSessions}
        currentSessionId={currentSessionId}
        currentSessionName={currentSessionName}
        onLoadSession={handleLoadSession}
        onSaveSession={handleSaveSession}
        onRenameSession={handleRenameSession}
        onToggleRec={handleToggleRec}
        isRec={isRec}
        recTimeMs={recTimeMs}
        recordingSupported={recordingSupport.supported}
        recordingTitle={recordingTitle}
        recordingBusy={recBusy}
      />

      <main className="view">
        <section
          className={viewMode === "drone" ? "view-panel view-panel-active" : "view-panel"}
          aria-hidden={viewMode !== "drone"}
        >
          <DroneView ref={droneViewRef} engine={engine} />
        </section>
        <section
          className={viewMode === "mixer" ? "view-panel view-panel-active" : "view-panel"}
          aria-hidden={viewMode !== "mixer"}
        >
          <MixerView key={mixerSyncToken} engine={engine} />
        </section>
      </main>

      <Footer />
    </div>
  );
}
