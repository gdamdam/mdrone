import { useCallback, useEffect, useRef, useState } from "react";
import { useMidiInput, midiNoteToPitch } from "../engine/midiInput";
import type { AudioEngine } from "../engine/AudioEngine";
import type { PitchClass, ViewMode } from "../types";
import { Header } from "./Header";
import { Footer } from "./Footer";
import { DroneView, type DroneViewHandle } from "./DroneView";
import { MixerView } from "./MixerView";
import { MeditateView } from "./MeditateView";
import { ShareModal } from "./ShareModal";
import { useSceneManager } from "../scene/useSceneManager";

interface LayoutProps {
  engine: AudioEngine;
  startupMode: "continue" | "new";
}

/**
 * Top-level app shell — header, view dispatch, footer.
 *
 * Engine lifecycle: `engine` is created eagerly in App so every
 * descendant receives it on first render. The AudioContext starts
 * suspended — we call `engine.resume()` on the first pointerdown
 * inside the layout so child click handlers on the same interaction
 * (e.g. HOLD button) get a live engine immediately.
 */
export function Layout({ engine, startupMode }: LayoutProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("drone");
  const [isRec, setIsRec] = useState(false);
  const [recTimeMs, setRecTimeMs] = useState(0);
  const [recBusy, setRecBusy] = useState(false);
  const [mixerSyncToken, setMixerSyncToken] = useState(0);
  const [headerTonic, setHeaderTonic] = useState<PitchClass>("A");
  const [headerOctave, setHeaderOctave] = useState(2);
  const [headerHolding, setHeaderHolding] = useState(false);
  const [headerVolume, setHeaderVolume] = useState<number>(() => engine.getMasterVolume());
  const [shareOpen, setShareOpen] = useState(false);
  const recStartRef = useRef(0);
  const resumedRef = useRef(false);
  const droneViewRef = useRef<DroneViewHandle | null>(null);

  const sceneManager = useSceneManager({
    engine,
    droneViewRef,
    onMixerSync: () => setMixerSyncToken((value) => value + 1),
    startupMode,
  });

  // REC timer tick — sync to external timer (Date.now). When isRec flips
  // off, the timer interval is cleared and we reset in the next frame via
  // a cleanup setter to avoid setState-in-effect lint warning.
  useEffect(() => {
    if (!isRec) return;
    recStartRef.current = Date.now();
    const id = window.setInterval(
      () => setRecTimeMs(Date.now() - recStartRef.current),
      200,
    );
    return () => {
      window.clearInterval(id);
      setRecTimeMs(0);
    };
  }, [isRec]);

  const handleChangeTonic = (tonic: PitchClass) => {
    droneViewRef.current?.setRoot(tonic);
  };

  const handleChangeOctave = (octave: number) => {
    droneViewRef.current?.setOctave(octave);
  };

  // MIDI input — external keyboard drives tonic + octave.
  const handleMidiNote = useCallback((note: number) => {
    const { pitchClass, octave } = midiNoteToPitch(note);
    const clamped = Math.max(1, Math.min(6, octave));
    droneViewRef.current?.setRoot(pitchClass);
    droneViewRef.current?.setOctave(clamped);
  }, []);
  const midi = useMidiInput(handleMidiNote);

  const handleToggleHold = () => {
    droneViewRef.current?.togglePlay();
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
        sessions={sceneManager.savedSessions}
        currentSessionId={sceneManager.currentSessionId}
        currentSessionName={sceneManager.currentSessionName}
        onLoadSession={sceneManager.handleLoadSession}
        onSaveSession={sceneManager.handleSaveSession}
        onRenameSession={sceneManager.handleRenameSession}
        displayText={sceneManager.displayText}
        tonic={headerTonic}
        octave={headerOctave}
        onChangeTonic={handleChangeTonic}
        onChangeOctave={handleChangeOctave}
        onToggleHold={handleToggleHold}
        holding={headerHolding}
        onToggleRec={handleToggleRec}
        onOpenShare={() => setShareOpen(true)}
        onRandomScene={sceneManager.handleRandomScene}
        isRec={isRec}
        recTimeMs={recTimeMs}
        recordingSupported={recordingSupport.supported}
        recordingTitle={recordingTitle}
        recordingBusy={recBusy}
        volume={headerVolume}
        onChangeVolume={(v) => {
          setHeaderVolume(v);
          engine.setMasterVolume(v);
        }}
        midiSupported={midi.supported}
        midiEnabled={midi.enabled}
        midiDevices={midi.devices}
        midiLastNote={midi.lastNote}
        midiError={midi.error}
        onToggleMidi={(on) => midi.setEnabled(on)}
        analyser={engine.getAnalyser()}
      />

      <main className={`view view-mode-${viewMode}`}>
        <section
          className={viewMode === "drone" ? "view-panel view-panel-active" : "view-panel"}
          aria-hidden={viewMode !== "drone"}
        >
          <DroneView
            ref={droneViewRef}
            engine={engine}
            onTransportChange={setHeaderHolding}
            onTonicChange={(root, octave) => {
              setHeaderTonic(root);
              setHeaderOctave(octave);
            }}
            onPresetChange={(_presetId, presetName) => {
              sceneManager.handlePresetNameChange(presetName);
            }}
          />
        </section>
        <section
          className={viewMode === "meditate" ? "view-panel view-panel-active" : "view-panel"}
          aria-hidden={viewMode !== "meditate"}
        >
          <MeditateView
            engine={engine}
            active={viewMode === "meditate"}
            visualizer={sceneManager.meditateVisualizer}
            onChangeVisualizer={sceneManager.setMeditateVisualizer}
          />
        </section>
        <section
          className={viewMode === "mixer" ? "view-panel view-panel-active" : "view-panel"}
          aria-hidden={viewMode !== "mixer"}
        >
          <MixerView
            key={mixerSyncToken}
            engine={engine}
            volume={headerVolume}
            onVolumeChange={(v) => {
              setHeaderVolume(v);
              engine.setMasterVolume(v);
            }}
          />
        </section>
      </main>

      {shareOpen && (
        <ShareModal
          initialName={sceneManager.shareInitialName}
          onBuildShareData={sceneManager.buildShareSceneData}
          onClose={() => setShareOpen(false)}
        />
      )}

      <Footer />
    </div>
  );
}
