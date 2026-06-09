import { describe, it, expect, vi, afterEach } from "vitest";
import { AudioEngine } from "../../src/engine/AudioEngine";
import { EFFECT_ORDER, type EffectId } from "../../src/engine/FxChain";
import { PRESETS, getPresetMaterialProfile } from "../../src/engine/presets";
import { TUNINGS, RELATIONS } from "../../src/microtuning";

/**
 * Serial effect chain — the single source of truth for FX ordering lives
 * in `src/engine/FxChain.ts`. These tests guard the deterministic order
 * and topology; real audio-graph wiring is covered by Playwright smoke
 * tests that run in a real browser.
 */
describe("EFFECT_ORDER (serial chain topology)", () => {
  const EXPECTED: readonly EffectId[] = [
    "tape",
    "wow",
    "sub",
    "comb",
    "ringmod",
    "halo",
    "formant",
    "delay",
    "plate",
    "hall",
    "shimmer",
    "freeze",
    "cistern",
    "granular",
    "graincloud",
  ];

  it("contains exactly 15 effects", () => {
    expect(EFFECT_ORDER.length).toBe(15);
  });

  it("has no duplicate effects (each insert appears once)", () => {
    expect(new Set(EFFECT_ORDER).size).toBe(EFFECT_ORDER.length);
  });

  it("matches the canonical deterministic order", () => {
    expect([...EFFECT_ORDER]).toEqual([...EXPECTED]);
  });

  it("places foundation effects before spatial/tail effects", () => {
    // Guards against e.g. putting reverb before tape saturation, which
    // would produce topologically wrong chains even if every node exists.
    // HALO is grouped with foundation here because it is a spectral
    // *generator* (additive partial bloom) — placing it before the
    // reverbs lets PLATE/HALL/SHIMMER smear the new partials into the
    // bed, which is the Radigue/Éliane drone idiom.
    const foundation = ["tape", "wow", "sub", "comb", "ringmod", "halo", "formant", "delay"] as const;
    const spatial = ["plate", "hall", "shimmer", "freeze", "cistern", "granular", "graincloud"] as const;
    const maxFoundation = Math.max(...foundation.map((id) => EFFECT_ORDER.indexOf(id)));
    const minSpatial = Math.min(...spatial.map((id) => EFFECT_ORDER.indexOf(id)));
    expect(maxFoundation).toBeLessThan(minSpatial);
  });
});

/**
 * AudioEngine lifecycle methods, tested against the prototype with a
 * minimal fake `this` (same spirit as voiceEngineDispose.test.ts —
 * mock only the AudioContext/node surface the method touches; real
 * audio-graph wiring is covered by the Playwright smoke tests).
 */
function makeFakeParam(initial: number) {
  return {
    value: initial,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    setTargetAtTime: vi.fn(),
    cancelScheduledValues: vi.fn(),
  };
}

describe("AudioEngine.resume() — context lifecycle", () => {
  function resumeWithState(state: string) {
    const ctx = { state, resume: vi.fn(() => Promise.resolve()) };
    const engine = Object.assign(Object.create(AudioEngine.prototype) as AudioEngine, { ctx });
    void engine.resume();
    return ctx;
  }

  it("resumes a suspended context", () => {
    expect(resumeWithState("suspended").resume).toHaveBeenCalledTimes(1);
  });

  it("resumes an interrupted context (iOS audio-session interruption)", () => {
    // iOS Safari reports the non-standard "interrupted" state after a
    // lock-screen / phone-call / AirPods-disconnect interruption. The
    // constructor's tryResume() handles it; the public resume() (user
    // gesture path) must too, or the HOLD tap is a silent no-op.
    expect(resumeWithState("interrupted").resume).toHaveBeenCalledTimes(1);
  });

  it("is a no-op on a running context", () => {
    expect(resumeWithState("running").resume).not.toHaveBeenCalled();
  });
});

describe("AudioEngine.panic() — in-flight master fade interaction", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function makeFakeEngine() {
    // Simulate a master fade caught mid-flight: the user's mixer volume
    // is 0.8 but the outputTrim has faded down to 0.3 when panic fires.
    const trimGain = makeFakeParam(0.3);
    const masterBus = {
      getOutputTrim: () => ({ gain: trimGain }),
      getMasterVolume: vi.fn(() => 0.8),
      setMasterVolume: vi.fn(),
    };
    const motionEngine = { cancelFade: vi.fn() };
    const engine = Object.assign(Object.create(AudioEngine.prototype) as AudioEngine, {
      ctx: { currentTime: 1 },
      masterBus,
      motionEngine,
      voiceEngine: { stopDrone: vi.fn() },
      fxChain: { panic: vi.fn() },
    });
    return { engine, trimGain, masterBus, motionEngine };
  }

  it("panic during master fade restores user volume and clears fade state", () => {
    vi.useFakeTimers();
    const { engine, trimGain, masterBus, motionEngine } = makeFakeEngine();
    engine.panic();

    // Fade bookkeeping must be cleared via the public cancel path so a
    // later startMasterFade doesn't trip over stale state.
    expect(motionEngine.cancelFade).toHaveBeenCalledTimes(1);

    // Ramp-out still starts from the actual (mid-fade) trim level.
    expect(trimGain.linearRampToValueAtTime).toHaveBeenCalledWith(0, 1.04);

    // After the flush window, the output returns to the user's mixer
    // volume — never frozen at the sampled mid-fade 0.3.
    vi.advanceTimersByTime(400);
    expect(masterBus.setMasterVolume).toHaveBeenCalledWith(0.8);
    const rampedTargets = trimGain.linearRampToValueAtTime.mock.calls.map((c) => c[0]);
    expect(rampedTargets).not.toContain(0.3);
  });
});

describe("PRESETS (authored) validation", () => {
  const KNOWN_EFFECTS = new Set<string>(EFFECT_ORDER);

  it("ships at least one preset", () => {
    expect(PRESETS.length).toBeGreaterThan(0);
  });

  it("has unique preset ids", () => {
    const ids = PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every preset has non-empty id, name, voiceLayers, effects", () => {
    for (const p of PRESETS) {
      expect(typeof p.id).toBe("string");
      expect(p.id.length).toBeGreaterThan(0);
      expect(typeof p.name).toBe("string");
      expect(p.name.length).toBeGreaterThan(0);
      // voiceLayers and effects may be array- or record-shaped across
      // preset authoring styles — accept either, but require presence.
      expect(p.voiceLayers).toBeTruthy();
      expect(p.effects).toBeTruthy();
    }
  });

  it("every preset effect id is a known EffectId", () => {
    for (const p of PRESETS) {
      const fx = p.effects as unknown;
      const ids: string[] = Array.isArray(fx)
        ? (fx as string[])
        : fx && typeof fx === "object"
          ? Object.keys(fx as Record<string, unknown>)
          : [];
      for (const id of ids) {
        expect(KNOWN_EFFECTS.has(id), `preset "${p.id}" has unknown effect "${id}"`).toBe(true);
      }
    }
  });

  it("every shipped builtin tuning is referenced by at least one authored preset", () => {
    // Guards against "shipped but orphaned" for builtin tunings only.
    // Authored `custom:` tunings (Young WTP, Partch, 15-TET, etc.) are
    // curated options surfaced via the tuning picker / Scale Editor
    // and don't require a preset to be discoverable.
    const usedTuningIds = new Set(
      PRESETS.map((p) => p.tuningId).filter((id): id is NonNullable<typeof id> => id != null),
    );
    for (const tuning of TUNINGS) {
      if (typeof tuning.id === "string" && tuning.id.startsWith("custom:")) continue;
      expect(
        usedTuningIds.has(tuning.id),
        `tuning "${tuning.id}" is shipped but no preset uses it`,
      ).toBe(true);
    }
  });

  it("every shipped relation is referenced by at least one authored preset", () => {
    const usedRelationIds = new Set(
      PRESETS.map((p) => p.relationId).filter((id): id is NonNullable<typeof id> => id != null),
    );
    for (const relation of RELATIONS) {
      expect(
        usedRelationIds.has(relation.id),
        `relation "${relation.id}" is shipped but no preset uses it`,
      ).toBe(true);
    }
  });

  it("every preset material profile has only finite numeric params (no NaN)", () => {
    const walk = (v: unknown, path: string): void => {
      if (typeof v === "number") {
        expect(Number.isFinite(v), `non-finite number at ${path}`).toBe(true);
      } else if (Array.isArray(v)) {
        v.forEach((item, i) => walk(item, `${path}[${i}]`));
      } else if (v && typeof v === "object") {
        for (const [k, val] of Object.entries(v)) walk(val, `${path}.${k}`);
      }
    };
    for (const p of PRESETS) {
      const profile = getPresetMaterialProfile(p.id);
      expect(profile).toBeTruthy();
      walk(profile, `preset[${p.id}]`);
    }
  });
});
