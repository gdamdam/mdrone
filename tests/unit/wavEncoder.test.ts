/**
 * wavEncoder + loop-bounce crossfade math — unit tests.
 *
 * Covers:
 *   - Plain 24-bit stereo PCM WAV: RIFF/fmt/data layout is correct,
 *     byte order is little-endian, sample values round-trip within
 *     24-bit quantisation tolerance.
 *   - Optional `smpl` chunk: written when loopPoints are supplied,
 *     carries correct start/end, omitted otherwise.
 *   - Loop-bounce crossfade: at the loop seam (out[L-1] → out[0]),
 *     the resulting audio is the source's own natural continuation
 *     capture[L-1] → capture[L]. That's the whole reason it loops.
 */

import { describe, it, expect } from "vitest";
import { encodeWav24 } from "../../src/engine/wavEncoder";
import { crossfadeIntoOutput } from "../../src/engine/LoopBouncer";

function riffString(view: DataView, offset: number, length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += String.fromCharCode(view.getUint8(offset + i));
  return out;
}

describe("encodeWav24", () => {
  it("writes a RIFF/WAVE/fmt/data header with stereo 24-bit PCM fields", () => {
    const sr = 48000;
    const frames = 100;
    const left = new Float32Array(frames);
    const right = new Float32Array(frames);
    const buf = encodeWav24(left, right, sr);
    const view = new DataView(buf);

    expect(riffString(view, 0, 4)).toBe("RIFF");
    expect(riffString(view, 8, 4)).toBe("WAVE");
    expect(riffString(view, 12, 4)).toBe("fmt ");
    expect(view.getUint32(16, true)).toBe(16);        // fmt size
    expect(view.getUint16(20, true)).toBe(1);         // PCM
    expect(view.getUint16(22, true)).toBe(2);         // stereo
    expect(view.getUint32(24, true)).toBe(sr);
    expect(view.getUint32(28, true)).toBe(sr * 2 * 3); // byte rate
    expect(view.getUint16(32, true)).toBe(6);         // block align (2ch × 3 bytes)
    expect(view.getUint16(34, true)).toBe(24);
    expect(riffString(view, 36, 4)).toBe("data");
    expect(view.getUint32(40, true)).toBe(frames * 2 * 3);
    expect(buf.byteLength).toBe(44 + frames * 2 * 3);
  });

  it("round-trips sample values through 24-bit quantisation", () => {
    const sr = 48000;
    // A handful of known values including extrema and signs.
    const samples = [0.0, 0.5, -0.5, 1.0, -1.0, 0.25, -0.125];
    const left = new Float32Array(samples);
    const right = new Float32Array(samples.map((v) => -v));
    const buf = encodeWav24(left, right, sr);
    const view = new DataView(buf);

    // Read back from the data region.
    let offset = 44;
    for (let i = 0; i < samples.length; i++) {
      // 24-bit little-endian signed.
      const b0 = view.getUint8(offset);
      const b1 = view.getUint8(offset + 1);
      const b2 = view.getUint8(offset + 2);
      offset += 3;
      let n = b0 | (b1 << 8) | (b2 << 16);
      if (n & 0x800000) n |= ~0xffffff; // sign-extend
      // The encoder maps positive samples to 0x7fffff and negatives
      // to 0x800000 scale; expected value matches that mapping.
      // The encoder truncates toward zero (n | 0), matching
      // MasterRecorder's shipped behaviour. Use the same here.
      const expected = samples[i] < 0
        ? (samples[i] * 0x800000) | 0
        : (samples[i] * 0x7fffff) | 0;
      expect(n).toBe(expected);
      offset += 3; // skip right channel
    }
  });

  it("omits the smpl chunk when loopPoints is not provided", () => {
    const left = new Float32Array(8);
    const right = new Float32Array(8);
    const buf = encodeWav24(left, right, 48000);
    const bytes = new Uint8Array(buf);
    // "smpl" is not "fmt " so checking as a byte-window is safe.
    const s = String.fromCharCode(...bytes);
    expect(s.includes("smpl")).toBe(false);
  });

  it("writes a smpl chunk with a forward loop at the requested points", () => {
    const sr = 44100;
    const frames = 2048;
    const left = new Float32Array(frames);
    const right = new Float32Array(frames);
    const buf = encodeWav24(left, right, sr, {
      loopPoints: { start: 0, end: frames - 1 },
    });
    const view = new DataView(buf);

    // smpl chunk begins right after the data payload.
    const dataBase = 44 + frames * 2 * 3;
    expect(riffString(view, dataBase, 4)).toBe("smpl");
    expect(view.getUint32(dataBase + 4, true)).toBe(36 + 24);
    // Sample period = round(1e9 / sampleRate) ns.
    expect(view.getUint32(dataBase + 16, true)).toBe(Math.round(1e9 / sr));
    expect(view.getUint32(dataBase + 20, true)).toBe(60); // MIDI unity = C4
    expect(view.getUint32(dataBase + 36, true)).toBe(1);  // num loops
    // Loop descriptor — at dataBase + 44.
    expect(view.getUint32(dataBase + 48, true)).toBe(0);         // forward
    expect(view.getUint32(dataBase + 52, true)).toBe(0);         // start
    expect(view.getUint32(dataBase + 56, true)).toBe(frames - 1); // end
    expect(view.getUint32(dataBase + 64, true)).toBe(0);         // infinite
  });
});

describe("crossfadeIntoOutput", () => {
  it("at the loop seam, out[L-1] → out[0] reproduces capture[L-1] → capture[L]", () => {
    // Build a capture as a pure sine — the only truly drone-like
    // stationary signal where sample-level continuity is easy to
    // assert. If the crossfade corrupts the seam, a sine's
    // sample-to-sample continuity will break.
    const sr = 48000;
    const loopFrames = 1024;
    const fadeFrames = 128;
    const total = loopFrames + fadeFrames;
    const capL = new Float32Array(total);
    const capR = new Float32Array(total);
    const freq = 200;
    for (let i = 0; i < total; i++) {
      const phase = (2 * Math.PI * freq * i) / sr;
      capL[i] = Math.sin(phase);
      capR[i] = Math.cos(phase);
    }

    const outL = new Float32Array(loopFrames);
    const outR = new Float32Array(loopFrames);
    crossfadeIntoOutput(capL, capR, outL, outR, loopFrames, fadeFrames);

    // By construction of the crossfade:
    //   out[L-1] should equal capture[L-1] (untouched)
    //   out[0]   should equal capture[L]   (full "overshoot" weight, zero "head" weight)
    expect(outL[loopFrames - 1]).toBeCloseTo(capL[loopFrames - 1], 6);
    expect(outR[loopFrames - 1]).toBeCloseTo(capR[loopFrames - 1], 6);
    expect(outL[0]).toBeCloseTo(capL[loopFrames], 6);
    expect(outR[0]).toBeCloseTo(capR[loopFrames], 6);

    // The seam delta out[0] - out[L-1] should match the natural
    // capture delta cap[L] - cap[L-1] — proving the seam is
    // sample-level continuous with the source.
    const seamDelta = outL[0] - outL[loopFrames - 1];
    const naturalDelta = capL[loopFrames] - capL[loopFrames - 1];
    expect(seamDelta).toBeCloseTo(naturalDelta, 6);
  });

  it("preserves amplitude when head and tail are identical (drone case)", () => {
    // Linear crossfade of two equal signals should equal the
    // signal. This is the common case for stationary drones where
    // capture[i] ≈ capture[L+i] and phase is coherent across a
    // short window.
    const loopFrames = 1024;
    const fadeFrames = 128;
    const total = loopFrames + fadeFrames;
    const capL = new Float32Array(total);
    const capR = new Float32Array(total);
    // Fill with a DC value so capture[i] == capture[L+i] for all i.
    capL.fill(0.5);
    capR.fill(-0.25);
    const outL = new Float32Array(loopFrames);
    const outR = new Float32Array(loopFrames);
    crossfadeIntoOutput(capL, capR, outL, outR, loopFrames, fadeFrames);

    for (let i = 0; i < loopFrames; i++) {
      expect(outL[i]).toBeCloseTo(0.5, 6);
      expect(outR[i]).toBeCloseTo(-0.25, 6);
    }
  });

  it("writes straight-through body samples past the fade region", () => {
    const loopFrames = 512;
    const fadeFrames = 64;
    const total = loopFrames + fadeFrames;
    const capL = new Float32Array(total);
    const capR = new Float32Array(total);
    for (let i = 0; i < total; i++) {
      capL[i] = i / total;
      capR[i] = -capL[i];
    }
    const outL = new Float32Array(loopFrames);
    const outR = new Float32Array(loopFrames);
    crossfadeIntoOutput(capL, capR, outL, outR, loopFrames, fadeFrames);

    // Frames >= fadeFrames must equal capture directly.
    for (let i = fadeFrames; i < loopFrames; i++) {
      expect(outL[i]).toBe(capL[i]);
      expect(outR[i]).toBe(capR[i]);
    }
  });
});
