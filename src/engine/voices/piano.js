// mdrone voice worklet — PIANO (stretched-harmonic + soundboard + strike) voice.
// Prototype extensions on DroneVoiceProcessor; concatenated
// after core.js by scripts/build-worklet.mjs.

DroneVoiceProcessor.prototype.initPiano = function() {
    this.pianoN = 14;
    this.pianoAmps = new Float32Array([
      1.0, 0.58, 0.42, 0.28, 0.22, 0.14, 0.10, 0.06,
      0.042, 0.03, 0.022, 0.016, 0.012, 0.008,
    ]);
    // Slight inharmonic stretch — real pianos have B ≈ 0.0003..0.0015
    // for the upper partials. We approximate with a near-integer multiplier.
    this.pianoRatios = new Float32Array([
      1.0, 2.004, 3.012, 4.025, 5.04, 6.06, 7.085, 8.11,
      9.14, 10.18, 11.22, 12.27, 13.33, 14.39,
    ]);
    this.pianoPhasesL = new Float32Array(this.pianoN);
    this.pianoPhasesR = new Float32Array(this.pianoN);
    this.pianoDecay = new Float32Array(this.pianoN).fill(1);
    this.pianoDecayRates = new Float32Array(this.pianoN);
    for (let i = 0; i < this.pianoN; i++) {
      this.pianoPhasesL[i] = this.rng() * Math.PI * 2;
      this.pianoPhasesR[i] = this.rng() * Math.PI * 2;
      this.pianoDecayRates[i] = i < 2 ? 0 : 0.000008 + i * 0.000006;
    }
    this.pianoRestrikePhase = 0;
    this.pianoLfoPhase = this.rng() * Math.PI * 2;
    this.pianoLfoRate = 0.09 + this.rng() * 0.08;
    // Strike transient state — fires once at voice start to give the
    // note an attack. Decays over ~220 ms via exp envelope.
    this.pianoStrikeAge = 0;
    this.pianoStrikeDuration = Math.floor(0.22 * sampleRate);
    // Pink noise state for the strike burst (reuses class pink state).

    // Soundboard resonator — two SVF bandpasses simulating the wooden
    // body resonance of a piano soundboard. Without this the voice is
    // raw additive sines, reading as "pad with attack" rather than
    // "sustained piano matter". 220 Hz (body warmth) + 900 Hz
    // (mid presence / wood character). Mixed in parallel.
    this.pianoBodyF    = 2 * Math.sin(Math.PI * 220 / sampleRate);
    this.pianoBodyDamp = 1 / 2;      // Q = 2
    this.pianoBodyLowL  = 0;
    this.pianoBodyBandL = 0;
    this.pianoBodyLowR  = 0;
    this.pianoBodyBandR = 0;
    this.pianoMidF    = 2 * Math.sin(Math.PI * 900 / sampleRate);
    this.pianoMidDamp = 1 / 1.5;    // Q = 1.5
    this.pianoMidLowL  = 0;
    this.pianoMidBandL = 0;
    this.pianoMidLowR  = 0;
    this.pianoMidBandR = 0;
    // Presence shelf state — compensate body energy
    this.hsPianoL = 0;
    this.hsPianoR = 0;
    // Sympathetic string coupling — L/R partials bleed into each
    // other via the shared soundboard, like undamped piano strings
    // resonating sympathetically. Without this the two channels are
    // fully independent additive stacks.
    this.pianoSympathetic = 0.03;
};

DroneVoiceProcessor.prototype.pianoProcess = function(L, R, n, freq, drift, amp) {
    const invSr = 1 / sampleRate;
    const twoPi = Math.PI * 2;
    const detuneDepth = drift * 0.0028;
    const nyquist = sampleRate * 0.45;

    for (let i = 0; i < n; i++) {
      this.pianoLfoPhase += twoPi * this.pianoLfoRate * invSr;
      if (this.pianoLfoPhase > twoPi) this.pianoLfoPhase -= twoPi;
      const breath = 1 + Math.sin(this.pianoLfoPhase) * 0.025;

      this.pianoRestrikePhase += twoPi * 0.08 * invSr;
      if (this.pianoRestrikePhase > twoPi) this.pianoRestrikePhase -= twoPi;
      // Gentle re-excitation — lifts decayed partials back slightly,
      // not fully. 0.3 max avoids broadband noise from resurrected highs.
      const restrike = 0.15 + 0.15 * Math.sin(this.pianoRestrikePhase);

      let l = 0, r = 0;
      for (let p = 0; p < this.pianoN; p++) {
        this.pianoDecay[p] = Math.max(0.08, this.pianoDecay[p] - this.pianoDecayRates[p]);
        const decayEnv = this.pianoDecay[p] + (1 - this.pianoDecay[p]) * restrike * 0.5;

        const wobble = Math.sin(this.pianoLfoPhase * (1 + p * 0.13)) * detuneDepth;
        const partialFreq = freq * this.pianoRatios[p] * (1 + wobble);
        if (partialFreq > nyquist) continue;
        this.pianoPhasesL[p] += twoPi * partialFreq * invSr;
        this.pianoPhasesR[p] += twoPi * partialFreq * invSr * (1 + detuneDepth * 0.45) * this.dichoticMulR;
        if (this.pianoPhasesL[p] > twoPi) this.pianoPhasesL[p] -= twoPi;
        if (this.pianoPhasesR[p] > twoPi) this.pianoPhasesR[p] -= twoPi;

        const a = this.pianoAmps[p] * breath * decayEnv;
        l += fastSin(this.pianoPhasesL[p]) * a;
        r += fastSin(this.pianoPhasesR[p]) * a;
      }
      l *= 0.16;
      r *= 0.16;
      // Sympathetic string coupling — cross-bleed via soundboard
      const pSym = this.pianoSympathetic;
      const plB = l + r * pSym;
      const prB = r + l * pSym;
      l = plB;
      r = prB;

      // Strike transient — a decaying pink-noise burst during the first
      // ~220 ms of the voice. Gives it a hammer-hit attack.
      if (this.pianoStrikeAge < this.pianoStrikeDuration) {
        const t = this.pianoStrikeAge / this.pianoStrikeDuration;
        const strikeEnv = Math.exp(-t * 7);
        const strike = this.pinkNoise() * strikeEnv * 0.2;
        l += strike;
        r += strike * 0.96; // tiny stereo spread
        this.pianoStrikeAge++;
      }

      // Soundboard resonator — parallel bandpass peaks at 220 Hz
      // (body) and 900 Hz (mid/wood). Same SVF technique as tanpura
      // body: band outputs mixed into the dry signal.
      const pbHL = l - this.pianoBodyLowL - this.pianoBodyDamp * this.pianoBodyBandL;
      this.pianoBodyBandL += this.pianoBodyF * pbHL;
      this.pianoBodyLowL  += this.pianoBodyF * this.pianoBodyBandL;
      const pmHL = l - this.pianoMidLowL - this.pianoMidDamp * this.pianoMidBandL;
      this.pianoMidBandL += this.pianoMidF * pmHL;
      this.pianoMidLowL  += this.pianoMidF * this.pianoMidBandL;
      const pbHR = r - this.pianoBodyLowR - this.pianoBodyDamp * this.pianoBodyBandR;
      this.pianoBodyBandR += this.pianoBodyF * pbHR;
      this.pianoBodyLowR  += this.pianoBodyF * this.pianoBodyBandR;
      const pmHR = r - this.pianoMidLowR - this.pianoMidDamp * this.pianoMidBandR;
      this.pianoMidBandR += this.pianoMidF * pmHR;
      this.pianoMidLowR  += this.pianoMidF * this.pianoMidBandR;
      l += this.pianoBodyBandL * 0.15 + this.pianoMidBandL * 0.10;
      r += this.pianoBodyBandR * 0.15 + this.pianoMidBandR * 0.10;

      // Gentle high-frequency rolloff — the 14 partials produce enough
      // brightness naturally. The one-pole LP tames content above ~4 kHz
      // that reveals as "frrr" on bright headphones (DT990 etc).
      this.hsPianoL = this.hsPianoL * 0.12 + l * 0.88;
      this.hsPianoR = this.hsPianoR * 0.12 + r * 0.88;
      l = this.hsPianoL;
      r = this.hsPianoR;

      L[i] = l * amp;
      R[i] = r * amp;
    }
};

  // dominant tonal with a characteristic inharmonic shimmer. Used for
