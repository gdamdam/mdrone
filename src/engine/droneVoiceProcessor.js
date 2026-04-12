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
      case "fm":      this.initFm();      break;
      case "amp":     this.initAmp();     break;
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
    // Body resonator — a 2-pole bandpass at ~150 Hz simulates the
    // gourd resonance of a real tanpura. Mixed in parallel with the
    // KS string output; without it the voice reads slightly "synthy".
    // SVF (Chamberlin) form; state is {low, band} per channel.
    this.ksBodyF = 2 * Math.sin(Math.PI * 150 / sampleRate);
    this.ksBodyDamp = 1 / 4; // Q = 4
    this.ksBodyLowL = 0;
    this.ksBodyBandL = 0;
    this.ksBodyLowR = 0;
    this.ksBodyBandR = 0;
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

      // Body resonator — parallel 150 Hz bandpass feeding the output.
      // SVF at Q=4 gives a prominent gourd-like mid-low coloration
      // that the raw KS string lacks. 0.12 mix keeps it subtle.
      const bodyHighL = y - this.ksBodyLowL - this.ksBodyDamp * this.ksBodyBandL;
      this.ksBodyBandL += this.ksBodyF * bodyHighL;
      this.ksBodyLowL += this.ksBodyF * this.ksBodyBandL;
      const bodyHighR = yR - this.ksBodyLowR - this.ksBodyDamp * this.ksBodyBandR;
      this.ksBodyBandR += this.ksBodyF * bodyHighR;
      this.ksBodyLowR += this.ksBodyF * this.ksBodyBandR;

      L[i] = (y + this.ksBodyBandL * 0.12) * amp;
      R[i] = (yR + this.ksBodyBandR * 0.12) * amp;
    }
  }

  doPluck(delayLen, delayLenR) {
    // Fill delay lines with a band-limited noise excitation. A one-
    // pole IIR lowpass (corner ~2.5 kHz at 48 kHz) replaces the old
    // 2-sample moving-average smoothing so the pluck transient doesn't
    // slam downstream effects — notably PLATE's input diffuser — with
    // full-spectrum white-noise content. That full-spectrum hit was
    // audible as a brief "frrrrr" of dense allpass coloration every
    // re-pluck (~every 3 s). The filter corner sits above the string
    // fundamental and first few harmonics but below the 3–10 kHz range
    // where the diffuser ringing lived, so the sustained string
    // timbre is unchanged while the attack stops exciting the chain.
    // Real tanpura plucks are mid-rich, not bright white bursts
    // either — this is more physically plausible, not less.
    const lpCoef = 0.32;
    let lpL = 0;
    for (let i = 0; i < delayLen; i++) {
      const n = (this.rng() * 2 - 1);
      lpL += lpCoef * (n - lpL);
      // Slightly higher scale than the old 0.7 compensates for the
      // RMS loss from the stronger lowpass so perceived attack
      // loudness is similar to before.
      this.ksBuf[i] = lpL * 0.9;
    }
    let lpR = 0;
    for (let i = 0; i < delayLenR; i++) {
      const n = (this.rng() * 2 - 1);
      lpR += lpCoef * (n - lpR);
      this.ksBufR[i] = lpR * 0.9;
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

    // Formant layer — static bandpass peaks that give the additive
    // harmonic stack a "body". Without this the reed reads as "7
    // sines + LFO"; with it, it reads as sines *through* a physical
    // resonator. Shape picks the formant set:
    //   odd      — shruti/clarinet: bright upper body
    //   even     — bowed string: classic cello/viola body
    //   balanced — pipe organ / vocal "ahh" formant
    //   sine     — none (pure fundamental bypasses formants)
    // Each entry: [centerHz, Q, mixGain]. Gains are small because
    // the SVF bandpass output at resonance is Q× the input, so
    // 0.08 × 4 ≈ +10 dB at the formant frequency — natural body.
    const FORMANTS = {
      odd:      [[500, 4, 0.09], [1200, 3, 0.07], [2500, 3, 0.05]],
      even:     [[300, 3, 0.09], [700, 4, 0.08], [1400, 4, 0.05]],
      balanced: [[400, 3, 0.09], [900, 3, 0.08], [1800, 3, 0.05]],
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

      // Formant bank — parallel bandpass peaks add body resonance.
      // Each SVF advances one sample; its band output is mixed in
      // with a static gain. See initReed() for shape→formant table.
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
      // Every ~256 samples, pick new random walk targets.
      // Per-partial breadth: low modes (p<2) are the bowl's stable
      // fundamental — they barely walk. High modes (p>=2) are the
      // "deformation modes" that physically fade in and out as the
      // bowl settles and re-excites, so they walk across a wider
      // range. This is what makes a real bowl sound alive rather
      // than a uniformly-randomised additive stack.
      this.metalTickCounter++;
      if ((this.metalTickCounter & 255) === 0) {
        for (let p = 0; p < this.metalN; p++) {
          const breadth = p < 2 ? 0.08 : 0.26 + p * 0.03;
          const center  = p < 2 ? 0.99 : 0.78;
          this.metalAmpTargets[p] = center - breadth * 0.5 + this.rng() * breadth;
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
    // 5 resonators (was 3) at semi-inharmonic ratios so the air
    // voice reads as "rustling wind with pitched energy" instead of
    // the strictly-harmonic whistle the old 1/2/3 ratios produced.
    this.airN = 5;
    this.airRatios = new Float32Array([1.0, 1.48, 2.07, 2.93, 4.16]);
    this.airAmps   = new Float32Array([0.48, 0.32, 0.24, 0.18, 0.12]);
    this.airPans   = new Float32Array([0.0, -0.3, 0.28, -0.15, 0.18]);
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
      case "fm":      this.fmProcess(L, R, n, freq, drift, amp); break;
      case "amp":     this.ampProcess(L, R, n, freq, drift, amp); break;
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
    // Strike transient state — fires once at voice start to give the
    // note an attack. Decays over ~220 ms via exp envelope.
    this.pianoStrikeAge = 0;
    this.pianoStrikeDuration = Math.floor(0.22 * sampleRate);
    // Pink noise state for the strike burst (reuses class pink state).
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

      // Strike transient — a decaying pink-noise burst during the first
      // ~220 ms of the voice. Gives it a hammer-hit attack.
      if (this.pianoStrikeAge < this.pianoStrikeDuration) {
        const t = this.pianoStrikeAge / this.pianoStrikeDuration;
        const strikeEnv = Math.exp(-t * 7);
        const strike = this.pinkNoise() * strikeEnv * 0.35;
        l += strike;
        r += strike * 0.96; // tiny stereo spread
        this.pianoStrikeAge++;
      }

      L[i] = l * amp;
      R[i] = r * amp;
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // FM — 2-op FM synthesis (carrier + modulator). Fixed ratio for a
  // dominant tonal with a characteristic inharmonic shimmer. Used for
  // Coil Time Machines / DX7-era bell drones.
  // ═══════════════════════════════════════════════════════════════════
  initFm() {
    this.fmCarrierPhaseL = this.rng() * Math.PI * 2;
    this.fmCarrierPhaseR = this.rng() * Math.PI * 2;
    this.fmModPhase = this.rng() * Math.PI * 2;
    this.fmRatio = 2.0;    // modulator : carrier frequency ratio
    this.fmIndex = 2.4;    // modulation index (sideband richness)
    this.fmLfoPhase = this.rng() * Math.PI * 2;
    this.fmLfoRate = 0.08 + this.rng() * 0.06;
    // Slow index-envelope LFO — modulates fmIndex across ~±55 % so
    // the bell "rings out" and comes back over a 30-50 s period.
    // Fixed 2.0 index is audibly static; this is what turns a dead
    // DX7-style bell into a living one.
    this.fmIndexLfoPhase = this.rng() * Math.PI * 2;
    this.fmIndexLfoRate = 0.015 + this.rng() * 0.012;
  }

  fmProcess(L, R, n, freq, drift, amp) {
    const invSr = 1 / sampleRate;
    const twoPi = Math.PI * 2;
    const depth = drift * 0.004;

    for (let i = 0; i < n; i++) {
      this.fmLfoPhase += twoPi * this.fmLfoRate * invSr;
      if (this.fmLfoPhase > twoPi) this.fmLfoPhase -= twoPi;
      const breath = 1 + Math.sin(this.fmLfoPhase) * 0.035;

      // Slow index envelope — sidebands bloom and recede over tens
      // of seconds so the voice is never harmonically static.
      this.fmIndexLfoPhase += twoPi * this.fmIndexLfoRate * invSr;
      if (this.fmIndexLfoPhase > twoPi) this.fmIndexLfoPhase -= twoPi;
      const dynIndex = this.fmIndex * (1 + Math.sin(this.fmIndexLfoPhase) * 0.55);

      // Modulator oscillator
      const modFreq = freq * this.fmRatio * (1 + depth);
      this.fmModPhase += twoPi * modFreq * invSr;
      if (this.fmModPhase > twoPi) this.fmModPhase -= twoPi;
      const modOut = Math.sin(this.fmModPhase) * dynIndex * freq;

      // Carrier oscillators — frequency-modulated by the modulator
      const cFreq = freq + modOut;
      this.fmCarrierPhaseL += twoPi * cFreq * invSr;
      this.fmCarrierPhaseR += twoPi * cFreq * invSr * (1 + depth * 0.6);
      while (this.fmCarrierPhaseL >  twoPi) this.fmCarrierPhaseL -= twoPi;
      while (this.fmCarrierPhaseL < -twoPi) this.fmCarrierPhaseL += twoPi;
      while (this.fmCarrierPhaseR >  twoPi) this.fmCarrierPhaseR -= twoPi;
      while (this.fmCarrierPhaseR < -twoPi) this.fmCarrierPhaseR += twoPi;

      const s = breath * 0.22;
      L[i] = Math.sin(this.fmCarrierPhaseL) * s * amp;
      R[i] = Math.sin(this.fmCarrierPhaseR) * s * amp;
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // AMP — distorted amplifier voice. An additive harmonic source pushed
  // hard through tanh saturation with a simulated cabinet low-pass.
  // Used for drone-metal presets (Sunn O))), Earth, Pyroclasts).
  // ═══════════════════════════════════════════════════════════════════
  initAmp() {
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
  }

  ampProcess(L, R, n, freq, drift, amp) {
    const invSr = 1 / sampleRate;
    const twoPi = Math.PI * 2;
    const detuneDepth = drift * 0.005;
    // Final cabinet rolloff lowpass — raised to 5 kHz (was 2.8 kHz)
    // so the presence BPF peak at 3.5 kHz actually passes through.
    const cabCoef = Math.exp(-twoPi * 5000 * invSr);

    for (let i = 0; i < n; i++) {
      this.ampLfoPhase += twoPi * this.ampLfoRate * invSr;
      if (this.ampLfoPhase > twoPi) this.ampLfoPhase -= twoPi;
      const swell = 1 + Math.sin(this.ampLfoPhase) * 0.12;

      let l = 0, r = 0;
      for (let p = 0; p < this.ampN; p++) {
        const wobble = Math.sin(this.ampLfoPhase * (1 + p * 0.17)) * detuneDepth;
        const partialFreq = freq * (p + 1) * (1 + wobble);
        this.ampPhasesL[p] += twoPi * partialFreq * invSr;
        this.ampPhasesR[p] += twoPi * partialFreq * invSr * (1 + detuneDepth * 0.7);
        if (this.ampPhasesL[p] > twoPi) this.ampPhasesL[p] -= twoPi;
        if (this.ampPhasesR[p] > twoPi) this.ampPhasesR[p] -= twoPi;

        l += Math.sin(this.ampPhasesL[p]) * this.ampAmps[p];
        r += Math.sin(this.ampPhasesR[p]) * this.ampAmps[p];
      }
      l *= swell;
      r *= swell;
      // Hard saturation — the "amp distortion"
      l = Math.tanh(l * 3.8) * 0.72;
      r = Math.tanh(r * 3.8) * 0.72;

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
      L[i] = this.ampCabL * amp;
      R[i] = this.ampCabR * amp;
    }
  }
}

registerProcessor("drone-voice", DroneVoiceProcessor);
