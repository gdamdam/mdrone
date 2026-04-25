// Offline preset audit — renders each preset's voice graph (no FX chain
// yet — see "Limitations" below) and emits LUFS / sample-peak / RMS /
// DC / band-energy / L-R correlation per preset, both as a JSON file
// and as a markdown summary on stdout.
//
// Usage:
//   npm run audit:presets               # canonical 34-preset set
//   npm run audit:presets -- --all      # full preset library
//   npm run audit:presets -- --presets tanpura-drone,sub-chamber
//   npm run audit:presets -- --seconds 30
//
// Output:
//   tmp/preset-audit.json — machine-readable
//   stdout — markdown table for quick scoring
//
// Limitations:
//  - FX chain rendering is partial. Worklet-based effects (plate,
//    shimmer, hall, cistern, granular, graincloud, fx-brickwall master
//    limiter) ARE applied. Effects implemented inline in FxChain.ts
//    using Web Audio native nodes (tape, wow, sub waveshaper, comb,
//    ringmod, formant, delay, freeze) are skipped — those rely on
//    BiquadFilter/WaveShaper/DelayNode which don't exist in Node.
//    Skipped effects are listed per preset in the JSON output.
//  - Effect parameters use baseline-tuned defaults, NOT the preset's
//    macro-driven values. Real engine maps drift / climateX / sub /
//    air macros onto FX params via FxChain.ts; reproducing that
//    mapping in Node is a separate PR. This means a preset relying
//    on macro automation for a specific tone (e.g. shimmer feedback
//    pumped by climateY) will measure with default-tuned shimmer.
//  - Use --no-fx to disable FX rendering (voice-bus only) for an
//    apples-to-apples comparison with the pre-FX-rendering baseline.
//  - Each voice rendered at a fixed root frequency derived from
//    octaveRange (55 Hz × 2^octave), not the preset's resolved tuning.
//    Tonal accuracy is irrelevant for level/peak/DC/band measurements.
//  - True peak (4× oversampled) is approximated by sample peak; the
//    actual inter-sample peak is typically 0.5–1 dB higher.
//  - K-weighting biquad coefficients are 48 kHz-specific; render rate
//    is hardcoded to 48 kHz.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { execSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

// ─── Worklet stub (mirrors tests/dsp-smoke.test.mjs) ────────────────
function loadWorklet(relPath, sampleRate = 48000) {
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

// Deterministic RNG so re-runs produce identical numbers.
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

function makeBuffers(nChan, nFrames) {
  const out = [];
  for (let c = 0; c < nChan; c++) out.push(new Float32Array(nFrames));
  return out;
}

function makeParamArr(value) { return new Float32Array([value]); }

function makeVoice(VoiceProc, voiceType, seed, opts = {}) {
  const p = new VoiceProc();
  p.voiceType = voiceType;
  p.rng = mulberry32(seed);
  p.pink = { b0:0,b1:0,b2:0,b3:0,b4:0,b5:0,b6:0 };
  p.stopped = false;
  p.reedShape = opts.reedShape ?? "odd";
  p.fmRatioOpt = opts.fmRatio ?? 2.0;
  p.fmIndexOpt = opts.fmIndex ?? 2.4;
  p.fmFeedbackOpt = opts.fmFeedback ?? 0;
  p.tanpuraTuningOpt = opts.tanpuraTuning ?? "classic";
  p.dichoticMulR = opts.dichoticMulR ?? 1.0;
  switch (voiceType) {
    case "tanpura": p.initTanpura(); break;
    case "reed":    p.initReed();    break;
    case "metal":   p.initMetal();   break;
    case "air":     p.initAir();     break;
    case "piano":   p.initPiano();   break;
    case "fm":      p.initFm();      break;
    case "amp":     p.initAmp();     break;
    case "noise":   p.initNoise();   break;
  }
  return p;
}

function runProcessor(proc, params, blocks, block) {
  const out = makeBuffers(2, blocks * block);
  for (let b = 0; b < blocks; b++) {
    const frame = [makeBuffers(2, block)];
    const src = [[new Float32Array(block), new Float32Array(block)]];
    proc.process(src, frame, params);
    for (let c = 0; c < 2; c++) {
      out[c].set(frame[0][c], b * block);
    }
  }
  return out;
}

// ─── Measurement primitives ──────────────────────────────────────────

// Generic biquad in transposed direct form II.
function biquadFilter(input, b0, b1, b2, a1, a2) {
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

// ITU-R BS.1770-4 K-weighting: stage 1 high-shelf + stage 2 RLB high-pass.
// Coefficients are 48 kHz; render rate is fixed at 48 kHz.
function kWeight(samples) {
  // Stage 1: pre-filter (high-shelf, +4 dB above 1.7 kHz).
  const s1 = biquadFilter(samples,
    1.53512485958697, -2.69169618940638, 1.19839281085285,
    -1.69065929318241, 0.73248077421585);
  // Stage 2: RLB high-pass (~38 Hz).
  return biquadFilter(s1,
    1.0, -2.0, 1.0,
    -1.99004745483398, 0.99007225036621);
}

// Integrated LUFS per ITU-R BS.1770-4. Uses 400 ms windows with 75%
// overlap (100 ms stride), absolute gate at -70 LUFS, relative gate at
// -10 LU below the un-gated mean.
function integratedLufs(left, right, sr) {
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
    const z = (sumL + sumR) / winSamples;
    blocks.push(z);
  }
  if (blocks.length === 0) return null;
  const lufsOf = (z) => z > 0 ? -0.691 + 10 * Math.log10(z) : -Infinity;
  // Absolute gate: -70 LUFS (z > 10^((-70 + 0.691)/10))
  const absGate = blocks.filter((z) => lufsOf(z) > -70);
  if (absGate.length === 0) return null;
  const meanZ = absGate.reduce((s, z) => s + z, 0) / absGate.length;
  const ungatedLufs = lufsOf(meanZ);
  // Relative gate: -10 LU below ungated.
  const relThreshold = ungatedLufs - 10;
  const relGate = absGate.filter((z) => lufsOf(z) > relThreshold);
  if (relGate.length === 0) return ungatedLufs;
  const finalZ = relGate.reduce((s, z) => s + z, 0) / relGate.length;
  return lufsOf(finalZ);
}

// Time-domain band energy via 2-pole biquad bandpass / first-order
// edge filters. Returns dB(RMS) per band.
function bandEnergyDb(samples, sr) {
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
    const b0 = alpha / a0;
    const b1 = 0;
    const b2 = -alpha / a0;
    const a1 = -2 * Math.cos(w0) / a0;
    const a2 = (1 - alpha) / a0;
    return biquadFilter(input, b0, b1, b2, a1, a2);
  };
  return {
    lowDb:   toDb(rms(onePoleLP(samples, 40))),    // <40 Hz
    mudDb:   toDb(rms(bp(samples, 280, 1.4))),     // 200-400 Hz
    harshDb: toDb(rms(bp(samples, 3500, 1.4))),    // 2-6 kHz
    airDb:   toDb(rms(onePoleHP(samples, 8000))),  // >8 kHz
  };
}

function basicStats(left, right) {
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

function lrCorrelation(left, right) {
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

// ─── Voice rendering for a preset ───────────────────────────────────

function octaveToFreq(octave) {
  // Simple mapping: octave 2 → 110 Hz, doubles per octave step.
  return 55 * Math.pow(2, octave);
}

function presetVoiceFreq(preset) {
  const lo = preset.octaveRange?.[0] ?? 2;
  return octaveToFreq(lo);
}

const SR = 48000;
const BLK = 128;

// ─── FX chain rendering ─────────────────────────────────────────────
// Worklet-based effects only. Effects implemented inline via Web Audio
// native nodes in FxChain.ts (tape/wow/sub/comb/ringmod/formant/delay/
// freeze) are skipped — see file-header limitations.
const EFFECT_PROC = {
  plate:    "fx-plate",
  shimmer:  "fx-shimmer",
  hall:     "fx-fdn-reverb",
  cistern:  "fx-fdn-reverb",
  granular: "fx-granular",
  graincloud: "fx-granular",
};
// Baseline FX params — tuned to be dry-dominant since most preset
// chains keep the voice forward and use reverb for tail/ambience
// rather than 50/50 wet. Hall / cistern share fx-fdn-reverb but
// differ in size and damping.
const EFFECT_PARAMS_SERIAL = {
  plate:      { decay: 0.6,  damping: 0.4,  diffusion: 0.75, mix: 0.25 },
  shimmer:    { feedback: 0.55, mix: 0.30, decay: 0.7 },
  hall:       { size: 0.95, damping: 0.45, decay: 0.92, mix: 0.30 },
  cistern:    { size: 1.4,  damping: 0.7,  decay: 0.95, mix: 0.40 },
  granular:   { size: 0.2,  density: 6,  pitchSpread: 0.2, panSpread: 0.6,
                position: 0.4, mix: 0.25, pitchMode: 0, envelope: 0, spawnMode: 0 },
  graincloud: { size: 0.4,  density: 12, pitchSpread: 0.3, panSpread: 0.7,
                position: 0.5, mix: 0.30, pitchMode: 0, envelope: 0, spawnMode: 0 },
};
// Parallel sends use mix=1 (full wet) — the dry path is the main
// serial chain; the send level scales the dry input fed into the
// reverb. Only plate / hall / cistern are valid parallel send targets.
function parallelParams(effectId) {
  const base = EFFECT_PARAMS_SERIAL[effectId] ?? {};
  return { ...base, mix: 1.0 };
}
const SKIPPED_EFFECTS = new Set([
  "tape", "wow", "sub", "comb", "ringmod", "formant", "delay", "freeze",
]);

function applyFxBlocks(input, procName, paramObj, fxReg) {
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

function applyEffectChain(voiceSum, preset, fxReg) {
  const skipped = [];
  let serial = voiceSum;
  for (const effectId of preset.effects ?? []) {
    if (SKIPPED_EFFECTS.has(effectId)) { skipped.push(effectId); continue; }
    const procName = EFFECT_PROC[effectId];
    if (!procName) { skipped.push(`${effectId}(unknown)`); continue; }
    serial = applyFxBlocks(serial, procName, EFFECT_PARAMS_SERIAL[effectId] ?? {}, fxReg);
  }
  // Parallel sends: dry voiceSum × sendLevel → wet effect → sum into serial.
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
  // Master brickwall limiter — the engine always routes through this
  // before the output, so the audit applies it last to match.
  const limited = applyFxBlocks(serial, "fx-brickwall",
    { ceiling: 0.891, releaseSec: 0.12, enabled: 1 }, fxReg);
  return { out: limited, skipped };
}

function renderPreset(preset, VoiceProc, seconds, seedBase) {
  const blocks = Math.ceil(seconds * SR / BLK);
  const N = blocks * BLK;
  const sumL = new Float32Array(N);
  const sumR = new Float32Array(N);
  const freq = presetVoiceFreq(preset);
  const params = {
    freq: makeParamArr(freq),
    drift: makeParamArr(preset.drift ?? 0.2),
    amp: makeParamArr(0.6),
    pluckRate: makeParamArr(1),
    color: makeParamArr(preset.noiseColor ?? 0.3),
  };
  const opts = {
    reedShape: preset.reedShape,
    fmRatio: preset.fmRatio,
    fmIndex: preset.fmIndex,
    fmFeedback: preset.fmFeedback,
    tanpuraTuning: preset.tanpuraTuning,
  };
  const layers = preset.voiceLayers ?? [];
  const levels = preset.voiceLevels ?? {};
  for (let i = 0; i < layers.length; i++) {
    const v = layers[i];
    const level = levels[v] ?? 1.0;
    if (level <= 0) continue;
    const seed = (seedBase ^ (i * 0x9E3779B1) ^ v.charCodeAt(0)) >>> 0;
    const p = makeVoice(VoiceProc, v, seed, opts);
    const out = runProcessor(p, params, blocks, BLK);
    for (let n = 0; n < N; n++) {
      sumL[n] += out[0][n] * level;
      sumR[n] += out[1][n] * level;
    }
  }
  const gain = preset.gain ?? 1.0;
  if (gain !== 1.0) {
    for (let n = 0; n < N; n++) { sumL[n] *= gain; sumR[n] *= gain; }
  }
  return [sumL, sumR];
}

// ─── Canonical preset set (matches PR-6 scorecard) ──────────────────
const CANONICAL_IDS = [
  // Arrival
  "tanpura-drone", "shruti-box", "eno-airport", "malone-organ",
  "stars-of-the-lid", "ritual-tanpura-shruti", "fm-glass-bell",
  "oliveros-accordion", "marconi-weightless", "young-well-tuned",
  // Flagship changed-voice
  "sitar-sympathy", "alice-coltrane-devotional", "doom-bloom",
  "sunn-amp-drone", "coil-time-machines", "hollow-drone", "sub-chamber",
  "tibetan-bowl", "wiese-baraka", "slendro-gamelan", "tuvan-khoomei",
  "high-shimmer", "fm-gong",
  // Other library
  "fennesz-endless", "basinski-disintegration", "frahm-solo",
  "grouper-dragging", "sotl-tired-eyes", "liles-submariner",
  "nww-soliloquy", "merzbient", "windscape", "liles-closed-doors",
  "hecker-ravedeath",
];

// ─── CLI ────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = { all: false, seconds: 10, presets: null, fx: true };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--all") out.all = true;
    else if (a === "--seconds") out.seconds = Number(argv[++i]);
    else if (a === "--presets") out.presets = argv[++i].split(",").map(s => s.trim());
    else if (a === "--no-fx") out.fx = false;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  const { PRESETS } = await import(join(ROOT, ".test-dist/engine/presets.js"));
  const byId = new Map(PRESETS.map((p) => [p.id, p]));

  let ids;
  if (args.presets) ids = args.presets;
  else if (args.all) ids = PRESETS.map((p) => p.id);
  else ids = CANONICAL_IDS;

  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    console.error(`Unknown preset ids: ${missing.join(", ")}`);
    process.exit(1);
  }

  const voicesReg = loadWorklet("src/engine/droneVoiceProcessor.js", SR);
  const VoiceProc = voicesReg.get("drone-voice");
  if (!VoiceProc) { console.error("drone-voice processor missing"); process.exit(1); }
  const fxReg = args.fx ? loadWorklet("src/engine/fxChainProcessor.js", SR) : null;

  const commit = (() => {
    try { return execSync("git rev-parse --short HEAD").toString().trim(); }
    catch { return "unknown"; }
  })();
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

  console.error(`mdrone preset audit  v${pkg.version}  commit ${commit}`);
  console.error(`render: ${args.seconds}s @ ${SR} Hz, ${args.fx ? "voice + FX (worklet effects + master limiter)" : "voice bus only"}`);
  console.error(`presets: ${ids.length}\n`);

  const results = {};
  let i = 0;
  for (const id of ids) {
    i++;
    const preset = byId.get(id);
    process.stderr.write(`[${i}/${ids.length}] ${id}…  `);
    const t0 = Date.now();
    const [vL, vR] = renderPreset(preset, VoiceProc, args.seconds, 0xA0DA ^ i * 0x9E3779B1);
    let L = vL, R = vR, skipped = [];
    if (fxReg) {
      const fxResult = applyEffectChain([vL, vR], preset, fxReg);
      L = fxResult.out[0]; R = fxResult.out[1]; skipped = fxResult.skipped;
    }
    const stats = basicStats(L, R);
    const lufs = stats.finite ? integratedLufs(L, R, SR) : null;
    const corr = stats.finite ? lrCorrelation(L, R) : null;
    const bands = stats.finite ? bandEnergyDb(L, SR) : null;
    const ms = Date.now() - t0;
    process.stderr.write(`${ms}ms${skipped.length ? `  (skipped FX: ${skipped.join(",")})` : ""}\n`);
    results[id] = {
      finite: stats.finite,
      lufs: lufs !== null ? Number(lufs.toFixed(2)) : null,
      samplePeakDb: stats.peak > 0 ? Number((20 * Math.log10(stats.peak)).toFixed(2)) : null,
      rmsDb: stats.rms > 0 ? Number((20 * Math.log10(stats.rms)).toFixed(2)) : null,
      crestFactor: stats.peak > 0 && stats.rms > 0
        ? Number((stats.peak / stats.rms).toFixed(2)) : null,
      dc: { L: Number(stats.dcL.toFixed(5)), R: Number(stats.dcR.toFixed(5)) },
      lrCorr: corr !== null ? Number(corr.toFixed(3)) : null,
      bands: bands ? Object.fromEntries(
        Object.entries(bands).map(([k, v]) => [k, Number(v.toFixed(2))])) : null,
      skippedFx: skipped,
    };
  }

  const json = {
    version: pkg.version,
    commit,
    renderSeconds: args.seconds,
    sampleRate: SR,
    voiceBusOnly: !args.fx,
    presets: results,
  };
  const tmpDir = join(ROOT, "tmp");
  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
  const outPath = join(tmpDir, "preset-audit.json");
  writeFileSync(outPath, JSON.stringify(json, null, 2));
  console.error(`\nwrote ${outPath}\n`);

  // Markdown table for stdout.
  console.log(`# mdrone preset audit — v${pkg.version} @ ${commit}`);
  console.log(`Render: ${args.seconds}s ${args.fx ? "voice + FX (worklet effects + master limiter)" : "voice bus only"}. Sample rate ${SR} Hz.\n`);
  console.log("| Preset | LUFS | Peak dB | RMS dB | Crest | DC(L) | L/R corr | low | mud | harsh | air |");
  console.log("|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|");
  // Sort by LUFS descending for quick eyeballing.
  const sorted = ids
    .map((id) => [id, results[id]])
    .sort((a, b) => (b[1].lufs ?? -999) - (a[1].lufs ?? -999));
  for (const [id, r] of sorted) {
    const fmt = (v, d = 1) => v == null ? "—" : v.toFixed(d);
    console.log(`| ${id} | ${fmt(r.lufs)} | ${fmt(r.samplePeakDb)} | ${fmt(r.rmsDb)} | `
      + `${fmt(r.crestFactor, 2)} | ${fmt(r.dc.L, 4)} | ${fmt(r.lrCorr, 2)} | `
      + `${fmt(r.bands?.lowDb)} | ${fmt(r.bands?.mudDb)} | ${fmt(r.bands?.harshDb)} | ${fmt(r.bands?.airDb)} |`);
  }

  // Library-wide context lines.
  const lufses = sorted.map(([_, r]) => r.lufs).filter((v) => v != null);
  if (lufses.length > 0) {
    const med = lufses.slice().sort((a, b) => a - b)[Math.floor(lufses.length / 2)];
    const max = Math.max(...lufses), min = Math.min(...lufses);
    console.log(`\n**LUFS spread:** median ${med.toFixed(1)}, range ${min.toFixed(1)} … ${max.toFixed(1)} (${(max - min).toFixed(1)} dB)`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
