// mdrone voice worklet — core class. Defines DroneVoiceProcessor with
// its constructor, shared helpers (pinkNoise, sanitizeState), and the
// per-block process() dispatcher. Per-voice init/process methods
// (initTanpura/tanpuraProcess, initReed/reedProcess, ...) are
// attached as prototype extensions by separate files under this
// directory and concatenated after core.js by
// scripts/build-worklet.mjs. The `registerProcessor` call lives in
// register.js (concatenated last) so extensions always land before
// the processor is registered with the worklet global scope.


class DroneVoiceProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "freq",  defaultValue: 220, minValue: 20, maxValue: 8000, automationRate: "k-rate" },
      { name: "drift", defaultValue: 0.3, minValue: 0,  maxValue: 1,    automationRate: "k-rate" },
      { name: "amp",   defaultValue: 0,   minValue: 0,  maxValue: 2,    automationRate: "k-rate" },
      // Tanpura re-pluck rate multiplier. 1 = default, 0 = hold
      // (infinite sustain, no repluck). Ignored by non-tanpura.
      { name: "pluckRate", defaultValue: 1, minValue: 0, maxValue: 4, automationRate: "k-rate" },
    ];
  }

  constructor(options) {
    super();
    const opts = options?.processorOptions || {};
    this.voiceType = opts.voiceType || "tanpura";
    this.reedShape = opts.reedShape || "odd";
    // Tanpura string tuning — see TANPURA_TUNING_RATIOS in tanpura.js.
    // Default "classic" = pre-P3 unison micro-detune so scenes reload
    // identically unless the preset / UI explicitly picks a tuning.
    this.tanpuraTuningOpt = opts.tanpuraTuning || "classic";
    this.fmRatioOpt = opts.fmRatio || 2.0;
    this.fmIndexOpt = opts.fmIndex || 2.4;
    this.fmFeedbackOpt = opts.fmFeedback || 0;
    this.seed = opts.seed || 1;
    this.rng = makeRng(this.seed);
    // Diagnostic: ?sinetest=1 replaces voice DSP with pure Math.sin.
    this.sineTest = !!opts.sineTest;
    this.sineTestPhase = 0;

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

  // ── STATE SANITATION ─────────────────────────────────────────────
  // Guards every feedback-rich scalar against NaN / Infinity that
  // would otherwise latch the voice at silence or subsonic DC. Called
  // once per block from process(); O(voiceState) but state is small.
  sanitizeState() {
    // Tanpura body SVF + KS last-sample lowpass
    if (!Number.isFinite(this.ksBodyLowL))  this.ksBodyLowL  = 0;
    if (!Number.isFinite(this.ksBodyBandL)) this.ksBodyBandL = 0;
    if (!Number.isFinite(this.ksBodyLowR))  this.ksBodyLowR  = 0;
    if (!Number.isFinite(this.ksBodyBandR)) this.ksBodyBandR = 0;
    if (!Number.isFinite(this.hsKsL)) this.hsKsL = 0;
    if (!Number.isFinite(this.hsKsR)) this.hsKsR = 0;
    if (this.ksLasts)  for (let i = 0; i < this.ksLasts.length;  i++) if (!Number.isFinite(this.ksLasts[i]))  this.ksLasts[i]  = 0;
    if (this.ksLastsR) for (let i = 0; i < this.ksLastsR.length; i++) if (!Number.isFinite(this.ksLastsR[i])) this.ksLastsR[i] = 0;

    // Reed formant SVF state
    if (this.reedFormN) {
      for (let i = 0; i < this.reedFormN; i++) {
        if (!Number.isFinite(this.reedFormLowL[i]))  this.reedFormLowL[i]  = 0;
        if (!Number.isFinite(this.reedFormBandL[i])) this.reedFormBandL[i] = 0;
        if (!Number.isFinite(this.reedFormLowR[i]))  this.reedFormLowR[i]  = 0;
        if (!Number.isFinite(this.reedFormBandR[i])) this.reedFormBandR[i] = 0;
      }
    }
    if (!Number.isFinite(this.hsReedL)) this.hsReedL = 0;
    if (!Number.isFinite(this.hsReedR)) this.hsReedR = 0;

    // Air SVF state (per-resonator)
    if (this.airStates) {
      for (let i = 0; i < this.airStates.length; i++) {
        const s = this.airStates[i];
        if (!Number.isFinite(s[0])) s[0] = 0;
        if (!Number.isFinite(s[1])) s[1] = 0;
        if (!Number.isFinite(s[2])) s[2] = 0;
        if (!Number.isFinite(s[3])) s[3] = 0;
      }
    }
    if (!Number.isFinite(this.hsL)) this.hsL = 0;
    if (!Number.isFinite(this.hsR)) this.hsR = 0;

    // Piano soundboard SVFs + brightness LP
    if (!Number.isFinite(this.pianoBodyLowL))  this.pianoBodyLowL  = 0;
    if (!Number.isFinite(this.pianoBodyBandL)) this.pianoBodyBandL = 0;
    if (!Number.isFinite(this.pianoBodyLowR))  this.pianoBodyLowR  = 0;
    if (!Number.isFinite(this.pianoBodyBandR)) this.pianoBodyBandR = 0;
    if (!Number.isFinite(this.pianoMidLowL))   this.pianoMidLowL   = 0;
    if (!Number.isFinite(this.pianoMidBandL))  this.pianoMidBandL  = 0;
    if (!Number.isFinite(this.pianoMidLowR))   this.pianoMidLowR   = 0;
    if (!Number.isFinite(this.pianoMidBandR))  this.pianoMidBandR  = 0;
    if (!Number.isFinite(this.hsPianoL)) this.hsPianoL = 0;
    if (!Number.isFinite(this.hsPianoR)) this.hsPianoR = 0;

    // FM feedback sample
    if (!Number.isFinite(this.fmModFbSample)) this.fmModFbSample = 0;

    // Amp cabinet SVF + DC-block state + speaker feedback
    if (!Number.isFinite(this.ampBodyLowL))  this.ampBodyLowL  = 0;
    if (!Number.isFinite(this.ampBodyBandL)) this.ampBodyBandL = 0;
    if (!Number.isFinite(this.ampBodyLowR))  this.ampBodyLowR  = 0;
    if (!Number.isFinite(this.ampBodyBandR)) this.ampBodyBandR = 0;
    if (!Number.isFinite(this.ampPresLowL))  this.ampPresLowL  = 0;
    if (!Number.isFinite(this.ampPresBandL)) this.ampPresBandL = 0;
    if (!Number.isFinite(this.ampPresLowR))  this.ampPresLowR  = 0;
    if (!Number.isFinite(this.ampPresBandR)) this.ampPresBandR = 0;
    if (!Number.isFinite(this.ampCabL))      this.ampCabL      = 0;
    if (!Number.isFinite(this.ampCabR))      this.ampCabR      = 0;
    if (!Number.isFinite(this.ampDcPrevInL))  this.ampDcPrevInL  = 0;
    if (!Number.isFinite(this.ampDcPrevOutL)) this.ampDcPrevOutL = 0;
    if (!Number.isFinite(this.ampDcPrevInR))  this.ampDcPrevInR  = 0;
    if (!Number.isFinite(this.ampDcPrevOutR)) this.ampDcPrevOutR = 0;
    if (!Number.isFinite(this.ampSpkFbL)) this.ampSpkFbL = 0;
    if (!Number.isFinite(this.ampSpkFbR)) this.ampSpkFbR = 0;

    // Halfband oversampler state — reset-on-NaN, cheap.
    if (this.ampHbL)   this.ampHbL.sanitize();
    if (this.ampHbR)   this.ampHbR.sanitize();
    if (this.metalHbL) this.metalHbL.sanitize();
    if (this.metalHbR) this.metalHbR.sanitize();
    if (this.jawHbL) for (const hb of this.jawHbL) hb.sanitize();
    if (this.jawHbR) for (const hb of this.jawHbR) hb.sanitize();
  }

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

    // NaN/Infinity sanitation on every feedback-rich scalar the voice
    // touches. One bad sample in an SVF / KS / DC-block state traps the
    // voice at silence or subsonic DC forever; this is the single
    // cheapest place to reset it per block.
    this.sanitizeState();

    if (this.sineTest) {
      const inc = 2 * Math.PI * freq / sampleRate;
      for (let i = 0; i < n; i++) {
        const s = Math.sin(this.sineTestPhase) * 0.2 * amp;
        L[i] = s;
        if (R !== L) R[i] = s;
        this.sineTestPhase += inc;
        if (this.sineTestPhase > 2 * Math.PI) this.sineTestPhase -= 2 * Math.PI;
      }
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

}
