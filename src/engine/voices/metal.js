// mdrone voice worklet — METAL (inharmonic singing-bowl modal stack) voice.
// Prototype extensions on DroneVoiceProcessor; concatenated
// after core.js by scripts/build-worklet.mjs.

// Measured-inspired bowl modal table. Each entry is one *physical* mode
// (m=2,3,4…) with a doublet split where applicable — real bowls are not
// perfectly axisymmetric, so each circumferential mode appears as a
// close pair whose interference produces the characteristic slow
// shimmer-beat ("hum note → strike note" envelope). Settle times are
// the linear ramp-to-floor used by the per-sample decay update; with
// the 0.08 Hz restrike LFO they describe how *quickly the strike
// transient relaxes* between re-excitations, not the perceived ring
// of the steady-state. Low circumferential modes (m=2,3) settle over
// 30–12 s so they sit at ≈0.6–0.8 between restrikes (always audible);
// upper deformation modes settle in 1–4 s so they fade and pulse with
// the LFO, which is the bowl's "breathing".
//
// Doublet split ratios narrow with mode order — the asymmetry energy
// budget is roughly fixed, so higher-order modes split proportionally
// less. Splits chosen to fall in the 0.2–0.8 % band measured on small
// hand-hammered Tibetan bowls (Rossing/Inácio).
//
// Top four modes are single oscillators: they decay too fast and their
// amplitude is too low for the doublet beat to be perceptually relevant
// — doubling the oscillator count there is wasted CPU.
const METAL_MODES = [
  // ratio   split    amp    decay     panW   walk    (decay = per-sample
  //                                                    floor-ramp rate)
  { ratio: 1.00,  split: 0.006,  amp: 0.88, decay: 6.6e-7, panW: 0.04, walk: 0.012 },
  { ratio: 2.23,  split: 0.005,  amp: 0.30, decay: 1.6e-6, panW: 0.12, walk: 0.018 },
  { ratio: 3.98,  split: 0.004,  amp: 0.18, decay: 3.3e-6, panW: 0.18, walk: 0.026 },
  { ratio: 6.18,  split: 0.003,  amp: 0.11, decay: 5.0e-6, panW: 0.22, walk: 0.032 },
  { ratio: 8.92,  split: 0.0025, amp: 0.07, decay: 8.0e-6, panW: 0.26, walk: 0.038 },
  { ratio: 11.34, split: 0.0020, amp: 0.04, decay: 1.1e-5, panW: 0.28, walk: 0.042 },
  { ratio: 14.08, split: null,   amp: 0.022,decay: 1.5e-5, panW: 0.32, walk: 0.045 },
  { ratio: 17.6,  split: null,   amp: 0.013,decay: 2.0e-5, panW: 0.32, walk: 0.045 },
  { ratio: 21.9,  split: null,   amp: 0.008,decay: 3.0e-5, panW: 0.34, walk: 0.045 },
  { ratio: 27.1,  split: null,   amp: 0.004,decay: 4.5e-5, panW: 0.34, walk: 0.045 },
];

DroneVoiceProcessor.prototype.initMetal = function() {
    // Expand the modal table into flat per-oscillator arrays. Doublet
    // pairs share decay/walk/pan width so they breathe together but get
    // independent random phases (so beats start at zero crossing, not
    // at peak — the spec calls this out as a phasey/seasick failure
    // mode if missed) and small independent pan offsets within panW.
    const oscRatios = [];
    const oscAmps   = [];
    const oscDecays = [];
    const oscPanW   = [];
    const oscWalks  = [];
    for (const m of METAL_MODES) {
      if (m.split == null) {
        oscRatios.push(m.ratio);
        oscAmps.push(m.amp);
        oscDecays.push(m.decay);
        oscPanW.push(m.panW);
        oscWalks.push(m.walk);
      } else {
        // Energy split equally across the doublet pair so the pair's
        // total RMS matches a single-mode entry of the same `amp`
        // (≈ −3 dB per partial, summed-incoherent).
        const a = m.amp * Math.SQRT1_2;
        oscRatios.push(m.ratio * (1 - m.split * 0.5));
        oscRatios.push(m.ratio * (1 + m.split * 0.5));
        oscAmps.push(a); oscAmps.push(a);
        oscDecays.push(m.decay); oscDecays.push(m.decay);
        oscPanW.push(m.panW);    oscPanW.push(m.panW);
        oscWalks.push(m.walk);   oscWalks.push(m.walk);
      }
    }
    this.metalN          = oscRatios.length;
    this.metalRatios     = new Float32Array(oscRatios);
    this.metalBaseAmps   = new Float32Array(oscAmps);
    this.metalDecayRates = new Float32Array(oscDecays);
    this.metalPhasesL = new Float32Array(this.metalN);
    this.metalPhasesR = new Float32Array(this.metalN);
    this.metalPans    = new Float32Array(this.metalN);
    this.metalAmpWalks      = new Float32Array(this.metalN).fill(1);
    this.metalAmpTargets    = new Float32Array(this.metalN).fill(1);
    this.metalDetuneWalks   = new Float32Array(this.metalN);
    this.metalDetuneTargets = new Float32Array(this.metalN);
    this.metalWalkPhases = new Float32Array(this.metalN);
    this.metalWalkRates  = new Float32Array(this.metalN);
    for (let i = 0; i < this.metalN; i++) {
      this.metalPhasesL[i] = this.rng() * Math.PI * 2;
      this.metalPhasesR[i] = this.rng() * Math.PI * 2;
      // Pan width is per-mode (low modes near centre, upper modes
      // diffuse) — but each oscillator gets its own random offset
      // within that band so doublet pairs don't sit on the same point.
      this.metalPans[i] = (this.rng() - 0.5) * oscPanW[i];
      this.metalWalkRates[i] = oscWalks[i] * (0.7 + this.rng() * 0.6);
    }
    this.metalTickCounter = 0;
    this.metalDecay = new Float32Array(this.metalN).fill(1);
    this.metalRestrikePhase = 0;
    // 2× halfband oversamplers around the output tanh — top mode at
    // 27.1× fundamental reaches ~3 kHz on a 110 Hz tonic; tanh harmonics
    // would otherwise fold below Nyquist as dissonant hiss.
    this.metalHbL = new Halfband2x();
    this.metalHbR = new Halfband2x();
};

DroneVoiceProcessor.prototype.metalProcess = function(L, R, n, freq, drift, amp) {
    const invSr = 1 / sampleRate;
    const twoPi = Math.PI * 2;
    const driftDepth = drift * 0.0024; // keep the bowl centered; max ~4 cents walk
    // Hoisted to avoid per-sample closure allocation inside the
    // AudioWorklet callback (Safari/JSC GC hash).
    const metalShaper = (v) => Math.tanh(v * 0.9);

    for (let i = 0; i < n; i++) {
      // Every ~256 samples, pick new random walk targets.
      this.metalTickCounter++;
      if ((this.metalTickCounter & 255) === 0) {
        for (let p = 0; p < this.metalN; p++) {
          // Fundamental doublet (entries 0,1) walks tightly so the
          // pitch never wavers; everything else gets a wider breadth
          // for liveness, capped to 0.5 so upper-mode amp flutter stays
          // musical rather than seasick.
          const breadth = p < 2 ? 0.08 : Math.min(0.5, 0.26 + p * 0.03);
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
        this.metalPhasesR[p] += twoPi * partialFreq * invSr * 1.00018 * this.dichoticMulR;
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
      l = this.metalHbL.process(l, metalShaper);
      r = this.metalHbR.process(r, metalShaper);
      L[i] = l * amp;
      R[i] = r * amp;
    }
};

