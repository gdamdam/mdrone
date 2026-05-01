// Offline COMB-on-shruti-box measurement.
// Renders shruti-box reed voice for 8 seconds at F3 (174.6 Hz),
// applies a JS-emulated COMB feedback loop matching FxChain.wireComb,
// ramps comb feedback in at t=2s, and reports peak/RMS in three
// windows (pre-comb, transient, steady-state) for two configurations:
//   OLD  — pre-1.20.16: feedback 0.68, no feedback-path lowpass
//   NEW  — 1.20.16:     feedback 0.55, 3 kHz feedback-path lowpass (Q 0.7)
// The same dcBlock (HP @ 25 Hz), tanh soft-clipper (drive 1.8), and
// outFilter (LP @ 5 kHz) apply to both — just like FxChain.wireComb.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { SR, BLK, makeBuffers, makeParamArr, normalizeVoiceLevels } from "./audit-helpers.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

// ─── Worklet stub (mirrors audit-presets.mjs) ───────────────────────
function loadWorklet(relPath, sampleRate = SR) {
  const src = readFileSync(join(ROOT, relPath), "utf8");
  const registry = new Map();
  class AudioWorkletProcessor {
    constructor() { this.port = { postMessage() {}, onmessage: null }; }
  }
  const registerProcessor = (name, cls) => registry.set(name, cls);
  const factory = new Function(
    "sampleRate", "AudioWorkletProcessor", "registerProcessor", "currentTime",
    src,
  );
  factory(sampleRate, AudioWorkletProcessor, registerProcessor, 0);
  return registry;
}

function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeReed(VoiceProc, seed, opts = {}) {
  const p = new VoiceProc();
  p.voiceType = "reed";
  p.rng = mulberry32(seed);
  p.pink = { b0:0, b1:0, b2:0, b3:0, b4:0, b5:0, b6:0 };
  p.stopped = false;
  p.reedShape = opts.reedShape ?? "balanced";
  p.fmRatioOpt = 2.0;
  p.fmIndexOpt = 2.4;
  p.fmFeedbackOpt = 0;
  p.tanpuraTuningOpt = "classic";
  p.dichoticMulR = 1.0;
  p.initReed();
  return p;
}

function runProcessor(proc, params, blocks, block) {
  const out = makeBuffers(2, blocks * block);
  for (let b = 0; b < blocks; b++) {
    const frame = [makeBuffers(2, block)];
    const src = [[new Float32Array(block), new Float32Array(block)]];
    proc.process(src, frame, params);
    for (let c = 0; c < 2; c++) out[c].set(frame[0][c], b * block);
  }
  return out;
}

// ─── Biquad coefficients (RBJ cookbook) ─────────────────────────────
function biquadCoeffsLP(freq, Q, sr) {
  const w0 = 2 * Math.PI * freq / sr;
  const cosw = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * Q);
  const a0 = 1 + alpha;
  return {
    b0: ((1 - cosw) / 2) / a0,
    b1: (1 - cosw) / a0,
    b2: ((1 - cosw) / 2) / a0,
    a1: (-2 * cosw) / a0,
    a2: (1 - alpha) / a0,
  };
}

function biquadCoeffsHP(freq, Q, sr) {
  const w0 = 2 * Math.PI * freq / sr;
  const cosw = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * Q);
  const a0 = 1 + alpha;
  return {
    b0: ((1 + cosw) / 2) / a0,
    b1: (-(1 + cosw)) / a0,
    b2: ((1 + cosw) / 2) / a0,
    a1: (-2 * cosw) / a0,
    a2: (1 - alpha) / a0,
  };
}

function makeBiquadState() { return { z1: 0, z2: 0 }; }

function biquadStep(s, c, x) {
  const y = c.b0 * x + s.z1;
  s.z1 = c.b1 * x - c.a1 * y + s.z2;
  s.z2 = c.b2 * x - c.a2 * y;
  return y;
}

// ─── COMB emulation ─────────────────────────────────────────────────
// Topology matches FxChain.wireComb:
//   in → combDelay → dcBlock → [fbLP if NEW] → fbClip → fbGain → combDelay (loop)
//   combDelay → outFilter → out
function runComb(input, freq, opts) {
  const { feedback, fbLPHz, sr } = opts;
  const N = input.length;
  const out = new Float32Array(N);
  const delaySamples = sr / freq;
  const bufLen = Math.max(64, Math.ceil(delaySamples) + 8);
  const buf = new Float32Array(bufLen);
  let writeIdx = 0;

  const dcCoeff = biquadCoeffsHP(25, Math.SQRT1_2, sr);
  const dcS = makeBiquadState();
  const fbLPCoeff = fbLPHz != null ? biquadCoeffsLP(fbLPHz, 0.7, sr) : null;
  const fbLPS = fbLPHz != null ? makeBiquadState() : null;
  const outLPCoeff = biquadCoeffsLP(5000, Math.SQRT1_2, sr);
  const outLPS = makeBiquadState();

  // Feedback ramp: 0 until t=2s, then exponential approach to target
  // with TC ~0.05s (matches FxChain.setEffect xfadeTC region).
  const rampStart = 2.0 * sr;
  const tcSamples = 0.05 * sr;
  const alpha = 1 - Math.exp(-1 / tcSamples);
  let fbGain = 0;

  for (let i = 0; i < N; i++) {
    // Update feedback ramp.
    const target = i >= rampStart ? feedback : 0;
    fbGain += alpha * (target - fbGain);

    // Read delayed sample (linear interpolation for fractional delay).
    const readPosF = writeIdx - delaySamples;
    const readPos = ((readPosF % bufLen) + bufLen) % bufLen;
    const i0 = Math.floor(readPos);
    const i1 = (i0 + 1) % bufLen;
    const frac = readPos - i0;
    const delayed = buf[i0] * (1 - frac) + buf[i1] * frac;

    // Output: outFilter LP @ 5 kHz over the delayed signal.
    out[i] = biquadStep(outLPS, outLPCoeff, delayed);

    // Feedback path: dcBlock → (fbLP if NEW) → tanh(1.8x) → fbGain.
    let fb = biquadStep(dcS, dcCoeff, delayed);
    if (fbLPCoeff) fb = biquadStep(fbLPS, fbLPCoeff, fb);
    fb = Math.tanh(1.8 * fb);
    fb = fb * fbGain;

    // Write input + feedback into the delay line.
    buf[writeIdx] = input[i] + fb;
    writeIdx = (writeIdx + 1) % bufLen;
  }

  return out;
}

// ─── Stats over a window ────────────────────────────────────────────
function windowStats(arr, startSec, endSec, sr) {
  const i0 = Math.max(0, Math.floor(startSec * sr));
  const i1 = Math.min(arr.length, Math.floor(endSec * sr));
  let peak = 0, sumSq = 0;
  for (let i = i0; i < i1; i++) {
    const v = arr[i];
    const a = Math.abs(v);
    if (a > peak) peak = a;
    sumSq += v * v;
  }
  const rms = Math.sqrt(sumSq / Math.max(1, i1 - i0));
  return {
    peakDb: 20 * Math.log10(Math.max(1e-10, peak)),
    rmsDb:  20 * Math.log10(Math.max(1e-10, rms)),
    peakLin: peak,
  };
}

// ─── Run ─────────────────────────────────────────────────────────────
async function main() {
  const SECONDS = 8;
  const PITCHES = [
    { label: "octave 2 (110 Hz)", freq: 110 },
    { label: "F3 (174.6 Hz)",     freq: 174.6 },
    { label: "octave 3 (440 Hz)", freq: 440 },
  ];
  console.log(`COMB test — shruti-box reed across pitches, ${SECONDS}s each`);
  console.log("COMB engages at t=2s (fb ramp TC 0.05s).\n");

  for (const { label, freq } of PITCHES) {
    console.log(`══ ${label} ══`);
    await runOne(freq);
    console.log();
  }
}

async function runOne(FREQ) {
  const SECONDS = 8;

  const reg = loadWorklet("src/engine/droneVoiceProcessor.js", SR);
  const VoiceProc = reg.get("drone-voice");
  if (!VoiceProc) { console.error("drone-voice processor missing"); process.exit(1); }

  const blocks = Math.ceil(SECONDS * SR / BLK);
  const N = blocks * BLK;

  // Render reed voice (mono - take L channel since shruti-box is reed-only).
  const params = {
    freq: makeParamArr(FREQ),
    drift: makeParamArr(0.18),
    amp:   makeParamArr(0.6),
    pluckRate: makeParamArr(1),
    color: makeParamArr(0.3),
  };
  const proc = makeReed(VoiceProc, 0xA0DA ^ 0x9E3779B1, { reedShape: "balanced" });
  const reed = runProcessor(proc, params, blocks, BLK);
  const voiceL = reed[0];

  const dryStats = windowStats(voiceL, 4, 8, SR);
  console.log(`DRY voice (no comb), 4-8s steady:`);
  console.log(`  peak ${dryStats.peakDb.toFixed(1)} dB · RMS ${dryStats.rmsDb.toFixed(1)} dB\n`);

  for (const cfg of [
    { name: "OLD (pre-1.20.16)",     feedback: 0.68, fbLPHz: null },
    { name: "1.20.16 (LP + 0.55)",   feedback: 0.55, fbLPHz: 3000 },
    { name: "1.20.17 (LP + 0.35)",   feedback: 0.35, fbLPHz: 3000 },
    { name: "1.20.17 user-cap 0.50", feedback: 0.50, fbLPHz: 3000 },
  ]) {
    const out = runComb(voiceL, FREQ, { ...cfg, sr: SR });
    const pre   = windowStats(out, 0, 2, SR);
    const trans = windowStats(out, 2, 4, SR);
    const steady = windowStats(out, 4, 8, SR);

    console.log(`${cfg.name}  fb=${cfg.feedback} fbLP=${cfg.fbLPHz ? cfg.fbLPHz + " Hz" : "—"}`);
    console.log(`  pre-comb  (0-2s):  peak ${pre.peakDb.toFixed(1)} dB · RMS ${pre.rmsDb.toFixed(1)} dB`);
    console.log(`  transient (2-4s):  peak ${trans.peakDb.toFixed(1)} dB · RMS ${trans.rmsDb.toFixed(1)} dB`);
    console.log(`  steady    (4-8s):  peak ${steady.peakDb.toFixed(1)} dB · RMS ${steady.rmsDb.toFixed(1)} dB`);
    if (steady.peakLin >= 1.0) console.log("  ⚠ STEADY-STATE PEAK CLIPS (≥0 dBFS)");
    console.log();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
