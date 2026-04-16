// mdrone voice worklet — REED (harmonium/shruti-box additive + PolyBLEP saw) voice.
// Prototype extensions on DroneVoiceProcessor; concatenated
// after core.js by scripts/build-worklet.mjs.

DroneVoiceProcessor.prototype.initReed = function() {
    // 7 partials. The shape parameter picks an amplitude curve:
    //   odd      — clarinet/shruti/harmonium (default, original)
    //   even     — bowed string (SOTL, Górecki) — even partials emphasised
    //   balanced — pipe organ, choral "ahh" (Malone) — both odd and even
    //   sine     — pure fundamental (Dream House, Radigue ARP 2500)
    // Partial count is shape-dependent. "even" (bowed string) and
    // "balanced" (organ/choral) gain richer upper harmonics with 12
    // partials; 7 was audibly thin for these timbres. "odd"
    // (clarinet/shruti) and "sine" stay at 7 — clarinet spectra are
    // dominated by the first few odd harmonics in reality.
    const REED_AMPS = {
      odd:      [0.55, 0.28, 0.38, 0.13, 0.24, 0.07, 0.16],
      even:     [0.55, 0.48, 0.20, 0.36, 0.14, 0.24, 0.08, 0.16, 0.04, 0.10, 0.03, 0.06],
      balanced: [0.60, 0.40, 0.34, 0.26, 0.20, 0.14, 0.10, 0.07, 0.05, 0.035, 0.025, 0.018],
      sine:     [1.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00],
    };
    const amps = REED_AMPS[this.reedShape] || REED_AMPS.odd;
    this.reedN = amps.length;
    this.reedAmps     = new Float32Array(amps);
    this.reedPhasesL  = new Float32Array(this.reedN);
    this.reedPhasesR  = new Float32Array(this.reedN);
    // Per-partial slow LFO state (0.08..0.28 Hz randomized)
    this.reedLfoPhases = new Float32Array(this.reedN);
    this.reedLfoRates  = new Float32Array(this.reedN);
    this.reedAmpJitterPhases = new Float32Array(this.reedN);
    this.reedAmpJitterRates  = new Float32Array(this.reedN);
    for (let i = 0; i < this.reedN; i++) {
      this.reedPhasesL[i] = this.rng() * Math.PI * 2;
      this.reedPhasesR[i] = this.rng() * Math.PI * 2;
      this.reedLfoPhases[i] = this.rng() * Math.PI * 2;
      this.reedLfoRates[i] = 0.08 + this.rng() * 0.2;
      this.reedAmpJitterPhases[i] = this.rng() * Math.PI * 2;
      this.reedAmpJitterRates[i] = 0.01 + this.rng() * 0.03;
    }
    // Bellows amplitude LFO — slow, shared
    this.bellowsPhase = 0;
    this.bellowsRate = 0.22 + this.rng() * 0.08;

    // PolyBLEP saw state for "even" (bowed-string) shape — a
    // bandlimited sawtooth is fundamentally richer than summing
    // 12 sines. Phase is 0..1 (not 0..2pi) for PolyBLEP.
    this.useSaw = this.reedShape === "even";
    if (this.useSaw) {
      this.sawPhaseL = this.rng();
      this.sawPhaseR = this.rng();
      // Slow wobble on the saw frequency for life
      this.sawLfoPhase = this.rng() * Math.PI * 2;
      this.sawLfoRate = 0.12 + this.rng() * 0.08;
    }

    // Formant layer — wide bandpass peaks that give the additive
    // harmonic stack a "body". Without this the reed reads as "7
    // sines + LFO"; with it, it reads as sines *through* a physical
    // resonator. Shape picks the formant set:
    //   odd      — shruti/clarinet: bright upper body
    //   even     — bowed string: classic cello/viola body
    //   balanced — pipe organ / vocal "ahh" formant
    //   sine     — none (pure fundamental bypasses formants)
    // Each entry: [centerHz, Q, mixGain]. Q=2.0 gives more pronounced
    // body than the original 1.2 while staying below the Q=3-4
    // threshold where bellows AM interaction caused "frrr" artifacts.
    // Bellows depth was reduced to ±2.5% to keep the safe zone.
    // Q raised to 2.0 from 1.2 — more pronounced instrument body.
    // Bellows depth reduced to ±2.5% (was ±4%) to prevent the
    // bellows×formant interaction "frrr" artifact that Q=3-4 caused.
    // Q=2.0 + gentle bellows sits in the safe zone.
    const FORMANTS = {
      odd:      [[500, 2.0, 0.07], [1200, 2.0, 0.05], [2500, 2.0, 0.03]],
      even:     [[300, 2.0, 0.08], [700, 2.0, 0.06], [1400, 2.0, 0.04]],
      balanced: [[400, 2.0, 0.075], [900, 2.0, 0.055], [1800, 2.0, 0.035]],
      sine:     [],
    };
    const formants = FORMANTS[this.reedShape] || FORMANTS.odd;
    this.reedFormN = formants.length;
    this.reedFormF    = new Float32Array(this.reedFormN);
    this.reedFormDamp = new Float32Array(this.reedFormN);
    this.reedFormGain = new Float32Array(this.reedFormN);
    this.reedFormLowL  = new Float32Array(this.reedFormN);
    this.reedFormBandL = new Float32Array(this.reedFormN);
    this.reedFormLowR  = new Float32Array(this.reedFormN);
    this.reedFormBandR = new Float32Array(this.reedFormN);
    for (let i = 0; i < this.reedFormN; i++) {
      const fc = formants[i][0];
      const q  = formants[i][1];
      const g  = formants[i][2];
      this.reedFormF[i] = 2 * Math.sin(Math.PI * fc / sampleRate);
      this.reedFormDamp[i] = 1 / q;
      this.reedFormGain[i] = g;
    }
    // Presence shelf state — one-pole LP that we subtract from the
    // signal to synthesise a +2.3 dB high shelf above ~3 kHz. The
    // formant bank adds 300-1800 Hz body energy, which without this
    // compensation perceptually dulls the reed highs after master
    // limiting. Matches the technique used in airProcess().
    this.hsReedL = 0;
    this.hsReedR = 0;
};

DroneVoiceProcessor.prototype.reedProcess = function(L, R, n, freq, drift, amp) {
    const invSr = 1 / sampleRate;
    const twoPi = Math.PI * 2;
    // Drift → per-partial detune depth (max ±8 cents)
    const detuneDepth = drift * 0.0046; // in cent-ratio (8 cents ≈ 0.0046)
    // Aliasing guard — skip partials whose frequency exceeds 90% of
    // Nyquist. Matters now that even/balanced shapes have 12 partials:
    // at high tonics partial 12 can reach above 20 kHz.
    const nyquist = sampleRate * 0.45;

    for (let i = 0; i < n; i++) {
      // Advance bellows amplitude LFO
      this.bellowsPhase += twoPi * this.bellowsRate * invSr;
      if (this.bellowsPhase > twoPi) this.bellowsPhase -= twoPi;
      const bellows = 1 + Math.sin(this.bellowsPhase) * 0.025; // ±2.5% (reduced from 4% to avoid formant×bellows artifact at Q=2)

      let l = 0, r = 0;

      if (this.useSaw) {
        // PolyBLEP sawtooth path — "even" (bowed-string) shape.
        // A bandlimited saw has all harmonics falling at 1/n,
        // fundamentally richer than summing 12 sines.
        this.sawLfoPhase += twoPi * this.sawLfoRate * invSr;
        if (this.sawLfoPhase > twoPi) this.sawLfoPhase -= twoPi;
        const wobble = Math.sin(this.sawLfoPhase) * detuneDepth;
        const sawFreq = freq * (1 + wobble);
        const dtL = sawFreq * invSr;
        const dtR = sawFreq * (1 + detuneDepth * 0.5) * invSr;
        this.sawPhaseL += dtL;
        if (this.sawPhaseL >= 1) this.sawPhaseL -= 1;
        this.sawPhaseR += dtR;
        if (this.sawPhaseR >= 1) this.sawPhaseR -= 1;
        const rawL = 2 * this.sawPhaseL - 1 - polyblep(this.sawPhaseL, dtL);
        const rawR = 2 * this.sawPhaseR - 1 - polyblep(this.sawPhaseR, dtR);
        l = rawL * 0.22 * bellows;
        r = rawR * 0.22 * bellows;
      } else {
        // Additive partial path — odd, balanced, sine shapes
        for (let p = 0; p < this.reedN; p++) {
          this.reedLfoPhases[p] += twoPi * this.reedLfoRates[p] * invSr;
          if (this.reedLfoPhases[p] > twoPi) this.reedLfoPhases[p] -= twoPi;
          const wobble = Math.sin(this.reedLfoPhases[p]) * detuneDepth;

          const partialFreq = freq * (p + 1) * (1 + wobble);
          if (partialFreq > nyquist) continue;
          this.reedPhasesL[p] += twoPi * partialFreq * invSr;
          this.reedPhasesR[p] += twoPi * partialFreq * invSr * (1 + detuneDepth * 0.5);
          if (this.reedPhasesL[p] > twoPi) this.reedPhasesL[p] -= twoPi;
          if (this.reedPhasesR[p] > twoPi) this.reedPhasesR[p] -= twoPi;

          this.reedAmpJitterPhases[p] += twoPi * this.reedAmpJitterRates[p] * invSr;
          if (this.reedAmpJitterPhases[p] > twoPi) this.reedAmpJitterPhases[p] -= twoPi;
          const jitter = 1 + Math.sin(this.reedAmpJitterPhases[p]) * 0.08;
          const amp_p = this.reedAmps[p] * bellows * jitter;
          const pan = (p % 2 === 0) ? 1 : 0.85;
          const panR = (p % 2 === 0) ? 0.85 : 1;
          l += fastSin(this.reedPhasesL[p]) * amp_p * pan;
          r += fastSin(this.reedPhasesR[p]) * amp_p * panR;
        }
        // Scale the raw additive stack before the formant bank
        l *= 0.22;
        r *= 0.22;
      }

      // Bellows breath noise — real harmoniums have audible air
      // leakage modulated by bellows pressure. Adds physical breath
      // character that pure additive/saw lacks.
      const breathNoise = (this.rng() * 2 - 1) * 0.008 * bellows;
      l += breathNoise;
      r += breathNoise * 0.92; // slight stereo decorrelation

      // Formant bank — parallel bandpass peaks add body resonance.
      // Each SVF advances one sample on the *clean* scaled stack;
      // its band output is summed into the dry. See initReed() for
      // the shape→formant table and the Q rationale.
      let formL = 0, formR = 0;
      for (let f = 0; f < this.reedFormN; f++) {
        const fc = this.reedFormF[f];
        const dampF = this.reedFormDamp[f];
        const g = this.reedFormGain[f];
        const hL = l - this.reedFormLowL[f] - dampF * this.reedFormBandL[f];
        this.reedFormBandL[f] += fc * hL;
        this.reedFormLowL[f]  += fc * this.reedFormBandL[f];
        const hR = r - this.reedFormLowR[f] - dampF * this.reedFormBandR[f];
        this.reedFormBandR[f] += fc * hR;
        this.reedFormLowR[f]  += fc * this.reedFormBandR[f];
        formL += this.reedFormBandL[f] * g;
        formR += this.reedFormBandR[f] * g;
      }
      l += formL;
      r += formR;

      // Source-level tanh saturation — now applied *after* the
      // formant sum so it acts as the natural amplitude limiter
      // on the combined (partial stack + body) signal. This is
      // both physically more correct (the instrument body colours
      // then the reed bites) and prevents formant state from
      // bleeding unbounded peaks into downstream effects.
      l = Math.tanh(l * 1.6) * 0.7;
      r = Math.tanh(r * 1.6) * 0.7;

      // Presence shelf — one-pole LP subtracted back at 0.3 gain
      // gives ~+2.3 dB shelf above ~3 kHz. Compensates the body
      // energy the formant bank added so the voice doesn't feel
      // dulled after master-bus limiting.
      this.hsReedL = this.hsReedL * 0.6 + l * 0.4;
      this.hsReedR = this.hsReedR * 0.6 + r * 0.4;
      l += (l - this.hsReedL) * 0.3;
      r += (r - this.hsReedR) * 0.3;

      L[i] = l * amp;
      R[i] = r * amp;
    }
};

