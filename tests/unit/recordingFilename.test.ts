import { describe, it, expect } from "vitest";
import {
  buildTakeWavFilename,
  buildWavFilename,
  formatDurationMs,
  formatRecordingTimestamp,
  sanitizeRecordingName,
} from "../../src/engine/recordingFilename";

describe("sanitizeRecordingName", () => {
  it("lowercases, hyphenates, and strips non-ASCII", () => {
    expect(sanitizeRecordingName("Welcome Drone")).toBe("welcome-drone");
    expect(sanitizeRecordingName("Bayati ✦ Sketch")).toBe("bayati-sketch");
    expect(sanitizeRecordingName("Café Noir / 2026")).toBe("cafe-noir-2026");
  });

  it("collapses repeated separators and trims edge hyphens", () => {
    expect(sanitizeRecordingName("--  spaces  &  symbols  --")).toBe("spaces-symbols");
    expect(sanitizeRecordingName("___leading_underscores___")).toBe("leading-underscores");
  });

  it("returns empty for null/undefined/whitespace", () => {
    expect(sanitizeRecordingName(null)).toBe("");
    expect(sanitizeRecordingName(undefined)).toBe("");
    expect(sanitizeRecordingName("   ")).toBe("");
    expect(sanitizeRecordingName("!!! ???")).toBe("");
  });

  it("clamps long names to 48 chars", () => {
    const long = "a-really-really-really-really-really-really-really-really-long-name";
    const out = sanitizeRecordingName(long);
    expect(out.length).toBeLessThanOrEqual(48);
    expect(out.startsWith("a-really")).toBe(true);
  });
});

describe("formatRecordingTimestamp", () => {
  it("emits YYYY-MM-DD-HHMM in local time", () => {
    const d = new Date(2026, 3, 29, 14, 22, 0); // April is month index 3
    expect(formatRecordingTimestamp(d)).toBe("2026-04-29-1422");
  });

  it("zero-pads single-digit components", () => {
    const d = new Date(2026, 0, 5, 9, 7, 0);
    expect(formatRecordingTimestamp(d)).toBe("2026-01-05-0907");
  });
});

describe("buildWavFilename", () => {
  const fixed = new Date(2026, 3, 29, 14, 22, 0);

  it("includes a slug when a scene name is supplied", () => {
    expect(buildWavFilename("Welcome Drone", fixed)).toBe(
      "mdrone-welcome-drone-2026-04-29-1422.wav",
    );
  });

  it("falls back to plain mdrone-<ts>.wav when no name", () => {
    expect(buildWavFilename("", fixed)).toBe("mdrone-2026-04-29-1422.wav");
    expect(buildWavFilename(null, fixed)).toBe("mdrone-2026-04-29-1422.wav");
    expect(buildWavFilename(undefined, fixed)).toBe("mdrone-2026-04-29-1422.wav");
  });

  it("produces a filesystem-safe name (no slashes, colons, asterisks, ?, |, <, >)", () => {
    const name = buildWavFilename('Bad/Name:With*Many?Chars|<like>this', fixed);
    expect(name).not.toMatch(/[\\/:*?"<>|]/);
  });
});

describe("buildTakeWavFilename", () => {
  const fixed = new Date(2026, 3, 29, 14, 22, 0);

  it("includes the take label and slug", () => {
    expect(buildTakeWavFilename("Welcome Drone", "1m", fixed)).toBe(
      "mdrone-welcome-drone-take-1m-2026-04-29-1422.wav",
    );
  });

  it("falls back to mdrone-take-<label>-<ts>.wav with no scene name", () => {
    expect(buildTakeWavFilename("", "30s", fixed)).toBe("mdrone-take-30s-2026-04-29-1422.wav");
    expect(buildTakeWavFilename(null, "10m", fixed)).toBe("mdrone-take-10m-2026-04-29-1422.wav");
  });

  it("sanitizes the duration label", () => {
    expect(buildTakeWavFilename("Drone", "1 / m", fixed)).toBe(
      "mdrone-drone-take-1-m-2026-04-29-1422.wav",
    );
  });

  it("falls back to 'take' when the label sanitizes to empty", () => {
    expect(buildTakeWavFilename("Drone", "???", fixed)).toBe(
      "mdrone-drone-take-take-2026-04-29-1422.wav",
    );
  });
});

describe("formatDurationMs", () => {
  it("formats sub-minute as 0:SS", () => {
    expect(formatDurationMs(0)).toBe("0:00");
    expect(formatDurationMs(999)).toBe("0:00");
    expect(formatDurationMs(1000)).toBe("0:01");
    expect(formatDurationMs(59_999)).toBe("0:59");
  });

  it("formats minutes correctly", () => {
    expect(formatDurationMs(60_000)).toBe("1:00");
    expect(formatDurationMs(222_000)).toBe("3:42");
    expect(formatDurationMs(3_600_000)).toBe("60:00");
  });

  it("clamps negatives to 0:00", () => {
    expect(formatDurationMs(-1)).toBe("0:00");
    expect(formatDurationMs(-1234)).toBe("0:00");
  });
});
