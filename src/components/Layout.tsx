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
import { requestSigilRefresh, type Visualizer } from "./visualizers";
import { PRESETS, SAFE_RANDOM_PRESET_IDS, createSafeRandomScene } from "../engine/presets";
import { loadMeditateVisualizer, saveMeditateVisualizer } from "../meditateState";
import { buildSceneShareUrl, loadSceneFromCurrentUrl } from "../shareCodec";
import { applyPalette, getPaletteById, loadPaletteId, savePaletteId } from "../themes";
import {
  loadCurrentSessionId,
  loadSessions,
  makeSessionId,
  type FxSessionSnapshot,
  type PortableScene,
  saveCurrentSessionId,
  saveSessions,
  type MixerSessionSnapshot,
  type SavedSession,
} from "../session";

interface LayoutProps {
  engine: AudioEngine;
}

const DEFAULT_SESSION_NAME = "Untitled Session";
const STARTUP_PRESET_IDS = SAFE_RANDOM_PRESET_IDS;
const STARTUP_TONICS: PitchClass[] = ["C", "D", "F", "G", "A"];
const STARTUP_OCTAVE = 2;
const RANDOM_SCENE_TONICS: PitchClass[] = [
  "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
];
const RANDOM_SCENE_OCTAVES = [2, 3] as const;

function pickStartupPreset() {
  const startupPresets = STARTUP_PRESET_IDS
    .map((id) => PRESETS.find((preset) => preset.id === id) ?? null)
    .filter((preset): preset is (typeof PRESETS)[number] => preset !== null);
  const presetPool = startupPresets.length > 0 ? startupPresets : PRESETS;
  return presetPool[Math.floor(Math.random() * presetPool.length)];
}

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

function captureFxSnapshot(engine: AudioEngine): FxSessionSnapshot {
  const fx = engine.getFxChain();
  return {
    levels: {
      tape: fx.getEffectLevel("tape"),
      wow: fx.getEffectLevel("wow"),
      sub: fx.getEffectLevel("sub"),
      comb: fx.getEffectLevel("comb"),
      delay: fx.getEffectLevel("delay"),
      plate: fx.getEffectLevel("plate"),
      hall: fx.getEffectLevel("hall"),
      shimmer: fx.getEffectLevel("shimmer"),
      freeze: fx.getEffectLevel("freeze"),
    },
    delayTime: fx.getDelayTime(),
    delayFeedback: fx.getDelayFeedback(),
    combFeedback: fx.getCombFeedback(),
    subCenter: fx.getSubCenter(),
    freezeMix: fx.getFreezeFeedback(),
  };
}

function applyFxSnapshot(engine: AudioEngine, snapshot: FxSessionSnapshot): void {
  const fx = engine.getFxChain();
  fx.setDelayTime(snapshot.delayTime);
  fx.setDelayFeedback(snapshot.delayFeedback);
  fx.setCombFeedback(snapshot.combFeedback);
  fx.setSubCenter(snapshot.subCenter);
  fx.setFreezeFeedback(snapshot.freezeMix);
  for (const id of Object.keys(snapshot.levels) as (keyof FxSessionSnapshot["levels"])[]) {
    fx.setEffectLevel(id, snapshot.levels[id]);
  }
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
export function Layout({ engine }: LayoutProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("drone");
  const [isRec, setIsRec] = useState(false);
  const [recTimeMs, setRecTimeMs] = useState(0);
  const [recBusy, setRecBusy] = useState(false);
  const [savedSessions, setSavedSessions] = useState<SavedSession[]>(loadSessions);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(() => loadCurrentSessionId());
  const [currentSessionName, setCurrentSessionName] = useState(DEFAULT_SESSION_NAME);
  const [currentPresetName, setCurrentPresetName] = useState<string>("Random Scene");
  const [mixerSyncToken, setMixerSyncToken] = useState(0);
  const [headerTonic, setHeaderTonic] = useState<PitchClass>("A");
  const [headerOctave, setHeaderOctave] = useState(2);
  const [headerHolding, setHeaderHolding] = useState(false);
  const [headerVolume, setHeaderVolume] = useState<number>(() => engine?.getMasterVolume() ?? 1);
  const [meditateVisualizer, setMeditateVisualizer] = useState<Visualizer>(() => loadMeditateVisualizer());
  const [shareOpen, setShareOpen] = useState(false);
  const recStartRef = useRef(0);
  const resumedRef = useRef(false);
  const initSceneRef = useRef(false);
  const droneViewRef = useRef<DroneViewHandle | null>(null);

  const applyStartupScene = () => {
    const randomPreset = pickStartupPreset();
    const randomTonic = STARTUP_TONICS[Math.floor(Math.random() * STARTUP_TONICS.length)];
    droneViewRef.current?.startImmediate(randomTonic, STARTUP_OCTAVE, randomPreset.id);
    setCurrentPresetName(randomPreset.name);
    setCurrentSessionId(null);
    setCurrentSessionName(DEFAULT_SESSION_NAME);
    saveCurrentSessionId(null);
  };

  const applyPortableScene = useCallback((
    scene: PortableScene,
    options?: { sessionId?: string | null },
  ) => {
    const palette = getPaletteById(scene.ui.paletteId) ?? getPaletteById(loadPaletteId());
    if (palette) {
      applyPalette(palette);
      savePaletteId(palette.id);
    }
    setMeditateVisualizer(scene.ui.visualizer);
    requestSigilRefresh();
    droneViewRef.current?.applySnapshot(scene.drone);
    applyMixerSnapshot(engine, scene.mixer);
    applyFxSnapshot(engine, scene.fx);
    setMixerSyncToken((value) => value + 1);
    setCurrentSessionId(options?.sessionId ?? null);
    setCurrentSessionName(scene.name);
    setCurrentPresetName(scene.name);
    saveCurrentSessionId(options?.sessionId ?? null);
  }, [engine]);

  useEffect(() => {
    saveMeditateVisualizer(meditateVisualizer);
  }, [meditateVisualizer]);

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

  // Intentional one-time boot path: shared link beats saved session,
  // which beats the random startup scene.
  useEffect(() => {
    if (initSceneRef.current) return;
    initSceneRef.current = true;
    let cancelled = false;

    const run = async () => {
      const sharedScene = await loadSceneFromCurrentUrl();
      if (cancelled) return;
      if (sharedScene) {
        applyPortableScene(sharedScene);
        return;
      }

      if (!currentSessionId) {
        applyStartupScene();
        return;
      }

      const session = loadSessions().find((item) => item.id === currentSessionId);
      if (!session) {
        applyStartupScene();
        return;
      }

      applyPortableScene(session.scene, { sessionId: session.id });
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [applyPortableScene, currentSessionId]);

  const persistSessions = (sessions: SavedSession[]) => {
    setSavedSessions(sessions);
    saveSessions(sessions);
  };

  const capturePortableScene = (name: string): PortableScene | null => {
    const drone = droneViewRef.current?.getSnapshot();
    if (!drone) {
      window.alert("mdrone could not read the current drone state yet. Try again in a moment.");
      return null;
    }
    return {
      name,
      version: 1,
      drone,
      mixer: captureMixerSnapshot(engine),
      fx: captureFxSnapshot(engine),
      ui: {
        paletteId: loadPaletteId(),
        visualizer: meditateVisualizer,
      },
    };
  };

  const captureSession = (id: string, name: string): SavedSession | null => {
    const scene = capturePortableScene(name);
    if (!scene) return null;
    return {
      id,
      name,
      savedAt: new Date().toISOString(),
      version: 2,
      scene,
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
    applyPortableScene(session.scene, { sessionId: session.id });
  };

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

  const handleRandomScene = () => {
    const randomTonic = RANDOM_SCENE_TONICS[Math.floor(Math.random() * RANDOM_SCENE_TONICS.length)];
    const randomOctave =
      RANDOM_SCENE_OCTAVES[Math.floor(Math.random() * RANDOM_SCENE_OCTAVES.length)];
    const { preset, snapshot } = createSafeRandomScene(randomTonic, randomOctave);
    droneViewRef.current?.applySnapshot(snapshot);
    setCurrentSessionId(null);
    setCurrentSessionName(DEFAULT_SESSION_NAME);
    setCurrentPresetName(preset.name);
    saveCurrentSessionId(null);
    // Refresh any running sigil visualizer so each RANDOM scene
    // draws its own new AOS-style glyph.
    requestSigilRefresh();
  };

  const buildShareUrlForScene = async (name: string): Promise<string> => {
    const scene = capturePortableScene(name.trim() || "Drone Landscape");
    if (!scene) throw new Error("Could not capture the current scene.");
    return buildSceneShareUrl(scene);
  };

  const displayText = currentSessionId
    ? currentSessionName
    : currentPresetName || currentSessionName || "Random Scene";

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
        displayText={displayText}
        tonic={headerTonic}
        octave={headerOctave}
        onChangeTonic={handleChangeTonic}
        onChangeOctave={handleChangeOctave}
        onToggleHold={handleToggleHold}
        holding={headerHolding}
        onToggleRec={handleToggleRec}
        onOpenShare={() => setShareOpen(true)}
        onRandomScene={handleRandomScene}
        isRec={isRec}
        recTimeMs={recTimeMs}
        recordingSupported={recordingSupport.supported}
        recordingTitle={recordingTitle}
        recordingBusy={recBusy}
        volume={headerVolume}
        onChangeVolume={(v) => {
          setHeaderVolume(v);
          engine?.setMasterVolume(v);
        }}
        midiSupported={midi.supported}
        midiEnabled={midi.enabled}
        midiDevices={midi.devices}
        midiLastNote={midi.lastNote}
        midiError={midi.error}
        onToggleMidi={(on) => midi.setEnabled(on)}
        analyser={engine?.getAnalyser() ?? null}
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
              setCurrentPresetName(presetName ?? "Custom Scene");
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
            visualizer={meditateVisualizer}
            onChangeVisualizer={setMeditateVisualizer}
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
              engine?.setMasterVolume(v);
            }}
          />
        </section>
      </main>

      {shareOpen && (
        <ShareModal
          initialName={currentSessionId ? currentSessionName : (currentPresetName || "Drone Landscape")}
          onBuildUrl={buildShareUrlForScene}
          onClose={() => setShareOpen(false)}
        />
      )}

      <Footer />
    </div>
  );
}
