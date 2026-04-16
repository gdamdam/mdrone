// mdrone voice worklet — AIR (pink noise through SVF resonators) voice.
// Prototype extensions on DroneVoiceProcessor; concatenated
// after core.js by scripts/build-worklet.mjs.

DroneVoiceProcessor.prototype.initAir = function() {
    // 3 resonators at semi-inharmonic ratios — keeps the air voice
    // light and airy rather than pitched. The earlier bump to 5
    // bands reintroduced too much bass/mid energy (sum of bands ≈
    // 1.34 vs the old 1.01) which, combined with the ×1.4 final
    // multiplier, pushed the voice from "breath" into "pitched
    // body". Semi-inharmonic ratios avoid the strictly-harmonic
    // whistle the old 1/2/3 produced without adding energy.
    this.airN = 5;
    this.airRatios = new Float32Array([1.0, 2.07, 3.11, 4.71, 7.23]);
    this.airAmps   = new Float32Array([0.55, 0.30, 0.16, 0.08, 0.04]);
    this.airPans   = new Float32Array([0.0, -0.25, 0.25, 0.35, -0.35]);
    // Two-pole state-variable bandpass state per resonator (L + R independent)
    // state: [lowL, bandL, lowR, bandR]
    this.airStates = [];
    for (let i = 0; i < this.airN; i++) {
      this.airStates.push(new Float32Array(4));
    }
    // Q walk state
    this.airQWalks = new Float32Array(this.airN).fill(11);
    this.airQTargets = new Float32Array(this.airN).fill(11);
    this.airTickCounter = 0;
    // Wind gusting — slow random amplitude walk on noise input
    this.airGustLevel = 1;
    this.airGustTarget = 1;
    this.airGustPhase = this.rng() * Math.PI * 2;
    // Independent pink noise states for L and R to avoid mono
    this.pinkR = { b0: 0, b1: 0, b2: 0, b3: 0, b4: 0, b5: 0, b6: 0 };
    // High-shelf state for air character (one-pole)
    this.hsL = 0;
    this.hsR = 0;
};

  // Second pink noise generator (uses pinkR state) for independent R channel
DroneVoiceProcessor.prototype.pinkNoiseR = function() {
    const p = this.pinkR;
    const white = this.rng() * 2 - 1;
    p.b0 = 0.99886 * p.b0 + white * 0.0555179;
    p.b1 = 0.99332 * p.b1 + white * 0.0750759;
    p.b2 = 0.969  * p.b2 + white * 0.153852;
    p.b3 = 0.8665 * p.b3 + white * 0.3104856;
    p.b4 = 0.55   * p.b4 + white * 0.5329522;
    p.b5 = -0.7616 * p.b5 - white * 0.016898;
    const out = p.b0 + p.b1 + p.b2 + p.b3 + p.b4 + p.b5 + p.b6 + white * 0.5362;
    p.b6 = white * 0.115926;
    return out * 0.11;
};

DroneVoiceProcessor.prototype.airProcess = function(L, R, n, freq, drift, amp) {
    // drift modulates the Q random-walk range
    const qMin = 8 - drift * 2;
    const qMax = 16 + drift * 4;

    for (let i = 0; i < n; i++) {
      // Slow Q walk every ~512 samples
      this.airTickCounter++;
      if ((this.airTickCounter & 511) === 0) {
        for (let r = 0; r < this.airN; r++) {
          this.airQTargets[r] = qMin + this.rng() * (qMax - qMin);
        }
      }

      // Wind gusting — slow amplitude walk (~0.1 Hz) on the noise
      // source gives breath-like character instead of flat pink.
      this.airGustLevel += (this.airGustTarget - this.airGustLevel) * 0.00004;
      this.airGustPhase += 6.283 * 0.12 / sampleRate;
      if (this.airGustPhase > 6.283) {
        this.airGustPhase -= 6.283;
        this.airGustTarget = 0.6 + this.rng() * 0.4;
      }
      const gust = this.airGustLevel;
      const noiseL = this.pinkNoise() * 4.5 * gust;
      const noiseR = this.pinkNoiseR() * 4.5 * gust;

      let sumL = 0, sumR = 0;
      for (let r = 0; r < this.airN; r++) {
        // Advance Q walk
        this.airQWalks[r] += (this.airQTargets[r] - this.airQWalks[r]) * 0.00003;
        const q = this.airQWalks[r];
        const cutoff = Math.max(20, Math.min(sampleRate * 0.48, freq * this.airRatios[r]));
        // SVF coefficients
        const f = 2 * Math.sin(Math.PI * cutoff / sampleRate);
        const damp = Math.min(2, Math.max(0.0001, 1 / q));

        const s = this.airStates[r];
        // L
        s[0] += f * s[1];
        const highL = noiseL - s[0] - damp * s[1];
        s[1] += f * highL;
        // R
        s[2] += f * s[3];
        const highR = noiseR - s[2] - damp * s[3];
        s[3] += f * highR;

        const bandL = s[1];
        const bandR = s[3];
        const pan = this.airPans[r];
        const lGain = this.airAmps[r] * (1 - Math.max(0, pan));
        const rGain = this.airAmps[r] * (1 - Math.max(0, -pan));
        sumL += bandL * lGain;
        sumR += bandR * rGain;
      }

      // High-shelf boost (one-pole) for air brightness
      this.hsL = this.hsL * 0.6 + sumL * 0.4;
      this.hsR = this.hsR * 0.6 + sumR * 0.4;
      const brightenedL = sumL + (sumL - this.hsL) * 0.5;
      const brightenedR = sumR + (sumR - this.hsR) * 0.5;

      L[i] = brightenedL * amp * 1.4;
      R[i] = brightenedR * amp * 1.4;
    }
};

