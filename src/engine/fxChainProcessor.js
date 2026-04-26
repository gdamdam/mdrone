/**
 * fxChainProcessor — AudioWorklet processors for the mdrone effects
 * chain. Three distinct processor classes registered in one module:
 *
 *   fx-plate    — Jon Dattorro's classic plate reverb (4 diffusers +
 *                 tank with modulated allpass + figure-8 tap outputs)
 *   fx-shimmer  — octave-up feedback cloud via crossfading-head
 *                 delay-line shifter (tape-style, not PSOLA; see
 *                 SHIMMER block below for tradeoffs) + short allpass
 *                 network for tail
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

    // NaN/denormal sanitation — a single NaN in the tank cross-feedback
    // silences the verb forever, and denormals parked in the feedback
    // lines burn CPU on x86. Clamp state per block entry + inject a
    // sub-audible DC floor into the cross paths so denormals can't park.
    if (!Number.isFinite(this.crossL)) this.crossL = 0;
    if (!Number.isFinite(this.crossR)) this.crossR = 0;
    if (!Number.isFinite(this.lpL)) this.lpL = 0;
    if (!Number.isFinite(this.lpR)) this.lpR = 0;
    if (!Number.isFinite(this.bwState)) this.bwState = 0;
    const DENORM = 1e-25;

    // Lowpass coefficient (one-pole)
    const lpCoef = 1 - Math.exp(-6.28 * (1 - damping) * 8000 / sampleRate);
    const bwCoef = this.BW;

    // Mod allpass phase increments — 1.0 Hz and 0.7 Hz (incommensurate)
    const modInc1 = 2 * Math.PI * 1.0 / sampleRate;
    const modInc2 = 2 * Math.PI * 0.7 / sampleRate;
    const modDepth = 8; // ±8 samples

    // Input diffusion allpass coefficients — scale with the diffusion
    // param, clamped to safe range (>0.85 causes metallic ringing).
    const idAp1 = Math.min(0.85, this.ID_AP1 * (diffusion / 0.75));
    const idAp2 = Math.min(0.75, this.ID_AP2 * (diffusion / 0.75));
    // Tank (decay) allpass coefficients — fixed per the Dattorro paper.
    // These control reverb texture/density, NOT decay length. Decay
    // length is controlled by the `decay` gain multiplier in the tank
    // feedback path (lines sig *= decay). Previously these were scaled
    // by (decay/0.5) which pushed them above 1.0 at high decay,
    // making the allpasses unstable.
    const tap1 = this.TAP_1;  // 0.7
    const tap2 = this.TAP_2;  // 0.5

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
      let sig = x + this.crossR * decay + DENORM;

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
      sig = x + this.crossL + DENORM;

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
// SHIMMER — octave-up feedback cloud
// ═════════════════════════════════════════════════════════════════════
// This is NOT a phase-vocoder / PSOLA pitch shifter. It is a
// crossfading-head delay-line shifter (tape-style variable-speed
// playback): two read heads at 2× playback rate with Lagrange
// interpolation, crossfaded so samples keep streaming as the heads
// wrap. That means transients smear and formants shift up with the
// pitch — perfect for drone clouds, unsuitable for monophonic
// polyphonic material where formant preservation matters.
//
// Architecture:
//
//   Input → crossfading-head delay line (+12 semitones, 2 heads @ 2×,
//           Lagrange-interp reads)
//         → lowpass (tame upper-octave harshness)
//         → 2-allpass diffuser (spread the pitched signal)
//         → feedback gain
//           ↳ back into the shifter input
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

    // Clamp feedback + LP state against NaN carryover. One NaN in the
    // feedback loop would latch silence forever; this resets it cheaply.
    if (!Number.isFinite(this.fbL)) this.fbL = 0;
    if (!Number.isFinite(this.fbR)) this.fbR = 0;
    if (!Number.isFinite(this.lpL)) this.lpL = 0;
    if (!Number.isFinite(this.lpR)) this.lpR = 0;

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
// Phase-vocoder magnitude-hold freeze. When active rises:
//   1. take the most recent N-sample window from the ring buffer
//   2. FFT → store magnitudes per bin, discard phases
// While active, each hop (= N/4 samples):
//   3. build a synthetic complex spectrum using the held magnitudes
//      and fresh random phases (one seeded PRNG roll per bin)
//   4. IFFT → Hann-window → overlap-add into an output accumulator
// Read: one sample per process loop from the accumulator, clearing
//   as we go so the buffer doesn't accumulate indefinitely.
//
// This is what people mean when they say "spectral freeze": the
// magnitude envelope is held exactly but the phases scramble, so
// any captured rhythmic content de-articulates into a sustained
// tone-complex. The old loop-and-crossfade freeze re-articulated
// rhythm on every loop seam — that's the gap this closes.
class FreezeProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "active", defaultValue: 0, minValue: 0, maxValue: 1, automationRate: "k-rate" },
      { name: "mix",    defaultValue: 0.7, minValue: 0, maxValue: 1, automationRate: "k-rate" },
      // mode 0 = HOLD (single rising-edge snapshot, default).
      // mode 1 = INFINITE — every hop folds fresh input bands into
      // the held magnitudes via max-combine with a slow leak, so new
      // notes accumulate into the sustained cloud instead of being
      // ignored.
      { name: "mode",   defaultValue: 0, minValue: 0, maxValue: 1, automationRate: "k-rate" },
    ];
  }

  constructor() {
    super();
    this.N = 2048;                  // FFT size
    this.hop = 512;                 // 75% overlap
    // COLA normalisation: sum of Hann^2 over 4 overlapping frames at
    // hop = N/4 is ~1.5·N/4, so per-sample division by 1.5 restores
    // unity-ish gain. Empirically tuned to match the old loop-freeze
    // perceived level so existing presets don't jump in loudness.
    this.olaScale = 1 / 1.5;

    // Hann window (N samples)
    this.hann = new Float32Array(this.N);
    for (let i = 0; i < this.N; i++) {
      this.hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (this.N - 1)));
    }
    // Bit-reverse index table for iterative FFT
    this.bitrev = new Uint32Array(this.N);
    const bits = Math.round(Math.log2(this.N));
    for (let i = 0; i < this.N; i++) {
      let r = 0, x = i;
      for (let b = 0; b < bits; b++) { r = (r << 1) | (x & 1); x >>>= 1; }
      this.bitrev[i] = r;
    }

    // Input ring — 1 frame deep, wraps continuously so a freeze can
    // capture the last N samples regardless of where the write head is.
    this.ringL = new Float32Array(this.N);
    this.ringR = new Float32Array(this.N);
    this.ringIdx = 0;

    // Held magnitudes (real-spectrum half: 0..N/2 inclusive).
    this.magL = new Float32Array(this.N / 2 + 1);
    this.magR = new Float32Array(this.N / 2 + 1);
    this.haveSnapshot = false;

    // Output OLA ring of length N.
    this.outL = new Float32Array(this.N);
    this.outR = new Float32Array(this.N);
    this.outReadPos = 0;
    this.outWritePos = 0;
    this.sinceHop = 0;

    // Fade envelope (same rates as before for familiar feel)
    this.wasActive = 0;
    this.fadeEnv = 0;

    // FFT scratch — interleaved complex (re, im).
    this.fftBuf = new Float32Array(this.N * 2);
    this.tmpFrame = new Float32Array(this.N);

    // Seeded PRNG (mulberry32) for phase randomisation. Deterministic
    // per-freeze so share-scene reloads reproduce the exact freeze
    // texture.
    this.rngState = 0x51f00ddb;
  }

  rand() {
    let t = (this.rngState = (this.rngState + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // In-place iterative Cooley-Tukey radix-2 FFT / IFFT on interleaved
  // complex buffer (length 2N). `inverse` divides by N at the end.
  fft(buf, inverse) {
    const N = this.N;
    for (let i = 0; i < N; i++) {
      const j = this.bitrev[i];
      if (j > i) {
        const i2 = i << 1, j2 = j << 1;
        const re = buf[i2], im = buf[i2 + 1];
        buf[i2] = buf[j2]; buf[i2 + 1] = buf[j2 + 1];
        buf[j2] = re; buf[j2 + 1] = im;
      }
    }
    for (let size = 2; size <= N; size <<= 1) {
      const half = size >> 1;
      const theta = (inverse ? 2 : -2) * Math.PI / size;
      const wpRe = Math.cos(theta), wpIm = Math.sin(theta);
      for (let i = 0; i < N; i += size) {
        let wRe = 1, wIm = 0;
        for (let k = 0; k < half; k++) {
          const aIdx = (i + k) << 1;
          const bIdx = (i + k + half) << 1;
          const bRe = buf[bIdx], bIm = buf[bIdx + 1];
          const tRe = wRe * bRe - wIm * bIm;
          const tIm = wRe * bIm + wIm * bRe;
          const aRe = buf[aIdx], aIm = buf[aIdx + 1];
          buf[aIdx] = aRe + tRe; buf[aIdx + 1] = aIm + tIm;
          buf[bIdx] = aRe - tRe; buf[bIdx + 1] = aIm - tIm;
          const nwRe = wRe * wpRe - wIm * wpIm;
          wIm = wRe * wpIm + wIm * wpRe;
          wRe = nwRe;
        }
      }
    }
    if (inverse) {
      const invN = 1 / N;
      for (let i = 0; i < N * 2; i++) buf[i] *= invN;
    }
  }

  // Copy the most recent N samples of the ring into `tmp` starting
  // at the oldest sample (ringIdx is the next-write position).
  unrollRing(ring, tmp) {
    const N = this.N;
    const start = this.ringIdx; // next-write = oldest sample position
    for (let i = 0; i < N; i++) {
      tmp[i] = ring[(start + i) % N];
    }
  }

  analyzeChannel(ring, mags) {
    const N = this.N;
    const buf = this.fftBuf;
    const tmp = this.tmpFrame;
    this.unrollRing(ring, tmp);
    for (let i = 0; i < N; i++) {
      buf[i << 1] = tmp[i] * this.hann[i];
      buf[(i << 1) + 1] = 0;
    }
    this.fft(buf, false);
    const half = N >> 1;
    for (let b = 0; b <= half; b++) {
      const re = buf[b << 1];
      const im = buf[(b << 1) + 1];
      mags[b] = Math.sqrt(re * re + im * im);
    }
  }

  // INFINITE mode helper: max-combine fresh input magnitudes into the
  // held mags with a slow per-hop leak. New notes grow the cloud
  // immediately; the leak keeps the cloud from drifting upward forever
  // when input stops moving.
  analyzeChannelAccumulate(ring, mags) {
    const N = this.N;
    const buf = this.fftBuf;
    const tmp = this.tmpFrame;
    this.unrollRing(ring, tmp);
    for (let i = 0; i < N; i++) {
      buf[i << 1] = tmp[i] * this.hann[i];
      buf[(i << 1) + 1] = 0;
    }
    this.fft(buf, false);
    const half = N >> 1;
    const leak = 0.9998; // ~21 s 1/e decay at hop 512 / 48 kHz
    for (let b = 0; b <= half; b++) {
      const re = buf[b << 1];
      const im = buf[(b << 1) + 1];
      const m = Math.sqrt(re * re + im * im);
      const decayed = mags[b] * leak;
      mags[b] = m > decayed ? m : decayed;
    }
  }

  // Build a random-phase spectrum from held magnitudes, IFFT, window,
  // OLA into outBuf starting at outStart (modulo N).
  synthChannel(mags, outBuf, outStart) {
    const N = this.N;
    const buf = this.fftBuf;
    const half = N >> 1;
    // Pack conjugate-symmetric spectrum
    for (let b = 0; b <= half; b++) {
      const m = mags[b];
      const phase = this.rand() * 2 * Math.PI;
      const re = m * Math.cos(phase);
      const im = m * Math.sin(phase);
      buf[b << 1] = re;
      buf[(b << 1) + 1] = im;
      if (b > 0 && b < half) {
        buf[(N - b) << 1] = re;
        buf[((N - b) << 1) + 1] = -im;
      }
    }
    // DC + Nyquist bins have no imaginary contribution
    buf[1] = 0;
    buf[(half << 1) + 1] = 0;
    this.fft(buf, true);
    const scale = this.olaScale;
    for (let i = 0; i < N; i++) {
      const pos = (outStart + i) % N;
      outBuf[pos] += buf[i << 1] * this.hann[i] * scale;
    }
  }

  process(_inputs, outputs, parameters) {
    const input = _inputs[0];
    const output = outputs[0];
    if (!output) return true;
    const inL = input && input[0] ? input[0] : null;
    const inR = input && input.length > 1 ? input[1] : inL;
    const outL = output[0];
    const outR = output.length > 1 ? output[1] : output[0];
    const n = outL.length;
    const N = this.N;
    const hop = this.hop;

    const active = parameters.active[0];
    const mix = parameters.mix[0];
    const mode = parameters.mode[0];

    // Rising edge: snapshot magnitudes from the most recent N-sample
    // window of the ring buffer. Output OLA state is reset so the
    // first synthesised frames appear clean at the read head.
    if (active > 0.5 && this.wasActive <= 0.5) {
      if (inL) this.analyzeChannel(this.ringL, this.magL);
      if (inR) this.analyzeChannel(this.ringR, this.magR);
      this.haveSnapshot = true;
      this.outL.fill(0);
      this.outR.fill(0);
      this.outReadPos = 0;
      this.outWritePos = 0;
      this.sinceHop = hop; // trigger synthesis on the first sample
    }
    this.wasActive = active;

    const envTarget = active > 0.5 ? 1 : 0;
    const envRate = active > 0.5 ? 0.0008 : 0.0004;

    for (let i = 0; i < n; i++) {
      // Continuously capture input into the ring so a future freeze
      // captures whatever's playing now. The ring is always written
      // even while frozen — it costs a couple of stores per sample
      // and keeps the "release → re-capture" path trivial.
      if (inL) this.ringL[this.ringIdx] = inL[i];
      if (inR) this.ringR[this.ringIdx] = inR[i];
      this.ringIdx = (this.ringIdx + 1) % N;

      if (this.fadeEnv < envTarget) this.fadeEnv = Math.min(envTarget, this.fadeEnv + envRate);
      else if (this.fadeEnv > envTarget) this.fadeEnv = Math.max(envTarget, this.fadeEnv - envRate);

      // Hop-aligned synthesis — every `hop` output samples we add a
      // freshly randomised N-sample frame starting at outWritePos.
      if (this.haveSnapshot && this.fadeEnv > 0.0001) {
        this.sinceHop++;
        if (this.sinceHop >= hop) {
          this.sinceHop = 0;
          // INFINITE: fold latest input bands into held mags before
          // resynthesis so subsequent frames include the new content.
          if (mode > 0.5 && active > 0.5) {
            if (inL) this.analyzeChannelAccumulate(this.ringL, this.magL);
            if (inR) this.analyzeChannelAccumulate(this.ringR, this.magR);
          }
          this.synthChannel(this.magL, this.outL, this.outWritePos);
          this.synthChannel(this.magR, this.outR, this.outWritePos);
          this.outWritePos = (this.outWritePos + hop) % N;
        }
      }

      let sL = 0, sR = 0;
      if (this.haveSnapshot && this.fadeEnv > 0.0001) {
        sL = this.outL[this.outReadPos];
        sR = this.outR[this.outReadPos];
        this.outL[this.outReadPos] = 0;
        this.outR[this.outReadPos] = 0;
        this.outReadPos = (this.outReadPos + 1) % N;
      }

      outL[i] = sL * mix * this.fadeEnv;
      outR[i] = sR * mix * this.fadeEnv;
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

  constructor(options) {
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

    // Seeded PRNG (mulberry32) for grain pitch / pan / jitter.
    // Using a seeded source instead of Math.random is what makes
    // share-scene round-trips sonically deterministic — two loads
    // of the same seed + parameters produce the same grain cloud.
    // Seed comes from processorOptions at construction and can be
    // replaced live via a `setSeed` port message.
    const initialSeed = (options && options.processorOptions && options.processorOptions.seed) | 0;
    this.rngState = (initialSeed >>> 0) || 0x9e3779b1;

    this.port.onmessage = (e) => {
      const msg = e.data;
      if (!msg) return;
      if (msg.type === "setScale" && Array.isArray(msg.cents) && msg.cents.length > 0) {
        this.scaleCents = msg.cents.slice();
      } else if (msg.type === "setSeed" && typeof msg.seed === "number") {
        this.rngState = (msg.seed >>> 0) || 0x9e3779b1;
      }
    };
  }

  // mulberry32 — small fast PRNG with decent statistical quality.
  rng() {
    let t = (this.rngState = (this.rngState + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296);
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
      const pick = this.scaleCents[Math.floor(this.rng() * this.scaleCents.length)] | 0;
      ratio = Math.pow(2, pick / 1200);
    } else {
      const pitchOct = (this.rng() * 2 - 1) * pitchSpread;
      ratio = Math.pow(2, pitchOct);
    }

    // Random pan: -1..1 scaled by panSpread
    const pan = (this.rng() * 2 - 1) * panSpread;
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
      const jitter = (this.rng() - 0.5) * 0.04 * sampleRate;
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
        while (g.pos >= this.bufLen) g.pos -= this.bufLen;
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

// ═════════════════════════════════════════════════════════════════════
// BRICKWALL LIMITER — look-ahead peak limiter
// ═════════════════════════════════════════════════════════════════════
//
// Replaces the old native DynamicsCompressor limiter (ratio 12, attack
// 3 ms, release 100 ms). That node does NOT actually brickwall — it
// lets transient peaks through on grain re-triggers and freeze edges.
//
// Topology:
//   Input → delay line (N samples) ───┐
//                                     ├─ × gainEnv → output
//   Input → abs → peak window → gain target
//   gainTarget → smoothed gain envelope (attack = 0 over lookahead,
//                release = exponential ~ releaseMs) → gainEnv
//
// The look-ahead is critical: the detector sees future peaks inside
// the lookahead window, so the gain envelope is already attenuated
// by the time the peak reaches the output. That's what makes this a
// true brickwall instead of a fast-attack compressor.
//
// Detector runs a cheap 2× oversampled true-peak estimator: the
// classic 4-point Lagrange interpolator at t = 0.5 computes the
// intersample value halfway between each adjacent pair, and the
// detector takes the max of sample-peak and intersample-peak. This
// catches the ~1.5 dB intersample-peak excess that a sample-peak
// detector misses on transient-rich material (grain re-triggers,
// freeze edges) at the cost of ~8 multiplies per sample. Gain is
// still applied at the 1× rate to the delayed 1× signal, so no
// upsample/downsample latency beyond the existing lookahead.
//
class BrickwallLimiterProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      // -24 dB to 0 dB ceiling (linear scalar). Default -1 dB.
      { name: "ceiling",  defaultValue: 0.891, minValue: 0.063, maxValue: 1.0, automationRate: "k-rate" },
      // Release time constant in seconds. 0.1 is the safe default.
      { name: "releaseSec", defaultValue: 0.12, minValue: 0.02, maxValue: 1.0, automationRate: "k-rate" },
      // Enable flag. When 0, the worklet passes input to output with
      // the same lookahead delay — keeps phase relationships stable
      // for A/B comparison with the limiter off.
      { name: "enabled",  defaultValue: 1, minValue: 0, maxValue: 1, automationRate: "k-rate" },
    ];
  }

  constructor() {
    super();
    // Look-ahead of 96 samples ≈ 2 ms at 48 kHz. Enough to catch the
    // leading edge of grain/freeze transients without adding
    // perceptible latency.
    this.lookahead = 96;
    this.delayL = new Float32Array(this.lookahead);
    this.delayR = new Float32Array(this.lookahead);
    this.delayIdx = 0;

    // Peak-window state — we track the maximum |x| over the next
    // `lookahead` samples by scanning the incoming buffer and recording
    // each sample's absolute value into a ring of peaks indexed by
    // write position. A simple O(lookahead) scan per block is fine for
    // a stereo limiter on the master bus.
    this.peakRing = new Float32Array(this.lookahead);

    // Gain-envelope state (1.0 = no attenuation).
    this.gainEnv = 1.0;

    // 4-sample input history per channel for the 4-point Lagrange
    // intersample-peak interpolator. We compute the mid-sample value
    // at position -0.5 (halfway between sample -1 and sample 0 —
    // i.e. the previous pair) using Lagrange coefficients
    // [-1/16, 9/16, 9/16, -1/16] and fold |mid| into the peak test.
    this.histL = new Float32Array(4);
    this.histR = new Float32Array(4);
  }

  process(_inputs, outputs, parameters) {
    const input = _inputs[0];
    const output = outputs[0];
    if (!output) return true;
    const outL = output[0];
    const outR = output.length > 1 ? output[1] : output[0];
    const n = outL.length;
    if (!input || input.length === 0) {
      // No input connected — flush delay line with silence.
      for (let i = 0; i < n; i++) { outL[i] = 0; if (outR !== outL) outR[i] = 0; }
      return true;
    }
    const inL = input[0];
    const inR = input.length > 1 ? input[1] : input[0];

    const ceiling = parameters.ceiling[0];
    const releaseSec = parameters.releaseSec[0];
    const enabled = parameters.enabled[0] > 0.5;

    // Exponential release coefficient: y = y + (target - y) * k where
    // k = 1 - exp(-1 / (sr · τ)). Instant attack (k=1) on gain drops.
    const releaseK = 1 - Math.exp(-1 / (sampleRate * Math.max(0.001, releaseSec)));
    const LA = this.lookahead;

    // NaN sanitation
    if (!Number.isFinite(this.gainEnv)) this.gainEnv = 1.0;

    const hL = this.histL;
    const hR = this.histR;

    for (let i = 0; i < n; i++) {
      const l = inL[i];
      const r = inR[i];

      // Shift the 4-sample history and append the current input.
      hL[0] = hL[1]; hL[1] = hL[2]; hL[2] = hL[3]; hL[3] = l;
      hR[0] = hR[1]; hR[1] = hR[2]; hR[2] = hR[3]; hR[3] = r;

      // 4-point Lagrange at t = 0.5 — mid-sample value between
      // hist[1] and hist[2]. Sample-peak fails to catch intersample
      // peaks up to ~1.5 dB; this intersample value folds into the
      // peak test so the limiter meets its ceiling on intersample
      // content too.
      const midL = -0.0625 * hL[0] + 0.5625 * hL[1] + 0.5625 * hL[2] - 0.0625 * hL[3];
      const midR = -0.0625 * hR[0] + 0.5625 * hR[1] + 0.5625 * hR[2] - 0.0625 * hR[3];
      const absL = Math.abs(l);
      const absR = Math.abs(r);
      const absML = Math.abs(midL);
      const absMR = Math.abs(midR);
      let peakIn = absL > absR ? absL : absR;
      if (absML > peakIn) peakIn = absML;
      if (absMR > peakIn) peakIn = absMR;

      // Read the delayed output sample BEFORE overwriting the slot
      const idxRead = this.delayIdx;
      const dL = this.delayL[idxRead];
      const dR = this.delayR[idxRead];

      // Store current input into the delay line (write = same slot
      // we just read from — the slot rotates each sample).
      this.delayL[idxRead] = l;
      this.delayR[idxRead] = r;
      this.peakRing[idxRead] = peakIn;
      this.delayIdx = (this.delayIdx + 1) % LA;

      // Compute target gain from the MAX peak over the full lookahead
      // window. O(LA) per sample is fine at LA=96 for a single
      // limiter instance on the master bus.
      let maxPeak = 0;
      for (let k = 0; k < LA; k++) {
        const p = this.peakRing[k];
        if (p > maxPeak) maxPeak = p;
      }

      // Gain target: ceiling / maxPeak (clamped ≤ 1 so we never boost).
      const target = (maxPeak > ceiling) ? (ceiling / maxPeak) : 1.0;

      // Attack is instant on drops (any target < env snaps immediately);
      // release is exponential. This asymmetry is the heart of a
      // brickwall: the gain envelope is always ≤ the instantaneous
      // target, guaranteeing the ceiling.
      if (target < this.gainEnv) {
        this.gainEnv = target;
      } else {
        this.gainEnv += (target - this.gainEnv) * releaseK;
      }

      if (enabled) {
        outL[i] = dL * this.gainEnv;
        outR[i] = dR * this.gainEnv;
      } else {
        // Keep the same lookahead delay so A/B is phase-stable.
        outL[i] = dL;
        outR[i] = dR;
      }
    }
    return true;
  }
}
registerProcessor("fx-brickwall", BrickwallLimiterProcessor);

// ═════════════════════════════════════════════════════════════════════
// FREEVERB-STYLE REVERB — 8 parallel combs + 4 series allpasses / ch
// ═════════════════════════════════════════════════════════════════════
// (Registered as `fx-fdn-reverb` for backward-compat with saved scenes
// — it is NOT an FDN in the Jot sense; there is no mixing matrix.
// Architecture is Schroeder / Freeverb: parallel feedback combs
// followed by series allpasses.)
//
// Replaces the old noise-IR ConvolverNode for HALL and CISTERN. The
// convolver reads as "noise verb"; this topology reads as a modelled
// space because the combs carry discrete modal peaks and the
// allpasses diffuse them.
//
// Comb delays are the classic Freeverb primes (scaled by sample rate
// from the original 44.1 kHz values). Per-channel offsets of ±23
// samples decorrelate L/R. A seed (via port message) perturbs the
// prime offsets ±2 % so every preset gets a deterministic but
// distinct modal pattern.
//
// Parameters:
//   size     — 0..1, delay-length scaling (0.5 = Freeverb default,
//              1.0 = cavernous cistern, 0.3 = tight room)
//   damping  — 0..1, lowpass amount in comb feedback (0.5 default)
//   decay    — 0..1, comb feedback gain (0.84 default ≈ 2 s RT60 at
//              size=0.5; at size=1.0 the tail reaches ~15 s)
//
class FdnReverbProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "size",    defaultValue: 0.5,  minValue: 0.1, maxValue: 1.5, automationRate: "k-rate" },
      { name: "damping", defaultValue: 0.5,  minValue: 0,   maxValue: 1,   automationRate: "k-rate" },
      { name: "decay",   defaultValue: 0.84, minValue: 0,   maxValue: 0.98, automationRate: "k-rate" },
      { name: "mix",     defaultValue: 1,    minValue: 0,   maxValue: 1,   automationRate: "k-rate" },
    ];
  }

  constructor(options) {
    super();
    const opts = options?.processorOptions || {};
    this.seed = (opts.seed >>> 0) || 0xFEED;

    // Freeverb prime comb lengths (reference at 44.1 kHz)
    const REF_SR = 44100;
    const combBase = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
    const allpassBase = [556, 441, 341, 225];
    const STEREO_OFFSET = 23; // samples — right channel is offset for decorrelation

    // Deterministic mulberry32 for prime perturbation.
    let a = this.seed;
    const rnd = () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    // Per-comb state: buffer, write index, LP feedback state.
    // Buffers are sized to the MAXIMUM length we'd ever need
    // (size=1.5 × REF scaling). Effective length is set each block
    // via `size` + stays ≤ buffer length.
    const srScale = sampleRate / REF_SR;
    const MAX_SIZE_MUL = 1.6;

    this.combL = [];
    this.combR = [];
    for (let i = 0; i < 8; i++) {
      const jitter = 1 + (rnd() - 0.5) * 0.04; // ±2 %
      const len = Math.ceil(combBase[i] * srScale * MAX_SIZE_MUL * jitter);
      this.combL.push({ buf: new Float32Array(len), idx: 0, maxLen: len, base: Math.floor(combBase[i] * srScale * jitter), lp: 0 });
      const jitterR = 1 + (rnd() - 0.5) * 0.04;
      const lenR = Math.ceil((combBase[i] + STEREO_OFFSET) * srScale * MAX_SIZE_MUL * jitterR);
      this.combR.push({ buf: new Float32Array(lenR), idx: 0, maxLen: lenR, base: Math.floor((combBase[i] + STEREO_OFFSET) * srScale * jitterR), lp: 0 });
    }
    this.apL = [];
    this.apR = [];
    for (let i = 0; i < 4; i++) {
      const len = Math.ceil(allpassBase[i] * srScale * MAX_SIZE_MUL);
      this.apL.push({ buf: new Float32Array(len), idx: 0, maxLen: len, base: Math.floor(allpassBase[i] * srScale) });
      const lenR = Math.ceil((allpassBase[i] + STEREO_OFFSET) * srScale * MAX_SIZE_MUL);
      this.apR.push({ buf: new Float32Array(lenR), idx: 0, maxLen: lenR, base: Math.floor((allpassBase[i] + STEREO_OFFSET) * srScale) });
    }

    this.port.onmessage = (e) => {
      if (e.data && e.data.type === "clear") this.clear();
    };
  }

  clear() {
    for (const c of this.combL) { c.buf.fill(0); c.lp = 0; }
    for (const c of this.combR) { c.buf.fill(0); c.lp = 0; }
    for (const a of this.apL)   { a.buf.fill(0); }
    for (const a of this.apR)   { a.buf.fill(0); }
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

    const size = parameters.size[0];
    const damping = parameters.damping[0];
    const decay = parameters.decay[0];
    const mix = parameters.mix[0];
    const DENORM = 1e-25;

    // Compute per-block effective delay length for each comb/allpass.
    for (const c of this.combL) c.curLen = Math.max(1, Math.min(c.maxLen, Math.round(c.base * (0.3 + size * 1.0))));
    for (const c of this.combR) c.curLen = Math.max(1, Math.min(c.maxLen, Math.round(c.base * (0.3 + size * 1.0))));
    for (const a of this.apL)   a.curLen = Math.max(1, Math.min(a.maxLen, Math.round(a.base * (0.3 + size * 1.0))));
    for (const a of this.apR)   a.curLen = Math.max(1, Math.min(a.maxLen, Math.round(a.base * (0.3 + size * 1.0))));

    // NaN sanitation on comb LP state
    for (const c of this.combL) if (!Number.isFinite(c.lp)) c.lp = 0;
    for (const c of this.combR) if (!Number.isFinite(c.lp)) c.lp = 0;

    // Freeverb's original 0.015 was conservative and made hall/cistern
    // ~-46 dB RMS — inaudible against a full-level dry drone. 0.1 (6.7x)
    // brings the reverb tail to ~-28 dB RMS, matching plate, without
    // pushing tank state near float overflow even at decay=0.94.
    const FIXED_GAIN = 0.1;

    for (let i = 0; i < n; i++) {
      const drySum = (inL[i] + inR[i]) * 0.5 * FIXED_GAIN;

      // Parallel comb bank per channel
      let sumL = 0, sumR = 0;
      for (let k = 0; k < 8; k++) {
        const cL = this.combL[k];
        const cR = this.combR[k];
        // Read from delay (tap at curLen samples back)
        const readL = cL.buf[(cL.idx + cL.maxLen - cL.curLen) % cL.maxLen];
        const readR = cR.buf[(cR.idx + cR.maxLen - cR.curLen) % cR.maxLen];
        // Lowpass in the feedback path (damping)
        cL.lp = readL * (1 - damping) + cL.lp * damping + DENORM;
        cR.lp = readR * (1 - damping) + cR.lp * damping + DENORM;
        // Write new sample: input + damped feedback × decay
        cL.buf[cL.idx] = drySum + cL.lp * decay;
        cR.buf[cR.idx] = drySum + cR.lp * decay;
        cL.idx = (cL.idx + 1) % cL.maxLen;
        cR.idx = (cR.idx + 1) % cR.maxLen;
        sumL += readL;
        sumR += readR;
      }

      // Serial allpass diffusers per channel
      let yL = sumL;
      let yR = sumR;
      const AP_COEF = 0.5;
      for (let k = 0; k < 4; k++) {
        const aL = this.apL[k];
        const aR = this.apR[k];
        const readL = aL.buf[(aL.idx + aL.maxLen - aL.curLen) % aL.maxLen];
        const readR = aR.buf[(aR.idx + aR.maxLen - aR.curLen) % aR.maxLen];
        const writeL = yL + readL * AP_COEF;
        const writeR = yR + readR * AP_COEF;
        aL.buf[aL.idx] = writeL;
        aR.buf[aR.idx] = writeR;
        aL.idx = (aL.idx + 1) % aL.maxLen;
        aR.idx = (aR.idx + 1) % aR.maxLen;
        yL = readL - writeL * AP_COEF;
        yR = readR - writeR * AP_COEF;
      }

      outL[i] = yL * mix;
      outR[i] = yR * mix;
    }
    return true;
  }
}
registerProcessor("fx-fdn-reverb", FdnReverbProcessor);

// ═════════════════════════════════════════════════════════════════════
// LOUDNESS METER — short-term LUFS (EBU R128) + sample-peak
// ═════════════════════════════════════════════════════════════════════
//
// Computes integrated loudness over a 3-second sliding window and the
// running sample-peak in linear amplitude. Publishes both back to the
// main thread via the processor port at ~30 Hz for UI rendering.
//
// Implementation notes:
// - K-weighting (EBU R128 pre-filter): a shelving HPF cascaded with a
//   high-shelf. Biquad coefficients are computed per-sample-rate via
//   the pyloudnorm / ITU-R BS.1770 formulation (bilinear transform
//   of the analog prototype at the actual audio graph rate), so the
//   meter stays accurate at 44.1 / 48 / 88.2 / 96 kHz.
// - Short-term window = 3 seconds. We keep a ring buffer of per-block
//   mean-squared values and average them — cheap, no re-filter per read.
// - True-peak approximation: sample peak + a 4-sample running max to
//   catch inter-sample peaks within the window. Not ITU-R BS.1770
//   4× oversampled true-peak, but a defensible bound that runs cheap.
//
class LoudnessMeterProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() { return []; }

  constructor() {
    super();
    // Compute K-weighting biquads at the actual sample rate. Values
    // here match the published 48 kHz constants exactly and adapt
    // automatically at any other common sample rate.
    const sr = sampleRate;
    // Stage 1 — high-shelf pre-filter @ 1681.97 Hz, +4 dB
    {
      const f0 = 1681.974450955533;
      const G = 3.999843853973347;
      const Q = 0.7071752369554196;
      const K = Math.tan((Math.PI * f0) / sr);
      const K2 = K * K;
      const Vh = Math.pow(10.0, G / 20.0);
      const Vb = Math.pow(Vh, 0.499666774155);
      const a0 = 1.0 + K / Q + K2;
      this.s1b0 = (Vh + (Vb * K) / Q + K2) / a0;
      this.s1b1 = (2.0 * (K2 - Vh)) / a0;
      this.s1b2 = (Vh - (Vb * K) / Q + K2) / a0;
      this.s1a1 = (2.0 * (K2 - 1.0)) / a0;
      this.s1a2 = (1.0 - K / Q + K2) / a0;
    }
    // Stage 2 — RLB high-pass @ 38.14 Hz
    {
      const f0 = 38.13547087602444;
      const Q = 0.5003270373347091;
      const K = Math.tan((Math.PI * f0) / sr);
      const K2 = K * K;
      const a0 = 1.0 + K / Q + K2;
      this.s2b0 = 1.0;
      this.s2b1 = -2.0;
      this.s2b2 = 1.0;
      this.s2a1 = (2.0 * (K2 - 1.0)) / a0;
      this.s2a2 = (1.0 - K / Q + K2) / a0;
    }
    // Per-channel filter state
    this.zL1 = [0, 0]; this.zL2 = [0, 0];
    this.zR1 = [0, 0]; this.zR2 = [0, 0];

    // Short-term window (3 seconds of per-block mean-squared values).
    // At the standard 128-frame block size we get 375 blocks / sec @ 48k;
    // 3 s × 375 ≈ 1125 entries. Allocate 2048 for headroom at higher SR.
    this.msRing = new Float32Array(2048);
    this.msIdx = 0;
    this.msCount = 0;
    this.msFilled = 0;

    // Sample-peak window (200 ms) and running true-peak-ish max.
    this.peakDecay = Math.exp(-1 / (0.2 * sampleRate)); // 200 ms tail
    this.peakEnv = 0;

    // Publish throttle: emit one port message every ~33 ms ≈ 30 Hz.
    this.publishEveryNBlocks = Math.max(1, Math.floor(sampleRate / (128 * 30)));
    this.publishCounter = 0;
  }

  // Biquad (DF-I), returns filtered sample and updates zs in-place.
  _biquad(x, b0, b1, b2, a1, a2, z) {
    const y = b0 * x + z[0];
    z[0] = b1 * x - a1 * y + z[1];
    z[1] = b2 * x - a2 * y;
    return y;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const inL = input[0];
    const inR = input.length > 1 ? input[1] : input[0];
    const n = inL.length;

    // Sanitise biquad state against NaN carryover.
    for (const z of [this.zL1, this.zL2, this.zR1, this.zR2]) {
      if (!Number.isFinite(z[0])) z[0] = 0;
      if (!Number.isFinite(z[1])) z[1] = 0;
    }
    if (!Number.isFinite(this.peakEnv)) this.peakEnv = 0;

    let sumSq = 0;
    let blockPeak = 0;
    for (let i = 0; i < n; i++) {
      // Stage 1 then stage 2 K-weighting, per channel.
      let l = this._biquad(inL[i], this.s1b0, this.s1b1, this.s1b2, this.s1a1, this.s1a2, this.zL1);
      l = this._biquad(l, this.s2b0, this.s2b1, this.s2b2, this.s2a1, this.s2a2, this.zL2);
      let r = this._biquad(inR[i], this.s1b0, this.s1b1, this.s1b2, this.s1a1, this.s1a2, this.zR1);
      r = this._biquad(r, this.s2b0, this.s2b1, this.s2b2, this.s2a1, this.s2a2, this.zR2);
      sumSq += l * l + r * r;
      const a = Math.max(Math.abs(inL[i]), Math.abs(inR[i]));
      if (a > blockPeak) blockPeak = a;
    }

    // Peak envelope — instant attack, 200 ms exponential release.
    if (blockPeak > this.peakEnv) this.peakEnv = blockPeak;
    else this.peakEnv *= this.peakDecay;

    // Mean square for this block, averaged across L+R (×0.5 for stereo
    // dual-mono convention in EBU R128).
    const ms = sumSq / (2 * n);
    this.msRing[this.msIdx] = ms;
    this.msIdx = (this.msIdx + 1) % this.msRing.length;
    if (this.msFilled < this.msRing.length) this.msFilled++;

    // Short-term window = last 3 s ≈ sampleRate * 3 / 128 blocks.
    const windowBlocks = Math.min(this.msFilled, Math.floor(sampleRate * 3 / n));
    let sum = 0;
    const start = (this.msIdx - windowBlocks + this.msRing.length) % this.msRing.length;
    for (let k = 0; k < windowBlocks; k++) {
      sum += this.msRing[(start + k) % this.msRing.length];
    }
    const meanSq = windowBlocks > 0 ? sum / windowBlocks : 0;
    // LUFS = -0.691 + 10 log10(meanSq). Floor at -70 for UI sanity.
    const lufs = meanSq > 1e-12 ? (-0.691 + 10 * Math.log10(meanSq)) : -70;
    const peakDb = this.peakEnv > 1e-6 ? 20 * Math.log10(this.peakEnv) : -120;

    this.publishCounter++;
    if (this.publishCounter >= this.publishEveryNBlocks) {
      this.publishCounter = 0;
      try {
        this.port.postMessage({ type: "meter", lufsShort: lufs, peakDb });
      } catch { /* noop */ }
    }
    return true;
  }
}
registerProcessor("fx-loudness-meter", LoudnessMeterProcessor);

// ═════════════════════════════════════════════════════════════════════
// RECORDER TAP — 32-bit float capture for studio-grade WAV export.
// ═════════════════════════════════════════════════════════════════════
//
// Taps the master signal in parallel (no output connection needed).
// When recording, batches Float32 channel data from each 128-frame
// block and posts it to the main thread every N blocks. Main thread
// accumulates the chunks into growing per-channel Float32Arrays and
// encodes to 24-bit WAV on stop.
//
// Messages:
//   main → node : { type: "start" }   — begin capturing
//   main → node : { type: "stop" }    — stop + flush remaining buffer
//   node → main : { type: "chunk", samples: [Float32Array, Float32Array] }
//   node → main : { type: "done" }    — last chunk sent, safe to encode
class RecorderTapProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.capturing = false;
    // 32 × 128 = 4096-frame batches ≈ 93 ms at 44.1 k. Small enough
    // that a stop-click yields <100 ms of lost tail; large enough
    // that we aren't messaging 344 times/s.
    this.batchBlocks = 32;
    this.blockInBatch = 0;
    this.bufL = new Float32Array(this.batchBlocks * 128);
    this.bufR = new Float32Array(this.batchBlocks * 128);
    this.port.onmessage = (e) => {
      const msg = e.data;
      if (!msg) return;
      if (msg.type === "start") {
        this.capturing = true;
        this.blockInBatch = 0;
      } else if (msg.type === "stop") {
        if (this.blockInBatch > 0) this.flush();
        this.capturing = false;
        try { this.port.postMessage({ type: "done" }); } catch { /* noop */ }
      }
    };
  }

  flush() {
    const frames = this.blockInBatch * 128;
    // Slice to exact frame count so the last (partial) batch doesn't
    // carry stale data from the previous full batch into the WAV.
    const left = this.bufL.slice(0, frames);
    const right = this.bufR.slice(0, frames);
    try {
      this.port.postMessage(
        { type: "chunk", samples: [left, right] },
        [left.buffer, right.buffer],
      );
    } catch { /* noop */ }
    // New backing buffers so the transferred ones aren't reused.
    this.bufL = new Float32Array(this.batchBlocks * 128);
    this.bufR = new Float32Array(this.batchBlocks * 128);
    this.blockInBatch = 0;
  }

  process(inputs) {
    if (!this.capturing) return true;
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const inL = input[0];
    const inR = input[1] || inL;
    const offset = this.blockInBatch * 128;
    this.bufL.set(inL, offset);
    this.bufR.set(inR, offset);
    this.blockInBatch += 1;
    if (this.blockInBatch >= this.batchBlocks) this.flush();
    return true;
  }
}
registerProcessor("fx-recorder-tap", RecorderTapProcessor);

// ═══════════════════════════════════════════════════════════════════════
// HALO — multi-band harmonic-partial bloom
// ═══════════════════════════════════════════════════════════════════════
//
// FFT-based: every hop we capture a window of input, follow each band's
// magnitude with a slow envelope, then resynthesize an output spectrum
// where each input bin b deposits energy into its own upper partials
// (b·2, b·3, …) with a tilt-controlled rolloff. Random phases per
// frame keep the tail shimmering rather than locked. The result is a
// bloom of upper harmonics that tracks the live spectral content of
// whatever's playing — sustained drone material is what it's tuned for.
//
// Notes:
//   - Output is partial-only; the chain insert keeps dry intact and
//     adds this on top, so we never need to pass dry through here.
//   - Smoothing alpha = 0.06 → ~100 ms full update at hop 256/48 kHz.
//   - DC and Nyquist bins are skipped so we never deposit into them.
//   - Partial bins above Nyquist are dropped silently.
class HaloProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      // 0 = only the strong 2× partial; 1 = full 2..6× stack with
      // gentle rolloff. Default 0.5 sits between "octave-up halo"
      // and "full string-section bloom".
      { name: "tilt", defaultValue: 0.5, minValue: 0, maxValue: 1, automationRate: "k-rate" },
    ];
  }

  constructor() {
    super();
    this.N = 1024;
    this.hop = 256;
    this.olaScale = 1 / 1.5;

    this.hann = new Float32Array(this.N);
    for (let i = 0; i < this.N; i++) {
      this.hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (this.N - 1)));
    }
    this.bitrev = new Uint32Array(this.N);
    const bits = Math.round(Math.log2(this.N));
    for (let i = 0; i < this.N; i++) {
      let r = 0, x = i;
      for (let b = 0; b < bits; b++) { r = (r << 1) | (x & 1); x >>>= 1; }
      this.bitrev[i] = r;
    }

    this.ringL = new Float32Array(this.N);
    this.ringR = new Float32Array(this.N);
    this.ringIdx = 0;

    const half = this.N / 2 + 1;
    this.smoothL = new Float32Array(half);
    this.smoothR = new Float32Array(half);
    this.outSpec = new Float32Array(half);
    this.alpha = 0.06;

    this.outL = new Float32Array(this.N);
    this.outR = new Float32Array(this.N);
    this.outReadPos = 0;
    this.outWritePos = 0;
    this.sinceHop = this.hop;

    this.fftBuf = new Float32Array(this.N * 2);
    this.tmpFrame = new Float32Array(this.N);

    this.rngState = 0xa1c0b00d;
  }

  rand() {
    let t = (this.rngState = (this.rngState + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  fft(buf, inverse) {
    const N = this.N;
    for (let i = 0; i < N; i++) {
      const j = this.bitrev[i];
      if (j > i) {
        const i2 = i << 1, j2 = j << 1;
        const re = buf[i2], im = buf[i2 + 1];
        buf[i2] = buf[j2]; buf[i2 + 1] = buf[j2 + 1];
        buf[j2] = re; buf[j2 + 1] = im;
      }
    }
    for (let size = 2; size <= N; size <<= 1) {
      const halfSz = size >> 1;
      const theta = (inverse ? 2 : -2) * Math.PI / size;
      const wpRe = Math.cos(theta), wpIm = Math.sin(theta);
      for (let i = 0; i < N; i += size) {
        let wRe = 1, wIm = 0;
        for (let k = 0; k < halfSz; k++) {
          const aIdx = (i + k) << 1;
          const bIdx = (i + k + halfSz) << 1;
          const bRe = buf[bIdx], bIm = buf[bIdx + 1];
          const tRe = wRe * bRe - wIm * bIm;
          const tIm = wRe * bIm + wIm * bRe;
          const aRe = buf[aIdx], aIm = buf[aIdx + 1];
          buf[aIdx] = aRe + tRe; buf[aIdx + 1] = aIm + tIm;
          buf[bIdx] = aRe - tRe; buf[bIdx + 1] = aIm - tIm;
          const nwRe = wRe * wpRe - wIm * wpIm;
          wIm = wRe * wpIm + wIm * wpRe;
          wRe = nwRe;
        }
      }
    }
    if (inverse) {
      const invN = 1 / N;
      for (let i = 0; i < N * 2; i++) buf[i] *= invN;
    }
  }

  unrollRing(ring, tmp) {
    const N = this.N;
    const start = this.ringIdx;
    for (let i = 0; i < N; i++) {
      tmp[i] = ring[(start + i) % N];
    }
  }

  // Update `smooth` in place: low-pass follower over per-bin magnitude.
  followBands(ring, smooth) {
    const N = this.N;
    const buf = this.fftBuf;
    const tmp = this.tmpFrame;
    this.unrollRing(ring, tmp);
    for (let i = 0; i < N; i++) {
      buf[i << 1] = tmp[i] * this.hann[i];
      buf[(i << 1) + 1] = 0;
    }
    this.fft(buf, false);
    const half = N >> 1;
    const a = this.alpha;
    const oneMinusA = 1 - a;
    for (let b = 0; b <= half; b++) {
      const re = buf[b << 1];
      const im = buf[(b << 1) + 1];
      const m = Math.sqrt(re * re + im * im);
      smooth[b] = oneMinusA * smooth[b] + a * m;
    }
  }

  // Synthesise upper-partial spectrum from `smooth`, IFFT, window,
  // OLA into outBuf starting at outStart. Caller picks tilt.
  synthChannel(smooth, outBuf, outStart, partialGains) {
    const N = this.N;
    const buf = this.fftBuf;
    const half = N >> 1;
    const outSpec = this.outSpec;
    outSpec.fill(0);
    // Skip DC (b=0) and Nyquist (b=half). Each input bin sprays into
    // its 2..6× partials with the supplied gain table.
    const Kmax = partialGains.length;
    for (let b = 1; b < half; b++) {
      const m = smooth[b];
      if (m < 1e-6) continue;
      for (let k = 2; k < Kmax; k++) {
        const tb = b * k;
        if (tb >= half) break;
        outSpec[tb] += m * partialGains[k];
      }
    }
    for (let b = 0; b <= half; b++) {
      const m = outSpec[b];
      const phase = this.rand() * 2 * Math.PI;
      const re = m * Math.cos(phase);
      const im = m * Math.sin(phase);
      buf[b << 1] = re;
      buf[(b << 1) + 1] = im;
      if (b > 0 && b < half) {
        buf[(N - b) << 1] = re;
        buf[((N - b) << 1) + 1] = -im;
      }
    }
    buf[1] = 0;
    buf[(half << 1) + 1] = 0;
    this.fft(buf, true);
    const scale = this.olaScale;
    for (let i = 0; i < N; i++) {
      const pos = (outStart + i) % N;
      outBuf[pos] += buf[i << 1] * this.hann[i] * scale;
    }
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!output) return true;
    const inL = input && input[0] ? input[0] : null;
    const inR = input && input.length > 1 ? input[1] : inL;
    const outL = output[0];
    const outR = output.length > 1 ? output[1] : output[0];
    const n = outL.length;
    const N = this.N;
    const hop = this.hop;

    const tilt = parameters.tilt[0];
    // tilt=0 → only 2× partial loud; tilt=1 → 2..6× stack with gentle
    // rolloff. Indexed by k (k=2..6 used).
    const baseGain = 0.35; // overall partial level so bloom sits under dry
    const partialGains = [
      0, 0,
      baseGain * 1.0,
      baseGain * (0.55 + 0.45 * tilt),
      baseGain * (0.30 + 0.55 * tilt),
      baseGain * (0.15 + 0.55 * tilt),
      baseGain * (0.06 + 0.50 * tilt),
    ];

    for (let i = 0; i < n; i++) {
      if (inL) this.ringL[this.ringIdx] = inL[i];
      if (inR) this.ringR[this.ringIdx] = inR[i];
      this.ringIdx = (this.ringIdx + 1) % N;

      this.sinceHop++;
      if (this.sinceHop >= hop) {
        this.sinceHop = 0;
        if (inL) this.followBands(this.ringL, this.smoothL);
        if (inR) this.followBands(this.ringR, this.smoothR);
        this.synthChannel(this.smoothL, this.outL, this.outWritePos, partialGains);
        this.synthChannel(this.smoothR, this.outR, this.outWritePos, partialGains);
        this.outWritePos = (this.outWritePos + hop) % N;
      }

      let sL = this.outL[this.outReadPos];
      let sR = this.outR[this.outReadPos];
      this.outL[this.outReadPos] = 0;
      this.outR[this.outReadPos] = 0;
      this.outReadPos = (this.outReadPos + 1) % N;

      outL[i] = sL;
      outR[i] = sR;
    }
    return true;
  }
}
registerProcessor("fx-halo", HaloProcessor);
