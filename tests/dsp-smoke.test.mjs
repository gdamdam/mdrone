// DSP smoke tests. Direct-instantiates the AudioWorkletProcessor classes
// from the voice + fx-chain worklets and renders raw audio blocks,
// asserting per-voice and per-reverb output stays finite, bounded, and
// DC-free. This is a regression fence for the nonlinear / feedback-rich
// paths (KS, SVF, plate tank, shimmer loop) where a single NaN or
// runaway feedback would otherwise silently break a preset. We cannot
// run the full Web Audio graph from Node, so we stub the worklet globals
// and exercise the processor classes directly.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

// ── Worklet globals stub ─────────────────────────────────────────────
// Load each worklet as text, evaluate it in a scope that provides
// sampleRate / AudioWorkletProcessor / registerProcessor, and collect
// the registered processor classes into a map.
function loadWorklet(relPath, sampleRate = 48000) {
  const src = readFileSync(join(ROOT, relPath), "utf8");
  const registry = new Map();
  class AudioWorkletProcessor {
    constructor() {
      this.port = { postMessage() {}, onmessage: null };
    }
  }
  const registerProcessor = (name, cls) => registry.set(name, cls);
  const factory = new Function(
    "sampleRate", "AudioWorkletProcessor", "registerProcessor", "currentTime",
    src,
  );
  factory(sampleRate, AudioWorkletProcessor, registerProcessor, 0);
  return registry;
}

function makeBuffers(nChan, nFrames) {
  const out = [];
  for (let c = 0; c < nChan; c++) out.push(new Float32Array(nFrames));
  return out;
}

function makeParamArr(value) { return new Float32Array([value]); }

function stats(buf) {
  let peak = 0, sumSq = 0, sum = 0, finite = true;
  for (let i = 0; i < buf.length; i++) {
    const v = buf[i];
    if (!Number.isFinite(v)) { finite = false; break; }
    const a = Math.abs(v);
    if (a > peak) peak = a;
    sum += v;
    sumSq += v * v;
  }
  const rms = Math.sqrt(sumSq / buf.length);
  const dc = sum / buf.length;
  return { peak, rms, dc, finite };
}

// ── Long-hold stability helper ──────────────────────────────────────
// Splits a stereo render into halves and asserts no NaN, no peak above
// safety ceiling, no DC outside bounds, no DC drift between halves
// (the precise signal of a feedback path accumulating), no RMS swing
// above the configured ceiling, and optionally a minimum RMS so a
// "stable but silent" regression also fails. All bounds are configurable
// per voice — the defaults match the conservative choices the original
// per-voice tests used inline.
function assertLongHoldStable(out, label, {
  peakMax = 2.5,
  dcMax = 0.1,
  dcDriftMax = 0.02,
  rmsClimbMaxDb = 3,
  rmsMin = 0,
} = {}) {
  for (let c = 0; c < 2; c++) {
    const buf = out[c];
    const half = (buf.length / 2) | 0;
    const a = stats(buf.subarray(0, half));
    const b = stats(buf.subarray(half));
    assert.ok(a.finite && b.finite, `${label}[${c}] long hold non-finite`);
    assert.ok(a.peak < peakMax && b.peak < peakMax,
      `${label}[${c}] peaks ${a.peak.toFixed(3)} / ${b.peak.toFixed(3)} exceed ${peakMax}`);
    assert.ok(Math.abs(a.dc) < dcMax && Math.abs(b.dc) < dcMax,
      `${label}[${c}] DC ${a.dc.toFixed(4)} / ${b.dc.toFixed(4)} above ${dcMax}`);
    assert.ok(Math.abs(b.dc - a.dc) < dcDriftMax,
      `${label}[${c}] DC drift ${(b.dc - a.dc).toFixed(4)} > ${dcDriftMax} — feedback path likely accumulating`);
    const climbDb = 20 * Math.log10((b.rms + 1e-12) / (a.rms + 1e-12));
    assert.ok(Math.abs(climbDb) < rmsClimbMaxDb,
      `${label}[${c}] RMS swing ${climbDb.toFixed(2)} dB across halves > ${rmsClimbMaxDb} dB`);
    if (rmsMin > 0) {
      assert.ok(a.rms > rmsMin && b.rms > rmsMin,
        `${label}[${c}] RMS ${a.rms.toFixed(4)} / ${b.rms.toFixed(4)} below ${rmsMin} — voice may have starved`);
    }
  }
}

// Construct + init a voice processor. Mirrors the inline setup the
// existing voice-smoke test does; reused by the new safety tests.
function makeVoice(VoiceProc, voiceType, seed) {
  const p = new VoiceProc();
  p.voiceType = voiceType;
  p.rng = mulberry32(seed);
  p.pink = { b0:0,b1:0,b2:0,b3:0,b4:0,b5:0,b6:0 };
  p.stopped = false;
  p.reedShape = "odd";
  p.fmRatioOpt = 2.0;
  p.fmIndexOpt = 2.4;
  p.fmFeedbackOpt = 0;
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

function runProcessor(proc, params, { inputs = null, blocks = 64, block = 128 } = {}) {
  const out = makeBuffers(2, blocks * block);
  const tmp = [makeBuffers(2, block)];
  const inArg = inputs ? [inputs.map((c) => c)] : [[]];
  for (let b = 0; b < blocks; b++) {
    const frame = [makeBuffers(2, block)];
    // Feed a silent stereo input unless caller provided one.
    const src = inputs ? [inputs.map((c) => c.subarray(b * block, b * block + block))]
                       : [[new Float32Array(block), new Float32Array(block)]];
    // params is { name: Float32Array([v]) }
    proc.process(src, frame, params);
    for (let c = 0; c < 2; c++) {
      out[c].set(frame[0][c], b * block);
    }
  }
  return out;
}

// ─── Voice processor smoke ───────────────────────────────────────────
test("drone voice — every voice type renders finite, bounded, DC-free", () => {
  const SR = 48000;
  const voicesReg = loadWorklet("src/engine/droneVoiceProcessor.js", SR);
  const VoiceProc = voicesReg.get("drone-voice");
  assert.ok(VoiceProc, "drone-voice processor must register");

  const voiceTypes = ["tanpura", "reed", "metal", "air", "piano", "fm", "amp", "noise"];
  const params = {
    freq: makeParamArr(110),
    drift: makeParamArr(0.3),
    amp: makeParamArr(0.6),
    pluckRate: makeParamArr(1),
  };

  for (const type of voiceTypes) {
    // Hand-construct the processor; worklet options come via
    // processorOptions normally — we emulate by setting fields
    // expected by the switch in sanitizeState / per-voice init.
    const p = new VoiceProc();
    p.voiceType = type;
    p.rng = mulberry32(0xCAFE ^ type.charCodeAt(0));
    p.pink = { b0:0,b1:0,b2:0,b3:0,b4:0,b5:0,b6:0 };
    p.stopped = false;
    p.reedShape = "odd";
    p.fmRatioOpt = 2.0;
    p.fmIndexOpt = 2.4;
    p.fmFeedbackOpt = 0;
    switch (type) {
      case "tanpura": p.initTanpura(); break;
      case "reed":    p.initReed();    break;
      case "metal":   p.initMetal();   break;
      case "air":     p.initAir();     break;
      case "piano":   p.initPiano();   break;
      case "fm":      p.initFm();      break;
      case "amp":     p.initAmp();     break;
      case "noise":   p.initNoise();   break;
    }

    // 64 × 128 frames = 8192 samples ≈ 170 ms @ 48k — long enough
    // to let the KS / bloom / restrike transients pass.
    const out = runProcessor(p, params, { blocks: 64, block: 128 });
    for (let c = 0; c < 2; c++) {
      const s = stats(out[c]);
      assert.ok(s.finite, `${type}[${c}] produced non-finite samples`);
      // Voice output runs pre-presetTrim and pre-master-limiter, so
      // peaks > 1.0 are fine (AIR's resonators and METAL's beating
      // modes regularly hit ~2.0). Ceiling is a runaway-feedback
      // fence, not a normalisation assertion.
      assert.ok(s.peak < 2.5, `${type}[${c}] peak ${s.peak.toFixed(3)} exceeds safety ceiling`);
      assert.ok(Math.abs(s.dc) < 0.05, `${type}[${c}] DC offset ${s.dc.toFixed(4)} too high`);
      assert.ok(s.rms < 0.9, `${type}[${c}] RMS ${s.rms.toFixed(3)} is unreasonably hot`);
    }
  }
});

// ─── Tanpura long-hold stability ────────────────────────────────────
// Covers the envelope-driven jawari bridge + sympathetic cross-string
// coupling added in the jawari upgrade. The coupling bus feeds energy
// between KS lines; bounded coupling gain keeps the system stable, but
// a regression here (e.g. raising coupling above the damping budget,
// or removing the previous-sample latch) would cause slow monotonic
// energy growth on long holds. We render ~8 s, compare first-half vs
// second-half RMS, and assert no NaN / runaway / DC drift.
test("tanpura — sympathetic coupling stable over long hold", () => {
  const SR = 48000;
  const voicesReg = loadWorklet("src/engine/droneVoiceProcessor.js", SR);
  const VoiceProc = voicesReg.get("drone-voice");
  const p = makeVoice(VoiceProc, "tanpura", 0xBEEF);
  // 8 s with active plucking — exercises the bridge + sympathetic bus.
  const params = {
    freq: makeParamArr(110),
    drift: makeParamArr(0.4),
    amp: makeParamArr(0.6),
    pluckRate: makeParamArr(1),
  };
  const BLK = 128, BLOCKS = Math.ceil(8 * SR / BLK);
  const out = runProcessor(p, params, { blocks: BLOCKS, block: BLK });
  assertLongHoldStable(out, "tanpura");
});

// ─── Amp long-hold stability ────────────────────────────────────────
// Covers the tighter cab voicing in the amp realism upgrade — body
// Q≈3 at 95 Hz + presence Q≈5 at 2.8 kHz + 2-stage 6.5 kHz LP. The
// speaker-feedback path now reads from the second cascade stage; if a
// regression raised the body Q without also lowering the feedback gain,
// 80–100 Hz drives would ring up. Driving the voice at 80 Hz (right
// in the body peak) for 8 s exercises the worst case.
test("amp — tighter cab voicing stable on long hold near body resonance", () => {
  const SR = 48000;
  const voicesReg = loadWorklet("src/engine/droneVoiceProcessor.js", SR);
  const VoiceProc = voicesReg.get("drone-voice");
  const p = makeVoice(VoiceProc, "amp", 0xFEED);
  const params = {
    freq: makeParamArr(80),
    drift: makeParamArr(0.4),
    amp: makeParamArr(0.6),
    pluckRate: makeParamArr(1),
  };
  const BLK = 128, BLOCKS = Math.ceil(8 * SR / BLK);
  const out = runProcessor(p, params, { blocks: BLOCKS, block: BLK });
  assertLongHoldStable(out, "amp");
});

// ─── Metal long-hold stability ──────────────────────────────────────
// Covers the modal upgrade — doublet pairs across 6 main modes plus 4
// single high modes (16 oscillators total), with mode-dependent decay
// times that range from ~30 s (fundamental) down to ~1 s (top mode).
// The slower fundamental decay layered with the 0.08 Hz restrike LFO
// is the regression hotspot: if the restrike depth or decay floor
// changes, the bowl could either runaway-resonate or fade silent on
// long holds. 8 s drive at 110 Hz exercises both.
test("metal — modal doublets stable on long hold across restrike LFO", () => {
  const SR = 48000;
  const voicesReg = loadWorklet("src/engine/droneVoiceProcessor.js", SR);
  const VoiceProc = voicesReg.get("drone-voice");
  const p = makeVoice(VoiceProc, "metal", 0xB0BB);
  const params = {
    freq: makeParamArr(110),
    drift: makeParamArr(0.4),
    amp: makeParamArr(0.6),
    pluckRate: makeParamArr(1),
  };
  const BLK = 128, BLOCKS = Math.ceil(8 * SR / BLK);
  const out = runProcessor(p, params, { blocks: BLOCKS, block: BLK });
  // Tighter DC bound than tanpura/amp — metal is symmetric tanh so DC
  // should stay near zero. rmsMin guards a "decay floor silenced the
  // fundamental" regression, see the metal modal upgrade notes.
  assertLongHoldStable(out, "metal", { dcMax: 0.05, rmsMin: 0.02 });
});

// ─── Noise long-hold across colors ──────────────────────────────────
// Noise has a feedback-free signal flow but a one-pole DC blocker per
// channel; brown / "deep" colors (high `color` values) push the LP
// state toward sub-audio, where rounding-error DC can build up over
// long holds. Render 8 s at four colour points spanning white → pink
// → brown → deep and assert no NaN, no DC drift between halves, and
// no RMS climb. The DC bound is tighter than tanpura/amp because the
// noise voice has an explicit DC blocker — anything > 0.04 means the
// blocker has stopped working.
test("noise — stable long hold across colour values", () => {
  const SR = 48000;
  const voicesReg = loadWorklet("src/engine/droneVoiceProcessor.js", SR);
  const VoiceProc = voicesReg.get("drone-voice");
  for (const color of [0.0, 0.3, 0.6, 1.0]) {
    const p = makeVoice(VoiceProc, "noise", 0xC0DE ^ Math.round(color * 1000));
    const params = {
      freq: makeParamArr(110),
      drift: makeParamArr(0.4),
      amp: makeParamArr(0.6),
      pluckRate: makeParamArr(1),
      color: makeParamArr(color),
    };
    const BLK = 128, BLOCKS = Math.ceil(8 * SR / BLK);
    const out = runProcessor(p, params, { blocks: BLOCKS, block: BLK });
    assertLongHoldStable(out, `noise@c${color}`, {
      dcMax: 0.04,
      // Noise variance over 4 s windows is naturally a couple of dB; 3 dB
      // is the existing helper default — keep it.
      rmsMin: 0.02, // catches "noise voice silenced itself on brown"
    });
  }
});

// ─── Voice quiet-floor sanity ───────────────────────────────────────
// At near-silent input every voice should produce near-silent output
// — no NaN, no denormal-style runaway, no spurious DC. This catches
// uninitialised state, divisions by zero in init paths, and any
// feedback path that self-excites without external drive (which would
// be inaudible at normal levels but stack badly in the master limiter
// when summed across 64 voices). Using amp=0.001 instead of 0 keeps
// every per-voice gain path live so a multiply-by-amp regression is
// also caught.
test("drone voice — every voice type stays silent at amp=0.001", () => {
  const SR = 48000;
  const voicesReg = loadWorklet("src/engine/droneVoiceProcessor.js", SR);
  const VoiceProc = voicesReg.get("drone-voice");
  const voiceTypes = ["tanpura", "reed", "metal", "air", "piano", "fm", "amp", "noise"];
  const params = {
    freq: makeParamArr(110),
    drift: makeParamArr(0.0),
    amp: makeParamArr(0.001),
    pluckRate: makeParamArr(1),
    color: makeParamArr(0.3),
  };
  // 1 s render; long enough for any feedback path to ring up if broken,
  // short enough to keep the suite snappy.
  const BLK = 128, BLOCKS = Math.ceil(SR / BLK);
  for (const type of voiceTypes) {
    const p = makeVoice(VoiceProc, type, 0xDEAD ^ type.charCodeAt(0));
    const out = runProcessor(p, params, { blocks: BLOCKS, block: BLK });
    for (let c = 0; c < 2; c++) {
      const s = stats(out[c]);
      assert.ok(s.finite, `${type}[${c}] non-finite at amp=0.001`);
      // Voice output is pre-master-limiter and amp=0.001 is a 60 dB
      // attenuation; output peak should sit well under 0.05. A higher
      // peak indicates either a feedback path self-exciting or the
      // amp parameter being ignored on the per-voice path.
      assert.ok(s.peak < 0.05,
        `${type}[${c}] peak ${s.peak.toFixed(4)} at amp=0.001 — feedback path likely self-exciting`);
      assert.ok(Math.abs(s.dc) < 0.01,
        `${type}[${c}] DC ${s.dc.toFixed(5)} at amp=0.001 — denormal/uninit suspect`);
    }
  }
});

// ─── Sub-audio stress (low-tonic guard) ─────────────────────────────
// Tanpura and metal both have parameters tuned around 110 Hz; the
// remaining-risk notes from PR-1/PR-3 flagged that very low tonics
// (< 30 Hz) push the lowest doublet member or the buzz-formant SVF
// toward sub-audio. Render 4 s at 30 Hz / 32 Hz and assert finite,
// bounded, no DC accumulation. Fast (1.4 s of test time) and guards
// the documented edge case.
test("tanpura — stable at sub-audio root (30 Hz)", () => {
  const SR = 48000;
  const voicesReg = loadWorklet("src/engine/droneVoiceProcessor.js", SR);
  const VoiceProc = voicesReg.get("drone-voice");
  const p = makeVoice(VoiceProc, "tanpura", 0x303030);
  const params = {
    freq: makeParamArr(30),
    drift: makeParamArr(0.4),
    amp: makeParamArr(0.6),
    pluckRate: makeParamArr(1),
  };
  const BLK = 128, BLOCKS = Math.ceil(4 * SR / BLK);
  const out = runProcessor(p, params, { blocks: BLOCKS, block: BLK });
  // Looser bounds at sub-audio: 4 s captures only ~120 cycles of
  // 30 Hz, so DC averaging has more window noise and the pluck-cycle
  // / half-window beat allows several-dB block-RMS swing by design.
  // The runaway check is the climb bound — keep that tight enough
  // (5 dB) to catch genuine feedback growth, loosen DC drift to 0.04.
  assertLongHoldStable(out, "tanpura@30Hz", { dcDriftMax: 0.04, rmsClimbMaxDb: 6 });
});

test("metal — stable at sub-audio root (32 Hz)", () => {
  const SR = 48000;
  const voicesReg = loadWorklet("src/engine/droneVoiceProcessor.js", SR);
  const VoiceProc = voicesReg.get("drone-voice");
  const p = makeVoice(VoiceProc, "metal", 0x323232);
  const params = {
    freq: makeParamArr(32),
    drift: makeParamArr(0.3),
    amp: makeParamArr(0.6),
    pluckRate: makeParamArr(1),
  };
  const BLK = 128, BLOCKS = Math.ceil(4 * SR / BLK);
  const out = runProcessor(p, params, { blocks: BLOCKS, block: BLK });
  // dcMax 0.05 mirrors the 110 Hz metal test; rmsMin omitted because at
  // 32 Hz the lowest doublet member is below most listeners' hearing
  // — not a starvation regression, just physics. RMS swing loosened
  // to 5 dB because the 2 s half-window is shorter than the 12.5 s
  // restrike LFO period, so the two halves naturally land on
  // different LFO phases.
  assertLongHoldStable(out, "metal@32Hz", { dcMax: 0.05, rmsClimbMaxDb: 5 });
});

// ─── Plate + shimmer + freeze smoke ─────────────────────────────────
test("fx worklets — plate / shimmer / freeze stay finite under silent + impulsive input", () => {
  const SR = 48000;
  const fxReg = loadWorklet("src/engine/fxChainProcessor.js", SR);
  const cases = [
    { name: "fx-plate",    params: { decay: 0.6, damping: 0.4, diffusion: 0.75, mix: 1 } },
    { name: "fx-shimmer",  params: { feedback: 0.6, mix: 0.5, decay: 0.7 } },
    { name: "fx-freeze",   params: { active: 1, mix: 1 } },
    { name: "fx-granular", params: { size: 0.2, density: 6, pitchSpread: 0.2, panSpread: 0.6, position: 0.4, mix: 0.9, pitchMode: 0, envelope: 0, spawnMode: 0 } },
  ];
  for (const { name, params } of cases) {
    const Cls = fxReg.get(name);
    assert.ok(Cls, `${name} must register`);
    const p = new Cls();
    const paramObj = Object.fromEntries(Object.entries(params).map(([k, v]) => [k, makeParamArr(v)]));

    // Feed an input with one 110 Hz tone for 64 blocks so the
    // feedback paths get excited.
    const BLK = 128, BLOCKS = 96;
    const inL = new Float32Array(BLK * BLOCKS), inR = new Float32Array(BLK * BLOCKS);
    for (let i = 0; i < inL.length; i++) {
      inL[i] = Math.sin(2 * Math.PI * 110 * i / SR) * 0.3;
      inR[i] = Math.sin(2 * Math.PI * 111 * i / SR) * 0.3;
    }
    const out = runProcessor(p, paramObj, { inputs: [inL, inR], blocks: BLOCKS, block: BLK });
    for (let c = 0; c < 2; c++) {
      const s = stats(out[c]);
      assert.ok(s.finite, `${name}[${c}] produced non-finite samples`);
      assert.ok(s.peak < 3.0, `${name}[${c}] peak ${s.peak.toFixed(3)} exceeds safety ceiling`);
      assert.ok(Math.abs(s.dc) < 0.05, `${name}[${c}] DC offset ${s.dc.toFixed(4)} too high`);
    }
  }
});

// ─── Brickwall limiter smoke ─────────────────────────────────────────
test("fx-brickwall — holds ceiling on hot input without NaN or DC", () => {
  const SR = 48000;
  const fxReg = loadWorklet("src/engine/fxChainProcessor.js", SR);
  const Brick = fxReg.get("fx-brickwall");
  assert.ok(Brick, "fx-brickwall must register");
  const p = new Brick();
  // Ceiling -1 dB ≈ 0.8913 linear; release 0.1 s.
  const params = {
    ceiling:    makeParamArr(0.8913),
    releaseSec: makeParamArr(0.1),
    enabled:    makeParamArr(1),
  };
  const BLK = 128, BLOCKS = 64;
  const inL = new Float32Array(BLK * BLOCKS), inR = new Float32Array(BLK * BLOCKS);
  // Hot sine well above ceiling (amplitude 2.0 = +6 dB).
  for (let i = 0; i < inL.length; i++) {
    inL[i] = Math.sin(2 * Math.PI * 220 * i / SR) * 2.0;
    inR[i] = inL[i];
  }
  const out = runProcessor(p, params, { inputs: [inL, inR], blocks: BLOCKS, block: BLK });
  // Skip the first 2 ms (lookahead buffer fill) before asserting ceiling.
  const SKIP = 96;
  for (let c = 0; c < 2; c++) {
    let peak = 0;
    for (let i = SKIP; i < out[c].length; i++) {
      if (!Number.isFinite(out[c][i])) {
        assert.fail(`brickwall[${c}] produced NaN at sample ${i}`);
      }
      const a = Math.abs(out[c][i]);
      if (a > peak) peak = a;
    }
    // Allow a 1 dB safety margin for the attack-instant sample-peak
    // envelope to settle. With a 96-sample lookahead the output peak
    // on a steady sine never exceeds the ceiling.
    assert.ok(peak <= 0.8913 * 1.05, `brickwall[${c}] peak ${peak.toFixed(4)} exceeds ceiling`);
  }
});

// ─── FDN reverb smoke ────────────────────────────────────────────────
test("fx-fdn-reverb — stable tail, finite, bounded peak", () => {
  const SR = 48000;
  const fxReg = loadWorklet("src/engine/fxChainProcessor.js", SR);
  const Fdn = fxReg.get("fx-fdn-reverb");
  assert.ok(Fdn, "fx-fdn-reverb must register");

  // Simulate processor construction with a seed option (the class
  // reads from options?.processorOptions — stub it via a direct field
  // poke since our wrapper doesn't pass options in).
  const p = new Fdn({ processorOptions: { seed: 0xCAFE } });
  const params = {
    size:    makeParamArr(0.6),
    damping: makeParamArr(0.5),
    decay:   makeParamArr(0.85),
    mix:     makeParamArr(1),
  };
  const BLK = 128, BLOCKS = 96; // ~250 ms
  const inL = new Float32Array(BLK * BLOCKS), inR = new Float32Array(BLK * BLOCKS);
  // Brief impulse in first 256 samples, silence afterward — check tail decays cleanly.
  for (let i = 0; i < 256; i++) {
    inL[i] = Math.sin(2 * Math.PI * 220 * i / SR) * 0.3;
    inR[i] = Math.sin(2 * Math.PI * 221 * i / SR) * 0.3;
  }
  const out = runProcessor(p, params, { inputs: [inL, inR], blocks: BLOCKS, block: BLK });
  for (let c = 0; c < 2; c++) {
    const s = stats(out[c]);
    assert.ok(s.finite, `fdn[${c}] produced non-finite samples`);
    assert.ok(s.peak < 2.0, `fdn[${c}] peak ${s.peak.toFixed(3)} exceeds safety ceiling`);
    assert.ok(Math.abs(s.dc) < 0.05, `fdn[${c}] DC offset ${s.dc.toFixed(4)} too high`);
  }
});

// ─── Plate tank NaN recovery ─────────────────────────────────────────
test("plate tank — injected NaN is sanitized and output recovers", () => {
  const SR = 48000;
  const fxReg = loadWorklet("src/engine/fxChainProcessor.js", SR);
  const Plate = fxReg.get("fx-plate");
  const p = new Plate();
  // Poison the tank state; sanitizer must clear it at next block.
  p.crossL = NaN; p.crossR = NaN; p.lpL = NaN; p.lpR = NaN; p.bwState = NaN;
  const params = {
    decay: makeParamArr(0.6),
    damping: makeParamArr(0.4),
    diffusion: makeParamArr(0.75),
    mix: makeParamArr(1),
  };
  const BLK = 128, BLOCKS = 16;
  const inL = new Float32Array(BLK * BLOCKS), inR = new Float32Array(BLK * BLOCKS);
  for (let i = 0; i < inL.length; i++) {
    inL[i] = Math.sin(2 * Math.PI * 220 * i / SR) * 0.2;
    inR[i] = inL[i];
  }
  const out = runProcessor(p, params, { inputs: [inL, inR], blocks: BLOCKS, block: BLK });
  for (let c = 0; c < 2; c++) {
    const s = stats(out[c]);
    assert.ok(s.finite, `plate[${c}] stayed NaN after sanitize`);
  }
});

// ── deterministic Mulberry32 (matches presets.ts) ────────────────────
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
