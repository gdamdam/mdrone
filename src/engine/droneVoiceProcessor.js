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

// ─── Sine wavetable — replaces per-sample Math.sin in hot loops ──
const SINE_TABLE_SIZE = 4096;
const SINE_TABLE = new Float32Array(SINE_TABLE_SIZE + 1); // +1 for lerp guard
for (let i = 0; i <= SINE_TABLE_SIZE; i++) {
  SINE_TABLE[i] = Math.sin((i / SINE_TABLE_SIZE) * Math.PI * 2);
}
const SINE_INC = SINE_TABLE_SIZE / (Math.PI * 2);
function fastSin(phase) {
  const idx = ((phase % 6.283185307179586) + 6.283185307179586) * SINE_INC;
  const i = idx | 0;
  return SINE_TABLE[i % SINE_TABLE_SIZE] + (idx - i) * (SINE_TABLE[(i + 1) % SINE_TABLE_SIZE] - SINE_TABLE[i % SINE_TABLE_SIZE]);
}

// ─── PolyBLEP — bandlimited discontinuity correction ────────────
// Used by the reed "even" (bowed-string) shape to produce a
// sawtooth with natural harmonic content instead of summing sines.
function polyblep(phase01, dt) {
  if (phase01 < dt) {
    const t = phase01 / dt;
    return t + t - t * t - 1;
  }
  if (phase01 > 1 - dt) {
    const t = (phase01 - 1) / dt;
    return t * t + t + t + 1;
  }
  return 0;
}

class DroneVoiceProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "freq",  defaultValue: 220, minValue: 20, maxValue: 8000, automationRate: "k-rate" },
      { name: "drift", defaultValue: 0.3, minValue: 0,  maxValue: 1,    automationRate: "k-rate" },
      { name: "amp",   defaultValue: 0,   minValue: 0,  maxValue: 2,    automationRate: "k-rate" },
      // Tanpura re-pluck rate multiplier. 1 = default (2.5..4.5 s
      // between plucks). 0 = hold (infinite sustain, no repluck).
      // 0.2 = ~15 s per string; 4 = ~0.7 s. Ignored by non-tanpura.
      { name: "pluckRate", defaultValue: 1, minValue: 0, maxValue: 4, automationRate: "k-rate" },
    ];
  }

  constructor(options) {
    super();
    const opts = options?.processorOptions || {};
    this.voiceType = opts.voiceType || "tanpura";
    this.reedShape = opts.reedShape || "odd";
    this.fmRatioOpt = opts.fmRatio || 2.0;
    this.fmIndexOpt = opts.fmIndex || 2.4;
    this.fmFeedbackOpt = opts.fmFeedback || 0;
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
  }

  // ═══════════════════════════════════════════════════════════════════
  // TANPURA — Karplus-Strong string with jawari-style nonlinearity
  // ═══════════════════════════════════════════════════════════════════
  initTanpura() {
    // 4 independent strings — Pa (5th), Sa, Sa, Sa (low octave).
    // Each string is a stereo KS delay-line pair that rings
    // simultaneously. Strings are plucked in rotation so they
    // overlap naturally, producing the continuous interference
    // pattern that defines tanpura sound.
    this.NUM_STRINGS = 4;
    this.stringRatios = [1.5, 1.0, 1.0, 0.5];
    // Per-string stereo pan positions — spread across the stereo field
    this.stringPans = [0.7, 0.9, 1.0, 0.8]; // L gain multipliers
    this.stringPansR = [1.0, 0.8, 0.7, 0.9]; // R gain multipliers
    // Max delay line sized for 25 Hz at lowest ratio (0.5)
    this.ksMax = Math.ceil(sampleRate * 0.08) + 8;
    // Allocate per-string state
    this.ksBufs = [];
    this.ksBufsR = [];
    this.ksIdxs = new Int32Array(this.NUM_STRINGS);
    this.ksIdxsR = new Int32Array(this.NUM_STRINGS);
    this.ksLasts = new Float32Array(this.NUM_STRINGS);
    this.ksLastsR = new Float32Array(this.NUM_STRINGS);
    for (let s = 0; s < this.NUM_STRINGS; s++) {
      this.ksBufs.push(new Float32Array(this.ksMax));
      this.ksBufsR.push(new Float32Array(this.ksMax));
    }
    // Auto-repluck cycle — stagger initial plucks so strings overlap
    this.pluckCountdowns = new Float32Array([0.1, 0.6, 1.2, 1.8]);
    this.pluckPhase = 0; // which string to pluck next
    // Body resonator — 150 Hz bandpass simulating the gourd
    this.ksBodyF = 2 * Math.sin(Math.PI * 150 / sampleRate);
    this.ksBodyDamp = 1 / 4; // Q = 4
    this.ksBodyLowL = 0;
    this.ksBodyBandL = 0;
    this.ksBodyLowR = 0;
    this.ksBodyBandR = 0;
    // Presence shelf
    this.hsKsL = 0;
    this.hsKsR = 0;
    // Bridge coupling — energy from all strings feeds back through
    // the shared bridge/gourd, creating sympathetic resonance.
    this.bridgeCoupling = 0.02;
    this.holdActive = false;
  }

  tanpuraProcess(L, R, n, freq, drift, amp, pluckRate) {
    const hold = pluckRate < 0.05;
    const baseLen = sampleRate / Math.max(20, freq);
    const jawK = 1.1;
    const jawMix = 0.22;
    // Per-string damping — Pa decays faster, low Sa sustains longest
    const STRING_DAMP = [0.99965, 0.99975, 0.99975, 0.99985];
    const sustainNoise = 0.002;
    const coupling = this.bridgeCoupling;

    // Pluck scheduling — each string has its own countdown.
    // In hold mode, fire one pluck on all strings then stop.
    const blockSec = n / sampleRate;
    if (hold) {
      if (!this.holdActive) {
        this.holdActive = true;
        for (let s = 0; s < this.NUM_STRINGS; s++) {
          const ratio = 1.0; // hold locks to root
          const len = Math.floor(Math.min(this.ksMax - 2, Math.max(8, baseLen / ratio)));
          this.doPluckString(s, len);
        }
      }
    } else {
      this.holdActive = false;
      for (let s = 0; s < this.NUM_STRINGS; s++) {
        this.pluckCountdowns[s] -= blockSec;
        if (this.pluckCountdowns[s] <= 0) {
          const ratio = this.stringRatios[s];
          const len = Math.floor(Math.min(this.ksMax - 2, Math.max(8, baseLen / ratio)));
          this.doPluckString(s, len);
          const pr = Math.max(0.05, pluckRate || 1);
          // 4 strings cycling: base interval 1.8-2.8 s per string
          this.pluckCountdowns[s] = Math.min(6, (1.8 + this.rng() * 1.0) / pr);
        }
      }
    }

    // Pre-compute per-string delay lengths
    const delayLens = new Int32Array(this.NUM_STRINGS);
    const delayLensR = new Int32Array(this.NUM_STRINGS);
    const fracsL = new Float32Array(this.NUM_STRINGS);
    const fracsR = new Float32Array(this.NUM_STRINGS);
    const dampings = new Float32Array(this.NUM_STRINGS);
    // Feedback LP coefficient scales with pitch — low strings (long
    // delay lines) get stronger smoothing so they sound naturally
    // darker, matching real tanpura behavior. At 220 Hz → 0.07 (gentle),
    // at 55 Hz → 0.18 (warmer). The coefficient is "previous sample
    // weight" so higher = more LP = darker.
    const lpCoefs = new Float32Array(this.NUM_STRINGS);
    for (let s = 0; s < this.NUM_STRINGS; s++) {
      const ratio = hold ? 1.0 : this.stringRatios[s];
      const exact = Math.min(this.ksMax - 2, Math.max(8, baseLen / ratio));
      delayLens[s] = Math.floor(exact);
      fracsL[s] = exact - delayLens[s];
      const exactR = Math.min(this.ksMax - 2, Math.max(8, baseLen / ratio * 1.003));
      delayLensR[s] = Math.floor(exactR);
      fracsR[s] = exactR - delayLensR[s];
      dampings[s] = hold ? 1.0 : STRING_DAMP[s] - drift * 0.00008;
      // Stronger LP for longer strings (lower pitch)
      const stringFreq = freq / ratio;
      lpCoefs[s] = Math.min(0.25, Math.max(0.05, 0.22 - stringFreq * 0.001));
    }

    // Presence shelf gain — reduced at low pitches where 4 strings
    // already produce enough harmonic energy. Full shelf above 200 Hz,
    // fading to near-zero below 80 Hz.
    const shelfGain = Math.min(0.3, Math.max(0.05, (freq - 60) * 0.002));

    for (let i = 0; i < n; i++) {
      let sumL = 0, sumR = 0;
      // Sum from bridge — used for coupling feedback
      let bridgeL = 0, bridgeR = 0;

      // Process all 4 strings simultaneously
      for (let s = 0; s < this.NUM_STRINGS; s++) {
        const buf = this.ksBufs[s];
        const bufR = this.ksBufsR[s];
        const idx = this.ksIdxs[s];
        const idxR = this.ksIdxsR[s];
        const dLen = delayLens[s];
        const dLenR = delayLensR[s];
        const fL = fracsL[s];
        const fR = fracsR[s];
        const damp = dampings[s];
        const lpc = lpCoefs[s];
        const lpcInv = 1 - lpc;

        // Read with fractional delay interpolation
        const cur = buf[idx];
        const nxt = buf[(idx + 1) % dLen];
        let y = cur * (1 - fL) + nxt * fL + (this.rng() - 0.5) * sustainNoise;
        // Feedback lowpass — pitch-scaled
        this.ksLasts[s] = this.ksLasts[s] * lpc + y * lpcInv;
        y = this.ksLasts[s] * damp;
        // Jawari nonlinearity
        const jy = Math.tanh(jawK * y) + jawMix * fastSin(jawK * 2.1 * y);
        y = y * 0.78 + jy * 0.22;

        // R channel
        const curR = bufR[idxR];
        const nxtR = bufR[(idxR + 1) % dLenR];
        let yR = curR * (1 - fR) + nxtR * fR + (this.rng() - 0.5) * sustainNoise;
        this.ksLastsR[s] = this.ksLastsR[s] * lpc + yR * lpcInv;
        yR = this.ksLastsR[s] * damp;
        const jyR = Math.tanh(jawK * yR) + jawMix * fastSin(jawK * 2.1 * yR);
        yR = yR * 0.78 + jyR * 0.22;

        // Write back + bridge coupling from previous sample's sum
        buf[idx] = y + bridgeL * coupling;
        this.ksIdxs[s] = (idx + 1) % dLen;
        bufR[idxR] = yR + bridgeR * coupling;
        this.ksIdxsR[s] = (idxR + 1) % dLenR;

        // Accumulate into bridge and stereo output
        bridgeL += y;
        bridgeR += yR;
        sumL += y * this.stringPans[s];
        sumR += yR * this.stringPansR[s];
      }

      // Scale — 4 strings summed; normalize
      sumL *= 0.35;
      sumR *= 0.35;

      // Body resonator — parallel 150 Hz bandpass
      const bodyHighL = sumL - this.ksBodyLowL - this.ksBodyDamp * this.ksBodyBandL;
      this.ksBodyBandL += this.ksBodyF * bodyHighL;
      this.ksBodyLowL += this.ksBodyF * this.ksBodyBandL;
      const bodyHighR = sumR - this.ksBodyLowR - this.ksBodyDamp * this.ksBodyBandR;
      this.ksBodyBandR += this.ksBodyF * bodyHighR;
      this.ksBodyLowR += this.ksBodyF * this.ksBodyBandR;

      // Presence shelf — pitch-dependent gain
      let postL = sumL + this.ksBodyBandL * 0.12;
      let postR = sumR + this.ksBodyBandR * 0.12;
      this.hsKsL = this.hsKsL * 0.6 + postL * 0.4;
      this.hsKsR = this.hsKsR * 0.6 + postR * 0.4;
      postL += (postL - this.hsKsL) * shelfGain;
      postR += (postR - this.hsKsR) * shelfGain;

      L[i] = postL * amp;
      R[i] = postR * amp;
    }
  }

  doPluckString(stringIdx, delayLen) {
    // Fill one string's delay lines with band-limited noise excitation.
    const buf = this.ksBufs[stringIdx];
    const bufR = this.ksBufsR[stringIdx];
    const delayLenR = Math.min(this.ksMax - 2, delayLen + 2);
    const lpCoef = 0.32;
    let lpL = 0;
    for (let i = 0; i < delayLen; i++) {
      const v = (this.rng() * 2 - 1);
      lpL += lpCoef * (v - lpL);
      buf[i] = lpL * 0.9;
    }
    let lpR = 0;
    for (let i = 0; i < delayLenR; i++) {
      const v = (this.rng() * 2 - 1);
      lpR += lpCoef * (v - lpR);
      bufR[i] = lpR * 0.9;
    }
    this.ksIdxs[stringIdx] = 0;
    this.ksIdxsR[stringIdx] = 0;
    this.ksLasts[stringIdx] = 0;
    this.ksLastsR[stringIdx] = 0;
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
    // Per-partial amplitude jitter — slow random walks (0.01-0.04 Hz)
    // that modulate each partial's level ±8%. Breaks the "clean
    // additive" fingerprint that makes reed sound synthetic.
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
  }

  reedProcess(L, R, n, freq, drift, amp) {
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

          // Per-partial amplitude jitter — slow random walk ±8%
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
    this.metalN = 12;
    this.metalRatios = new Float32Array([
      1.0, 1.006, 2.23, 2.27, 3.98, 6.18, 8.92,
      // Upper shimmer halo — weak high-inharmonic modes that give
      // real bowls their metallic sparkle above the strong fundamentals.
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
  }

  metalProcess(L, R, n, freq, drift, amp) {
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
  }

  // Second pink noise generator (uses pinkR state) for independent R channel
  pinkNoiseR() {
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
    // Per-partial decay — higher partials decay faster, giving the
    // piano its characteristic spectral thinning over time. The
    // fundamental sustains indefinitely (drone context); partial 14
    // decays in ~1 s. A slow re-excitation LFO periodically lifts
    // decayed partials back so the voice breathes over long sustains.
    this.pianoDecay = new Float32Array(this.pianoN).fill(1);
    this.pianoDecayRates = new Float32Array(this.pianoN);
    for (let i = 0; i < this.pianoN; i++) {
      this.pianoPhasesL[i] = this.rng() * Math.PI * 2;
      this.pianoPhasesR[i] = this.rng() * Math.PI * 2;
      // Fundamental barely decays; partial 14 decays in ~1 s
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
  }

  pianoProcess(L, R, n, freq, drift, amp) {
    const invSr = 1 / sampleRate;
    const twoPi = Math.PI * 2;
    const detuneDepth = drift * 0.0028;
    const nyquist = sampleRate * 0.45;

    for (let i = 0; i < n; i++) {
      this.pianoLfoPhase += twoPi * this.pianoLfoRate * invSr;
      if (this.pianoLfoPhase > twoPi) this.pianoLfoPhase -= twoPi;
      const breath = 1 + Math.sin(this.pianoLfoPhase) * 0.025;

      // Slow re-excitation — lifts decayed upper partials back over a
      // ~12 s cycle so the piano breathes instead of thinning forever.
      this.pianoRestrikePhase += twoPi * 0.08 * invSr;
      if (this.pianoRestrikePhase > twoPi) this.pianoRestrikePhase -= twoPi;
      const restrike = 0.5 + 0.5 * Math.sin(this.pianoRestrikePhase);

      let l = 0, r = 0;
      for (let p = 0; p < this.pianoN; p++) {
        // Per-partial decay — higher partials thin out faster
        this.pianoDecay[p] = Math.max(0.08, this.pianoDecay[p] - this.pianoDecayRates[p]);
        const decayEnv = this.pianoDecay[p] + (1 - this.pianoDecay[p]) * restrike * 0.5;

        const wobble = Math.sin(this.pianoLfoPhase * (1 + p * 0.13)) * detuneDepth;
        const partialFreq = freq * this.pianoRatios[p] * (1 + wobble);
        if (partialFreq > nyquist) continue;
        this.pianoPhasesL[p] += twoPi * partialFreq * invSr;
        this.pianoPhasesR[p] += twoPi * partialFreq * invSr * (1 + detuneDepth * 0.45);
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
        const strike = this.pinkNoise() * strikeEnv * 0.35;
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

      // Presence shelf — compensate body energy so highs aren't dulled
      this.hsPianoL = this.hsPianoL * 0.6 + l * 0.4;
      this.hsPianoR = this.hsPianoR * 0.6 + r * 0.4;
      l += (l - this.hsPianoL) * 0.25;
      r += (r - this.hsPianoR) * 0.25;

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

      // Modulator oscillator — with optional self-feedback
      const modFreq = freq * this.fmRatio * (1 + depth);
      const fbPhase = this.fmModPhase + this.fmFeedback * this.fmModFbSample;
      this.fmModPhase += twoPi * modFreq * invSr;
      if (this.fmModPhase > twoPi) this.fmModPhase -= twoPi;
      const modSin = fastSin(fbPhase);
      this.fmModFbSample = modSin; // store for next sample's feedback
      const modOut = modSin * dynIndex * freq;

      // Carrier oscillators — frequency-modulated by the modulator
      const cFreq = freq + modOut;
      this.fmCarrierPhaseL += twoPi * cFreq * invSr;
      this.fmCarrierPhaseR += twoPi * cFreq * invSr * (1 + depth * 0.6);
      while (this.fmCarrierPhaseL >  twoPi) this.fmCarrierPhaseL -= twoPi;
      while (this.fmCarrierPhaseL < -twoPi) this.fmCarrierPhaseL += twoPi;
      while (this.fmCarrierPhaseR >  twoPi) this.fmCarrierPhaseR -= twoPi;
      while (this.fmCarrierPhaseR < -twoPi) this.fmCarrierPhaseR += twoPi;

      const s = breath * 0.22;
      L[i] = fastSin(this.fmCarrierPhaseL) * s * amp;
      R[i] = fastSin(this.fmCarrierPhaseR) * s * amp;
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
      const bias = 0.12;
      l = Math.tanh((l + bias) * 3.8) * 0.72;
      r = Math.tanh((r + bias) * 3.8) * 0.72;
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
  }
}

registerProcessor("drone-voice", DroneVoiceProcessor);
