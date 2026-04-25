// mdrone voice worklet — FM (2-op with slow index envelope) voice.
// Prototype extensions on DroneVoiceProcessor; concatenated
// after core.js by scripts/build-worklet.mjs.

DroneVoiceProcessor.prototype.initFm = function() {
    this.fmCarrierPhaseL = this.rng() * Math.PI * 2;
    this.fmCarrierPhaseR = this.rng() * Math.PI * 2;
    this.fmModPhase = this.rng() * Math.PI * 2;
    this.fmRatio = this.fmRatioOpt;  // modulator : carrier frequency ratio (from preset)
    this.fmIndex = this.fmIndexOpt; // modulation index (from preset)
    // Modulator self-feedback (0..1). Feeds the previous modulator
    // output back into its own phase, producing richer/grittier
    // timbres (metallic drones, harsh bells). 0 = classic 2-op,
    // 0.3 = warm thickening, 0.7+ = aggressive/noisy. Default 0
    // preserves existing presets.
    this.fmFeedback = this.fmFeedbackOpt;
    this.fmModFbSample = 0; // one-sample feedback delay
    this.fmLfoPhase = this.rng() * Math.PI * 2;
    this.fmLfoRate = 0.08 + this.rng() * 0.06;
    // Slow index-envelope LFO — modulates fmIndex across ~±55 % so
    // the bell "rings out" and comes back over a 30-50 s period.
    // Fixed 2.0 index is audibly static; this is what turns a dead
    // DX7-style bell into a living one.
    this.fmIndexLfoPhase = this.rng() * Math.PI * 2;
    this.fmIndexLfoRate = 0.015 + this.rng() * 0.012;
};

DroneVoiceProcessor.prototype.fmProcess = function(L, R, n, freq, drift, amp) {
    const invSr = 1 / sampleRate;
    const twoPi = Math.PI * 2;
    const depth = drift * 0.004;
    // Anti-alias headroom — Carson's rule says FM bandwidth ≈
    // 2·modFreq·(1 + index), so the highest reproduced sideband is
    // at ≈ carrier + modFreq·(1 + index). For aliasing to stay
    // inaudible we keep that under Nyquist · 0.85. Solving for
    // index gives a per-sample upper bound; we soft-cap dynIndex
    // through tanh so the bell still rings at high frequencies but
    // can never push energy past the alias headroom. Cheap (one
    // tanh per sample) and avoids the per-voice halfband we would
    // otherwise need for an oscillator-style 2× oversample.
    const aliasHeadroom = sampleRate * 0.5 * 0.85;

    for (let i = 0; i < n; i++) {
      this.fmLfoPhase += twoPi * this.fmLfoRate * invSr;
      if (this.fmLfoPhase > twoPi) this.fmLfoPhase -= twoPi;
      const breath = 1 + Math.sin(this.fmLfoPhase) * 0.035;

      // Slow index envelope — sidebands bloom and recede over tens
      // of seconds so the voice is never harmonically static.
      this.fmIndexLfoPhase += twoPi * this.fmIndexLfoRate * invSr;
      if (this.fmIndexLfoPhase > twoPi) this.fmIndexLfoPhase -= twoPi;
      const rawIndex = this.fmIndex * (1 + Math.sin(this.fmIndexLfoPhase) * 0.55);
      // Modulator frequency for this sample — used both for the
      // oscillator and for the alias headroom calculation.
      const modFreq = freq * this.fmRatio * (1 + depth);
      const maxIndex = Math.max(0.1, (aliasHeadroom - freq) / Math.max(modFreq, 1) - 1);
      const dynIndex = maxIndex * Math.tanh(rawIndex / maxIndex);
      const fbPhase = this.fmModPhase + this.fmFeedback * this.fmModFbSample;
      this.fmModPhase += twoPi * modFreq * invSr;
      if (this.fmModPhase > twoPi) this.fmModPhase -= twoPi;
      const modSin = fastSin(fbPhase);
      this.fmModFbSample = modSin; // store for next sample's feedback
      const modOut = modSin * dynIndex * freq;

      // Carrier oscillators — frequency-modulated by the modulator
      const cFreq = freq + modOut;
      this.fmCarrierPhaseL += twoPi * cFreq * invSr;
      this.fmCarrierPhaseR += twoPi * cFreq * invSr * (1 + depth * 0.6) * this.dichoticMulR;
      while (this.fmCarrierPhaseL >  twoPi) this.fmCarrierPhaseL -= twoPi;
      while (this.fmCarrierPhaseL < -twoPi) this.fmCarrierPhaseL += twoPi;
      while (this.fmCarrierPhaseR >  twoPi) this.fmCarrierPhaseR -= twoPi;
      while (this.fmCarrierPhaseR < -twoPi) this.fmCarrierPhaseR += twoPi;

      const s = breath * 0.22;
      L[i] = fastSin(this.fmCarrierPhaseL) * s * amp;
      R[i] = fastSin(this.fmCarrierPhaseR) * s * amp;
    }
};

  // hard through tanh saturation with a simulated cabinet low-pass.
