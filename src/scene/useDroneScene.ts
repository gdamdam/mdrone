import { useCallback, useEffect, useReducer } from "react";
import type { AudioEngine, EngineSceneMutation } from "../engine/AudioEngine";
import { ALL_VOICE_TYPES, type VoiceType } from "../engine/VoiceBuilder";
import type { EffectId } from "../engine/FxChain";
import { PRESETS, applyPreset, getPresetMaterialProfile } from "../engine/presets";
import type { DroneSessionSnapshot } from "../session";
import type { PitchClass } from "../types";
import {
  createInitialDroneScene,
  freqToPitch,
  liveDroneSceneReducer,
  pitchToFreq,
  scaleById,
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

  useEffect(() => {
    if (!engine) return;
    engine.setIntervals(scaleById(state.scale).intervalsCents);
  }, [engine, state.scale]);

  const togglePlay = useCallback(() => {
    if (!engine) return;
    if (state.playing) {
      engine.stopDrone();
      setPlaying(false);
    } else {
      engine.startDrone(freq, scaleById(state.scale).intervalsCents);
      setPlaying(true);
    }
  }, [engine, freq, setPlaying, state.playing, state.scale]);

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
    const nextIntervals = scaleById(snapshot.scale).intervalsCents;

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
  }, [engine, state.playing]);

  const startImmediate = useCallback((nextRoot: PitchClass, nextOctave: number, presetId?: string) => {
    const clampedOctave = Math.max(1, Math.min(6, nextOctave));
    let nextScale = state.scale;
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
    engine.startDrone(nextFreq, scaleById(nextScale).intervalsCents);
  }, [engine, handlePreset, state.scale]);

  return {
    state,
    freq,
    setRoot,
    setOctave,
    setScale,
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
