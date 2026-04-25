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

  /** Bass-mono fold-down — sits between outputTrim and the width
   *  matrix. Below ~120 Hz, L and R are summed and re-distributed so
   *  the low end stays phase-coherent on club/PA systems and on
   *  earbuds where any stereo bass is wasted. Above 120 Hz, L/R pass
   *  through untouched so the per-voice pan + width matrix can do
   *  their work on the band where stereo actually reads. Standard
   *  pro-mix move; "subs are mono" is a near-universal rule. */
  private readonly bassMonoSplitter: ChannelSplitterNode;
  private readonly bassMonoMerger: ChannelMergerNode;
  private readonly bassMonoHpfL: BiquadFilterNode;
  private readonly bassMonoHpfR: BiquadFilterNode;
  private readonly bassMonoLpfL: BiquadFilterNode;
  private readonly bassMonoLpfR: BiquadFilterNode;
  private readonly bassMonoSum: GainNode;

  /** Master room — synthesized cathedral-IR ConvolverNode wired as a
   *  parallel send from masterGain into limiterIn. Default send level
   *  is 0 (off) so existing presets sound identical until a caller
   *  opts in via setRoomAmount(). The IR is generated procedurally
   *  (see makeCathedralIR) so this ships zero audio assets. */
  private roomConvolver: ConvolverNode;
  private roomSendGain: GainNode;
  private roomAmount = 0;

  /** Look-ahead brickwall limiter (worklet). Spliced in front of the
   *  native DynamicsCompressor on non-Safari browsers when the worklet
   *  module is loaded; on Safari we keep the native comp because the
   *  worklet stage produced signal-correlated hash there (see the
   *  earlier "frrrr" diagnostic work). True peak ceiling, 96-sample
   *  look-ahead, 4-point Lagrange intersample-peak interpolation. */
  private brickwallNode: AudioWorkletNode | null = null;
  private brickwallActive = false;

  /** Pre-limiter mixer — sums the dry post-drive path with the
   *  parallel saturation and air-band exciter sends. Sits between
   *  drivePost and the limiter stage (worklet brickwall on
   *  Chrome/FF, native comp on Safari) so both the dry signal and
   *  the parallel enhancements are subject to the same brickwall.
   *  Without this node the parallel sends would have to land at
   *  limiterIn directly, which couples the saturation chain to the
   *  Safari-vs-Chrome routing branch. */
  private readonly preLimMixer: GainNode;

  /** Parallel saturation send — drivePost → asymmetric tanh shaper
   *  → 5 Hz DC trap → small return gain → preLimMixer. Adds analog
   *  density and a touch of even harmonics without coloring the
   *  dry path. Default amount is 0 (off); setSaturationAmount()
   *  brings it in. */
  private readonly satShaper: WaveShaperNode;
  private readonly satDcTrap: BiquadFilterNode;
  private readonly satReturn: GainNode;
  private saturationAmount = 0;

  /** Air-band exciter — drivePost → 4 kHz HPF → 10 kHz LPF →
   *  soft-clip shaper → small return gain → preLimMixer. Adds
   *  perceived "air" without raising the treble level itself
   *  (the harmonics generated by clipping the band sit above
   *  10 kHz and read as openness). Default amount is 0. */
  private readonly exciterHpf: BiquadFilterNode;
  private readonly exciterLpf: BiquadFilterNode;
  private readonly exciterShaper: WaveShaperNode;
  private readonly exciterReturn: GainNode;
  private exciterAmount = 0;

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

    // Bass-mono fold — Linkwitz-Riley-ish 24 dB/oct via two cascaded
    // 12 dB biquads would be cleaner, but a single 12 dB pair gives
    // enough low-end mono pull for a perceptual win at half the
    // node count. Crossover at 120 Hz: most stereo content above
    // sits in the imaging band; below is sub territory where stereo
    // separation rarely survives translation anyway.
    this.bassMonoSplitter = this.ctx.createChannelSplitter(2);
    this.bassMonoMerger = this.ctx.createChannelMerger(2);
    this.bassMonoHpfL = this.ctx.createBiquadFilter();
    this.bassMonoHpfR = this.ctx.createBiquadFilter();
    this.bassMonoLpfL = this.ctx.createBiquadFilter();
    this.bassMonoLpfR = this.ctx.createBiquadFilter();
    for (const f of [this.bassMonoHpfL, this.bassMonoHpfR]) {
      f.type = "highpass"; f.frequency.value = 120; f.Q.value = 0.707;
    }
    for (const f of [this.bassMonoLpfL, this.bassMonoLpfR]) {
      f.type = "lowpass"; f.frequency.value = 120; f.Q.value = 0.707;
    }
    // Sum L+R bass at 0.5× so the mono fold preserves total bass
    // energy when L and R already share content; correlated content
    // sums to L+R, halved → original level. Uncorrelated content
    // halves (correct: stereo bass is the thing we want to suppress).
    this.bassMonoSum = this.ctx.createGain();
    this.bassMonoSum.gain.value = 0.5;

    // Master room — convolution reverb. We ship a real recorded IR
    // at public/irs/cathedral.wav (Saint-Lawrence Church, Molenbeek-
    // Wersbeek, Belgium — OpenAirLib, CC0; see attribution file),
    // but the network fetch + decode is async, so we seed the
    // convolver with a synthesized fallback IR up front and swap to
    // the recorded buffer when it's ready. Either way the user
    // never hears the convolver until they raise ROOM in the mixer.
    this.roomConvolver = this.ctx.createConvolver();
    this.roomConvolver.buffer = MasterBus.makeCathedralIR(this.ctx, 2.0);
    this.roomSendGain = this.ctx.createGain();
    this.roomSendGain.gain.value = 0; // off by default
    this.loadCathedralIR();

    // Pre-limiter mixer — dry drivePost lands here at unity, parallel
    // sends land at their own send gains. Output drives the limiter
    // (worklet brickwall on Chrome/FF, native comp on Safari).
    this.preLimMixer = this.ctx.createGain();
    this.preLimMixer.gain.value = 1;

    // Parallel saturation chain. Asymmetric tanh introduces a
    // touch of 2nd-harmonic content (the difference between positive
    // and negative branches creates an even-harmonic bias) which
    // reads as "tube warmth" on sustained material. The DC trap
    // catches the small DC offset that asymmetry introduces.
    this.satShaper = this.ctx.createWaveShaper();
    this.satShaper.curve = MasterBus.makeAsymmetricTanhCurve();
    this.satShaper.oversample = "2x";
    this.satDcTrap = this.ctx.createBiquadFilter();
    this.satDcTrap.type = "highpass";
    this.satDcTrap.frequency.value = 5;
    this.satDcTrap.Q.value = 0.707;
    this.satReturn = this.ctx.createGain();
    this.satReturn.gain.value = 0; // off by default

    // Air-band exciter chain. 4 kHz HPF + 10 kHz LPF brackets the
    // band where harmonic excitement reads as openness rather than
    // brightness. The clip generates harmonics that fold above
    // 10 kHz, so the perceptual lift comes from the side-band the
    // band-pass discards rather than from raising existing treble.
    this.exciterHpf = this.ctx.createBiquadFilter();
    this.exciterHpf.type = "highpass";
    this.exciterHpf.frequency.value = 4000;
    this.exciterHpf.Q.value = 0.707;
    this.exciterLpf = this.ctx.createBiquadFilter();
    this.exciterLpf.type = "lowpass";
    this.exciterLpf.frequency.value = 10000;
    this.exciterLpf.Q.value = 0.707;
    this.exciterShaper = this.ctx.createWaveShaper();
    this.exciterShaper.curve = MasterBus.makeSoftClipCurve(3.0);
    this.exciterShaper.oversample = "2x";
    this.exciterReturn = this.ctx.createGain();
    this.exciterReturn.gain.value = 0; // off by default

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
    // Pre-limiter dry path goes through preLimMixer, which also sums
    // the parallel saturation + exciter sends below. preLimMixer
    // then drives the limiter stage (limiterIn → comp → outputTrim
    // on Safari, or brickwall worklet → outputTrim on Chrome/FF).
    this.drivePost.connect(this.preLimMixer);
    this.preLimMixer.connect(this.limiterIn);
    // Parallel saturation tap.
    this.drivePost.connect(this.satShaper);
    this.satShaper.connect(this.satDcTrap);
    this.satDcTrap.connect(this.satReturn);
    this.satReturn.connect(this.preLimMixer);
    // Parallel air-band exciter tap.
    this.drivePost.connect(this.exciterHpf);
    this.exciterHpf.connect(this.exciterLpf);
    this.exciterLpf.connect(this.exciterShaper);
    this.exciterShaper.connect(this.exciterReturn);
    this.exciterReturn.connect(this.preLimMixer);
    // Master room — parallel send tap from masterGain. Lands at
    // outputTrim, summing with the limited dry path. Earlier
    // wiring routed through limiterIn so the native compressor
    // would catch the combined energy, but the comp's transparent
    // mode (threshold 0 / ratio 1) on Chrome appears to swallow
    // the convolver's low-level output entirely. The dry path
    // already passes through the brickwall worklet (or the native
    // comp on Safari) so peak overshoot from room+dry is still
    // controlled at the very last stage. Send level set by
    // setRoomAmount; default is 0 so the room is silent until
    // the user opts in.
    this.masterGain.connect(this.roomSendGain);
    this.roomSendGain.connect(this.roomConvolver);
    this.roomConvolver.connect(this.outputTrim);
    // limiterIn → limiterComp → limiterOut wiring done at construction.
    this.limiterOut.connect(this.outputTrim);
    // outputTrim → bass-mono fold → [ M/S width matrix ] → analyser → destination.
    this.outputTrim.connect(this.bassMonoSplitter);
    this.bassMonoSplitter.connect(this.bassMonoHpfL, 0);
    this.bassMonoSplitter.connect(this.bassMonoHpfR, 1);
    this.bassMonoSplitter.connect(this.bassMonoLpfL, 0);
    this.bassMonoSplitter.connect(this.bassMonoLpfR, 1);
    this.bassMonoHpfL.connect(this.bassMonoMerger, 0, 0);
    this.bassMonoHpfR.connect(this.bassMonoMerger, 0, 1);
    this.bassMonoLpfL.connect(this.bassMonoSum);
    this.bassMonoLpfR.connect(this.bassMonoSum);
    // Re-distribute the summed mono bass into both output channels.
    this.bassMonoSum.connect(this.bassMonoMerger, 0, 0);
    this.bassMonoSum.connect(this.bassMonoMerger, 0, 1);
    this.bassMonoMerger.connect(this.widthSplitter);
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
    try { this.drivePost.disconnect(this.preLimMixer); } catch { /* ok */ }
    try { this.preLimMixer.disconnect(this.limiterIn); } catch { /* ok */ }
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
      // Default debug rebuild does NOT include the parallel sat /
      // exciter taps — they remain off-by-default and are routed
      // around when audio-debug flags rewire the chain. Dry path:
      // drivePost → preLimMixer → limiterIn → limiterOut.
      cursor.connect(this.preLimMixer);
      this.preLimMixer.connect(this.limiterIn);
      cursor = this.limiterOut;
    }

    if (skipWidth) {
      try { this.outputTrim.disconnect(this.bassMonoSplitter); } catch { /* ok */ }
      cursor.connect(this.outputTrim);
      this.outputTrim.connect(this.analyser);
    } else {
      cursor.connect(this.outputTrim);
    }
  }

  /** Install the loudness meter worklet, plus splice the look-ahead
   *  brickwall limiter on non-Safari browsers. Called by `AudioEngine`
   *  after the fx worklet module has loaded. */
  onWorkletReady(): void {
    // Debug: `?audio-debug=no-loudness` skips wiring the meter tap.
    if (!this.loudnessMeter && !readAudioDebugFlags().has("no-loudness")) {
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

    // Look-ahead brickwall limiter — non-Safari only. Replaces the
    // native DynamicsCompressor for the limiting stage; the native
    // node is left in place but flattened to a transparent passthrough
    // (threshold 0 / ratio 1) so the existing graph wiring stays
    // intact and we can fall back instantly if the worklet errors.
    if (!this.brickwallNode && !readAudioDebugFlags().has("no-limiter") && MasterBus.isLookaheadLimiterSafe()) {
      try {
        this.brickwallNode = new AudioWorkletNode(this.ctx, "fx-brickwall", {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [2],
        });
        // Configure ceiling / release to match the native limiter's
        // current state so the swap is sonically continuous.
        const ceilLin = Math.pow(10, this.limiterCeiling / 20);
        const cParam = this.brickwallNode.parameters.get("ceiling");
        const rParam = this.brickwallNode.parameters.get("releaseSec");
        const eParam = this.brickwallNode.parameters.get("enabled");
        if (cParam) cParam.value = ceilLin;
        if (rParam) rParam.value = this.limiterReleaseSec;
        if (eParam) eParam.value = this.limiterEnabled ? 1 : 0;
        // Re-route: preLimMixer → brickwall → outputTrim, bypassing
        // the native comp branch. Disconnect the dry path that fed
        // the native limiterIn first; flatten the native comp to
        // passthrough so the parallel room-send tap (which still
        // lands at limiterIn) remains transparent.
        try { this.preLimMixer.disconnect(this.limiterIn); } catch { /* ok */ }
        this.preLimMixer.connect(this.brickwallNode);
        this.brickwallNode.connect(this.outputTrim);
        // Native limiter still receives the room-send tap (which goes
        // to limiterIn directly); flatten it so it doesn't double-limit.
        const now = this.ctx.currentTime;
        this.limiterComp.threshold.setTargetAtTime(0, now, 0.01);
        this.limiterComp.ratio.setTargetAtTime(1, now, 0.01);
        this.brickwallActive = true;
      } catch {
        // Worklet failed — leave the native limiter wired as-is.
        this.brickwallNode = null;
        this.brickwallActive = false;
      }
    }
  }

  /** Look-ahead limiter is Chrome/Firefox-only. On Safari the
   *  AudioWorklet stage produced a faint signal-correlated hash on
   *  long drone material (the "frrrr" diagnostic from earlier), so
   *  we keep the native DynamicsCompressor there for parity. */
  private static isLookaheadLimiterSafe(): boolean {
    try {
      const ua = (typeof navigator !== "undefined" && navigator.userAgent) || "";
      // Safari UA contains "Safari" but Chrome's UA *also* contains
      // "Safari" — true Safari is the one without "Chrome", "CriOS",
      // "FxiOS", or "Edg".
      const isSafari = /Safari/.test(ua) && !/Chrome|CriOS|FxiOS|Edg/.test(ua);
      return !isSafari;
    } catch {
      return false;
    }
  }

  /** Async-load the recorded cathedral IR shipped at
   *  /irs/cathedral.wav (Saint-Lawrence Church, Molenbeek-Wersbeek
   *  — OpenAirLib, Public Domain CC; see public/irs/
   *  cathedral.attribution.txt). Falls through silently on any
   *  failure so the synthesized IR set in the constructor stays in
   *  place; the convolver is never engaged below ROOM > 0 anyway.
   *
   *  When the buffer is ready we REPLACE the live ConvolverNode
   *  instead of mutating its `buffer` property in place. Chrome
   *  has a long-standing quirk where re-assigning `buffer` on an
   *  already-running convolver can leave the node silent (the
   *  re-initialization of the internal FFT kernel is not always
   *  triggered). Building a fresh node and rewiring the two
   *  connections (sendGain → newConv → outputTrim) sidesteps it. */
  private loadCathedralIR(): void {
    if (typeof fetch === "undefined") return;
    fetch("/irs/cathedral.wav")
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`ir HTTP ${r.status}`))))
      .then((bytes) => this.ctx.decodeAudioData(bytes))
      .then((buf) => {
        // Replace BOTH the send-gain and the convolver. The previous
        // attempt at swapping just the convolver kept testRoomDirect
        // silent in production, suggesting the long-lived sendGain
        // node also gets stuck — possibly a Chrome graph-render
        // ordering issue around mid-stream rewiring on a node that
        // already has automation history. Rebuilding the whole
        // sub-chain from masterGain forward is heavy-handed but
        // sidesteps the bug entirely.
        const freshSend = this.ctx.createGain();
        freshSend.gain.value = this.roomSendGain.gain.value;
        const freshConv = this.ctx.createConvolver();
        freshConv.normalize = true;
        freshConv.buffer = buf;
        this.masterGain.connect(freshSend);
        freshSend.connect(freshConv);
        freshConv.connect(this.outputTrim);
        // Now disconnect the old chain.
        const oldSend = this.roomSendGain;
        const oldConv = this.roomConvolver;
        this.roomSendGain = freshSend;
        this.roomConvolver = freshConv;
        try { this.masterGain.disconnect(oldSend); } catch { /* ok */ }
        try { oldSend.disconnect(oldConv); } catch { /* ok */ }
        try { oldConv.disconnect(this.outputTrim); } catch { /* ok */ }
        try { console.info(`[mdrone] cathedral IR loaded — ${buf.duration.toFixed(2)}s × ${buf.numberOfChannels}ch`); } catch { /* ok */ }
      })
      .catch((err) => {
        try { console.warn("[mdrone] cathedral IR fetch/decode failed; using synth fallback:", err); } catch { /* ok */ }
      });
  }

  /** Procedurally-generated cathedral IR. 2 s decaying noise with
   *  early-reflection cluster (0–80 ms) and an exponential tail
   *  shaped by a low-shelf bias (warm) plus a mild high-cut to
   *  taper presence over time. Channels are independently seeded
   *  so the IR has natural stereo decorrelation — convolution with
   *  a stereo IR widens any input by definition. */
  private static makeCathedralIR(ctx: BaseAudioContext, seconds: number): AudioBuffer {
    const sr = ctx.sampleRate;
    const len = Math.floor(sr * seconds);
    const buf = ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      // Mulberry32 — deterministic per channel for stable IR shape
      // across reloads (no run-to-run variance in the room sound).
      let s = (ch === 0 ? 0x9e3779b9 : 0x6a09e667) | 0;
      const rand = () => {
        s = (s + 1831565813) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296 * 2 - 1;
      };
      const earlyMs = 80;
      const earlyN = Math.floor(sr * earlyMs / 1000);
      // Decay constant: ≈ -60 dB at `seconds` (a 2 s RT60).
      const decayK = Math.log(1000) / len; // e^(-decayK * i) hits ~1/1000
      // Simple 1-pole LPF state to gently warm the tail.
      let lp = 0;
      const lpA = 0.05; // mild high-cut, ~3.5 kHz @ 48 kHz
      for (let i = 0; i < len; i++) {
        const env = Math.exp(-decayK * i);
        // Early reflections: sparser, spikier within the first 80 ms.
        const spike = i < earlyN && rand() > 0.985 ? rand() * 1.5 : 0;
        const x = rand() * env + spike * env;
        lp += (x - lp) * lpA;
        data[i] = lp * 0.6;
      }
      // Soft fade-in to suppress click at IR start.
      const fadeN = Math.min(64, len);
      for (let i = 0; i < fadeN; i++) data[i] *= i / fadeN;
    }
    return buf;
  }

  onLoudnessUpdate(cb: (m: { lufsShort: number; peakDb: number }) => void): () => void {
    this.loudnessListener = cb;
    return () => { if (this.loudnessListener === cb) this.loudnessListener = null; };
  }

  private applyLimiterParams(): void {
    const now = this.ctx.currentTime;
    if (this.brickwallActive && this.brickwallNode) {
      // Drive the look-ahead worklet directly. Native comp stays
      // flattened (threshold 0 / ratio 1) to remain transparent on
      // the parallel room-send path that lands at limiterIn.
      const cParam = this.brickwallNode.parameters.get("ceiling");
      const rParam = this.brickwallNode.parameters.get("releaseSec");
      const eParam = this.brickwallNode.parameters.get("enabled");
      const ceilLin = Math.pow(10, this.limiterCeiling / 20);
      if (cParam) cParam.setTargetAtTime(ceilLin, now, 0.01);
      if (rParam) rParam.setTargetAtTime(this.limiterReleaseSec, now, 0.01);
      if (eParam) eParam.setTargetAtTime(this.limiterEnabled ? 1 : 0, now, 0.01);
      this.limiterComp.threshold.setTargetAtTime(0, now, 0.01);
      this.limiterComp.ratio.setTargetAtTime(1, now, 0.01);
      return;
    }
    // When enabled: threshold = ceiling, ratio 4 (gentle).
    // When disabled: threshold 0, ratio 1 → effectively transparent.
    const thresh = this.limiterEnabled ? this.limiterCeiling : 0;
    const ratio = this.limiterEnabled ? 4 : 1;
    this.limiterComp.threshold.setTargetAtTime(thresh, now, 0.01);
    this.limiterComp.ratio.setTargetAtTime(ratio, now, 0.01);
    this.limiterComp.release.setTargetAtTime(this.limiterReleaseSec, now, 0.01);
  }

  /** Master room amount (0..1). Controls the parallel cathedral
   *  ConvolverNode send level. 0 (default) is a true bypass; the
   *  send gain is hard-zeroed so there is no contribution from the
   *  convolver path until the user opts in. */
  setRoomAmount(amount: number): void {
    const a = Math.max(0, Math.min(1, amount));
    this.roomAmount = a;
    // Send level: a=1 maps to ~0.7 linear (≈ -3 dB). The earlier
    // 0.25 (≈ -12 dB) was inaudible on steady drone material —
    // convolution tails are dominated by transients, and a sustained
    // drone has very few. -3 dB at full is loud enough that even
    // the steady-state spectral coloring of the IR reads, while
    // headroom into the limiter is still ample.
    this.roomSendGain.gain.setTargetAtTime(a * 0.7, this.ctx.currentTime, 0.05);
  }

  getRoomAmount(): number { return this.roomAmount; }

  /** Parallel-saturation send amount (0..1). At a=1 the saturated
   *  branch lands at -12 dBFS relative to dry — far enough below
   *  the dry that the dry path keeps its phase coherence while the
   *  even-harmonic warmth still reads. Default 0 (off). */
  setSaturationAmount(amount: number): void {
    const a = Math.max(0, Math.min(1, amount));
    this.saturationAmount = a;
    this.satReturn.gain.setTargetAtTime(a * 0.25, this.ctx.currentTime, 0.05);
  }
  getSaturationAmount(): number { return this.saturationAmount; }

  /** Air-band exciter send amount (0..1). At a=1 the band-passed
   *  + clipped branch lands at ≈ -16 dBFS relative to dry. Default
   *  0 (off). The exciter only runs on the 4–10 kHz band so it
   *  doesn't change the perceived treble level — only the open /
   *  airy character. */
  setExciterAmount(amount: number): void {
    const a = Math.max(0, Math.min(1, amount));
    this.exciterAmount = a;
    this.exciterReturn.gain.setTargetAtTime(a * 0.16, this.ctx.currentTime, 0.05);
  }
  getExciterAmount(): number { return this.exciterAmount; }

  /** Asymmetric tanh curve for parallel saturation. Positive lobe
   *  is driven harder than negative so the wave develops a small
   *  even-harmonic bias (the "tube" tell). DC offset that the
   *  asymmetry introduces is removed by the satDcTrap HPF. */
  private static makeAsymmetricTanhCurve(): Float32Array<ArrayBuffer> {
    const n = 4096;
    const curve = new Float32Array(new ArrayBuffer(n * 4));
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1;
      curve[i] = x >= 0 ? Math.tanh(x * 1.6) : Math.tanh(x * 1.2) * 0.92;
    }
    return curve;
  }

  /** Symmetric soft-clip for the air-band exciter. Steeper drive
   *  than the saturation curve since this branch is band-limited
   *  to 4–10 kHz and the harmonics it generates above 10 kHz are
   *  the perceptual lift, not the in-band waveform itself. */
  private static makeSoftClipCurve(drive: number): Float32Array<ArrayBuffer> {
    const n = 2048;
    const curve = new Float32Array(new ArrayBuffer(n * 4));
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1;
      curve[i] = Math.tanh(drive * x);
    }
    return curve;
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
