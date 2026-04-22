import { useCallback, useEffect, useReducer, useRef, useMemo } from "react";
import type { AudioEngine, EngineSceneMutation } from "../engine/AudioEngine";
import { ALL_VOICE_TYPES, type VoiceType } from "../engine/VoiceBuilder";
import type { EffectId } from "../engine/FxChain";
import { PRESETS, applyPreset, getPresetMaterialProfile } from "../engine/presets";
import type { DroneSessionSnapshot } from "../session";
import type { PitchClass } from "../types";
import type { RelationId, TuningId } from "../types";
import type { JourneyId } from "../journey";
import { withPartnerIntervals, type PartnerState } from "../partner";
import type { EntrainState } from "../entrain";
import { MOTION_PARAM_IDS, pitchClassToIndex, type MotionParamId } from "../sceneRecorder";
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
  /** Optional motion-recorder hook. When set, every meaningful
   *  dispatch (macros, tonic, octave, climate, evolve, morph, lfo)
   *  forwards a (paramId, value) pair to the recorder, which
   *  decides whether to actually capture it (throttle + caps live
   *  in src/sceneRecorder.ts). */
  onParamRecord?: (id: MotionParamId, value: number) => void;
}

export interface DroneLivePatch {
  root?: PitchClass;
  octave?: number;
  voiceLevels?: LiveDroneSceneState["voiceLevels"];
  drift?: number;
  air?: number;
  time?: number;
  sub?: number;
  bloom?: number;
  glide?: number;
  climateX?: number;
  climateY?: number;
  lfoRate?: number;
  lfoAmount?: number;
  presetMorph?: number;
  evolve?: number;
  pluckRate?: number;
}

function sameIntervals(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function sameVoiceLayers(
  a: LiveDroneSceneState["voiceLayers"],
  b: LiveDroneSceneState["voiceLayers"],
): boolean {
  for (const type of ALL_VOICE_TYPES) {
    if (a[type] !== b[type]) return false;
  }
  return true;
}

function sameVoiceLevels(
  a: LiveDroneSceneState["voiceLevels"],
  b: LiveDroneSceneState["voiceLevels"],
): boolean {
  for (const type of ALL_VOICE_TYPES) {
    if (a[type] !== b[type]) return false;
  }
  return true;
}

export function useDroneScene({
  engine,
  onTransportChange,
  onTonicChange,
  onPresetChange,
  onParamRecord,
}: UseDroneSceneArgs) {
  // The setter useCallbacks below depend on this; useSceneManager
  // provides a stable onParamRecord reference, so the cascade of
  // re-creations is bounded to "the recorder identity actually changed."
  const recordParam = useCallback((id: MotionParamId, v: number) => {
    onParamRecord?.(id, v);
  }, [onParamRecord]);
  const [state, dispatch] = useReducer(liveDroneSceneReducer, engine, createInitialDroneScene);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const setActivePresetId = useCallback((presetId: string | null) => {
    dispatch({ type: "merge", patch: { activePresetId: presetId } });
  }, []);

  const setRoot = useCallback((root: PitchClass) => {
    dispatch({ type: "setRoot", root });
    recordParam(MOTION_PARAM_IDS.root, pitchClassToIndex(root));
  }, [recordParam]);

  const setOctave = useCallback((octave: number) => {
    dispatch({ type: "setOctave", octave });
    recordParam(MOTION_PARAM_IDS.octave, octave);
  }, [recordParam]);

  const setScale = useCallback((scale: LiveDroneSceneState["scale"]) => {
    dispatch({ type: "setScale", scale });
  }, []);

  const setTuning = useCallback((tuningId: TuningId | null) => {
    dispatch({ type: "setTuning", tuningId });
  }, []);

  const setRelation = useCallback((relationId: RelationId | null) => {
    dispatch({ type: "setRelation", relationId });
  }, []);

  const setFineTuneOffsets = useCallback((fineTuneOffsets: number[]) => {
    dispatch({ type: "setFineTuneOffsets", fineTuneOffsets });
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

  const setJourney = useCallback((journey: JourneyId | null) => {
    dispatch({ type: "setJourney", journey });
  }, []);

  const setPartner = useCallback((partner: PartnerState) => {
    dispatch({ type: "setPartner", partner });
  }, []);

  const setEntrain = useCallback((entrain: EntrainState) => {
    dispatch({ type: "setEntrain", entrain });
    engine?.setEntrain(entrain);
  }, [engine]);

  const setClimate = useCallback((x: number, y: number) => {
    dispatch({ type: "setClimate", x, y });
    engine?.setClimateX(x);
    engine?.setClimateY(y);
    recordParam(MOTION_PARAM_IDS.climateX, x);
    recordParam(MOTION_PARAM_IDS.climateY, y);
  }, [engine, recordParam]);

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
    recordParam(MOTION_PARAM_IDS.presetMorph, presetMorph);
  }, [recordParam]);

  const setPresetEvolve = useCallback((evolve: number) => {
    dispatch({ type: "merge", patch: { evolve } });
    recordParam(MOTION_PARAM_IDS.evolve, evolve);
  }, [recordParam]);

  const setPluckRate = useCallback((pluckRate: number) => {
    dispatch({ type: "merge", patch: { pluckRate } });
    recordParam(MOTION_PARAM_IDS.pluckRate, pluckRate);
  }, [recordParam]);

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
    recordParam(MOTION_PARAM_IDS.drift, drift);
  }, [engine, setDriftState, recordParam]);

  const setAir = useCallback((air: number) => {
    setAirState(air);
    engine?.setAir(air);
    recordParam(MOTION_PARAM_IDS.air, air);
  }, [engine, setAirState, recordParam]);

  const setTime = useCallback((time: number) => {
    setTimeState(time);
    engine?.setTime(time);
    recordParam(MOTION_PARAM_IDS.time, time);
  }, [engine, setTimeState, recordParam]);

  const setSub = useCallback((sub: number) => {
    setSubState(sub);
    engine?.setSub(sub);
    recordParam(MOTION_PARAM_IDS.sub, sub);
  }, [engine, setSubState, recordParam]);

  const setBloom = useCallback((bloom: number) => {
    setBloomState(bloom);
    engine?.setBloom(bloom);
    recordParam(MOTION_PARAM_IDS.bloom, bloom);
  }, [engine, setBloomState, recordParam]);

  const setGlide = useCallback((glide: number) => {
    setGlideState(glide);
    engine?.setGlide(glide);
    recordParam(MOTION_PARAM_IDS.glide, glide);
  }, [engine, setGlideState, recordParam]);

  const setLfoShape = useCallback((lfoShape: OscillatorType) => {
    setLfoShapeState(lfoShape);
    engine?.setLfoShape(lfoShape);
  }, [engine, setLfoShapeState]);

  const setLfoRate = useCallback((lfoRate: number) => {
    setLfoRateState(lfoRate);
    engine?.setLfoRate(lfoRate);
    recordParam(MOTION_PARAM_IDS.lfoRate, lfoRate);
  }, [engine, setLfoRateState, recordParam]);

  const setLfoAmount = useCallback((lfoAmount: number) => {
    setLfoAmountState(lfoAmount);
    engine?.setLfoAmount(lfoAmount);
    recordParam(MOTION_PARAM_IDS.lfoAmount, lfoAmount);
  }, [engine, setLfoAmountState, recordParam]);

  // When the engine first becomes available, push current scene state down.
  useEffect(() => {
    if (!engine) return;
    const snap = stateRef.current;
    const preset = snap.activePresetId
      ? PRESETS.find((item) => item.id === snap.activePresetId) ?? null
      : null;
    engine.setPresetMotionProfile(preset?.motionProfile ?? null);
    engine.setPresetMaterialProfile(getPresetMaterialProfile(preset));
    engine.setDrift(snap.drift);
    engine.setAir(snap.air);
    engine.setTime(snap.time);
    engine.setSub(snap.sub);
    engine.setBloom(snap.bloom);
    engine.setGlide(snap.glide);
    engine.setClimateX(snap.climateX);
    engine.setClimateY(snap.climateY);
    engine.setLfoShape(snap.lfoShape);
    engine.setLfoRate(snap.lfoRate);
    engine.setLfoAmount(snap.lfoAmount);
    if (snap.entrain) engine.setEntrain(snap.entrain);
    engine.setPresetMorph(snap.presetMorph);
    engine.setEvolve(snap.evolve);
    engine.setTanpuraPluckRate(snap.pluckRate);
    engine.setPresetTrim(snap.presetTrim);
    engine.setFmRatio(snap.fmRatio);
    engine.setFmIndex(snap.fmIndex);
    engine.setFmFeedback(snap.fmFeedback);
    for (const t of ALL_VOICE_TYPES) {
      engine.setVoiceLayer(t, snap.voiceLayers[t]);
      engine.setVoiceLevel(t, snap.voiceLevels[t]);
    }
  }, [engine]);

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
  // The sympathetic partner (if enabled) appends a parallel cents
  // list to the main intervals so each main voice is mirrored at the
  // chosen relation. Memoised so referential equality is stable
  // across renders that don't touch the underlying inputs.
  const { scale, tuningId, relationId, fineTuneOffsets, partner } = state;
  const intervals = useMemo(() => {
    const base = resolveIntervals({ scale, tuningId, relationId, fineTuneOffsets });
    return withPartnerIntervals(base, partner);
  }, [scale, tuningId, relationId, fineTuneOffsets, partner]);

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
    // Persist FM params into snapshot state so they round-trip through
    // sessions and share URLs independently of the preset id.
    dispatch({ type: "merge", patch: {
      fmRatio: preset.fmRatio ?? 2.0,
      fmIndex: preset.fmIndex ?? 2.4,
      fmFeedback: preset.fmFeedback ?? 0,
    }});
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
      setFineTuneOffsets,
      setEffectEnabled,
      engineIntervals: withPartnerIntervals(
        resolveIntervals({
          scale: preset.scale,
          tuningId: preset.tuningId ?? null,
          relationId: preset.relationId ?? null,
          fineTuneOffsets: [],
        }),
        partner,
      ),
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
    setFineTuneOffsets,
    setEffectEnabled,
    partner,
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
    return { ...stateRef.current };
  }, []);

  const applyLivePatch = useCallback((patch: DroneLivePatch, options?: { record?: boolean }) => {
    const current = stateRef.current;
    const next = { ...current, ...patch };
    const nextRoot = patch.root ?? current.root;
    const nextOctave = patch.octave ?? current.octave;
    stateRef.current = next;
    dispatch({ type: "merge", patch });
    if (!engine) return;
    if (patch.voiceLevels) {
      for (const type of ALL_VOICE_TYPES) {
        if (patch.voiceLevels[type] !== current.voiceLevels[type]) {
          engine.setVoiceLevel(type, patch.voiceLevels[type]);
        }
      }
    }
    if (patch.drift !== undefined) engine.setDrift(patch.drift);
    if (patch.air !== undefined) engine.setAir(patch.air);
    if (patch.time !== undefined) engine.setTime(patch.time);
    if (patch.sub !== undefined) engine.setSub(patch.sub);
    if (patch.bloom !== undefined) engine.setBloom(patch.bloom);
    if (patch.glide !== undefined) engine.setGlide(patch.glide);
    if (patch.climateX !== undefined) engine.setClimateX(patch.climateX);
    if (patch.climateY !== undefined) engine.setClimateY(patch.climateY);
    if (patch.lfoRate !== undefined) engine.setLfoRate(patch.lfoRate);
    if (patch.lfoAmount !== undefined) engine.setLfoAmount(patch.lfoAmount);
    if (patch.presetMorph !== undefined) engine.setPresetMorph(patch.presetMorph);
    if (patch.evolve !== undefined) engine.setEvolve(patch.evolve);
    if (patch.pluckRate !== undefined) engine.setTanpuraPluckRate(patch.pluckRate);
    if (current.playing && (patch.root !== undefined || patch.octave !== undefined)) {
      engine.setDroneFreq(pitchToFreq(nextRoot, nextOctave));
    }
    // When the caller marks this as a user-originated patch, forward
    // each changed param to the motion recorder so MIDI CC, Meditate
    // weather, and similar live paths round-trip into share URLs.
    if (options?.record) {
      if (patch.drift !== undefined)       recordParam(MOTION_PARAM_IDS.drift, patch.drift);
      if (patch.air !== undefined)         recordParam(MOTION_PARAM_IDS.air, patch.air);
      if (patch.time !== undefined)        recordParam(MOTION_PARAM_IDS.time, patch.time);
      if (patch.sub !== undefined)         recordParam(MOTION_PARAM_IDS.sub, patch.sub);
      if (patch.bloom !== undefined)       recordParam(MOTION_PARAM_IDS.bloom, patch.bloom);
      if (patch.glide !== undefined)       recordParam(MOTION_PARAM_IDS.glide, patch.glide);
      if (patch.climateX !== undefined)    recordParam(MOTION_PARAM_IDS.climateX, patch.climateX);
      if (patch.climateY !== undefined)    recordParam(MOTION_PARAM_IDS.climateY, patch.climateY);
      if (patch.lfoRate !== undefined)     recordParam(MOTION_PARAM_IDS.lfoRate, patch.lfoRate);
      if (patch.lfoAmount !== undefined)   recordParam(MOTION_PARAM_IDS.lfoAmount, patch.lfoAmount);
      if (patch.presetMorph !== undefined) recordParam(MOTION_PARAM_IDS.presetMorph, patch.presetMorph);
      if (patch.evolve !== undefined)      recordParam(MOTION_PARAM_IDS.evolve, patch.evolve);
      if (patch.pluckRate !== undefined)   recordParam(MOTION_PARAM_IDS.pluckRate, patch.pluckRate);
      if (patch.octave !== undefined)      recordParam(MOTION_PARAM_IDS.octave, patch.octave);
      if (patch.root !== undefined)        recordParam(MOTION_PARAM_IDS.root, pitchClassToIndex(patch.root));
    }
  }, [engine, recordParam]);

  const applySnapshot = useCallback((snapshot: DroneSessionSnapshot) => {
    const current = stateRef.current;
    const shouldPlay = snapshot.playing ?? false;
    const nextSnapshot = { ...snapshot, playing: shouldPlay };
    const nextFreq = pitchToFreq(snapshot.root, snapshot.octave);
    const currentIntervals = withPartnerIntervals(
      resolveIntervals(current),
      current.partner,
    );
    const nextIntervals = withPartnerIntervals(
      resolveIntervals(snapshot),
      snapshot.partner,
    );
    const currentPreset = current.activePresetId
      ? PRESETS.find((item) => item.id === current.activePresetId) ?? null
      : null;

    if (engine && current.playing && !shouldPlay) {
      engine.stopDrone();
    }

    stateRef.current = nextSnapshot;
    dispatch({ type: "merge", patch: nextSnapshot });

    if (!engine) return;

    const preset = snapshot.activePresetId
      ? PRESETS.find((item) => item.id === snapshot.activePresetId) ?? null
      : null;
    const needsVoiceRebuild =
      !sameIntervals(currentIntervals, nextIntervals) ||
      !sameVoiceLayers(current.voiceLayers, snapshot.voiceLayers) ||
      !sameVoiceLevels(current.voiceLevels, snapshot.voiceLevels) ||
      (currentPreset?.reedShape ?? "odd") !== (preset?.reedShape ?? "odd");
    engine.setPresetMotionProfile(preset?.motionProfile ?? null);
    engine.setPresetMaterialProfile(getPresetMaterialProfile(preset));
    // Preset-derived engine state must be restored BEFORE applyDroneScene
    // — the voice rebuild picks up the current reedShape and FM params.
    engine.setReedShape(preset?.reedShape ?? "odd");
    engine.setFmRatio(snapshot.fmRatio);
    engine.setFmIndex(snapshot.fmIndex);
    engine.setFmFeedback(snapshot.fmFeedback);
    engine.setParallelSends(preset?.parallelSends ?? {});
    if (needsVoiceRebuild) {
      engine.applyDroneScene(snapshot.voiceLayers, snapshot.voiceLevels, nextIntervals);
    }
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
    if (snapshot.entrain) engine.setEntrain(snapshot.entrain);
    engine.setPresetMorph(snapshot.presetMorph);
    engine.setEvolve(snapshot.evolve);
    engine.setTanpuraPluckRate(snapshot.pluckRate);
    engine.setPresetTrim(snapshot.presetTrim);
    // Seed the evolve PRNG from the scene so long-form evolve paths
    // reproduce across loads; apply the pitch-locked LFO division
    // after the rate/amount so the lock takes effect over the manual
    // rate when non-zero.
    engine.setEvolveSeed(snapshot.seed);
    if (typeof snapshot.lfoDivision === "number") {
      engine.setLfoDivision(snapshot.lfoDivision);
    } else {
      engine.setLfoDivision(0);
    }
    if (shouldPlay) {
      if (!current.playing || needsVoiceRebuild) {
        engine.startDrone(nextFreq, nextIntervals);
      } else if (current.root !== snapshot.root || current.octave !== snapshot.octave) {
        engine.setDroneFreq(nextFreq);
      }
    }
    // Pre-empt the delayed auto-start so we don't get a second startDrone
    // on top of this one.
    didAutostartRef.current = true;
  }, [engine]);

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
    const nextPreset = presetId
      ? PRESETS.find((item) => item.id === presetId) ?? null
      : null;
    engine.startDrone(nextFreq, resolveIntervals({
      scale: nextScale,
      tuningId: nextPreset?.tuningId ?? tuningId,
      relationId: nextPreset?.relationId ?? relationId,
      fineTuneOffsets: nextPreset ? [] : fineTuneOffsets,
    }));
  }, [engine, handlePreset, scale, tuningId, relationId, fineTuneOffsets]);

  return {
    state,
    freq,
    setRoot,
    setOctave,
    setScale,
    setTuning,
    setRelation,
    setFineTuneOffsets,
    setJourney,
    setPartner,
    setEntrain,
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
    applyLivePatch,
    startImmediate,
  };
}
