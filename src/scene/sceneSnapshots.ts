import type { AudioEngine } from "../engine/AudioEngine";
import type {
  DroneSessionSnapshot,
  FxSessionSnapshot,
  MixerSessionSnapshot,
  PortableScene,
} from "../session";
import { loadPaletteId } from "../themes";
import type { Visualizer } from "../components/visualizers";

export function captureMixerSnapshot(engine: AudioEngine): MixerSessionSnapshot {
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

export function applyMixerSnapshot(engine: AudioEngine, mixer: MixerSessionSnapshot): void {
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

export function captureFxSnapshot(engine: AudioEngine): FxSessionSnapshot {
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
      cistern: fx.getEffectLevel("cistern"),
      granular: fx.getEffectLevel("granular"),
      ringmod: fx.getEffectLevel("ringmod"),
      formant: fx.getEffectLevel("formant"),
    },
    delayTime: fx.getDelayTime(),
    delayFeedback: fx.getDelayFeedback(),
    combFeedback: fx.getCombFeedback(),
    subCenter: fx.getSubCenter(),
    freezeMix: fx.getFreezeFeedback(),
  };
}

export function applyFxSnapshot(engine: AudioEngine, snapshot: FxSessionSnapshot): void {
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

export function capturePortableScene(
  engine: AudioEngine,
  drone: DroneSessionSnapshot,
  visualizer: Visualizer,
  name: string,
): PortableScene {
  return {
    name,
    version: 1,
    drone,
    mixer: captureMixerSnapshot(engine),
    fx: captureFxSnapshot(engine),
    ui: {
      paletteId: loadPaletteId(),
      visualizer,
    },
  };
}
