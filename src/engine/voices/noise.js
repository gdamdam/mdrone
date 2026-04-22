// mdrone voice worklet — NOISE (untuned broadband bed) voice.
// Prototype extensions on DroneVoiceProcessor; concatenated after
// core.js by scripts/build-worklet.mjs.
//
// Design intent: deliver the one thing the seven existing voices
// cannot — untuned, tonic-independent broadband noise for hiss
// beds, wind washes, ritual dust, tape-hiss nostalgia, rain / wind
// ambiance, industrial rumble. Drone canon uses noise as a primary
// layer (Basinski, Radigue, La Monte Young, Hecker, Deathprod);
// mdrone previously required leaving the app to add any of it.
//
// Single user-facing knob: COLOR (0..1), routed into the worklet
// via the `color` AudioParam.
//
//   0.00  white       — bright, full-spectrum hiss
//   0.30  pink        — natural, "rain on leaves"
//   0.60  brown       — rumble, "distant surf"
//   0.85  deep brown  — subsonic ritual floor
//   1.00  sub-rumble  — body-weight bed
//
// The slider maps to a one-pole lowpass cutoff mapped exponentially
// from 20 kHz to 40 Hz and to a white→pink mix. Plus a hard-coded
// slow amplitude LFO (~0.03 Hz, ±10%) so the bed "breathes" rather
// than sitting dead flat — matches mdrone's per-voice physicality
// philosophy (tanpura auto-repluck, amp swell, metal re-excitation).
//
// Tonic-independent: `freq` is ignored. `drift` is unused. The voice
// doesn't respond to tonic changes — that's the whole point.

DroneVoiceProcessor.prototype.initNoise = function() {
  // Independent pink-noise state for the R channel so the stereo
  // image isn't mono — white sources share this.rng but pass through
  // decorrelated filter states, which already gives some width.
  this.noisePinkR = { b0: 0, b1: 0, b2: 0, b3: 0, b4: 0, b5: 0, b6: 0 };
  // One-pole lowpass state per channel (the "color" shaper).
  this.noiseLpL = 0;
  this.noiseLpR = 0;
  // Slow amplitude LFO — ~0.03 Hz, ±10%. Not user-adjustable.
  this.noiseLfoPhase = this.rng() * Math.PI * 2;
  this.noiseLfoRateHz = 0.03;
  // DC-block HPF state per channel — a lowpass fed by noise can
  // accumulate tiny DC offset over long holds.
  this.noiseDcL = 0;
  this.noiseDcR = 0;
  this.noiseDcPrevL = 0;
  this.noiseDcPrevR = 0;
};

// Secondary pink generator for R using noisePinkR state. Mirrors
// AIR's pinkNoiseR pattern so stereo isn't a mono source.
DroneVoiceProcessor.prototype.noisePinkNoiseR = function() {
  const p = this.noisePinkR;
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

DroneVoiceProcessor.prototype.noiseProcess = function(L, R, n, _freq, _drift, amp, color) {
  // COLOR → lowpass cutoff (exponential 20 kHz → 40 Hz). The map is
  // exponential because human pitch/cutoff perception is log — a
  // linear slider feels right only with an exponential mapping.
  const c = Math.max(0, Math.min(1, color));
  const cutoffHz = 20000 * Math.pow(40 / 20000, c);
  const cutoffClamped = Math.max(20, Math.min(sampleRate * 0.49, cutoffHz));
  // One-pole lowpass coefficient (standard RC-style):
  //   y[n] = lpCoef * y[n-1] + (1 - lpCoef) * x[n]
  const lpCoef = Math.exp(-2 * Math.PI * cutoffClamped / sampleRate);
  const oneMinusLp = 1 - lpCoef;

  // White↔pink crossfade. Pure white at color = 0 (pre-filter, so
  // filter has nothing to do and output is full white); pink from
  // c ≈ 0.2 onwards; filter does the brown/deep shaping past that.
  const pinkMix = Math.min(1, c * 2.5);
  const whiteMix = 1 - pinkMix;
  // Pink amplitude is ~3 dB lower than white for equal subjective
  // loudness; multiply by 1.5 to compensate in the mix.
  const pinkScale = 1.5;

  // Gain compensation — a lowpass at 40 Hz kills most of the
  // audible spectrum; boost to keep subjective loudness roughly
  // constant across the COLOR range. Empirical: ~+12 dB at c=1.
  const gainComp = 1 + c * 4;

  // Final output scaling — tuned so that level 1 sits slightly
  // quieter than other voices at their reference levels (noise is
  // easy to turn into an overpowering bed; err on the quiet side).
  const outScale = 0.5;

  const twoPi = Math.PI * 2;
  const invSr = 1 / sampleRate;

  for (let i = 0; i < n; i++) {
    // Slow amplitude LFO — hard-coded physicality.
    this.noiseLfoPhase += twoPi * this.noiseLfoRateHz * invSr;
    if (this.noiseLfoPhase > twoPi) this.noiseLfoPhase -= twoPi;
    const lfo = 1 + Math.sin(this.noiseLfoPhase) * 0.10;

    // White sources (independent L/R via independent rng() calls).
    const whiteL = this.rng() * 2 - 1;
    const whiteR = this.rng() * 2 - 1;
    // Pink sources — share the core pink state for L, independent for R.
    const pinkL = this.pinkNoise();
    const pinkR = this.noisePinkNoiseR();

    const srcL = whiteL * whiteMix + pinkL * pinkMix * pinkScale;
    const srcR = whiteR * whiteMix + pinkR * pinkMix * pinkScale;

    // One-pole lowpass — brown / deep end.
    this.noiseLpL = lpCoef * this.noiseLpL + oneMinusLp * srcL;
    this.noiseLpR = lpCoef * this.noiseLpR + oneMinusLp * srcR;

    // Gain comp + LFO.
    const preL = this.noiseLpL * gainComp * lfo;
    const preR = this.noiseLpR * gainComp * lfo;

    // DC-block (HPF ~8 Hz, coefficient 0.998).
    const dcL = preL - this.noiseDcPrevL + this.noiseDcL * 0.998;
    this.noiseDcPrevL = preL;
    this.noiseDcL = dcL;
    const dcR = preR - this.noiseDcPrevR + this.noiseDcR * 0.998;
    this.noiseDcPrevR = preR;
    this.noiseDcR = dcR;

    L[i] = dcL * amp * outScale;
    R[i] = dcR * amp * outScale;
  }
};
