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
  // Shared helper for per-voice sanitize methods. Counts fires per field
  // and increments _nanFires so the periodic diag emit can post counts
  // back to the main thread.
  _fix(name, v) {
    if (Number.isFinite(v)) return v;
    this._nanFires = (this._nanFires | 0) + 1;
    if (!this._nanFieldCounts) this._nanFieldCounts = Object.create(null);
    this._nanFieldCounts[name] = (this._nanFieldCounts[name] | 0) + 1;
    return 0;
  }

  // Per-voice sanitize methods — only touch the state fields the voice
  // actually uses. Avoids firing on uninitialized cross-voice prototype
  // state at boot (the diagnostic showed the previous unconditional
  // sweep produced ~30 init-noise fires per voice instance with no
  // real audio-processing significance).
  _sanitizeTanpura() {
    this.ksBodyLowL  = this._fix("ksBodyLowL",  this.ksBodyLowL);
    this.ksBodyBandL = this._fix("ksBodyBandL", this.ksBodyBandL);
    this.ksBodyLowR  = this._fix("ksBodyLowR",  this.ksBodyLowR);
    this.ksBodyBandR = this._fix("ksBodyBandR", this.ksBodyBandR);
    this.hsKsL = this._fix("hsKsL", this.hsKsL);
    this.hsKsR = this._fix("hsKsR", this.hsKsR);
    if (this.ksLasts)  for (let i = 0; i < this.ksLasts.length;  i++) this.ksLasts[i]  = this._fix("ksLasts",  this.ksLasts[i]);
    if (this.ksLastsR) for (let i = 0; i < this.ksLastsR.length; i++) this.ksLastsR[i] = this._fix("ksLastsR", this.ksLastsR[i]);
    if (this.jawHbL) for (const hb of this.jawHbL) hb.sanitize();
    if (this.jawHbR) for (const hb of this.jawHbR) hb.sanitize();
  }

  _sanitizeReed() {
    if (this.reedFormN) {
      for (let i = 0; i < this.reedFormN; i++) {
        this.reedFormLowL[i]  = this._fix("reedFormLowL",  this.reedFormLowL[i]);
        this.reedFormBandL[i] = this._fix("reedFormBandL", this.reedFormBandL[i]);
        this.reedFormLowR[i]  = this._fix("reedFormLowR",  this.reedFormLowR[i]);
        this.reedFormBandR[i] = this._fix("reedFormBandR", this.reedFormBandR[i]);
      }
    }
    this.hsReedL = this._fix("hsReedL", this.hsReedL);
    this.hsReedR = this._fix("hsReedR", this.hsReedR);
  }

  _sanitizeAir() {
    if (this.airStates) {
      for (let i = 0; i < this.airStates.length; i++) {
        const s = this.airStates[i];
        s[0] = this._fix("airState0", s[0]);
        s[1] = this._fix("airState1", s[1]);
        s[2] = this._fix("airState2", s[2]);
        s[3] = this._fix("airState3", s[3]);
      }
    }
    this.hsL = this._fix("hsL", this.hsL);
    this.hsR = this._fix("hsR", this.hsR);
  }

  _sanitizePiano() {
    this.pianoBodyLowL  = this._fix("pianoBodyLowL",  this.pianoBodyLowL);
    this.pianoBodyBandL = this._fix("pianoBodyBandL", this.pianoBodyBandL);
    this.pianoBodyLowR  = this._fix("pianoBodyLowR",  this.pianoBodyLowR);
    this.pianoBodyBandR = this._fix("pianoBodyBandR", this.pianoBodyBandR);
    this.pianoMidLowL   = this._fix("pianoMidLowL",   this.pianoMidLowL);
    this.pianoMidBandL  = this._fix("pianoMidBandL",  this.pianoMidBandL);
    this.pianoMidLowR   = this._fix("pianoMidLowR",   this.pianoMidLowR);
    this.pianoMidBandR  = this._fix("pianoMidBandR",  this.pianoMidBandR);
    this.hsPianoL = this._fix("hsPianoL", this.hsPianoL);
    this.hsPianoR = this._fix("hsPianoR", this.hsPianoR);
  }

  _sanitizeFm() {
    this.fmModFbSample = this._fix("fmModFbSample", this.fmModFbSample);
  }

  _sanitizeAmp() {
    this.ampBodyLowL  = this._fix("ampBodyLowL",  this.ampBodyLowL);
    this.ampBodyBandL = this._fix("ampBodyBandL", this.ampBodyBandL);
    this.ampBodyLowR  = this._fix("ampBodyLowR",  this.ampBodyLowR);
    this.ampBodyBandR = this._fix("ampBodyBandR", this.ampBodyBandR);
    this.ampPresLowL  = this._fix("ampPresLowL",  this.ampPresLowL);
    this.ampPresBandL = this._fix("ampPresBandL", this.ampPresBandL);
    this.ampPresLowR  = this._fix("ampPresLowR",  this.ampPresLowR);
    this.ampPresBandR = this._fix("ampPresBandR", this.ampPresBandR);
    this.ampCabL      = this._fix("ampCabL",      this.ampCabL);
    this.ampCabR      = this._fix("ampCabR",      this.ampCabR);
    this.ampDcPrevInL  = this._fix("ampDcPrevInL",  this.ampDcPrevInL);
    this.ampDcPrevOutL = this._fix("ampDcPrevOutL", this.ampDcPrevOutL);
    this.ampDcPrevInR  = this._fix("ampDcPrevInR",  this.ampDcPrevInR);
    this.ampDcPrevOutR = this._fix("ampDcPrevOutR", this.ampDcPrevOutR);
    this.ampSpkFbL = this._fix("ampSpkFbL", this.ampSpkFbL);
    this.ampSpkFbR = this._fix("ampSpkFbR", this.ampSpkFbR);
    if (this.ampHbL) this.ampHbL.sanitize();
    if (this.ampHbR) this.ampHbR.sanitize();
  }

  _sanitizeMetal() {
    if (this.metalHbL) this.metalHbL.sanitize();
    if (this.metalHbR) this.metalHbR.sanitize();
  }

  // NOISE has no feedback-rich state to sanitize.

  sanitizeState() {
    switch (this.voiceType) {
      case "tanpura": this._sanitizeTanpura(); break;
      case "reed":    this._sanitizeReed();    break;
      case "air":     this._sanitizeAir();     break;
      case "piano":   this._sanitizePiano();   break;
      case "fm":      this._sanitizeFm();      break;
      case "amp":     this._sanitizeAmp();     break;
      case "metal":   this._sanitizeMetal();   break;
      case "noise":   /* no feedback state */  break;
    }

    // Periodic diag emit — every ~1s (375 blocks @ 48kHz/128). Only
    // posts when fires > 0, so silent voices stay silent on the port.
    // After this fix the diag should be effectively silent in normal
    // use; any fire is a real audio-processing NaN worth investigating.
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
