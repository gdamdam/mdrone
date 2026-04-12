/**
 * fxChainProcessor — AudioWorklet processors for the mdrone effects
 * chain. Three distinct processor classes registered in one module:
 *
 *   fx-plate    — Jon Dattorro's classic plate reverb (4 diffusers +
 *                 tank with modulated allpass + figure-8 tap outputs)
 *   fx-shimmer  — pitch-shift feedback loop (crossfading-head delay
 *                 line shifter + short allpass network for tail)
 *   fx-freeze   — ring buffer capture + crossfaded loop playback
 *
 * The other effects (HALL, TAPE, WOW, DELAY, SUB, COMB) stay in the
 * Web Audio node graph because they either:
 *   (a) are simple enough that native primitives do them correctly
 *       (SUB, COMB, WOW, DELAY)
 *   (b) benefit from Worklet but the improvement is marginal (TAPE
 *       with native 2x-oversampled WaveShaper is already decent)
 *   (c) HALL is refactored to a native Freeverb in FxChain.ts
 *
 * All parameters are k-rate AudioParams for smooth automation.
 * Global sampleRate is available in AudioWorkletGlobalScope.
 */

/* global sampleRate, AudioWorkletProcessor, registerProcessor */

// ═════════════════════════════════════════════════════════════════════
// DATTORRO PLATE REVERB
// ═════════════════════════════════════════════════════════════════════
// Reference: Jon Dattorro, "Effect Design, Part 1: Reverberator and
// Other Filters", JAES Vol 45 No 9, Sep 1997.
//
// Topology:
//   Input → input diffusion (4 serial allpasses at 142/107/379/277
//           samples with coefficients 0.75/0.75/0.625/0.625)
//         → tank (two crossed feedback loops):
//             left:  mod-allpass → delay1 → LP → allpass → delay2 → ×decay → cross
//             right: mod-allpass → delay3 → LP → allpass → delay4 → ×decay → cross
//         → 7-tap output summed to L/R ("figure 8" taps)
//
// Delay lengths are from the paper (Dattorro used 29761 Hz) and get
// scaled to the actual context sample rate.
//
class DattorroPlateProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "decay",     defaultValue: 0.5,  minValue: 0, maxValue: 0.99, automationRate: "k-rate" },
      { name: "damping",   defaultValue: 0.35, minValue: 0, maxValue: 1,    automationRate: "k-rate" },
      { name: "diffusion", defaultValue: 0.75, minValue: 0, maxValue: 0.9,  automationRate: "k-rate" },
      { name: "mix",       defaultValue: 1,    minValue: 0, maxValue: 1,    automationRate: "k-rate" },
    ];
  }

  constructor() {
    super();
    const ref = 29761;
    const scale = sampleRate / ref;

    // Input diffusion lengths (scaled)
    this.l_ap1 = Math.round(142 * scale);
    this.l_ap2 = Math.round(107 * scale);
    this.l_ap3 = Math.round(379 * scale);
    this.l_ap4 = Math.round(277 * scale);

    // Tank lengths
    this.l_modAP1  = Math.round(672 * scale);  // +8 mod depth
    this.l_delay1  = Math.round(4453 * scale);
    this.l_tankAP1 = Math.round(1800 * scale);
    this.l_delay2  = Math.round(3720 * scale);
    this.l_modAP2  = Math.round(908 * scale);
    this.l_delay3  = Math.round(4217 * scale);
    this.l_tankAP2 = Math.round(2656 * scale);
    this.l_delay4  = Math.round(3163 * scale);

    // Buffers + write indices for every delay line
    this.buf_ap1   = new Float32Array(this.l_ap1);
    this.buf_ap2   = new Float32Array(this.l_ap2);
    this.buf_ap3   = new Float32Array(this.l_ap3);
    this.buf_ap4   = new Float32Array(this.l_ap4);
    this.buf_modAP1  = new Float32Array(this.l_modAP1 + 16);
    this.buf_delay1  = new Float32Array(this.l_delay1);
    this.buf_tankAP1 = new Float32Array(this.l_tankAP1);
    this.buf_delay2  = new Float32Array(this.l_delay2);
    this.buf_modAP2  = new Float32Array(this.l_modAP2 + 16);
    this.buf_delay3  = new Float32Array(this.l_delay3);
    this.buf_tankAP2 = new Float32Array(this.l_tankAP2);
    this.buf_delay4  = new Float32Array(this.l_delay4);

    this.idx_ap1 = 0;
    this.idx_ap2 = 0;
    this.idx_ap3 = 0;
    this.idx_ap4 = 0;
    this.idx_modAP1  = 0;
    this.idx_delay1  = 0;
    this.idx_tankAP1 = 0;
    this.idx_delay2  = 0;
    this.idx_modAP2  = 0;
    this.idx_delay3  = 0;
    this.idx_tankAP2 = 0;
    this.idx_delay4  = 0;

    // Tank lowpass state (one-pole per side)
    this.lpL = 0;
    this.lpR = 0;
    // Tank cross-feedback
    this.crossL = 0;
    this.crossR = 0;
    // Input bandwidth one-pole
    this.bwState = 0;
    // Modulation LFOs (different phases so the two mod APs aren't in sync)
    this.lfoPhase1 = 0;
    this.lfoPhase2 = Math.PI * 0.5;

    // Dattorro constants
    this.ID_AP1 = 0.75;  // inputDiffusion1
    this.ID_AP2 = 0.625; // inputDiffusion2 (applied to ap3, ap4)
    this.TAP_1  = 0.7;   // decayDiffusion1 (mod APs)
    this.TAP_2  = 0.5;   // decayDiffusion2 (tank APs)
    this.BW     = 0.9995; // input bandwidth
  }

  /** Interpolated delay read (linear). */
  readInterp(buf, writeIdx, delaySamples) {
    const len = buf.length;
    const readF = writeIdx - delaySamples;
    const i0 = ((readF | 0) % len + len) % len;
    const frac = readF - Math.floor(readF);
    const i1 = (i0 + 1) % len;
    return buf[i0] * (1 - frac) + buf[i1] * frac;
  }

  process(_inputs, outputs, parameters) {
    const input = _inputs[0];
    const output = outputs[0];
    if (!input || input.length === 0 || !output) return true;
    const inL = input[0];
    const inR = input.length > 1 ? input[1] : input[0];
    const outL = output[0];
    const outR = output.length > 1 ? output[1] : output[0];
    const n = outL.length;

    const decay = parameters.decay[0];
    const damping = parameters.damping[0];
    const diffusion = parameters.diffusion[0];
    const mix = parameters.mix[0];

    // Lowpass coefficient (one-pole)
    const lpCoef = 1 - Math.exp(-6.28 * (1 - damping) * 8000 / sampleRate);
    const bwCoef = this.BW;

    // Mod allpass phase increments — 1.0 Hz and 0.7 Hz (incommensurate)
    const modInc1 = 2 * Math.PI * 1.0 / sampleRate;
    const modInc2 = 2 * Math.PI * 0.7 / sampleRate;
    const modDepth = 8; // ±8 samples

    const idAp1 = this.ID_AP1 * (diffusion / 0.75);
    const idAp2 = this.ID_AP2 * (diffusion / 0.75);
    const tap1 = this.TAP_1 * (decay / 0.5);
    const tap2 = this.TAP_2 * (decay / 0.5);

    for (let i = 0; i < n; i++) {
      const inSample = (inL[i] + inR[i]) * 0.5;

      // Input bandwidth
      this.bwState = this.bwState * (1 - bwCoef) + inSample * bwCoef;
      let x = this.bwState;

      // Input diffusion — 4 serial allpasses
      // AP1
      {
        const d = this.buf_ap1[this.idx_ap1];
        const y = -idAp1 * x + d;
        this.buf_ap1[this.idx_ap1] = x + idAp1 * y;
        this.idx_ap1 = (this.idx_ap1 + 1) % this.l_ap1;
        x = y;
      }
      // AP2
      {
        const d = this.buf_ap2[this.idx_ap2];
        const y = -idAp1 * x + d;
        this.buf_ap2[this.idx_ap2] = x + idAp1 * y;
        this.idx_ap2 = (this.idx_ap2 + 1) % this.l_ap2;
        x = y;
      }
      // AP3
      {
        const d = this.buf_ap3[this.idx_ap3];
        const y = -idAp2 * x + d;
        this.buf_ap3[this.idx_ap3] = x + idAp2 * y;
        this.idx_ap3 = (this.idx_ap3 + 1) % this.l_ap3;
        x = y;
      }
      // AP4
      {
        const d = this.buf_ap4[this.idx_ap4];
        const y = -idAp2 * x + d;
        this.buf_ap4[this.idx_ap4] = x + idAp2 * y;
        this.idx_ap4 = (this.idx_ap4 + 1) % this.l_ap4;
        x = y;
      }

      // x is now the diffused input feeding both tank sides
      // Advance LFOs
      this.lfoPhase1 += modInc1;
      this.lfoPhase2 += modInc2;
      if (this.lfoPhase1 > Math.PI * 2) this.lfoPhase1 -= Math.PI * 2;
      if (this.lfoPhase2 > Math.PI * 2) this.lfoPhase2 -= Math.PI * 2;
      const mod1 = Math.sin(this.lfoPhase1) * modDepth;
      const mod2 = Math.sin(this.lfoPhase2) * modDepth;

      // Left tank side — input + cross feedback from right
      let sig = x + this.crossR * decay;

      // Modulated allpass 1
      {
        const delayLen = this.l_modAP1 + mod1;
        const d = this.readInterp(this.buf_modAP1, this.idx_modAP1, delayLen);
        const y = -tap1 * sig + d;
        this.buf_modAP1[this.idx_modAP1] = sig + tap1 * y;
        this.idx_modAP1 = (this.idx_modAP1 + 1) % this.buf_modAP1.length;
        sig = y;
      }
      // Delay 1
      {
        const d = this.buf_delay1[this.idx_delay1];
        this.buf_delay1[this.idx_delay1] = sig;
        this.idx_delay1 = (this.idx_delay1 + 1) % this.l_delay1;
        sig = d;
      }
      // Lowpass (damping)
      this.lpL = this.lpL * (1 - lpCoef) + sig * lpCoef;
      sig = this.lpL;
      // Decay
      sig *= decay;
      // Tank allpass 1
      {
        const d = this.buf_tankAP1[this.idx_tankAP1];
        const y = tap2 * sig + d;
        this.buf_tankAP1[this.idx_tankAP1] = sig - tap2 * y;
        this.idx_tankAP1 = (this.idx_tankAP1 + 1) % this.l_tankAP1;
        sig = y;
      }
      // Delay 2
      {
        const d = this.buf_delay2[this.idx_delay2];
        this.buf_delay2[this.idx_delay2] = sig;
        this.idx_delay2 = (this.idx_delay2 + 1) % this.l_delay2;
        this.crossL = d * decay;
      }

      // Right tank side — input + cross feedback from left
      sig = x + this.crossL;

      // Modulated allpass 2
      {
        const delayLen = this.l_modAP2 + mod2;
        const d = this.readInterp(this.buf_modAP2, this.idx_modAP2, delayLen);
        const y = -tap1 * sig + d;
        this.buf_modAP2[this.idx_modAP2] = sig + tap1 * y;
        this.idx_modAP2 = (this.idx_modAP2 + 1) % this.buf_modAP2.length;
        sig = y;
      }
      // Delay 3
      {
        const d = this.buf_delay3[this.idx_delay3];
        this.buf_delay3[this.idx_delay3] = sig;
        this.idx_delay3 = (this.idx_delay3 + 1) % this.l_delay3;
        sig = d;
      }
      // Lowpass
      this.lpR = this.lpR * (1 - lpCoef) + sig * lpCoef;
      sig = this.lpR;
      // Decay
      sig *= decay;
      // Tank allpass 2
      {
        const d = this.buf_tankAP2[this.idx_tankAP2];
        const y = tap2 * sig + d;
        this.buf_tankAP2[this.idx_tankAP2] = sig - tap2 * y;
        this.idx_tankAP2 = (this.idx_tankAP2 + 1) % this.l_tankAP2;
        sig = y;
      }
      // Delay 4
      {
        const d = this.buf_delay4[this.idx_delay4];
        this.buf_delay4[this.idx_delay4] = sig;
        this.idx_delay4 = (this.idx_delay4 + 1) % this.l_delay4;
        this.crossR = d * decay;
      }

      // Figure-8 output taps — Dattorro's recommended tap positions
      // scaled from the paper's 29761 Hz reference.
      const s = sampleRate / 29761;
      const tapL =
        this.readInterp(this.buf_delay1, this.idx_delay1, 266 * s)
        + this.readInterp(this.buf_delay1, this.idx_delay1, 2974 * s)
        - this.readInterp(this.buf_tankAP1, this.idx_tankAP1, 1913 * s)
        + this.readInterp(this.buf_delay2, this.idx_delay2, 1996 * s)
        - this.readInterp(this.buf_delay3, this.idx_delay3, 1990 * s)
        - this.readInterp(this.buf_tankAP2, this.idx_tankAP2, 187 * s)
        - this.readInterp(this.buf_delay4, this.idx_delay4, 1066 * s);
      const tapR =
        this.readInterp(this.buf_delay3, this.idx_delay3, 353 * s)
        + this.readInterp(this.buf_delay3, this.idx_delay3, 3627 * s)
        - this.readInterp(this.buf_tankAP2, this.idx_tankAP2, 1228 * s)
        + this.readInterp(this.buf_delay4, this.idx_delay4, 2673 * s)
        - this.readInterp(this.buf_delay1, this.idx_delay1, 2111 * s)
        - this.readInterp(this.buf_tankAP1, this.idx_tankAP1, 335 * s)
        - this.readInterp(this.buf_delay2, this.idx_delay2, 121 * s);

      outL[i] = tapL * 0.6 * mix;
      outR[i] = tapR * 0.6 * mix;
    }
    return true;
  }
}
registerProcessor("fx-plate", DattorroPlateProcessor);

// ═════════════════════════════════════════════════════════════════════
// SHIMMER REVERB — pitch-shift feedback cloud
// ═════════════════════════════════════════════════════════════════════
// Architecture:
//
//   Input → pitch-shifting delay line (+12 semitones via 2 crossfading
//           read heads at 2x playback rate, classic Lagrange approach)
//         → lowpass (tame upper-octave harshness)
//         → 2-allpass diffuser (spread the pitched signal)
//         → feedback gain
//           ↳ back into the pitch shifter input
//         → output
//
// The +12 feedback loop creates the classic Eno Ambient 2 / Jonsi
// ascending-cloud shimmer. Each pass adds another octave above the
// previous one until the feedback rolls off.
//
class ShimmerReverbProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "feedback", defaultValue: 0.55, minValue: 0, maxValue: 0.85, automationRate: "k-rate" },
      { name: "mix",      defaultValue: 0.5,  minValue: 0, maxValue: 1,    automationRate: "k-rate" },
      { name: "decay",    defaultValue: 0.7,  minValue: 0, maxValue: 0.95, automationRate: "k-rate" },
    ];
  }

  constructor() {
    super();
    // Shift buffer length — 50 ms gives room for the two read heads
    // to cross-fade without artifacts. Stereo kept separate.
    this.shiftLen = Math.ceil(sampleRate * 0.05);
    this.shiftBufL = new Float32Array(this.shiftLen);
    this.shiftBufR = new Float32Array(this.shiftLen);
    this.writeIdx = 0;

    // Two read heads, half-buffer apart, each advancing at 2×
    this.readHead1 = 0;
    this.readHead2 = this.shiftLen / 2;

    // Feedback path — stored values from last sample
    this.fbL = 0;
    this.fbR = 0;

    // Tail allpasses for diffusion (two per channel at different lengths)
    this.ap1L = new Float32Array(571);
    this.ap2L = new Float32Array(881);
    this.ap1R = new Float32Array(619);
    this.ap2R = new Float32Array(839);
    this.ap1L_i = 0;
    this.ap2L_i = 0;
    this.ap1R_i = 0;
    this.ap2R_i = 0;

    // Lowpass on feedback (tame shimmer harshness)
    this.lpL = 0;
    this.lpR = 0;
    // Input-gate envelope — decays the feedback when input goes silent
    // so the shimmer tail dies instead of self-oscillating forever.
    this.gateEnv = 0;
  }

  process(_inputs, outputs, parameters) {
    const input = _inputs[0];
    const output = outputs[0];
    if (!input || input.length === 0 || !output) return true;
    const inL = input[0];
    const inR = input.length > 1 ? input[1] : input[0];
    const outL = output[0];
    const outR = output.length > 1 ? output[1] : output[0];
    const n = outL.length;

    const fb = parameters.feedback[0];
    const mix = parameters.mix[0];
    const decay = parameters.decay[0];
    const lpCoef = 0.25; // fixed tail lowpass coefficient
    const apCoef = 0.6;  // allpass diffusion coefficient
    const ANTI_DENORMAL = 1e-25;

    for (let i = 0; i < n; i++) {
      // Input gate — track whether signal is present. When input
      // goes silent the gate closes over ~200ms, decaying the
      // feedback so the shimmer tail dies instead of ringing forever.
      const inPower = inL[i] * inL[i] + inR[i] * inR[i];
      const gateTarget = inPower > 1e-8 ? 1 : 0;
      this.gateEnv += (gateTarget - this.gateEnv) * 0.0002;
      const gateFb = fb * (0.3 + 0.7 * this.gateEnv);

      // Write input + feedback into shift buffer
      const inSampleL = inL[i] + this.fbL * gateFb + ANTI_DENORMAL;
      const inSampleR = inR[i] + this.fbR * gateFb + ANTI_DENORMAL;
      this.shiftBufL[this.writeIdx] = inSampleL;
      this.shiftBufR[this.writeIdx] = inSampleR;

      // Read at 2× speed from two crossfading heads
      // Head positions are updated each sample; they advance by 2 samples
      // and wrap at shiftLen.
      const h1 = this.readHead1;
      const h2 = this.readHead2;
      // Linear interpolation read
      const h1i = Math.floor(h1);
      const h1f = h1 - h1i;
      const h2i = Math.floor(h2);
      const h2f = h2 - h2i;
      const len = this.shiftLen;
      const r1L = this.shiftBufL[h1i] * (1 - h1f) + this.shiftBufL[(h1i + 1) % len] * h1f;
      const r2L = this.shiftBufL[h2i] * (1 - h2f) + this.shiftBufL[(h2i + 1) % len] * h2f;
      const r1R = this.shiftBufR[h1i] * (1 - h1f) + this.shiftBufR[(h1i + 1) % len] * h1f;
      const r2R = this.shiftBufR[h2i] * (1 - h2f) + this.shiftBufR[(h2i + 1) % len] * h2f;

      // Crossfade between heads based on distance from write head
      // (equal-power crossfade using triangular windows)
      const d1 = ((this.writeIdx - h1 + len) % len) / len;
      const d2 = ((this.writeIdx - h2 + len) % len) / len;
      const w1 = Math.sin(Math.PI * d1); // window peaks at middle of buffer
      const w2 = Math.sin(Math.PI * d2);
      let pitchL = r1L * w1 + r2L * w2;
      let pitchR = r1R * w1 + r2R * w2;

      // Lowpass on the pitched signal — keeps high-octave feedback from
      // turning into metallic screech
      this.lpL = this.lpL + lpCoef * (pitchL - this.lpL);
      this.lpR = this.lpR + lpCoef * (pitchR - this.lpR);
      pitchL = this.lpL * decay;
      pitchR = this.lpR * decay;

      // Allpass diffusion — two serial APs per channel
      {
        const d = this.ap1L[this.ap1L_i];
        const y = -apCoef * pitchL + d;
        this.ap1L[this.ap1L_i] = pitchL + apCoef * y;
        this.ap1L_i = (this.ap1L_i + 1) % this.ap1L.length;
        pitchL = y;
      }
      {
        const d = this.ap2L[this.ap2L_i];
        const y = -apCoef * pitchL + d;
        this.ap2L[this.ap2L_i] = pitchL + apCoef * y;
        this.ap2L_i = (this.ap2L_i + 1) % this.ap2L.length;
        pitchL = y;
      }
      {
        const d = this.ap1R[this.ap1R_i];
        const y = -apCoef * pitchR + d;
        this.ap1R[this.ap1R_i] = pitchR + apCoef * y;
        this.ap1R_i = (this.ap1R_i + 1) % this.ap1R.length;
        pitchR = y;
      }
      {
        const d = this.ap2R[this.ap2R_i];
        const y = -apCoef * pitchR + d;
        this.ap2R[this.ap2R_i] = pitchR + apCoef * y;
        this.ap2R_i = (this.ap2R_i + 1) % this.ap2R.length;
        pitchR = y;
      }

      // Store as next feedback
      this.fbL = pitchL;
      this.fbR = pitchR;

      outL[i] = pitchL * mix;
      outR[i] = pitchR * mix;

      // Advance write + read heads
      this.writeIdx = (this.writeIdx + 1) % len;
      this.readHead1 = (this.readHead1 + 2) % len;
      this.readHead2 = (this.readHead2 + 2) % len;
    }
    return true;
  }
}
registerProcessor("fx-shimmer", ShimmerReverbProcessor);

// ═════════════════════════════════════════════════════════════════════
// FREEZE — ring buffer capture + crossfaded loop playback
// ═════════════════════════════════════════════════════════════════════
// Behavior:
//   - In IDLE mode (active=0): write input to ring, output silence
//   - When active flips to 1: snapshot the current ring position, freeze
//     writes, start reading from snapshot position onward
//   - Loop the captured audio with a short (30 ms) crossfade at the seam
//   - When active flips to 0: fade the loop out over 300 ms, resume writing
//
class FreezeProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "active", defaultValue: 0, minValue: 0, maxValue: 1, automationRate: "k-rate" },
      { name: "mix",    defaultValue: 0.7, minValue: 0, maxValue: 1, automationRate: "k-rate" },
    ];
  }

  constructor() {
    super();
    // 2 seconds of stereo ring buffer
    this.ringLen = Math.ceil(sampleRate * 2);
    this.ringL = new Float32Array(this.ringLen);
    this.ringR = new Float32Array(this.ringLen);
    this.writeIdx = 0;
    this.readIdx = 0;
    this.snapStart = 0;
    this.wasActive = 0;
    this.fadeEnv = 0; // 0..1 envelope for capture fade in/out
    // 30 ms crossfade region at the loop boundary
    this.fadeLen = Math.ceil(sampleRate * 0.03);
  }

  process(_inputs, outputs, parameters) {
    const input = _inputs[0];
    const output = outputs[0];
    if (!input || input.length === 0 || !output) return true;
    const inL = input[0];
    const inR = input.length > 1 ? input[1] : input[0];
    const outL = output[0];
    const outR = output.length > 1 ? output[1] : output[0];
    const n = outL.length;

    const active = parameters.active[0];
    const mix = parameters.mix[0];

    // Detect rising edge — snapshot current write position
    if (active > 0.5 && this.wasActive <= 0.5) {
      this.snapStart = this.writeIdx;
      this.readIdx = this.writeIdx;
    }
    this.wasActive = active;

    // Target envelope — ramp fadeEnv toward 1 when active, 0 when not
    const envTarget = active > 0.5 ? 1 : 0;
    const envRate = active > 0.5 ? 0.0008 : 0.0004; // faster in, slower out

    for (let i = 0; i < n; i++) {
      // Smoothly approach target envelope
      if (this.fadeEnv < envTarget) this.fadeEnv = Math.min(envTarget, this.fadeEnv + envRate);
      else if (this.fadeEnv > envTarget) this.fadeEnv = Math.max(envTarget, this.fadeEnv - envRate);

      if (this.fadeEnv < 0.0001) {
        // Fully idle — write input to ring, output silence
        this.ringL[this.writeIdx] = inL[i];
        this.ringR[this.writeIdx] = inR[i];
        this.writeIdx = (this.writeIdx + 1) % this.ringLen;
        outL[i] = 0;
        outR[i] = 0;
      } else {
        // Capture / playback mode
        // Determine current read position relative to snapStart
        const offset = (this.readIdx - this.snapStart + this.ringLen) % this.ringLen;
        // Normal read
        let sL = this.ringL[this.readIdx];
        let sR = this.ringR[this.readIdx];

        // Crossfade at the loop boundary: for the last fadeLen samples
        // before we'd wrap to snapStart, blend with samples from the
        // opposite side of the loop to hide the seam.
        const tailZone = this.ringLen - this.fadeLen;
        if (offset >= tailZone) {
          const fadeT = (offset - tailZone) / this.fadeLen; // 0..1 near the seam
          const altOffset = offset - this.ringLen + this.fadeLen; // negative → reads from start side
          const altIdx = (this.snapStart + altOffset + this.ringLen) % this.ringLen;
          const altL = this.ringL[altIdx];
          const altR = this.ringR[altIdx];
          sL = sL * (1 - fadeT) + altL * fadeT;
          sR = sR * (1 - fadeT) + altR * fadeT;
        }

        // Advance read, wrapping at the snapshot-relative loop length
        this.readIdx = (this.readIdx + 1) % this.ringLen;

        // Apply envelope and mix
        outL[i] = sL * mix * this.fadeEnv;
        outR[i] = sR * mix * this.fadeEnv;

        // While releasing (active=0 but still fading), resume writing
        // so when we fully fade out the ring is primed for a fresh capture
        if (active <= 0.5) {
          this.ringL[this.writeIdx] = inL[i];
          this.ringR[this.writeIdx] = inR[i];
          this.writeIdx = (this.writeIdx + 1) % this.ringLen;
        }
      }
    }
    return true;
  }
}
registerProcessor("fx-freeze", FreezeProcessor);

// ═══════════════════════════════════════════════════════════════════════
// GRANULAR — tail-processor grain cloud for textural drones
// ═══════════════════════════════════════════════════════════════════════
//
// A ring buffer continuously captures incoming audio (about 4 seconds).
// A grain scheduler starts a new grain every (1 / density) seconds. Each
// grain reads from the ring buffer at `position` (offset from the write
// head) with a Hann window envelope, a fractional pitch ratio for
// resampling, and a random pan. Multiple overlapping grains are summed.
//
// Parameters (k-rate):
//   size        — grain length in seconds (0.05..0.8)
//   density     — grains per second (1..40)
//   pitchSpread — 0..1, random pitch deviation amount (±1 octave at 1)
//   panSpread   — 0..1, random L/R pan amount
//   position    — 0..1, read offset from write head (0 = live, 1 = ~buffer length back)
//   mix         — 0..1, dry/wet mix
//
// Used for Köner, Hecker, Fennesz, Basinski, Biosphere presets.

const GRANULAR_BUFFER_SEC = 4.0;
const GRANULAR_MAX_GRAINS = 24;

class FxGranularProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      // "Granular" defaults — medium grains (200 ms) at moderate
      // density (6/s) = overlap 1.2. Each grain registers as its
      // own attack against its neighbours without fully stuttering
      // like the tighter `graincloud` variant. Pitch scatter ±0.2
      // octave (≈ 240 cents) is audible but not dissonant. This
      // is the "smooth drone granular" facet — still recognisable
      // as granular, not a pad-smoother.
      { name: "size",        defaultValue: 0.2,  minValue: 0.02, maxValue: 2.0, automationRate: "k-rate" },
      { name: "density",     defaultValue: 6,    minValue: 0.3,  maxValue: 40,  automationRate: "k-rate" },
      { name: "pitchSpread", defaultValue: 0.2,  minValue: 0,    maxValue: 1,   automationRate: "k-rate" },
      { name: "panSpread",   defaultValue: 0.6,  minValue: 0,    maxValue: 1,   automationRate: "k-rate" },
      { name: "position",    defaultValue: 0.4,  minValue: 0,    maxValue: 1,   automationRate: "k-rate" },
      { name: "mix",         defaultValue: 0.9,  minValue: 0,    maxValue: 1,   automationRate: "k-rate" },
      // pitchMode: 0 = random continuous scatter ±pitchSpread octaves,
      // 1 = snap-to-scale (grain picks a random interval from the drone's
      // current pitch stack, yielding musically consonant grain clouds).
      { name: "pitchMode",   defaultValue: 0,    minValue: 0,    maxValue: 1,   automationRate: "k-rate" },
      // envelope: 0 = trapezoid 10/80/10 (smooth drone cloud),
      // 1 = falling-exponential (short fade-in then exp decay — gives
      // the percussive grain attack that classic granular wants).
      { name: "envelope",    defaultValue: 0,    minValue: 0,    maxValue: 1,   automationRate: "k-rate" },
      // spawnMode: 0 = random buffer position per grain,
      // 1 = ordered time-stretch (grains read consecutive buffer chunks,
      // producing delayed-replay / stretched playback of the source).
      { name: "spawnMode",   defaultValue: 0,    minValue: 0,    maxValue: 1,   automationRate: "k-rate" },
    ];
  }

  constructor() {
    super();
    this.bufLen = Math.floor(GRANULAR_BUFFER_SEC * sampleRate);
    this.bufL = new Float32Array(this.bufLen);
    this.bufR = new Float32Array(this.bufLen);
    this.writeIdx = 0;

    // Grain pool — each grain has position-in-buffer, remaining samples,
    // pitch ratio, pan L/R gains, and its read accumulator.
    this.grains = [];
    for (let i = 0; i < GRANULAR_MAX_GRAINS; i++) {
      this.grains.push({ active: false, pos: 0, len: 1, age: 0, ratio: 1, gL: 1, gR: 1 });
    }

    // Time accumulator for grain scheduling
    this.sinceLastGrain = 0;

    // Pitch-quantisation scale — set via port message. Each entry is
    // a cents offset; in quantised mode, every new grain picks a random
    // entry and plays its source at that pitch ratio. Default [0] means
    // "unison only" when quantised, which falls back to no pitch shift.
    this.scaleCents = [0];

    // Ordered-spawn read cursor — advances by grain length each spawn
    // so successive grains read consecutive chunks of the ring buffer.
    this.orderedReadIdx = 0;

    // Port message handler — main thread pushes the current drone
    // interval stack here so grain pitches stay in the scene's scale.
    this.port.onmessage = (e) => {
      const msg = e.data;
      if (msg && msg.type === "setScale" && Array.isArray(msg.cents) && msg.cents.length > 0) {
        this.scaleCents = msg.cents.slice();
      }
    };
  }

  spawnGrain(size, pitchSpread, panSpread, position, pitchMode, spawnMode) {
    // Find a free grain slot; if all are active, overwrite oldest
    let slot = -1;
    for (let i = 0; i < this.grains.length; i++) {
      if (!this.grains[i].active) { slot = i; break; }
    }
    if (slot < 0) {
      let oldest = 0, maxAge = -1;
      for (let i = 0; i < this.grains.length; i++) {
        if (this.grains[i].age > maxAge) { maxAge = this.grains[i].age; oldest = i; }
      }
      slot = oldest;
    }
    const g = this.grains[slot];
    const lenSamples = Math.max(32, Math.floor(size * sampleRate));

    // Pitch ratio: continuous random spread OR snap to a cents value
    // from the drone's current scale (Arturia Efx Fragments-style
    // musical quantisation — fixes the "woobly pitch" feel that random
    // continuous scatter produces on tonal sources).
    let ratio;
    if (pitchMode > 0.5 && this.scaleCents.length > 0) {
      const pick = this.scaleCents[Math.floor(Math.random() * this.scaleCents.length)] | 0;
      ratio = Math.pow(2, pick / 1200);
    } else {
      const pitchOct = (Math.random() * 2 - 1) * pitchSpread;
      ratio = Math.pow(2, pitchOct);
    }

    // Random pan: -1..1 scaled by panSpread
    const pan = (Math.random() * 2 - 1) * panSpread;
    // Equal-power pan
    const theta = (pan + 1) * 0.25 * Math.PI; // 0..π/2
    const gL = Math.cos(theta);
    const gR = Math.sin(theta);

    // Read position:
    //   ordered mode — successive grains read consecutive buffer
    //     chunks, producing a stretched/delayed replay of the source.
    //   random mode  — each grain jumps to a jittered offset behind
    //     the write head for a cloud texture.
    let startIdx;
    if (spawnMode > 0.5) {
      // Advance the ordered cursor by one grain length each spawn.
      // When it reaches the (moving) write head, wrap it back behind
      // by `position × bufLen` so we don't read past the write.
      const back = position * (this.bufLen - lenSamples * 2);
      const headGap = ((this.writeIdx - this.orderedReadIdx + this.bufLen) % this.bufLen);
      if (headGap < lenSamples * 2) {
        this.orderedReadIdx = this.writeIdx - back - lenSamples;
        while (this.orderedReadIdx < 0) this.orderedReadIdx += this.bufLen;
      }
      startIdx = this.orderedReadIdx;
      this.orderedReadIdx = (this.orderedReadIdx + lenSamples) % this.bufLen;
    } else {
      const jitter = (Math.random() - 0.5) * 0.04 * sampleRate;
      const back = position * (this.bufLen - lenSamples * 2) + jitter;
      startIdx = this.writeIdx - back - lenSamples;
      while (startIdx < 0) startIdx += this.bufLen;
      while (startIdx >= this.bufLen) startIdx -= this.bufLen;
    }

    g.active = true;
    g.pos = startIdx;
    g.len = lenSamples;
    g.age = 0;
    g.ratio = ratio;
    g.gL = gL;
    g.gR = gR;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!output || output.length === 0) return true;

    const L = output[0];
    const R = output.length > 1 ? output[1] : output[0];
    const n = L.length;

    const size        = parameters.size[0];
    const density     = parameters.density[0];
    const pitchSpread = parameters.pitchSpread[0];
    const panSpread   = parameters.panSpread[0];
    const position    = parameters.position[0];
    const mix         = parameters.mix[0];
    const pitchMode   = parameters.pitchMode[0];
    const envelope    = parameters.envelope[0];
    const spawnMode   = parameters.spawnMode[0];

    const inL = input && input[0] ? input[0] : null;
    const inR = input && input[1] ? input[1] : inL;

    // Seconds per grain for this block
    const grainInterval = 1 / Math.max(0.25, density);
    const invSr = 1 / sampleRate;

    for (let i = 0; i < n; i++) {
      // Write input into ring buffer
      const sL = inL ? inL[i] : 0;
      const sR = inR ? inR[i] : sL;
      this.bufL[this.writeIdx] = sL;
      this.bufR[this.writeIdx] = sR;
      this.writeIdx++;
      if (this.writeIdx >= this.bufLen) this.writeIdx = 0;

      // Schedule new grains
      this.sinceLastGrain += invSr;
      if (this.sinceLastGrain >= grainInterval) {
        this.sinceLastGrain -= grainInterval;
        this.spawnGrain(size, pitchSpread, panSpread, position, pitchMode, spawnMode);
      }

      // Accumulate active grain output + per-channel envelope sums.
      // envSumL / envSumR are the instantaneous sums of active grain
      // envelopes weighted by each grain's pan gain — so dividing
      // grainL by envSumL gives the pan-correct average left-channel
      // amplitude regardless of how grains are distributed in the
      // stereo field. Using a single un-panned envSum would leave the
      // left/right levels fluctuating as randomly-panned grains cycle
      // in and out (audible as "woob woob" especially at low overlap).
      let grainL = 0, grainR = 0, envSumL = 0, envSumR = 0;
      for (let gi = 0; gi < this.grains.length; gi++) {
        const g = this.grains[gi];
        if (!g.active) continue;
        const phase = g.age / g.len;
        if (phase >= 1) {
          g.active = false;
          continue;
        }
        // Envelope shape — switched by the `envelope` param:
        //   0: trapezoid 10/80/10 (smooth cloud, good for drone)
        //   1: falling-exponential (short 2 % fade-in then exp decay
        //      — the percussive attack that makes classic granular
        //      stutter-clouds sound like grains, not like a pad).
        let env;
        if (envelope > 0.5) {
          env = phase < 0.02
              ? phase / 0.02
              : Math.exp(-(phase - 0.02) * 6);
        } else {
          const fadeIn = 0.1, fadeOut = 0.9;
          env = phase < fadeIn ? phase / fadeIn
              : phase > fadeOut ? (1 - phase) / (1 - fadeOut)
              : 1;
        }

        // Read sample at g.pos with linear interpolation
        const idx = g.pos;
        const i0 = Math.floor(idx);
        const i1 = (i0 + 1) % this.bufLen;
        const frac = idx - i0;
        const i0Wrapped = ((i0 % this.bufLen) + this.bufLen) % this.bufLen;
        const sampleL = this.bufL[i0Wrapped] * (1 - frac) + this.bufL[i1] * frac;
        const sampleR = this.bufR[i0Wrapped] * (1 - frac) + this.bufR[i1] * frac;

        grainL += sampleL * env * g.gL;
        grainR += sampleR * env * g.gR;
        envSumL += env * g.gL;
        envSumR += env * g.gR;

        g.pos += g.ratio;
        if (g.pos >= this.bufLen) g.pos -= this.bufLen;
        g.age++;
      }

      // Per-channel envelope-sum normalisation. When at least one
      // grain is active on a given side, divide by its summed
      // pan-weighted envelope so both channels see constant grain
      // amplitude independent of the random pan distribution. Empty
      // sides (envSum ≈ 0) output the dry path cleanly.
      const scaleL = envSumL > 0.001 ? 1 / envSumL : 0;
      const scaleR = envSumR > 0.001 ? 1 / envSumR : 0;
      const dryMix = 1 - mix;
      L[i] = sL * dryMix + grainL * scaleL * mix;
      R[i] = sR * dryMix + grainR * scaleR * mix;
    }

    return true;
  }
}

registerProcessor("fx-granular", FxGranularProcessor);
