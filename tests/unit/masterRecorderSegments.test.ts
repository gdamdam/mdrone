import { describe, it, expect } from "vitest";
import {
  segmentFilename,
  estimateRecordingBytes,
  RECOMMENDED_MAX_TAKE_MINUTES,
  SEGMENT_FILENAME_PAD,
} from "../../src/engine/MasterRecorder";

describe("segmentFilename", () => {
  it("produces zero-padded `pt01`/`pt02` suffixes by default", () => {
    expect(segmentFilename("mdrone-take-2026-04-28", 1)).toBe(
      "mdrone-take-2026-04-28-pt01.wav",
    );
    expect(segmentFilename("mdrone-take-2026-04-28", 9)).toBe(
      "mdrone-take-2026-04-28-pt09.wav",
    );
    expect(segmentFilename("mdrone-take-2026-04-28", 12)).toBe(
      "mdrone-take-2026-04-28-pt12.wav",
    );
  });

  it("respects a custom extension", () => {
    expect(segmentFilename("foo", 3, "flac")).toBe("foo-pt03.flac");
  });

  it("padding width matches SEGMENT_FILENAME_PAD constant", () => {
    expect(SEGMENT_FILENAME_PAD).toBeGreaterThanOrEqual(2);
    const n = segmentFilename("x", 1);
    expect(n).toMatch(/-pt0+1\.wav$/);
  });
});

describe("estimateRecordingBytes", () => {
  // 48 kHz × 10 min = 28_800_000 frames; ×2 channels × 4 bytes = 230,400,000 ≈ 219.7 MB.
  // The README quote is "~44 MB per 10 minutes at 48 kHz" but that was per-channel
  // mono historically — verify at least the order of magnitude here so the helper
  // doesn't silently regress.
  it("returns a positive byte estimate scaling with duration", () => {
    const oneMin = estimateRecordingBytes(48_000, 60_000);
    const tenMin = estimateRecordingBytes(48_000, 600_000);
    expect(oneMin).toBeGreaterThan(0);
    expect(tenMin / oneMin).toBeCloseTo(10, 1);
  });

  it("yields 0 for non-positive durations", () => {
    expect(estimateRecordingBytes(48_000, 0)).toBe(0);
    expect(estimateRecordingBytes(48_000, -100)).toBe(0);
  });

  it("scales with sample rate", () => {
    const at48 = estimateRecordingBytes(48_000, 60_000);
    const at96 = estimateRecordingBytes(96_000, 60_000);
    expect(at96).toBe(at48 * 2);
  });
});

describe("RECOMMENDED_MAX_TAKE_MINUTES", () => {
  it("is a sensible recommended max — at least 15 minutes, at most 60", () => {
    expect(RECOMMENDED_MAX_TAKE_MINUTES).toBeGreaterThanOrEqual(15);
    expect(RECOMMENDED_MAX_TAKE_MINUTES).toBeLessThanOrEqual(60);
  });
});
