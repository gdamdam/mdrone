import { readAudioDebugFlags } from "./audioDebug";

export class MasterBus {
  private readonly ctx: AudioContext;
  private readonly masterGain: GainNode;
  private readonly hpf: BiquadFilterNode;
  private readonly eqLow: BiquadFilterNode;
  private readonly eqMid: BiquadFilterNode;
  private readonly eqHigh: BiquadFilterNode;
  private readonly glueComp: DynamicsCompressorNode;
  private readonly glueMakeup: GainNode;
  private readonly drivePre: GainNode;
  private readonly drive: WaveShaperNode;
  private readonly drivePost: GainNode;
  /** Bridge nodes around the limiter. Previously an AudioWorkletNode
   *  brick-wall limiter was spliced between these on worklet load;
   *  now we use a native DynamicsCompressor for Safari parity (see
   *  mpump AudioPort.ts — same pattern avoids Safari worklet hash). */
  private readonly limiterIn: GainNode;
  private readonly limiterOut: GainNode;
  private readonly limiterComp: DynamicsCompressorNode;
  private readonly outputTrim: GainNode;
  private readonly analyser: AnalyserNode;
  /** Pre-limiter peak tap for the mixer CLIP LED. Reading post-limiter
   *  lights the LED whenever the limiter is holding the ceiling — which
   *  is "hot", not "clipping". Pre-limiter peak correctly reports
   *  input overshoot (the user is driving too hot). */
  private readonly preLimiterAnalyser: AnalyserNode;
  private limiterEnabled = true;
  private limiterCeiling = -1;
  // Release tuned for sustained drone material: 0.18 s lets the
  // limiter recover gracefully across slow swells without pumping,
  // while still catching transients fast enough that peaks don't
  // smash through the −1 dBFS ceiling. Earlier 0.12 s came from a
  // mix-bus default but on long tones produced an audible breathing
  // around bloom peaks.
  private limiterReleaseSec = 0.18;
  /** Headphone-safe mode: when true, outputTrim is clamped to a
   *  conservative -6 dBFS ceiling (≈ 0.5 linear) regardless of the
   *  user's volume control. Protects listeners on phones / cheap
   *  in-ear monitors where a hot preset can be uncomfortable. P3. */
  private headphoneSafe = false;
  private unsafeVolumeCache = 1;
  /** Loudness-meter worklet (tap off outputTrim → analyser). Emits
   *  `{ lufsShort, peakDb }` messages at ~30 Hz. UI subscribes via
   *  getLoudnessMeter() / onLoudnessUpdate(). P3. */
  private loudnessMeter: AudioWorkletNode | null = null;
  private loudnessListener: ((m: { lufsShort: number; peakDb: number }) => void) | null = null;

  /** Stereo width stage — mid/side matrix between outputTrim and the
   *  analyser. width = 1.0 is identity (LL=RR=1, LR=RL=0); width = 0
   *  folds to mono; width = 2 exaggerates the sides (phase-inverted
   *  cross feed). Implemented as a 4-gain matrix between a
   *  ChannelSplitter and ChannelMerger so it stays a few cheap
   *  multiplies per sample and plays nicely with the browser's
   *  native smoothing. */
  private readonly widthSplitter: ChannelSplitterNode;
  private readonly widthMerger: ChannelMergerNode;
  private readonly widthLL: GainNode;
  private readonly widthLR: GainNode;
  private readonly widthRL: GainNode;
  private readonly widthRR: GainNode;
  private widthValue = 1;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;

    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 1;

    this.hpf = this.ctx.createBiquadFilter();
    this.hpf.type = "highpass";
    // 18 Hz @ Q 0.707. Inaudible subsonic energy below ~20 Hz costs
    // peak headroom and pumps the limiter without any audible benefit
    // — speakers and most listeners can't reproduce / hear it. 18 Hz
    // leaves octave-1 fundamentals (C1 ≈ 32.7 Hz) effectively
    // untouched (~−0.5 dB at 32 Hz) while removing rumble that was
    // previously eating into the limiter's gain reduction. Earlier
    // value of 10 Hz left ~6 dB of subsonic content riding the bus.
    this.hpf.frequency.value = 18;
    this.hpf.Q.value = 0.707;

    this.eqLow = this.ctx.createBiquadFilter();
    this.eqLow.type = "lowshelf";
    this.eqLow.frequency.value = 250;
    this.eqLow.gain.value = 0;

    this.eqMid = this.ctx.createBiquadFilter();
    this.eqMid.type = "peaking";
    this.eqMid.frequency.value = 1000;
    this.eqMid.Q.value = 1;
    this.eqMid.gain.value = 0;

    this.eqHigh = this.ctx.createBiquadFilter();
    this.eqHigh.type = "highshelf";
    this.eqHigh.frequency.value = 4000;
    this.eqHigh.gain.value = 0;

    // Default glue = 0.5 (threshold -9 dB, makeup 1.25×)
    this.glueComp = this.ctx.createDynamicsCompressor();
    this.glueComp.threshold.value = -9;
    this.glueComp.ratio.value = 2;
    this.glueComp.attack.value = 0.03;
    this.glueComp.release.value = 0.25;
    this.glueComp.knee.value = 6;

    this.glueMakeup = this.ctx.createGain();
    this.glueMakeup.gain.value = 1.25;

    // Drive default dropped from 1.5 to 1.1. With 1.5 the waveshaper
    // was always saturating — it gave every preset a permanent tanh
    // crush on top of whatever the voices + reverbs were doing.
    // Users who want more grit still crank the DRIVE control in the
    // mixer; default is now near-unity and transparent.
    this.drivePre = this.ctx.createGain();
    this.drivePre.gain.value = 1.1;

    this.drive = this.ctx.createWaveShaper();
    this.drive.curve = MasterBus.makeDriveCurve(1.1);
    // "none" matches mpump's Safari-clean pattern — "2x" on Safari
    // contributed signal-correlated hash. Gentle tanh is still smooth
    // enough at unity without oversampling.
    this.drive.oversample = "none";

    this.drivePost = this.ctx.createGain();
    this.drivePost.gain.value = 1 / Math.sqrt(1.1);

    // Native DynamicsCompressor limiter — brick-wall-ish when enabled
    // (ratio 20, hard knee, fast attack). Matches mpump's approach
    // which is clean on Safari. Replaced the custom `fx-brickwall`
    // AudioWorkletNode that contributed Safari output-stage hash.
    this.limiterIn = this.ctx.createGain();
    this.limiterOut = this.ctx.createGain();
    this.limiterComp = this.ctx.createDynamicsCompressor();
    this.limiterComp.threshold.value = this.limiterCeiling;
    // mpump-style gentle peak catcher (ratio 4, soft knee 10) — not
    // brick-wall. Ratio 20 + knee 0 crushed reverb tails into the
    // dry signal, making plate/hall/shimmer inaudible on hot presets.
    this.limiterComp.ratio.value = 4;
    this.limiterComp.attack.value = 0.001;
    this.limiterComp.release.value = this.limiterReleaseSec;
    this.limiterComp.knee.value = 10;
    this.limiterIn.connect(this.limiterComp);
    this.limiterComp.connect(this.limiterOut);

    this.outputTrim = this.ctx.createGain();
    this.outputTrim.gain.value = 1;

    // Width stage — M/S matrix at unity by default. Gains are swapped
    // in on setWidth() via setTargetAtTime for a click-free change.
    this.widthSplitter = this.ctx.createChannelSplitter(2);
    this.widthMerger = this.ctx.createChannelMerger(2);
    this.widthLL = this.ctx.createGain();
    this.widthRR = this.ctx.createGain();
    this.widthLR = this.ctx.createGain();
    this.widthRL = this.ctx.createGain();
    this.widthLL.gain.value = 1;
    this.widthRR.gain.value = 1;
    this.widthLR.gain.value = 0;
    this.widthRL.gain.value = 0;

    this.analyser = this.ctx.createAnalyser();
    // 1024 is enough for Header/VuMeter RMS; MeditateView upsizes
    // to 2048 on mount when it needs spectrum resolution.
    this.analyser.fftSize = 1024;

    this.preLimiterAnalyser = this.ctx.createAnalyser();
    this.preLimiterAnalyser.fftSize = 1024;

    // Parallel CLIP-LED tap at the very top of the master bus —
    // before HPF / EQ / glue / drive. The drive chain's tanh curve
    // mathematically bounds the pre-limiter signal to ~1/√drive
    // (≈ 0.82 at default drive=1.5), which means a tap after drive
    // will never exceed unity no matter how hot the mix is. Tapping
    // masterGain captures the raw voice+FX sum — peak > 1.0 there
    // is the honest "your mix exceeds 0 dBFS" event we want to
    // flag. Parallel connection; doesn't interrupt the main path.
    this.masterGain.connect(this.preLimiterAnalyser);

    this.masterGain.connect(this.hpf);
    this.hpf.connect(this.eqLow);
    this.eqLow.connect(this.eqMid);
    this.eqMid.connect(this.eqHigh);
    this.eqHigh.connect(this.glueComp);
    this.glueComp.connect(this.glueMakeup);
    this.glueMakeup.connect(this.drivePre);
    this.drivePre.connect(this.drive);
    this.drive.connect(this.drivePost);
    this.drivePost.connect(this.limiterIn);
    // limiterIn → limiterComp → limiterOut wiring done at construction.
    this.limiterOut.connect(this.outputTrim);
    // outputTrim → [ M/S width matrix ] → analyser → destination
    this.outputTrim.connect(this.widthSplitter);
    this.widthSplitter.connect(this.widthLL, 0);
    this.widthSplitter.connect(this.widthLR, 1);
    this.widthSplitter.connect(this.widthRL, 0);
    this.widthSplitter.connect(this.widthRR, 1);
    this.widthLL.connect(this.widthMerger, 0, 0);
    this.widthLR.connect(this.widthMerger, 0, 0);
    this.widthRL.connect(this.widthMerger, 0, 1);
    this.widthRR.connect(this.widthMerger, 0, 1);
    this.widthMerger.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);

    this.applyDebugBypasses();
  }

  /** Safari "frrrr" diagnostic surface — rewire the master chain to
   *  skip specific stages based on `?audio-debug=` flags. All edits
   *  happen after the default graph is fully wired so the fallback
   *  stays intact if flags are absent. See audioDebug.ts. */
  private applyDebugBypasses(): void {
    const flags = readAudioDebugFlags();
    if (flags.size === 0) return;
    const skipGlue = flags.has("no-glue");
    const skipLimiter = flags.has("no-limiter");
    const skipDrive = flags.has("no-drive");
    const skipHpf = flags.has("no-hpf");
    const skipEq = flags.has("no-eq");
    const skipWidth = flags.has("no-width");

    if (flags.has("hpf40")) this.hpf.frequency.value = 40;

    // Tear down the default chain from masterGain onward so we can
    // rebuild it conditionally. The output side (outputTrim onward)
    // is preserved; we re-plumb input→outputTrim only.
    try { this.masterGain.disconnect(this.hpf); } catch { /* ok */ }
    try { this.hpf.disconnect(this.eqLow); } catch { /* ok */ }
    try { this.eqLow.disconnect(this.eqMid); } catch { /* ok */ }
    try { this.eqMid.disconnect(this.eqHigh); } catch { /* ok */ }
    try { this.eqHigh.disconnect(this.glueComp); } catch { /* ok */ }
    try { this.glueComp.disconnect(this.glueMakeup); } catch { /* ok */ }
    try { this.glueMakeup.disconnect(this.drivePre); } catch { /* ok */ }
    try { this.drivePre.disconnect(this.drive); } catch { /* ok */ }
    try { this.drive.disconnect(this.drivePost); } catch { /* ok */ }
    try { this.drivePost.disconnect(this.limiterIn); } catch { /* ok */ }
    try { this.limiterOut.disconnect(this.outputTrim); } catch { /* ok */ }

    let cursor: AudioNode = this.masterGain;

    if (!skipHpf) { cursor.connect(this.hpf); cursor = this.hpf; }

    if (!skipEq) {
      cursor.connect(this.eqLow);
      this.eqLow.connect(this.eqMid);
      this.eqMid.connect(this.eqHigh);
      cursor = this.eqHigh;
    }

    if (!skipGlue) {
      cursor.connect(this.glueComp);
      this.glueComp.connect(this.glueMakeup);
      cursor = this.glueMakeup;
    }

    if (!skipDrive) {
      cursor.connect(this.drivePre);
      this.drivePre.connect(this.drive);
      this.drive.connect(this.drivePost);
      cursor = this.drivePost;
    }

    if (!skipLimiter) {
      cursor.connect(this.limiterIn);
      // limiterIn → limiterComp → limiterOut already wired.
      cursor = this.limiterOut;
    }

    if (skipWidth) {
      try { this.outputTrim.disconnect(this.widthSplitter); } catch { /* ok */ }
      cursor.connect(this.outputTrim);
      this.outputTrim.connect(this.analyser);
    } else {
      cursor.connect(this.outputTrim);
    }
  }

  /** Install the loudness meter worklet. Limiter is now a native
   *  DynamicsCompressor wired in the constructor; only the loudness
   *  meter tap still needs the fx worklet module. Called by
   *  `AudioEngine` after the fx worklet module has loaded. */
  onWorkletReady(): void {
    if (this.loudnessMeter) return;
    // Debug: `?audio-debug=no-loudness` skips wiring the meter tap.
    if (readAudioDebugFlags().has("no-loudness")) return;
    // Loudness meter — tap off outputTrim so it reads what the user
    // actually hears (post-limiter, post-volume). The tap is parallel:
    // the signal continues to analyser / destination untouched.
    try {
      this.loudnessMeter = new AudioWorkletNode(this.ctx, "fx-loudness-meter", {
        numberOfInputs: 1,
        numberOfOutputs: 0,
      });
      this.outputTrim.connect(this.loudnessMeter);
      this.loudnessMeter.port.onmessage = (e) => {
        const msg = e.data;
        if (msg && msg.type === "meter" && this.loudnessListener) {
          this.loudnessListener({ lufsShort: msg.lufsShort, peakDb: msg.peakDb });
        }
      };
    } catch { /* registration may race; leave null */ }
  }

  onLoudnessUpdate(cb: (m: { lufsShort: number; peakDb: number }) => void): () => void {
    this.loudnessListener = cb;
    return () => { if (this.loudnessListener === cb) this.loudnessListener = null; };
  }

  private applyLimiterParams(): void {
    const now = this.ctx.currentTime;
    // When enabled: threshold = ceiling, ratio 4 (gentle).
    // When disabled: threshold 0, ratio 1 → effectively transparent.
    const thresh = this.limiterEnabled ? this.limiterCeiling : 0;
    const ratio = this.limiterEnabled ? 4 : 1;
    this.limiterComp.threshold.setTargetAtTime(thresh, now, 0.01);
    this.limiterComp.ratio.setTargetAtTime(ratio, now, 0.01);
    this.limiterComp.release.setTargetAtTime(this.limiterReleaseSec, now, 0.01);
  }

  connectInput(node: AudioNode): void {
    node.connect(this.masterGain);
  }

  getMasterNode(): GainNode { return this.masterGain; }
  getAnalyser(): AnalyserNode { return this.analyser; }
  getPreLimiterAnalyser(): AnalyserNode { return this.preLimiterAnalyser; }
  getEqLow(): BiquadFilterNode { return this.eqLow; }
  getEqMid(): BiquadFilterNode { return this.eqMid; }
  getEqHigh(): BiquadFilterNode { return this.eqHigh; }
  /** @deprecated Native `DynamicsCompressor` is no longer the limiter;
   *  use `isLimiterEnabled()` / `setLimiterCeiling()` instead. Kept as
   *  a null return to preserve the shape of AudioEngine's API surface
   *  for callers that only inspect state (there are none at present).
   */
  /** @deprecated Limiter is a native DynamicsCompressor now; returns
   *  null so legacy inspection callers don't crash. */
  getLimiter(): AudioWorkletNode | null { return null; }
  getOutputTrim(): GainNode { return this.outputTrim; }

  setMasterVolume(v: number): void {
    const vol = Math.max(0, Math.min(1.5, v));
    this.unsafeVolumeCache = vol;
    const effective = this.headphoneSafe ? Math.min(vol, MasterBus.HEADPHONE_SAFE_MAX) : vol;
    this.outputTrim.gain.setTargetAtTime(effective, this.ctx.currentTime, 0.05);
  }

  getMasterVolume(): number { return this.unsafeVolumeCache; }

  /** -6 dBFS linear ceiling for headphone-safe mode. */
  private static readonly HEADPHONE_SAFE_MAX = 0.5;

  setHeadphoneSafe(on: boolean): void {
    if (this.headphoneSafe === on) return;
    this.headphoneSafe = on;
    const effective = on
      ? Math.min(this.unsafeVolumeCache, MasterBus.HEADPHONE_SAFE_MAX)
      : this.unsafeVolumeCache;
    this.outputTrim.gain.setTargetAtTime(effective, this.ctx.currentTime, 0.05);
  }
  isHeadphoneSafe(): boolean { return this.headphoneSafe; }

  /** Stereo width. 1.0 = unchanged, 0 = mono (L+R summed), 2.0 =
   *  exaggerated side (phase-inverted cross-feed). Out of range
   *  inputs are clamped. Coefficient derivation:
   *    L' = 0.5*((1+w)*L + (1-w)*R)
   *    R' = 0.5*((1-w)*L + (1+w)*R)  */
  setWidth(w: number): void {
    const clamped = Math.max(0, Math.min(2, w));
    this.widthValue = clamped;
    const t = this.ctx.currentTime;
    const pair = 0.5 * (1 + clamped);
    const cross = 0.5 * (1 - clamped);
    this.widthLL.gain.setTargetAtTime(pair, t, 0.03);
    this.widthRR.gain.setTargetAtTime(pair, t, 0.03);
    this.widthLR.gain.setTargetAtTime(cross, t, 0.03);
    this.widthRL.gain.setTargetAtTime(cross, t, 0.03);
  }

  getWidth(): number { return this.widthValue; }

  setHpfFreq(hz: number): void {
    this.hpf.frequency.value = Math.max(10, hz);
  }

  getHpfFreq(): number { return this.hpf.frequency.value; }

  setGlueAmount(amount: number): void {
    const a = Math.max(0, Math.min(1, amount));
    this.glueComp.threshold.value = -18 * a;
    this.glueMakeup.gain.value = 1 + a * 0.5;
  }

  getGlueAmount(): number { return -this.glueComp.threshold.value / 18; }

  setLimiterEnabled(on: boolean): void {
    this.limiterEnabled = on;
    this.applyLimiterParams();
  }

  isLimiterEnabled(): boolean { return this.limiterEnabled; }

  setLimiterCeiling(dB: number): void {
    this.limiterCeiling = Math.max(-24, Math.min(0, dB));
    this.applyLimiterParams();
  }

  getLimiterCeiling(): number { return this.limiterCeiling; }

  setLimiterRelease(sec: number): void {
    this.limiterReleaseSec = Math.max(0.02, Math.min(1, sec));
    this.applyLimiterParams();
  }

  getLimiterRelease(): number { return this.limiterReleaseSec; }

  setDrive(amount: number): void {
    const a = Math.max(1, Math.min(10, amount));
    this.drivePre.gain.value = a;
    this.drive.curve = MasterBus.makeDriveCurve(a);
    this.drivePost.gain.value = 1 / Math.sqrt(a);
  }

  getDrive(): number { return this.drivePre.gain.value; }

  private static makeDriveCurve(amount: number): Float32Array<ArrayBuffer> {
    // LUT resolution bumped from 1024 → 4096. At drive = 10 the tanh
    // knee collapses into ~10 % of the curve and 1024 points produced a
    // visible staircase on hot material. 4096 × Float32 = 16 KB, built
    // only on setDrive(); negligible cost vs audible quality gain.
    const n = 4096;
    const curve = new Float32Array(new ArrayBuffer(n * 4));
    const k = amount;
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1;
      curve[i] = Math.tanh(k * x);
    }
    return curve;
  }
}
