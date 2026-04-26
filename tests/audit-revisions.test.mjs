// Audit-revisions regression fence (companion to misc/2026-04-26-audit-revisions.md).
//
// These are source-text assertions, not behavioural tests, because
// the changed values live in non-exported `const`s and method
// internals that are tightly bound to Web Audio. Source-grep is
// cheap, deterministic, and catches the most likely regression: a
// future edit silently undoes one of these clamps or trims.
//
// If any assertion fails, do NOT just bump the regex — re-read
// misc/2026-04-26-audit-revisions.md and confirm the design
// rationale before changing the bound.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

function read(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

// ── Reverb-family WET_GAIN scope ────────────────────────────────────
// Only plate / hall / shimmer / cistern were justified by the audit.
// formant / granular / graincloud / freeze must stay at their prior
// values until measured.

test("FxChain WET_GAIN: reverb family lowered, others unchanged", () => {
  const src = read("src/engine/FxChain.ts");
  const block = src.match(/const WET_GAIN[\s\S]*?\};/);
  assert.ok(block, "WET_GAIN literal not found in FxChain.ts");
  const text = block[0];

  // Reverb family — must be the post-revision values.
  assert.match(text, /plate:\s*1\.5/, "plate WET_GAIN should be 1.5");
  assert.match(text, /hall:\s*1\.5/, "hall WET_GAIN should be 1.5");
  assert.match(text, /shimmer:\s*1\.5/, "shimmer WET_GAIN should be 1.5");
  assert.match(text, /cistern:\s*1\.6/, "cistern WET_GAIN should be 1.6");

  // Untouched — guard against drive-by edits.
  assert.match(text, /formant:\s*1\.5/, "formant WET_GAIN should remain 1.5");
  assert.match(text, /granular:\s*1[,\s]/, "granular WET_GAIN should remain 1");
  assert.match(text, /graincloud:\s*1[,\s]/, "graincloud WET_GAIN should remain 1");
  assert.match(text, /freeze:\s*1[,\s}]/, "freeze WET_GAIN should remain 1");

  // No leftover hot trims from the previous regime.
  assert.doesNotMatch(text, /plate:\s*3\.0/, "plate WET_GAIN must not be 3.0 (pre-audit value)");
  assert.doesNotMatch(text, /hall:\s*2\.5/, "hall WET_GAIN must not be 2.5 (pre-audit value)");
  assert.doesNotMatch(text, /shimmer:\s*2\.5/, "shimmer WET_GAIN must not be 2.5 (pre-audit value)");
});

// ── Comb feedback cap ────────────────────────────────────────────────

test("FxChain setCombFeedback: cap is 0.92 (was 0.98)", () => {
  const src = read("src/engine/FxChain.ts");
  const fn = src.match(/setCombFeedback\s*\([^)]*\)\s*:\s*void\s*\{[\s\S]*?\n\s\s\}/);
  assert.ok(fn, "setCombFeedback not found");
  assert.match(fn[0], /Math\.min\(\s*0\.92\s*,/, "comb feedback cap should be 0.92");
  assert.doesNotMatch(fn[0], /Math\.min\(\s*0\.98\s*,/, "comb feedback cap must not be the pre-audit 0.98");
});

// ── Comb retune flush wired in setRootFreq ──────────────────────────

test("FxChain setRootFreq: comb flush sequence present and guarded", () => {
  const src = read("src/engine/FxChain.ts");
  const fn = src.match(/setRootFreq\s*\([^)]*\)\s*:\s*void\s*\{[\s\S]*?\n\s\s\}/);
  assert.ok(fn, "setRootFreq not found");
  // Guard: only flush when comb is enabled.
  assert.match(fn[0], /this\.enabled\.comb/, "flush should be gated on enabled.comb");
  // Rapid-retune guard via combFlushUntilCtxTime.
  assert.match(fn[0], /combFlushUntilCtxTime/, "rapid-retune guard not found");
  // Sequence: cancel → 0 → delay-time at +0.06 → restore at +0.20.
  assert.match(fn[0], /combFbGain\.gain\.cancelScheduledValues/, "flush should cancel pending automation first");
  assert.match(fn[0], /setTargetAtTime\(\s*0\s*,/, "flush should ramp combFbGain to 0");
  assert.match(fn[0], /now\s*\+\s*0\.06/, "delay retune should be offset by ~60 ms");
  assert.match(fn[0], /now\s*\+\s*0\.20/, "feedback restore should be offset by ~200 ms");
});

test("FxChain setEffect: comb toggle cancels pending retune-flush automation", () => {
  const src = read("src/engine/FxChain.ts");
  const fn = src.match(/setEffect\s*\([^)]*\)\s*:\s*void\s*\{[\s\S]*?\n\s\s\}/);
  assert.ok(fn, "setEffect not found");
  const combBranch = fn[0].match(/else if\s*\(\s*id === "comb"\s*\)\s*\{[\s\S]*?\n\s*}/);
  assert.ok(combBranch, "setEffect comb branch not found");
  assert.match(
    combBranch[0],
    /combFbGain\.gain\.cancelScheduledValues\(\s*now\s*\)/,
    "comb toggle should cancel any future flush restore events",
  );
  assert.match(
    combBranch[0],
    /combFlushUntilCtxTime\s*=\s*0/,
    "comb off-toggle should clear the rapid-retune guard window",
  );
});

// ── Loudness trim clamp ──────────────────────────────────────────────

test("MasterBus setLoudnessTrim: clamps to [0.5, 2.0]", () => {
  const src = read("src/engine/MasterBus.ts");
  const fn = src.match(/setLoudnessTrim\s*\([^)]*\)\s*:\s*void\s*\{[\s\S]*?\n\s\s\}/);
  assert.ok(fn, "setLoudnessTrim not found");
  assert.match(fn[0], /Math\.max\(\s*0\.5\s*,\s*Math\.min\(\s*2\.0\s*,/, "loudness trim should clamp to [0.5, 2.0]");
  assert.doesNotMatch(fn[0], /Math\.max\(\s*0\.3\s*,\s*Math\.min\(\s*3\.0\s*,/, "must not be the pre-audit ±10 dB clamp");
  // Gentler ramp floor (0.2 s, was 0.05 s).
  assert.match(fn[0], /Math\.max\(\s*0\.2\s*,/, "ramp floor should be 0.2 s");
});

// ── Width clamp ──────────────────────────────────────────────────────

test("MasterBus setWidth: clamps to [0, 1.6]", () => {
  const src = read("src/engine/MasterBus.ts");
  const fn = src.match(/setWidth\s*\([^)]*\)\s*:\s*void\s*\{[\s\S]*?\n\s\s\}/);
  assert.ok(fn, "setWidth not found");
  assert.match(fn[0], /Math\.max\(\s*0\s*,\s*Math\.min\(\s*1\.6\s*,/, "width should clamp to [0, 1.6]");
  assert.doesNotMatch(fn[0], /Math\.min\(\s*2\s*,/, "must not be the pre-audit 2.0 ceiling");
});

// ── ROOM routing through preLimMixer ─────────────────────────────────

test("MasterBus: roomConvolver lands at preLimMixer (initial wiring)", () => {
  const src = read("src/engine/MasterBus.ts");
  // Initial wiring: roomConvolver.connect(this.preLimMixer)
  assert.match(
    src,
    /roomConvolver\.connect\(\s*this\.preLimMixer\s*\)/,
    "initial wiring must connect roomConvolver to preLimMixer",
  );
  // No initial-wiring connect to outputTrim from roomConvolver.
  // (Allow disconnect in IR-reload path below.)
  const initialWiringRegion = src.slice(0, src.indexOf("loadCathedralIR") || src.length);
  assert.doesNotMatch(
    initialWiringRegion,
    /this\.roomConvolver\.connect\(\s*this\.outputTrim\s*\)/,
    "roomConvolver must not connect to outputTrim in initial wiring",
  );
});

test("MasterBus: IR-reload swap path also lands at preLimMixer", () => {
  const src = read("src/engine/MasterBus.ts");
  const fn = src.match(/loadCathedralIR\s*\([^)]*\)\s*:\s*void\s*\{[\s\S]*?\n\s\s\}/);
  assert.ok(fn, "loadCathedralIR not found");
  assert.match(fn[0], /freshConv\.connect\(\s*this\.preLimMixer\s*\)/, "IR-reload swap must land at preLimMixer");
  assert.doesNotMatch(fn[0], /freshConv\.connect\(\s*this\.outputTrim\s*\)/, "IR-reload swap must not land at outputTrim");
});

// ── ROOM amount cap ──────────────────────────────────────────────────

test("MasterBus setRoomAmount: send level capped at ×0.85", () => {
  const src = read("src/engine/MasterBus.ts");
  const fn = src.match(/setRoomAmount\s*\([^)]*\)\s*:\s*void\s*\{[\s\S]*?\n\s\s\}/);
  assert.ok(fn, "setRoomAmount not found");
  assert.match(fn[0], /a\s*\*\s*0\.85/, "room send should scale UI amount by 0.85");
  // Don't allow regression to the previous over-tight cap.
  assert.doesNotMatch(fn[0], /a\s*\*\s*0\.7[^5]/, "0.7 cap was audibly thin — must not regress");
});
