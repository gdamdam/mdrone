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
  private limiterEnabled = true;
  private limiterCeiling = -1;
  private limiterReleaseSec = 0.12;

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

    // Default drive = 1.5×
    this.drivePre = this.ctx.createGain();
    this.drivePre.gain.value = 1.5;

    this.drive = this.ctx.createWaveShaper();
    this.drive.curve = MasterBus.makeDriveCurve(1.5);
    this.drive.oversample = "2x";

    this.drivePost = this.ctx.createGain();
    this.drivePost.gain.value = 1 / Math.sqrt(1.5);

    // Worklet-backed brickwall limiter is installed on `onWorkletReady`.
    this.limiterIn = this.ctx.createGain();
    this.limiterOut = this.ctx.createGain();

    this.outputTrim = this.ctx.createGain();
    this.outputTrim.gain.value = 1;

    this.analyser = this.ctx.createAnalyser();
    // 1024 is enough for Header/VuMeter RMS; MeditateView upsizes
    // to 2048 on mount when it needs spectrum resolution.
    this.analyser.fftSize = 1024;

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
    // Passthrough until worklet ready.
    this.limiterIn.connect(this.limiterOut);
    this.limiterOut.connect(this.outputTrim);
    this.outputTrim.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);
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
    this.outputTrim.gain.setTargetAtTime(vol, this.ctx.currentTime, 0.05);
  }

  getMasterVolume(): number { return this.outputTrim.gain.value; }

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
