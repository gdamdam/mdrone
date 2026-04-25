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
    // tighter body resonance (~95 Hz Q≈3), a focused presence peak
    // (~2.8 kHz Q≈5) — the previous broad Q≈1.8 peak smeared into
    // 4-6 kHz fizz — and a steeper rolloff above ~6.5 kHz. The cab
    // LP is now a *cascaded* one-pole pair (≈ 12 dB/oct at the
    // corner) to kill the harshness from the asymmetric tanh's
    // upper harmonics without needing a true biquad.
    this.ampBodyF    = 2 * Math.sin(Math.PI * 95   / sampleRate);
    this.ampBodyDamp = 1 / 3;      // Q = 3
    this.ampBodyLowL  = 0;
    this.ampBodyBandL = 0;
    this.ampBodyLowR  = 0;
    this.ampBodyBandR = 0;
    this.ampPresF    = 2 * Math.sin(Math.PI * 2800 / sampleRate);
    this.ampPresDamp = 1 / 5;      // Q = 5
    this.ampPresLowL  = 0;
    this.ampPresBandL = 0;
    this.ampPresLowR  = 0;
    this.ampPresBandR = 0;
    // Two-stage cabinet lowpass state — cascaded one-poles at 6.5 kHz
    // give ≈ 12 dB/oct rolloff (–3 dB at 6.5 kHz, –12 dB at 13 kHz).
    this.ampCabL  = 0;
    this.ampCabR  = 0;
    this.ampCab2L = 0;
    this.ampCab2R = 0;
    // DC blocker state — removes offset from asymmetric saturation.
    this.ampDcPrevInL  = 0;
    this.ampDcPrevOutL = 0;
    this.ampDcPrevInR  = 0;
    this.ampDcPrevOutR = 0;
    // Speaker feedback — a tiny fraction of cabinet output feeds back
    // into the saturation input, simulating how real speakers excite
    // the preamp via physical coupling. Makes the amp self-exciting
    // at a controlled level instead of a static chain. Reduced from
    // 0.06 to 0.045 because the steeper 2-stage cab now has a slower
    // settling time and the higher-Q body BPF amplifies any residual
    // sub-fundamental energy in the feedback path.
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
    // Final cabinet rolloff — cascaded one-pole pair at 6.5 kHz gives
    // a 2-pole (≈ 12 dB/oct) response. The presence peak at 2.8 kHz
    // sits a bit over an octave below the corner so it passes through
    // largely intact, while the asymmetric-tanh's 4-8 kHz "fizz"
    // harmonics get steeper attenuation than a single-pole could give.
    const cabCoef = Math.exp(-twoPi * 6500 * invSr);
    const cabOneMinus = 1 - cabCoef;
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
      l += this.ampSpkFbL * 0.045;
      r += this.ampSpkFbR * 0.045;
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

      // Cabinet shaper: tighter body BPF (95 Hz Q≈3), focused
      // presence BPF (2.8 kHz Q≈5), then a 2-stage cab LP at 6.5 kHz.
      // Bandpass mix gains lowered (0.30/0.25 vs. 0.35/0.28) to keep
      // RMS roughly equal-loudness with the previous broader voicing.
      // +1e-25 on the band-state writes is a denormal escape under
      // long silences (the higher-Q SVFs ring far below audible).
      const bHL = l - this.ampBodyLowL - this.ampBodyDamp * this.ampBodyBandL;
      this.ampBodyBandL += this.ampBodyF * bHL + 1e-25;
      this.ampBodyLowL  += this.ampBodyF * this.ampBodyBandL;
      const pHL = l - this.ampPresLowL - this.ampPresDamp * this.ampPresBandL;
      this.ampPresBandL += this.ampPresF * pHL + 1e-25;
      this.ampPresLowL  += this.ampPresF * this.ampPresBandL;
      const shapedL = l + this.ampBodyBandL * 0.30 + this.ampPresBandL * 0.25;

      const bHR = r - this.ampBodyLowR - this.ampBodyDamp * this.ampBodyBandR;
      this.ampBodyBandR += this.ampBodyF * bHR + 1e-25;
      this.ampBodyLowR  += this.ampBodyF * this.ampBodyBandR;
      const pHR = r - this.ampPresLowR - this.ampPresDamp * this.ampPresBandR;
      this.ampPresBandR += this.ampPresF * pHR + 1e-25;
      this.ampPresLowR  += this.ampPresF * this.ampPresBandR;
      const shapedR = r + this.ampBodyBandR * 0.30 + this.ampPresBandR * 0.25;

      // 2-stage cabinet LP — first pole, then second pole on the result.
      this.ampCabL  = this.ampCabL  * cabCoef + shapedL       * cabOneMinus;
      this.ampCab2L = this.ampCab2L * cabCoef + this.ampCabL  * cabOneMinus;
      this.ampCabR  = this.ampCabR  * cabCoef + shapedR       * cabOneMinus;
      this.ampCab2R = this.ampCab2R * cabCoef + this.ampCabR  * cabOneMinus;
      // Speaker feedback taken from the second-stage output so the
      // self-exciting loop sees the full cab response, not the mid
      // of the two-stage cascade.
      this.ampSpkFbL = this.ampCab2L;
      this.ampSpkFbR = this.ampCab2R;
      L[i] = this.ampCab2L * amp;
      R[i] = this.ampCab2R * amp;
    }
};
