import { useCallback, useEffect, useReducer, useRef } from "react";
import type { AudioEngine, EngineSceneMutation } from "../engine/AudioEngine";
import { ALL_VOICE_TYPES, type VoiceType } from "../engine/VoiceBuilder";
import type { EffectId } from "../engine/FxChain";
import { PRESETS, applyPreset, getPresetMaterialProfile } from "../engine/presets";
import type { DroneSessionSnapshot } from "../session";
import type { PitchClass } from "../types";
import type { RelationId, TuningId } from "../types";
import {
  createInitialDroneScene,
  freqToPitch,
  liveDroneSceneReducer,
  pitchToFreq,
  resolveIntervals,
  type LiveDroneSceneState,
} from "./droneSceneModel";

interface UseDroneSceneArgs {
  engine: AudioEngine | null;
  onTransportChange?: (playing: boolean) => void;
  onTonicChange?: (root: PitchClass, octave: number) => void;
  onPresetChange?: (presetId: string | null, presetName: string | null) => void;
}

export function useDroneScene({
  engine,
  onTransportChange,
  onTonicChange,
  onPresetChange,
}: UseDroneSceneArgs) {
  const [state, dispatch] = useReducer(liveDroneSceneReducer, engine, createInitialDroneScene);

  const setActivePresetId = useCallback((presetId: string | null) => {
    dispatch({ type: "merge", patch: { activePresetId: presetId } });
  }, []);

  const setRoot = useCallback((root: PitchClass) => {
    dispatch({ type: "setRoot", root });
  }, []);

  const setOctave = useCallback((octave: number) => {
    dispatch({ type: "setOctave", octave });
  }, []);

  const setScale = useCallback((scale: LiveDroneSceneState["scale"]) => {
    dispatch({ type: "setScale", scale });
  }, []);

  const setTuning = useCallback((tuningId: TuningId | null) => {
    dispatch({ type: "setTuning", tuningId });
  }, []);

  const setRelation = useCallback((relationId: RelationId | null) => {
    dispatch({ type: "setRelation", relationId });
  }, []);

  const setPlaying = useCallback((playing: boolean) => {
    dispatch({ type: "setPlaying", playing });
  }, []);

  const setVoiceLayers = useCallback((voiceLayers: LiveDroneSceneState["voiceLayers"]) => {
    dispatch({ type: "merge", patch: { voiceLayers } });
  }, []);

  const setVoiceLevels = useCallback((voiceLevels: LiveDroneSceneState["voiceLevels"]) => {
    dispatch({ type: "merge", patch: { voiceLevels } });
  }, []);

  const setDriftState = useCallback((drift: number) => {
    dispatch({ type: "merge", patch: { drift } });
  }, []);

  const setAirState = useCallback((air: number) => {
    dispatch({ type: "merge", patch: { air } });
  }, []);

  const setTimeState = useCallback((time: number) => {
    dispatch({ type: "merge", patch: { time } });
  }, []);

  const setSubState = useCallback((sub: number) => {
    dispatch({ type: "merge", patch: { sub } });
  }, []);

  const setBloomState = useCallback((bloom: number) => {
    dispatch({ type: "merge", patch: { bloom } });
  }, []);

  const setGlideState = useCallback((glide: number) => {
    dispatch({ type: "merge", patch: { glide } });
  }, []);

  const setClimate = useCallback((x: number, y: number) => {
    dispatch({ type: "setClimate", x, y });
    engine?.setClimateX(x);
    engine?.setClimateY(y);
  }, [engine]);

  const setLfoShapeState = useCallback((lfoShape: OscillatorType) => {
    dispatch({ type: "merge", patch: { lfoShape } });
  }, []);

  const setLfoRateState = useCallback((lfoRate: number) => {
    dispatch({ type: "merge", patch: { lfoRate } });
  }, []);

  const setLfoAmountState = useCallback((lfoAmount: number) => {
    dispatch({ type: "merge", patch: { lfoAmount } });
  }, []);

  const setPresetMorph = useCallback((presetMorph: number) => {
    dispatch({ type: "merge", patch: { presetMorph } });
  }, []);

  const setPresetEvolve = useCallback((evolve: number) => {
    dispatch({ type: "merge", patch: { evolve } });
  }, []);

  const setPluckRate = useCallback((pluckRate: number) => {
    dispatch({ type: "merge", patch: { pluckRate } });
  }, []);

  const setPresetTrim = useCallback((presetTrim: number) => {
    dispatch({ type: "merge", patch: { presetTrim } });
  }, []);

  const setEffectEnabled = useCallback((id: EffectId, on: boolean) => {
    dispatch({ type: "setEffect", effectId: id, on });
    engine?.setEffect(id, on);
  }, [engine]);

  const toggleEffect = useCallback((id: EffectId) => {
    const next = !state.effects[id];
    dispatch({ type: "setEffect", effectId: id, on: next });
    engine?.setEffect(id, next);
  }, [engine, state.effects]);

  const toggleVoiceLayer = useCallback((type: VoiceType) => {
    const next = !state.voiceLayers[type];
    dispatch({ type: "setVoiceLayer", voiceType: type, on: next });
    engine?.setVoiceLayer(type, next);
  }, [engine, state.voiceLayers]);

  const setVoiceLevel = useCallback((type: VoiceType, level: number) => {
    dispatch({ type: "setVoiceLevel", voiceType: type, level });
    engine?.setVoiceLevel(type, level);
  }, [engine]);

  const setDrift = useCallback((drift: number) => {
    setDriftState(drift);
    engine?.setDrift(drift);
  }, [engine, setDriftState]);

  const setAir = useCallback((air: number) => {
    setAirState(air);
    engine?.setAir(air);
  }, [engine, setAirState]);

  const setTime = useCallback((time: number) => {
    setTimeState(time);
    engine?.setTime(time);
  }, [engine, setTimeState]);

  const setSub = useCallback((sub: number) => {
    setSubState(sub);
    engine?.setSub(sub);
  }, [engine, setSubState]);

  const setBloom = useCallback((bloom: number) => {
    setBloomState(bloom);
    engine?.setBloom(bloom);
  }, [engine, setBloomState]);

  const setGlide = useCallback((glide: number) => {
    setGlideState(glide);
    engine?.setGlide(glide);
  }, [engine, setGlideState]);

  const setLfoShape = useCallback((lfoShape: OscillatorType) => {
    setLfoShapeState(lfoShape);
    engine?.setLfoShape(lfoShape);
  }, [engine, setLfoShapeState]);

  const setLfoRate = useCallback((lfoRate: number) => {
    setLfoRateState(lfoRate);
    engine?.setLfoRate(lfoRate);
  }, [engine, setLfoRateState]);

  const setLfoAmount = useCallback((lfoAmount: number) => {
    setLfoAmountState(lfoAmount);
    engine?.setLfoAmount(lfoAmount);
  }, [engine, setLfoAmountState]);

  // When the engine first becomes available, push current scene state down.
  useEffect(() => {
    if (!engine) return;
    const preset = state.activePresetId
      ? PRESETS.find((item) => item.id === state.activePresetId) ?? null
      : null;
    engine.setPresetMotionProfile(preset?.motionProfile ?? null);
    engine.setPresetMaterialProfile(getPresetMaterialProfile(preset));
    engine.setDrift(state.drift);
    engine.setAir(state.air);
    engine.setTime(state.time);
    engine.setSub(state.sub);
    engine.setBloom(state.bloom);
    engine.setGlide(state.glide);
    engine.setClimateX(state.climateX);
    engine.setClimateY(state.climateY);
    engine.setLfoShape(state.lfoShape);
    engine.setLfoRate(state.lfoRate);
    engine.setLfoAmount(state.lfoAmount);
    engine.setPresetMorph(state.presetMorph);
    engine.setEvolve(state.evolve);
    engine.setTanpuraPluckRate(state.pluckRate);
    engine.setPresetTrim(state.presetTrim);
    for (const t of ALL_VOICE_TYPES) {
      engine.setVoiceLayer(t, state.voiceLayers[t]);
      engine.setVoiceLevel(t, state.voiceLevels[t]);
    }
  }, [engine, state]);

  const freq = pitchToFreq(state.root, state.octave);

  useEffect(() => {
    if (!engine || !state.playing) return;
    engine.setDroneFreq(freq);
  }, [engine, state.playing, freq]);

  // Auto-start: fires once when the engine first becomes available and
  // the scene wants to be playing. Delayed briefly so the parent scene
  // manager has a chance to call applySnapshot first (for Continue Last
  // Scene / shared-link loads). If applySnapshot runs before the timer
  // fires, its engine.startDrone call + didAutostartRef set will
  // pre-empt us so we don't double-start.
  // Derived intervals — depends only on scale + microtuning fields.
  const { scale, tuningId, relationId } = state;
  const intervals = resolveIntervals({ scale, tuningId, relationId });

  const didAutostartRef = useRef(false);
  useEffect(() => {
    if (!engine || didAutostartRef.current) return;
    if (!state.playing) return;
    const timer = window.setTimeout(() => {
      if (didAutostartRef.current) return;
      engine.startDrone(freq, intervals);
      didAutostartRef.current = true;
    }, 60);
    return () => window.clearTimeout(timer);
  }, [engine, state.playing, freq, intervals]);

  useEffect(() => {
    if (!engine) return;
    engine.setIntervals(intervals);
  }, [engine, intervals]);

  const togglePlay = useCallback(() => {
    if (!engine) return;
    if (state.playing) {
      engine.stopDrone();
      setPlaying(false);
    } else {
      engine.startDrone(freq, intervals);
      setPlaying(true);
    }
  }, [engine, freq, setPlaying, state.playing, intervals]);

  const handlePreset = useCallback((presetId: string) => {
    const preset = PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    setActivePresetId(presetId);
    setPresetTrim(preset.gain ?? 1);
    applyPreset(engine, preset, {
      setVoiceLayers,
      setVoiceLevels,
      setDrift,
      setAir,
      setTime,
      setSub,
      setBloom,
      setGlide,
      setLfoShape,
      setLfoRate,
      setLfoAmount,
      setClimate,
      setScale,
      setTuning,
      setRelation,
      setEffectEnabled,
    });
  }, [
    engine,
    setActivePresetId,
    setPresetTrim,
    setVoiceLayers,
    setVoiceLevels,
    setDrift,
    setAir,
    setTime,
    setSub,
    setBloom,
    setGlide,
    setLfoShape,
    setLfoRate,
    setLfoAmount,
    setClimate,
    setScale,
    setTuning,
    setRelation,
    setEffectEnabled,
  ]);

  useEffect(() => {
    const preset = state.activePresetId
      ? PRESETS.find((p) => p.id === state.activePresetId) ?? null
      : null;
    onPresetChange?.(state.activePresetId, preset?.name ?? null);
  }, [onPresetChange, state.activePresetId]);

  useEffect(() => {
    onTransportChange?.(state.playing);
  }, [onTransportChange, state.playing]);

  useEffect(() => {
    onTonicChange?.(state.root, state.octave);
  }, [onTonicChange, state.octave, state.root]);

  useEffect(() => {
    if (!engine) return;
    return engine.subscribeSceneMutations((mutation: EngineSceneMutation) => {
      const patch: Partial<LiveDroneSceneState> = {};
      if (mutation.rootFreq !== undefined) {
        const nextPitch = freqToPitch(mutation.rootFreq);
        patch.root = nextPitch.pitchClass;
        patch.octave = nextPitch.octave;
      }
      if (mutation.drift !== undefined) patch.drift = mutation.drift;
      if (mutation.sub !== undefined) patch.sub = mutation.sub;
      if (mutation.bloom !== undefined) patch.bloom = mutation.bloom;
      if (mutation.time !== undefined) patch.time = mutation.time;
      if (mutation.climateX !== undefined) patch.climateX = mutation.climateX;
      if (mutation.climateY !== undefined) patch.climateY = mutation.climateY;
      dispatch({ type: "merge", patch });
    });
  }, [engine]);

  const getSnapshot = useCallback((): DroneSessionSnapshot => {
    return { ...state };
  }, [state]);

  const applySnapshot = useCallback((snapshot: DroneSessionSnapshot) => {
    const shouldPlay = snapshot.playing ?? false;
    const nextFreq = pitchToFreq(snapshot.root, snapshot.octave);
    const nextIntervals = resolveIntervals(snapshot);

    if (engine && state.playing && !shouldPlay) {
      engine.stopDrone();
    }

    dispatch({ type: "merge", patch: { ...snapshot, playing: shouldPlay } });

    if (!engine) return;

    const preset = snapshot.activePresetId
      ? PRESETS.find((item) => item.id === snapshot.activePresetId) ?? null
      : null;
    engine.setPresetMotionProfile(preset?.motionProfile ?? null);
    engine.setPresetMaterialProfile(getPresetMaterialProfile(preset));
    // Preset-derived engine state must be restored BEFORE applyDroneScene
    // — the voice rebuild picks up the current reedShape.
    engine.setReedShape(preset?.reedShape ?? "odd");
    engine.setParallelSends(preset?.parallelSends ?? {});
    engine.applyDroneScene(snapshot.voiceLayers, snapshot.voiceLevels, nextIntervals);
    for (const id of Object.keys(snapshot.effects) as EffectId[]) {
      engine.setEffect(id, snapshot.effects[id]);
    }
    engine.setDrift(snapshot.drift);
    engine.setAir(snapshot.air);
    engine.setTime(snapshot.time);
    engine.setSub(snapshot.sub);
    engine.setBloom(snapshot.bloom);
    engine.setGlide(snapshot.glide);
    engine.setClimateX(snapshot.climateX);
    engine.setClimateY(snapshot.climateY);
    engine.setLfoShape(snapshot.lfoShape);
    engine.setLfoRate(snapshot.lfoRate);
    engine.setLfoAmount(snapshot.lfoAmount);
    engine.setPresetMorph(snapshot.presetMorph);
    engine.setEvolve(snapshot.evolve);
    engine.setTanpuraPluckRate(snapshot.pluckRate);
    engine.setPresetTrim(snapshot.presetTrim);
    if (shouldPlay) {
      engine.startDrone(nextFreq, nextIntervals);
    }
    // Pre-empt the delayed auto-start so we don't get a second startDrone
    // on top of this one.
    didAutostartRef.current = true;
  }, [engine, state.playing]);

  const startImmediate = useCallback((nextRoot: PitchClass, nextOctave: number, presetId?: string) => {
    const clampedOctave = Math.max(1, Math.min(6, nextOctave));
    let nextScale = scale;
    if (presetId) {
      const preset = PRESETS.find((item) => item.id === presetId);
      if (preset) {
        nextScale = preset.scale;
        engine?.setPresetMotionProfile(preset.motionProfile);
        engine?.setPresetMaterialProfile(getPresetMaterialProfile(preset));
        handlePreset(presetId);
      }
    }
    dispatch({
      type: "merge",
      patch: {
        root: nextRoot,
        octave: clampedOctave,
        playing: true,
      },
    });
    if (!engine) return;
    const nextFreq = pitchToFreq(nextRoot, clampedOctave);
    // Presets clear tuning/relation, so when a presetId is given the
    // legacy scale path applies. Otherwise honour active microtuning.
    engine.startDrone(nextFreq, resolveIntervals({ scale: nextScale, tuningId, relationId }));
  }, [engine, handlePreset, scale, tuningId, relationId]);

  return {
    state,
    freq,
    setRoot,
    setOctave,
    setScale,
    setTuning,
    setRelation,
    setPresetMorph,
    setPresetEvolve,
    setPluckRate,
    toggleVoiceLayer,
    setVoiceLevel,
    setDrift,
    setAir,
    setTime,
    setSub,
    setBloom,
    setGlide,
    setLfoShape,
    setLfoRate,
    setLfoAmount,
    setClimate,
    toggleEffect,
    togglePlay,
    handlePreset,
    getSnapshot,
    applySnapshot,
    startImmediate,
  };
}
