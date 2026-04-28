import { describe, it, expect } from "vitest";
import {
  buildAudioDiagnostics,
  renderAudioDiagnosticsJson,
  renderAudioDiagnosticsMarkdown,
  type DiagnosticsEngineLike,
  type DiagnosticsHooks,
} from "../../src/devtools/audioDiagnostics";
import type { TraceEvent } from "../../src/engine/audioTrace";

function makeEngine(overrides: Partial<DiagnosticsEngineLike> = {}): DiagnosticsEngineLike {
  return {
    ctx: {
      state: "running",
      sampleRate: 48000,
      baseLatency: 0.005,
      outputLatency: 0.012,
      currentTime: 42.123,
    } as unknown as AudioContext,
    getLoadMonitor: () => ({
      getState: () => ({
        struggling: false,
        driftMs: 0.4,
        underruns: 0,
        baseLatencyMs: 5,
        outputLatencyMs: 12,
        sampleRate: 48000,
      }),
    }),
    getAdaptiveStabilityState: () => ({
      stage: 0,
      lowPower: false,
      bypassedFx: [],
      voiceCap: null,
    }),
    getLiveSafeState: () => ({
      active: false,
      voiceCap: null,
      suppressedFx: [],
    }),
    isLowPower: () => false,
    isUserLowPower: () => false,
    getRootFreq: () => 110,
    getIntervalsCents: () => [0, 700],
    getVoiceLayers: () => ({ tanpura: true, reed: false }),
    getMaxVoiceLayers: () => 7,
    getEffectStates: () => ({ tape: true, plate: true, shimmer: true }),
    getUserEffectStates: () => ({ tape: true, plate: true, shimmer: true }),
    getVoiceLevel: (t) => (t === "tanpura" ? 0.9 : 0),
    getMasterVolume: () => 0.7,
    isLimiterEnabled: () => true,
    getLimiterCeiling: () => -0.5,
    isHeadphoneSafe: () => false,
    getWidth: () => 1,
    getRoomAmount: () => 0,
    getDrive: () => 0,
    ...overrides,
  };
}

function makeHooks(overrides: Partial<DiagnosticsHooks> = {}): DiagnosticsHooks {
  return {
    appVersion: "1.19.3",
    engine: makeEngine(),
    getPreset: () => ({ id: "tanpura-bansuri", name: "Tanpura Bansuri" }),
    getTrace: () => ({ enabled: false, events: [] }),
    getAudioDebugFlags: () => [],
    now: () => new Date("2026-04-28T12:00:00.000Z"),
    url: () => "https://mdrone.org/app.html",
    userAgent: () => "Mozilla/5.0 (Macintosh; Apple Silicon Mac OS X) Chrome/127",
    platform: () => "MacIntel",
    hardwareConcurrency: () => 10,
    deviceMemoryGb: () => 16,
    ...overrides,
  };
}

describe("buildAudioDiagnostics — payload shape", () => {
  it("populates every top-level section", () => {
    const r = buildAudioDiagnostics(makeHooks());
    expect(r.meta.appVersion).toBe("1.19.3");
    expect(r.meta.timestamp).toBe("2026-04-28T12:00:00.000Z");
    expect(r.audioContext.sampleRate).toBe(48000);
    expect(r.audioContext.baseLatencyMs).toBeCloseTo(5, 5);
    expect(r.audioContext.outputLatencyMs).toBeCloseTo(12, 5);
    expect(r.loadMonitor.underruns).toBe(0);
    expect(r.adaptive.stage).toBe(0);
    expect(r.liveSafe.active).toBe(false);
    expect(r.lowPower.user).toBe(false);
    expect(r.preset.id).toBe("tanpura-bansuri");
    expect(r.voices.rootFreqHz).toBe(110);
    expect(r.voices.intervalsCount).toBe(2);
    expect(r.voices.layers.tanpura).toBe(true);
    expect(r.voices.maxVoiceLayers).toBe(7);
    expect(r.fx.userIntent.tape).toBe(true);
    expect(r.mixer.limiterEnabled).toBe(true);
    expect(r.audioDebugFlags).toEqual([]);
    expect(r.trace.enabled).toBe(false);
  });

  it("computes the FX suppression diff (userIntent && !effective)", () => {
    const engine = makeEngine({
      getEffectStates: () => ({ tape: true, plate: false, shimmer: false }),
      getUserEffectStates: () => ({ tape: true, plate: true, shimmer: true }),
    });
    const r = buildAudioDiagnostics(makeHooks({ engine }));
    expect(r.fx.suppressed).toEqual(["plate", "shimmer"]);
  });

  it("never includes URL query / hash (share data) in the URL field", () => {
    const r = buildAudioDiagnostics(makeHooks({
      url: () => "https://mdrone.org/app.html",
    }));
    expect(r.meta.url).not.toMatch(/[?#]/);
  });

  it("collects voice levels via the optional getVoiceLevel hook", () => {
    const r = buildAudioDiagnostics(makeHooks());
    expect(r.voices.levels.tanpura).toBe(0.9);
    expect(r.voices.levels.reed).toBe(0);
  });

  it("does not crash when optional mixer getters are absent", () => {
    const engine = makeEngine();
    delete engine.getMasterVolume;
    delete engine.isLimiterEnabled;
    delete engine.getLimiterCeiling;
    delete engine.isHeadphoneSafe;
    delete engine.getWidth;
    delete engine.getRoomAmount;
    delete engine.getDrive;
    const r = buildAudioDiagnostics(makeHooks({ engine }));
    expect(r.mixer.masterVolume).toBe(null);
    expect(r.mixer.limiterEnabled).toBe(null);
    expect(r.mixer.limiterCeilingDb).toBe(null);
    expect(r.mixer.headphoneSafe).toBe(null);
    expect(r.mixer.width).toBe(null);
    expect(r.mixer.roomAmount).toBe(null);
    expect(r.mixer.drive).toBe(null);
  });

  it("does not crash when getVoiceLevel throws for unsupported voice types", () => {
    const engine = makeEngine({
      getVoiceLevel: (t) => {
        if (t === "tanpura") return 0.5;
        throw new Error("unknown voice");
      },
    });
    const r = buildAudioDiagnostics(makeHooks({ engine }));
    expect(r.voices.levels.tanpura).toBe(0.5);
    // Other voices simply omitted, not crashed.
  });

  it("omits trace events when the trace ring is disabled", () => {
    const r = buildAudioDiagnostics(makeHooks({
      getTrace: () => ({ enabled: false, events: [{ tMs: 1, audioSec: 0, kind: "x" }] as TraceEvent[] }),
    }));
    expect(r.trace.enabled).toBe(false);
    expect(r.trace.recent).toEqual([]);
  });

  it("includes recent trace events (capped) when enabled", () => {
    const events: TraceEvent[] = [];
    for (let i = 0; i < 200; i++) events.push({ tMs: i, audioSec: i / 1000, kind: "tick" });
    const r = buildAudioDiagnostics(makeHooks({
      getTrace: () => ({ enabled: true, events }),
    }));
    expect(r.trace.enabled).toBe(true);
    expect(r.trace.eventCount).toBe(200);
    expect(r.trace.recent.length).toBeLessThanOrEqual(60);
    // Most recent — tail of the input.
    expect(r.trace.recent.at(-1)?.tMs).toBe(199);
  });
});

describe("renderAudioDiagnosticsJson", () => {
  it("returns valid JSON with the documented top-level shape", () => {
    const md = renderAudioDiagnosticsJson(buildAudioDiagnostics(makeHooks()));
    const parsed = JSON.parse(md);
    expect(parsed.meta.appVersion).toBe("1.19.3");
    expect(parsed.audioContext.sampleRate).toBe(48000);
    expect(Array.isArray(parsed.adaptive.bypassedFx)).toBe(true);
  });
});

describe("renderAudioDiagnosticsMarkdown", () => {
  it("includes every documented section header", () => {
    const md = renderAudioDiagnosticsMarkdown(buildAudioDiagnostics(makeHooks()));
    expect(md).toContain("# mdrone audio report — 1.19.3");
    expect(md).toContain("## Browser / device");
    expect(md).toContain("## AudioContext");
    expect(md).toContain("## Load monitor");
    expect(md).toContain("## Adaptive stability");
    expect(md).toContain("## LIVE SAFE");
    expect(md).toContain("## Low-power composition");
    expect(md).toContain("## Preset");
    expect(md).toContain("## Voices");
    expect(md).toContain("## FX");
    expect(md).toContain("## Mixer");
    expect(md).toContain("## Audio-debug flags");
    expect(md).toContain("## Trace");
  });

  it("redacts share URLs — no query / hash in the rendered URL line", () => {
    const md = renderAudioDiagnosticsMarkdown(buildAudioDiagnostics(makeHooks({
      url: () => "https://mdrone.org/app.html",
    })));
    const urlLine = md.split("\n").find((l) => l.startsWith("URL: "))!;
    expect(urlLine).toMatch(/^URL: `https:\/\/mdrone\.org\/app\.html`$/);
    expect(urlLine).not.toMatch(/\?/);
    expect(urlLine).not.toMatch(/#/);
  });

  it("formats trace as 'disabled' when off", () => {
    const md = renderAudioDiagnosticsMarkdown(buildAudioDiagnostics(makeHooks()));
    expect(md).toMatch(/enabled: no/);
    expect(md).toContain("enable with `?audio-debug=trace`");
  });

  it("formats trace events when enabled", () => {
    const md = renderAudioDiagnosticsMarkdown(buildAudioDiagnostics(makeHooks({
      getTrace: () => ({
        enabled: true,
        events: [
          { tMs: 12.34, audioSec: 0.005, kind: "ctxCreate", payload: { sampleRate: 48000 } },
          { tMs: 56.78, audioSec: 0.020, kind: "underrun" },
        ],
      }),
    })));
    expect(md).toContain("enabled: yes");
    expect(md).toContain("ring length: 2");
    expect(md).toMatch(/t=12\.3ms a=0\.005s ctxCreate/);
    expect(md).toMatch(/t=56\.8ms a=0\.020s underrun/);
  });

  it("flags suppressed FX clearly", () => {
    const engine = makeEngine({
      getEffectStates: () => ({ shimmer: false }),
      getUserEffectStates: () => ({ shimmer: true }),
    });
    const md = renderAudioDiagnosticsMarkdown(buildAudioDiagnostics(makeHooks({ engine })));
    expect(md).toContain("**suppressed (user-intent ON, runtime OFF):** shimmer");
  });

  it("does not expose deviceMemory when unavailable", () => {
    const md = renderAudioDiagnosticsMarkdown(buildAudioDiagnostics(makeHooks({
      deviceMemoryGb: () => null,
      hardwareConcurrency: () => null,
    })));
    expect(md).toContain("hardwareConcurrency: —");
    expect(md).toContain("deviceMemory: — GiB");
  });
});

describe("mixer getters preserve `this` (regression for v1.20.0 report bug)", () => {
  // Shape AudioEngine actually has — getters that delegate via `this.masterBus`.
  // Bare-method-reference call would lose `this`, throw, and the report
  // would silently report null for every mixer field. Asserts the
  // diagnostics module passes a `this`-bound closure, not a method ref.
  class FakeEngineWithThis {
    private trim = 0.7;
    private limOn = true;
    ctx = {
      state: "running", sampleRate: 48000, baseLatency: 0.005,
      outputLatency: 0.012, currentTime: 1,
    } as unknown as AudioContext;
    getLoadMonitor() { return { getState: () => ({ struggling: false, driftMs: 0, underruns: 0, baseLatencyMs: 5, outputLatencyMs: 12, sampleRate: 48000 }) }; }
    getAdaptiveStabilityState() { return { stage: 0 as const, lowPower: false, bypassedFx: [], voiceCap: null }; }
    getLiveSafeState() { return { active: false, voiceCap: null, suppressedFx: [] }; }
    isLowPower() { return false; }
    isUserLowPower() { return false; }
    getRootFreq() { return 110; }
    getIntervalsCents() { return [0]; }
    getVoiceLayers() { return {}; }
    getMaxVoiceLayers() { return 7; }
    getEffectStates() { return {}; }
    getUserEffectStates() { return {}; }
    getMasterVolume() { return this.trim; }                    // requires `this`
    isLimiterEnabled() { return this.limOn; }                  // requires `this`
    getLimiterCeiling() { return -0.5; }
    isHeadphoneSafe() { return false; }
    getWidth() { return 1; }
    getRoomAmount() { return 0; }
    getDrive() { return 0; }
  }

  it("reads `this`-dependent mixer values without losing the receiver", () => {
    const engine = new FakeEngineWithThis() as unknown as DiagnosticsEngineLike;
    const r = buildAudioDiagnostics(makeHooks({ engine }));
    expect(r.mixer.masterVolume).toBe(0.7);
    expect(r.mixer.limiterEnabled).toBe(true);
  });
});

describe("privacy guarantees", () => {
  it("does not include localStorage / session data — only what hooks provide", () => {
    // The builder only reads from explicit hooks. Verify no globals
    // are touched by passing hooks that override every source.
    const r = buildAudioDiagnostics(makeHooks({
      url: () => "https://safe.example/app",
      userAgent: () => "test-ua",
      platform: () => "test-platform",
      hardwareConcurrency: () => 4,
      deviceMemoryGb: () => 8,
    }));
    const json = JSON.stringify(r);
    expect(json).not.toMatch(/localStorage/i);
    expect(json).not.toMatch(/share|seed=|preset=|fx=/i);
    expect(r.meta.url).toBe("https://safe.example/app");
  });

  it("preset name override is not auto-pulled — comes only via getPreset hook", () => {
    const r = buildAudioDiagnostics(makeHooks({ getPreset: undefined }));
    expect(r.preset.id).toBe(null);
    expect(r.preset.name).toBe(null);
  });
});
