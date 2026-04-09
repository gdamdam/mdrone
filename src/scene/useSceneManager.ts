import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { AudioEngine } from "../engine/AudioEngine";
import { PRESETS, SAFE_RANDOM_PRESET_IDS, createSafeRandomScene } from "../engine/presets";
import { loadMeditateVisualizer, saveMeditateVisualizer } from "../meditateState";
import { buildSceneShareUrl, loadSceneFromCurrentUrlOnce } from "../shareCodec";
import { applyPalette, getPaletteById, loadPaletteId, savePaletteId } from "../themes";
import {
  loadAutosavedScene,
  loadCurrentSessionId,
  loadSessions,
  makeSessionId,
  saveAutosavedScene,
  saveCurrentSessionId,
  saveSessions,
  type PortableScene,
  type SavedSession,
} from "../session";
import { requestSigilRefresh, type Visualizer } from "../components/visualizers";
import type { PitchClass } from "../types";
import type { DroneViewHandle } from "../components/DroneView";
import { applyFxSnapshot, applyMixerSnapshot, capturePortableScene } from "./sceneSnapshots";

export interface ShareSceneBuildResult {
  scene: PortableScene;
  url: string;
}

export const DEFAULT_SESSION_NAME = "Untitled Session";

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

interface UseSceneManagerArgs {
  engine: AudioEngine;
  droneViewRef: RefObject<DroneViewHandle | null>;
  onMixerSync: () => void;
  startupMode: "continue" | "new";
}

export function useSceneManager({
  engine,
  droneViewRef,
  onMixerSync,
  startupMode,
}: UseSceneManagerArgs) {
  const [savedSessions, setSavedSessions] = useState<SavedSession[]>(loadSessions);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(() => loadCurrentSessionId());
  const [currentSessionName, setCurrentSessionName] = useState(DEFAULT_SESSION_NAME);
  const [currentPresetName, setCurrentPresetName] = useState<string>("Random Scene");
  const [meditateVisualizer, setMeditateVisualizer] = useState<Visualizer>(() => loadMeditateVisualizer());
  const initSceneRef = useRef(false);
  const ignoreNextPresetNameRef = useRef(false);

  const applyStartupScene = useCallback(() => {
    const randomPreset = pickStartupPreset();
    const randomTonic = STARTUP_TONICS[Math.floor(Math.random() * STARTUP_TONICS.length)];
    droneViewRef.current?.startImmediate(randomTonic, STARTUP_OCTAVE, randomPreset.id);
    setCurrentPresetName(randomPreset.name);
    setCurrentSessionId(null);
    setCurrentSessionName(DEFAULT_SESSION_NAME);
    saveCurrentSessionId(null);
  }, [droneViewRef]);

  const captureCurrentSceneSnapshot = useCallback((name: string): PortableScene | null => {
    const drone = droneViewRef.current?.getSnapshot();
    if (!drone) return null;
    return capturePortableScene(engine, drone, meditateVisualizer, name);
  }, [droneViewRef, engine, meditateVisualizer]);

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
    ignoreNextPresetNameRef.current = true;
    droneViewRef.current?.applySnapshot(scene.drone);
    applyMixerSnapshot(engine, scene.mixer);
    applyFxSnapshot(engine, scene.fx);
    onMixerSync();
    setCurrentSessionId(options?.sessionId ?? null);
    setCurrentSessionName(scene.name);
    setCurrentPresetName(scene.name);
    saveCurrentSessionId(options?.sessionId ?? null);
  }, [droneViewRef, engine, onMixerSync]);

  useEffect(() => {
    saveMeditateVisualizer(meditateVisualizer);
  }, [meditateVisualizer]);

  useEffect(() => {
    if (initSceneRef.current) return;
    initSceneRef.current = true;
    let cancelled = false;

    const run = async () => {
      const sharedScene = await loadSceneFromCurrentUrlOnce();
      if (cancelled) return;
      if (sharedScene) {
        applyPortableScene({
          ...sharedScene,
          drone: { ...sharedScene.drone, playing: true },
        });
        return;
      }

      if (startupMode === "continue") {
        const autosaved = loadAutosavedScene();
        if (autosaved) {
          applyPortableScene(autosaved.scene);
          return;
        }
      }

      if (startupMode === "new") {
        applyStartupScene();
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
  }, [applyPortableScene, applyStartupScene, currentSessionId, startupMode]);

  useEffect(() => {
    const doAutoSave = () => {
      const name = currentSessionId
        ? currentSessionName
        : (currentPresetName || currentSessionName || "Last Scene");
      const scene = captureCurrentSceneSnapshot(name);
      if (!scene) return;
      saveAutosavedScene(scene);
    };

    const id = window.setInterval(doAutoSave, 3000);
    const onHide = () => {
      if (document.visibilityState === "hidden") doAutoSave();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onHide);
      doAutoSave();
    };
  }, [captureCurrentSceneSnapshot, currentPresetName, currentSessionId, currentSessionName]);

  const persistSessions = useCallback((sessions: SavedSession[]) => {
    setSavedSessions(sessions);
    saveSessions(sessions);
  }, []);

  const captureCurrentScene = useCallback((name: string): PortableScene | null => {
    const scene = captureCurrentSceneSnapshot(name);
    if (!scene) {
      window.alert("mdrone could not read the current drone state yet. Try again in a moment.");
      return null;
    }
    return scene;
  }, [captureCurrentSceneSnapshot]);

  const captureSession = useCallback((id: string, name: string): SavedSession | null => {
    const scene = captureCurrentScene(name);
    if (!scene) return null;
    return {
      id,
      name,
      savedAt: new Date().toISOString(),
      version: 2,
      scene,
    };
  }, [captureCurrentScene]);

  const storeSession = useCallback((id: string, name: string) => {
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
  }, [captureSession, persistSessions, savedSessions]);

  const handleSaveSession = useCallback(() => {
    if (currentSessionId) {
      storeSession(currentSessionId, currentSessionName);
      return;
    }

    const proposed = window.prompt("Save session as:", currentSessionName);
    if (!proposed) return;
    storeSession(makeSessionId(), proposed);
  }, [currentSessionId, currentSessionName, storeSession]);

  const handleRenameSession = useCallback(() => {
    const proposed = window.prompt("Rename session:", currentSessionName);
    if (!proposed) return;
    const cleanName = proposed.trim();
    if (!cleanName) return;

    if (!currentSessionId) {
      storeSession(makeSessionId(), cleanName);
      return;
    }

    storeSession(currentSessionId, cleanName);
  }, [currentSessionId, currentSessionName, storeSession]);

  const handleLoadSession = useCallback((id: string) => {
    const session = savedSessions.find((item) => item.id === id);
    if (!session) return;
    applyPortableScene(session.scene, { sessionId: session.id });
  }, [applyPortableScene, savedSessions]);

  const handleRandomScene = useCallback(() => {
    const randomTonic = RANDOM_SCENE_TONICS[Math.floor(Math.random() * RANDOM_SCENE_TONICS.length)];
    const randomOctave =
      RANDOM_SCENE_OCTAVES[Math.floor(Math.random() * RANDOM_SCENE_OCTAVES.length)];
    const { preset, snapshot } = createSafeRandomScene(randomTonic, randomOctave);
    droneViewRef.current?.applySnapshot(snapshot);
    setCurrentSessionId(null);
    setCurrentSessionName(DEFAULT_SESSION_NAME);
    setCurrentPresetName(preset.name);
    saveCurrentSessionId(null);
    requestSigilRefresh();
  }, [droneViewRef]);

  const buildShareSceneData = useCallback(async (name: string): Promise<ShareSceneBuildResult> => {
    const scene = captureCurrentScene(name.trim() || "Drone Landscape");
    if (!scene) throw new Error("Could not capture the current scene.");
    return {
      scene,
      url: await buildSceneShareUrl(scene),
    };
  }, [captureCurrentScene]);

  const handlePresetNameChange = useCallback((presetName: string | null) => {
    if (ignoreNextPresetNameRef.current) {
      ignoreNextPresetNameRef.current = false;
      return;
    }
    setCurrentPresetName(presetName ?? "Custom Scene");
  }, []);

  const displayText = currentSessionId
    ? currentSessionName
    : currentPresetName || currentSessionName || "Random Scene";

  const shareInitialName = currentSessionId
    ? currentSessionName
    : (currentPresetName || "Drone Landscape");

  return {
    savedSessions,
    currentSessionId,
    currentSessionName,
    meditateVisualizer,
    setMeditateVisualizer,
    displayText,
    shareInitialName,
    handleSaveSession,
    handleRenameSession,
    handleLoadSession,
    handleRandomScene,
    buildShareSceneData,
    handlePresetNameChange,
  };
}
