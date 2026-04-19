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
  /** Bridge node — brickwall worklet is inserted between `limiterIn`
   *  and `limiterOut` once the fx worklet module has loaded. Before
   *  that, `limiterIn → limiterOut` is a direct connection (no
   *  limiting, but audio still flows so the UI isn't silent during
   *  the ~50 ms worklet load). */
  private readonly limiterIn: GainNode;
  private readonly limiterOut: GainNode;
  private limiterNode: AudioWorkletNode | null = null;
  private passthroughConnected = true;
  private readonly outputTrim: GainNode;
  private readonly analyser: AnalyserNode;
  /** Pre-limiter peak tap for the mixer CLIP LED. Reading post-limiter
   *  lights the LED whenever the limiter is holding the ceiling — which
   *  is "hot", not "clipping". Pre-limiter peak correctly reports
   *  input overshoot (the user is driving too hot). */
  private readonly preLimiterAnalyser: AnalyserNode;
  private limiterEnabled = true;
  private limiterCeiling = -1;
  private limiterReleaseSec = 0.12;
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
    this.hpf.frequency.value = 10;
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
    this.drive.oversample = "2x";

    this.drivePost = this.ctx.createGain();
    this.drivePost.gain.value = 1 / Math.sqrt(1.1);

    // Worklet-backed brickwall limiter is installed on `onWorkletReady`.
    this.limiterIn = this.ctx.createGain();
    this.limiterOut = this.ctx.createGain();

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

    // Diagnostic flags for the iPhone "frrrr" hiss hunt:
    //   ?bypassmaster=1    → skip glueComp + drive (HPF → EQ → limiter)
    //   ?bypassmaster=hard → route masterGain directly to destination,
    //                        skipping HPF, EQ, limiter, width, analyser.
    // Remove once the suspect is confirmed and the fix lands.
    const bypassParam = typeof location !== "undefined"
      ? new URLSearchParams(location.search).get("bypassmaster")
      : null;
    const bypassHard = bypassParam === "hard";
    const bypassMaster = bypassParam === "1" || bypassParam === "";

    if (bypassHard) {
      // eslint-disable-next-line no-console
      console.log("mdrone: ?bypassmaster=hard — masterGain → destination direct");
    } else {
      this.masterGain.connect(this.hpf);
      this.hpf.connect(this.eqLow);
      this.eqLow.connect(this.eqMid);
      this.eqMid.connect(this.eqHigh);
      if (bypassMaster) {
        // eslint-disable-next-line no-console
        console.log("mdrone: ?bypassmaster=1 — skipping glueComp + drive");
        this.eqHigh.connect(this.limiterIn);
      } else {
        this.eqHigh.connect(this.glueComp);
        this.glueComp.connect(this.glueMakeup);
        this.glueMakeup.connect(this.drivePre);
        this.drivePre.connect(this.drive);
        this.drive.connect(this.drivePost);
        this.drivePost.connect(this.limiterIn);
      }
    }
    if (bypassHard) {
      this.masterGain.connect(this.ctx.destination);
    } else {
      // Passthrough until worklet ready.
      this.limiterIn.connect(this.limiterOut);
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
    }
  }

  /** Install the brickwall limiter worklet. Called by `AudioEngine`
   *  after the fx worklet module has loaded. */
  onWorkletReady(): void {
    if (this.limiterNode) return;
    try {
      this.limiterNode = new AudioWorkletNode(this.ctx, "fx-brickwall", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });
    } catch {
      // Registration not yet complete — leave passthrough in place.
      return;
    }
    // Detach passthrough, insert worklet.
    if (this.passthroughConnected) {
      try { this.limiterIn.disconnect(this.limiterOut); } catch { /* noop */ }
      this.passthroughConnected = false;
    }
    this.limiterIn.connect(this.limiterNode);
    this.limiterNode.connect(this.limiterOut);
    // Reapply current state.
    this.applyLimiterParams();

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
    const node = this.limiterNode;
    if (!node) return;
    const now = this.ctx.currentTime;
    // Ceiling is linear in the worklet (dB → scalar).
    const ceilingLin = this.limiterEnabled ? Math.pow(10, this.limiterCeiling / 20) : 1.0;
    node.parameters.get("ceiling")?.setTargetAtTime(ceilingLin, now, 0.01);
    node.parameters.get("releaseSec")?.setTargetAtTime(this.limiterReleaseSec, now, 0.01);
    node.parameters.get("enabled")?.setTargetAtTime(this.limiterEnabled ? 1 : 0, now, 0.01);
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
  getLimiter(): AudioWorkletNode | null { return this.limiterNode; }
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
