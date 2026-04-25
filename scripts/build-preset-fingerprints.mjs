// Generate / regenerate tests/baselines/preset-fingerprints.json.
//
// Runs voice-bus-only renders (no FX chain) for a small flagship set,
// captures LUFS / sample-peak / DC / 4-band energies, and writes a
// JSON baseline that the dsp-smoke fingerprint test compares against.
// Voice-bus rather than FX-rendered because we want a stable target
// that catches voice-DSP regressions without false positives from
// reverb-tail variability.
//
// Run:
//   npm run audit:fingerprints
//
// When regenerating after an intentional DSP change, eyeball the diff
// and check it in; the fingerprint test then locks the new baseline.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { execSync } from "node:child_process";
import {
  SR, BLK, makeParamArr, integratedLufs, bandEnergyDb, basicStats,
} from "./audit-helpers.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

// Local worklet stub (mirrors tests/dsp-smoke.test.mjs).
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

function runProcessor(proc, params, blocks) {
  const out = [new Float32Array(blocks * BLK), new Float32Array(blocks * BLK)];
  for (let b = 0; b < blocks; b++) {
    const frame = [[new Float32Array(BLK), new Float32Array(BLK)]];
    const src = [[new Float32Array(BLK), new Float32Array(BLK)]];
    proc.process(src, frame, params);
    out[0].set(frame[0][0], b * BLK);
    out[1].set(frame[0][1], b * BLK);
  }
  return out;
}

function octaveToFreq(octave) { return 55 * Math.pow(2, octave); }

// Render a preset's voice bus only — voiceLayers summed at voiceLevels,
// multiplied by preset.gain. No FX chain.
function renderVoiceBus(preset, VoiceProc, seconds, seedBase) {
  const blocks = Math.ceil(seconds * SR / BLK);
  const N = blocks * BLK;
  const sumL = new Float32Array(N), sumR = new Float32Array(N);
  const freq = octaveToFreq(preset.octaveRange?.[0] ?? 2);
  const params = {
    freq: makeParamArr(freq),
    drift: makeParamArr(preset.drift ?? 0.2),
    amp: makeParamArr(0.6),
    pluckRate: makeParamArr(1),
    color: makeParamArr(preset.noiseColor ?? 0.3),
  };
  const opts = {
    reedShape: preset.reedShape, fmRatio: preset.fmRatio,
    fmIndex: preset.fmIndex, fmFeedback: preset.fmFeedback,
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
    const out = runProcessor(p, params, blocks);
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

// Flagship set chosen for breadth of voice families:
//   tanpura-drone   — solo tanpura (jawari + DC blocker)
//   shruti-box      — solo reed (no DSP changes; baseline anchor)
//   tibetan-bowl    — metal-led (modal upgrade)
//   hollow-drone    — amp + tanpura (cab + jawari)
//   fennesz-endless — reed + air (untouched, second anchor)
const FINGERPRINT_PRESETS = [
  "tanpura-drone", "shruti-box", "tibetan-bowl", "hollow-drone", "fennesz-endless",
];

const RENDER_SECONDS = 4;
const SEED_BASE = 0xF1A6;

async function main() {
  const { PRESETS } = await import(join(ROOT, ".test-dist/engine/presets.js"));
  const byId = new Map(PRESETS.map((p) => [p.id, p]));
  const voicesReg = loadWorklet("src/engine/droneVoiceProcessor.js");
  const VoiceProc = voicesReg.get("drone-voice");
  if (!VoiceProc) { console.error("drone-voice processor missing"); process.exit(1); }

  const commit = (() => {
    try { return execSync("git rev-parse --short HEAD").toString().trim(); }
    catch { return "unknown"; }
  })();
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

  const fingerprints = {};
  for (const id of FINGERPRINT_PRESETS) {
    const preset = byId.get(id);
    if (!preset) { console.error(`missing preset: ${id}`); process.exit(1); }
    const [L, R] = renderVoiceBus(preset, VoiceProc, RENDER_SECONDS, SEED_BASE ^ id.charCodeAt(0));
    const stats = basicStats(L, R);
    if (!stats.finite) { console.error(`${id}: non-finite render`); process.exit(1); }
    const lufs = integratedLufs(L, R, SR);
    const bands = bandEnergyDb(L, SR);
    fingerprints[id] = {
      lufs: Number(lufs.toFixed(2)),
      samplePeakDb: Number((20 * Math.log10(stats.peak)).toFixed(2)),
      rmsDb: Number((20 * Math.log10(stats.rms)).toFixed(2)),
      dcL: Number(stats.dcL.toFixed(5)),
      bands: {
        lowDb:   Number(bands.lowDb.toFixed(2)),
        mudDb:   Number(bands.mudDb.toFixed(2)),
        harshDb: Number(bands.harshDb.toFixed(2)),
        airDb:   Number(bands.airDb.toFixed(2)),
      },
    };
    console.error(`${id.padEnd(28)} LUFS=${fingerprints[id].lufs.toString().padStart(7)} `
      + `peak=${fingerprints[id].samplePeakDb.toString().padStart(7)} `
      + `dc=${fingerprints[id].dcL.toString().padStart(8)}`);
  }

  const json = {
    note: "Auto-generated by `npm run audit:fingerprints`. Voice-bus only, no FX. "
        + "Re-run after intentional DSP change and check in the new values; the "
        + "dsp-smoke fingerprint test compares against this file with ±tolerance.",
    version: pkg.version,
    commit,
    renderSeconds: RENDER_SECONDS,
    seedBase: SEED_BASE,
    sampleRate: SR,
    fingerprints,
  };
  const outDir = join(ROOT, "tests/baselines");
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, "preset-fingerprints.json");
  writeFileSync(outPath, JSON.stringify(json, null, 2) + "\n");
  console.error(`\nwrote ${outPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
