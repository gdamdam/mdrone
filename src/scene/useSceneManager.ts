import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { AudioEngine } from "../engine/AudioEngine";
import { showNotification } from "../notifications";
import { trackEvent } from "../analytics";
import { PRESETS, createArrivalScene, createSafeRandomScene, createWelcomeScene, mutateScene, mulberry32 } from "../engine/presets";
import { applyJourneyTick } from "../journey";
import {
  SceneRecorder,
  scheduleMotionReplay,
  MOTION_PARAM_IDS,
  indexToPitchClass,
  type MotionParamId,
} from "../sceneRecorder";
import type { DroneSessionSnapshot } from "../session";
import type { DroneLivePatch } from "./useDroneScene";

/**
 * Build the lightweight live-update delta between two snapshots.
 * This powers journey/evolve ticks so macro drift doesn't keep
 * reapplying the whole drone scene underneath a held note.
 */
function buildLivePatch(
  prev: DroneSessionSnapshot,
  next: DroneSessionSnapshot,
): DroneLivePatch {
  const patch: DroneLivePatch = {};
  if (prev.root !== next.root) patch.root = next.root;
  if (prev.octave !== next.octave) patch.octave = next.octave;
  if (prev.voiceLevels !== next.voiceLevels) patch.voiceLevels = next.voiceLevels;
  if (prev.drift !== next.drift) patch.drift = next.drift;
  if (prev.air !== next.air) patch.air = next.air;
  if (prev.time !== next.time) patch.time = next.time;
  if (prev.sub !== next.sub) patch.sub = next.sub;
  if (prev.bloom !== next.bloom) patch.bloom = next.bloom;
  if (prev.glide !== next.glide) patch.glide = next.glide;
  if (prev.climateX !== next.climateX) patch.climateX = next.climateX;
  if (prev.climateY !== next.climateY) patch.climateY = next.climateY;
  if (prev.lfoRate !== next.lfoRate) patch.lfoRate = next.lfoRate;
  if (prev.lfoAmount !== next.lfoAmount) patch.lfoAmount = next.lfoAmount;
  if (prev.presetMorph !== next.presetMorph) patch.presetMorph = next.presetMorph;
  if (prev.evolve !== next.evolve) patch.evolve = next.evolve;
  if (prev.pluckRate !== next.pluckRate) patch.pluckRate = next.pluckRate;
  return patch;
}

function dispatchMotionEvent(
  handle: { applyLivePatch(patch: DroneLivePatch): void },
  paramId: MotionParamId,
  value: number,
): void {
  let patch: DroneLivePatch | null = null;
  switch (paramId) {
    case MOTION_PARAM_IDS.drift:       patch = { drift: value }; break;
    case MOTION_PARAM_IDS.air:         patch = { air: value }; break;
    case MOTION_PARAM_IDS.time:        patch = { time: value }; break;
    case MOTION_PARAM_IDS.sub:         patch = { sub: value }; break;
    case MOTION_PARAM_IDS.bloom:       patch = { bloom: value }; break;
    case MOTION_PARAM_IDS.glide:       patch = { glide: value }; break;
    case MOTION_PARAM_IDS.climateX:    patch = { climateX: value }; break;
    case MOTION_PARAM_IDS.climateY:    patch = { climateY: value }; break;
    case MOTION_PARAM_IDS.octave:      patch = { octave: value }; break;
    case MOTION_PARAM_IDS.root:        patch = { root: indexToPitchClass(value) }; break;
    case MOTION_PARAM_IDS.evolve:      patch = { evolve: value }; break;
    case MOTION_PARAM_IDS.presetMorph: patch = { presetMorph: value }; break;
    case MOTION_PARAM_IDS.pluckRate:   patch = { pluckRate: value }; break;
    case MOTION_PARAM_IDS.lfoRate:     patch = { lfoRate: value }; break;
    case MOTION_PARAM_IDS.lfoAmount:   patch = { lfoAmount: value }; break;
  }
  if (patch) handle.applyLivePatch(patch);
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
import { type Visualizer } from "../components/visualizers";
import type { PitchClass } from "../types";
import type { DroneViewHandle } from "../components/DroneView";
import { applyFxSnapshot, applyMixerSnapshot, capturePortableScene } from "./sceneSnapshots";
import { saveCustomTuningAtId } from "../microtuning";

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
  // RND call counter (per-session). First ARRIVAL_RND_COUNT calls pull
  // from the arrival-quality pool so the session opens with strong
  // first impressions; subsequent calls fall through to the broader
  // safe-random pool for full library variety.
  const rndCallCountRef = useRef(0);
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
    // Any user-originated gesture that records motion also cancels an
    // in-flight motion replay — the user has taken over.
    if (motionReplayCancelRef.current) {
      motionReplayCancelRef.current();
      motionReplayCancelRef.current = null;
    }
    recorderRef.current.record(id, v);
  }, []);

  const applyStartupScene = useCallback(() => {
    // First-ever launch (no prior autosave) → deterministic Welcome
    // preset. Every subsequent Start New pulls from the curated
    // arrival pool with a random tonic. The autosave check mirrors
    // the one weatherIntro uses, so the Welcome scene and WEATHER
    // guidance appear together on the exact same session.
    const isFirstLaunch = (() => {
      try { return !localStorage.getItem("mdrone-autosave"); } catch { return false; }
    })();
    const randomTonic = RANDOM_SCENE_TONICS[Math.floor(Math.random() * RANDOM_SCENE_TONICS.length)];
    const { preset, snapshot } = isFirstLaunch
      ? createWelcomeScene(FALLBACK_OCTAVE_RANGE)
      : createArrivalScene(randomTonic, FALLBACK_OCTAVE_RANGE);
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
    // If the scene travels with a custom tuning, upsert it into the
    // local registry at the EXPLICIT id BEFORE applying drone state
    // so the tuning is resolvable when the engine reads drone.tuningId.
    // Uses saveCustomTuningAtId (not saveCustomTuning) because the
    // label's slug may not match the bundled id — authored tunings
    // routinely have mismatched slugs (id "custom:31-tet" / label
    // "31-TET (Huygens)").
    if (scene.customTuning) {
      const ct = scene.customTuning;
      saveCustomTuningAtId(ct.id, ct.label, ct.degrees);
    }
    setMeditateVisualizer(scene.ui.visualizer);
    ignoreNextPresetNameRef.current = true;
    droneViewRef.current?.applySnapshot(scene.drone);
    applyMixerSnapshot(engine, scene.mixer);
    applyFxSnapshot(engine, scene.fx);
    // FX chain order lives in DroneView state (hydrated from
    // localStorage) which pushes to the engine on every render, so
    // applying order directly on the engine would be overwritten on
    // the next frame. Route through DroneView so React state,
    // localStorage, and engine all agree.
    if (scene.fx.order) droneViewRef.current?.applyEffectOrder(scene.fx.order);
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

  const lastAutoSavedSerializedRef = useRef<string>("");
  useEffect(() => {
    const doAutoSave = (force = false) => {
      const name = currentSessionId
        ? currentSessionName
        : (currentPresetName || currentSessionName || "Last Scene");
      const scene = captureCurrentSceneSnapshot(name);
      if (!scene) return;
      // Dirty-check: serialize once, skip the localStorage write when
      // nothing changed since the last save. localStorage.setItem is
      // synchronous and blocks the main thread, so in a long idle
      // session this eliminates ~every 3 s of needless jitter.
      const serialized = JSON.stringify(scene);
      if (!force && serialized === lastAutoSavedSerializedRef.current) return;
      lastAutoSavedSerializedRef.current = serialized;
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
      // Final flush on unmount — force in case the effect is tearing
      // down with pending changes that never made it through the
      // dirty-check window.
      doAutoSave(true);
    };
  }, [captureCurrentSceneSnapshot, currentPresetName, currentSessionId, currentSessionName]);

  const persistSessions = useCallback((sessions: SavedSession[]) => {
    setSavedSessions(sessions);
    saveSessions(sessions);
  }, []);

  const captureCurrentScene = useCallback((name: string): PortableScene | null => {
    const scene = captureCurrentSceneSnapshot(name);
    if (!scene) {
      showNotification("Couldn't read the drone state yet — try again in a moment.", "warning");
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

  const handleSaveSession = useCallback((name: string) => {
    trackEvent("session/saved");
    if (currentSessionId) {
      // Existing session — overwrite with current state.
      storeSession(currentSessionId, currentSessionName);
      return;
    }
    storeSession(makeSessionId(), name);
  }, [currentSessionId, currentSessionName, storeSession]);

  /** Default name for a new save — generated from current preset/scene. */
  const getDefaultSessionName = useCallback(() => {
    const snapshot = droneViewRef.current?.getSnapshot();
    const preset = snapshot?.activePresetId
      ? PRESETS.find((p) => p.id === snapshot.activePresetId)
      : null;
    return snapshot && preset
      ? generateDroneName(preset.group, hashSceneSeed(snapshot), preset.attribution)
      : currentSessionName;
  }, [currentSessionName, droneViewRef]);

  const handleRenameSession = useCallback((name: string) => {
    const cleanName = name.trim();
    if (!cleanName) return;

    if (!currentSessionId) {
      storeSession(makeSessionId(), cleanName);
      return;
    }

    storeSession(currentSessionId, cleanName);
  }, [currentSessionId, storeSession]);

  const handleLoadSession = useCallback((id: string) => {
    const session = savedSessions.find((item) => item.id === id);
    if (!session) return;
    applyPortableScene(session.scene, { sessionId: session.id });
  }, [applyPortableScene, savedSessions]);

  const handleRandomScene = useCallback(() => {
    // Throttle — discard clicks that arrive inside the min-gap
    // window. Drone presets take hundreds of ms to ramp in and
    // overlapping scene switches glitch the audio. Shared with
    // cycle-preset / fullscreen-click so none of them can
    // overlap each other either.
    const now = Date.now();
    if (now - lastSceneMutationTsRef.current < SCENE_MUTATION_MIN_GAP_MS) return;
    lastSceneMutationTsRef.current = now;

    const randomTonic = RANDOM_SCENE_TONICS[Math.floor(Math.random() * RANDOM_SCENE_TONICS.length)];
    // Mint a fresh PRNG seed and feed a seeded RNG into the scene
    // generator so the resulting snapshot is fully reproducible from
    // its `seed` field (stored in-snapshot and round-tripped in share
    // URLs via normalizeDroneSnapshot).
    const seed = Math.floor(Math.random() * 0x100000000);
    const rng = mulberry32(seed);
    // First 3 RND clicks of the session draw from the arrival pool
    // (beautiful in 3s at default tonic/octave). Count increments on
    // EVERY RND, so once past the threshold the user reaches the full
    // library variety via createSafeRandomScene.
    const ARRIVAL_RND_COUNT = 3;
    const useArrival = rndCallCountRef.current < ARRIVAL_RND_COUNT;
    rndCallCountRef.current += 1;
    const { preset, snapshot } = useArrival
      ? createArrivalScene(randomTonic, FALLBACK_OCTAVE_RANGE, rng)
      : createSafeRandomScene(randomTonic, FALLBACK_OCTAVE_RANGE, rng);
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
  }, [droneViewRef]);

  /** Perturb the current scene's numeric parameters by `intensity`
   *  (0..1). The full scene-history stack in DroneView captures the
   *  pre-mutate state on its debounced push, so Cmd/Ctrl+Z or the
   *  SHAPE undo button restores it. */
  const handleMutateScene = useCallback((intensity: number) => {
    const now = Date.now();
    if (now - lastSceneMutationTsRef.current < SCENE_MUTATION_MIN_GAP_MS) return;
    lastSceneMutationTsRef.current = now;

    const currentSnapshot = droneViewRef.current?.getSnapshot();
    if (!currentSnapshot) return;

    const seed = Math.floor(Math.random() * 0x100000000);
    const rng = mulberry32(seed);
    const mutated = mutateScene(currentSnapshot, intensity, rng);
    droneViewRef.current?.applySnapshot({ ...mutated, seed });
  }, [droneViewRef]);

  /** Cycle to the next preset within the current preset's group.
   *  Used by the meditate fullscreen click handler. Shares the
   *  scene-mutation throttle so rapid clicks don't stack voice
   *  rebuilds on top of each other. Falls back to the first preset
   *  of the first group if nothing is currently active. */
  const handleCyclePresetAll = useCallback((direction: 1 | -1 = 1) => {
    const now = Date.now();
    if (now - lastSceneMutationTsRef.current < SCENE_MUTATION_MIN_GAP_MS) return;
    lastSceneMutationTsRef.current = now;
    // Skip hidden presets (Welcome etc.) — they're applicable by id
    // but not reachable via user-facing navigation.
    const visible = PRESETS.filter((pr) => !pr.hidden);
    if (visible.length === 0) return;
    const currentId = droneViewRef.current?.getSnapshot().activePresetId ?? null;
    const currentIdx = currentId ? visible.findIndex((pr) => pr.id === currentId) : -1;
    const nextIdx = (currentIdx + direction + visible.length) % visible.length;
    droneViewRef.current?.applyPresetById(visible[nextIdx].id);
  }, [droneViewRef]);

  const handleCyclePresetInGroup = useCallback((direction: 1 | -1 = 1) => {
    const now = Date.now();
    if (now - lastSceneMutationTsRef.current < SCENE_MUTATION_MIN_GAP_MS) return;
    lastSceneMutationTsRef.current = now;

    const currentId = droneViewRef.current?.getSnapshot().activePresetId ?? null;
    const currentPreset = currentId
      ? PRESETS.find((pr) => pr.id === currentId) ?? null
      : null;
    const group = currentPreset?.group ?? PRESETS[0]?.group;
    if (!group) return;
    const groupPresets = PRESETS.filter((pr) => pr.group === group && !pr.hidden);
    if (groupPresets.length === 0) return;
    const currentIdx = currentPreset
      ? groupPresets.findIndex((pr) => pr.id === currentPreset.id)
      : -1;
    const nextIdx = (currentIdx + direction + groupPresets.length) % groupPresets.length;
    const nextPreset = groupPresets[nextIdx];
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
      droneViewRef.current?.applyLivePatch(buildLivePatch(snap, next));
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
    getDefaultSessionName,
    handleLoadSession,
    handleRandomScene,
    handleMutateScene,
    handleToggleMotionRecord,
    isRecordingMotion,
    recordParam,
    handleCyclePresetAll,
    handleCyclePresetInGroup,
    buildShareSceneData,
    handlePresetNameChange,
  };
}
