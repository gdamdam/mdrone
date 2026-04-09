/**
 * droneVoiceProcessor — the authored voice engine for mdrone.
 *
 * Runs as a single AudioWorkletProcessor per voice instance. Each
 * instance implements one of four voice types as its own physical /
 * spectral model, with per-partial slow modulation that keeps the
 * source tone alive at long sustain and low note density — without
 * relying on reverb to fake depth.
 *
 *   TANPURA  — Karplus-Strong string with "jawari" nonlinearity,
 *              auto-repluck cycle, stereo-offset tap
 *   REED     — additive odd-heavy harmonic stack with per-partial
 *              slow pitch wobble and bellows amplitude modulation
 *   METAL    — inharmonic partial stack with independent per-partial
 *              amplitude random walks + detune drift + stereo spread
 *   AIR      — pink noise through 3 modulated state-variable bandpass
 *              resonators at harmonic ratios
 *
 * Parameters (AudioParams, k-rate):
 *   freq  — fundamental frequency in Hz
 *   drift — 0..1, global detune spread scale
 *   amp   — 0..1, output trim multiplier
 *
 * Construction options (processorOptions):
 *   voiceType — "tanpura" | "reed" | "metal" | "air"
 *   seed      — integer, for deterministic per-voice variation
 *
 * Global sampleRate and currentTime are available in this scope
 * (AudioWorkletGlobalScope).
 */

/* sampleRate, AudioWorkletProcessor, registerProcessor are globals in AudioWorkletGlobalScope */
/* global sampleRate, AudioWorkletProcessor, registerProcessor */

// ─── Mulberry32 PRNG — seeded, deterministic, cheap ──────────────────
function makeRng(seed) {
  let state = (seed * 2654435761) | 0;
  return () => {
    state = (state + 1831565813) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class DroneVoiceProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "freq",  defaultValue: 220, minValue: 20, maxValue: 8000, automationRate: "k-rate" },
      { name: "drift", defaultValue: 0.3, minValue: 0,  maxValue: 1,    automationRate: "k-rate" },
      { name: "amp",   defaultValue: 0,   minValue: 0,  maxValue: 2,    automationRate: "k-rate" },
      // Tanpura re-pluck rate multiplier. 1 = default (2.5..4.5 s
      // between plucks, the normal tanpura cycle). 0.2 slows to
      // ~15 s per string; 4 speeds to ~0.7 s. Ignored by non-tanpura
      // voices.
      { name: "pluckRate", defaultValue: 1, minValue: 0.2, maxValue: 4, automationRate: "k-rate" },
    ];
  }

  constructor(options) {
    super();
    const opts = options?.processorOptions || {};
    this.voiceType = opts.voiceType || "tanpura";
    this.reedShape = opts.reedShape || "odd";
    this.seed = opts.seed || 1;
    this.rng = makeRng(this.seed);

    // Termination flag — main thread posts {type:"stop"} when the
    // voice is retired. process() returns false once set, so the
    // worklet processor is GC-eligible instead of running forever.
    this.stopped = false;
    this.port.onmessage = (e) => {
      if (e.data && e.data.type === "stop") this.stopped = true;
    };

    // Pink noise filter state (Paul Kellet) — shared by voices that need it
    this.pink = { b0: 0, b1: 0, b2: 0, b3: 0, b4: 0, b5: 0, b6: 0 };

    // Per-voice init
    switch (this.voiceType) {
      case "tanpura": this.initTanpura(); break;
      case "reed":    this.initReed();    break;
      case "metal":   this.initMetal();   break;
      case "air":     this.initAir();     break;
      case "piano":   this.initPiano();   break;
      default:        this.initTanpura(); break;
    }
  }

  // ── PINK NOISE (shared helper) ───────────────────────────────────
  pinkNoise() {
    const p = this.pink;
    const white = Math.random() * 2 - 1;
    p.b0 = 0.99886 * p.b0 + white * 0.0555179;
    p.b1 = 0.99332 * p.b1 + white * 0.0750759;
    p.b2 = 0.969  * p.b2 + white * 0.153852;
    p.b3 = 0.8665 * p.b3 + white * 0.3104856;
    p.b4 = 0.55   * p.b4 + white * 0.5329522;
    p.b5 = -0.7616 * p.b5 - white * 0.016898;
    const out = p.b0 + p.b1 + p.b2 + p.b3 + p.b4 + p.b5 + p.b6 + white * 0.5362;
    p.b6 = white * 0.115926;
    return out * 0.11;
  }

  // ═══════════════════════════════════════════════════════════════════
  // TANPURA — Karplus-Strong string with jawari-style nonlinearity
  // ═══════════════════════════════════════════════════════════════════
  initTanpura() {
    // Max delay line sized for 25 Hz (40 ms) — comfortably below any
    // musical note we'd play.
    this.ksMax = Math.ceil(sampleRate * 0.04) + 8;
    this.ksBuf = new Float32Array(this.ksMax);
    // Second delay line for the stereo tap with a different short offset,
    // simulating two microphones on opposite sides of the string.
    this.ksBufR = new Float32Array(this.ksMax);
    this.ksIdx = 0;
    this.ksIdxR = 0;
    // Auto-repluck cycle — tanpura players cycle through 4 strings.
    this.pluckCountdown = 0.2; // first pluck almost immediately
    this.pluckPhase = 0;       // 0..3, cycles through 4 "strings"
    // Simple one-pole lowpass state for feedback damping
    this.ksLast = 0;
    this.ksLastR = 0;
  }

  tanpuraProcess(L, R, n, freq, drift, amp, pluckRate) {
    // Physical delay length in samples, clamped to available buffer
    const baseLen = sampleRate / Math.max(20, freq);
    // Tanpura strings are typically: Pa (5th), Sa, Sa, Sa (up an octave,
    // same octave, same octave) — we approximate with a 4-step cycle
    // where the offset modifies the fundamental ratio per pluck.
    const stringRatios = [1.5, 1.0, 1.0, 0.5];
    const ratio = stringRatios[this.pluckPhase];
    const delayLen = Math.min(this.ksMax - 2, Math.max(8, Math.floor(baseLen / ratio)));
    const delayLenR = Math.min(this.ksMax - 2, Math.max(8, Math.floor(baseLen / ratio * 1.003))); // 5 cents offset for stereo width

    // Feedback decay — keep string alive for several seconds
    const damping = 0.9985 - drift * 0.0015; // drift slightly shortens sustain
    // Jawari nonlinearity — a compound curve that emphasizes upper
    // harmonics in a way plain tanh doesn't. The sin term injects
    // additional odd-harmonic content at amplitude extremes.
    const jawK = 1.1;
    const jawMix = 0.22;

    // Pluck scheduling
    this.pluckCountdown -= n / sampleRate;
    if (this.pluckCountdown <= 0) {
      this.doPluck(delayLen, delayLenR);
      this.pluckPhase = (this.pluckPhase + 1) % 4;
      // 2.5..4.5 s between plucks — human tanpura cycle.
      // Divided by the pluckRate AudioParam so the rate can be
      // sped up or slowed down live.
      const pr = Math.max(0.05, pluckRate || 1);
      this.pluckCountdown = (2.5 + this.rng() * 2) / pr;
    }

    // Denormal anti-burn offset — keeps the feedback loop above the
    // denormal threshold (~1e-38) which would otherwise cause 10-100x
    // CPU slowdowns on x86 as samples decay toward zero.
    const ANTI_DENORMAL = 1e-25;

    for (let i = 0; i < n; i++) {
      // Read current sample, average with next for one-pole lowpass
      const cur = this.ksBuf[this.ksIdx];
      const nxt = this.ksBuf[(this.ksIdx + 1) % delayLen];
      let y = (cur + nxt) * 0.5 + ANTI_DENORMAL;
      // Additional gentle lowpass smoothing (string body)
      this.ksLast = this.ksLast * 0.2 + y * 0.8;
      y = this.ksLast * damping;
      // Jawari: nonlinear shaping that emphasizes overtones
      const jy = Math.tanh(jawK * y) + jawMix * Math.sin(jawK * 2.1 * y);
      y = y * 0.78 + jy * 0.22;
      this.ksBuf[this.ksIdx] = y;
      this.ksIdx = (this.ksIdx + 1) % delayLen;
      L[i] = y * amp;

      // Right channel — independent delay line with slight offset
      const curR = this.ksBufR[this.ksIdxR];
      const nxtR = this.ksBufR[(this.ksIdxR + 1) % delayLenR];
      let yR = (curR + nxtR) * 0.5 + ANTI_DENORMAL;
      this.ksLastR = this.ksLastR * 0.2 + yR * 0.8;
      yR = this.ksLastR * damping;
      const jyR = Math.tanh(jawK * yR) + jawMix * Math.sin(jawK * 2.1 * yR);
      yR = yR * 0.78 + jyR * 0.22;
      this.ksBufR[this.ksIdxR] = yR;
      this.ksIdxR = (this.ksIdxR + 1) % delayLenR;
      R[i] = yR * amp;
    }
  }

  doPluck(delayLen, delayLenR) {
    // Fill delay lines with band-limited noise burst.
    // A short 50% amplitude burst filtered by a moving average gives
    // a characteristic plucked attack.
    let last = 0;
    for (let i = 0; i < delayLen; i++) {
      const n = (this.rng() * 2 - 1);
      const smoothed = (n + last) * 0.5;
      this.ksBuf[i] = smoothed * 0.7;
      last = n;
    }
    let lastR = 0;
    for (let i = 0; i < delayLenR; i++) {
      const n = (this.rng() * 2 - 1);
      const smoothed = (n + lastR) * 0.5;
      this.ksBufR[i] = smoothed * 0.7;
      lastR = n;
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // REED — harmonium/shruti-box free-reed additive synthesis
  // ═══════════════════════════════════════════════════════════════════
  initReed() {
    // 7 partials. The shape parameter picks an amplitude curve:
    //   odd      — clarinet/shruti/harmonium (default, original)
    //   even     — bowed string (SOTL, Górecki) — even partials emphasised
    //   balanced — pipe organ, choral "ahh" (Malone) — both odd and even
    //   sine     — pure fundamental (Dream House, Radigue ARP 2500)
    this.reedN = 7;
    const REED_AMPS = {
      odd:      [0.55, 0.28, 0.38, 0.13, 0.24, 0.07, 0.16],
      even:     [0.55, 0.48, 0.20, 0.36, 0.14, 0.24, 0.08],
      balanced: [0.60, 0.40, 0.34, 0.26, 0.20, 0.14, 0.10],
      sine:     [1.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00],
    };
    const amps = REED_AMPS[this.reedShape] || REED_AMPS.odd;
    this.reedAmps     = new Float32Array(amps);
    this.reedPhasesL  = new Float32Array(this.reedN);
    this.reedPhasesR  = new Float32Array(this.reedN);
    // Per-partial slow LFO state (0.08..0.28 Hz randomized)
    this.reedLfoPhases = new Float32Array(this.reedN);
    this.reedLfoRates  = new Float32Array(this.reedN);
    for (let i = 0; i < this.reedN; i++) {
      this.reedPhasesL[i] = this.rng() * Math.PI * 2;
      this.reedPhasesR[i] = this.rng() * Math.PI * 2;
      this.reedLfoPhases[i] = this.rng() * Math.PI * 2;
      this.reedLfoRates[i] = 0.08 + this.rng() * 0.2;
    }
    // Bellows amplitude LFO — slow, shared
    this.bellowsPhase = 0;
    this.bellowsRate = 0.22 + this.rng() * 0.08;
  }

  reedProcess(L, R, n, freq, drift, amp) {
    const invSr = 1 / sampleRate;
    const twoPi = Math.PI * 2;
    // Drift → per-partial detune depth (max ±8 cents)
    const detuneDepth = drift * 0.0046; // in cent-ratio (8 cents ≈ 0.0046)

    for (let i = 0; i < n; i++) {
      // Advance bellows amplitude LFO
      this.bellowsPhase += twoPi * this.bellowsRate * invSr;
      if (this.bellowsPhase > twoPi) this.bellowsPhase -= twoPi;
      const bellows = 1 + Math.sin(this.bellowsPhase) * 0.04; // ±4%

      let l = 0, r = 0;
      for (let p = 0; p < this.reedN; p++) {
        // Advance partial's slow LFO (drives detune)
        this.reedLfoPhases[p] += twoPi * this.reedLfoRates[p] * invSr;
        if (this.reedLfoPhases[p] > twoPi) this.reedLfoPhases[p] -= twoPi;
        const wobble = Math.sin(this.reedLfoPhases[p]) * detuneDepth;

        const partialFreq = freq * (p + 1) * (1 + wobble);
        // Advance phase accumulators
        this.reedPhasesL[p] += twoPi * partialFreq * invSr;
        this.reedPhasesR[p] += twoPi * partialFreq * invSr * (1 + detuneDepth * 0.5); // tiny stereo detune
        if (this.reedPhasesL[p] > twoPi) this.reedPhasesL[p] -= twoPi;
        if (this.reedPhasesR[p] > twoPi) this.reedPhasesR[p] -= twoPi;

        const amp_p = this.reedAmps[p] * bellows;
        // Odd partials lean left, even lean right — subtle stereo
        const pan = (p % 2 === 0) ? 1 : 0.85; // left weight
        const panR = (p % 2 === 0) ? 0.85 : 1;
        l += Math.sin(this.reedPhasesL[p]) * amp_p * pan;
        r += Math.sin(this.reedPhasesR[p]) * amp_p * panR;
      }
      // Output scaling + subtle source-level tanh saturation for reed bite
      l *= 0.22;
      r *= 0.22;
      l = Math.tanh(l * 1.6) * 0.7;
      r = Math.tanh(r * 1.6) * 0.7;
      L[i] = l * amp;
      R[i] = r * amp;
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // METAL — inharmonic partials with independent random walks
  // ═══════════════════════════════════════════════════════════════════
  initMetal() {
    // Bowl-like modal layout. Tibetan singing bowls are dominated by a
    // low fundamental mode plus sparse higher deformation modes whose
    // frequencies rise much faster than the harmonic series; struck
    // spectra also exhibit split low peaks because real bowls are not
    // perfectly symmetric.
    this.metalN = 7;
    this.metalRatios = new Float32Array([1.0, 1.006, 2.23, 2.27, 3.98, 6.18, 8.92]);
    this.metalBaseAmps = new Float32Array([0.88, 0.28, 0.30, 0.18, 0.12, 0.07, 0.04]);
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
  }

  metalProcess(L, R, n, freq, drift, amp) {
    const invSr = 1 / sampleRate;
    const twoPi = Math.PI * 2;
    const driftDepth = drift * 0.0024; // keep the bowl centered; max ~4 cents walk

    for (let i = 0; i < n; i++) {
      // Every ~256 samples, pick new random walk targets
      this.metalTickCounter++;
      if ((this.metalTickCounter & 255) === 0) {
        for (let p = 0; p < this.metalN; p++) {
          this.metalAmpTargets[p] = 0.93 + this.rng() * 0.14;
          this.metalDetuneTargets[p] = (this.rng() * 2 - 1) * driftDepth;
        }
      }

      let l = 0, r = 0;
      for (let p = 0; p < this.metalN; p++) {
        // Advance walk toward targets with slow exponential
        this.metalAmpWalks[p] += (this.metalAmpTargets[p] - this.metalAmpWalks[p]) * 0.000015;
        this.metalDetuneWalks[p] += (this.metalDetuneTargets[p] - this.metalDetuneWalks[p]) * 0.000015;
        this.metalWalkPhases[p] += twoPi * this.metalWalkRates[p] * invSr;
        if (this.metalWalkPhases[p] > twoPi) this.metalWalkPhases[p] -= twoPi;

        const partialFreq = freq * this.metalRatios[p] * (1 + this.metalDetuneWalks[p]);
        this.metalPhasesL[p] += twoPi * partialFreq * invSr;
        this.metalPhasesR[p] += twoPi * partialFreq * invSr * 1.00018; // preserve center image
        if (this.metalPhasesL[p] > twoPi) this.metalPhasesL[p] -= twoPi;
        if (this.metalPhasesR[p] > twoPi) this.metalPhasesR[p] -= twoPi;

        const beat = 0.94 + 0.06 * Math.sin(this.metalWalkPhases[p]);
        const amp_p = this.metalBaseAmps[p] * this.metalAmpWalks[p] * beat;
        const pan = this.metalPans[p];
        const lGain = amp_p * (1 - Math.max(0, pan));
        const rGain = amp_p * (1 - Math.max(0, -pan));
        l += Math.sin(this.metalPhasesL[p]) * lGain;
        r += Math.sin(this.metalPhasesR[p]) * rGain;
      }
      l *= 0.34;
      r *= 0.34;
      // Keep the source comparatively pure; bowls read better when the
      // upper modes stay narrow instead of being driven into brightness.
      l = Math.tanh(l * 0.9);
      r = Math.tanh(r * 0.9);
      L[i] = l * amp;
      R[i] = r * amp;
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // AIR — pink noise through 3 modulated state-variable resonators
  // ═══════════════════════════════════════════════════════════════════
  initAir() {
    this.airN = 3;
    this.airRatios = new Float32Array([1.0, 2.0, 3.0]);
    this.airAmps   = new Float32Array([0.55, 0.30, 0.16]);
    this.airPans   = new Float32Array([0.0, -0.25, 0.25]);
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
    // Independent pink noise states for L and R to avoid mono
    this.pinkR = { b0: 0, b1: 0, b2: 0, b3: 0, b4: 0, b5: 0, b6: 0 };
    // High-shelf state for air character (one-pole)
    this.hsL = 0;
    this.hsR = 0;
  }

  // Second pink noise generator (uses pinkR state) for independent R channel
  pinkNoiseR() {
    const p = this.pinkR;
    const white = Math.random() * 2 - 1;
    p.b0 = 0.99886 * p.b0 + white * 0.0555179;
    p.b1 = 0.99332 * p.b1 + white * 0.0750759;
    p.b2 = 0.969  * p.b2 + white * 0.153852;
    p.b3 = 0.8665 * p.b3 + white * 0.3104856;
    p.b4 = 0.55   * p.b4 + white * 0.5329522;
    p.b5 = -0.7616 * p.b5 - white * 0.016898;
    const out = p.b0 + p.b1 + p.b2 + p.b3 + p.b4 + p.b5 + p.b6 + white * 0.5362;
    p.b6 = white * 0.115926;
    return out * 0.11;
  }

  airProcess(L, R, n, freq, drift, amp) {
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

      const noiseL = this.pinkNoise() * 4.5;
      const noiseR = this.pinkNoiseR() * 4.5;

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
  }

  // ═══════════════════════════════════════════════════════════════════
  // Main process dispatch
  // ═══════════════════════════════════════════════════════════════════
  process(_inputs, outputs, parameters) {
    if (this.stopped) return false;
    const output = outputs[0];
    if (!output || output.length === 0) return true;
    const L = output[0];
    const R = output.length > 1 ? output[1] : output[0];
    const n = L.length;

    const freq  = parameters.freq[0];
    const drift = parameters.drift[0];
    const amp   = parameters.amp[0];
    const pluckRate = parameters.pluckRate ? parameters.pluckRate[0] : 1;

    // If amp is 0 and we're silent, skip processing to save CPU.
    // (Voices ramp amp up/down externally, so brief silence is normal.)
    if (amp < 0.0001) {
      for (let i = 0; i < n; i++) { L[i] = 0; if (R !== L) R[i] = 0; }
      return true;
    }

    switch (this.voiceType) {
      case "tanpura": this.tanpuraProcess(L, R, n, freq, drift, amp, pluckRate); break;
      case "reed":    this.reedProcess(L, R, n, freq, drift, amp); break;
      case "metal":   this.metalProcess(L, R, n, freq, drift, amp); break;
      case "air":     this.airProcess(L, R, n, freq, drift, amp); break;
      case "piano":   this.pianoProcess(L, R, n, freq, drift, amp); break;
    }
    return true;
  }

  // ═══════════════════════════════════════════════════════════════════
  // PIANO — decaying harmonic stack with slight inharmonic stretch.
  // Used as a sustained "drone-ified" piano by looping the held state
  // forever (no release). Signature features:
  //  - 8 partials with strong fundamental, decreasing higher partials
  //  - slight inharmonic stretch (real piano partials go marginally sharp)
  //  - very subtle slow breath LFO for life, no bellows saturation
  //  - stereo via per-partial offset accumulators
  // ═══════════════════════════════════════════════════════════════════
  initPiano() {
    this.pianoN = 8;
    this.pianoAmps = new Float32Array([1.0, 0.58, 0.42, 0.28, 0.22, 0.14, 0.10, 0.06]);
    // Slight inharmonic stretch — real pianos have B ≈ 0.0003..0.0015
    // for the upper partials. We approximate with a near-integer multiplier.
    this.pianoRatios = new Float32Array([1.0, 2.004, 3.012, 4.025, 5.04, 6.06, 7.085, 8.11]);
    this.pianoPhasesL = new Float32Array(this.pianoN);
    this.pianoPhasesR = new Float32Array(this.pianoN);
    for (let i = 0; i < this.pianoN; i++) {
      this.pianoPhasesL[i] = this.rng() * Math.PI * 2;
      this.pianoPhasesR[i] = this.rng() * Math.PI * 2;
    }
    this.pianoLfoPhase = this.rng() * Math.PI * 2;
    this.pianoLfoRate = 0.09 + this.rng() * 0.08;
  }

  pianoProcess(L, R, n, freq, drift, amp) {
    const invSr = 1 / sampleRate;
    const twoPi = Math.PI * 2;
    const detuneDepth = drift * 0.0028;

    for (let i = 0; i < n; i++) {
      this.pianoLfoPhase += twoPi * this.pianoLfoRate * invSr;
      if (this.pianoLfoPhase > twoPi) this.pianoLfoPhase -= twoPi;
      const breath = 1 + Math.sin(this.pianoLfoPhase) * 0.025;

      let l = 0, r = 0;
      for (let p = 0; p < this.pianoN; p++) {
        const wobble = Math.sin(this.pianoLfoPhase * (1 + p * 0.13)) * detuneDepth;
        const partialFreq = freq * this.pianoRatios[p] * (1 + wobble);
        this.pianoPhasesL[p] += twoPi * partialFreq * invSr;
        this.pianoPhasesR[p] += twoPi * partialFreq * invSr * (1 + detuneDepth * 0.45);
        if (this.pianoPhasesL[p] > twoPi) this.pianoPhasesL[p] -= twoPi;
        if (this.pianoPhasesR[p] > twoPi) this.pianoPhasesR[p] -= twoPi;

        const a = this.pianoAmps[p] * breath;
        l += Math.sin(this.pianoPhasesL[p]) * a;
        r += Math.sin(this.pianoPhasesR[p]) * a;
      }
      l *= 0.16;
      r *= 0.16;
      L[i] = l * amp;
      R[i] = r * amp;
    }
  }
}

registerProcessor("drone-voice", DroneVoiceProcessor);
