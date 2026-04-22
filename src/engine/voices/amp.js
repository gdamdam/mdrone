// mdrone voice worklet — AMP (tube-bias cabinet with speaker feedback) voice.
// Prototype extensions on DroneVoiceProcessor; concatenated
// after core.js by scripts/build-worklet.mjs.

DroneVoiceProcessor.prototype.initAmp = function() {
    this.ampN = 6;
    this.ampAmps      = new Float32Array([1.0, 0.55, 0.38, 0.22, 0.14, 0.08]);
    this.ampPhasesL   = new Float32Array(this.ampN);
    this.ampPhasesR   = new Float32Array(this.ampN);
    for (let i = 0; i < this.ampN; i++) {
      this.ampPhasesL[i] = this.rng() * Math.PI * 2;
      this.ampPhasesR[i] = this.rng() * Math.PI * 2;
    }
    this.ampLfoPhase = this.rng() * Math.PI * 2;
    this.ampLfoRate = 0.06 + this.rng() * 0.08;
    // Cabinet shaper — a proper guitar-cab-style response needs a
    // low body resonance (~90 Hz), a presence peak (~3.5 kHz), and
    // a steep rolloff above ~5 kHz. The old one-pole lowpass gave
    // only the rolloff, so the voice read as "distorted additive"
    // rather than "amplifier". SVF bandpasses for body + presence,
    // then a final one-pole at 5 kHz for the cab rolloff.
    this.ampBodyF    = 2 * Math.sin(Math.PI * 90   / sampleRate);
    this.ampBodyDamp = 1 / 2;      // Q = 2
    this.ampBodyLowL  = 0;
    this.ampBodyBandL = 0;
    this.ampBodyLowR  = 0;
    this.ampBodyBandR = 0;
    this.ampPresF    = 2 * Math.sin(Math.PI * 3500 / sampleRate);
    this.ampPresDamp = 1 / 1.8;    // Q = 1.8
    this.ampPresLowL  = 0;
    this.ampPresBandL = 0;
    this.ampPresLowR  = 0;
    this.ampPresBandR = 0;
    // Final cabinet lowpass one-pole state.
    this.ampCabL = 0;
    this.ampCabR = 0;
    // DC blocker state — removes offset from asymmetric saturation.
    this.ampDcPrevInL  = 0;
    this.ampDcPrevOutL = 0;
    this.ampDcPrevInR  = 0;
    this.ampDcPrevOutR = 0;
    // Speaker feedback — a tiny fraction of cabinet output feeds back
    // into the saturation input, simulating how real speakers excite
    // the preamp via physical coupling. Makes the amp self-exciting
    // at a controlled level instead of a static chain.
    this.ampSpkFbL = 0;
    this.ampSpkFbR = 0;
    // 2× halfband oversamplers around the asymmetric tanh — the
    // biggest aliasing hotspot in the engine (k=3.8, 6 harmonics in).
    this.ampHbL = new Halfband2x();
    this.ampHbR = new Halfband2x();
};

DroneVoiceProcessor.prototype.ampProcess = function(L, R, n, freq, drift, amp) {
    const invSr = 1 / sampleRate;
    const twoPi = Math.PI * 2;
    const detuneDepth = drift * 0.005;
    // Final cabinet rolloff lowpass — raised to 5 kHz (was 2.8 kHz)
    // so the presence BPF peak at 3.5 kHz actually passes through.
    const cabCoef = Math.exp(-twoPi * 5000 * invSr);
    // Hoisted shaper — allocating the arrow inside the sample loop
    // created a closure per sample, which Safari's JSC doesn't escape-
    // analyse away. The GC pressure inside the realtime audio callback
    // produced the signal-correlated "frrrr" hash on Safari.
    const bias = 0.12;
    const ampShaper = (v) => Math.tanh((v + bias) * 3.8) * 0.72;

    for (let i = 0; i < n; i++) {
      this.ampLfoPhase += twoPi * this.ampLfoRate * invSr;
      if (this.ampLfoPhase > twoPi) this.ampLfoPhase -= twoPi;
      const swell = 1 + Math.sin(this.ampLfoPhase) * 0.12;

      let l = 0, r = 0;
      for (let p = 0; p < this.ampN; p++) {
        const wobble = Math.sin(this.ampLfoPhase * (1 + p * 0.17)) * detuneDepth;
        const partialFreq = freq * (p + 1) * (1 + wobble);
        this.ampPhasesL[p] += twoPi * partialFreq * invSr;
        this.ampPhasesR[p] += twoPi * partialFreq * invSr * (1 + detuneDepth * 0.7) * this.dichoticMulR;
        if (this.ampPhasesL[p] > twoPi) this.ampPhasesL[p] -= twoPi;
        if (this.ampPhasesR[p] > twoPi) this.ampPhasesR[p] -= twoPi;

        l += fastSin(this.ampPhasesL[p]) * this.ampAmps[p];
        r += fastSin(this.ampPhasesR[p]) * this.ampAmps[p];
      }
      l *= swell;
      r *= swell;
      // Speaker feedback — cabinet resonance feeds back into preamp
      l += this.ampSpkFbL * 0.06;
      r += this.ampSpkFbR * 0.06;
      // Asymmetric soft-clip — a small positive DC bias before tanh
      // causes positive peaks to clip earlier than negative, generating
      // even harmonics (2nd, 4th…) like a real tube amplifier. Without
      // this the voice has only odd-harmonic distortion character.
      // Wrapped in a 2× halfband oversampler so the harmonic content
      // generated above Nyquist doesn't fold back into the audible band.
      l = this.ampHbL.process(l, ampShaper);
      r = this.ampHbR.process(r, ampShaper);
      // DC blocker — removes the offset introduced by asymmetric clip
      const dcCoef = 0.995;
      const dcOutL = l - this.ampDcPrevInL + dcCoef * this.ampDcPrevOutL;
      this.ampDcPrevInL = l; this.ampDcPrevOutL = dcOutL;
      l = dcOutL;
      const dcOutR = r - this.ampDcPrevInR + dcCoef * this.ampDcPrevOutR;
      this.ampDcPrevInR = r; this.ampDcPrevOutR = dcOutR;
      r = dcOutR;

      // Cabinet shaper: body BPF (90 Hz), presence BPF (3.5 kHz),
      // then a final one-pole lowpass at 5 kHz. The two BPFs are
      // mixed *in parallel* with the dry saturated signal, giving
      // the 3-band "cab" response that a single LP can't produce.
      const bHL = l - this.ampBodyLowL - this.ampBodyDamp * this.ampBodyBandL;
      this.ampBodyBandL += this.ampBodyF * bHL;
      this.ampBodyLowL  += this.ampBodyF * this.ampBodyBandL;
      const pHL = l - this.ampPresLowL - this.ampPresDamp * this.ampPresBandL;
      this.ampPresBandL += this.ampPresF * pHL;
      this.ampPresLowL  += this.ampPresF * this.ampPresBandL;
      const shapedL = l + this.ampBodyBandL * 0.35 + this.ampPresBandL * 0.28;

      const bHR = r - this.ampBodyLowR - this.ampBodyDamp * this.ampBodyBandR;
      this.ampBodyBandR += this.ampBodyF * bHR;
      this.ampBodyLowR  += this.ampBodyF * this.ampBodyBandR;
      const pHR = r - this.ampPresLowR - this.ampPresDamp * this.ampPresBandR;
      this.ampPresBandR += this.ampPresF * pHR;
      this.ampPresLowR  += this.ampPresF * this.ampPresBandR;
      const shapedR = r + this.ampBodyBandR * 0.35 + this.ampPresBandR * 0.28;

      this.ampCabL = this.ampCabL * cabCoef + shapedL * (1 - cabCoef);
      this.ampCabR = this.ampCabR * cabCoef + shapedR * (1 - cabCoef);
      // Store for speaker feedback (next sample)
      this.ampSpkFbL = this.ampCabL;
      this.ampSpkFbR = this.ampCabR;
      L[i] = this.ampCabL * amp;
      R[i] = this.ampCabR * amp;
    }
};
