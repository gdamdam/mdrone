/**
 * VoiceBuilder — factory for drone voice timbres.
 *
 * Each voice is a single AudioWorkletNode running the DroneVoiceProcessor
 * (see droneVoiceProcessor.js) with a `voiceType` processor option
 * selecting one of four physical/spectral models:
 *
 *   TANPURA — Karplus-Strong string with jawari nonlinearity and
 *             auto-repluck cycle. Stereo via two offset delay lines.
 *   REED    — additive odd-heavy harmonic stack with per-partial slow
 *             pitch wobble + bellows amplitude modulation + source
 *             tanh saturation. Stereo via odd/even pan split.
 *   METAL   — 6 inharmonic partials with independent per-partial
 *             amplitude random walks and detune drift, each panned.
 *   AIR     — pink noise through 3 state-variable bandpass resonators
 *             at harmonic ratios with Q random walks.
 *
 * The Voice interface is the same shape the engine used before the
 * worklet refactor so AudioEngine's orchestration didn't have to
 * change — each voice still exposes setFreq/setDrift/stop. The
 * difference is the inner node: instead of a bank of OscillatorNodes
 * plus filters, a single worklet processor handles everything for
 * one voice in its own sample loop.
 */

export type VoiceType = "tanpura" | "reed" | "metal" | "air" | "piano" | "fm" | "amp";

/** Harmonic-stack shape for the reed voice. Lets one voice processor
 *  cover several sustained-additive timbres without new AudioWorklets:
 *  - "odd"      clarinet / shruti-box / harmonium (default)
 *  - "even"     bowed string — SOTL, Górecki
 *  - "balanced" pipe organ, vocal "ahh" — Malone, choral pads
 *  - "sine"     pure fundamental only — Dream House, Radigue ARP 2500 */
export type ReedShape = "odd" | "even" | "balanced" | "sine";

/** Tanpura string tuning — lets the four KS strings read as a real
 *  tanpura (Sa Pa / Sa Ma / Sa Ni) instead of four near-unison copies.
 *  Kept as a VoiceBuilder option (applied at voice construction) so
 *  changes require a voice rebuild. */
export type TanpuraTuningId = "classic" | "sa-pa" | "sa-ma" | "sa-ni" | "sa-ma-pa-ni";
export const TANPURA_TUNING_IDS: readonly TanpuraTuningId[] =
  ["classic", "sa-pa", "sa-ma", "sa-ni", "sa-ma-pa-ni"] as const;
export const TANPURA_TUNING_LABELS: Record<TanpuraTuningId, string> = {
  "classic":     "Sa Sa Sa Sa (unison)",
  "sa-pa":       "Sa Pa (fifth)",
  "sa-ma":       "Sa Ma (fourth)",
  "sa-ni":       "Sa Ni (major 7th)",
  "sa-ma-pa-ni": "Sa Ma Pa Ni (all four)",
};

export const ALL_VOICE_TYPES: readonly VoiceType[] = ["tanpura", "reed", "metal", "air", "piano", "fm", "amp"] as const;

export interface Voice {
  setFreq(hz: number, glideSec: number): void;
  /** 0..1 normalized drift amount — mapped to per-voice depth internally. */
  setDrift(amount01: number): void;
  /** Tanpura re-pluck rate multiplier, 0.2..4. Ignored by other voice types. */
  setPluckRate(rate: number): void;
  stop(): void;
}

/**
 * Build a worklet-backed voice. `target` is connected downstream
 * (usually the engine's droneVoiceGain). `startAt` is the AudioContext
 * time at which the voice should start producing output.
 *
 * Requires the worklet module to be already loaded in `ctx` — the
 * engine's ensureWorkletReady() gates this.
 */
export function buildVoice(
  type: VoiceType,
  ctx: AudioContext,
  target: AudioNode,
  rootFreq: number,
  intervalCents: number,
  drift01: number,
  startAt: number,
  reedShape: ReedShape = "odd",
  fmRatio = 2.0,
  fmIndex = 2.4,
  fmFeedback = 0,
  tanpuraTuning: TanpuraTuningId = "classic",
): Voice {
  const targetFreq = rootFreq * Math.pow(2, intervalCents / 1200);

  const node = new AudioWorkletNode(ctx, "drone-voice", {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    processorOptions: {
      voiceType: type,
      seed: Math.floor(Math.random() * 0x7fffffff) + 1,
      reedShape,
      fmRatio,
      fmIndex,
      fmFeedback,
      tanpuraTuning,
      // Diagnostic flag: `?sinetest=1` replaces all voice DSP with a
      // clean Math.sin tone so we can tell whether the "frrrr" is in
      // the voice code or in Safari's AudioWorklet/node path itself.
      sineTest: typeof location !== "undefined"
        && new URLSearchParams(location.search).has("sinetest"),
    },
  });

  const freqParam = node.parameters.get("freq")!;
  const driftParam = node.parameters.get("drift")!;
  const ampParam = node.parameters.get("amp")!;
  const pluckRateParam = node.parameters.get("pluckRate");

  freqParam.setValueAtTime(targetFreq, startAt);
  driftParam.setValueAtTime(drift01, startAt);
  // The processor's internal amp is held at 1 — external voice gain
  // (droneVoiceGain in AudioEngine) handles stack fades so BLOOM
  // applies uniformly across all voices in the stack.
  ampParam.setValueAtTime(1, startAt);

  // Diagnostic: `?voicedirect=1` routes the worklet output straight to
  // ctx.destination, skipping every native node (voiceGain, droneFilter,
  // presetTrim, fxChain inserts, master chain). Ultimate isolation test
  // for the Safari "frrrr" — if hiss persists even with `sinetest=1` and
  // `voicedirect=1`, the source is Safari's AudioWorkletNode or its
  // output stage itself.
  const voiceDirect = typeof location !== "undefined"
    && new URLSearchParams(location.search).has("voicedirect");
  if (voiceDirect) {
    node.connect(ctx.destination);
  } else {
    node.connect(target);
  }

  return {
    setFreq(hz, glideSec) {
      const now = ctx.currentTime;
      freqParam.cancelScheduledValues(now);
      freqParam.setValueAtTime(freqParam.value, now);
      freqParam.linearRampToValueAtTime(hz, now + glideSec);
    },
    setDrift(amt) {
      const now = ctx.currentTime;
      driftParam.setTargetAtTime(Math.max(0, Math.min(1, amt)), now, 0.08);
    },
    setPluckRate(rate) {
      if (!pluckRateParam) return;
      const clamped = Math.max(0, Math.min(4, rate));
      pluckRateParam.setTargetAtTime(clamped, ctx.currentTime, 0.1);
    },
    stop() {
      // Ramp amp to 0 for a clean tail, then post a termination
      // message to the processor (so its process() returns false and
      // the worklet is truly GC-eligible), then disconnect. Without
      // the stop message, the processor runs forever even when
      // disconnected — which leaks CPU across many preset changes.
      try {
        const now = ctx.currentTime;
        ampParam.cancelScheduledValues(now);
        ampParam.setValueAtTime(ampParam.value, now);
        ampParam.linearRampToValueAtTime(0, now + 0.15);
        setTimeout(() => {
          try { node.port.postMessage({ type: "stop" }); } catch { /* ok */ }
          try { node.disconnect(); } catch { /* ok */ }
        }, 220);
      } catch {
        try { node.port.postMessage({ type: "stop" }); } catch { /* ok */ }
        try { node.disconnect(); } catch { /* ok */ }
      }
    },
  };
}
