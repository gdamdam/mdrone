// Shared rendering / measurement / FX-chain helpers used by both
// `scripts/audit-presets.mjs` (offline scorecard CLI) and
// `tests/dsp-smoke.test.mjs` (fingerprint + 64-voice integration tests).
//
// Kept self-contained: no test-runner / CLI / filesystem dependencies.
// Anything that touches argv / stdout / stdin lives in the calling
// script, not here.

export const SR = 48000;
export const BLK = 128;

export function makeBuffers(nChan, nFrames) {
  const out = [];
  for (let c = 0; c < nChan; c++) out.push(new Float32Array(nFrames));
  return out;
}

export function makeParamArr(value) { return new Float32Array([value]); }

// ─── Measurement primitives ──────────────────────────────────────────

export function biquadFilter(input, b0, b1, b2, a1, a2) {
  const N = input.length;
  const out = new Float32Array(N);
  let z1 = 0, z2 = 0;
  for (let i = 0; i < N; i++) {
    const x = input[i];
    const y = b0 * x + z1;
    z1 = b1 * x - a1 * y + z2;
    z2 = b2 * x - a2 * y;
    out[i] = y;
  }
  return out;
}

// ITU-R BS.1770-4 K-weighting (48 kHz coefficients).
export function kWeight(samples) {
  const s1 = biquadFilter(samples,
    1.53512485958697, -2.69169618940638, 1.19839281085285,
    -1.69065929318241, 0.73248077421585);
  return biquadFilter(s1,
    1.0, -2.0, 1.0,
    -1.99004745483398, 0.99007225036621);
}

// Integrated LUFS (BS.1770-4: 400 ms windows, 75 % overlap, absolute
// gate at -70 LUFS, relative gate at -10 LU below the un-gated mean).
export function integratedLufs(left, right, sr) {
  const kL = kWeight(left);
  const kR = kWeight(right);
  const winSamples = Math.round(sr * 0.4);
  const stride = Math.round(sr * 0.1);
  const N = Math.min(kL.length, kR.length);
  const blocks = [];
  for (let i = 0; i + winSamples <= N; i += stride) {
    let sumL = 0, sumR = 0;
    for (let j = 0; j < winSamples; j++) {
      sumL += kL[i + j] * kL[i + j];
      sumR += kR[i + j] * kR[i + j];
    }
    blocks.push((sumL + sumR) / winSamples);
  }
  if (blocks.length === 0) return null;
  const lufsOf = (z) => z > 0 ? -0.691 + 10 * Math.log10(z) : -Infinity;
  const absGate = blocks.filter((z) => lufsOf(z) > -70);
  if (absGate.length === 0) return null;
  const meanZ = absGate.reduce((s, z) => s + z, 0) / absGate.length;
  const ungatedLufs = lufsOf(meanZ);
  const relGate = absGate.filter((z) => lufsOf(z) > ungatedLufs - 10);
  if (relGate.length === 0) return ungatedLufs;
  const finalZ = relGate.reduce((s, z) => s + z, 0) / relGate.length;
  return lufsOf(finalZ);
}

// Time-domain band energy via 2-pole biquad bandpass / first-order
// edge filters. Returns dB(RMS) per band.
export function bandEnergyDb(samples, sr) {
  const rms = (x) => {
    let s = 0; for (let i = 0; i < x.length; i++) s += x[i] * x[i];
    return Math.sqrt(s / x.length);
  };
  const toDb = (v) => v > 0 ? 20 * Math.log10(v) : -120;
  const onePoleLP = (input, fc) => {
    const a = Math.exp(-2 * Math.PI * fc / sr);
    const out = new Float32Array(input.length);
    let y = 0;
    for (let i = 0; i < input.length; i++) {
      y = a * y + (1 - a) * input[i];
      out[i] = y;
    }
    return out;
  };
  const onePoleHP = (input, fc) => {
    const lp = onePoleLP(input, fc);
    const out = new Float32Array(input.length);
    for (let i = 0; i < input.length; i++) out[i] = input[i] - lp[i];
    return out;
  };
  const bp = (input, fc, q) => {
    const w0 = 2 * Math.PI * fc / sr;
    const alpha = Math.sin(w0) / (2 * q);
    const a0 = 1 + alpha;
    return biquadFilter(input,
      alpha / a0, 0, -alpha / a0,
      -2 * Math.cos(w0) / a0, (1 - alpha) / a0);
  };
  return {
    lowDb:   toDb(rms(onePoleLP(samples, 40))),    // <40 Hz
    mudDb:   toDb(rms(bp(samples, 280, 1.4))),     // 200-400 Hz
    harshDb: toDb(rms(bp(samples, 3500, 1.4))),    // 2-6 kHz
    airDb:   toDb(rms(onePoleHP(samples, 8000))),  // >8 kHz
  };
}

export function basicStats(left, right) {
  let peakL = 0, peakR = 0, sumSqL = 0, sumSqR = 0, sumL = 0, sumR = 0;
  let finite = true;
  const N = left.length;
  for (let i = 0; i < N; i++) {
    const l = left[i], r = right[i];
    if (!Number.isFinite(l) || !Number.isFinite(r)) { finite = false; break; }
    const al = Math.abs(l), ar = Math.abs(r);
    if (al > peakL) peakL = al;
    if (ar > peakR) peakR = ar;
    sumL += l; sumR += r;
    sumSqL += l * l; sumSqR += r * r;
  }
  return {
    finite,
    peak: Math.max(peakL, peakR),
    rms: Math.sqrt((sumSqL + sumSqR) / (2 * N)),
    dcL: sumL / N,
    dcR: sumR / N,
  };
}

export function lrCorrelation(left, right) {
  const N = left.length;
  let mL = 0, mR = 0;
  for (let i = 0; i < N; i++) { mL += left[i]; mR += right[i]; }
  mL /= N; mR /= N;
  let cov = 0, varL = 0, varR = 0;
  for (let i = 0; i < N; i++) {
    const dL = left[i] - mL, dR = right[i] - mR;
    cov += dL * dR; varL += dL * dL; varR += dR * dR;
  }
  if (varL <= 0 || varR <= 0) return 0;
  return cov / Math.sqrt(varL * varR);
}

// ─── FX chain rendering ─────────────────────────────────────────────
// Worklet-based effects only. Inline-coded effects in FxChain.ts
// (tape, wow, sub waveshaper, comb, ringmod, formant, delay, freeze)
// are skipped by callers — the audit-presets CLI surfaces them as
// `skippedFx` per preset.
export const EFFECT_PROC = {
  plate:    "fx-plate",
  shimmer:  "fx-shimmer",
  hall:     "fx-fdn-reverb",
  cistern:  "fx-fdn-reverb",
  granular: "fx-granular",
  graincloud: "fx-granular",
};

export const EFFECT_PARAMS_SERIAL = {
  plate:      { decay: 0.6,  damping: 0.4,  diffusion: 0.75, mix: 0.25 },
  shimmer:    { feedback: 0.55, mix: 0.30, decay: 0.7 },
  hall:       { size: 0.95, damping: 0.45, decay: 0.92, mix: 0.30 },
  cistern:    { size: 1.4,  damping: 0.7,  decay: 0.95, mix: 0.40 },
  granular:   { size: 0.2,  density: 6,  pitchSpread: 0.2, panSpread: 0.6,
                position: 0.4, mix: 0.25, pitchMode: 0, envelope: 0, spawnMode: 0 },
  graincloud: { size: 0.4,  density: 12, pitchSpread: 0.3, panSpread: 0.7,
                position: 0.5, mix: 0.30, pitchMode: 0, envelope: 0, spawnMode: 0 },
};

export function parallelParams(effectId) {
  const base = EFFECT_PARAMS_SERIAL[effectId] ?? {};
  return { ...base, mix: 1.0 };
}

export const SKIPPED_EFFECTS = new Set([
  "tape", "wow", "sub", "comb", "ringmod", "formant", "delay", "freeze",
]);

export function applyFxBlocks(input, procName, paramObj, fxReg) {
  const Cls = fxReg.get(procName);
  if (!Cls) return input;
  const proc = new Cls();
  const params = Object.fromEntries(
    Object.entries(paramObj).map(([k, v]) => [k, makeParamArr(v)]),
  );
  const N = input[0].length;
  const out = makeBuffers(2, N);
  for (let off = 0; off < N; off += BLK) {
    const inBlock = [[input[0].subarray(off, off + BLK), input[1].subarray(off, off + BLK)]];
    const outBlock = [makeBuffers(2, BLK)];
    proc.process(inBlock, outBlock, params);
    out[0].set(outBlock[0][0], off);
    out[1].set(outBlock[0][1], off);
  }
  return out;
}

// Routes voiceSum through preset.effects (serial) → preset.parallelSends
// (parallel reverbs scaled by send level) → master fx-brickwall limiter.
// Returns { out: [L, R], skipped: [effectId, ...] }.
export function applyEffectChain(voiceSum, preset, fxReg) {
  const skipped = [];
  let serial = voiceSum;
  for (const effectId of preset.effects ?? []) {
    if (SKIPPED_EFFECTS.has(effectId)) { skipped.push(effectId); continue; }
    const procName = EFFECT_PROC[effectId];
    if (!procName) { skipped.push(`${effectId}(unknown)`); continue; }
    serial = applyFxBlocks(serial, procName, EFFECT_PARAMS_SERIAL[effectId] ?? {}, fxReg);
  }
  for (const [effectId, sendLevel] of Object.entries(preset.parallelSends ?? {})) {
    if (sendLevel == null || sendLevel <= 0) continue;
    const procName = EFFECT_PROC[effectId];
    if (!procName) { skipped.push(`${effectId}(parallel)`); continue; }
    const N = voiceSum[0].length;
    const scaled = [new Float32Array(N), new Float32Array(N)];
    for (let i = 0; i < N; i++) {
      scaled[0][i] = voiceSum[0][i] * sendLevel;
      scaled[1][i] = voiceSum[1][i] * sendLevel;
    }
    const sendOut = applyFxBlocks(scaled, procName, parallelParams(effectId), fxReg);
    for (let i = 0; i < N; i++) {
      serial[0][i] += sendOut[0][i];
      serial[1][i] += sendOut[1][i];
    }
  }
  const limited = applyFxBlocks(serial, "fx-brickwall",
    { ceiling: 0.891, releaseSec: 0.12, enabled: 1 }, fxReg);
  return { out: limited, skipped };
}
