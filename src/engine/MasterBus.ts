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
  private readonly limiter: DynamicsCompressorNode;
  private readonly outputTrim: GainNode;
  private readonly analyser: AnalyserNode;
  private limiterEnabled = true;
  private limiterCeiling = -1;

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

    this.glueComp = this.ctx.createDynamicsCompressor();
    this.glueComp.threshold.value = 0;
    this.glueComp.ratio.value = 2;
    this.glueComp.attack.value = 0.03;
    this.glueComp.release.value = 0.25;
    this.glueComp.knee.value = 6;

    this.glueMakeup = this.ctx.createGain();
    this.glueMakeup.gain.value = 1;

    this.drivePre = this.ctx.createGain();
    this.drivePre.gain.value = 1;

    this.drive = this.ctx.createWaveShaper();
    this.drive.curve = MasterBus.makeDriveCurve(1);
    this.drive.oversample = "2x";

    this.drivePost = this.ctx.createGain();
    this.drivePost.gain.value = 1;

    this.limiter = this.ctx.createDynamicsCompressor();
    this.limiter.threshold.value = this.limiterCeiling;
    this.limiter.ratio.value = 12;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.1;
    this.limiter.knee.value = 6;

    this.outputTrim = this.ctx.createGain();
    this.outputTrim.gain.value = 1;

    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;

    this.masterGain.connect(this.hpf);
    this.hpf.connect(this.eqLow);
    this.eqLow.connect(this.eqMid);
    this.eqMid.connect(this.eqHigh);
    this.eqHigh.connect(this.glueComp);
    this.glueComp.connect(this.glueMakeup);
    this.glueMakeup.connect(this.drivePre);
    this.drivePre.connect(this.drive);
    this.drive.connect(this.drivePost);
    this.drivePost.connect(this.limiter);
    this.limiter.connect(this.outputTrim);
    this.outputTrim.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);
  }

  connectInput(node: AudioNode): void {
    node.connect(this.masterGain);
  }

  getMasterNode(): GainNode { return this.masterGain; }
  getAnalyser(): AnalyserNode { return this.analyser; }
  getEqLow(): BiquadFilterNode { return this.eqLow; }
  getEqMid(): BiquadFilterNode { return this.eqMid; }
  getEqHigh(): BiquadFilterNode { return this.eqHigh; }
  getLimiter(): DynamicsCompressorNode { return this.limiter; }
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
    if (on) {
      this.limiter.threshold.value = this.limiterCeiling;
      this.limiter.ratio.value = 12;
    } else {
      this.limiter.threshold.value = 0;
      this.limiter.ratio.value = 1;
    }
  }

  isLimiterEnabled(): boolean { return this.limiterEnabled; }

  setLimiterCeiling(dB: number): void {
    this.limiterCeiling = Math.max(-24, Math.min(0, dB));
    if (this.limiterEnabled) this.limiter.threshold.value = this.limiterCeiling;
  }

  getLimiterCeiling(): number { return this.limiterCeiling; }

  setDrive(amount: number): void {
    const a = Math.max(1, Math.min(10, amount));
    this.drivePre.gain.value = a;
    this.drive.curve = MasterBus.makeDriveCurve(a);
    this.drivePost.gain.value = 1 / Math.sqrt(a);
  }

  getDrive(): number { return this.drivePre.gain.value; }

  private static makeDriveCurve(amount: number): Float32Array<ArrayBuffer> {
    const n = 1024;
    const curve = new Float32Array(new ArrayBuffer(n * 4));
    const k = amount;
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1;
      curve[i] = Math.tanh(k * x);
    }
    return curve;
  }
}
