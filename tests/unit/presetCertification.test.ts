import { describe, it, expect, beforeEach } from "vitest";
import {
  createPresetCertController,
  validateMark,
  PRESET_CERT_TAGS,
  PRESET_CERT_FLAGS,
  type PresetCertController,
  type PresetCertHooks,
  type PresetCertItem,
} from "../../src/devtools/presetCertification";

const FAKE_PRESETS: PresetCertItem[] = [
  { id: "alpha", name: "Alpha", group: "tanpura" },
  { id: "beta", name: "Beta", group: "drone" },
  { id: "gamma", name: "Gamma", group: "drone" },
  { id: "secret", name: "Secret", group: "internal", hidden: true },
];

type FakeHooks = PresetCertHooks & {
  applied: string[];
  ensured: number;
  fakeNowMs: number;
  fakeNowIsoCounter: number;
  downloads: { filename: string; body: string; mime: string }[];
};

function makeHooks(overrides: Partial<PresetCertHooks> = {}): FakeHooks {
  const out = {
    applied: [] as string[],
    ensured: 0,
    fakeNowMs: 0,
    fakeNowIsoCounter: 0,
    downloads: [] as { filename: string; body: string; mime: string }[],
    presets: FAKE_PRESETS,
    applyPresetById: (id: string) => { out.applied.push(id); },
    ensurePlaying: () => { out.ensured += 1; },
    captureTechnical: overrides.captureTechnical ?? (() => ({
      voiceLayers: ["tanpura"],
      effects: [] as never[],
      adaptiveStage: 0,
      underruns: 0,
      lufsShort: null,
      peakDb: null,
    })),
    nowMs: () => out.fakeNowMs,
    nowIso: () => `2026-04-28T00:00:0${out.fakeNowIsoCounter++}.000Z`,
    download: (filename: string, body: string, mime: string) => {
      out.downloads.push({ filename, body, mime });
    },
  };
  return out as unknown as FakeHooks;
}

describe("validateMark", () => {
  it("accepts an empty mark", () => {
    expect(() => validateMark({})).not.toThrow();
  });

  it("rejects an unknown tag", () => {
    expect(() => validateMark({ tag: "BOGUS" as never })).toThrow(/unknown tag/);
  });

  it("accepts every known tag", () => {
    for (const t of PRESET_CERT_TAGS) {
      expect(() => validateMark({ tag: t })).not.toThrow();
    }
  });

  it("rejects an unknown flag", () => {
    expect(() => validateMark({ flags: ["BOGUS" as never] })).toThrow(/unknown flag/);
  });

  it("accepts every known flag", () => {
    expect(() => validateMark({ flags: PRESET_CERT_FLAGS })).not.toThrow();
  });

  it("rejects an unknown score key", () => {
    expect(() => validateMark({ scores: { foo: 3 } as never })).toThrow(/unknown score key/);
  });

  it("rejects out-of-range score values", () => {
    expect(() => validateMark({ scores: { toneQuality: 0 } })).toThrow(/1\.\.5/);
    expect(() => validateMark({ scores: { toneQuality: 6 } })).toThrow(/1\.\.5/);
    expect(() => validateMark({ scores: { toneQuality: 3.5 } })).toThrow(/1\.\.5/);
  });

  it("accepts boundary scores 1 and 5", () => {
    expect(() => validateMark({ scores: { toneQuality: 1, professionalReadiness: 5 } })).not.toThrow();
  });
});

describe("createPresetCertController — iterator behavior", () => {
  let hooks: FakeHooks;
  let cert: PresetCertController;

  beforeEach(() => {
    hooks = makeHooks();
    cert = createPresetCertController(hooks);
  });

  it("requires start() before mark/next/prev", () => {
    expect(cert.current()).toBe(null);
    expect(() => cert.mark({ tag: "STUDIO" })).toThrow(/start/);
  });

  it("start() applies the first non-hidden preset and skips hidden ones", async () => {
    await cert.start();
    expect(hooks.applied).toEqual(["alpha"]);
    expect(hooks.ensured).toBe(1);
    const cur = cert.current()!;
    expect(cur.presetId).toBe("alpha");
    expect(cur.index).toBe(0);
    expect(cur.total).toBe(3); // hidden filtered out
  });

  it("next() advances and applies the next preset", async () => {
    await cert.start();
    expect(await cert.next()).toBe(true);
    expect(hooks.applied).toEqual(["alpha", "beta"]);
    expect(cert.current()!.presetId).toBe("beta");
    expect(await cert.next()).toBe(true);
    expect(cert.current()!.presetId).toBe("gamma");
  });

  it("next() at the end returns false and does not advance", async () => {
    await cert.start();
    await cert.next();
    await cert.next();
    expect(await cert.next()).toBe(false);
    expect(cert.current()!.presetId).toBe("gamma");
  });

  it("prev() goes back and re-applies the previous preset", async () => {
    await cert.start();
    await cert.next();
    expect(await cert.prev()).toBe(true);
    expect(hooks.applied).toEqual(["alpha", "beta", "alpha"]);
    expect(cert.current()!.presetId).toBe("alpha");
  });

  it("prev() at the start returns false", async () => {
    await cert.start();
    expect(await cert.prev()).toBe(false);
  });

  it("mark() persists across next/prev round-trips", async () => {
    await cert.start();
    cert.mark({ tag: "LIVE_SAFE", scores: { toneQuality: 5 }, notes: "lovely" });
    await cert.next();
    await cert.prev();
    const cur = cert.current()!;
    expect(cur.hasMark).toBe(true);
    const entries = cert._entries();
    const alpha = entries.find((e) => e.presetId === "alpha")!;
    expect(alpha.tag).toBe("LIVE_SAFE");
    expect(alpha.scores?.toneQuality).toBe(5);
    expect(alpha.notes).toBe("lovely");
  });

  it("mark() rejects invalid input without mutating the entry", async () => {
    await cert.start();
    expect(() => cert.mark({ tag: "BOGUS" as never })).toThrow();
    const alpha = cert._entries().find((e) => e.presetId === "alpha")!;
    expect(alpha.tag).toBeUndefined();
  });

  it("filter option restricts the preset set", async () => {
    await cert.start({ filter: (p) => p.group === "drone" });
    expect(cert.current()!.total).toBe(2);
    expect(cert.current()!.presetId).toBe("beta");
  });

  it("auditionElapsedMs / auditionRequiredMs reflect the configured window", async () => {
    hooks.fakeNowMs = 1000;
    await cert.start({ auditionMs: 30_000 });
    hooks.fakeNowMs = 5000;
    const cur = cert.current()!;
    expect(cur.auditionElapsedMs).toBe(4000);
    expect(cur.auditionRequiredMs).toBe(30_000);
  });

  it("reset() clears the session", async () => {
    await cert.start();
    cert.mark({ tag: "STUDIO" });
    cert.reset();
    expect(cert.current()).toBe(null);
    expect(cert._entries()).toEqual([]);
  });
});

describe("createPresetCertController — exports", () => {
  let hooks: FakeHooks;
  let cert: PresetCertController;

  beforeEach(() => {
    hooks = makeHooks();
    cert = createPresetCertController(hooks);
  });

  it("exportMarkdown contains a table header and a row per marked preset", async () => {
    await cert.start();
    cert.mark({
      tag: "LIVE_SAFE",
      scores: { toneQuality: 5, professionalReadiness: 4 },
      verdict: "Excellent devotional bed.",
      notes: "Holds steady at 10 minutes.",
    });
    const md = cert.exportMarkdown();
    expect(md).toContain("# Preset certification");
    expect(md).toContain("| Preset | Group | Tag");
    expect(md).toContain("| Alpha | tanpura | LIVE_SAFE");
    expect(md).toContain("Excellent devotional bed.");
    expect(md).toContain("Holds steady at 10 minutes.");
  });

  it("exportMarkdown escapes pipe characters in the verdict cell", async () => {
    await cert.start();
    cert.mark({ verdict: "uses | pipe" });
    const md = cert.exportMarkdown();
    // Inside the table row, `|` must be escaped so the table parses.
    expect(md).toMatch(/uses \\\| pipe/);
  });

  it("exportMarkdown renders technical readings when present", async () => {
    hooks = makeHooks({
      captureTechnical: () => ({
        voiceLayers: ["tanpura", "reed"],
        effects: ["plate", "shimmer"],
        adaptiveStage: 2,
        underruns: 4,
        lufsShort: -14.3,
        peakDb: -0.4,
      }),
    });
    cert = createPresetCertController(hooks);
    await cert.start();
    cert.mark({ tag: "STUDIO" });
    const md = cert.exportMarkdown();
    expect(md).toContain("Adaptive stage during audition: 2");
    expect(md).toContain("Underruns observed: 4");
    expect(md).toContain("LUFS-S: -14.3");
    expect(md).toContain("Voice layers: tanpura, reed");
    expect(md).toContain("FX (user intent): plate, shimmer");
  });

  it("exportJson is valid JSON with the documented top-level shape", async () => {
    await cert.start();
    cert.mark({ tag: "RICH", scores: { identity: 5 } });
    const out = cert.exportJson();
    const parsed = JSON.parse(out);
    expect(parsed.generatedAt).toMatch(/^2026-04-28T/);
    expect(parsed.total).toBe(3);
    expect(Array.isArray(parsed.entries)).toBe(true);
    expect(parsed.entries[0].presetId).toBe("alpha");
    expect(parsed.entries[0].tag).toBe("RICH");
    expect(parsed.entries[0].scores.identity).toBe(5);
  });

  it("exportJson works with no session (empty payload)", () => {
    const out = cert.exportJson();
    const parsed = JSON.parse(out);
    expect(parsed.entries).toEqual([]);
    expect(parsed.total).toBe(0);
  });

  it("export hooks the download side-effect when provided", async () => {
    await cert.start();
    cert.mark({ tag: "STUDIO" });
    cert.exportMarkdown();
    cert.exportJson();
    expect(hooks.downloads.length).toBe(2);
    expect(hooks.downloads[0].mime).toBe("text/markdown");
    expect(hooks.downloads[1].mime).toBe("application/json");
  });
});
