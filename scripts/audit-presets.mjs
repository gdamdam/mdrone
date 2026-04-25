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
import {
  SR, BLK, makeBuffers, makeParamArr,
  integratedLufs, bandEnergyDb, basicStats, lrCorrelation,
  applyEffectChain,
} from "./audit-helpers.mjs";

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

// ─── Voice rendering for a preset ───────────────────────────────────

function octaveToFreq(octave) {
  // Simple mapping: octave 2 → 110 Hz, doubles per octave step.
  return 55 * Math.pow(2, octave);
}

function presetVoiceFreq(preset) {
  const lo = preset.octaveRange?.[0] ?? 2;
  return octaveToFreq(lo);
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
