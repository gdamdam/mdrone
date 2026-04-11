import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { AudioEngine } from "../engine/AudioEngine";
import { PRESETS, createSafeRandomScene, mutateScene, mulberry32 } from "../engine/presets";
import { applyJourneyTick } from "../journey";
import {
  SceneRecorder,
  scheduleMotionReplay,
  MOTION_PARAM_IDS,
  indexToPitchClass,
  type MotionParamId,
} from "../sceneRecorder";
import type { DroneSessionSnapshot } from "../session";

/**
 * Apply a single replayed motion event by reading the current
 * snapshot, patching the changed field, and pushing it back through
 * applySnapshot. Slower than calling the targeted setter directly,
 * but it works without expanding the DroneViewHandle surface and
 * the throttle in SceneRecorder caps the call rate at ~5 Hz/param.
 */
function dispatchMotionEvent(
  handle: { getSnapshot(): DroneSessionSnapshot; applySnapshot(s: DroneSessionSnapshot): void },
  paramId: MotionParamId,
  value: number,
): void {
  const snap = handle.getSnapshot();
  let next: DroneSessionSnapshot | null = null;
  switch (paramId) {
    case MOTION_PARAM_IDS.drift:       next = { ...snap, drift: value };       break;
    case MOTION_PARAM_IDS.air:         next = { ...snap, air: value };         break;
    case MOTION_PARAM_IDS.time:        next = { ...snap, time: value };        break;
    case MOTION_PARAM_IDS.sub:         next = { ...snap, sub: value };         break;
    case MOTION_PARAM_IDS.bloom:       next = { ...snap, bloom: value };       break;
    case MOTION_PARAM_IDS.glide:       next = { ...snap, glide: value };       break;
    case MOTION_PARAM_IDS.climateX:    next = { ...snap, climateX: value };    break;
    case MOTION_PARAM_IDS.climateY:    next = { ...snap, climateY: value };    break;
    case MOTION_PARAM_IDS.octave:      next = { ...snap, octave: value };      break;
    case MOTION_PARAM_IDS.root:        next = { ...snap, root: indexToPitchClass(value) }; break;
    case MOTION_PARAM_IDS.evolve:      next = { ...snap, evolve: value };      break;
    case MOTION_PARAM_IDS.presetMorph: next = { ...snap, presetMorph: value }; break;
    case MOTION_PARAM_IDS.pluckRate:   next = { ...snap, pluckRate: value };   break;
    case MOTION_PARAM_IDS.lfoRate:     next = { ...snap, lfoRate: value };     break;
    case MOTION_PARAM_IDS.lfoAmount:   next = { ...snap, lfoAmount: value };   break;
  }
  if (next) handle.applySnapshot(next);
}
import { generateDroneName, hashSceneSeed } from "./droneNames";
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

const RANDOM_SCENE_TONICS: PitchClass[] = [
  "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
];
/** Library-wide default octave range for random scenes when a preset
 *  doesn't declare its own `octaveRange`. */
const FALLBACK_OCTAVE_RANGE: readonly [number, number] = [2, 3];

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
  // Scene-mutation throttle — drone scenes ramp over hundreds of
  // ms, and overlapping voice rebuilds (RND / cycle-preset /
  // fullscreen-click) trigger audible glitches. A 1500 ms floor
  // matches the typical preset transition budget and is
  // imperceptible as latency at drone pacing. Shared across every
  // entry point that swaps the current scene wholesale.
  const lastSceneMutationTsRef = useRef(0);
  const SCENE_MUTATION_MIN_GAP_MS = 1500;

  // Tick-count for the URL-deterministic evolve loop. Reset whenever
  // the seed changes (RND / MUT / share-URL load) so two visitors
  // opening the same URL walk the same (seed, tick) sequence from 0.
  // See the useEffect below that drives the interval.
  const evolveTickRef = useRef(0);
  const evolveLastSeedRef = useRef<number | null>(null);

  // Motion recorder + replay machinery. The recorder is a long-lived
  // instance the rest of the app reaches via `recordParam`. Replay
  // uses scheduleMotionReplay against droneViewRef setters; the
  // cancel handle is stored in motionReplayCancelRef so a second
  // share-load wipes the prior queue cleanly.
  const recorderRef = useRef<SceneRecorder>(new SceneRecorder());
  const motionReplayCancelRef = useRef<(() => void) | null>(null);
  const [isRecordingMotion, setIsRecordingMotion] = useState(false);
  const recordParam = useCallback((id: MotionParamId, v: number) => {
    recorderRef.current.record(id, v);
  }, []);

  const applyStartupScene = useCallback(() => {
    // Use the same code path as clicking RND so the first scene on load
    // is effectively a random-scene click — same tonic pool, same jitter,
    // same applySnapshot path. Octave comes from the preset's authored
    // range; only fall back if the preset has no range.
    const randomTonic = RANDOM_SCENE_TONICS[Math.floor(Math.random() * RANDOM_SCENE_TONICS.length)];
    const { preset, snapshot } = createSafeRandomScene(randomTonic, FALLBACK_OCTAVE_RANGE);
    // See handleRandomScene — guard against handlePresetNameChange
    // stomping on the generated name when applySnapshot fires the
    // onPresetChange effect.
    ignoreNextPresetNameRef.current = true;
    droneViewRef.current?.applySnapshot(snapshot);
    setCurrentSessionId(null);
    setCurrentSessionName(DEFAULT_SESSION_NAME);
    const generated = generateDroneName(
      preset.group,
      hashSceneSeed(snapshot),
      preset.attribution,
    );
    setCurrentPresetName(generated);
    saveCurrentSessionId(null);
    requestSigilRefresh();
  }, [droneViewRef]);

  const captureCurrentSceneSnapshot = useCallback((name: string): PortableScene | null => {
    const drone = droneViewRef.current?.getSnapshot();
    if (!drone) return null;
    const scene = capturePortableScene(engine, drone, meditateVisualizer, name);
    // Attach the recorded motion (if any) so the share URL carries
    // the performance back out. SceneRecorder.getEvents() returns []
    // when nothing is recorded; only attach when non-empty so legacy
    // shares stay byte-identical.
    const events = recorderRef.current.getEvents();
    if (events.length > 0) scene.motion = events;
    return scene;
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

    // Cancel any previous motion replay (e.g. share-URL load arriving
    // while a Continue Last Scene replay was still in flight).
    motionReplayCancelRef.current?.();
    motionReplayCancelRef.current = null;
    // Reset the recorder so a fresh recording doesn't carry over
    // events from the previous scene.
    recorderRef.current.stop();
    setIsRecordingMotion(false);

    // Schedule motion replay if the loaded scene carries one.
    if (scene.motion && scene.motion.length >= 3) {
      const handle = droneViewRef.current;
      if (handle) {
        motionReplayCancelRef.current = scheduleMotionReplay(
          scene.motion,
          (paramId, value) => dispatchMotionEvent(handle, paramId, value),
        );
      }
    }
  }, [droneViewRef, engine, onMixerSync]);

  useEffect(() => {
    saveMeditateVisualizer(meditateVisualizer);
  }, [meditateVisualizer]);

  useEffect(() => {
    // The ref is checked AFTER the async step so StrictMode's double-
    // mount doesn't leave us in a state where mount 1 got cancelled
    // during await, mount 2 sees the ref already set, and neither one
    // actually applies a scene (which is the bug that made "Continue
    // Last Scene" and "Start New" both fall back to a default drone).
    let cancelled = false;

    const run = async () => {
      const sharedScene = await loadSceneFromCurrentUrlOnce();
      if (cancelled) return;
      if (initSceneRef.current) return;

      if (sharedScene) {
        initSceneRef.current = true;
        applyPortableScene({
          ...sharedScene,
          drone: { ...sharedScene.drone, playing: true },
        });
        return;
      }

      if (startupMode === "continue") {
        const autosaved = loadAutosavedScene();
        if (autosaved) {
          initSceneRef.current = true;
          applyPortableScene(autosaved.scene);
          return;
        }
      }

      if (startupMode === "new") {
        initSceneRef.current = true;
        applyStartupScene();
        return;
      }

      if (!currentSessionId) {
        initSceneRef.current = true;
        applyStartupScene();
        return;
      }

      const session = loadSessions().find((item) => item.id === currentSessionId);
      if (!session) {
        initSceneRef.current = true;
        applyStartupScene();
        return;
      }

      initSceneRef.current = true;
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

    // Fresh session — propose a generated drone name (matched to the
    // current preset's group + attribution, seeded by the scene) as
    // the default. The user can accept, edit, or blank it out.
    const snapshot = droneViewRef.current?.getSnapshot();
    const preset = snapshot?.activePresetId
      ? PRESETS.find((p) => p.id === snapshot.activePresetId)
      : null;
    const defaultName = snapshot && preset
      ? generateDroneName(preset.group, hashSceneSeed(snapshot), preset.attribution)
      : currentSessionName;

    const proposed = window.prompt("Save session as:", defaultName);
    if (!proposed) return;
    storeSession(makeSessionId(), proposed);
  }, [currentSessionId, currentSessionName, droneViewRef, storeSession]);

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

  const previousSceneRef = useRef<{ scene: PortableScene; name: string } | null>(null);

  const handleRandomScene = useCallback(() => {
    // Throttle — discard clicks that arrive inside the min-gap
    // window. Drone presets take hundreds of ms to ramp in and
    // overlapping scene switches glitch the audio. Shared with
    // cycle-preset / fullscreen-click so none of them can
    // overlap each other either.
    const now = Date.now();
    if (now - lastSceneMutationTsRef.current < SCENE_MUTATION_MIN_GAP_MS) return;
    lastSceneMutationTsRef.current = now;
    // Capture the current scene before jumping so "undo" can restore it.
    const beforeName = currentPresetName || currentSessionName || "Previous";
    const beforeScene = captureCurrentSceneSnapshot(beforeName);
    if (beforeScene) {
      previousSceneRef.current = { scene: beforeScene, name: beforeName };
    }

    const randomTonic = RANDOM_SCENE_TONICS[Math.floor(Math.random() * RANDOM_SCENE_TONICS.length)];
    // Mint a fresh PRNG seed and feed a seeded RNG into the scene
    // generator so the resulting snapshot is fully reproducible from
    // its `seed` field (stored in-snapshot and round-tripped in share
    // URLs via normalizeDroneSnapshot).
    const seed = Math.floor(Math.random() * 0x100000000);
    const rng = mulberry32(seed);
    const { preset, snapshot } = createSafeRandomScene(randomTonic, FALLBACK_OCTAVE_RANGE, rng);
    const seeded = { ...snapshot, seed };
    // Suppress the handlePresetNameChange fire that applySnapshot
    // would otherwise trigger — it would overwrite our generated
    // name with preset.name the moment DroneView's onPresetChange
    // callback runs.
    ignoreNextPresetNameRef.current = true;
    droneViewRef.current?.applySnapshot(seeded);
    setCurrentSessionId(null);
    setCurrentSessionName(DEFAULT_SESSION_NAME);
    // RND "shake" swaps the scene label from the plain preset name to
    // a generated drone name matched to the preset's genre group and
    // seeded by the scene state — so the same shake always reads as
    // the same name, and different shakes produce different ones.
    // Preset name is still visible on the preset button itself.
    const generated = generateDroneName(
      preset.group,
      hashSceneSeed(seeded),
      preset.attribution,
    );
    setCurrentPresetName(generated);
    saveCurrentSessionId(null);
    requestSigilRefresh();
  }, [captureCurrentSceneSnapshot, currentPresetName, currentSessionName, droneViewRef]);

  /** Perturb the current scene's numeric parameters by `intensity`
   *  (0..1). Preserves undo by writing to the same previousSceneRef
   *  that handleRandomScene uses, so the ↶ button reverts either. */
  const handleMutateScene = useCallback((intensity: number) => {
    const now = Date.now();
    if (now - lastSceneMutationTsRef.current < SCENE_MUTATION_MIN_GAP_MS) return;
    lastSceneMutationTsRef.current = now;

    const currentSnapshot = droneViewRef.current?.getSnapshot();
    if (!currentSnapshot) return;

    const beforeName = currentPresetName || currentSessionName || "Previous";
    const beforeScene = captureCurrentSceneSnapshot(beforeName);
    if (beforeScene) {
      previousSceneRef.current = { scene: beforeScene, name: beforeName };
    }

    const seed = Math.floor(Math.random() * 0x100000000);
    const rng = mulberry32(seed);
    const mutated = mutateScene(currentSnapshot, intensity, rng);
    droneViewRef.current?.applySnapshot({ ...mutated, seed });
  }, [captureCurrentSceneSnapshot, currentPresetName, currentSessionName, droneViewRef]);

  /** Cycle to the next preset within the current preset's group.
   *  Used by the meditate fullscreen click handler. Shares the
   *  scene-mutation throttle so rapid clicks don't stack voice
   *  rebuilds on top of each other. Falls back to the first preset
   *  of the first group if nothing is currently active. */
  const handleCyclePresetInGroup = useCallback(() => {
    const now = Date.now();
    if (now - lastSceneMutationTsRef.current < SCENE_MUTATION_MIN_GAP_MS) return;
    lastSceneMutationTsRef.current = now;

    const currentId = droneViewRef.current?.getSnapshot().activePresetId ?? null;
    const currentPreset = currentId
      ? PRESETS.find((pr) => pr.id === currentId) ?? null
      : null;
    const group = currentPreset?.group ?? PRESETS[0]?.group;
    if (!group) return;
    const groupPresets = PRESETS.filter((pr) => pr.group === group);
    if (groupPresets.length === 0) return;
    const currentIdx = currentPreset
      ? groupPresets.findIndex((pr) => pr.id === currentPreset.id)
      : -1;
    const nextPreset = groupPresets[(currentIdx + 1) % groupPresets.length];
    droneViewRef.current?.applyPresetById(nextPreset.id);
  }, [droneViewRef]);

  /** Toggle motion recording on/off. Starting clears any prior
   *  recording; stopping leaves the events in the recorder so the
   *  next share-URL build picks them up via captureCurrentScene. */
  const handleToggleMotionRecord = useCallback(() => {
    if (recorderRef.current.isRecording()) {
      recorderRef.current.stop();
      setIsRecordingMotion(false);
    } else {
      recorderRef.current.start();
      setIsRecordingMotion(true);
    }
  }, []);

  /** Restore whatever was playing before the last RND click. No-op if
   *  no previous scene is stored (fresh load, or already undone once). */
  const handleUndoScene = useCallback(() => {
    const prev = previousSceneRef.current;
    if (!prev) return;
    previousSceneRef.current = null;
    applyPortableScene(prev.scene);
  }, [applyPortableScene]);

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
    // Only update if we got a real preset name. Null fires (initial
    // mount, intermediate states) used to overwrite with "Custom Scene"
    // which clobbered restored scene names and made Continue Last Scene
    // look broken.
    if (presetName) setCurrentPresetName(presetName);
  }, []);

  // URL-deterministic evolve loop. When the current scene is playing
  // and either `evolve > 0` or a `journey` is set, the loop steps the
  // scene on a fixed cadence:
  //
  // - if `journey` is set: deterministic walk through authored
  //   arrival → bloom → suspension → dissolve phases (src/journey.ts).
  //   Tick is reset whenever the seed changes (RND / MUT / share-URL
  //   load) so two visitors with the same URL hear the same journey
  //   from phase 0.
  // - else if `evolve > 0`: PRNG-perturbed mutate step seeded from
  //   (scene.seed + tick × golden ratio), same URL ⇒ same drift.
  useEffect(() => {
    const INTERVAL_MS = 4000;
    const id = window.setInterval(() => {
      const snap = droneViewRef.current?.getSnapshot();
      if (!snap) return;
      if (evolveLastSeedRef.current !== snap.seed) {
        evolveTickRef.current = 0;
        evolveLastSeedRef.current = snap.seed;
      }
      if (!snap.playing) return;
      evolveTickRef.current += 1;
      let next: typeof snap;
      if (snap.journey) {
        // Journey takes precedence over the random evolve perturbation.
        next = applyJourneyTick(snap, snap.journey, evolveTickRef.current);
      } else if (snap.evolve > 0) {
        const mixed = (snap.seed + evolveTickRef.current * 0x9E3779B1) >>> 0;
        const rng = mulberry32(mixed);
        const amt = snap.evolve * 0.15;
        next = mutateScene(snap, amt, rng);
      } else {
        return;
      }
      // Preserve the original seed so the (seed, tick+1) chain
      // continues to derive from the same origin.
      droneViewRef.current?.applySnapshot({ ...next, seed: snap.seed });
    }, INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [droneViewRef]);

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
    handleMutateScene,
    handleToggleMotionRecord,
    isRecordingMotion,
    recordParam,
    handleCyclePresetInGroup,
    handleUndoScene,
    buildShareSceneData,
    handlePresetNameChange,
  };
}
