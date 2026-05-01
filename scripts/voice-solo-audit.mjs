// Voice solo audit — renders each voice type alone at a standard
// tonic (110 Hz / octave 2) for 10s, measures integrated LUFS,
// peak, and RMS. Reveals which voices sit hotter or quieter than
// the polite middle (-28 to -32 LUFS) so per-voice intrinsic gain
// trims can be set from data instead of guesswork.
//
// Reflects the post-1.20.18 state: tanpura (×0.5) and amp (×0.63)
// already have intrinsic trims applied; this run includes those.
// Run after `node scripts/build-worklet.mjs`.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { SR, BLK, makeBuffers, makeParamArr, integratedLufs, basicStats } from "./audit-helpers.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

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

function makeVoice(VoiceProc, voiceType, seed) {
  const p = new VoiceProc();
  p.voiceType = voiceType;
  p.rng = mulberry32(seed);
  p.pink = { b0:0, b1:0, b2:0, b3:0, b4:0, b5:0, b6:0 };
  p.stopped = false;
  p.reedShape = "balanced";
  p.fmRatioOpt = 2.0;
  p.fmIndexOpt = 2.4;
  p.fmFeedbackOpt = 0;
  p.tanpuraTuningOpt = "classic";
  p.dichoticMulR = 1.0;
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
    for (let c = 0; c < 2; c++) out[c].set(frame[0][c], b * block);
  }
  return out;
}

async function main() {
  const SECONDS = 10;
  const FREQ = 110; // octave 2
  const VOICES = ["tanpura", "reed", "air", "piano", "fm", "amp", "metal", "noise"];

  const reg = loadWorklet("src/engine/droneVoiceProcessor.js", SR);
  const VoiceProc = reg.get("drone-voice");
  if (!VoiceProc) { console.error("drone-voice processor missing"); process.exit(1); }

  const blocks = Math.ceil(SECONDS * SR / BLK);
  const params = {
    freq: makeParamArr(FREQ),
    drift: makeParamArr(0.2),
    amp:   makeParamArr(0.6),
    pluckRate: makeParamArr(1),
    color: makeParamArr(0.3),
  };

  console.log(`Voice solo audit — ${SECONDS}s @ ${FREQ} Hz, voice-only (no FX)`);
  console.log(`Polite middle target: -28 to -32 LUFS\n`);

  const rows = [];
  for (const v of VOICES) {
    const proc = makeVoice(VoiceProc, v, 0xA0DA ^ v.charCodeAt(0));
    const out = runProcessor(proc, params, blocks, BLK);
    const stats = basicStats(out[0], out[1]);
    if (!stats.finite) { console.error(`${v}: non-finite output, skipping`); continue; }
    const lufs = integratedLufs(out[0], out[1], SR);
    const peakDb = 20 * Math.log10(Math.max(1e-10, stats.peak));
    const rmsDb  = 20 * Math.log10(Math.max(1e-10, stats.rms));
    rows.push({ v, lufs, peakDb, rmsDb });
  }
  rows.sort((a, b) => b.lufs - a.lufs);

  console.log(`| Voice    | LUFS  | Peak dB | RMS dB | vs −28 LUFS target |`);
  console.log(`|----------|------:|--------:|-------:|-------------------:|`);
  for (const r of rows) {
    const delta = r.lufs - (-28);
    const arrow = delta > 1 ? "↑ hot" : delta < -1 ? "↓ quiet" : "≈ ok";
    console.log(
      `| ${r.v.padEnd(8)} | ${r.lufs.toFixed(1).padStart(5)} ` +
      `| ${r.peakDb.toFixed(1).padStart(7)} | ${r.rmsDb.toFixed(1).padStart(6)} ` +
      `| ${(delta >= 0 ? "+" : "") + delta.toFixed(1).padStart(4)} dB  ${arrow}`,
    );
  }
  console.log(`\nSpread: ${(rows[0].lufs - rows[rows.length - 1].lufs).toFixed(1)} dB`);
}

main().catch((e) => { console.error(e); process.exit(1); });
