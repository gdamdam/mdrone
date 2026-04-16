// mdrone voice worklet — TANPURA (Karplus-Strong + jawari, auto-pluck cycle) voice.
// Prototype extensions on DroneVoiceProcessor; concatenated
// after core.js by scripts/build-worklet.mjs.

// Authored tanpura string tunings. Keys match the `tanpuraTuning`
// option threaded through VoiceBuilder → processorOptions. Each value
// is a 4-element array of frequency ratios relative to the drone root.
//   classic       micro-detune unison (original default)
//   sa-pa         low Sa, two middle Sa, high Pa (fifth) — most ragas
//   sa-ma         Ma (fourth) instead of Pa — Malkauns et al.
//   sa-ni         Ni (major 7th) — late-night ragas (Bhairav / Lalit)
//   sa-ma-pa-ni   all four distinct — non-traditional harmony
const TANPURA_TUNING_RATIOS = {
  "classic":     [1.0, 1.00116, 0.99884, 1.00058],
  "sa-pa":       [0.5, 1.0, 1.0, 1.5],
  "sa-ma":       [0.5, 1.0, 1.0, 4 / 3],
  "sa-ni":       [0.5, 1.0, 1.0, 15 / 8],
  "sa-ma-pa-ni": [1.0, 4 / 3, 1.5, 15 / 8],
};

DroneVoiceProcessor.prototype.initTanpura = function() {
    this.NUM_STRINGS = 4;
    const tuningId = this.tanpuraTuningOpt || "classic";
    const ratios = TANPURA_TUNING_RATIOS[tuningId] || TANPURA_TUNING_RATIOS.classic;
    this.stringDetune = ratios.slice();
    this.stringPanL = [0.85, 1.0, 0.7, 0.9];
    this.stringPanR = [1.0, 0.7, 0.85, 0.9];
    // 60 ms delay line — enough for a sub-octave (0.5×) string down to
    // a ~17 Hz root. Previously 40 ms which clipped explicit Sa-below
    // tunings at low tonics.
    this.ksMax = Math.ceil(sampleRate * 0.06) + 8;
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
    this.pluckCountdowns = new Float32Array([0.1, 0.5, 0.9, 1.3]);
    this.stringDamp = [0.9983, 0.9985, 0.9986, 0.9984];
    this.ksBodyF = 2 * Math.sin(Math.PI * 150 / sampleRate);
    this.ksBodyDamp = 1 / 4;
    this.ksBodyLowL = 0;
    this.ksBodyBandL = 0;
    this.ksBodyLowR = 0;
    this.ksBodyBandR = 0;
    this.hsKsL = 0;
    this.hsKsR = 0;
    this.holdActive = false;
    // Per-string 2× halfband oversamplers around the jawari nonlinearity
    // (tanh + sin compound). The input is already KS-lowpass-filtered so
    // aliasing is subtler than AMP/METAL, but jawari's sin(2.1·y) term
    // can still fold audible images on loud plucks.
    this.jawHbL = [];
    this.jawHbR = [];
    for (let s = 0; s < this.NUM_STRINGS; s++) {
      this.jawHbL.push(new Halfband2x());
      this.jawHbR.push(new Halfband2x());
    }
};

DroneVoiceProcessor.prototype.tanpuraProcess = function(L, R, n, freq, drift, amp, pluckRate) {
    const hold = pluckRate < 0.05;
    const baseLen = sampleRate / Math.max(20, freq);
    const jawK = 1.1;
    const jawMix = 0.22;

    // Pluck scheduling — round-robin, each string on its own timer
    const blockSec = n / sampleRate;
    if (hold) {
      if (!this.holdActive) {
        this.holdActive = true;
        for (let s = 0; s < this.NUM_STRINGS; s++) {
          const exact = Math.min(this.ksMax - 2, Math.max(8, baseLen / this.stringDetune[s]));
          this.doPluckString(s, Math.floor(exact));
        }
      }
    } else {
      this.holdActive = false;
      for (let s = 0; s < this.NUM_STRINGS; s++) {
        this.pluckCountdowns[s] -= blockSec;
        if (this.pluckCountdowns[s] <= 0) {
          const exact = Math.min(this.ksMax - 2, Math.max(8, baseLen / this.stringDetune[s]));
          this.doPluckString(s, Math.floor(exact));
          const pr = Math.max(0.05, pluckRate || 1);
          this.pluckCountdowns[s] = (5.0 + this.rng() * 2.0) / pr;
        }
      }
    }

    // Per-string delay lengths (stable — same root, micro-detune only)
    const delayLens = new Int32Array(this.NUM_STRINGS);
    const delayLensR = new Int32Array(this.NUM_STRINGS);
    const fracsL = new Float32Array(this.NUM_STRINGS);
    const fracsR = new Float32Array(this.NUM_STRINGS);
    for (let s = 0; s < this.NUM_STRINGS; s++) {
      const dt = this.stringDetune[s];
      const exact = Math.min(this.ksMax - 2, Math.max(8, baseLen / dt));
      delayLens[s] = Math.floor(exact);
      fracsL[s] = exact - delayLens[s];
      const exactR = Math.min(this.ksMax - 2, Math.max(8, baseLen / (dt * 1.003)));
      delayLensR[s] = Math.floor(exactR);
      fracsR[s] = exactR - delayLensR[s];
    }

    for (let i = 0; i < n; i++) {
      let sumL = 0, sumR = 0;

      for (let s = 0; s < this.NUM_STRINGS; s++) {
        const buf = this.ksBufs[s];
        const bufR = this.ksBufsR[s];
        const idx = this.ksIdxs[s];
        const idxR = this.ksIdxsR[s];
        const dLen = delayLens[s];
        const dLenR = delayLensR[s];
        const damp = hold ? 1.0 : this.stringDamp[s] - drift * 0.0012;

        const cur = buf[idx];
        const nxt = buf[(idx + 1) % dLen];
        let y = cur * (1 - fracsL[s]) + nxt * fracsL[s] + 1e-25;
        this.ksLasts[s] = this.ksLasts[s] * 0.35 + y * 0.65;
        y = this.ksLasts[s] * damp;
        // Oversampled jawari — the tanh+sin compound is the alias-prone
        // part of the string tone; running it through a halfband kills
        // the audible imaging without changing the dry/wet mix (0.78/0.22).
        y = this.jawHbL[s].process(
          y,
          (v) => v * 0.78 + (Math.tanh(jawK * v) + jawMix * fastSin(jawK * 2.1 * v)) * 0.22,
        );

        const curR = bufR[idxR];
        const nxtR = bufR[(idxR + 1) % dLenR];
        let yR = curR * (1 - fracsR[s]) + nxtR * fracsR[s] + 1e-25;
        this.ksLastsR[s] = this.ksLastsR[s] * 0.35 + yR * 0.65;
        yR = this.ksLastsR[s] * damp;
        yR = this.jawHbR[s].process(
          yR,
          (v) => v * 0.78 + (Math.tanh(jawK * v) + jawMix * fastSin(jawK * 2.1 * v)) * 0.22,
        );

        buf[idx] = y;
        this.ksIdxs[s] = (idx + 1) % dLen;
        bufR[idxR] = yR;
        this.ksIdxsR[s] = (idxR + 1) % dLenR;

        sumL += y * this.stringPanL[s];
        sumR += yR * this.stringPanR[s];
      }

      sumL *= 0.3;
      sumR *= 0.3;

      const bodyHighL = sumL - this.ksBodyLowL - this.ksBodyDamp * this.ksBodyBandL;
      this.ksBodyBandL += this.ksBodyF * bodyHighL;
      this.ksBodyLowL += this.ksBodyF * this.ksBodyBandL;
      const bodyHighR = sumR - this.ksBodyLowR - this.ksBodyDamp * this.ksBodyBandR;
      this.ksBodyBandR += this.ksBodyF * bodyHighR;
      this.ksBodyLowR += this.ksBodyF * this.ksBodyBandR;

      let postL = sumL + this.ksBodyBandL * 0.12;
      let postR = sumR + this.ksBodyBandR * 0.12;
      this.hsKsL = this.hsKsL * 0.6 + postL * 0.4;
      this.hsKsR = this.hsKsR * 0.6 + postR * 0.4;
      postL += (postL - this.hsKsL) * 0.3;
      postR += (postR - this.hsKsR) * 0.3;

      L[i] = postL * amp;
      R[i] = postR * amp;
    }
};

DroneVoiceProcessor.prototype.doPluckString = function(s, delayLen) {
    const buf = this.ksBufs[s];
    const bufR = this.ksBufsR[s];
    const delayLenR = Math.min(this.ksMax - 2, delayLen + 2);
    const lpCoef = 0.15;
    let lpL = 0;
    for (let i = 0; i < delayLen; i++) {
      const v = (this.rng() * 2 - 1);
      lpL += lpCoef * (v - lpL);
      buf[i] = lpL * 0.85;
    }
    let lpR = 0;
    for (let i = 0; i < delayLenR; i++) {
      const v = (this.rng() * 2 - 1);
      lpR += lpCoef * (v - lpR);
      bufR[i] = lpR * 0.85;
    }
    this.ksIdxs[s] = 0;
    this.ksIdxsR[s] = 0;
    this.ksLasts[s] = 0;
    this.ksLastsR[s] = 0;
};
