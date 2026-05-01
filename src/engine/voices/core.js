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
      // NOISE voice COLOR: 0 = white, 0.3 = pink, 0.6 = brown,
      // 1 = sub-rumble. Ignored by all other voice types.
      { name: "color", defaultValue: 0.3, minValue: 0, maxValue: 1, automationRate: "k-rate" },
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

    // Termination flag — main thread posts {type:"stop"} when the
    // voice is retired. process() returns false once set, so the
    // worklet processor is GC-eligible instead of running forever.
    this.stopped = false;
    // ENTRAIN dichotic L/R spread, in cents on the R channel. Stored
    // pre-computed as a ratio multiplier so the per-sample voice
    // loops only pay one extra float multiply. 1 = no effect.
    this.dichoticMulR = 1;
    this.port.onmessage = (e) => {
      const msg = e.data;
      if (!msg) return;
      if (msg.type === "stop") { this.stopped = true; return; }
      if (msg.type === "dichotic") {
        const cents = typeof msg.cents === "number" ? msg.cents : 0;
        this.dichoticMulR = Math.pow(2, cents / 1200);
      }
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
      case "noise":   this.initNoise();   break;
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
    // DIAGNOSTIC: counts fires per field and posts a `nan-diag` message
    // back to the main thread every ~1s when any clamp fired. Lets us
    // discover whether sanitizeState ever fires in real use, and which
    // voice / state field is the culprit. Cheap: counter increment only
    // on a path that's already a non-finite branch.
    const fix = (name, v) => {
      if (Number.isFinite(v)) return v;
      this._nanFires = (this._nanFires | 0) + 1;
      if (!this._nanFieldCounts) this._nanFieldCounts = Object.create(null);
      this._nanFieldCounts[name] = (this._nanFieldCounts[name] | 0) + 1;
      return 0;
    };

    // Tanpura body SVF + KS last-sample lowpass
    this.ksBodyLowL  = fix("ksBodyLowL",  this.ksBodyLowL);
    this.ksBodyBandL = fix("ksBodyBandL", this.ksBodyBandL);
    this.ksBodyLowR  = fix("ksBodyLowR",  this.ksBodyLowR);
    this.ksBodyBandR = fix("ksBodyBandR", this.ksBodyBandR);
    this.hsKsL = fix("hsKsL", this.hsKsL);
    this.hsKsR = fix("hsKsR", this.hsKsR);
    if (this.ksLasts)  for (let i = 0; i < this.ksLasts.length;  i++) this.ksLasts[i]  = fix("ksLasts",  this.ksLasts[i]);
    if (this.ksLastsR) for (let i = 0; i < this.ksLastsR.length; i++) this.ksLastsR[i] = fix("ksLastsR", this.ksLastsR[i]);

    // Reed formant SVF state
    if (this.reedFormN) {
      for (let i = 0; i < this.reedFormN; i++) {
        this.reedFormLowL[i]  = fix("reedFormLowL",  this.reedFormLowL[i]);
        this.reedFormBandL[i] = fix("reedFormBandL", this.reedFormBandL[i]);
        this.reedFormLowR[i]  = fix("reedFormLowR",  this.reedFormLowR[i]);
        this.reedFormBandR[i] = fix("reedFormBandR", this.reedFormBandR[i]);
      }
    }
    this.hsReedL = fix("hsReedL", this.hsReedL);
    this.hsReedR = fix("hsReedR", this.hsReedR);

    // Air SVF state (per-resonator)
    if (this.airStates) {
      for (let i = 0; i < this.airStates.length; i++) {
        const s = this.airStates[i];
        s[0] = fix("airState0", s[0]);
        s[1] = fix("airState1", s[1]);
        s[2] = fix("airState2", s[2]);
        s[3] = fix("airState3", s[3]);
      }
    }
    this.hsL = fix("hsL", this.hsL);
    this.hsR = fix("hsR", this.hsR);

    // Piano soundboard SVFs + brightness LP
    this.pianoBodyLowL  = fix("pianoBodyLowL",  this.pianoBodyLowL);
    this.pianoBodyBandL = fix("pianoBodyBandL", this.pianoBodyBandL);
    this.pianoBodyLowR  = fix("pianoBodyLowR",  this.pianoBodyLowR);
    this.pianoBodyBandR = fix("pianoBodyBandR", this.pianoBodyBandR);
    this.pianoMidLowL   = fix("pianoMidLowL",   this.pianoMidLowL);
    this.pianoMidBandL  = fix("pianoMidBandL",  this.pianoMidBandL);
    this.pianoMidLowR   = fix("pianoMidLowR",   this.pianoMidLowR);
    this.pianoMidBandR  = fix("pianoMidBandR",  this.pianoMidBandR);
    this.hsPianoL = fix("hsPianoL", this.hsPianoL);
    this.hsPianoR = fix("hsPianoR", this.hsPianoR);

    // FM feedback sample
    this.fmModFbSample = fix("fmModFbSample", this.fmModFbSample);

    // Amp cabinet SVF + DC-block state + speaker feedback
    this.ampBodyLowL  = fix("ampBodyLowL",  this.ampBodyLowL);
    this.ampBodyBandL = fix("ampBodyBandL", this.ampBodyBandL);
    this.ampBodyLowR  = fix("ampBodyLowR",  this.ampBodyLowR);
    this.ampBodyBandR = fix("ampBodyBandR", this.ampBodyBandR);
    this.ampPresLowL  = fix("ampPresLowL",  this.ampPresLowL);
    this.ampPresBandL = fix("ampPresBandL", this.ampPresBandL);
    this.ampPresLowR  = fix("ampPresLowR",  this.ampPresLowR);
    this.ampPresBandR = fix("ampPresBandR", this.ampPresBandR);
    this.ampCabL      = fix("ampCabL",      this.ampCabL);
    this.ampCabR      = fix("ampCabR",      this.ampCabR);
    this.ampDcPrevInL  = fix("ampDcPrevInL",  this.ampDcPrevInL);
    this.ampDcPrevOutL = fix("ampDcPrevOutL", this.ampDcPrevOutL);
    this.ampDcPrevInR  = fix("ampDcPrevInR",  this.ampDcPrevInR);
    this.ampDcPrevOutR = fix("ampDcPrevOutR", this.ampDcPrevOutR);
    this.ampSpkFbL = fix("ampSpkFbL", this.ampSpkFbL);
    this.ampSpkFbR = fix("ampSpkFbR", this.ampSpkFbR);

    // Halfband oversampler state — reset-on-NaN, cheap.
    if (this.ampHbL)   this.ampHbL.sanitize();
    if (this.ampHbR)   this.ampHbR.sanitize();
    if (this.metalHbL) this.metalHbL.sanitize();
    if (this.metalHbR) this.metalHbR.sanitize();
    if (this.jawHbL) for (const hb of this.jawHbL) hb.sanitize();
    if (this.jawHbR) for (const hb of this.jawHbR) hb.sanitize();

    // Periodic diag emit — every ~1s (375 blocks @ 48kHz/128). Only
    // posts when fires > 0, so silent voices stay silent on the port.
    this._diagBlocks = (this._diagBlocks | 0) + 1;
    if (this._diagBlocks >= 375) {
      if (this._nanFires > 0) {
        try {
          this.port.postMessage({
            type: "nan-diag",
            voiceType: this.voiceType,
            fires: this._nanFires,
            fields: this._nanFieldCounts,
          });
        } catch { /* ok */ }
      }
      this._nanFires = 0;
      this._nanFieldCounts = null;
      this._diagBlocks = 0;
    }
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
    const color = parameters.color ? parameters.color[0] : 0.3;

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

    switch (this.voiceType) {
      case "tanpura": this.tanpuraProcess(L, R, n, freq, drift, amp, pluckRate); break;
      case "reed":    this.reedProcess(L, R, n, freq, drift, amp); break;
      case "metal":   this.metalProcess(L, R, n, freq, drift, amp); break;
      case "air":     this.airProcess(L, R, n, freq, drift, amp); break;
      case "piano":   this.pianoProcess(L, R, n, freq, drift, amp); break;
      case "fm":      this.fmProcess(L, R, n, freq, drift, amp); break;
      case "amp":     this.ampProcess(L, R, n, freq, drift, amp); break;
      case "noise":   this.noiseProcess(L, R, n, freq, drift, amp, color); break;
    }
    return true;
  }

}
