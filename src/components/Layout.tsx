import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { useMidiInput, midiNoteToPitch } from "../engine/midiInput";
import { loadCcMap, saveCcMap, assignCc, resetCcMap, type CcMap, type MidiTarget } from "../engine/midiMapping";
import type { AudioEngine } from "../engine/AudioEngine";
import type { PitchClass, ViewMode } from "../types";
import { APP_VERSION, STORAGE_KEYS, type WeatherVisual } from "../config";
import { Header } from "./Header";
import { Footer } from "./Footer";
import { DroneView, type DroneViewHandle } from "./DroneView";
import { MixerView } from "./MixerView";
import { MeditateView } from "./MeditateView";
import { VISUALIZER_ORDER } from "./visualizers";

const ShareModal = lazy(() =>
  import("./ShareModal").then((m) => ({ default: m.ShareModal })),
);
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
  const [headerTuneHint, setHeaderTuneHint] = useState<string | null>(null);
  const [headerVolume, setHeaderVolume] = useState<number>(() => engine.getMasterVolume());
  const [shareOpen, setShareOpen] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const recStartRef = useRef(0);
  const resumedRef = useRef(false);
  const droneViewRef = useRef<DroneViewHandle | null>(null);
  const holdToggleRef = useRef<(() => void) | null>(null);

  const sceneManager = useSceneManager({
    engine,
    droneViewRef,
    onMixerSync: () => setMixerSyncToken((value) => value + 1),
    startupMode,
  });
  const handlePresetNameChange = sceneManager.handlePresetNameChange;

  // Memoize the onPresetChange wrapper so DroneView's effect that
  // watches it (useDroneScene:319) only re-fires when the preset
  // actually changes. Without this, the inline arrow was a fresh
  // reference every Layout render, re-firing the effect multiple
  // times per RND click and racing against the ignoreNextPresetNameRef
  // one-shot guard — which let preset.name overwrite a generated
  // drone name on the second fire.
  const handlePresetChange = useCallback(
    (_presetId: string | null, presetName: string | null) => {
      handlePresetNameChange(presetName);
    },
    [handlePresetNameChange],
  );

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

  // Check for a newer build every 5 minutes. vite.config.ts writes
  // public/version.json on build; if the fetched version doesn't match
  // APP_VERSION compiled into this bundle, a banner invites the user
  // to reload. cache: "no-store" so we see fresh deploys immediately.
  useEffect(() => {
    const check = () => {
      fetch("version.json", { cache: "no-store" })
        .then((r) => r.json())
        .then((data: { v?: string }) => {
          if (data.v && data.v !== APP_VERSION) setUpdateAvailable(true);
        })
        .catch(() => { /* offline or 404 — ignore */ });
    };
    check();
    const id = window.setInterval(check, 5 * 60 * 1000);
    return () => window.clearInterval(id);
  }, []);

  // MIDI input — external keyboard drives tonic + octave.
  const handleMidiNote = useCallback((note: number) => {
    const { pitchClass, octave } = midiNoteToPitch(note);
    const clamped = Math.max(1, Math.min(6, octave));
    droneViewRef.current?.setRoot(pitchClass);
    droneViewRef.current?.setOctave(clamped);
  }, []);

  // MIDI CC mapping — hardcoded defaults + user learn overrides.
  const [ccMap, setCcMap] = useState<CcMap>(loadCcMap);
  const [midiLearnTarget, setMidiLearnTarget] = useState<MidiTarget | null>(null);
  const ccMapRef = useRef(ccMap);
  const midiLearnRef = useRef(midiLearnTarget);
  useEffect(() => { ccMapRef.current = ccMap; }, [ccMap]);
  useEffect(() => { midiLearnRef.current = midiLearnTarget; }, [midiLearnTarget]);

  const handleMidiCc = useCallback((cc: number, value: number) => {
    // Learn mode: assign this CC to the pending target
    if (midiLearnRef.current) {
      const next = assignCc(ccMapRef.current, cc, midiLearnRef.current);
      setCcMap(next);
      saveCcMap(next);
      setMidiLearnTarget(null);
      return;
    }

    const target = ccMapRef.current[cc];
    if (!target) return;
    const norm = value / 127; // 0..1

    switch (target) {
      case "weatherX":
        droneViewRef.current?.applyLivePatch?.({ climateX: norm }, { record: true });
        break;
      case "weatherY":
        droneViewRef.current?.applyLivePatch?.({ climateY: norm }, { record: true });
        break;
      case "drift":
        droneViewRef.current?.applyLivePatch?.({ drift: norm }, { record: true });
        break;
      case "air":
        droneViewRef.current?.applyLivePatch?.({ air: norm }, { record: true });
        break;
      case "time":
        droneViewRef.current?.applyLivePatch?.({ time: norm }, { record: true });
        break;
      case "bloom":
        droneViewRef.current?.applyLivePatch?.({ bloom: norm }, { record: true });
        break;
      case "glide":
        droneViewRef.current?.applyLivePatch?.({ glide: norm }, { record: true });
        break;
      case "sub":
        droneViewRef.current?.applyLivePatch?.({ sub: norm }, { record: true });
        break;
      case "volume":
        engine?.setMasterVolume?.(norm * 1.5); // 0..1.5 range
        break;
      case "hold":
        // CC64 sustain pedal: ≥64 = on, <64 = off
        if (value >= 64) {
          if (!engine?.isPlaying()) holdToggleRef.current?.();
        } else {
          if (engine?.isPlaying()) holdToggleRef.current?.();
        }
        break;
    }
  }, [engine]);

  // Exposed for the Settings modal's MIDI section
  const handleResetCcMap = useCallback(() => { setCcMap(resetCcMap()); }, []);

  const midi = useMidiInput(handleMidiNote, handleMidiCc);

  // QWERTY keyboard → tonic. Same layout as mpump: A=C, W=C#, S=D,
  // E=D#, D=E, F=F, T=F#, G=G, Y=G#, H=A, U=A#, J=B.
  // Z/X shift octave down/up.
  const [kbdActive, setKbdActive] = useState(false);
  // Motion-recording feature flag — hidden by default, opt-in via
  // the Settings modal. Persisted in localStorage.
  const [motionRecEnabled, setMotionRecEnabledState] = useState<boolean>(
    () => {
      try { return localStorage.getItem(STORAGE_KEYS.motionRecEnabled) === "1"; }
      catch { return false; }
    },
  );
  const [weatherVisual, setWeatherVisualState] = useState<WeatherVisual>(() => {
    try { return (localStorage.getItem(STORAGE_KEYS.weatherVisual) as WeatherVisual) || "waveform"; }
    catch { return "flow"; }
  });
  const setWeatherVisual = useCallback((v: WeatherVisual) => {
    setWeatherVisualState(v);
    try { localStorage.setItem(STORAGE_KEYS.weatherVisual, v); } catch { /* noop */ }
  }, []);

  const setMotionRecEnabled = useCallback((on: boolean) => {
    setMotionRecEnabledState(on);
    try { localStorage.setItem(STORAGE_KEYS.motionRecEnabled, on ? "1" : "0"); }
    catch { /* noop */ }
    // If the user disables it while a recording is in progress, stop it.
    if (!on && sceneManager.isRecordingMotion) sceneManager.handleToggleMotionRecord();
  }, [sceneManager]);
  // Global keyboard shortcuts (always active)
  useEffect(() => {
    const globalHandler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === "<") { e.preventDefault(); sceneManager.handleCyclePresetAll(-1); return; }
      if (e.key === ">") { e.preventDefault(); sceneManager.handleCyclePresetAll(1); return; }
    };
    window.addEventListener("keydown", globalHandler);
    return () => window.removeEventListener("keydown", globalHandler);
  }, [sceneManager]);

  // QWERTY tonic keyboard (only when ⌨ enabled)
  useEffect(() => {
    if (!kbdActive) return;
    const QWERTY: Record<string, PitchClass> = {
      KeyA: "C", KeyW: "C#", KeyS: "D", KeyE: "D#", KeyD: "E",
      KeyF: "F", KeyT: "F#", KeyG: "G", KeyY: "G#", KeyH: "A",
      KeyU: "A#", KeyJ: "B",
    };
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (e.metaKey || e.ctrlKey) return;
      const pc = QWERTY[e.code];
      if (pc) {
        e.preventDefault();
        droneViewRef.current?.setRoot(pc);
        return;
      }
      if (e.code === "KeyZ") {
        e.preventDefault();
        droneViewRef.current?.setOctave(Math.max(1, headerOctave - 1));
      } else if (e.code === "KeyX") {
        e.preventDefault();
        droneViewRef.current?.setOctave(Math.min(6, headerOctave + 1));
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [kbdActive, headerOctave]);

  const handleToggleHold = () => {
    droneViewRef.current?.togglePlay();
  };
  holdToggleRef.current = handleToggleHold;

  /** Panic — stop the drone and kill any lingering effect tails
   *  (convolver IRs, delay buffers, granular ring buffer). Standard
   *  MIDI-style emergency silence: ramp out, flush, ramp back in. */
  const handlePanic = () => {
    engine.panic();
    // Brief delay so the ramp-out completes before reload kills the context
    setTimeout(() => window.location.reload(), 300);
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
        getDefaultSessionName={sceneManager.getDefaultSessionName}
        displayText={sceneManager.displayText}
        tonic={headerTonic}
        octave={headerOctave}
        onChangeTonic={(pc) => droneViewRef.current?.setRoot(pc)}
        onChangeOctave={(o) => droneViewRef.current?.setOctave(Math.max(1, Math.min(6, o)))}
        onToggleHold={handleToggleHold}
        holding={headerHolding}
        onToggleRec={handleToggleRec}
        onPanic={handlePanic}
        onOpenShare={() => setShareOpen(true)}
        onRandomScene={sceneManager.handleRandomScene}
        onUndoScene={sceneManager.handleUndoScene}
        tuneOffsetHint={headerTuneHint}
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
        midiCcMap={ccMap}
        midiLearnTarget={midiLearnTarget}
        onMidiLearn={setMidiLearnTarget}
        onMidiResetMap={handleResetCcMap}
        weatherVisual={weatherVisual}
        onChangeWeatherVisual={setWeatherVisual}
        motionRecEnabled={motionRecEnabled}
        onToggleMotionRec={setMotionRecEnabled}
        analyser={engine.getAnalyser()}
      />

      {updateAvailable && (
        <div className="update-banner">
          <span onClick={() => location.reload()}>
            New version available — tap to update
          </span>
          <button
            className="update-banner-close"
            onClick={(e) => { e.stopPropagation(); setUpdateAvailable(false); }}
            aria-label="Dismiss update banner"
          >
            ✕
          </button>
        </div>
      )}

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
            onPresetChange={handlePresetChange}
            onMutateScene={sceneManager.handleMutateScene}
            onTuneOffsetChange={setHeaderTuneHint}
            onParamRecord={sceneManager.recordParam}
            isRecordingMotion={sceneManager.isRecordingMotion}
            onToggleMotionRecord={sceneManager.handleToggleMotionRecord}
            motionRecEnabled={motionRecEnabled}
            weatherVisual={weatherVisual}
            kbdActive={kbdActive}
            onToggleKbd={() => setKbdActive((v) => !v)}
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
            onFullscreenClick={(x01, y01) => {
              // Single click → set WEATHER XY from click position
              droneViewRef.current?.applyLivePatch?.({ climateX: x01, climateY: y01 }, { record: true });
            }}
            onFullscreenDoubleClick={() => {
              // Double click → cycle to next visualizer
              const order = VISUALIZER_ORDER;
              const cur = order.indexOf(sceneManager.meditateVisualizer);
              const next = order[(cur + 1) % order.length];
              sceneManager.setMeditateVisualizer(next);
            }}
            onFullscreenDrag={(x01, y01) => {
              // Drag → tonic + octave on a 12×6 grid
              const PCS: PitchClass[] = [
                "C", "C#", "D", "D#", "E", "F",
                "F#", "G", "G#", "A", "A#", "B",
              ];
              const pcIdx = Math.max(0, Math.min(11, Math.floor(x01 * 12)));
              const octave = Math.max(1, Math.min(6, Math.round(1 + (1 - y01) * 5)));
              droneViewRef.current?.setRoot(PCS[pcIdx]);
              droneViewRef.current?.setOctave(octave);
            }}
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
        <Suspense fallback={null}>
          <ShareModal
            initialName={sceneManager.shareInitialName}
            onBuildShareData={sceneManager.buildShareSceneData}
            onClose={() => setShareOpen(false)}
          />
        </Suspense>
      )}

      <Footer />
    </div>
  );
}
