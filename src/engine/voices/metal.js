// mdrone voice worklet — METAL (inharmonic singing-bowl modal stack) voice.
// Prototype extensions on DroneVoiceProcessor; concatenated
// after core.js by scripts/build-worklet.mjs.

DroneVoiceProcessor.prototype.initMetal = function() {
    // Bowl-like modal layout. Tibetan singing bowls are dominated by a
    // low fundamental mode plus sparse higher deformation modes whose
    // frequencies rise much faster than the harmonic series; struck
    // spectra also exhibit split low peaks because real bowls are not
    // perfectly symmetric.
    this.metalN = 12;
    this.metalRatios = new Float32Array([
      1.0, 1.006, 2.23, 2.27, 3.98, 6.18, 8.92,
      11.34, 14.08, 17.6, 21.9, 27.1,
    ]);
    this.metalBaseAmps = new Float32Array([
      0.88, 0.28, 0.30, 0.18, 0.12, 0.07, 0.04,
      0.022, 0.014, 0.008, 0.005, 0.003,
    ]);
    this.metalPhasesL = new Float32Array(this.metalN);
    this.metalPhasesR = new Float32Array(this.metalN);
    this.metalPans    = new Float32Array(this.metalN);
    // Per-partial random walk state (amplitude + detune)
    this.metalAmpWalks   = new Float32Array(this.metalN).fill(1);
    this.metalAmpTargets = new Float32Array(this.metalN).fill(1);
    this.metalDetuneWalks   = new Float32Array(this.metalN);
    this.metalDetuneTargets = new Float32Array(this.metalN);
    // Walk phase accumulators — each partial steps at its own slow rate
    this.metalWalkPhases = new Float32Array(this.metalN);
    this.metalWalkRates  = new Float32Array(this.metalN);
    for (let i = 0; i < this.metalN; i++) {
      this.metalPhasesL[i] = this.rng() * Math.PI * 2;
      this.metalPhasesR[i] = this.rng() * Math.PI * 2;
      this.metalPans[i] = (this.rng() - 0.5) * 0.34; // keep bowl mostly centered
      this.metalWalkRates[i] = 0.01 + this.rng() * 0.05; // very slow movement
    }
    this.metalTickCounter = 0;
    // Per-partial decay — high modes settle over ~5-15s while the
    // fundamental sustains. A slow re-excitation LFO periodically
    // "re-strikes" the upper partials so the bowl breathes.
    this.metalDecay = new Float32Array(this.metalN).fill(1);
    this.metalDecayRates = new Float32Array(this.metalN);
    for (let i = 0; i < this.metalN; i++) {
      // Fundamental barely decays; highest mode decays in ~5s
      this.metalDecayRates[i] = i < 2 ? 0.00001 : 0.00004 + i * 0.000015;
    }
    this.metalRestrikePhase = 0;
    // 2× halfband oversamplers around the output tanh — partial 12 at
    // 27.1× fundamental can reach 8–10 kHz on a low tonic; without
    // oversampling its tanh image folds below Nyquist as dissonant hiss.
    this.metalHbL = new Halfband2x();
    this.metalHbR = new Halfband2x();
};

DroneVoiceProcessor.prototype.metalProcess = function(L, R, n, freq, drift, amp) {
    const invSr = 1 / sampleRate;
    const twoPi = Math.PI * 2;
    const driftDepth = drift * 0.0024; // keep the bowl centered; max ~4 cents walk

    for (let i = 0; i < n; i++) {
      // Every ~256 samples, pick new random walk targets.
      this.metalTickCounter++;
      if ((this.metalTickCounter & 255) === 0) {
        for (let p = 0; p < this.metalN; p++) {
          const breadth = p < 2 ? 0.08 : 0.26 + p * 0.03;
          const center  = p < 2 ? 0.99 : 0.78;
          this.metalAmpTargets[p] = center - breadth * 0.5 + this.rng() * breadth;
          this.metalDetuneTargets[p] = (this.rng() * 2 - 1) * driftDepth;
        }
      }

      // Slow re-excitation — a ~0.08 Hz cycle that periodically
      // boosts upper partials back, simulating rim-friction or
      // ambient re-excitation of a singing bowl.
      this.metalRestrikePhase += twoPi * 0.08 * invSr;
      if (this.metalRestrikePhase > twoPi) this.metalRestrikePhase -= twoPi;
      const restrike = 0.5 + 0.5 * Math.sin(this.metalRestrikePhase);

      let l = 0, r = 0;
      for (let p = 0; p < this.metalN; p++) {
        // Per-partial decay — high modes settle, fundamental sustains
        this.metalDecay[p] = Math.max(0.05, this.metalDecay[p] - this.metalDecayRates[p]);
        // Re-excitation lifts decayed partials back toward 0.7
        const decayEnv = this.metalDecay[p] + (1 - this.metalDecay[p]) * restrike * 0.6;

        this.metalAmpWalks[p] += (this.metalAmpTargets[p] - this.metalAmpWalks[p]) * 0.000015;
        this.metalDetuneWalks[p] += (this.metalDetuneTargets[p] - this.metalDetuneWalks[p]) * 0.000015;
        this.metalWalkPhases[p] += twoPi * this.metalWalkRates[p] * invSr;
        if (this.metalWalkPhases[p] > twoPi) this.metalWalkPhases[p] -= twoPi;

        const partialFreq = freq * this.metalRatios[p] * (1 + this.metalDetuneWalks[p]);
        this.metalPhasesL[p] += twoPi * partialFreq * invSr;
        this.metalPhasesR[p] += twoPi * partialFreq * invSr * 1.00018;
        if (this.metalPhasesL[p] > twoPi) this.metalPhasesL[p] -= twoPi;
        if (this.metalPhasesR[p] > twoPi) this.metalPhasesR[p] -= twoPi;

        const beat = 0.94 + 0.06 * Math.sin(this.metalWalkPhases[p]);
        const amp_p = this.metalBaseAmps[p] * this.metalAmpWalks[p] * beat * decayEnv;
        const pan = this.metalPans[p];
        const lGain = amp_p * (1 - Math.max(0, pan));
        const rGain = amp_p * (1 - Math.max(0, -pan));
        l += fastSin(this.metalPhasesL[p]) * lGain;
        r += fastSin(this.metalPhasesR[p]) * rGain;
      }
      l *= 0.34;
      r *= 0.34;
      // Keep the source comparatively pure; bowls read better when the
      // upper modes stay narrow instead of being driven into brightness.
      // 2× oversampled tanh kills harmonic folding from the 12-partial
      // inharmonic stack.
      l = this.metalHbL.process(l, (v) => Math.tanh(v * 0.9));
      r = this.metalHbR.process(r, (v) => Math.tanh(v * 0.9));
      L[i] = l * amp;
      R[i] = r * amp;
    }
};

